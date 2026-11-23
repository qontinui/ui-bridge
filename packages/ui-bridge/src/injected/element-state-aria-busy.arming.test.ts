/**
 * ARMING — plan `2026-11-08-ui-bridge-element-state-has-two-readers-and-no-aria-busy`,
 * Phase 2 (`ariaBusy` on `ElementState`).
 *
 * Enters where exec mode's population enters: the injected bootstrap and the
 * `window.__uiBridgeInjected.execute` it installs. Nothing here calls the
 * dispatcher or the reader directly.
 *
 * Before this phase `ElementState` had no `ariaBusy`, so exec-mode
 * `getElementState` never carried it and a wait on `ariaBusy: false` compared
 * `undefined !== false` on every poll. Now the field is always set from the
 * element's own attribute: `true` while `aria-busy="true"`, `false` once it is
 * cleared.
 *
 * `import('./bootstrap')` is cached per test file, so `vi.resetModules()` runs
 * before every re-import.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setGlobalRegistry, UIBridgeRegistry } from '../core/registry';

const BUSY = 'dom-busy';

/** jsdom has no layout: give a node a box so it reads as visible and measured. */
function withBox<T extends HTMLElement>(el: T): T {
  Object.defineProperty(el, 'offsetParent', { configurable: true, get: () => document.body });
  el.getBoundingClientRect = () =>
    ({
      x: 10,
      y: 20,
      width: 96,
      height: 32,
      top: 20,
      left: 10,
      right: 106,
      bottom: 52,
    }) as DOMRect;
  return el;
}

async function bootRuntime() {
  vi.resetModules();
  await import('./bootstrap');
  const api = window.__uiBridgeInjected!;
  expect(api.ready).toBe(true);
  return api;
}

let busy: HTMLButtonElement;

beforeEach(() => {
  delete window.__uiBridgeInjected;
  delete window.__uiBridgeInjectedConfig;
  document.body.innerHTML = '';
  busy = document.createElement('button');
  busy.setAttribute('data-testid', 'busy');
  busy.setAttribute('aria-busy', 'true');
  busy.textContent = 'Saving';
  document.body.append(withBox(busy));
});

afterEach(() => {
  delete window.__uiBridgeInjected;
  setGlobalRegistry(new UIBridgeRegistry());
  document.body.innerHTML = '';
});

describe('injected execute("getElementState") · ariaBusy', () => {
  it('reads ariaBusy: true while aria-busy="true", then false once cleared', async () => {
    const api = await bootRuntime();

    const before = (await api.execute('getElementState', { id: BUSY })) as {
      id: string;
      ariaBusy?: boolean;
    };
    expect(before.id).toBe(BUSY);
    expect(before.ariaBusy).toBe(true);

    busy.removeAttribute('aria-busy');

    const after = (await api.execute('getElementState', { id: BUSY })) as {
      id: string;
      ariaBusy?: boolean;
    };
    expect(after.id).toBe(BUSY);
    expect(after.ariaBusy).toBe(false);
  }, 30_000);
});
