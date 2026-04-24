/**
 * network-probe — thin client for POST /ui-bridge/ai/network-probe.
 *
 * Performs a server-side HTTP request against a loopback destination so tests
 * can read backend state independent of the React app's polling lifecycle.
 *
 * The runner enforces a loopback-only allow-list (`127.0.0.1`, `::1`,
 * `localhost`, `*.local`). Non-loopback URLs are rejected with HTTP 400.
 */

export interface NetworkProbeRequest {
  url: string;
  method?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
  body?: string;
}

export interface NetworkProbeResult {
  ok: boolean;
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  elapsedMs: number;
  error?: string;
}

export interface NetworkProbeOptions {
  /**
   * Base URL of the runner, e.g. `http://localhost:9876`. Defaults to
   * same-origin for browser callers. Required when running from Node.
   */
  baseUrl?: string;
  /** Optional fetch implementation (useful for tests). */
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/**
 * Perform a server-side HTTP request against a loopback target.
 *
 * @throws if the network call to the runner itself fails, or the runner
 *   rejects the request (e.g. non-loopback host, invalid URL, non-2xx response).
 *   The target-server-failure case (e.g. connection refused to the probed
 *   backend) is not an error — it's surfaced as `{ ok: false, error: "..." }`.
 */
export async function networkProbe(
  request: NetworkProbeRequest,
  options: NetworkProbeOptions = {}
): Promise<NetworkProbeResult> {
  const { baseUrl = '', fetchImpl = fetch, signal } = options;
  const url = `${baseUrl.replace(/\/+$/, '')}/ui-bridge/ai/network-probe`;

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `ai/network-probe: HTTP ${response.status} ${response.statusText}${text ? ` — ${text}` : ''}`
    );
  }

  const envelope = (await response.json()) as {
    success: boolean;
    data?: NetworkProbeResult;
    error?: string;
  };

  if (!envelope.success || !envelope.data) {
    throw new Error(`ai/network-probe: ${envelope.error ?? 'request failed'}`);
  }

  return envelope.data;
}
