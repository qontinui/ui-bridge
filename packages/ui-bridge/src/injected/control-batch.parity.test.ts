/**
 * TRANSPORT PARITY — `controlBatch` answers the same verdict whichever
 * transport serves it (plan 2026-11-08-relayed-ui-bridge-actions-have-no-browser-case,
 * Phase 1, D2).
 *
 * One table of request → expected answer runs against BOTH servers of the
 * batch, over the same jsdom page and the same registry:
 *
 *   - the page: `window.__uiBridgeInjected.execute('controlBatch', …)` (exec
 *     mode; the relay reaches the same dispatcher);
 *   - in-process: `createHandlers(…).controlBatch`, whose envelope must carry
 *     the batch's verdict and code, the batch body under `data`.
 *
 * Each row asserts the same literals on both. What is compared is the
 * contract — verdict, counts, codes, per-step index / type / label / success —
 * not each step's raw answer, which is each transport's own action response.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getGlobalRegistry, setGlobalRegistry, UIBridgeRegistry } from '../core/registry';
import { DefaultActionExecutor } from '../control/action-executor';
import { createHandlers, type RegistryLike } from '../server/handlers';
import type { ControlBatchResponse } from '../control/control-batch';

const GO = 'dom-go';
const BOX = { x: 10, y: 20, width: 96, height: 32 };

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

/** The contract a batch answer is compared on. */
function contract(batch: ControlBatchResponse) {
  return {
    success: batch.success,
    total: batch.total,
    completed: batch.completed,
    succeededCount: batch.succeededCount,
    failedCount: batch.failedCount,
    skippedCount: batch.skippedCount,
    code: batch.code,
    steps: batch.results.map((r) => ({
      index: r.index,
      type: r.type,
      label: r.label,
      success: r.success,
      code: r.code,
    })),
  };
}

const ok = (index: number, type: string, label?: string) => ({
  index,
  type,
  label,
  success: true,
  code: undefined,
});
const failed = (index: number, type: string, code: string) => ({
  index,
  type,
  label: undefined,
  success: false,
  code,
});

const CLICK = { type: 'action', id: GO, request: { action: 'click' }, label: 'press' };

const CASES: Array<[string, unknown, ReturnType<typeof contract>]> = [
  [
    'click, wait, snapshot',
    { actions: [CLICK, { type: 'wait', ms: 1 }, { type: 'snapshot' }] },
    {
      success: true,
      total: 3,
      completed: 3,
      succeededCount: 3,
      failedCount: 0,
      skippedCount: 0,
      code: undefined,
      steps: [ok(0, 'action', 'press'), ok(1, 'wait'), ok(2, 'snapshot')],
    },
  ],
  [
    'the historical element_id spelling',
    { actions: [{ type: 'action', element_id: GO, action: 'click' }] },
    {
      success: true,
      total: 1,
      completed: 1,
      succeededCount: 1,
      failedCount: 0,
      skippedCount: 0,
      code: undefined,
      steps: [ok(0, 'action')],
    },
  ],
  [
    'an unknown id stops the batch',
    {
      actions: [
        { type: 'action', id: 'dom-nope', request: { action: 'click' } },
        { type: 'snapshot' },
      ],
    },
    {
      success: false,
      total: 2,
      completed: 1,
      succeededCount: 0,
      failedCount: 1,
      skippedCount: 1,
      code: 'UB-ELEM-NOT-FOUND',
      steps: [failed(0, 'action', 'UB-ELEM-NOT-FOUND')],
    },
  ],
  [
    'the "steps" alias with stopOnFailure false runs on',
    {
      steps: [
        { type: 'action', id: 'dom-nope', action: 'click' },
        { type: 'wait', ms: 0 },
      ],
      stopOnFailure: false,
    },
    {
      success: false,
      total: 2,
      completed: 2,
      succeededCount: 1,
      failedCount: 1,
      skippedCount: 0,
      code: 'UB-ELEM-NOT-FOUND',
      steps: [failed(0, 'action', 'UB-ELEM-NOT-FOUND'), ok(1, 'wait')],
    },
  ],
  [
    'a malformed step fails as itself',
    { actions: [{ type: 'action', id: GO }] },
    {
      success: false,
      total: 1,
      completed: 1,
      succeededCount: 0,
      failedCount: 1,
      skippedCount: 0,
      code: 'UB-VALIDATION-ERROR',
      steps: [failed(0, 'action', 'UB-VALIDATION-ERROR')],
    },
  ],
  [
    'a body with no step array is refused',
    { stop_on_error: true },
    {
      success: false,
      total: 0,
      completed: 0,
      succeededCount: 0,
      failedCount: 0,
      skippedCount: 0,
      code: 'UB-VALIDATION-ERROR',
      steps: [],
    },
  ],
  [
    'an empty batch succeeds',
    { actions: [] },
    {
      success: true,
      total: 0,
      completed: 0,
      succeededCount: 0,
      failedCount: 0,
      skippedCount: 0,
      code: undefined,
      steps: [],
    },
  ],
];

let api: NonNullable<Window['__uiBridgeInjected']>;
let handlers: ReturnType<typeof createHandlers>;

beforeEach(async () => {
  delete window.__uiBridgeInjected;
  delete window.__uiBridgeInjectedConfig;
  document.body.innerHTML = '';
  const go = document.createElement('button');
  go.setAttribute('data-testid', 'go');
  go.textContent = 'Go';
  document.body.append(withBox(go));
  // jsdom has no hit-testing: the executor's occlusion check sees the target.
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: () => go,
  });

  vi.resetModules();
  await import('./bootstrap');
  api = window.__uiBridgeInjected!;
  expect(api.ready).toBe(true);
  // The in-process server over the SAME registry the page just populated.
  const registry = getGlobalRegistry();
  handlers = createHandlers(
    registry as unknown as RegistryLike,
    new DefaultActionExecutor(registry) as never
  );
}, 30_000);

afterEach(() => {
  delete window.__uiBridgeInjected;
  setGlobalRegistry(new UIBridgeRegistry());
  document.body.innerHTML = '';
});

describe('controlBatch · one contract on the page and in-process', () => {
  it.each(CASES)(
    '%s',
    async (_name, request, expected) => {
      const page = (await api.execute('controlBatch', request)) as ControlBatchResponse;
      expect(contract(page)).toEqual(expected);

      const envelope = await handlers.controlBatch(request as never);
      expect(envelope.success).toBe(expected.success);
      expect(envelope.code).toBe(expected.code);
      const inProcess = envelope.data as ControlBatchResponse;
      expect(contract(inProcess)).toEqual(expected);
      if (!expected.success) expect(envelope.error).toBe(inProcess.error);
    },
    30_000
  );
});
