/**
 * `__callerUserId` is the relay's reserved routing key for the caller identity
 * (per-user tab scoping, §4.2). Only an HTTP adapter writes it, from the
 * identity the consumer's auth gate verified (`X-Caller-User-Id`). Request
 * data never carries it: each adapter strips every request-supplied copy from
 * the body and the query object (at any depth, inside arrays included) before
 * it splices in the verified one.
 *
 * The relay also ranks the verified context above any payload identity
 * (`scopedCaller` in `relay-handlers.ts`), so a transport that skips this
 * strip still cannot let a request name the caller.
 */

export const RESERVED_CALLER_KEY = '__callerUserId';

/**
 * Nesting deeper than this is returned as it is. The relay reads a payload
 * identity only at the top level and on the nested `request` object, so the
 * bound costs nothing there, and it keeps a pathologically deep body from
 * exhausting the stack.
 */
const MAX_DEPTH = 64;

/**
 * `value` without any `__callerUserId` property, at any depth (objects and
 * arrays both). A primitive comes back unchanged, and so does any value that
 * carries no such property; otherwise the result is a copy and `value` is
 * never mutated. Copies are built with `Object.fromEntries`, so an own key
 * named `__proto__` stays a plain own property and never becomes a prototype.
 */
export function withoutReservedCaller<T>(value: T): T {
  return strip(value, 0) as T;
}

function strip(value: unknown, depth: number): unknown {
  if (value === null || typeof value !== 'object' || depth > MAX_DEPTH) return value;
  if (Array.isArray(value)) {
    let changed = false;
    const items = value.map((item) => {
      const stripped = strip(item, depth + 1);
      if (stripped !== item) changed = true;
      return stripped;
    });
    return changed ? items : value;
  }
  let changed = false;
  const entries: Array<[string, unknown]> = [];
  for (const [key, item] of Object.entries(value)) {
    if (key === RESERVED_CALLER_KEY) {
      changed = true;
      continue;
    }
    const stripped = strip(item, depth + 1);
    if (stripped !== item) changed = true;
    entries.push([key, stripped]);
  }
  return changed ? Object.fromEntries(entries) : value;
}
