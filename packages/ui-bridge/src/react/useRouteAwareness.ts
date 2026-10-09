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
 * Usage with React Router:
 *   import { useLocation, useParams, useMatches } from 'react-router-dom';
 *   import { routePatternFromParams, useRouteAwareness } from '@qontinui/ui-bridge/react';
 *
 *   function App() {
 *     const location = useLocation();
 *     const params = useParams();
 *     const matches = useMatches();
 *
 *     useRouteAwareness({
 *       pattern: routePatternFromParams(location.pathname, params, {
 *         matched: matches.length > 0,
 *       }),
 *       patternSource: 'router',
 *       queryParams: Object.fromEntries(new URLSearchParams(location.search)),
 *     });
 *
 *     return <Outlet />;
 *   }
 *
 * Usage with Next.js (pass `useParams()` RAW — flattening a catch-all array
 * destroys the `[...slug]` run; report `matched: false` from your not-found
 * boundary so a 404 reports `pattern: null`):
 *   import { usePathname, useParams, useSearchParams } from 'next/navigation';
 *   import { routePatternFromParams, useRouteAwareness } from '@qontinui/ui-bridge/react';
 *
 *   function Layout({ children }) {
 *     const pathname = usePathname();
 *     const params = useParams();
 *     const searchParams = useSearchParams();
 *
 *     useRouteAwareness({
 *       pattern: routePatternFromParams(pathname, params, { matched: true }),
 *       patternSource: 'router',
 *       queryParams: Object.fromEntries(searchParams),
 *     });
 *
 *     return <>{children}</>;
 *   }
 */

import { useEffect, useRef } from 'react';
import { useUIBridgeOptional } from './UIBridgeProvider';
import type { RouteInfo } from '../navigation/types';

/**
 * Provide framework router information to the navigation tracker.
 *
 * The info is cleared when the component unmounts.
 */
export function useRouteAwareness(info: RouteInfo): void {
  const bridge = useUIBridgeOptional();
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

    bridge.navigationTracker.setRouteInfo(infoRef.current);

    return () => {
      bridge.navigationTracker.setRouteInfo(undefined);
    };
  }, [bridge, pattern, patternSource, paramsKey, queryParamsKey, routeStackKey]);
}
