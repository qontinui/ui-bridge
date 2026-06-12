/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';

// Mock react-native before importing the hook so StyleSheet.flatten exists.
vi.mock('react-native', () => ({
  StyleSheet: {
    flatten: (style: unknown) => style ?? undefined,
  },
  PixelRatio: {
    get: () => 1,
  },
}));

import { useUIElement } from '../useUIElement';
import { UIBridgeNativeProvider, useUIBridgeNative } from '../UIBridgeNativeProvider';

/**
 * Visibility accuracy for never-attached / detached refs.
 *
 * The registry deliberately seeds `visible: true` at registration so
 * mounted-but-unmeasured elements still appear in `visibleOnly` snapshots
 * (lazy tabs, pre-onLayout gap). That seed is wrong in exactly two cases:
 *
 *   (a) never attached — the hook registered the element but no rendered
 *       node ever received the ref (e.g. `account-usage-empty`, a status
 *       element only rendered in the empty-state branch). Snapshots claimed
 *       `visible: true` for an element that was never on screen.
 *   (b) detached after render — a conditional branch unmounts the node
 *       while the hook stays mounted, leaving stale `visible: true` (and
 *       layout) in the registry.
 *
 * These tests pin the corrections for (a) and (b) AND the non-regression of
 * the deliberate seeding flows: directly-seeded registry elements (test
 * seeding) and attached-but-unmeasured elements keep `visible: true`.
 */

function Wrapper({ children }: { children: ReactNode }) {
  return <UIBridgeNativeProvider>{children}</UIBridgeNativeProvider>;
}

function useElementWithRegistry(id: string) {
  const element = useUIElement({ id, type: 'view' });
  const bridge = useUIBridgeNative();
  return { element, registry: bridge.registry };
}

describe('useUIElement — visibility accuracy for unattached refs', () => {
  it('reports visible:false (snapshot visibility "hidden") for a never-attached ref', () => {
    const { result } = renderHook(() => useElementWithRegistry('never-attached'), {
      wrapper: Wrapper,
    });

    // The ref was never attached to a rendered node — the element is not in
    // the tree, so the registration seed's `visible: true` must be corrected.
    const state = result.current.registry.getElement('never-attached')?.getState();
    expect(state).toBeDefined();
    expect(state?.visible).toBe(false);

    const snapshot = result.current.registry.createSnapshot();
    const snapElement = snapshot.elements.find((e) => e.id === 'never-attached');
    expect(snapElement).toBeDefined();
    expect(snapElement?.state.visible).toBe(false);
    expect(snapElement?.visibility).toBe('hidden');
  });

  it('keeps a directly-seeded registry element (test-seeding flow) visible:true', () => {
    const { result } = renderHook(() => useElementWithRegistry('hook-el'), {
      wrapper: Wrapper,
    });

    // Deliberate seeding path: register straight into the registry, no hook,
    // no ref lifecycle. The optimistic `visible: true` seed must survive.
    result.current.registry.registerElement(
      'seeded-el',
      { current: null },
      {
        type: 'text',
        label: 'Seeded status',
      }
    );

    const state = result.current.registry.getElement('seeded-el')?.getState();
    expect(state?.visible).toBe(true);

    const snapshot = result.current.registry.createSnapshot();
    const snapElement = snapshot.elements.find((e) => e.id === 'seeded-el');
    expect(snapElement?.state.visible).toBe(true);
    // Unmeasured but believed-visible — the loose filter's discriminator.
    expect(snapElement?.visibility).toBe('likely-visible');
  });

  it('flips visible:false when the ref detaches after render, and back on re-attach', () => {
    const { result } = renderHook(() => useElementWithRegistry('branchy-el'), {
      wrapper: Wrapper,
    });

    const registry = result.current.registry;
    const ref = result.current.element.ref as unknown as { current: object | null };

    // Simulate React attaching the node during commit (conditional branch
    // renders the element).
    ref.current = {};
    expect(registry.getElement('branchy-el')?.getState().visible).toBe(true);

    // Simulate React detaching on branch unmount: React writes `null` into
    // object refs when the host node leaves the tree.
    ref.current = null;
    expect(registry.getElement('branchy-el')?.getState().visible).toBe(false);

    // Re-attach (branch renders again) — seed optimism restored; onLayout /
    // measureInWindow refine from here.
    ref.current = {};
    expect(registry.getElement('branchy-el')?.getState().visible).toBe(true);
  });

  it('keeps an attached-but-unmeasured element visible:true (lazy-tab seeding rationale)', () => {
    const { result, rerender } = renderHook(() => useElementWithRegistry('attached-el'), {
      wrapper: Wrapper,
    });

    // Attach a node that has no measureInWindow (test fixture / web): the
    // measure-on-mount effect must NOT mark it hidden — only never-attached
    // refs are corrected.
    (result.current.element.ref as unknown as { current: object | null }).current = {};
    rerender();

    expect(result.current.registry.getElement('attached-el')?.getState().visible).toBe(true);
  });
});
