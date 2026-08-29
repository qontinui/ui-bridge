/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { useReducer, type ReactNode } from 'react';

// Mock react-native before importing the provider so StyleSheet.flatten exists.
vi.mock('react-native', () => ({
  StyleSheet: {
    flatten: (style: unknown) => style ?? undefined,
  },
  PixelRatio: {
    get: () => 1,
  },
  Dimensions: {
    get: () => ({ width: 390, height: 844 }),
  },
}));

import { useUIElement } from '../useUIElement';
import { useUIComponent } from '../useUIComponent';
import {
  UIBridgeNativeProvider,
  useUIBridgeNative,
  type UIBridgeNativeContextValue,
} from '../UIBridgeNativeProvider';

/**
 * The provider's context value must survive a provider re-render.
 *
 * `features = {}` / `config = {}` were inline default literals, so an omitted
 * prop minted a fresh object on every render, `Object.is` failed for the first
 * two entries of the `contextValue` `useMemo` deps, and the context value was
 * NEW every time the provider rendered.
 *
 * That is not cosmetic. `useUIElement`'s auto-register effect has deps
 * `[autoRegister, bridge, id]` where `bridge` IS the context value, and its
 * cleanup runs a real `registry.unregisterElement` followed by a full
 * `registerElement` — not an in-place mutate. So any host with a `useState` in
 * the layout that mounts the provider churned its entire element registry on
 * every state change: every id torn down and rebuilt, dropping registered
 * handlers and layout for the gap. `useUIComponent` (deps `[autoRegister,
 * bridge]`) had the identical exposure, and is covered here for that reason.
 *
 * Two lanes have to hold, and only one of them is fixed by stable defaults:
 *
 *   - the host that OMITS the props — closed by `EMPTY_FEATURES`/`EMPTY_CONFIG`;
 *   - the host that passes INLINE LITERALS, which is what this component's own
 *     usage example tells hosts to do (`features={{ server: __DEV__ }}`) and so
 *     the lane that actually matters — closed by `useValueStable`.
 *
 * Both are asserted below. A fix that only did the first would leave the
 * documented pattern churning exactly as before.
 *
 * The workaround this defect forced is still visible elsewhere in the suite:
 * `useUIElement-label.test.tsx` hoists `STABLE_FEATURES` / `STABLE_CONFIG` to
 * module constants so the churn would not "drown out the publish counts these
 * tests assert on", and `useUIElement-layout.test.tsx` used to attach a ref
 * after mount and call `rerender()` to make an effect re-fire — which only
 * worked because `bridge` changed identity every render.
 */

/**
 * Mounts `Child` under a provider that is given NO `features` / `config` props
 * — the case the inline defaults broke — and hands back a way to re-render the
 * provider.
 *
 * `<Child />` is constructed INSIDE `Host`'s render, deliberately. Hoisting the
 * element to a stable reference would let React bail out of re-rendering the
 * subtree whenever the context value did not change, so every assertion below
 * would hold for the trivial reason that the child never rendered again —
 * exactly the false pass this file exists to rule out. A fresh element each
 * render means the child genuinely re-renders both before and after the fix,
 * and only the context identity is under test.
 */
function makeHarness(Child: () => ReactNode, inlineProps = false) {
  let forceRender!: () => void;

  function Host() {
    // `useReducer` rather than `useState` only because the tick VALUE is never
    // read — the render itself is the whole point — and a discarded useState
    // value trips `@eslint-react/use-state`.
    const [, bump] = useReducer((n: number) => n + 1, 0);
    forceRender = bump;
    // When `inlineProps`, both objects are freshly allocated on every render —
    // the documented usage, and the lane stable defaults do NOT cover.
    return inlineProps ? (
      <UIBridgeNativeProvider features={{ server: false }} config={{ serverPort: 8087 }}>
        <Child />
      </UIBridgeNativeProvider>
    ) : (
      <UIBridgeNativeProvider>
        <Child />
      </UIBridgeNativeProvider>
    );
  }

  return { Host, rerenderProvider: () => act(() => forceRender()) };
}

