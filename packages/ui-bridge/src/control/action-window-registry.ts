/**
 * D3 Effect Calculus — Action Window Registry (Phase 2)
 *
 * A process-singleton that tracks in-flight action "settle windows" so that
 * concurrent background changes (observed by {@link ../ai/background-observer})
 * can be attributed to (or distinguished from) the action under verification.
 *
 * The verifier ({@link ./effect-verifier}) opens a window with {@link
 * ActionWindowRegistry.begin} just before it runs the action and closes it with
 * {@link ActionWindowRegistry.end} right after the post-snapshot. While a window
 * is open, the BackgroundObserver calls {@link
 * ActionWindowRegistry.recordConcurrentObservation} whenever it detects a
 * significant change — flagging every currently-open window. The verifier then
 * reads {@link ActionWindowRegistry.hadConcurrentObservation} to decide whether
 * the cause is `'causal'` (clean) or `'mixed'` (concurrent background activity
 * muddied the window).
 *
 * Pure bookkeeping: no DOM access, no timers. Fully unit-testable.
 */

/**
 * A single in-flight action settle window.
 */
export interface ActionWindow {
  /** The action's request id (or a synthesized id when none was supplied). */
  requestId: string;
  /** The action name (e.g. `click`, `navigate`). */
  action: string;
  /** Window open time, ms (epoch). */
  startMs: number;
  /** Window close time, ms (epoch) = `startMs + settleMs`. */
  endMs: number;
  /** Set true the first time a concurrent observation lands inside this window. */
  sawConcurrentObservation: boolean;
}

/** How many recently-ended windows to retain so the flag survives `end()`. */
const RECENTLY_ENDED_CAP = 50;

export class ActionWindowRegistry {
  /** Currently-open windows, keyed by requestId. */
  private readonly open = new Map<string, ActionWindow>();
  /**
   * Bounded snapshot of the `sawConcurrentObservation` flag for the last
   * {@link RECENTLY_ENDED_CAP} ended windows, so the verifier can read the
   * flag a moment after calling {@link end}. Insertion-ordered (oldest first)
   * so eviction is a cheap shift of the first key.
   */
  private readonly recentlyEnded = new Map<string, boolean>();

  /**
   * Open a settle window for an action. `endMs = nowMs + settleMs`.
   * A duplicate requestId overwrites the prior open window.
   */
  begin(requestId: string, action: string, nowMs: number, settleMs: number): void {
    this.open.set(requestId, {
      requestId,
      action,
      startMs: nowMs,
      endMs: nowMs + settleMs,
      sawConcurrentObservation: false,
    });
  }

  /**
   * Close a window. Captures the window's `sawConcurrentObservation` flag into
   * a small bounded recently-ended map so a later
   * {@link hadConcurrentObservation} still returns the right value briefly
   * after the window closed. No-op for an unknown requestId.
   */
  end(requestId: string): void {
    const window = this.open.get(requestId);
    if (!window) return;
    this.open.delete(requestId);
    this.rememberEnded(requestId, window.sawConcurrentObservation);
  }

  /** Is `atMs` inside (inclusive) at least one currently-open window? */
  isWithinAnyWindow(atMs: number): boolean {
    for (const w of this.open.values()) {
      if (atMs >= w.startMs && atMs <= w.endMs) return true;
    }
    return false;
  }

  /**
   * Called by the BackgroundObserver when it detects a significant change.
   * Flags every currently-open window whose interval contains `atMs` as having
   * concurrent background activity.
   */
  recordConcurrentObservation(atMs: number): void {
    for (const w of this.open.values()) {
      if (atMs >= w.startMs && atMs <= w.endMs) {
        w.sawConcurrentObservation = true;
      }
    }
  }

  /**
   * Did the (possibly already-ended) window for `requestId` see a concurrent
   * observation? Reads the open window if still present, else the bounded
   * recently-ended map. Returns `false` for a fully-unknown requestId.
   */
  hadConcurrentObservation(requestId: string): boolean {
    const open = this.open.get(requestId);
    if (open) return open.sawConcurrentObservation;
    return this.recentlyEnded.get(requestId) ?? false;
  }

  /** Number of currently-open windows (test/diagnostic aid). */
  get openCount(): number {
    return this.open.size;
  }

  private rememberEnded(requestId: string, saw: boolean): void {
    // Re-insert to refresh insertion order, then evict the oldest if over cap.
    this.recentlyEnded.delete(requestId);
    this.recentlyEnded.set(requestId, saw);
    while (this.recentlyEnded.size > RECENTLY_ENDED_CAP) {
      const oldest = this.recentlyEnded.keys().next().value;
      if (oldest === undefined) break;
      this.recentlyEnded.delete(oldest);
    }
  }
}

// ---------------------------------------------------------------------------
// Process singleton (same lazy-on-globalThis pattern as getGlobalArtifactStore
// / getGlobalCtr / getGlobalRegistry in this codebase).
// ---------------------------------------------------------------------------

const GLOBAL_KEY = '__uiBridgeActionWindowRegistry';

export function getGlobalActionWindowRegistry(): ActionWindowRegistry {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new ActionWindowRegistry();
  }
  return g[GLOBAL_KEY] as ActionWindowRegistry;
}

export function setGlobalActionWindowRegistry(registry: ActionWindowRegistry): void {
  (globalThis as Record<string, unknown>)[GLOBAL_KEY] = registry;
}

export function resetGlobalActionWindowRegistry(): void {
  delete (globalThis as Record<string, unknown>)[GLOBAL_KEY];
}
