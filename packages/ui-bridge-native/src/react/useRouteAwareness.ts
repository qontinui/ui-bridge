/**
 * useRouteAwareness — report the router's current route TEMPLATE to the
 * native bridge, emitted on every snapshot as `page.route`.
 *
 * `pattern` is a route TEMPLATE, never the concrete pathname: a concrete path
 * (`/search/<what the user typed>`) reported as a pattern leaks user input into
 * anything that stores templates — the runner's journey ledger reads
 * `snapshot.page.route.pattern` and keeps it only under
 * `patternSource: 'router'`. Derive the pattern with `expoRouterPattern`
 * (Expo Router `useSegments()`) or `reactNavigationPattern` (React Navigation
 * state), which return `null` rather than leak, and say where it came from
 * with `patternSource: 'router'`. NEVER pass `usePathname()`, a URL, or a
 * param value as the pattern.
 *
 * The not-found signal is a plain boolean, `{ unmatched }`. The web SDK needs
 * a provider-owned context signal and a layout effect because a Next.js layout
 * renders before its `not-found.tsx` exists, so it cannot know at render time
 * that the render is a 404. Neither native router has that gap: Expo Router's
 * `useSegments()` already reads `['+not-found']` in the same render
 * (`isExpoRouterUnmatched`), and a React Navigation not-found screen is an
 * ordinary named route in the state the caller already reads. So there is no
 * signal to wire. While `unmatched` is true the reported `pattern` is `null`
 * AND `params` is dropped: on a NESTED `+not-found` route expo-router also
 * carries the concrete not-found path in `params['not-found']` (on the
 * top-level branch `params` is `{}`; the path is always in `pathname`, which
 * the hook never takes), so a caller passing the router's search params as
 * `params` would otherwise ship user input.
 *
 * Note: native's `unmatched?: boolean` shares its option KEY with the web
 * hook's `unmatched?: RouteUnmatchedSignal | null`, but not its type.
 *
 * The reported info is cleared when the component unmounts. Outside a
 * `UIBridgeNativeProvider` the hook is a no-op.
 *
 * Usage with Expo Router (in the root layout):
 *
 * @example
 * ```tsx
 * import { useSegments } from 'expo-router';
 * import {
 *   expoRouterPattern,
 *   expoRouterRouteStack,
 *   isExpoRouterUnmatched,
 *   useRouteAwareness,
 * } from '@qontinui/ui-bridge-native';
 *
 * function RouteAwareness() {
 *   const segments = useSegments();
 *   useRouteAwareness(
 *     {
 *       pattern: expoRouterPattern(segments),
 *       patternSource: 'router',
 *       routeStack: expoRouterRouteStack(segments),
 *     },
 *     { unmatched: isExpoRouterUnmatched(segments) }
 *   );
 *   return null;
 * }
 * ```
 *
 * Usage with React Navigation: read the ROOT state from the container, not
 * with `useNavigationState` (which throws outside a navigator and, inside a
 * screen, sees only that navigator's state). The component must render inside
 * `UIBridgeNativeProvider`:
 *
 * @example
 * ```tsx
 * import { useState } from 'react';
 * import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
 * import {
 *   reactNavigationPattern,
 *   useRouteAwareness,
 *   type NavigationStateLike,
 * } from '@qontinui/ui-bridge-native';
 *
 * function Navigation({ children }: { children: React.ReactNode }) {
 *   const navigationRef = useNavigationContainerRef();
 *   const [rootState, setRootState] = useState<NavigationStateLike | undefined>();
 *   const syncRootState = () => setRootState(navigationRef.getRootState());
 *
 *   const pattern = reactNavigationPattern(rootState, { notFoundRouteNames: ['NotFound'] });
 *   useRouteAwareness({ pattern, patternSource: 'router' }, { unmatched: pattern === null });
 *
 *   return (
 *     <NavigationContainer ref={navigationRef} onReady={syncRootState} onStateChange={syncRootState}>
 *       {children}
 *     </NavigationContainer>
 *   );
 * }
 * ```
 */

import { useEffect, useRef } from 'react';
import { useUIBridgeNativeOptional } from './UIBridgeNativeProvider';
import type { RouteInfo } from '../core/types';

export interface UseRouteAwarenessOptions {
  /**
   * True while the current route is a not-found screen. The reported
   * `pattern` is then `null` and `params` is dropped, whatever `info` says.
   */
  unmatched?: boolean;
}

function effectiveInfo(info: RouteInfo, unmatched: boolean): RouteInfo {
  if (!unmatched) return info;
  // Omit `params` outright rather than set it to `undefined`: an in-process
  // reader of `getRouteInfo()` then sees no `params` key at all, the same
  // shape the snapshot's JSON wire form has.
  const { params: _dropped, ...rest } = info;
  return { ...rest, pattern: null };
}

/**
 * Report router information to the native bridge's `page.route`.
 *
 * The info is cleared when the component unmounts.
 */
export function useRouteAwareness(info: RouteInfo, options: UseRouteAwarenessOptions = {}): void {
  const bridge = useUIBridgeNativeOptional();
  const unmatched = options.unmatched === true;
  const infoRef = useRef(info);
  infoRef.current = info;

  // Serialized dependency keys — the same set as the web hook. They are the
  // effect's re-fire triggers; the latest info object is read from infoRef.
  const pattern = info.pattern;
  const patternSource = info.patternSource;
  const paramsKey = info.params ? JSON.stringify(info.params) : '';
  const queryParamsKey = info.queryParams ? JSON.stringify(info.queryParams) : '';
  const routeStackKey = info.routeStack?.join(',');

  useEffect(() => {
    if (!bridge) return;
    const registry = bridge.registry;

    registry.setRouteInfo(effectiveInfo(infoRef.current, unmatched));

    return () => {
      registry.setRouteInfo(undefined);
    };
  }, [bridge, unmatched, pattern, patternSource, paramsKey, queryParamsKey, routeStackKey]);
}
