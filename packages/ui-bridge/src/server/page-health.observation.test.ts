/**
 * page-health answers in the Observation envelope, and "could not look" is
 * never rendered as "the page is broken".
 *
 * Before plan 2026-09-20-ui-bridge-observations-… Phase 3, a snapshot with no
 * `elements` key became `[]` at the call site (`snapshot.elements ?? []`),
 * which became 0% spatial coverage, which became a CRITICAL report — an
 * unregistered / not-hydrated page and a genuinely blank page were one
 * answer. And visible elements without a `normalizedRect` were skipped with
 * `if (!rect) continue;`, so a page whose elements carried no geometry read
 * as spatially EMPTY rather than UNMEASURED.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { diagnosePageHealth, SDK_PAGE_HEALTH_PRODUCER_ID } from './page-health';
import { createHandlers, type RegistryLike } from './handlers';
import { CommandRelay } from './command-relay';
import { createRelayHandlers } from './relay-handlers';
import type { DiscoveredElement } from '../control';

const T = Date.UTC(2026, 8, 30, 12, 0, 0);

function visibleEl(
  id: string,
  rect: { x: number; y: number; width: number; height: number } | null
) {
  return {
    id,
    type: 'paragraph',
    tagName: 'p',
    actions: [],
    registered: true,
    category: 'content',
    state: {
      visible: true,
      enabled: true,
      focused: false,
      textContent: '',
      ...(rect ? { normalizedRect: rect } : {}),
    },
  } as unknown as DiscoveredElement;
}

function wire(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

describe('diagnosePageHealth — the envelope', () => {
  it('no elements array → unknown{input_missing}, and no verdict word anywhere in the body', () => {
    const obs = diagnosePageHealth({ elements: undefined, registeredComponents: 3, observedAt: T });
    const body = wire(obs);
    expect(body.status).toBe('unknown');
    expect((body.unknown as { code: string }).code).toBe('input_missing');
    expect('value' in body).toBe(false);
    const text = JSON.stringify(body);
    expect(text).not.toContain('unhealthy');
    expect(text).not.toContain('CRITICAL');
    const prov = body.provenance as Record<string, unknown>;
    expect(prov.producer).toEqual({ id: SDK_PAGE_HEALTH_PRODUCER_ID, version: expect.any(String) });
    // No elements were sampled: observedAt states that with null.
    expect(prov.observedAt).toBeNull();
    expect(prov.confidence).toBeNull();
    expect(prov.cache).toBeNull();
    expect(prov.source).toBeNull();
  });

  it('5 visible elements, 3 without normalizedRect → measured, coverage.unmeasured[0].count === 3', () => {
    const r = { x: 0.3, y: 0.3, width: 0.2, height: 0.1 };
    const elements = [
      visibleEl('a', r),
      visibleEl('b', { ...r, y: 0.5 }),
      visibleEl('c', null),
      visibleEl('d', null),
      visibleEl('e', null),
    ];
    const obs = diagnosePageHealth({ elements, registeredComponents: 1, observedAt: T });
    expect(obs.status).toBe('measured');
    expect(obs.provenance.coverage).toEqual({
      considered: 5,
      measured: 2,
      unmeasured: [{ dimension: 'geometry', count: 3, code: 'input_missing' }],
    });
    expect(obs.provenance.coverage.unmeasured[0].count).toBe(3);
    if (obs.status === 'measured') expect(obs.value.visible_count).toBe(2);
    expect(obs.provenance.observedAt).toBe('2026-09-30T12:00:00.000Z');
  });

  it('every visible element without geometry → unknown{input_missing}, not a CRITICAL blank page', () => {
    const elements = [visibleEl('a', null), visibleEl('b', null)];
    const obs = diagnosePageHealth({ elements, registeredComponents: 1, observedAt: T });
    expect(obs.status).toBe('unknown');
    if (obs.status === 'unknown') expect(obs.unknown.code).toBe('input_missing');
    expect(obs.provenance.coverage.unmeasured).toEqual([
      { dimension: 'geometry', count: 2, code: 'input_missing' },
    ]);
    expect(JSON.stringify(obs)).not.toContain('CRITICAL');
  });

  it('zero elements and zero registered components → unknown{producer_not_run}', () => {
    const obs = diagnosePageHealth({ elements: [], registeredComponents: 0, observedAt: T });
    expect(obs.status).toBe('unknown');
    if (obs.status === 'unknown') expect(obs.unknown.code).toBe('producer_not_run');
    expect(JSON.stringify(obs)).not.toContain('CRITICAL');
  });

  it('a throwing input → unknown{producer_failed}, never a throw', () => {
    const poisoned = [
      {
        get state(): never {
          throw new Error('boom');
        },
      },
    ];
    const obs = diagnosePageHealth({ elements: poisoned, registeredComponents: 1, observedAt: T });
    expect(obs.status).toBe('unknown');
    if (obs.status === 'unknown') {
      expect(obs.unknown.code).toBe('producer_failed');
      expect(obs.unknown.detail).toContain('boom');
    }
  });

  it('a measured report keeps the runner-compatible value shape', () => {
    const obs = diagnosePageHealth({
      elements: [visibleEl('a', { x: 0.3, y: 0.3, width: 0.3, height: 0.3 })],
      registeredComponents: 1,
      observedAt: T,
    });
    expect(obs.status).toBe('measured');
    if (obs.status !== 'measured') return;
    expect(Object.keys(obs.value).sort()).toEqual(
      ['element_count', 'findings', 'heatmap', 'summary', 'visible_count'].sort()
    );
  });
});

// ----------------------------------------------------------------------------
// Handlers — the `?? []` call sites are gone
// ----------------------------------------------------------------------------

function registryReturning(snapshot: unknown, throwOnSnapshot = false): RegistryLike {
  return {
    getAllElements: () => [],
    getElement: () => undefined,
    getAllComponents: () => [],
    getComponent: () => undefined,
    getComponentState: () => null,
    createSnapshot: () => {
      if (throwOnSnapshot) throw new Error('registry exploded');
      return snapshot as ReturnType<RegistryLike['createSnapshot']>;
    },
  } as unknown as RegistryLike;
}

const executor = {
  executeAction: async () => ({ success: true }),
  executeComponentAction: async () => ({ success: true }),
};

// Page health reads no idle signal; leaving the idle detector off keeps its
// DOM observers and scan timers from outliving this file's jsdom environment.
const NO_IDLE = { idleDetection: false } as const;

describe('in-page pageHealth handler', () => {
  it('a snapshot of `{}` answers success + unknown{input_missing}; "unhealthy" appears nowhere', async () => {
    const handlers = createHandlers(registryReturning({}), executor as never, NO_IDLE);
    const res = await handlers.pageHealth();
    expect(res.success).toBe(true);
    const text = JSON.stringify(res);
    expect(text).not.toContain('unhealthy');
    expect(text).not.toContain('CRITICAL');
    expect(res.data?.status).toBe('unknown');
    if (res.data?.status === 'unknown') expect(res.data.unknown.code).toBe('input_missing');
  });

  it('an empty registry answers unknown{producer_not_run}, not a critical finding', async () => {
    const handlers = createHandlers(
      registryReturning({ timestamp: T, elements: [], components: [], workflows: [] }),
      executor as never,
      NO_IDLE
    );
    const res = await handlers.pageHealth();
    expect(res.success).toBe(true);
    expect(res.data?.status).toBe('unknown');
    if (res.data?.status === 'unknown') expect(res.data.unknown.code).toBe('producer_not_run');
  });

  it('a throwing snapshot answers success + unknown{producer_failed}', async () => {
    const handlers = createHandlers(registryReturning(null, true), executor as never, NO_IDLE);
    const res = await handlers.pageHealth();
    expect(res.success).toBe(true);
    expect(res.data?.status).toBe('unknown');
    if (res.data?.status === 'unknown') {
      expect(res.data.unknown.code).toBe('producer_failed');
      expect(res.data.unknown.detail).toContain('registry exploded');
    }
  });
});

describe('relay pageHealth handler', () => {
  let relay: CommandRelay;
  beforeEach(() => {
    relay = new CommandRelay({
      globalPrefix: `__uiBridgeTest_${Math.random().toString(36).slice(2, 10)}`,
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('refreshes before reading: a first call analyzes the fetched snapshot, not the pristine cache', async () => {
    const queue = vi.spyOn(relay, 'queueCommand').mockResolvedValue({
      timestamp: T,
      elements: [visibleEl('a', { x: 0.3, y: 0.3, width: 0.3, height: 0.3 })],
      components: [],
      workflows: [],
    } as never);
    const res = await createRelayHandlers(relay).pageHealth();
    expect(queue).toHaveBeenCalledWith('getControlSnapshot', {});
    expect(res.data?.status).toBe('measured');
    expect(res.data?.provenance.observedAt).toBe('2026-09-30T12:00:00.000Z');
  });

  it('a relay that cannot reach the tab (and holds nothing cached) answers unknown{app_unreachable}', async () => {
    vi.spyOn(relay, 'queueCommand').mockRejectedValue(new Error('no tab'));
    const res = await createRelayHandlers(relay).pageHealth();
    expect(res.success).toBe(true);
    expect(res.data?.status).toBe('unknown');
    if (res.data?.status === 'unknown') expect(res.data.unknown.code).toBe('app_unreachable');
    expect(JSON.stringify(res)).not.toContain('CRITICAL');
  });

  it('a snapshot with no elements key answers unknown{input_missing}', async () => {
    vi.spyOn(relay, 'queueCommand').mockResolvedValue({ timestamp: T } as never);
    const res = await createRelayHandlers(relay).pageHealth();
    expect(res.data?.status).toBe('unknown');
    if (res.data?.status === 'unknown') expect(res.data.unknown.code).toBe('input_missing');
  });
});
