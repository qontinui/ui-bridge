/**
 * One lock for every mutation of the root element's width.
 *
 * Two operations narrow `document.documentElement` through its inline style:
 * `captureResponsiveSnapshots` (which saves the root's styles, constrains them
 * per viewport across animation frames, and restores what it saved) and the
 * `setViewportConstraints` handlers (server and browser). The relay client
 * dispatches commands without awaiting the previous one, so two of these can
 * interleave. A capture that starts while another is mid-flight then saves the
 * OTHER capture's constraint as the page's "original" and restores it last,
 * leaving the live page narrowed with overflow hidden; a
 * `setViewportConstraints` that lands mid-capture is silently undone by the
 * capture's restore.
 *
 * Every root-width mutation runs inside `withRootWidthLock`, one at a time, in
 * arrival order. Three properties keep the lock from becoming a hazard itself:
 *
 * - **One lock per page, not per bundle.** tsup builds each entry without
 *   code splitting, so the injected runtime and the app's own copy of the SDK
 *   are separate module instances on one page. The queue lives in a
 *   page-global `Symbol.for` slot, as the registry and the forced pseudo-state
 *   do, so every copy queues on the same lock.
 * - **A deadline.** Each holder gets a deadline (`budgetMs`, default
 *   `DEFAULT_ROOT_WIDTH_BUDGET_MS`, which fits the relay's 8 s command
 *   budget). A waiter whose deadline passes before its turn is refused with
 *   `UB-ACTION-TIMEOUT` the moment it passes, rather than mutating the page
 *   after its caller was told "timeout"; the holder receives its deadline and
 *   is expected to stop work by it (the responsive capture stops between
 *   viewports and restores).
 * - **No re-entry.** A holder that calls `withRootWidthLock` again while
 *   it is running synchronously is refused with `UB-ACTION-REJECTED` — it
 *   would otherwise wait on itself. A nested call made after an `await` cannot
 *   be told apart from a concurrent one without async context, so it queues;
 *   its own deadline then refuses it instead of deadlocking.
 *
 * A failed or refused holder releases the lock.
 */

/** The default deadline of one root-width mutation, under the relay's 8 s command budget. */
export const DEFAULT_ROOT_WIDTH_BUDGET_MS = 7_000;

/** A root-width mutation the lock refused: its deadline passed, or it re-entered. */
export class RootWidthLockError extends Error {
  constructor(
    message: string,
    readonly code: 'UB-ACTION-TIMEOUT' | 'UB-ACTION-REJECTED'
  ) {
    super(message);
    this.name = 'RootWidthLockError';
  }
}

interface LockSlot {
  /** Settles when the last queued holder releases. */
  tail: Promise<void>;
  /** `true` while a holder's callback is running synchronously. */
  syncHolding: boolean;
}

const SLOT_KEY = Symbol.for('@qontinui/ui-bridge/root-width-lock@v1');

function slot(): LockSlot {
  const g = globalThis as unknown as Record<symbol, LockSlot | undefined>;
  let s = g[SLOT_KEY];
  if (!s) {
    s = { tail: Promise.resolve(), syncHolding: false };
    g[SLOT_KEY] = s;
  }
  return s;
}

/**
 * Run `fn` once every earlier root-width mutation has finished, and before
 * `budgetMs` (from now) runs out. `fn` receives its deadline (epoch ms).
 */
export function withRootWidthLock<T>(
  fn: (deadline: number) => T | Promise<T>,
  options: { budgetMs?: number } = {}
): Promise<T> {
  const lock = slot();
  if (lock.syncHolding) {
    return Promise.reject(
      new RootWidthLockError(
        'withRootWidthLock re-entered from inside a root-width mutation',
        'UB-ACTION-REJECTED'
      )
    );
  }
  const budgetMs = options.budgetMs ?? DEFAULT_ROOT_WIDTH_BUDGET_MS;
  const deadline = Date.now() + budgetMs;
  const previous = lock.tail;
  let release!: () => void;
  const mine = new Promise<void>((resolve) => (release = resolve));
  lock.tail = previous.then(() => mine);

  return new Promise<T>((resolve, reject) => {
    let refused = false;
    let started = false;
    const refuse = (): void => {
      refused = true;
      reject(
        new RootWidthLockError(
          `Root-width mutation timed out after ${budgetMs} ms waiting for an earlier one`,
          'UB-ACTION-TIMEOUT'
        )
      );
    };
    const timer = setTimeout(() => {
      if (!started) refuse();
    }, budgetMs);
    void previous.then(async () => {
      clearTimeout(timer);
      // A timer can fire late; a turn that arrives after the deadline is
      // refused all the same.
      if (!refused && Date.now() > deadline) refuse();
      if (refused) {
        release();
        return;
      }
      started = true;
      try {
        lock.syncHolding = true;
        let pending: T | Promise<T>;
        try {
          pending = fn(deadline);
        } finally {
          lock.syncHolding = false;
        }
        resolve(await pending);
      } catch (err) {
        reject(err);
      } finally {
        release();
      }
    });
  });
}
