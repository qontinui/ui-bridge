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
// An all-invisible snapshot — "could not see" is not "the page is broken"
// ----------------------------------------------------------------------------

/**
 * Element states copied (computedStyles/dataset dropped, nothing else edited)
 * from the genuine live capture
 * `qontinui-schemas/rust/tests/fixtures/ui_bridge_sdk/runner_live_sdk_0_27_0_control_snapshot.json`:
 * every element reports `visible: false` — one opacity-hidden, two fully
 * occluded by an unregistered `div.min-h-screen`. 0.31.0 answered `measured`
 * with a CRITICAL report over ZERO considered elements for exactly this.
 */
function liveCaptureInvisibleElements(): DiscoveredElement[] {
  const base = { actions: [], registered: true, category: 'interactive' };
  return [
    {
      ...base,
      id: 'terminal-input-b0fdb56e-3708-4446-9e17-b73fa7aa3ff9',
      type: 'input',
      tagName: 'textarea',
      state: {
        enabled: false,
        focused: false,
        inViewport: false,
        normalizedRect: {
          height: 0.000942507068803016,
          width: 0.0005208333333333333,
          x: -5.103645833333333,
          y: 0.05089538171536286,
        },
        opacityHidden: true,
        visibilityReason: 'hidden',
        visible: false,
      },
    },
    {
      ...base,
      id: 'button-workspace',
      type: 'button',
      tagName: 'button',
      state: {
        enabled: true,
        focused: false,
        inViewport: true,
        normalizedRect: {
          height: 0.02544769085768143,
          width: 0.0953125,
          x: 0.004166666666666667,
          y: 0.04241281809613572,
        },
        occludedBy: 'div.min-h-screen',
        occludedPct: 100,
        textContent: 'WORKSPACE',
        visibilityReason: 'occluded',
        visible: false,
      },
    },
    {
      ...base,
      id: 'nav:projects',
      type: 'button',
      tagName: 'button',
      state: {
        enabled: true,
        focused: false,
        inViewport: true,
        normalizedRect: {
          height: 0.033930254476908575,
          width: 0.0953125,
          x: 0.004166666666666667,
          y: 0.07163053722902922,
        },
        occludedBy: 'div.min-h-screen',
        occludedPct: 100,
        textContent: 'Projects',
        visibilityReason: 'occluded',
        visible: false,
      },
    },
  ] as unknown as DiscoveredElement[];
}

function stateless(id: string): DiscoveredElement {
  return {
    id,
    type: 'paragraph',
    tagName: 'p',
    actions: [],
    registered: true,
    category: 'content',
  } as unknown as DiscoveredElement;
}

