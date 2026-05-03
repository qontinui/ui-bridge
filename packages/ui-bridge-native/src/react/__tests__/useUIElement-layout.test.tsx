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
import {
  UIBridgeNativeProvider,
  useUIBridgeNative,
} from '../UIBridgeNativeProvider';

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
 */
function useElementWithRegistry(id: string) {
  const element = useUIElement({ id, type: 'pressable' });
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
      measureInWindow(
        cb: (pageX: number, pageY: number, w: number, h: number) => void
      ) {
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
    const measure = vi.fn(
      (cb: (x: number, y: number, w: number, h: number) => void) => {
        measureCalls++;
        cb(100, 200, 60, 40);
      }
    );

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
});
