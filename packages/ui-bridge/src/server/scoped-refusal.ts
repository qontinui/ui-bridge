/**
 * Some relay-wide structures name no tab or user: the SSE event streams, the
 * server-side change-event buffer and render log, and the Chrome tabs the
 * server can reach over CDP. They cannot be scoped to a caller, so when a
 * caller identity is present (`X-Caller-User-Id`: the multi-user mode of
 * per-user tab scoping, §4.2) they are refused with this typed answer
 * rather than served across users. With no identity they are served as
 * before.
 */

export const SCOPED_CALLER_UNSUPPORTED = 'SCOPED_CALLER_UNSUPPORTED';

/** The JSON body refusing `what` to a scoped caller; send it with HTTP 403. */
export function scopedCallerRefusal(what: string): {
  success: false;
  error: string;
  code: typeof SCOPED_CALLER_UNSUPPORTED;
  timestamp: number;
} {
  return {
    success: false,
    error: `${what} names no tab or user, so it is not served to a caller scoped by X-Caller-User-Id.`,
    code: SCOPED_CALLER_UNSUPPORTED,
    timestamp: Date.now(),
  };
}
