/**
 * `window.__UI_BRIDGE__.mutationOccurred()` — frontend signal that
 * rendered pixels have changed via a path the runner can't observe
 * directly (route change, app-driven re-render, animation settle).
 *
 * Runner-side counterpart shipped in qontinui-runner#134
 * (POST /ui-bridge/vision/mutation-occurred). The endpoint bumps an
 * AtomicU64 mutation counter that the vision cache key folds in, so
 * subsequent `vision/capture` calls re-render instead of returning a
 * stale cached entry.
 *
 * Fire-and-forget — failures are swallowed because the cache will
 * eventually invalidate on the next captured action anyway. The signal
 * is a tighter-loop optimization, not a correctness primitive.
 *
 * Best paired with `NavigationTracker` (see {@link installAutoMutationOccurred}):
 * every recorded navigation auto-invokes this so post-route-change
 * captures see fresh pixels.
 */

export interface MutationOccurredOptions {
  /**
   * Base URL of the runner, e.g. `http://localhost:9876`. Defaults to
   * empty string → same-origin. Required when this SDK runs from a
   * cross-origin context (e.g. mobile WebView, dev tools).
   */
  baseUrl?: string;
  /** Optional fetch implementation (useful for tests + non-browser callers). */
  fetchImpl?: typeof fetch;
  /** Optional abort signal — useful for tests, no production caller wires this. */
  signal?: AbortSignal;
}

export interface MutationOccurredResult {
  ok: boolean;
  /** Server-reported new mutation_id, if the call succeeded. */
  mutationId?: number;
  /** Error message when the runner-side call failed. */
  error?: string;
}

/**
 * Notify the runner that rendered pixels have changed. Returns a
 * Promise so callers that care can await + check the new mutation_id;
 * most callers fire-and-forget with `void mutationOccurred()`.
 *
 * Never throws. Network failures and non-2xx responses are returned as
 * `{ ok: false, error }` so callers don't have to catch.
 */
export async function mutationOccurred(
  options: MutationOccurredOptions = {}
): Promise<MutationOccurredResult> {
  const { baseUrl = '', fetchImpl, signal } = options;
  const fetcher: typeof fetch =
    fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : (undefined as unknown as typeof fetch));
  if (!fetcher) {
    return { ok: false, error: 'no fetch implementation available' };
  }
  const url = `${baseUrl.replace(/\/+$/, '')}/ui-bridge/vision/mutation-occurred`;
  try {
    const response = await fetcher(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      signal,
    });
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }
    const body = (await response.json().catch(() => null)) as
      | { data?: { mutationId?: number } }
      | null;
    return { ok: true, mutationId: body?.data?.mutationId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Auto-invoke {@link mutationOccurred} from a NavigationTracker's event
 * stream. Returns an uninstall function. Safe to call in non-browser
 * environments (no-op).
 *
 * Typical use from the React provider:
 * ```ts
 * const navTracker = new NavigationTracker();
 * navTracker.install();
 * const uninstall = installAutoMutationOccurred(navTracker, { baseUrl });
 * ```
 *
 * NavigationTracker's `onNavigation` callback is single-listener, so
 * if you have an existing handler chain it through `onNavigation`
 * yourself and call `mutationOccurred()` from it directly.
 */
export function installAutoMutationOccurred(
  navTracker: {
    onNavigationComplete: (cb: (data: { url: string }) => void) => () => void;
  },
  options: MutationOccurredOptions = {}
): () => void {
  if (typeof window === 'undefined') return () => {};
  return navTracker.onNavigationComplete(() => {
    void mutationOccurred(options);
  });
}
