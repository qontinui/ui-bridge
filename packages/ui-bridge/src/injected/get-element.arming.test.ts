/**
 * ARMING — plan 2026-11-08-ui-bridge-inject-exec-mode-is-a-second-class-driver,
 * Phase 3 (`getElement`: the per-element read the relay already sends).
 *
 * Enters where exec mode's population enters: the injected bootstrap and the
 * `window.__uiBridgeInjected.execute` it installs. Nothing here calls the
 * dispatcher directly.
 *
 * The relay has sent `getElement` to browser tabs since 2026-03 and the
 * runner's SDK route sends it too, but the in-page dispatcher never had a case
 * for it: every call threw `Unknown command action: getElement`, and the
 * relay's unpinned read quietly answered from its cached snapshot instead. Now
 * it answers the element's identity, state, box and actions — the same object
 * the matching `getControlSnapshot` element is — and a RETURNED
 * `ELEMENT_NOT_FOUND` / `INVALID_REQUEST` for the rest.
 *
 * Each case boots a fresh runtime: `import('./bootstrap')` is cached per test
 * file, so `vi.resetModules()` runs before every re-import.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setGlobalRegistry, UIBridgeRegistry } from '../core/registry';

const GO = 'dom-go';
const BUSY = 'dom-busy';
const BOX = { x: 10, y: 20, width: 96, height: 32 };

/** jsdom has no layout: give a node a box so it reads as visible and measured. */
function withBox<T extends HTMLElement>(el: T): T {
  Object.defineProperty(el, 'offsetParent', { configurable: true, get: () => document.body });
  el.getBoundingClientRect = () =>
    ({
      ...BOX,
      top: BOX.y,
      left: BOX.x,
      right: BOX.x + BOX.width,
      bottom: BOX.y + BOX.height,
    }) as DOMRect;
  return el;
}

/** A fresh injected runtime over the current DOM. */
async function bootRuntime() {
  vi.resetModules();
  await import('./bootstrap');
  const api = window.__uiBridgeInjected!;
  expect(api.ready).toBe(true);
  return api;
}

interface SerializedElement {
  id: string;
  tagName: string;
  label?: string;
  actions: string[];
  bbox?: { x: number; y: number; width: number; height: number };
  state: { ariaPressed?: boolean | 'mixed'; enabled: boolean; visible: boolean };
}

interface Failure {
  success: false;
  error: string;
  failureDetails: { errorCode: string; elementId: string; expectedPayload?: string };
}

beforeEach(() => {
  delete window.__uiBridgeInjected;
  delete window.__uiBridgeInjectedConfig;
  document.body.innerHTML = '';
  const go = document.createElement('button');
  go.setAttribute('data-testid', 'go');
  go.setAttribute('aria-pressed', 'false');
  go.textContent = 'Toggle';
  const busy = document.createElement('button');
  busy.setAttribute('data-testid', 'busy');
  busy.disabled = true;
  busy.textContent = 'Busy';
  document.body.append(withBox(go), withBox(busy));
});

afterEach(() => {
  delete window.__uiBridgeInjected;
  setGlobalRegistry(new UIBridgeRegistry());
  document.body.innerHTML = '';
});

