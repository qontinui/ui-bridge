/**
 * useBuildIdWatcher Hook
 *
 * Detects when a server-side rebuild has shipped a new bundle while the
 * dashboard tab is still running the old code. Pairs with a server that:
 *
 *   1. Injects `<meta name="build-id" content="...">` into the served HTML
 *      so the initial value is observable from the document.
 *   2. Either:
 *      a. Emits `buildId` on a Server-Sent Events stream (default
 *         `/health/stream`), or
 *      b. Exposes a fetch-able snapshot the hook polls on an interval, or
 *      c. Provides a custom getter (e.g. a Tauri `invoke` for desktop apps
 *         where the binary's compiled-in build-id differs from the
 *         meta tag baked into the embedded HTML at the time the webview
 *         loaded it).
 *
 * On mount, the hook reads the meta-tag value as the "current" build-id and
 * starts whichever source is configured. When the source reports a build-id
 * that differs from the current value, `onBuildIdChange` is invoked once;
 * subsequent events do not re-fire it. The source is torn down on unmount.
 *
 * No-ops cleanly when:
 *   - The meta tag is missing (no initial build-id to compare against).
 *   - The chosen source is unavailable (e.g. `EventSource` undefined in SSR,
 *     `fetch` undefined in non-browser env).
 *
 * Usage (SSE — default; supervisor dashboard pattern):
 *   useBuildIdWatcher({ onBuildIdChange: () => setStale(true) });
 *
 * Usage (polling — Next.js / qontinui-web / runner pattern):
 *   useBuildIdWatcher({
 *     pollUrl: '/api/health',
 *     pollIntervalMs: 30_000,
 *     onBuildIdChange: () => setStale(true),
 *   });
 *
 * Usage (custom getter — e.g. Tauri invoke):
 *   useBuildIdWatcher({
 *     getCurrentBuildId: () => invoke<string>('get_build_id'),
 *     pollIntervalMs: 0, // one-shot; binary swap is the only divergence cause
 *     onBuildIdChange: () => setStale(true),
 *   });
 */

import { useEffect, useRef } from 'react';

export interface UseBuildIdWatcherOptions {
  /**
   * URL of the SSE stream that emits a `buildId` field on each event payload.
   * Defaults to `/health/stream`. Ignored when `pollUrl` or
   * `getCurrentBuildId` is provided.
   */
  healthStreamUrl?: string;
  /**
   * URL the hook will GET periodically. Response body must be JSON with a
   * top-level `buildId` field. When set, the SSE path is not used.
   */
  pollUrl?: string;
  /**
   * Custom build-id getter. Called once on mount and (if `pollIntervalMs > 0`)
   * on the configured interval. When set, the SSE and `pollUrl` paths are
   * not used.
   */
  getCurrentBuildId?: () => Promise<string> | string;
  /**
   * Polling interval in milliseconds for `pollUrl` / `getCurrentBuildId`.
   * Defaults to 30_000 (30s). Set to 0 for a one-shot check on mount only.
   * Ignored for the SSE path.
   */
  pollIntervalMs?: number;
  /**
   * Callback invoked the first time the watched source reports a build-id
   * that differs from the value read from the `<meta name="build-id">` tag
   * at mount time. Called at most once per mount.
   */
  onBuildIdChange?: (oldId: string, newId: string) => void;
}

const DEFAULT_HEALTH_STREAM_URL = '/health/stream';
const DEFAULT_POLL_INTERVAL_MS = 30_000;

function readInitialBuildId(): string | null {
  if (typeof document === 'undefined') return null;
  const meta = document.querySelector('meta[name="build-id"]');
  if (!meta) return null;
  const content = meta.getAttribute('content');
  return content && content.length > 0 ? content : null;
}

