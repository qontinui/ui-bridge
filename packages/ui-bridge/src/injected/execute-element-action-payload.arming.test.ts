/**
 * ARMING — plan 2026-11-08-ui-bridge-inject-exec-mode-is-a-second-class-driver,
 * Phase 2 (`executeElementAction`: one grammar, a typed refusal for every other
 * shape).
 *
 * Enters where exec mode's population enters: the injected bootstrap (the IIFE
 * `ui-bridge-inject` adds to a page) and the `window.__uiBridgeInjected.execute`
 * it installs, which is `executeCommand`. Nothing here calls the dispatcher
 * directly.
 *
 * Before Phase 2 the dispatcher destructured `const { id, request } = payload`
 * unchecked. The two flat spellings left `request` undefined and REJECTED with
 * `TypeError: Cannot read properties of undefined (reading 'fromSnapshotId')`;
 * `{elementId, request}` left `id` undefined and answered
 * `Element undefined not found`. Those are the three spellings an operator
 * measured (coord caveat 0713b603), and all three now act. Every other shape
 * RESOLVES to a typed `INVALID_REQUEST` that names the grammar.
 *
 * Each case boots a fresh runtime: `import('./bootstrap')` is cached per test
 * file, so `vi.resetModules()` runs before every re-import.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setGlobalRegistry, UIBridgeRegistry } from '../core/registry';

/** The literal Phase 6 run B line 2 reads in the refusal. */
const SHAPE_PREFIX = '{"id":"<elementId>","request":{"action":"<action>"';
const QUERY = 'dom-query';

/** jsdom has no layout: give a node a box so the dispatcher does not refuse to act on it. */
function withBox<T extends HTMLElement>(el: T): T {
  Object.defineProperty(el, 'offsetParent', { configurable: true, get: () => document.body });
  el.getBoundingClientRect = () =>
    ({ x: 0, y: 0, width: 160, height: 24, top: 0, left: 0, right: 160, bottom: 24 }) as DOMRect;
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

beforeEach(() => {
  delete window.__uiBridgeInjected;
  delete window.__uiBridgeInjectedConfig;
  document.body.innerHTML = '';
  const input = document.createElement('input');
  input.setAttribute('data-testid', 'query');
  input.placeholder = 'Search';
  document.body.appendChild(withBox(input));
});

afterEach(() => {
  delete window.__uiBridgeInjected;
  setGlobalRegistry(new UIBridgeRegistry());
  document.body.innerHTML = '';
});

describe('injected execute("executeElementAction") · the accepted spellings act', () => {
  it.each([
    ['{"elementId":"dom-query","action":"focus"}', { elementId: QUERY, action: 'focus' }],
    ['{"id":"dom-query","action":"focus"}', { id: QUERY, action: 'focus' }],
    [
      '{"elementId":"dom-query","request":{"action":"focus"}}',
      { elementId: QUERY, request: { action: 'focus' } },
    ],
    // The canonical spelling, which always worked — the control row.
    [
      '{"id":"dom-query","request":{"action":"focus"}}',
      { id: QUERY, request: { action: 'focus' } },
    ],
  ])(
    '%s succeeds, and getElementState then reads focused: true',
    async (_label, payload) => {
      const api = await bootRuntime();
      await expect(api.execute('getElementState', { id: QUERY })).resolves.toMatchObject({
        id: QUERY,
        focused: false,
      });

      await expect(api.execute('executeElementAction', payload)).resolves.toMatchObject({
        success: true,
      });

      await expect(api.execute('getElementState', { id: QUERY })).resolves.toMatchObject({
        id: QUERY,
        focused: true,
      });
    },
    30_000
  );
});

describe('injected execute("executeElementAction") · a malformed payload resolves to INVALID_REQUEST', () => {
  it.each([
    ['{"elementId":"dom-query"}', { elementId: QUERY }, QUERY, ['elementId']],
    ['{}', {}, '', []],
  ])(
    '%s resolves (never rejects) to a typed refusal naming the grammar',
    async (_label, payload, elementId, keys) => {
      const api = await bootRuntime();
      const result = (await api.execute('executeElementAction', payload)) as {
        success: boolean;
        error: string;
        failureDetails: {
          errorCode: string;
          elementId: string;
          expectedPayload: string;
          receivedKeys: string[];
          selectorsTried: string[];
        };
      };

      expect(result.success).toBe(false);
      expect(result.failureDetails.errorCode).toBe('INVALID_REQUEST');
      expect(result.error).toContain(SHAPE_PREFIX);
      expect(result.error.startsWith('executeElementAction payload refused: ')).toBe(true);
      expect(result.failureDetails.expectedPayload).toBe(
        '{"id":"<elementId>","request":{"action":"<action>", …}}'
      );
      expect(result.failureDetails.receivedKeys).toEqual(keys);
      expect(result.failureDetails.elementId).toBe(elementId);
      // Nothing was looked up, so no selector was tried.
      expect(result.failureDetails.selectorsTried).toEqual([]);
    },
    30_000
  );

  it('a request field beside "request" is refused instead of silently dropped', async () => {
    const api = await bootRuntime();
    const result = (await api.execute('executeElementAction', {
      id: QUERY,
      request: { action: 'type' },
      text: 'never typed',
    })) as { success: boolean; error: string; failureDetails: { errorCode: string } };

    expect(result.success).toBe(false);
    expect(result.failureDetails.errorCode).toBe('INVALID_REQUEST');
    expect(result.error).toContain('"text" is at the top level beside "request"');
    // The refused action never ran: the field it would have typed is untouched.
    expect((document.querySelector('[data-testid="query"]') as HTMLInputElement).value).toBe('');
  }, 30_000);
});
