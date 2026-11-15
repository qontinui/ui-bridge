/**
 * D3 Effect Calculus — Action Window Registry (Phase 2)
 *
 * A process-singleton that tracks in-flight action "settle windows" so that
 * concurrent background changes (observed by {@link ../ai/background-observer})
 * can be attributed to (or distinguished from) the action under verification.
 *
 * The verifier ({@link ./effect-verifier}) opens a window with {@link
 * ActionWindowRegistry.beginAction} just before it runs the action, fixes the
 * window's end with {@link ActionWindowRegistry.anchorSettle} when the settle
 * starts, and closes it with {@link ActionWindowRegistry.end} right after the
 * post-snapshot. While a window is open, the BackgroundObserver calls {@link
 * ActionWindowRegistry.recordConcurrentObservation} whenever it detects a
 * significant change — flagging every currently-open window. The verifier then
 * reads {@link ActionWindowRegistry.hadConcurrentObservation} to decide whether
 * the cause is `'causal'` (clean) or `'mixed'` (concurrent background activity
 * muddied the window) — or `'unknown'`, when the window expired un-anchored
 * and later observations could not be attributed at all.
 *
 * Pure bookkeeping: no DOM access, no timers. Fully unit-testable.
 */

declare const actionWindowHandleBrand: unique symbol;

/**
 * Opaque handle for one opened window, returned by {@link
 * ActionWindowRegistry.beginAction} and passed back to {@link
 * ActionWindowRegistry.anchorSettle}, {@link ActionWindowRegistry.end} and
 * {@link ActionWindowRegistry.hadConcurrentObservation}. Unique per registry,
 * so two overlapping actions that share a client requestId keep separate
 * windows. NOT meaningful across registries: every registry numbers its
 * handles from 1, so a handle issued by another registry may address one of
 * this registry's windows. The brand stops a plain number or a request id
 * being passed by accident at compile time; it is not a runtime proof of
 * origin. A request-id lookup is a separate method, {@link
 * ActionWindowRegistry.hadConcurrentObservationForRequest}.
 */
export type ActionWindowHandle = number & { readonly [actionWindowHandleBrand]: true };

/**
 * A single in-flight action settle window.
 */
export interface ActionWindow {
  /** This window's unique handle. */
  handle: ActionWindowHandle;
  /** The action's request id (or a synthesized id when none was supplied). */
  requestId: string;
  /** The action name (e.g. `click`, `navigate`). */
  action: string;
  /** Window open time, ms (epoch). */
  startMs: number;
  /**
   * Window close time, ms (epoch). A window opened with {@link
   * ActionWindowRegistry.beginAction} has no end yet (`Infinity`) until
   * {@link ActionWindowRegistry.anchorSettle} sets it to
   * `settleStart + settleMs`.
   */
  endMs: number;
  /**
   * Latest time an UN-anchored window may still match, ms (epoch):
   * `startMs + maxOpenMs`. Past it the window is treated as closed and pruned,
   * so an action that never returns cannot hold a window open forever.
   * `Infinity` once the window is anchored.
   */
  unanchoredDeadlineMs: number;
  /** Set true the first time a concurrent observation lands inside this window. */
  sawConcurrentObservation: boolean;
}

/** How many recently-ended windows to retain so the flag survives `end()`. */
const RECENTLY_ENDED_CAP = 50;

/**
 * Floor (and, for an action with no timeout of its own, the whole bound) on
 * how long an un-anchored window (opened by {@link
 * ActionWindowRegistry.beginAction}, settle not yet started) may stay open.
 * An action that never resolves would otherwise leave an `endMs = Infinity`
 * window behind for the life of the process, and every later background
 * capture would be labelled `'concurrent'`. Past the bound the window is
 * treated as closed and pruned. An action with a known timeout gets a longer
 * bound — see {@link unanchoredBoundForTimeout}.
 */
export const MAX_UNANCHORED_WINDOW_MS = 30_000;

/**
 * Slack added to an action's own timeout when sizing its un-anchored bound:
 * the action is abandoned at its timeout, and the verifier anchors the settle
 * only after the abandoned call returns, so the window must outlive the
 * timeout by the time that takes.
 */
export const UNANCHORED_WINDOW_TIMEOUT_MARGIN_MS = 5_000;

/**
 * The un-anchored bound for an action whose timeout is `timeoutMs` (ms), or
 * has none (`undefined`): `max(timeoutMs + margin, MAX_UNANCHORED_WINDOW_MS)`.
 * A legitimately long action (component actions accept timeouts up to 24 h)
 * must keep its window for as long as it may run, or its later observations
 * would be dropped and the cause would silently read `'causal'`.
 */
export function unanchoredBoundForTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) return MAX_UNANCHORED_WINDOW_MS;
  return Math.max(timeoutMs + UNANCHORED_WINDOW_TIMEOUT_MARGIN_MS, MAX_UNANCHORED_WINDOW_MS);
}

interface EndedWindow {
  requestId: string;
  saw: boolean;
}

export class ActionWindowRegistry {
  /** Currently-open windows, keyed by their unique handle. */
  private readonly open = new Map<ActionWindowHandle, ActionWindow>();
  /**
   * Bounded snapshot of the `sawConcurrentObservation` flag for the last
   * {@link RECENTLY_ENDED_CAP} ended windows, so the verifier can read the
   * flag a moment after calling {@link end}. Insertion-ordered (oldest first)
   * so eviction is a cheap shift of the first key.
   */
  private readonly recentlyEnded = new Map<ActionWindowHandle, EndedWindow>();
  /** Next handle to issue. Starts at 1 in every registry (see {@link ActionWindowHandle}). */
  private nextHandle = 1;

