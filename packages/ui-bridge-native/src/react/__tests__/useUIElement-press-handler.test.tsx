/**
 * @vitest-environment jsdom
 *
 * Phase 1 (plan 2026-05-20-manual-test-remediation) — `useUIElement` must
 * make a press-needing type without an `onPress` a TS error AND emit a
 * runtime `console.warn` if a JS consumer slips through.
 *
 * Background: the /manual-test session on 2026-05-20 found mobile buttons
 * registered via `useUIElement({type:'button', ...})` with no captured
 * `onPress`. The registered element had no handler in `props`, so
 * `POST /control/element/:id/action {"action":"press"}` returned
 * `success:false, error:"No press handler found on element"`.
 *
 * These tests pin both backstops:
 *   1. TS-level discriminated union (compile-time, asserted via
 *      `@ts-expect-error` directives — `npm test` runs through tsc as part
 *      of vitest's transformer).
 *   2. Runtime `console.warn` triggered once per id when registering a
 *      press-needing type without `onPress` reaching the registry.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
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

import { useUIElement, useUIElementWithProps } from '../useUIElement';
import { UIBridgeNativeProvider, useUIBridgeNative } from '../UIBridgeNativeProvider';

function Wrapper({ children }: { children: ReactNode }) {
  return <UIBridgeNativeProvider>{children}</UIBridgeNativeProvider>;
}

describe('useUIElement — press-handler type-tightening (TS-level)', () => {
  // The runtime asserts here are trivial — the real point of this block is
  // to wedge `@ts-expect-error` against compile errors. If a future change
  // accidentally widens the signature back, vitest's transformer (which
  // runs via tsc) will fail on the un-erroring `@ts-expect-error` lines.

  it('rejects type:"button" without handlers.onPress', () => {
    // @ts-expect-error — Phase 1 guard: button requires handlers.onPress
    const opts: Parameters<typeof useUIElement>[0] = {
      id: 'tsd-button-1',
      type: 'button',
    };
    // Smoke: the runtime accepts it (warning fires; see runtime tests below)
    expect(opts.id).toBe('tsd-button-1');
  });

  it('rejects type:"pressable" without handlers.onPress', () => {
    // @ts-expect-error — Phase 1 guard: pressable requires handlers.onPress
    const opts: Parameters<typeof useUIElement>[0] = {
      id: 'tsd-pressable-1',
      type: 'pressable',
    };
    expect(opts.id).toBe('tsd-pressable-1');
  });

  it('accepts type:"button" with handlers.onPress', () => {
    const opts: Parameters<typeof useUIElement>[0] = {
      id: 'tsd-button-ok',
      type: 'button',
      handlers: { onPress: () => {} },
    };
    expect(opts.id).toBe('tsd-button-ok');
  });

  it('accepts type:"input" without handlers (non-press-needing)', () => {
    const opts: Parameters<typeof useUIElement>[0] = {
      id: 'tsd-input',
      type: 'input',
    };
    expect(opts.id).toBe('tsd-input');
  });

  it('accepts type:"text" without handlers (non-press-needing)', () => {
    const opts: Parameters<typeof useUIElement>[0] = {
      id: 'tsd-text',
      type: 'text',
    };
    expect(opts.id).toBe('tsd-text');
  });

  it('accepts type:"list" without handlers (non-press-needing)', () => {
    const opts: Parameters<typeof useUIElement>[0] = {
      id: 'tsd-list',
      type: 'list',
    };
    expect(opts.id).toBe('tsd-list');
  });

  it('accepts useUIElementWithProps with button + no options-level handlers', () => {
    // The escape hatch: captureProps is called from the render body.
    const opts: Parameters<typeof useUIElementWithProps>[0] = {
      id: 'tsd-with-props',
      type: 'button',
    };
    expect(opts.id).toBe('tsd-with-props');
  });
});

describe('useUIElement — press-handler runtime warning', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.useRealTimers();
  });

  it('warns when a button is registered without onPress', () => {
    // Bypass the TS narrowing intentionally — the runtime check exists for
    // JS consumers + `as any` escape hatches.
    const opts = { id: 'dead-button-1', type: 'button' as const };
    renderHook(
      () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        useUIElement(opts as any),
      { wrapper: Wrapper }
    );

    // Warning is deferred via setTimeout(0); advance timers to flush.
    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = warnSpy.mock.calls[0]?.[0] as string;
    expect(msg).toContain('dead-button-1');
    expect(msg).toContain('button');
    expect(msg).toContain('useUIElementWithProps');
    expect(msg).toContain('captureProps');
    expect(msg).toContain('onPress');
  });

  it('warns when a pressable is registered without onPress', () => {
    const opts = { id: 'dead-pressable-1', type: 'pressable' as const };
    renderHook(
      () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        useUIElement(opts as any),
      { wrapper: Wrapper }
    );

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = warnSpy.mock.calls[0]?.[0] as string;
    expect(msg).toContain('dead-pressable-1');
    expect(msg).toContain('pressable');
  });

  it('does NOT warn when a button is registered with handlers.onPress', () => {
    renderHook(
      () =>
        useUIElement({
          id: 'live-button-1',
          type: 'button',
          handlers: { onPress: () => {} },
        }),
      { wrapper: Wrapper }
    );

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does NOT warn for non-press-needing types', () => {
    renderHook(
      () =>
        useUIElement({
          id: 'just-text-1',
          type: 'text',
        }),
      { wrapper: Wrapper }
    );

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does NOT warn when useUIElementWithProps captures onPress', () => {
    function useTestHook() {
      const result = useUIElementWithProps({
        id: 'with-props-onpress-1',
        type: 'button',
      });
      // Synchronously capture onPress — same pattern as
      // `qontinui-mobile/app/(auth)/login.tsx:109-110`.
      result.captureProps({ onPress: () => {} });
      return result;
    }
    renderHook(useTestHook, { wrapper: Wrapper });

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns only ONCE per id even across remounts', () => {
    const opts = { id: 'dedup-id-1', type: 'button' as const };

    const { unmount } = renderHook(
      () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        useUIElement(opts as any),
      { wrapper: Wrapper }
    );
    act(() => {
      vi.advanceTimersByTime(1);
    });
    unmount();

    // Re-register same id on a fresh provider — module-level dedupe should
    // still suppress.
    renderHook(
      () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        useUIElement(opts as any),
      { wrapper: Wrapper }
    );
    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('verifies a press-needing element with captured onPress lands in registry props', () => {
    function useTestHook() {
      const result = useUIElementWithProps({
        id: 'registry-check-1',
        type: 'button',
      });
      const bridge = useUIBridgeNative();
      result.captureProps({ onPress: () => {} });
      return { result, registry: bridge.registry };
    }
    const { result } = renderHook(useTestHook, { wrapper: Wrapper });

    const element = result.current.registry.getElement('registry-check-1');
    expect(element).toBeDefined();
    expect(typeof element?.props?.onPress).toBe('function');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
