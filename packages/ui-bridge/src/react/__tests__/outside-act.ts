/**
 * The outside-`act` harness, for tests that must see WHEN React commits.
 *
 * `act()` flushes every effect before it returns and drives a suspended
 * transition to its end. A test of what holds between a commit and its passive
 * flush, or after a render that never commits, therefore cannot run inside it.
 *
 * Call `outsideAct()` once at the top of a `describe`. For that block it:
 * - turns `IS_REACT_ACT_ENVIRONMENT` off, and restores it afterwards;
 * - hands out containers and roots through `mount()`;
 * - unmounts every root it handed out after each case, and removes its
 *   container.
 * So a failed assertion cannot leave a mounted root, or a suspended transition
 * pending on one, behind for the next case. A case may still unmount its own
 * root mid-test; the later unmount is a no-op.
 */

import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';

export interface OutsideActRoot {
  container: HTMLElement;
  root: Root;
}

export interface OutsideAct {
  /** A fresh container in `document.body` and a root on it, unmounted after the case. */
  mount(): OutsideActRoot;
  /**
   * Poll a PRECONDITION until it holds, and time out loudly with `what` if it
   * never does. React commits and flushes on its own schedule here, which a
   * fixed sleep cannot bound on a loaded box. Never use it for the property
   * under test.
   */
  until(pred: () => boolean, what: string): Promise<void>;
}

export function outsideAct(): OutsideAct {
  const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  let saved: boolean | undefined;
  const mounted: OutsideActRoot[] = [];

  beforeAll(() => {
    saved = g.IS_REACT_ACT_ENVIRONMENT;
    g.IS_REACT_ACT_ENVIRONMENT = false;
  });
  afterEach(() => {
    for (const { root, container } of mounted.splice(0)) {
      root.unmount();
      container.remove();
    }
  });
  afterAll(() => {
    g.IS_REACT_ACT_ENVIRONMENT = saved;
  });

  return {
    mount() {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const handle: OutsideActRoot = { container, root: createRoot(container) };
      mounted.push(handle);
      return handle;
    },
    until(pred, what) {
      return vi.waitFor(
        () => {
          if (!pred()) throw new Error(`timed out waiting for: ${what}`);
        },
        // Under vitest's 5 s test timeout, so a precondition that never holds
        // fails with its own name rather than a generic test timeout.
        { timeout: 2000, interval: 10 }
      );
    },
  };
}
