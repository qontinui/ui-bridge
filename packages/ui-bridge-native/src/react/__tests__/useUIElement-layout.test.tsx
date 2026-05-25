/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';

// Mock react-native before importing the hook so StyleSheet.flatten exists.
vi.mock('react-native', () => ({
  StyleSheet: {
    flatten: (style: unknown) => style ?? undefined,
  },
}));

import { useUIElement } from '../useUIElement';
import { UIBridgeNativeProvider, useUIBridgeNative } from '../UIBridgeNativeProvider';

/**
 * Phase F regression — `useUIElement` should populate the registry's
 * `layout` field on (or near) mount, not lazily on first action.
 *
 * The bug being regressed against: snapshots showed `layout: null` and
 * coords as `(?, ?)` until the element was tapped. Two compounding causes:
 *   1. The `onLayout` callback's closure captured `registered === false`
 *      (the React-state flag), and the first event silently dropped.
 *   2. Some consumers don't thread `onLayout` onto the underlying RN
 *      component at all — for those, a `measureInWindow` fallback should
 *      run on mount via the ref.
 *
 * These tests verify both paths against the real provider's registry.
 */

function Wrapper({ children }: { children: ReactNode }) {
  return <UIBridgeNativeProvider>{children}</UIBridgeNativeProvider>;
}

/**
 * Combine `useUIElement` with `useUIBridgeNative` so the test can both drive
 * the hook's outputs and inspect the underlying registry that the provider
 * created internally.
 *
 * Uses `type: 'view'` (non-press-needing) so the test isn't entangled with
 * the press-handler-required type-tightening landed in Phase 1 of plan
 * `2026-05-20-manual-test-remediation`. The layout-on-mount behavior under
 * test is type-agnostic; switching to `'view'` keeps the fixture honest.
 */
function useElementWithRegistry(id: string) {
  const element = useUIElement({ id, type: 'view' });
  const bridge = useUIBridgeNative();
  return { element, registry: bridge.registry };
}

function useInputWithRegistry(id: string, value?: string) {
  const element = useUIElement({ id, type: 'input', value });
  const bridge = useUIBridgeNative();
  return { element, registry: bridge.registry };
}

