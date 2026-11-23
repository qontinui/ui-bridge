/**
 * ARMING — plan 2026-11-08-relayed-ui-bridge-actions-have-no-browser-case,
 * Phase 1 (`controlBatch`: the batch the relay already sends).
 *
 * Enters where exec mode's population enters: the injected bootstrap and the
 * `window.__uiBridgeInjected.execute` it installs. Nothing here calls the
 * dispatcher directly.
 *
 * The relay has sent `controlBatch` to browser tabs (`POST
 * /control/batch-execute`) while the in-page dispatcher had no case for it:
 * every call threw `Unknown command action: controlBatch`. Now the page runs
 * the batch through `../control/control-batch.ts` and answers its verdict.
 *
 * Each case boots a fresh runtime: `import('./bootstrap')` is cached per test
 * file, so `vi.resetModules()` runs before every re-import.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setGlobalRegistry, UIBridgeRegistry } from '../core/registry';
import type { ControlBatchResponse } from '../control/control-batch';

const GO = 'dom-go';
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

let clicks = 0;

beforeEach(() => {
  delete window.__uiBridgeInjected;
  delete window.__uiBridgeInjectedConfig;
  document.body.innerHTML = '';
  clicks = 0;
  const go = document.createElement('button');
  go.setAttribute('data-testid', 'go');
  go.textContent = 'Go';
  go.addEventListener('click', () => {
    clicks++;
  });
  document.body.append(withBox(go));
});

afterEach(() => {
  delete window.__uiBridgeInjected;
  setGlobalRegistry(new UIBridgeRegistry());
  document.body.innerHTML = '';
});

describe('injected execute("controlBatch") · runs the batch in the page', () => {
  it('a click, a 10 ms wait and a snapshot all succeed', async () => {
    const api = await bootRuntime();
    const batch = (await api.execute('controlBatch', {
      actions: [
        { type: 'action', id: GO, request: { action: 'click' }, label: 'press' },
        { type: 'wait', ms: 10 },
        { type: 'snapshot' },
      ],
    })) as ControlBatchResponse;

    expect(batch.success).toBe(true);
    expect(batch.total).toBe(3);
    expect(batch.completed).toBe(3);
    expect(batch.succeededCount).toBe(3);
    expect(batch.failedCount).toBe(0);
    expect(batch.skippedCount).toBe(0);
    expect(batch.results.map((r) => [r.index, r.type, r.success])).toEqual([
      [0, 'action', true],
      [1, 'wait', true],
      [2, 'snapshot', true],
    ]);
    expect(batch.results[0].label).toBe('press');
    expect(clicks).toBe(1);
    expect(batch.results[1].data).toEqual({ waited_ms: 10 });
    expect(batch.results[1].durationMs).toBeGreaterThanOrEqual(9);
    // The snapshot step is the dispatcher's own `getControlSnapshot`.
    const snapshot = batch.results[2].data as { elements: Array<{ id: string }> };
    expect(snapshot.elements.map((e) => e.id)).toContain(GO);
  }, 30_000);

  it('a step on an unknown id answers ELEMENT_NOT_FOUND inside the step, and the batch fails', async () => {
    const api = await bootRuntime();
    const batch = (await api.execute('controlBatch', {
      actions: [
        { type: 'action', id: 'dom-nope', request: { action: 'click' } },
        { type: 'snapshot' },
      ],
    })) as ControlBatchResponse;

    expect(batch.success).toBe(false);
    expect(batch.completed).toBe(1);
    expect(batch.skippedCount).toBe(1);
    expect(batch.failedCount).toBe(1);
    expect(batch.code).toBe('UB-ELEM-NOT-FOUND');
    const [step] = batch.results;
    expect(step.success).toBe(false);
    expect(step.code).toBe('UB-ELEM-NOT-FOUND');
    expect(step.error).toBe('Element dom-nope not found');
    const answer = step.data as { success: boolean; failureDetails: { errorCode: string } };
    expect(answer.success).toBe(false);
    expect(answer.failureDetails.errorCode).toBe('ELEMENT_NOT_FOUND');
    expect(clicks).toBe(0);
  }, 30_000);
});
