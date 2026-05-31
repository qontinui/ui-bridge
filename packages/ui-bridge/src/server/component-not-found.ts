/**
 * `buildComponentNotFoundError`
 *
 * Standalone, zero-dependency builder for the enriched "Component not found"
 * error message used by every component-detail / component-action 404 site
 * (Phase 1.1, plan 2026-05-03).
 *
 * Lifted out of `server/handlers.ts` so browser-side consumers — notably the
 * relay command dispatcher (`react/commandHandlers.ts`) and the injected
 * runtime bundle (`injected/`) — can import just this pure string helper
 * without dragging the entire Node-leaning `server/handlers` module graph
 * (style auditing, form discovery, navigation adapters, …) into a browser
 * IIFE. `server/handlers.ts` re-exports it for backward compatibility, so
 * existing `import { buildComponentNotFoundError } from '.../server/handlers'`
 * call sites are unaffected.
 *
 * Output format:
 *   `Component "{id}" not found{otherRouteHint}. Available components: [...]. ` +
 *   `Components are only available when their page is active — navigate to ` +
 *   `the page that contains this component and try again.`
 *
 * `otherRouteHint` is appended only when `byRoute` (Phase 1.2 shape, with
 * per-route `ids`) shows the missing id is registered on a different route.
 * Falls back to no hint when `byRoute` / `currentRoute` are absent or the
 * id genuinely doesn't exist anywhere — callers don't have to special-case
 * the missing-snapshot scenario.
 */
export function buildComponentNotFoundError(
  id: string,
  available: readonly string[],
  byRoute?: Record<string, { count: number; ids: string[] }>,
  currentRoute?: string | null
): string {
  let otherRouteHint = '';
  if (byRoute) {
    for (const [route, entry] of Object.entries(byRoute)) {
      if (route === currentRoute) continue;
      if (entry?.ids?.includes(id)) {
        const cur =
          typeof currentRoute === 'string' && currentRoute.length > 0
            ? currentRoute
            : '(unknown)';
        otherRouteHint = ` (registered on route '${route}', current route is '${cur}')`;
        break;
      }
    }
  }
  return (
    `Component "${id}" not found${otherRouteHint}. ` +
    `Available components: [${available.join(', ')}]. ` +
    `Components are only available when their page is active — ` +
    `navigate to the page that contains this component and try again.`
  );
}
