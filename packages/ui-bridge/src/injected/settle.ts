/**
 * Settle tracker for the injected runtime.
 *
 * The injected registry is kept live by a `MutationObserver` (`observeAndSeed`),
 * so on a client-rendered SPA the registry starts empty at `ready` and fills in
 * as the app paints. `ready` therefore can't tell a driver "the page is actually
 * drivable" — it only means "the runtime is live". This tracker adds that
 * missing signal: the DOM is **settled** once a seed pass's gating condition is
 * met AND no further re-seed fires for a quiet window — or a hard timeout
 * elapses (so genuinely-empty or never-quiet pages still resolve).
 *
 * The gating condition per seed pass is supplied by the caller as `satisfied`
 * (defaulting to "registered ≥1 element"). A driver that knows which control it
 * needs can pass a stricter predicate (e.g. "an element matching the expected
 * selector exists"), so settle won't fire early on unrelated chrome that paints
 * before a lazily-mounted auth widget. When the hard cap fires while the
 * condition is still unmet, the tracker still settles but flags
 * `settledByTimeout` + `expectSatisfied: false`, so the driver can distinguish a
 * clean settle from "the expected control never appeared".
 *
 * Pure and DOM-free: it's driven by `noteSeed(elementCount, satisfied?)` (one
 * call per seed pass) plus the ambient timer functions, so it unit-tests cleanly
 * under fake timers and carries no dependency on `document` / `MutationObserver`.
 */

/** Snapshot of the tracker's state, returned by {@link SettleTracker.whenSettled}. */
export interface SettleState {
  /** True once the DOM is considered settled (see module docs). */
  settled: boolean;
  /** Interactive elements registered as of the most recent seed pass. */
  elementCount: number;
  /**
   * True when the settle was forced by the hard timeout cap rather than by the
   * gating condition going quiet. A timeout settle with `expectSatisfied: false`
   * means "the expected content never appeared in time" — a driver should treat
   * that as BLOCKED, not a clean settle.
   */
  settledByTimeout: boolean;
  /**
   * Whether the gating condition was met as of settle (or, before settle, as of
   * the most recent seed pass). With no expected-selector gate this tracks
   * "≥1 element registered"; with one, "the expected selector matched".
   */
  expectSatisfied: boolean;
}

/** Construction options for {@link createSettleTracker}. */
export interface SettleTrackerOptions {
  /** Quiet window (ms) with no further re-seed before declaring settled. */
  quietMs: number;
  /**
   * Hard cap (ms) after `start()` after which the tracker declares itself
   * settled regardless of the gating condition. Covers never-quiet pages (e.g.
   * perpetual animations/analytics), legitimately empty ones, and pages whose
   * expected control never appears.
   */
  timeoutMs: number;
}

/** A DOM-free settle state machine. See module docs. */
export interface SettleTracker {
  /** True once settled (quiet window elapsed after the condition met, or cap hit). */
  readonly settled: boolean;
  /** Interactive elements registered as of the most recent seed pass. */
  readonly elementCount: number;
  /** True when settle was forced by the hard cap rather than a clean quiet window. */
  readonly settledByTimeout: boolean;
  /** Whether the gating condition was met as of the latest seed pass / settle. */
  readonly expectSatisfied: boolean;
  /** Begin the hard-timeout cap. Idempotent; call when observation starts. */
  start(): void;
  /**
   * Record a seed pass. `elementCount` is the registry's element count after the
   * pass. `satisfied` is the gating condition for this pass; it defaults to
   * `elementCount > 0` (the original "page has content" behavior). The quiet
   * countdown (re)arms only while `satisfied` is true; each satisfied pass resets
   * it, so settle fires only after the gated DOM goes quiet.
   */
  noteSeed(elementCount: number, satisfied?: boolean): void;
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
  let settledByTimeout = false;
  let elementCount = 0;
  let lastSatisfied = false;
  let quietTimer: ReturnType<typeof setTimeout> | null = null;
  let capTimer: ReturnType<typeof setTimeout> | null = null;
  const waiters: Array<(s: SettleState) => void> = [];

  const snapshot = (): SettleState => ({
    settled,
    elementCount,
    settledByTimeout,
    expectSatisfied: lastSatisfied,
  });

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

  const markSettled = (viaTimeout: boolean): void => {
    if (settled) return;
    settled = true;
    settledByTimeout = viaTimeout;
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
    get settledByTimeout() {
      return settledByTimeout;
    },
    get expectSatisfied() {
      return lastSatisfied;
    },
    start() {
      if (settled || capTimer) return;
      capTimer = setTimeout(() => markSettled(true), timeoutMs);
    },
    noteSeed(count: number, satisfied?: boolean) {
      elementCount = count;
      lastSatisfied = satisfied ?? count > 0;
      if (settled) return;
      // Arm the quiet countdown only while the gating condition holds; each
      // satisfied pass resets it (the gated DOM is still changing). If a pass is
      // NOT satisfied, cancel any pending countdown — we're not settled-eligible
      // until the condition is met again.
      if (lastSatisfied) {
        clearQuiet();
        quietTimer = setTimeout(() => markSettled(false), quietMs);
      } else {
        clearQuiet();
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
