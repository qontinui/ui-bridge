/**
 * Settle tracker for the injected runtime.
 *
 * The injected registry is kept live by a `MutationObserver` (`observeAndSeed`),
 * so on a client-rendered SPA the registry starts empty at `ready` and fills in
 * as the app paints. `ready` therefore can't tell a driver "the page is actually
 * drivable" — it only means "the runtime is live". This tracker adds that
 * missing signal: the DOM is **settled** once a seed pass has registered at
 * least one interactive element AND no further re-seed fires for a quiet window
 * — or a hard timeout elapses (so genuinely-empty or never-quiet pages still
 * resolve).
 *
 * Pure and DOM-free: it's driven by `noteSeed(elementCount)` (one call per seed
 * pass) plus the ambient timer functions, so it unit-tests cleanly under fake
 * timers and carries no dependency on `document` / `MutationObserver`.
 */

/** Snapshot of the tracker's state, returned by {@link SettleTracker.whenSettled}. */
export interface SettleState {
  /** True once the DOM is considered settled (see module docs). */
  settled: boolean;
  /** Interactive elements registered as of the most recent seed pass. */
  elementCount: number;
}

/** Construction options for {@link createSettleTracker}. */
export interface SettleTrackerOptions {
  /** Quiet window (ms) with no further re-seed before declaring settled. */
  quietMs: number;
  /**
   * Hard cap (ms) after `start()` after which the tracker declares itself
   * settled regardless of ongoing mutations. Covers never-quiet pages (e.g.
   * perpetual animations/analytics) and legitimately empty ones.
   */
  timeoutMs: number;
}

/** A DOM-free settle state machine. See module docs. */
export interface SettleTracker {
  /** True once settled (quiet window elapsed after content, or cap hit). */
  readonly settled: boolean;
  /** Interactive elements registered as of the most recent seed pass. */
  readonly elementCount: number;
  /** Begin the hard-timeout cap. Idempotent; call when observation starts. */
  start(): void;
  /**
   * Record a seed pass. `elementCount` is the registry's element count after
   * the pass. Once it is > 0 the quiet countdown (re)arms; further passes reset
   * it, so settle fires only after the DOM goes quiet.
   */
  noteSeed(elementCount: number): void;
  /**
   * Resolve when settled, or after `timeoutMs` (defaults to the construction
   * `timeoutMs`). Resolves immediately if already settled. The resolved value
   * reflects the state at resolution time, so a timed-out wait reports
   * `settled: false`.
   */
  whenSettled(timeoutMs?: number): Promise<SettleState>;
  /** Clear timers (teardown). Pending `whenSettled` promises are left unsettled. */
  dispose(): void;
}

export function createSettleTracker(options: SettleTrackerOptions): SettleTracker {
  const { quietMs, timeoutMs } = options;
  let settled = false;
  let elementCount = 0;
  let quietTimer: ReturnType<typeof setTimeout> | null = null;
  let capTimer: ReturnType<typeof setTimeout> | null = null;
  const waiters: Array<(s: SettleState) => void> = [];

  const snapshot = (): SettleState => ({ settled, elementCount });

  const clearQuiet = (): void => {
    if (quietTimer) {
      clearTimeout(quietTimer);
      quietTimer = null;
    }
  };
  const clearCap = (): void => {
    if (capTimer) {
      clearTimeout(capTimer);
      capTimer = null;
    }
  };

  const markSettled = (): void => {
    if (settled) return;
    settled = true;
    clearQuiet();
    clearCap();
    const s = snapshot();
    while (waiters.length) {
      const resolve = waiters.shift();
      resolve?.(s);
    }
  };

  return {
    get settled() {
      return settled;
    },
    get elementCount() {
      return elementCount;
    },
    start() {
      if (settled || capTimer) return;
      capTimer = setTimeout(markSettled, timeoutMs);
    },
    noteSeed(count: number) {
      elementCount = count;
      if (settled) return;
      // Only start the quiet countdown once the page actually has content;
      // every subsequent content-bearing pass resets it (DOM still changing).
      if (count > 0) {
        clearQuiet();
        quietTimer = setTimeout(markSettled, quietMs);
      }
    },
    whenSettled(customTimeoutMs?: number) {
      if (settled) return Promise.resolve(snapshot());
      return new Promise<SettleState>((resolve) => {
        let done = false;
        const finish = (s: SettleState): void => {
          if (done) return;
          done = true;
          resolve(s);
        };
        waiters.push(finish);
        const limit = typeof customTimeoutMs === 'number' ? customTimeoutMs : timeoutMs;
        setTimeout(() => finish(snapshot()), limit);
      });
    },
    dispose() {
      clearQuiet();
      clearCap();
    },
  };
}
