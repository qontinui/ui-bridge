/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
 * `updateLabel()` — re-publishes the element's label after mount so consumers
 * that derive labels from state (TabButton active-suffix, events-list "N events"
 * count) don't see the registry stuck at the mount-time string.
 *
 * Coverage:
 *  1. Mount-time label lands in the registry (baseline).
 *  2. `updateLabel(newString)` mutates the registry's `label` AND the mirrored
 *     `accessibilityLabel` (a11y stays in sync — the registration call
 *     mirrors them so the update method must too).
 *  3. Calling `updateLabel(sameString)` is a no-op — no extra
 *     `element:registered` event is emitted, console.warn fires exactly once
 *     per id.
 */

function Wrapper({ children }: { children: ReactNode }) {
  return <UIBridgeNativeProvider>{children}</UIBridgeNativeProvider>;
}

function useElementWithRegistry(id: string, label: string) {
  const element = useUIElement({ id, type: 'view', label });
  const bridge = useUIBridgeNative();
  return { element, registry: bridge.registry };
}

describe('useUIElement — updateLabel()', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('publishes the mount-time label to the registry', () => {
    const { result } = renderHook(() => useElementWithRegistry('tab-actions', 'Tab: A'), {
      wrapper: Wrapper,
    });

    const stored = result.current.registry.getElement('tab-actions');
    expect(stored).toBeDefined();
    expect(stored?.label).toBe('Tab: A');
    // accessibilityLabel mirrors `label` at registration time.
    expect(stored?.getIdentifier().accessibilityLabel).toBe('Tab: A');
  });

  it('mutates the registry label + accessibilityLabel when updateLabel is called', () => {
    const { result } = renderHook(() => useElementWithRegistry('tab-actions-2', 'Tab: A'), {
      wrapper: Wrapper,
    });

    expect(result.current.registry.getElement('tab-actions-2')?.label).toBe('Tab: A');

    act(() => {
      result.current.element.updateLabel('Tab: A (active)');
    });

    const stored = result.current.registry.getElement('tab-actions-2');
    expect(stored?.label).toBe('Tab: A (active)');
    expect(stored?.getIdentifier().accessibilityLabel).toBe('Tab: A (active)');
    // testId stays stable — we pass the element id, not a derived value.
    expect(stored?.getIdentifier().testId).toBe('tab-actions-2');
  });

  it('is a no-op when called with the current label (no extra publish, warn once)', () => {
    const { result } = renderHook(() => useElementWithRegistry('tab-actions-3', 'Tab: A'), {
      wrapper: Wrapper,
    });

    // Move the label once so we have a known "current" value to re-assert.
    act(() => {
      result.current.element.updateLabel('Tab: A (active)');
    });
    expect(result.current.registry.getElement('tab-actions-3')?.label).toBe('Tab: A (active)');

    // Subscribe AFTER the change so we don't catch the legitimate mutation.
    const registeredEvents: unknown[] = [];
    const unsub = result.current.registry.on('element:registered', (e) =>
      registeredEvents.push(e.data)
    );

    // First idempotent call — warn fires.
    act(() => {
      result.current.element.updateLabel('Tab: A (active)');
    });

    // Second idempotent call — warn must NOT fire again (once-per-id contract).
    act(() => {
      result.current.element.updateLabel('Tab: A (active)');
    });

    unsub();

    // No element:registered emitted by either no-op call.
    expect(registeredEvents).toHaveLength(0);

    // Warn fired exactly once across both no-op calls.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/no-op/i);
    expect(warnSpy.mock.calls[0][0]).toMatch(/tab-actions-3/);
  });
});
