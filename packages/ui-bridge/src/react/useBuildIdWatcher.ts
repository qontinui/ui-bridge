import { useEffect, useRef } from 'react';

/** Read the `<meta name="build-id">` value injected at SSR/build time. */
function readMetaBuildId(): string | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector<HTMLMetaElement>('meta[name="build-id"]')?.content ?? null;
}

export interface UseBuildIdWatcherOptions {
  /**
   * SSE endpoint that emits events containing a `buildId` field.
   * Used by qontinui-supervisor's `/health/stream`.
   * Mutually exclusive with `pollUrl`.
   */
  healthStreamUrl?: string;
  /**
   * HTTP endpoint to poll for a `{ buildId: string }` response.
   * Used by qontinui-web's `/api/health`.
   * Mutually exclusive with `healthStreamUrl`.
   */
  pollUrl?: string;
  /** Polling interval in ms when `pollUrl` is set. Default: 30000. */
  pollIntervalMs?: number;
  /** Called once when the server build-id diverges from the page's meta tag. */
  onBuildIdChange: (oldId: string | null, newId: string) => void;
}

/**
 * Watches for build-id changes via SSE stream or HTTP polling.
 *
 * On divergence between the server's current build-id and the value baked
 * into the page's `<meta name="build-id">` tag, calls `onBuildIdChange`
 * once. Suitable for both supervisor (SSE) and web (polling) hosts.
 */
export function useBuildIdWatcher({
  healthStreamUrl,
  pollUrl,
  pollIntervalMs = 30_000,
  onBuildIdChange,
}: UseBuildIdWatcherOptions): void {
  const onChangeRef = useRef(onBuildIdChange);
  onChangeRef.current = onBuildIdChange;

  const firedRef = useRef(false);

  useEffect(() => {
    const pageId = readMetaBuildId();

    function check(serverBuildId: string) {
      if (firedRef.current) return;
      if (pageId !== null && serverBuildId !== pageId) {
        firedRef.current = true;
        onChangeRef.current(pageId, serverBuildId);
      }
    }

    if (healthStreamUrl) {
      const source = new EventSource(healthStreamUrl);

      source.addEventListener('message', (ev) => {
        try {
          const data = JSON.parse(ev.data) as { buildId?: string };
          if (data.buildId) check(data.buildId);
        } catch {
          /* ignore non-JSON frames */
        }
      });

      return () => source.close();
    }

    if (pollUrl) {
      const url = pollUrl;
      const interval = setInterval(async () => {
        try {
          const res = await fetch(url, { cache: 'no-store' });
          if (!res.ok) return;
          const data = (await res.json()) as { buildId?: string };
          if (data.buildId) check(data.buildId);
        } catch {
          /* ignore transient network errors */
        }
      }, pollIntervalMs);

      return () => clearInterval(interval);
    }

    return undefined;
  }, [healthStreamUrl, pollUrl, pollIntervalMs]);
}