describe('useUIElement — layout populated on mount', () => {
  it('writes layout to the registry when onLayout fires immediately on mount', () => {
    const { result } = renderHook(() => useElementWithRegistry('el-1'), {
      wrapper: Wrapper,
    });

    // Simulate RN firing the very first onLayout. measureInWindow on the ref
    // is unset in this fixture, so the hook takes the fallback path that
    // writes layout from the event's relative coords.
    act(() => {
      result.current.element.onLayout({
        nativeEvent: { layout: { x: 10, y: 20, width: 100, height: 30 } },
      });
    });

    const stored = result.current.registry.getElement('el-1');
    expect(stored).toBeDefined();
    const layout = stored?.getState().layout;
    expect(layout).not.toBeNull();
    expect(layout).toMatchObject({ x: 10, y: 20, width: 100, height: 30 });
  });

  it('uses measureInWindow on the ref when available (absolute coords)', () => {
    const { result } = renderHook(() => useElementWithRegistry('el-2'), {
      wrapper: Wrapper,
    });

    // Stub the ref's measureInWindow so the onLayout path takes the absolute-
    // coord branch and writes pageX/pageY.
    (result.current.element.ref as unknown as { current: object }).current = {
      measureInWindow(cb: (pageX: number, pageY: number, w: number, h: number) => void) {
        cb(500, 600, 100, 30);
      },
    };

    act(() => {
      result.current.element.onLayout({
        nativeEvent: { layout: { x: 0, y: 0, width: 100, height: 30 } },
      });
    });

    const layout = result.current.registry.getElement('el-2')?.getState().layout;
    expect(layout).toMatchObject({
      x: 0,
      y: 0,
      width: 100,
      height: 30,
      pageX: 500,
      pageY: 600,
    });
  });

  it('falls back to measureInWindow on mount when consumer never calls onLayout', () => {
    let measureCalls = 0;
    const measure = vi.fn((cb: (x: number, y: number, w: number, h: number) => void) => {
      measureCalls++;
      cb(100, 200, 60, 40);
    });

    const { result, rerender } = renderHook(() => useElementWithRegistry('el-3'), {
      wrapper: Wrapper,
    });

    // After initial mount, attach measureInWindow to the ref the hook owns.
    // The post-registration effect re-fires when the ref is non-null on a
    // re-render with `registered = true`.
    (result.current.element.ref as unknown as { current: object }).current = {
      measureInWindow: measure,
    };

    // Trigger a re-render so React re-runs the layout-on-mount effect.
    act(() => {
      rerender();
    });

    expect(measureCalls).toBeGreaterThanOrEqual(1);
    const layout = result.current.registry.getElement('el-3')?.getState().layout;
    expect(layout).not.toBeNull();
    expect(layout).toMatchObject({ width: 60, height: 40, pageX: 100, pageY: 200 });
  });

  it('retries measureInWindow with backoff when first calls return zero dims', () => {
    vi.useFakeTimers();
    try {
      // Simulate the lazy-tab / overlay-covered case: the first two measures
      // return zeros (subtree not yet laid out), then the third succeeds.
      let call = 0;
      const measure = vi.fn((cb: (x: number, y: number, w: number, h: number) => void) => {
        call++;
        if (call <= 2) cb(0, 0, 0, 0);
        else cb(40, 60, 200, 50);
      });

      const { result, rerender } = renderHook(() => useElementWithRegistry('el-4'), {
        wrapper: Wrapper,
      });

      (result.current.element.ref as unknown as { current: object }).current = {
        measureInWindow: measure,
      };

      // Re-render so the post-registration effect re-runs with the ref attached.
      act(() => {
        rerender();
      });

      // First attempt fired synchronously — zeros, no write yet.
      expect(measure).toHaveBeenCalledTimes(1);
      expect(result.current.registry.getElement('el-4')?.getState().layout).toBeNull();

      // Backoff[0] = 50ms → second attempt, still zeros.
      act(() => {
        vi.advanceTimersByTime(50);
      });
      expect(measure).toHaveBeenCalledTimes(2);
      expect(result.current.registry.getElement('el-4')?.getState().layout).toBeNull();

      // Backoff[1] = 200ms → third attempt succeeds, layout writes.
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(measure).toHaveBeenCalledTimes(3);
      const layout = result.current.registry.getElement('el-4')?.getState().layout;
      expect(layout).toMatchObject({ width: 200, height: 50, pageX: 40, pageY: 60 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops retrying after the configured backoff schedule is exhausted', () => {
    vi.useFakeTimers();
    try {
      const measure = vi.fn((cb: (x: number, y: number, w: number, h: number) => void) => {
        cb(0, 0, 0, 0);
      });

      const { result, rerender } = renderHook(() => useElementWithRegistry('el-5'), {
        wrapper: Wrapper,
      });

      (result.current.element.ref as unknown as { current: object }).current = {
        measureInWindow: measure,
      };

      act(() => {
        rerender();
      });

      // Run far past the longest backoff (50 + 200 + 500 + 1000 + 2500 = 4250ms)
      // to confirm the retry chain terminates instead of looping forever.
      act(() => {
        vi.advanceTimersByTime(10_000);
      });

      // 1 immediate attempt + 5 scheduled retries = 6 total.
      expect(measure).toHaveBeenCalledTimes(6);
      expect(result.current.registry.getElement('el-5')?.getState().layout).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * Item C — RN snapshot visibility computed from the MEASURED layout rect.
 *
 * Regression: content elements (Text / flex children) fire `onLayout` with
 * transient zero dimensions before the subtree settles. The old code computed
 * `visible` straight from the onLayout event's width/height, stamping
 * `visible:false` onto every content element — so `visibleOnly` returned only
 * the always-sized tab buttons. The fix derives visibility from the
 * `measureInWindow` rect and never downgrades an already-visible element on a
 * transient zero reading.
 */
describe('useUIElement — Item C: layout-derived visibility', () => {
  it('marks an element visible when measureInWindow reports a positive-area rect', () => {
    const { result } = renderHook(() => useElementWithRegistry('content-1'), { wrapper: Wrapper });

    (result.current.element.ref as unknown as { current: object }).current = {
      measureInWindow(cb: (x: number, y: number, w: number, h: number) => void) {
        cb(0, 120, 300, 24);
      },
    };

    act(() => {
      // onLayout event reports its own dims; measured dims are authoritative.
      result.current.element.onLayout({
        nativeEvent: { layout: { x: 0, y: 120, width: 300, height: 24 } },
      });
    });

    const state = result.current.registry.getElement('content-1')?.getState();
    expect(state?.visible).toBe(true);
    expect(state?.layout).toMatchObject({ width: 300, height: 24 });
  });

  it('does NOT downgrade a measured-visible element to hidden on a transient zero onLayout', () => {
    const { result } = renderHook(() => useElementWithRegistry('content-2'), { wrapper: Wrapper });

    // First: a real measurement → visible.
    (result.current.element.ref as unknown as { current: object }).current = {
      measureInWindow(cb: (x: number, y: number, w: number, h: number) => void) {
        cb(0, 0, 200, 40);
      },
    };
    act(() => {
      result.current.element.onLayout({
        nativeEvent: { layout: { x: 0, y: 0, width: 200, height: 40 } },
      });
    });
    expect(result.current.registry.getElement('content-2')?.getState().visible).toBe(true);

    // Then: a transient zero-dim onLayout (subtree reflow). measureInWindow
    // also returns zeros — but we must keep the prior visibility, not strand it.
    (result.current.element.ref as unknown as { current: object }).current = {
      measureInWindow(cb: (x: number, y: number, w: number, h: number) => void) {
        cb(0, 0, 0, 0);
      },
    };
    act(() => {
      result.current.element.onLayout({
        nativeEvent: { layout: { x: 0, y: 0, width: 0, height: 0 } },
      });
    });

    expect(result.current.registry.getElement('content-2')?.getState().visible).toBe(true);
  });
});

/**
 * Item A — controlled input value threaded into element state so a bridge read
 * reflects what the user sees, even before any `type`/`setValue` action.
 */
describe('useUIElement — Item A: controlled value reflected in state', () => {
  it('seeds state.value from the value option on registration', () => {
    const { result } = renderHook(() => useInputWithRegistry('email', 'a@b.test'), {
      wrapper: Wrapper,
    });
    expect(result.current.registry.getElement('email')?.getState().value).toBe('a@b.test');
  });

  it('keeps state.value in sync as the controlled value prop changes', () => {
    let value = 'first';
    const { result, rerender } = renderHook(
      () => useInputWithRegistry('field', value),
      { wrapper: Wrapper }
    );
    expect(result.current.registry.getElement('field')?.getState().value).toBe('first');

    value = 'second';
    act(() => rerender());
    expect(result.current.registry.getElement('field')?.getState().value).toBe('second');
  });

  it('advertises type/setValue/clear on input elements', () => {
    const { result } = renderHook(() => useInputWithRegistry('typed'), { wrapper: Wrapper });
    const actions = result.current.registry.getElement('typed')?.actions ?? [];
    expect(actions).toEqual(expect.arrayContaining(['type', 'setValue', 'clear']));
  });
});