  /**
   * Open a window for an action that is about to run and whose settle has not
   * started. Its end is unknown until the action returns, so the window stays
   * open (`endMs = Infinity`) until {@link anchorSettle} fixes it. A window
   * whose end were guessed up front (`nowMs + settleMs`) would expire during
   * any action slower than `settleMs`, and every observation after that —
   * during the rest of the action and the whole real settle — would be
   * dropped (finding 736a7c2c).
   *
   * Un-anchored, the window is bounded by `maxOpenMs` (default {@link
   * MAX_UNANCHORED_WINDOW_MS}; size it from the action's own timeout with
   * {@link unanchoredBoundForTimeout}): past `nowMs + maxOpenMs` it no longer
   * matches and is pruned, so an action that never returns cannot leak it.
   * Returns the window's handle; a duplicate requestId opens a second window
   * rather than overwriting the first.
   */
  beginAction(
    requestId: string,
    action: string,
    nowMs: number,
    maxOpenMs: number = MAX_UNANCHORED_WINDOW_MS
  ): ActionWindowHandle {
    this.pruneExpired(nowMs);
    const handle = this.nextHandle++ as ActionWindowHandle;
    this.open.set(handle, {
      handle,
      requestId,
      action,
      startMs: nowMs,
      endMs: Number.POSITIVE_INFINITY,
      unanchoredDeadlineMs: nowMs + maxOpenMs,
      sawConcurrentObservation: false,
    });
    return handle;
  }

  /**
   * Fix an open window's end to the real settle: `endMs = settleStartMs +
   * settleMs`. Called when the verifier starts the settle it actually awaits,
   * so the window covers `[action start, settle start + settleMs]`. The start
   * never moves and the settle duration is the one awaited, so this does not
   * widen the settle. Anchoring lifts the un-anchored bound.
   *
   * Returns `true` when the window was anchored, `false` when it was not: the
   * window had already passed its un-anchored bound by `settleStartMs` (it is
   * closed here if it was not pruned yet) or the handle is unknown. `false`
   * means observations after the bound were NOT attributed to this action, so
   * the caller must not report the cause as a clean `'causal'`.
   */
  anchorSettle(handle: ActionWindowHandle, settleStartMs: number, settleMs: number): boolean {
    const window = this.open.get(handle);
    if (!window) return false;
    if (settleStartMs > window.unanchoredDeadlineMs) {
      this.close(window);
      return false;
    }
    window.endMs = settleStartMs + settleMs;
    window.unanchoredDeadlineMs = Number.POSITIVE_INFINITY;
    return true;
  }

  /**
   * Close a window. Captures the window's `sawConcurrentObservation` flag into
   * a small bounded recently-ended map so a later
   * {@link hadConcurrentObservation} still returns the right value briefly
   * after the window closed. No-op for an unknown (or already pruned) handle.
   */
  end(handle: ActionWindowHandle): void {
    const window = this.open.get(handle);
    if (!window) return;
    this.close(window);
  }

  /** Is `atMs` inside (inclusive) at least one currently-open window? */
  isWithinAnyWindow(atMs: number): boolean {
    this.pruneExpired(atMs);
    for (const w of this.open.values()) {
      if (contains(w, atMs)) return true;
    }
    return false;
  }

  /**
   * Flag every currently-open window whose interval contains `atMs` as having
   * seen a concurrent observation. Called by the BackgroundObserver on each
   * concurrent background activity.
   */
  recordConcurrentObservation(atMs: number): void {
    this.pruneExpired(atMs);
    for (const w of this.open.values()) {
      if (contains(w, atMs)) {
        w.sawConcurrentObservation = true;
      }
    }
  }

  /**
   * Did exactly this (possibly already-ended) window see a concurrent
   * observation? Reads the open window, else the bounded recently-ended map.
   * Returns `false` for an unknown handle.
   */
  hadConcurrentObservation(handle: ActionWindowHandle): boolean {
    const open = this.open.get(handle);
    if (open) return open.sawConcurrentObservation;
    return this.recentlyEnded.get(handle)?.saw ?? false;
  }

  /**
   * Convenience lookup by request id: the newest open window with that
   * requestId, else the newest recently-ended one. Returns `false` for an
   * unknown requestId.
   */
  hadConcurrentObservationForRequest(requestId: string): boolean {
    const openMatch = newest([...this.open.values()].filter((w) => w.requestId === requestId));
    if (openMatch) return openMatch.sawConcurrentObservation;
    const endedMatch = newest(
      [...this.recentlyEnded.values()].filter((w) => w.requestId === requestId)
    );
    return endedMatch?.saw ?? false;
  }

  /** Number of currently-open windows (test/diagnostic aid). */
  get openCount(): number {
    return this.open.size;
  }

  /** Close every un-anchored window whose bound has passed by `atMs`. */
  private pruneExpired(atMs: number): void {
    for (const w of [...this.open.values()]) {
      if (atMs > w.unanchoredDeadlineMs) this.close(w);
    }
  }

  private close(window: ActionWindow): void {
    this.open.delete(window.handle);
    this.recentlyEnded.set(window.handle, {
      requestId: window.requestId,
      saw: window.sawConcurrentObservation,
    });
    while (this.recentlyEnded.size > RECENTLY_ENDED_CAP) {
      const oldest = this.recentlyEnded.keys().next().value;
      if (oldest === undefined) break;
      this.recentlyEnded.delete(oldest);
    }
  }
}

/** Does window `w` contain `atMs` (inclusive), honouring the un-anchored bound? */
function contains(w: ActionWindow, atMs: number): boolean {
  return atMs >= w.startMs && atMs <= w.endMs && atMs <= w.unanchoredDeadlineMs;
}

/** The last element (insertion order = newest last), or undefined. */
function newest<T>(items: T[]): T | undefined {
  return items[items.length - 1];
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
