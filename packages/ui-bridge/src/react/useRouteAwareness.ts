/**
 * useRouteAwareness Hook
 *
 * Provides framework-router integration for the navigation tracker.
 * Accepts structured route information and keeps the tracker updated.
 *
 * `pattern` is a route TEMPLATE, never the concrete pathname: a concrete path
 * (`/search/<what the user typed>`) reported as a pattern leaks user input into
 * anything that stores templates. Derive it with `routePatternFromParams`, which
 * returns `null` rather than leak, and say where it came from with
 * `patternSource: 'router'` — consumers drop an unasserted pattern.
 *
 * `routePatternFromParams` is only as safe as the `matched` its caller reports:
 * on a 404 the router's params are `{}`, so a `matched: true` there returns the
 * concrete path unchanged. A layout cannot know at render time that this render
 * is a 404 — so pass the not-found signal (`{ unmatched }`, see
 * `routeUnmatched.ts`) and this hook reports `pattern: null` whenever a
 * not-found boundary is mounted, whatever `info.pattern` says.
 *
 * Usage with Next.js (pass `useParams()` RAW — flattening a catch-all array
 * destroys the `[...slug]` run):
 *   // app/RouteAwareness.tsx — mounted once, in the root layout
 *   import { usePathname, useParams, useSearchParams } from 'next/navigation';
 *   import {
 *     RouteUnmatchedContext,
 *     routePatternFromParams,
 *     useRouteAwareness,
 *     useRouteUnmatchedSignal,
 *   } from '@qontinui/ui-bridge/react';
 *
 *   export function RouteAwareness({ children }) {
 *     const pathname = usePathname();
 *     const params = useParams();
 *     const searchParams = useSearchParams();
 *     const unmatched = useRouteUnmatchedSignal();
 *
 *     useRouteAwareness(
 *       {
 *         // matched: true is safe ONLY because `unmatched` overrides it on a 404.
 *         pattern: routePatternFromParams(pathname, params, { matched: true }),
 *         patternSource: 'router',
 *         queryParams: Object.fromEntries(searchParams),
 *       },
 *       { unmatched }
 *     );
 *
 *     return (
 *       <RouteUnmatchedContext.Provider value={unmatched}>{children}</RouteUnmatchedContext.Provider>
 *     );
 *   }
 *
 *   // app/not-found.tsx — raises the signal in useLayoutEffect. Do NOT call
 *   // useRouteAwareness here: the layout's passive effect runs after this
 *   // component's and would overwrite it.
 *   import { useMarkRouteUnmatched } from '@qontinui/ui-bridge/react';
 *
 *   export default function NotFound() {
 *     useMarkRouteUnmatched();
 *     return <p>Not found</p>;
 *   }
 *
 * Usage with React Router: `useMatches()` is NOT a 404 test — in a data router
 * an unmatched URL still yields `matches = [root]`, so `matched:
 * matches.length > 0` is always true. Host the hook in a layout route's
 * element (so `useParams()` is the matched route's), and:
 *
 * - A `path="*"` route is REQUIRED. Without one, an unmatched URL renders the
 *   layout with `params = {}`, and the concrete path leaks. With one, its `*`
 *   param templates the path as `[...*]`, which is safe even without the
 *   signal. Marking it with `useMarkRouteUnmatched()` reports `null` instead.
 * - A data router renders the root's `errorElement` INSTEAD of its element on
 *   a 404, so a hook hosted in the root element unmounts (the tracker is
 *   cleared; nothing leaks). An `errorElement` that itself hosts the hook owns
 *   the signal, so it is not below its own provider: it must mark with the
 *   EXPLICIT form, `useMarkRouteUnmatched(unmatched)`, when
 *   `isRouteErrorResponse(error) && error.status === 404`. The no-argument
 *   form reads the context above it, finds none, and silently no-ops.
 *   import { useLocation, useParams, Outlet } from 'react-router-dom';
 *   import {
 *     RouteUnmatchedContext,
 *     routePatternFromParams,
 *     useRouteAwareness,
 *     useRouteUnmatchedSignal,
 *   } from '@qontinui/ui-bridge/react';
 *
 *   function App() {
 *     const location = useLocation();
 *     const params = useParams();
 *     const unmatched = useRouteUnmatchedSignal();
 *
 *     useRouteAwareness(
 *       {
 *         pattern: routePatternFromParams(location.pathname, params, { matched: true }),
 *         patternSource: 'router',
 *         queryParams: Object.fromEntries(new URLSearchParams(location.search)),
 *       },
 *       { unmatched }
 *     );
 *
 *     return (
 *       <RouteUnmatchedContext.Provider value={unmatched}>
 *         <Outlet />
 *       </RouteUnmatchedContext.Provider>
 *     );
 *   }
 */

import { useEffect, useRef } from 'react';
import { useUIBridgeOptional } from './UIBridgeProvider';
import type { RouteInfo } from '../navigation/types';
import type { RouteUnmatchedSignal } from './routeUnmatched';

export interface UseRouteAwarenessOptions {
  /**
   * The provider-owned not-found signal. While it is raised (a not-found
   * boundary is mounted), the reported `pattern` is `null` regardless of
   * `info.pattern`.
   */
  unmatched?: RouteUnmatchedSignal | null;
}

function effectiveInfo(
  info: RouteInfo,
  unmatched: RouteUnmatchedSignal | null | undefined
): RouteInfo {
  return unmatched && unmatched.count > 0 ? { ...info, pattern: null } : info;
}

/**
 * Provide framework router information to the navigation tracker.
 *
 * The info is cleared when the component unmounts.
 */
export function useRouteAwareness(info: RouteInfo, options: UseRouteAwarenessOptions = {}): void {
  const bridge = useUIBridgeOptional();
  const unmatched = options.unmatched ?? null;
  const infoRef = useRef(info);
  infoRef.current = info;

  // Serialize for dependency comparison. These derived values are the
  // effect re-fire triggers; the latest info object is read from
  // infoRef inside the effect.
  const pattern = info.pattern;
  const patternSource = info.patternSource;
  const paramsKey = info.params ? JSON.stringify(info.params) : '';
  const queryParamsKey = info.queryParams ? JSON.stringify(info.queryParams) : '';
  const routeStackKey = info.routeStack?.join(',');

  useEffect(() => {
    if (!bridge) return;

    bridge.navigationTracker.setRouteInfo(effectiveInfo(infoRef.current, unmatched));

    return () => {
      bridge.navigationTracker.setRouteInfo(undefined);
    };
  }, [bridge, unmatched, pattern, patternSource, paramsKey, queryParamsKey, routeStackKey]);

  // A not-found boundary that mounts AFTER this hook's last report (no route
  // dep changed) re-reports with `pattern: null`. Only raises re-report: a
  // lower must never re-send `infoRef.current`, which on a 404 is the concrete
  // path (the next route change re-fires the effect above instead).
  useEffect(() => {
    if (!bridge || !unmatched) return;
    return unmatched.subscribe(() => {
      bridge.navigationTracker.setRouteInfo(effectiveInfo(infoRef.current, unmatched));
    });
  }, [bridge, unmatched]);
}
