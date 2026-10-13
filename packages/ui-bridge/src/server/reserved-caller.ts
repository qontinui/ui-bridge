/**
 * `__callerUserId` is the relay's reserved routing key for the caller identity
 * (per-user tab scoping, §4.2). Only an HTTP adapter writes it, from the
 * identity the consumer's auth gate verified (`X-Caller-User-Id`). Request
 * data never carries it: each adapter strips a request-supplied copy from the
 * body or query object before it splices in the verified one.
 *
 * The relay also ranks the verified context above any payload identity
 * (`scopedCaller` in `relay-handlers.ts`), so a transport that skips this
 * strip still cannot let a request name the caller.
 */

export const RESERVED_CALLER_KEY = '__callerUserId';

/**
 * `value` without a top-level `__callerUserId`. A non-object (`null`, an
 * array, a primitive) comes back unchanged, and so does an object that does
 * not carry the key. Otherwise the result is a shallow copy; `value` is never
 * mutated.
 */
export function withoutReservedCaller<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  if (!Object.prototype.hasOwnProperty.call(value, RESERVED_CALLER_KEY)) return value;
  const { [RESERVED_CALLER_KEY]: _requestSupplied, ...rest } = value as Record<string, unknown>;
  return rest as T;
}
