/**
 * `@qontinui/ui-bridge-server` page-health answers in the Observation
 * envelope (producer `sdk-server/page-health`), and "could not look" is never
 * rendered as "the page is unhealthy".
 *
 * Before plan 2026-09-20-ui-bridge-observations-… Phase 3 the handler read
 * `result.elements ?? []`, so a discover reply with no `elements` key became
 * 0% spatial coverage → a `critical` `low-spatial-coverage` finding →
 * `status: "unhealthy"`; and `if (!nr) continue;` dropped rectless visible
 * elements from the coverage grid uncounted.
 */

import { describe, expect, it } from 'vitest';
import type { DiscoveredElement } from '@qontinui/ui-bridge/control';
import { diagnosePageHealth, SERVER_PAGE_HEALTH_PRODUCER_ID } from './page-health';
import { createHandlers, type ActionExecutorLike, type RegistryLike } from './handlers';

const T = Date.UTC(2026, 8, 30, 12, 0, 0);

function visibleEl(
  id: string,
  rect: { x: number; y: number; width: number; height: number } | null
): DiscoveredElement {
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

function registry(components: unknown[] = []): RegistryLike {
  return {
    getAllElements: () => [],
    getElement: () => undefined,
    getAllComponents: () => components,
    getComponent: () => undefined,
    findElements: () => [],
    createSnapshot: () =>
      ({ elements: [], components, workflows: [], timestamp: T }) as unknown as ReturnType<
        RegistryLike['createSnapshot']
      >,
  };
}

function executorFinding(result: unknown): ActionExecutorLike {
  return {
    executeAction: async () => ({ success: true }) as never,
    find: async () => result as never,
  };
}

describe('diagnosePageHealth (sdk-server) — the envelope', () => {
  it('5 visible elements, 3 without normalizedRect → coverage.unmeasured[0].count === 3', () => {
    const r = { x: 0.3, y: 0.3, width: 0.2, height: 0.1 };
    const obs = diagnosePageHealth({
      elements: [
        visibleEl('a', r),
        visibleEl('b', { ...r, y: 0.5 }),
        visibleEl('c', null),
        visibleEl('d', null),
        visibleEl('e', null),
      ],
      registeredComponents: 1,
      observedAt: T,
    });
    expect(obs.status).toBe('measured');
    expect(obs.provenance.producer.id).toBe(SERVER_PAGE_HEALTH_PRODUCER_ID);
    expect(obs.provenance.coverage).toEqual({
      considered: 5,
      measured: 2,
      unmeasured: [{ dimension: 'geometry', count: 3, code: 'input_missing' }],
    });
    // `status` (the roll-up) lives only inside a measured value.
    if (obs.status === 'measured') {
      expect(obs.value.status).toMatch(/^(healthy|degraded|unhealthy)$/);
      expect(obs.value.stats.visibleElements).toBe(5);
    }
  });

  it('keeps every provenance key present, null where it has nothing to say', () => {
    const body = JSON.parse(
      JSON.stringify(
        diagnosePageHealth({
          elements: [visibleEl('a', { x: 0.2, y: 0.2, width: 0.5, height: 0.5 })],
          registeredComponents: 1,
          observedAt: T,
        })
      )
    );
    const prov = body.provenance;
    for (const k of [
      'producer',
      'observedAt',
      'evaluatedAt',
      'coverage',
      'confidence',
      'cache',
      'source',
    ]) {
      expect(Object.prototype.hasOwnProperty.call(prov, k), k).toBe(true);
    }
    expect(prov.confidence).toBeNull();
    expect(prov.cache).toBeNull();
    expect(prov.source).toBeNull();
    expect(prov.observedAt).toBe('2026-09-30T12:00:00.000Z');
    // The report's own `timestamp` moved into provenance.evaluatedAt.
    expect('timestamp' in body.value).toBe(false);
  });

  it('every visible element without geometry → unknown{input_missing}', () => {
    const obs = diagnosePageHealth({
      elements: [visibleEl('a', null)],
      registeredComponents: 1,
      observedAt: T,
    });
    expect(obs.status).toBe('unknown');
    if (obs.status === 'unknown') expect(obs.unknown.code).toBe('input_missing');
  });
});

describe('pageHealth handler (sdk-server)', () => {
  it('a discover reply of `{}` → success + unknown{input_missing}; "unhealthy" appears nowhere', async () => {
    const handlers = createHandlers(registry([{ id: 'c' }]), executorFinding({}));
    const res = await handlers.pageHealth!();
    expect(res.success).toBe(true);
    expect(res.data?.status).toBe('unknown');
    if (res.data?.status === 'unknown') expect(res.data.unknown.code).toBe('input_missing');
    const text = JSON.stringify(res);
    expect(text).not.toContain('unhealthy');
    expect(text).not.toContain('critical');
    expect(text).not.toContain('low-spatial-coverage');
  });

  it('zero registered components and no elements → unknown{producer_not_run}, not a critical finding', async () => {
    const handlers = createHandlers(registry([]), executorFinding({ elements: [] }));
    const res = await handlers.pageHealth!();
    expect(res.success).toBe(true);
    expect(res.data?.status).toBe('unknown');
    if (res.data?.status === 'unknown') expect(res.data.unknown.code).toBe('producer_not_run');
    expect(JSON.stringify(res)).not.toContain('critical');
  });

  it('a throwing discover → success + unknown{producer_failed} (an unknown is an answer)', async () => {
    const handlers = createHandlers(registry([{ id: 'c' }]), {
      executeAction: async () => ({ success: true }) as never,
      find: async () => {
        throw new Error('discover exploded');
      },
    });
    const res = await handlers.pageHealth!();
    expect(res.success).toBe(true);
    expect(res.data?.status).toBe('unknown');
    if (res.data?.status === 'unknown') {
      expect(res.data.unknown.code).toBe('producer_failed');
      expect(res.data.unknown.detail).toContain('discover exploded');
    }
  });
});
