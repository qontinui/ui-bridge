/**
 * Route-pattern helpers for React Native routers — derive a route TEMPLATE
 * from the router's own route identifiers, failing closed.
 *
 * Why this exists: `useRouteAwareness({ pattern })` is consumed as a route
 * TEMPLATE (the runner's journey ledger stores it as `pathnameTemplate`, which
 * must never carry user input). The web SDK derives its pattern by VALUE
 * substitution (`routePatternFromParams` in `@qontinui/ui-bridge`), because
 * Next.js exposes only a concrete pathname. Native routers need no
 * substitution: both already expose template identifiers directly.
 *
 * - **Expo Router** — `useSegments()` returns file-route names
 *   (`['profile', '[user]']`, `['(tabs)', 'runs']`), never the concrete path.
 *   A not-found render reads `['+not-found']`; the concrete not-found path
 *   lives only in `params['not-found']` (expo-router 6.0.23
 *   `build/global-state/routeInfo.js:22-30, 96-99`).
 * - **React Navigation** — the navigation state carries each route's `name`,
 *   a static identifier declared in code (`<Stack.Screen name="Profile">`).
 *   User values live only in `route.params`, which these helpers never read.
 *
 * So the helpers only VALIDATE shape. GUARANTEE, and its precondition: a
 * non-null result is built solely from the segments / route names the caller
 * passed, each of which is a non-empty string containing no `/`, `?` or `#`.
 * It carries no user input ONLY when those inputs are the router's own
 * route-identifier output — `useSegments()` or the navigation state — and
 * never `usePathname()`, a URL, or a param value. One residual: when Expo's
 * navigation state is incomplete it pushes `route.params.screen` strings into
 * the segments (`routeInfo.js:59-83`). Those are navigator screen names, not
 * user values, so the guarantee holds as long as an app never navigates with a
 * user-controlled `screen` param; the shape test bounds what such a value
 * could carry.
 *
 * @example
 * ```tsx
 * import { useSegments } from 'expo-router';
 * import { expoRouterPattern, isExpoRouterUnmatched } from '@qontinui/ui-bridge-native';
 *
 * function useExpoPattern() {
 *   const segments = useSegments();
 *   return { pattern: expoRouterPattern(segments), unmatched: isExpoRouterUnmatched(segments) };
 * }
 * ```
 */

/**
 * Structural subset of a React Navigation state object — what
 * `useNavigationState((s) => s)` or `navigationRef.getRootState()` returns.
 * Declared structurally so this package takes no dependency on
 * `@react-navigation/*`. `params` is deliberately absent: the helper never
 * reads it.
 */
export interface NavigationStateLike {
  /** Index of the focused route in `routes`. Defaults to `0` when absent. */
  index?: number;
  routes: ReadonlyArray<{
    name: string;
    /** The nested navigator's state, when this route hosts one. */
    state?: NavigationStateLike;
  }>;
}

/** Options for {@link reactNavigationPattern}. */
export interface ReactNavigationPatternOptions {
  /**
   * Route names that render the app's not-found screen (the `linking`
   * config's catch-all screen). When the focused LEAF route has one of these
   * names the helper returns `null`.
   */
  notFoundRouteNames?: readonly string[];
}

/**
 * True when `value` has the shape of a router route identifier: a non-empty
 * string with no `/`, `?` or `#`. Anything else is not a route name, so the
 * callers fail closed on it.
 */
function isRouteIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !value.includes('/') &&
    !value.includes('?') &&
    !value.includes('#')
  );
}

/**
 * True when Expo Router's segments name a system route — any segment starting
 * with `+` (`+not-found`; `+html` / `+api` never render). Expo reserves the
 * `+` prefix, so no `+` segment names a user screen. Pass the result as
 * `useRouteAwareness(info, { unmatched })`.
 */
export function isExpoRouterUnmatched(segments: readonly string[]): boolean {
  return segments.some((s) => typeof s === 'string' && s.startsWith('+'));
}

/**
 * Derive a route template from Expo Router's `useSegments()`:
 * `'/' + segments.join('/')`, with layout groups such as `(tabs)` KEPT.
 *
 * - `[]` → `'/'` (Expo already pops a trailing `index`);
 * - `['profile', '[user]']` → `'/profile/[user]'`;
 * - `['(tabs)', 'runs']` → `'/(tabs)/runs'`.
 *
 * Groups are kept because they are developer-declared names, never user
 * input, and because two screens in different groups can share a URL — the
 * group is what keeps them distinct. A consumer that wants the URL shape can
 * strip `(…)` segments; a stripped pattern cannot be un-stripped.
 *
 * Returns `null` when any segment starts with `+` (a system route, see
 * {@link isExpoRouterUnmatched}) or fails the route-identifier shape test
 * (empty, not a string, or containing `/`, `?` or `#`).
 */
export function expoRouterPattern(segments: readonly string[]): string | null {
  if (!Array.isArray(segments)) return null;
  for (const segment of segments) {
    if (!isRouteIdentifier(segment)) return null;
    if (segment.startsWith('+')) return null;
  }
  return '/' + segments.join('/');
}

/**
 * Derive a route template from a React Navigation state: the focused
 * route-NAME chain, root to leaf, joined with `/` — e.g. `/HomeTabs/Profile`.
 *
 * The whole chain rather than the leaf keeps same-named screens in different
 * navigators (`Settings` under two tabs) distinct. Route `params` are never
 * read, so no param shape can leak into the result.
 *
 * Returns `null` on an empty `routes`, an out-of-range or non-integer
 * `index`, a route name that fails the route-identifier shape test, or a
 * focused leaf whose name is in `options.notFoundRouteNames`.
 *
 * Expo Router apps should use {@link expoRouterPattern} instead: Expo Router
 * is React Navigation underneath, and a raw walk of its state yields Expo's
 * internal route names rather than the file routes.
 */
export function reactNavigationPattern(
  state: NavigationStateLike | null | undefined,
  options: ReactNavigationPatternOptions = {}
): string | null {
  const names: string[] = [];
  let level: NavigationStateLike | undefined = state ?? undefined;
  while (level) {
    const routes = level.routes;
    if (!Array.isArray(routes) || routes.length === 0) return null;
    const index = level.index ?? 0;
    if (!Number.isInteger(index) || index < 0 || index >= routes.length) return null;
    const route = routes[index];
    if (!route || !isRouteIdentifier(route.name)) return null;
    names.push(route.name);
    level = route.state;
  }
  if (names.length === 0) return null;
  const leaf = names[names.length - 1];
  if (options.notFoundRouteNames?.includes(leaf)) return null;
  return '/' + names.join('/');
}
