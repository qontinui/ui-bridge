/**
 * Shared log hygiene for the two WebSocket clients that dial the cloud relay.
 *
 * `CloudRelayClient` and `DeviceAnnouncer` build the SAME URL from the SAME
 * credential — `<relayUrl>?token=<authToken>` — and both hand their diagnostics
 * to `transportLogger`, whose sink (the observability ring buffer behind
 * `GET /control/console-errors`) is readable by anything that can reach the
 * bridge. When these helpers lived as file-private functions inside
 * `CloudRelayClient`, fixing that client's token leak left the announcer's
 * identical `transportLogger.log('… connecting to', url)` untouched: one secret,
 * two sinks, one of them redacted.
 *
 * They live here so a third dialler cannot repeat that, and so the redaction
 * rule has exactly one definition to test.
 */

/**
 * Query-parameter names whose VALUE is a credential and must never be logged.
 *
 * Both diallers build `<relayUrl>?token=<authToken>` today, so `token` is the
 * only name that matters right now. The rest are here because this function's
 * whole purpose is to be the one place the rule lives: a relay URL that later
 * spells the credential `access_token` or signs with `sig` would otherwise sail
 * through a redactor that everything else trusts. Over-redacting a log line
 * costs nothing; under-redacting one costs a device credential.
 */
const CREDENTIAL_PARAMS = ['token', 'access_token', 'auth', 'authorization', 'key', 'sig'];

const CREDENTIAL_PARAM_RE = new RegExp(`([?&](?:${CREDENTIAL_PARAMS.join('|')})=)[^&#]*`, 'gi');

/** `wss://user:secret@host/…` — credentials in the URL's userinfo component. */
const USERINFO_RE = /^([a-z][a-z0-9+.-]*:\/\/)[^/?#@]*@/i;

/**
 * Replace credential values in a relay URL with a marker.
 *
 * The relay URL is built as `<relayUrl>?token=<authToken>`; every log line that
 * names the target URL goes through here first so the device auth token never
 * lands in a log file, a console-error ring buffer, or a bug report.
 *
 * Redacts every {@link CREDENTIAL_PARAMS} query value plus any `user:pass@`
 * userinfo. It does NOT attempt to find secrets in a path segment or a fragment
 * — a URL that puts one there needs a different fix, not a cleverer regex.
 */
export function redactRelayUrl(url: string): string {
  return url.replace(USERINFO_RE, '$1<redacted>@').replace(CREDENTIAL_PARAM_RE, '$1<redacted>');
}

/**
 * Render a WebSocket close event as `code=… reason=… wasClean=…`.
 *
 * Read defensively: React Native's WebSocket delivers a plain object rather
 * than a DOM `CloseEvent`, and a missing field must read `unknown` rather than
 * silently print `undefined` as if the relay had told us something.
 *
 * The close CODE is the whole diagnosis — 1006 is "no close frame"
 * (network/TLS died), 1008/4001-class codes are the relay rejecting our token,
 * 1001 is the backend going away. Logging the raw event instead says nothing: a
 * DOM `CloseEvent` has no own enumerable properties, so the observability
 * capture's `JSON.stringify` renders it as `{}`.
 */
export function describeCloseEvent(event: unknown): string {
  const e = (event ?? {}) as { code?: unknown; reason?: unknown; wasClean?: unknown };
  const code = typeof e.code === 'number' ? String(e.code) : 'unknown';
  const reason = typeof e.reason === 'string' && e.reason.length > 0 ? e.reason : '(none)';
  const wasClean = typeof e.wasClean === 'boolean' ? String(e.wasClean) : 'unknown';
  return `code=${code} reason=${reason} wasClean=${wasClean}`;
}

/**
 * Render a WebSocket error event. React Native puts the useful text on
 * `message`; some transports also carry an `Error` on `error`, and a few
 * surface a close `code` on the error event itself.
 *
 * Same `{}`-stringification trap as {@link describeCloseEvent}.
 */
export function describeErrorEvent(event: unknown): string {
  const e = (event ?? {}) as { message?: unknown; error?: unknown; code?: unknown };
  const parts: string[] = [];
  if (typeof e.message === 'string' && e.message.length > 0) parts.push(`message=${e.message}`);
  if (e.error instanceof Error) parts.push(`error=${e.error.message}`);
  else if (typeof e.error === 'string' && e.error.length > 0) parts.push(`error=${e.error}`);
  if (typeof e.code === 'number') parts.push(`code=${e.code}`);
  if (parts.length === 0) parts.push('message=(none reported by the transport)');
  return parts.join(' ');
}