describe('diagnosePageHealth — elements exist, none can be placed on screen', () => {
  it('every element visible:false (the live capture) → unknown{input_missing}, no CRITICAL', () => {
    const obs = diagnosePageHealth({
      elements: liveCaptureInvisibleElements(),
      registeredComponents: 2,
      observedAt: T,
    });
    expect(obs.status).toBe('unknown');
    expect('value' in obs).toBe(false);
    if (obs.status === 'unknown') {
      expect(obs.unknown.code).toBe('input_missing');
      // Visibility WAS measured — the detail says what hid every element.
      expect(obs.unknown.detail).toContain('hidden=1');
      expect(obs.unknown.detail).toContain('occluded=2');
    }
    // Nothing was on screen to consider; nothing is claimed about the page.
    expect(obs.provenance.coverage).toEqual({ considered: 0, measured: 0, unmeasured: [] });
    const text = JSON.stringify(obs);
    expect(text).not.toContain('CRITICAL');
    expect(text).not.toContain('unhealthy');
  });

  it('elements that never stated visibility → unknown{input_missing} naming the visibility dimension', () => {
    const obs = diagnosePageHealth({
      elements: [stateless('a'), stateless('b'), stateless('c')],
      registeredComponents: 1,
      observedAt: T,
    });
    expect(obs.status).toBe('unknown');
    if (obs.status === 'unknown') expect(obs.unknown.code).toBe('input_missing');
    expect(obs.provenance.coverage).toEqual({
      considered: 3,
      measured: 0,
      unmeasured: [{ dimension: 'visibility', count: 3, code: 'input_missing' }],
    });
    expect(JSON.stringify(obs)).not.toContain('CRITICAL');
    if (obs.status === 'unknown') expect(obs.unknown.detail).not.toContain('none of the 0');
  });

  it('hidden + visibility-unstated + rectless-visible, none placeable → unknown with both dimensions', () => {
    const obs = diagnosePageHealth({
      elements: [...liveCaptureInvisibleElements(), stateless('s'), visibleEl('v', null)],
      registeredComponents: 1,
      observedAt: T,
    });
    expect(obs.status).toBe('unknown');
    expect(obs.provenance.coverage).toEqual({
      considered: 2,
      measured: 0,
      unmeasured: [
        { dimension: 'geometry', count: 1, code: 'input_missing' },
        { dimension: 'visibility', count: 1, code: 'input_missing' },
      ],
    });
  });

  it('a mixed snapshot is still measured, its gaps counted per dimension', () => {
    const r = { x: 0.3, y: 0.3, width: 0.3, height: 0.3 };
    const obs = diagnosePageHealth({
      elements: [
        visibleEl('a', r),
        visibleEl('b', { ...r, y: 0.6 }),
        visibleEl('no-rect', null),
        stateless('unstated'),
        ...liveCaptureInvisibleElements(),
      ],
      registeredComponents: 1,
      observedAt: T,
    });
    expect(obs.status).toBe('measured');
    expect(obs.provenance.coverage).toEqual({
      considered: 4,
      measured: 2,
      unmeasured: [
        { dimension: 'geometry', count: 1, code: 'input_missing' },
        { dimension: 'visibility', count: 1, code: 'input_missing' },
      ],
    });
    if (obs.status === 'measured') {
      expect(obs.value.element_count).toBe(7);
      expect(obs.value.visible_count).toBe(2);
    }
  });

  it('the in-page handler answers the all-invisible snapshot as unknown, never unhealthy', async () => {
    const handlers = createHandlers(
      registryReturning({
        timestamp: T,
        snapshotId: 'snap_invisible',
        elements: liveCaptureInvisibleElements(),
        components: [{}, {}],
        workflows: [],
      }),
      executor as never,
      NO_IDLE
    );
    const res = await handlers.pageHealth();
    expect(res.success).toBe(true);
    expect(res.data?.status).toBe('unknown');
    if (res.data?.status === 'unknown') expect(res.data.unknown.code).toBe('input_missing');
    expect(res.data?.provenance.source).toEqual({ snapshotId: 'snap_invisible' });
    expect(JSON.stringify(res)).not.toContain('CRITICAL');
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

  it('carries the snapshot id the registry stamped as provenance.source', async () => {
    const handlers = createHandlers(
      registryReturning({
        timestamp: T,
        snapshotId: 'snap_123',
        elements: [visibleEl('a', { x: 0.3, y: 0.3, width: 0.3, height: 0.3 })],
        components: [],
        workflows: [],
      }),
      executor as never,
      NO_IDLE
    );
    const res = await handlers.pageHealth();
    expect(res.data?.status).toBe('measured');
    expect(res.data?.provenance.source).toEqual({ snapshotId: 'snap_123' });
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
    expect(queue).toHaveBeenCalledWith('getControlSnapshot', {}, undefined);
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

  it('the reason follows the LATEST refresh: malformed then unreachable answers app_unreachable', async () => {
    const queue = vi
      .spyOn(relay, 'queueCommand')
      .mockResolvedValueOnce({ timestamp: T } as never)
      .mockRejectedValueOnce(new Error('no tab'));
    const handlers = createRelayHandlers(relay);
    const first = await handlers.pageHealth();
    expect(first.data?.status).toBe('unknown');
    expect(first.data?.status === 'unknown' && first.data.unknown.code).toBe('input_missing');
    const second = await handlers.pageHealth();
    expect(queue).toHaveBeenCalledTimes(2);
    expect(second.data?.status).toBe('unknown');
    expect(second.data?.status === 'unknown' && second.data.unknown.code).toBe('app_unreachable');
  });

  // The getControlSnapshot write site and the clear-on-good-refresh writes of
  // the refresh reason are defensive (see `lastRefreshFailure` in
  // relay-handlers.ts): page health reads the reason only over an empty cache,
  // which forces its own refresh. These pin that consequence.
  it('a malformed getControlSnapshot does not leak into page health: its own refresh decides', async () => {
    // A tab is attached, so getControlSnapshot dispatches instead of answering from cache.
    vi.spyOn(relay, 'hasCommandListeners').mockReturnValue(true);
    const queue = vi
      .spyOn(relay, 'queueCommand')
      .mockResolvedValueOnce({ timestamp: T } as never)
      .mockRejectedValueOnce(new Error('no tab'));
    const handlers = createRelayHandlers(relay);
    const snap = await handlers.getControlSnapshot();
    expect(snap.success).toBe(true);
    expect(snap._meta?.stale).toBe(true);
    const health = await handlers.pageHealth();
    expect(queue).toHaveBeenCalledTimes(2);
    expect(health.data?.status).toBe('unknown');
    expect(health.data?.status === 'unknown' && health.data.unknown.code).toBe('app_unreachable');
  });

  it('a malformed getControlSnapshot followed by a malformed refresh still answers input_missing', async () => {
    // A tab is attached, so getControlSnapshot dispatches instead of answering from cache.
    vi.spyOn(relay, 'hasCommandListeners').mockReturnValue(true);
    vi.spyOn(relay, 'queueCommand').mockResolvedValue({ timestamp: T } as never);
    const handlers = createRelayHandlers(relay);
    await handlers.getControlSnapshot();
    const health = await handlers.pageHealth();
    expect(health.data?.status).toBe('unknown');
    expect(health.data?.status === 'unknown' && health.data.unknown.code).toBe('input_missing');
  });

  it('malformed, then a GOOD empty refresh, leaves no stale reason: producer_not_run, then app_unreachable on failure', async () => {
    const queue = vi
      .spyOn(relay, 'queueCommand')
      .mockResolvedValueOnce({ timestamp: T } as never)
      .mockResolvedValueOnce({ timestamp: T, elements: [], components: [], workflows: [] } as never)
      .mockRejectedValueOnce(new Error('no tab'));
    const handlers = createRelayHandlers(relay);
    const malformed = await handlers.pageHealth();
    expect(malformed.data?.status === 'unknown' && malformed.data.unknown.code).toBe(
      'input_missing'
    );
    const good = await handlers.pageHealth();
    expect(good.data?.status).toBe('unknown');
    expect(good.data?.status === 'unknown' && good.data.unknown.code).toBe('producer_not_run');
    const failed = await handlers.pageHealth();
    expect(queue).toHaveBeenCalledTimes(3);
    expect(failed.data?.status === 'unknown' && failed.data.unknown.code).toBe('app_unreachable');
  });

  it('a malformed snapshot (no elements key) answers unknown{input_missing}, not app_unreachable — on the SECOND call too', async () => {
    vi.spyOn(relay, 'queueCommand').mockResolvedValue({ timestamp: T } as never);
    const handlers = createRelayHandlers(relay);
    const first = await handlers.pageHealth();
    expect(first.data?.status).toBe('unknown');
    expect(first.data?.status === 'unknown' && first.data.unknown.code).toBe('input_missing');
    // The relay never caches a malformed answer (it keeps the last good
    // snapshot and marks it stale), but the tab DID answer: the second call
    // must still say input_missing rather than rejecting or calling the tab
    // unreachable.
    const second = await handlers.pageHealth();
    expect(second.success).toBe(true);
    expect(second.data?.status).toBe('unknown');
    expect(second.data?.status === 'unknown' && second.data.unknown.code).toBe('input_missing');
  });

  it('a failed refresh over a populated cache answers unknown{stale_input}, never measured', async () => {
    const queue = vi.spyOn(relay, 'queueCommand').mockResolvedValueOnce({
      timestamp: T,
      elements: [visibleEl('a', { x: 0.3, y: 0.3, width: 0.3, height: 0.3 })],
      components: [],
      workflows: [],
    } as never);
    const handlers = createRelayHandlers(relay);
    const primed = await handlers.pageHealth();
    expect(primed.data?.status).toBe('measured');

    queue.mockRejectedValue(new Error('tab gone'));
    const res = await handlers.pageHealth();
    expect(res.success).toBe(true);
    expect(res.data?.status).toBe('unknown');
    expect(res.data?.status === 'unknown' && res.data.unknown.code).toBe('stale_input');
    expect(res.data?.provenance.observedAt).toBe('2026-09-30T12:00:00.000Z');
    expect(res._meta?.stale).toBe(true);
  });

  // These snapshots carry `timestamp: Date.now()` so the cache is INSIDE its
  // 5 s TTL: only the stale flag, not age, can force the second fetch.
  const freshSnap = () => ({
    timestamp: Date.now(),
    elements: [visibleEl('a', { x: 0.3, y: 0.3, width: 0.3, height: 0.3 })],
    components: [],
    workflows: [],
  });
  const pushChange = (handlers: unknown) =>
    (handlers as { __pushChangeEvent: (e: unknown) => void }).__pushChangeEvent({
      type: 'mutation',
      timestamp: Date.now(),
    });

  it('within the cache TTL and with no change event, a second call does not refetch (control)', async () => {
    const queue = vi.spyOn(relay, 'queueCommand').mockResolvedValue(freshSnap() as never);
    const handlers = createRelayHandlers(relay);
    await handlers.pageHealth();
    const res = await handlers.pageHealth();
    expect(queue).toHaveBeenCalledTimes(1);
    expect(res.data?.status).toBe('measured');
  });

  it('a DOM change event within the cache TTL forces a refresh: a good one answers measured, not stale_input', async () => {
    const queue = vi.spyOn(relay, 'queueCommand').mockResolvedValue(freshSnap() as never);
    const handlers = createRelayHandlers(relay);
    await handlers.pageHealth();
    pushChange(handlers);
    const res = await handlers.pageHealth();
    expect(queue).toHaveBeenCalledTimes(2);
    expect(res.data?.status).toBe('measured');
  });

  it('a malformed refresh over a populated cache is stale_input that says the tab answered', async () => {
    const queue = vi.spyOn(relay, 'queueCommand').mockResolvedValueOnce(freshSnap() as never);
    const handlers = createRelayHandlers(relay);
    await handlers.pageHealth();
    queue.mockResolvedValue({ timestamp: Date.now() } as never);
    pushChange(handlers);
    const res = await handlers.pageHealth();
    expect(queue).toHaveBeenCalledTimes(2);
    expect(res.data?.status === 'unknown' && res.data.unknown.code).toBe('stale_input');
    const detail = res.data?.status === 'unknown' ? res.data.unknown.detail : '';
    expect(detail).toMatch(/malformed control snapshot/);
    expect(detail).not.toMatch(/could not refresh/);
  });

  it('carries the cached snapshot id as provenance.source', async () => {
    vi.spyOn(relay, 'queueCommand').mockResolvedValue({
      timestamp: T,
      snapshotId: 'snap_abc',
      elements: [visibleEl('a', { x: 0.3, y: 0.3, width: 0.3, height: 0.3 })],
      components: [],
      workflows: [],
    } as never);
    const res = await createRelayHandlers(relay).pageHealth();
    expect(res.data?.provenance.source).toEqual({ snapshotId: 'snap_abc' });
  });
});
