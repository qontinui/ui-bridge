/**
 * Resilient TCP-bind helper for native UI Bridge server adapters.
 *
 * Background: the on-device bridge binds a TCP server on a fixed port (8087).
 * On hot-reload, app foreground/background cycles, or a crash-restart, the OS
 * can leave the previous socket in a lingering state, so the fresh bind fails
 * with `EADDRINUSE`. The original adapter gave up after 3 fixed retries
 * (~5s total), after which the bridge was permanently dead until the app was
 * fully restarted — a single transient stale socket bricked automation.
 *
 * This helper centralises a robust bind loop so every adapter (and a unit
 * test) shares one implementation:
 *   - SO_REUSEADDR is requested on bind where the platform/library supports it
 *     (passed through to the caller's `attempt` via `reuseAddress: true`), so
 *     a lingering TIME_WAIT socket doesn't block rebind.
 *   - On `EADDRINUSE` it retries with exponential backoff (capped) for at
 *     least `minTotalMs` (default 30s) instead of bailing after a fixed count.
 *   - Every retry is logged so operators can see the bridge recovering.
 *   - Non-`EADDRINUSE` errors fail fast (a wrong-permission / bad-host error
 *     won't fix itself by waiting).
 *
 * The helper is transport-agnostic: the caller supplies an `attempt` thunk
 * that performs ONE bind attempt and resolves on `listening` / rejects on
 * error. This keeps the package free of any concrete TCP library dependency
 * (the same reason `ServerAdapter` is an interface).
 */

/** True when an error looks like an address-already-in-use bind failure. */
export function isAddrInUseError(err: unknown): boolean {
  const message =
    err instanceof Error ? err.message : typeof err === 'string' ? err : String(err);
  // Some RN TCP libraries surface a `.code` instead of (or alongside) the
  // message — check both.
  const code = (err as { code?: unknown })?.code;
  return (
    message.includes('EADDRINUSE') ||
    message.toLowerCase().includes('address already in use') ||
    code === 'EADDRINUSE'
  );
}

export interface BindWithRetryOptions {
  /**
   * Minimum total wall-clock time to keep retrying `EADDRINUSE` before giving
   * up, in milliseconds. The loop always makes at least one attempt and keeps
   * retrying until this budget is exhausted. Default 30_000 (30s).
   *
   * Pass `Infinity` to retry indefinitely (with capped backoff) — appropriate
   * for an always-on device bridge that should self-heal whenever the stale
   * socket finally clears.
   */
  minTotalMs?: number;
  /** Initial backoff delay between retries, in ms. Default 500. */
  initialDelayMs?: number;
  /** Maximum backoff delay (cap for exponential growth), in ms. Default 5_000. */
  maxDelayMs?: number;
  /** Multiplier applied to the delay after each retry. Default 2. */
  backoffFactor?: number;
  /** Logger for retry diagnostics. Defaults to `console`. */
  logger?: Pick<Console, 'warn' | 'error'>;
  /** Injectable sleep — overridable in tests to avoid real timers. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable clock — overridable in tests. Defaults to `Date.now`. */
  now?: () => number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `attempt()` repeatedly until it resolves, retrying on `EADDRINUSE` with
 * exponential backoff for at least `minTotalMs`. Non-address-in-use errors
 * reject immediately. Resolves once a bind attempt succeeds.
 *
 * @param attempt One bind attempt. Receives the attempt index (0-based) and
 *   MUST resolve on a successful `listening` event or reject on error. The
 *   caller is responsible for tearing down any half-bound server before the
 *   next attempt (see the adapter's `recreate` thunk).
 */
export async function bindWithRetry(
  attempt: (attemptIndex: number) => Promise<void>,
  options: BindWithRetryOptions = {}
): Promise<void> {
  const {
    minTotalMs = 30_000,
    initialDelayMs = 500,
    maxDelayMs = 5_000,
    backoffFactor = 2,
    logger = console,
    sleep = defaultSleep,
    now = Date.now,
  } = options;

  const startedAt = now();
  let delay = initialDelayMs;
  let attemptIndex = 0;

  for (;;) {
    try {
      await attempt(attemptIndex);
      return; // bound successfully
    } catch (err) {
      const elapsed = now() - startedAt;
      const budgetExhausted = elapsed + delay >= minTotalMs;

      if (!isAddrInUseError(err) || budgetExhausted) {
        // Either a non-recoverable error, or we've spent our retry budget.
        throw err;
      }

      logger.warn(
        `[ui-bridge-native] bind failed with EADDRINUSE (attempt ${attemptIndex + 1}); ` +
          `retrying in ${delay}ms (elapsed ${elapsed}ms / budget ${
            minTotalMs === Infinity ? '∞' : minTotalMs
          }ms)`
      );

      await sleep(delay);
      delay = Math.min(delay * backoffFactor, maxDelayMs);
      attemptIndex += 1;
    }
  }
}
