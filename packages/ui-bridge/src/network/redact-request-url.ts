/**
 * Request-URL redaction shared by every surface that reports a request URL
 * out of the page: the change tracker's interaction timeline
 * (`ai/timeline-recorder.ts`) and the browser capture's resource-status
 * events (`debug/captures/resource-status.ts`).
 *
 * A request URL's query string routinely carries credentials (signed-URL
 * tokens, session ids, API keys), so neither surface may report it. What is
 * kept is the origin + pathname, plus whether a query was present at all.
 */

/** Origin + pathname of a request URL, and whether it carried a query. Never the query itself. */
export function redactRequestUrl(raw: string): { url: string; hasQuery: boolean } {
  try {
    const base =
      typeof location !== 'undefined' && location.href ? location.href : 'http://localhost/';
    const u = new URL(raw, base);
    // data:, blob:, … carry their payload in the "path": report the scheme only.
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return { url: u.protocol, hasQuery: false };
    }
    return { url: `${u.origin}${u.pathname}`, hasQuery: u.search.length > 1 };
  } catch {
    const q = raw.indexOf('?');
    const h = raw.indexOf('#');
    const cut = [q, h].filter((i) => i >= 0);
    const end = cut.length > 0 ? Math.min(...cut) : raw.length;
    const query = q >= 0 ? raw.slice(q + 1, h > q ? h : undefined) : '';
    return { url: raw.slice(0, end), hasQuery: query.length > 0 };
  }
}
