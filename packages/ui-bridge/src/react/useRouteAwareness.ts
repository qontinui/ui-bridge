/**
 * useRouteAwareness Hook
 *
 * Provides framework-router integration for the navigation tracker.
 * Accepts structured route information and keeps the tracker updated.
 *
 * Usage with React Router:
 *   import { useLocation, useParams, useMatches } from 'react-router-dom';
 *
 *   function App() {
 *     const location = useLocation();
 *     const params = useParams();
 *     const matches = useMatches();
 *
 *     useRouteAwareness({
 *       pattern: matches[matches.length - 1]?.pathname,
 *       params,
 *       queryParams: Object.fromEntries(new URLSearchParams(location.search)),
 *       routeStack: matches.map(m => m.pathname),
 *     });
 *
 *     return <Outlet />;
 *   }
 *
 * Usage with Next.js:
 *   import { usePathname, useParams, useSearchParams } from 'next/navigation';
 *
 *   function Layout({ children }) {
 *     const pathname = usePathname();
 *     const params = useParams();
 *     const searchParams = useSearchParams();
 *
 *     useRouteAwareness({
 *       params: params as Record<string, string>,
 *       queryParams: Object.fromEntries(searchParams),
 *     });
 *
 *     return <>{children}</>;
 *   }
 */

import { useEffect } from 'react';
import { useUIBridgeOptional } from './UIBridgeProvider';
import type { RouteInfo } from '../navigation/types';

/**
 * Provide framework router information to the navigation tracker.
 *
 * The info is cleared when the component unmounts.
 */
export function useRouteAwareness(info: RouteInfo): void {
  const bridge = useUIBridgeOptional();

  useEffect(() => {
    if (!bridge) return;

    bridge.navigationTracker.setRouteInfo(info);

    return () => {
      bridge.navigationTracker.setRouteInfo(undefined);
    };
    // Serialize for dependency comparison
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    bridge,
    info.pattern,
    info.params ? JSON.stringify(info.params) : '',
    info.queryParams ? JSON.stringify(info.queryParams) : '',
    info.routeStack?.join(','),
  ]);
}
