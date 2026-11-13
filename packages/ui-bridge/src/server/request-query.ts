/**
 * The query object an HTTP adapter hands a `queryRequired` route's handler —
 * built ONE way by the two adapters that read a WHATWG `URLSearchParams`: the
 * Next.js adapter (`nextjs.ts`) and the standalone server (`standalone.ts`).
 *
 * A key given once is its string. A key given more than once keeps its LAST
 * value, as `Object.fromEntries` gave every key and as every scalar option
 * (`tabId`, `limit`, `since`, …) still gets — except the list-valued keys
 * ({@link LIST_QUERY_KEYS}), which keep EVERY value, in order:
 * `?properties=hyphens&properties=outline-offset` reaches the handler as
 * `['hyphens', 'outline-offset']`, the same list Express's own query parser
 * builds for it (`req.query` in `express.ts`), and each value may itself be a
 * comma-separated list. Before this, both adapters built the query with
 * `Object.fromEntries`, so a repeated `properties` key silently lost every name
 * but the last while Express read them all.
 */

import { PROJECTION_OPTIONS } from '../core/element-projection';

/**
 * The query keys whose value is a list, so a repeated key adds to it: the
 * request-scoped projection of `GET /control/element/:id/state`
 * (`ElementStateQuery` in `types.ts`).
 */
export const LIST_QUERY_KEYS: readonly string[] = PROJECTION_OPTIONS;

/** The query object for `searchParams` — see the module doc. */
export function routeQueryOf(searchParams: URLSearchParams): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = Object.fromEntries(searchParams);
  for (const key of LIST_QUERY_KEYS) {
    const values = searchParams.getAll(key);
    if (values.length > 1) query[key] = values;
  }
  return query;
}
