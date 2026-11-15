/**
 * `aiSemanticSearch` scans every registered element.
 *
 * Since 29a851e9 it searches over a semantic snapshot (so the `element` it
 * re-emits is §4.6-branded by ui-bridge's converter). That snapshot came from
 * the handlers' shared `SemanticSnapshotManager`, whose default caps a snapshot
 * at 500 elements, so a label on element 501+ was never matched and
 * `scannedCount` read 500 on a larger page.
 */

import { describe, expect, it } from 'vitest';
import type { DiscoveredElement } from '@qontinui/ui-bridge/control';
import { createHandlers, type ActionExecutorLike, type RegistryLike } from './handlers';

const COUNT = 600;

function button(i: number): DiscoveredElement {
  return {
    id: `b${i}`,
    type: 'button',
    label: `Item ${i}`,
    tagName: 'button',
    actions: ['click'],
    registered: true,
    state: { visible: true, enabled: true, focused: false, textContent: `Item ${i}` },
  } as unknown as DiscoveredElement;
}

function registry(): RegistryLike {
  const elements = Array.from({ length: COUNT }, (_, i) => button(i));
  return {
    getAllElements: () => elements,
    getElement: (id: string) => elements.find((e) => e.id === id),
    getAllComponents: () => [],
    getComponent: () => undefined,
    findElements: () => [],
    createSnapshot: () =>
      ({ elements, components: [], workflows: [], timestamp: 0 }) as unknown as ReturnType<
        RegistryLike['createSnapshot']
      >,
  } as unknown as RegistryLike;
}

const executor: ActionExecutorLike = {
  executeAction: async () => ({ success: true }) as never,
};

describe('aiSemanticSearch scan width', () => {
  it('scans every element and finds a match past the 500th', async () => {
    const handlers = createHandlers(registry(), executor);
    const res = (await handlers.aiSemanticSearch!({ query: 'item 599' })) as {
      success: boolean;
      data?: { scannedCount: number; results: Array<{ element: { id: string } }> };
    };
    expect(res.success).toBe(true);
    expect(res.data!.scannedCount).toBe(COUNT);
    expect(res.data!.results.some((r) => r.element.id === 'b599')).toBe(true);
  });
});