describe('UIBridgeNativeProvider — context identity across re-renders', () => {
  it('keeps one context value when features/config are omitted', () => {
    const seen: UIBridgeNativeContextValue[] = [];
    function Probe() {
      seen.push(useUIBridgeNative());
      return null;
    }

    const { Host, rerenderProvider } = makeHarness(Probe);
    const { unmount } = render(<Host />);
    rerenderProvider();
    rerenderProvider();

    // The probe really did render again each time (see `makeHarness`) …
    expect(seen.length).toBeGreaterThanOrEqual(3);
    // … and every render saw the SAME context value. Pre-fix each was distinct.
    expect(new Set(seen).size).toBe(1);
    unmount();
  });

  it('keeps one context value when features/config are fresh inline literals', () => {
    const seen: UIBridgeNativeContextValue[] = [];
    function Probe() {
      seen.push(useUIBridgeNative());
      return null;
    }

    const { Host, rerenderProvider } = makeHarness(Probe, true);
    const { unmount } = render(<Host />);
    rerenderProvider();
    rerenderProvider();

    expect(seen.length).toBeGreaterThanOrEqual(3);
    // Stable DEFAULTS alone do not close this lane — only value-keyed identity
    // does. Measured pre-`useValueStable`: 3 distinct values here.
    expect(new Set(seen).size).toBe(1);
    unmount();
  });

  it('does not churn elements when features/config are fresh inline literals', () => {
    let registry: UIBridgeNativeContextValue['registry'] | null = null;

    function Element() {
      registry = useUIBridgeNative().registry;
      useUIElement({ id: 'operations-card-questions', type: 'view', label: 'Questions: 7' });
      return null;
    }

    const { Host, rerenderProvider } = makeHarness(Element, true);
    const { unmount } = render(<Host />);

    const events: string[] = [];
    const off = registry!.on('element:unregistered', () => events.push('unregistered'));

    rerenderProvider();
    rerenderProvider();

    // Measured pre-`useValueStable`: 2 unregister events.
    expect(events).toEqual([]);
    expect(registry!.getElement('operations-card-questions')).toBeDefined();

    off();
    unmount();
  });

  it('still produces a NEW context value when the options actually change', () => {
    // The stabiliser must not be a freeze: a real change has to propagate, or
    // toggling `features.server` at runtime would never reach the consumers.
    const seen: UIBridgeNativeContextValue[] = [];
    let setServer!: (v: boolean) => void;

    function Probe() {
      seen.push(useUIBridgeNative());
      return null;
    }

    function Host() {
      const [server, setServerState] = useReducer((_: boolean, v: boolean) => v, false);
      setServer = setServerState;
      return (
        <UIBridgeNativeProvider features={{ server }}>
          <Probe />
        </UIBridgeNativeProvider>
      );
    }

    const { unmount } = render(<Host />);
    act(() => setServer(true));

    expect(new Set(seen).size).toBeGreaterThan(1);
    expect(seen.at(-1)?.features.server).toBe(true);
    unmount();
  });

  it('does not unregister/re-register elements when the provider re-renders', () => {
    let registry: UIBridgeNativeContextValue['registry'] | null = null;

    function Element() {
      registry = useUIBridgeNative().registry;
      useUIElement({ id: 'operations-card-fleet', type: 'view', label: 'Fleet: 3' });
      return null;
    }

    const { Host, rerenderProvider } = makeHarness(Element);
    const { unmount } = render(<Host />);

    // Subscribe AFTER the initial mount so only re-render churn is counted.
    const events: string[] = [];
    const off = registry!.on('element:unregistered', () => events.push('unregistered'));

    rerenderProvider();
    rerenderProvider();

    expect(events).toEqual([]);
    // …and the element is still there, registered exactly once.
    expect(registry!.getElement('operations-card-fleet')).toBeDefined();

    off();
    unmount();
  });

  it('does not churn component registrations either', () => {
    let registry: UIBridgeNativeContextValue['registry'] | null = null;

    function Component() {
      registry = useUIBridgeNative().registry;
      useUIComponent({ id: 'operations-card', name: 'Operations card' });
      return null;
    }

    const { Host, rerenderProvider } = makeHarness(Component);
    const { unmount } = render(<Host />);

    const events: string[] = [];
    const off = registry!.on('component:unregistered', () => events.push('unregistered'));

    rerenderProvider();
    rerenderProvider();

    expect(events).toEqual([]);

    off();
    unmount();
  });
});
