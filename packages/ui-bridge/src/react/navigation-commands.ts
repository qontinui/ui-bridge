/**
 * The two navigation-adapter commands — `getRoutes` and `navigateByAdapter` —
 * as ONE implementation each, served by the in-page command dispatcher
 * (`./commandHandlers.ts`) and by the in-process handlers
 * (`../server/handlers.ts`). Plan
 * 2026-11-08-relayed-ui-bridge-actions-have-no-browser-case, D3 / D4.
 *
 * The adapter lives in a page slot, `window.__UI_BRIDGE__.navigationAdapter`,
 * beside the app's existing `navigateHandler`. `<UIBridgeProvider
 * navigation={…}>` sets and clears it ({@link setNavigationAdapterSlot}); an
 * app with no provider may assign it directly.
 *
 * Every navigation first passes the one URL gate (`../core/navigation-url.ts`),
 * so this second navigation verb is no weaker than `pageNavigate`.
 *
 * Each command answers its value, or a failure it RETURNS (never throws):
 * `{ success: false, error, failureDetails: { errorCode, message } }`, which
 * the shared inner-failure rule lifts onto a canonical `UB-*` envelope code
 * (`INVALID_REQUEST`, `INVALID_URL_PROTOCOL` and `INVALID_URL_FORMAT` all map
 * to `UB-VALIDATION-ERROR`).
 */

import {
  WindowLocationAdapter,
  windowLocationPath,
  type NavigationAdapter,
  type NavigationRoute,
} from '../navigation/navigation-adapter';
import { checkNavigationUrl, type NavigationUrlRefusalCode } from '../core/navigation-url';

/** The page slots these commands read. */
export interface NavigationSlots {
  /** The app's navigation adapter, when one was registered. */
  navigationAdapter?: NavigationAdapter;
}

/** `getRoutes`' answer: the routes, where they came from, and whether they are all of them. */
export interface RoutesAnswer {
  routes: NavigationRoute[];
  /** `adapter` when an app adapter answered; `window-location` otherwise. */
  source: 'adapter' | 'window-location';
  /**
   * `true` only when an adapter enumerated a route table
   * (`NavigationAdapter.isRouteTableComplete`). A one-route list standing in
   * for "the current page" is `false`: the app declared no route table.
   */
  complete: boolean;
}

/** `navigateByAdapter`'s answer on success. */
export interface NavigatedAnswer {
  navigated: true;
  route: NavigationRoute;
}

/** A navigation the command refused. */
export interface NavigationRefusal {
  success: false;
  error: string;
  failureDetails: {
    errorCode: 'INVALID_REQUEST' | NavigationUrlRefusalCode;
    message: string;
    expectedPayload?: string;
  };
  timestamp: number;
}

/** The payload shape `navigateByAdapter` reads. */
export const NAVIGATE_BY_ADAPTER_PAYLOAD_SHAPE = '{"page":"<route name, path or URL>"}';

/** What `navigateByAdapter` needs from its transport. */
export interface NavigateByAdapterDeps {
  /** The base the URL gate resolves `page` against (the page's own URL). */
  base: string;
  /**
   * The transport's own `pageNavigate`, used when no adapter is registered,
   * so the no-adapter verb is exactly `pageNavigate` on the path form of
   * `page`: its same-origin `navigateHandler` arm included. A returned
   * `success: false` is answered as it is.
   */
  pageNavigate: (url: string) => Promise<unknown>;
}

/** The registered adapter, if any. */
export function resolveNavigationAdapter(
  g: NavigationSlots | null | undefined
): NavigationAdapter | undefined {
  return g?.navigationAdapter ?? undefined;
}

/**
 * Register `adapter` in the page slot; the returned function clears it, but
 * only while the slot still holds this adapter (a later registration wins).
 */
export function setNavigationAdapterSlot(adapter: NavigationAdapter): () => void {
  const w = globalThis as unknown as { __UI_BRIDGE__?: NavigationSlots };
  const root = (w.__UI_BRIDGE__ ??= {});
  root.navigationAdapter = adapter;
  return () => {
    if (root.navigationAdapter === adapter) delete root.navigationAdapter;
  };
}

/** A navigation refusal, as a returned failure. */
export function navigationRefusal(
  errorCode: NavigationRefusal['failureDetails']['errorCode'],
  message: string,
  expectedPayload?: string
): NavigationRefusal {
  return {
    success: false,
    error: message,
    failureDetails: {
      errorCode,
      message,
      ...(expectedPayload !== undefined ? { expectedPayload } : {}),
    },
    timestamp: Date.now(),
  };
}

/** Is this command answer a returned failure? */
export function isNavigationFailure(answer: unknown): answer is { success: false } {
  return (
    answer !== null &&
    typeof answer === 'object' &&
    !Array.isArray(answer) &&
    (answer as { success?: unknown }).success === false
  );
}

/** `getRoutes {}` — the app's routes, their source, and whether the list is complete. */
export function getRoutesCommand(g: NavigationSlots | null | undefined): RoutesAnswer {
  const adapter = resolveNavigationAdapter(g);
  if (adapter) {
    return {
      routes: adapter.getRoutes(),
      source: 'adapter',
      complete: adapter.isRouteTableComplete?.() === true,
    };
  }
  return {
    routes: new WindowLocationAdapter().getRoutes(),
    source: 'window-location',
    complete: false,
  };
}

/**
 * `navigateByAdapter {page}` — navigate to a route name, path or URL.
 *
 * With an adapter: `adapter.navigate(page)`, answered with
 * `adapter.getCurrentRoute()`. With none: the transport's `pageNavigate` on
 * `page`'s path form (`windowLocationPath`), answered with the window's
 * current route. The URL gate runs first either way.
 */
export async function navigateByAdapterCommand(
  payload: unknown,
  g: NavigationSlots | null | undefined,
  deps: NavigateByAdapterDeps
): Promise<NavigatedAnswer | NavigationRefusal | { success: false }> {
  const page =
    payload !== null && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as { page?: unknown }).page
      : undefined;
  if (typeof page !== 'string' || page.length === 0) {
    return navigationRefusal(
      'INVALID_REQUEST',
      'navigateByAdapter: "page" must be a non-empty string',
      NAVIGATE_BY_ADAPTER_PAYLOAD_SHAPE
    );
  }
  const verdict = checkNavigationUrl(page, deps.base);
  if (!verdict.ok) return navigationRefusal(verdict.code, verdict.message);

  const adapter = resolveNavigationAdapter(g);
  if (adapter) {
    await adapter.navigate(page);
    return { navigated: true, route: adapter.getCurrentRoute() };
  }
  const answer = await deps.pageNavigate(windowLocationPath(page));
  if (isNavigationFailure(answer)) return answer;
  return { navigated: true, route: new WindowLocationAdapter().getCurrentRoute() };
}
