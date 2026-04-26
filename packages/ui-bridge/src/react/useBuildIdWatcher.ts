/**
 * useBuildIdWatcher Hook
 *
 * Detects when a server-side rebuild has shipped a new bundle while the
 * dashboard tab is still running the old code. Pairs with a server that:
 *
 *   1. Injects `<meta name="build-id" content="...">` into the served HTML
 *      so the initial value is observable from the document.
 *   2. Emits `buildId` on a Server-Sent Events stream (default
 *      `/health/stream`) so connected tabs see updates without polling.
 *
 * On mount, the hook reads the meta-tag value as the "current" build-id and
 * subscribes to the SSE stream. When an SSE event arrives whose `buildId`
 * field differs from the current value, `onBuildIdChange` is invoked once;
 * subsequent matching events do not re-fire it. The EventSource is closed on
 * unmount.
 *
 * No-ops cleanly when:
 *   - The meta tag is missing (no initial build-id to compare against).
 *   - `EventSource` is unavailable (e.g. SSR).
 *
 * Usage:
 *   function App() {
 *     const [stale, setStale] = useState(false);
 *     useBuildIdWatcher({
 *       onBuildIdChange: () => setStale(true),
 *     });
 *     return stale ? <RefreshBanner /> : null;
 *   }
 */

import { useEffect } from 'react';

export interface UseBuildIdWatcherOptions {
  /**
   * URL of the SSE stream that emits a `buildId` field on each event payload.
   * Defaults to `/health/stream`.
   */
  healthStreamUrl?: string;
  /**
   * Callback invoked the first time the SSE stream reports a build-id that
   * differs from the value read from the `<meta name="build-id">` tag at
   * mount time. Called at most once per mount.
   */
  onBuildIdChange?: (oldId: string, newId: string) => void;
}

const DEFAULT_HEALTH_STREAM_URL = '/health/stream';

function readInitialBuildId(): string | null {
  if (typeof document === 'undefined') return null;
  const meta = document.querySelector('meta[name="build-id"]');
  if (!meta) return null;
  const content = meta.getAttribute('content');
  return content && content.length > 0 ? content : null;
}

export function useBuildIdWatcher(options: UseBuildIdWatcherOptions = {}): void {
  const healthStreamUrl = options.healthStreamUrl ?? DEFAULT_HEALTH_STREAM_URL;
  const onBuildIdChange = options.onBuildIdChange;

  useEffect(() => {
    // Server-side rendering / non-browser env: no-op.
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;

    const initial = readInitialBuildId();
    // Without an initial value to compare against, we can't detect change.
    if (initial == null) return;

    let fired = false;
    let cancelled = false;
    let source: EventSource | null = null;
    try {
      source = new EventSource(healthStreamUrl);
    } catch {
      return;
    }
    if (!source) return;

    const handleMessage = (e: MessageEvent) => {
      if (cancelled || fired) return;
      const raw = e.data;
      if (typeof raw !== 'string' || raw.length === 0) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }
      if (!parsed || typeof parsed !== 'object') return;
      const incoming = (parsed as { buildId?: unknown }).buildId;
      if (typeof incoming !== 'string' || incoming.length === 0) return;
      if (incoming !== initial) {
        fired = true;
        try {
          onBuildIdChange?.(initial, incoming);
        } catch {
          /* user callback errored — swallow so we don't tear down the SSE */
        }
      }
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
  }, [healthStreamUrl, onBuildIdChange]);
}
