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
 * Every root-width mutation runs inside `withRootWidthLock`, so they run one
 * at a time, in arrival order. A failed holder releases the lock.
 */

let tail: Promise<unknown> = Promise.resolve();

/** Run `fn` once every earlier root-width mutation has finished. */
export function withRootWidthLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const run = tail.then(() => fn());
  tail = run.catch(() => undefined);
  return run;
}