describe('injected execute("getElement") · reads one element', () => {
  it.each([
    ['{"id":"dom-go"}', { id: GO }],
    ['{"elementId":"dom-go"}', { elementId: GO }],
  ])(
    '%s answers the element: identity, state, box and actions',
    async (_label, payload) => {
      const api = await bootRuntime();
      const el = (await api.execute('getElement', payload)) as SerializedElement;

      expect(el.id).toBe(GO);
      expect(el.tagName).toBe('button');
      expect(el.label).toBe('Toggle');
      expect(el.state.ariaPressed).toBe(false);
      expect(el.state.enabled).toBe(true);
      expect(el.bbox).toEqual(BOX);
      expect(el.actions).toContain('click');
      // An element, not an envelope: nothing here reports a failure.
      expect((el as unknown as { success?: unknown }).success).toBeUndefined();
    },
    30_000
  );

  it('a disabled button reads state.enabled === false', async () => {
    const api = await bootRuntime();
    const el = (await api.execute('getElement', { id: BUSY })) as SerializedElement;
    expect(el.id).toBe(BUSY);
    expect(el.state.enabled).toBe(false);
  }, 30_000);

  it.each([[true], [false]])(
    'the WebSocket protocol\'s own field {"includeState":%s} is accepted, and the state is always included',
    async (includeState) => {
      const api = await bootRuntime();
      const el = (await api.execute('getElement', { id: GO, includeState })) as SerializedElement;
      expect(el.id).toBe(GO);
      expect(el.state.ariaPressed).toBe(false);
      expect(el.state.enabled).toBe(true);
    },
    30_000
  );

  it('answers the label the DOM carries NOW: an aria-label changed after boot is read fresh', async () => {
    const api = await bootRuntime();
    expect(((await api.execute('getElement', { id: GO })) as SerializedElement).label).toBe(
      'Toggle'
    );
    // The scanner never re-labels a node it already holds, so the change is
    // seen only because getElement re-derives scraped labels before it reads
    // (it is in the dispatcher's LABEL_REFRESH_ACTIONS).
    document.querySelector('[data-testid="go"]')!.setAttribute('aria-label', 'Pause playback');
    const el = (await api.execute('getElement', { id: GO })) as SerializedElement;
    expect(el.label).toBe('Pause playback');
  }, 30_000);

  it('parity: the answer deep-equals the matching getControlSnapshot element taken in the same tick', async () => {
    const api = await bootRuntime();
    const [one, snapshot] = await Promise.all([
      api.execute('getElement', { id: GO }),
      api.execute('getControlSnapshot', {}) as Promise<{ elements: SerializedElement[] }>,
    ]);
    const fromSnapshot = snapshot.elements.find((e) => e.id === GO);
    expect(fromSnapshot).toBeDefined();
    expect(one).toEqual(fromSnapshot);
  }, 30_000);
});

describe('injected execute("getElement") · returned refusals, never null and never a throw', () => {
  it('an unknown id answers success: false / ELEMENT_NOT_FOUND', async () => {
    const api = await bootRuntime();
    const result = (await api.execute('getElement', { id: 'dom-nope' })) as Failure;
    expect(result.success).toBe(false);
    expect(result.failureDetails.errorCode).toBe('ELEMENT_NOT_FOUND');
    expect(result.failureDetails.elementId).toBe('dom-nope');
    expect(result.error).toBe('Element dom-nope not found');
  }, 30_000);

  it('a registered element whose DOM node is gone answers ELEMENT_NOT_FOUND', async () => {
    const api = await bootRuntime();
    // Registered at boot; detach the node without giving the observer a chance
    // to unregister it first.
    document.querySelector('[data-testid="go"]')!.remove();
    const result = (await api.execute('getElement', { id: GO })) as Failure;
    expect(result.success).toBe(false);
    expect(result.failureDetails.errorCode).toBe('ELEMENT_NOT_FOUND');
  }, 30_000);

  it.each([
    ['{}', {}, 'names no element'],
    [
      '{"id":"dom-go","includeStates":true}',
      { id: GO, includeStates: true },
      '"includeStates" is not read by getElement',
    ],
  ])(
    '%s answers INVALID_REQUEST naming the read payload',
    async (_label, payload, problem) => {
      const api = await bootRuntime();
      const result = (await api.execute('getElement', payload)) as Failure;
      expect(result.success).toBe(false);
      expect(result.failureDetails.errorCode).toBe('INVALID_REQUEST');
      expect(result.error).toContain(problem);
      expect(result.error).toContain('{"id":"<elementId>"}');
      expect(result.failureDetails.expectedPayload).toBe('{"id":"<elementId>"}');
    },
    30_000
  );
});
