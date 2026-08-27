/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';

// Mock react-native before importing the hook so StyleSheet.flatten exists.
vi.mock('react-native', () => ({
  StyleSheet: {
    flatten: (style: unknown) => style ?? undefined,
  },
  PixelRatio: {
    get: () => 1,
  },
}));

import { useUIElement, useUIElementWithProps } from '../useUIElement';
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

// Module-level so the provider's `features` / `config` props keep a stable
// identity across `rerender()`. Passing inline `{}` literals lets the provider's
// context memo produce a new value on every render of the wrapper, which makes
// the auto-register effect (deps include `bridge`) unregister + re-register the
// element each time — a harness artifact that would drown out the publish
// counts these tests assert on. Real apps mount the provider above the
// component whose label changes, so it does not re-render with it.
const STABLE_FEATURES = {} as const;
const STABLE_CONFIG = {} as const;

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <UIBridgeNativeProvider features={STABLE_FEATURES} config={STABLE_CONFIG}>
      {children}
    </UIBridgeNativeProvider>
  );
}

function useElementWithRegistry(id: string, label: string) {
  const element = useUIElement({ id, type: 'view', label });
  const bridge = useUIBridgeNative();
  return { element, registry: bridge.registry };
}

function useElementWithPropsAndRegistry(id: string, label: string) {
  const element = useUIElementWithProps({ id, type: 'view', label });
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

/**
 * Automatic label republish — the SDK-side fix for "bridge labels freeze at
 * mount".
 *
 * `register()` publishes `label` exactly once and is guarded by
 * `registeredRef.current`, while the auto-register effect only re-runs on
 * `[autoRegister, bridge, id]`. Before this, a consumer whose label was
 * derived from state (qontinui-mobile's `SummaryCard`:
 * `${title}: ${error ? 'error' : loading ? 'loading' : value}`) left the
 * registry holding the mount-time string forever unless it ALSO remembered to
 * call `updateLabel`. Five `operations-card-*` elements reported
 * `Questions: loading` indefinitely while the card beside them rendered `100`.
 *
 * Coverage:
 *  1. A changed `label` option reaches the registry with NO manual call.
 *  2. `accessibilityLabel` follows it; `testId` does not drift.
 *  3. A re-render that rebuilds an EQUAL label string publishes nothing — the
 *     identity trap (an inline template literal is a new value every render).
 *  4. A consumer that still calls `updateLabel(label)` itself stays idempotent
 *     and silent — no flicker, no duplicate entry, no redundant-call warning.
 *  5. `useUIElementWithProps` inherits the behaviour (it delegates).
 */
describe('useUIElement — automatic label republish', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('re-publishes the registry label when the `label` option changes', () => {
    const id = 'operations-card-questions';
    const { result, rerender } = renderHook(
      ({ label }: { label: string }) => useElementWithRegistry(id, label),
      { wrapper: Wrapper, initialProps: { label: 'Questions: loading' } }
    );

    expect(result.current.registry.getElement(id)?.label).toBe('Questions: loading');

    // The data lands. No `updateLabel` call anywhere in this test.
    rerender({ label: 'Questions: 100' });

    const stored = result.current.registry.getElement(id);
    expect(stored?.label).toBe('Questions: 100');
    // a11y follows — this is what TalkBack reads.
    expect(stored?.getIdentifier().accessibilityLabel).toBe('Questions: 100');
    // testId is the element id, not a derived value — it must not drift.
    expect(stored?.getIdentifier().testId).toBe(id);
  });

  it('publishes nothing when a re-render rebuilds an equal label string', () => {
    const id = 'operations-card-fleet';
    const { result, rerender } = renderHook(
      ({ value }: { value: number }) =>
        // Rebuilt every render — a fresh string identity each time, same text.
        useElementWithRegistry(id, `Fleet: ${value}`),
      { wrapper: Wrapper, initialProps: { value: 7 } }
    );

    expect(result.current.registry.getElement(id)?.label).toBe('Fleet: 7');

    const published: unknown[] = [];
    const unsub = result.current.registry.on('element:registered', (e) => published.push(e.data));

    rerender({ value: 7 });
    rerender({ value: 7 });
    expect(published).toHaveLength(0);

    // …and a real change still gets through.
    rerender({ value: 8 });
    unsub();
    expect(published).toHaveLength(1);
    expect(result.current.registry.getElement(id)?.label).toBe('Fleet: 8');
  });

  it('stays idempotent and silent for consumers that still call updateLabel themselves', () => {
    const id = 'operations-card-alerts';
    const { result, rerender } = renderHook(
      ({ label }: { label: string }) => {
        const hook = useElementWithRegistry(id, label);
        // The old `useUpdateLabelOnChange` pattern, inlined.
        useEffect(() => {
          hook.element.updateLabel(label);
        }, [hook.element, label]);
        return hook;
      },
      { wrapper: Wrapper, initialProps: { label: 'Alerts: loading' } }
    );

    const published: unknown[] = [];
    const unsub = result.current.registry.on('element:registered', (e) => published.push(e.data));

    rerender({ label: 'Alerts: 3' });
    unsub();

    // Exactly ONE publish for the change — the SDK's and the consumer's calls
    // collapse into a single registry mutation.
    expect(published).toHaveLength(1);
    expect(result.current.registry.getElement(id)?.label).toBe('Alerts: 3');
    // The redundant-call warning must not fire on a call site that was correct
    // before this change.
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('applies to useUIElementWithProps as well', () => {
    const id = 'account-usage-row--tokens';
    const { result, rerender } = renderHook(
      ({ label }: { label: string }) => useElementWithPropsAndRegistry(id, label),
      { wrapper: Wrapper, initialProps: { label: 'Tokens: loading' } }
    );

    rerender({ label: 'Tokens: 12,004' });

    const stored = result.current.registry.getElement(id);
    expect(stored?.label).toBe('Tokens: 12,004');
    expect(stored?.getIdentifier().accessibilityLabel).toBe('Tokens: 12,004');
  });
});
