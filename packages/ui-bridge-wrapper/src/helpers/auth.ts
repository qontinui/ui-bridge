/**
 * `withAuthRefresh`
 *
 * Runs `fn` once; if it throws an auth-expired error, invokes `refresh`
 * (expected to refresh tokens / re-authenticate) and re-runs `fn` exactly
 * once. Designed for wrappers whose `api` transport handlers call
 * third-party APIs with short-lived access tokens.
 *
 * Consumers can override the detector via `isAuthError`. The default
 * treats `WrapperTransportError` with codes matching `/^(AUTH|UNAUTH|401)/i`
 * as auth errors, and errors with a numeric `status === 401` property.
 */

import { WrapperTransportError } from '../types.js';

export interface WithAuthRefreshOptions {
  /** Custom detector for "this error means we need to refresh auth". */
  isAuthError?: (err: unknown) => boolean;
}

const defaultIsAuthError = (err: unknown): boolean => {
  if (err instanceof WrapperTransportError) {
    return /^(AUTH|UNAUTH|401)/i.test(err.code);
  }
  const status = (err as { status?: unknown } | null)?.status;
  if (status === 401) return true;
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^(AUTH|UNAUTH|401)/i.test(code)) return true;
  return false;
};

export async function withAuthRefresh<T>(
  fn: () => Promise<T>,
  refresh: () => Promise<void>,
  opts: WithAuthRefreshOptions = {}
): Promise<T> {
  const isAuthError = opts.isAuthError ?? defaultIsAuthError;
  try {
    return await fn();
  } catch (err) {
    if (!isAuthError(err)) throw err;
    await refresh();
    return fn();
  }
}