export function useBuildIdWatcher(options: UseBuildIdWatcherOptions = {}): void {
  const healthStreamUrl = options.healthStreamUrl ?? DEFAULT_HEALTH_STREAM_URL;
  const pollUrl = options.pollUrl;
  const getCurrentBuildId = options.getCurrentBuildId;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const onBuildIdChange = options.onBuildIdChange;

  // Stash callbacks in refs so re-renders with new inline lambdas don't
  // re-subscribe the watcher. The main effect reads `.current` at call time
  // so the latest callback is always used without listing it as a dep.
  const onBuildIdChangeRef = useRef(onBuildIdChange);
  const getCurrentBuildIdRef = useRef(getCurrentBuildId);

  useEffect(() => {
    onBuildIdChangeRef.current = onBuildIdChange;
  });
  useEffect(() => {
    getCurrentBuildIdRef.current = getCurrentBuildId;
  });

  // Track *whether* a custom getter is configured (vs not) so the effect can
  // pick the right branch. Identity changes of the getter itself should NOT
  // re-subscribe — the ref above keeps callers up to date.
  const hasGetCurrentBuildId = getCurrentBuildId != null;

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const initial = readInitialBuildId();
    if (initial == null) return;

    let fired = false;
    let cancelled = false;

    const compare = (incoming: unknown) => {
      if (cancelled || fired) return;
      if (typeof incoming !== 'string' || incoming.length === 0) return;
      if (incoming === initial) return;
      fired = true;
      try {
        onBuildIdChangeRef.current?.(initial, incoming);
      } catch {
        /* swallow callback errors so we don't tear down the watcher */
      }
    };

    // --- Custom getter path (e.g. Tauri invoke) ---
    if (hasGetCurrentBuildId) {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const tick = () => {
        if (cancelled || fired) return;
        Promise.resolve()
          .then(() => {
            const getter = getCurrentBuildIdRef.current;
            return getter ? getter() : undefined;
          })
          .then((value) => compare(value))
          .catch(() => {
            /* getter failed — try again next tick */
          })
          .finally(() => {
            if (cancelled || fired) return;
            if (pollIntervalMs > 0) {
              timer = setTimeout(tick, pollIntervalMs);
            }
          });
      };
      tick();
      return () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
      };
    }

    // --- Polling path (e.g. Next.js /api/health, runner /health) ---
    if (pollUrl) {
      if (typeof fetch === 'undefined') return;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let activeController: AbortController | null = null;
      const tick = () => {
        if (cancelled || fired) return;
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        activeController = controller;
        const fetchOpts: RequestInit = { cache: 'no-store' };
        if (controller) fetchOpts.signal = controller.signal;
        fetch(pollUrl, fetchOpts)
          .then((r) => (r.ok ? r.json() : null))
          .then((body) => {
            if (!body || typeof body !== 'object') return;
            compare((body as { buildId?: unknown }).buildId);
          })
          .catch((err: unknown) => {
            // AbortError is the expected outcome of unmount-mid-flight; swallow
            // silently. Other network errors also retry next tick.
            if (
              err &&
              typeof err === 'object' &&
              (err as { name?: unknown }).name === 'AbortError'
            ) {
              return;
            }
            /* network error — retry next tick */
          })
          .finally(() => {
            if (activeController === controller) activeController = null;
            if (cancelled || fired) return;
            if (pollIntervalMs > 0) {
              timer = setTimeout(tick, pollIntervalMs);
            }
          });
      };
      tick();
      return () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
        if (activeController) {
          try {
            activeController.abort();
          } catch {
            /* abort may throw in exotic environments — ignore */
          }
          activeController = null;
        }
      };
    }

    // --- Default SSE path ---
    if (typeof EventSource === 'undefined') return;

    let source: EventSource | null = null;
    try {
      source = new EventSource(healthStreamUrl);
    } catch {
      return;
    }
    if (!source) return;

    const handleMessage = (e: MessageEvent) => {
      const raw = e.data;
      if (typeof raw !== 'string' || raw.length === 0) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }
      if (!parsed || typeof parsed !== 'object') return;
      compare((parsed as { buildId?: unknown }).buildId);
    };

    // Supervisor SSE emits named "health" events; browsers also deliver
    // unnamed events as "message". Handle both for portability.
    source.addEventListener('message', handleMessage);
    source.addEventListener('health', handleMessage as EventListener);

    return () => {
      cancelled = true;
      source?.removeEventListener('message', handleMessage);
      source?.removeEventListener('health', handleMessage as EventListener);
      source?.close();
    };
    // Intentionally omit `onBuildIdChange` and `getCurrentBuildId` from deps:
    // both are captured via refs above so swapping inline lambdas across
    // renders does not tear down the SSE/poll subscription. `pollUrl` and
    // `healthStreamUrl` ARE deps because changing them is a legitimate
    // re-subscribe trigger. `hasGetCurrentBuildId` flips the branch when the
    // caller adds/removes the getter entirely.
  }, [healthStreamUrl, pollUrl, hasGetCurrentBuildId, pollIntervalMs]);
}
