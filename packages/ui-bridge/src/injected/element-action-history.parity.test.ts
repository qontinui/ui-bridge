/**
 * Element-action history — every element action records its `action:*` events
 * EXACTLY ONCE, on the page and in-process, whichever door ran it (plan
 * 2026-11-08-relayed-ui-bridge-actions-have-no-browser-case, review round 2).
 *
 * Over one jsdom page and the injected runtime's registry (whose
 * `ElementEventLog` keeps the `info` level):
 *   - the page: `window.__uiBridgeInjected.execute(…)`;
 *   - in-process: `createHandlers(registry, new DefaultActionExecutor(registry))`.
 *
 * Doors covered: `executeElementAction`, `controlBatch` (N action steps → N
 * pairs), `executeWithDiff` (the change tracker's action dependency), and the
 * in-process NL executor (`aiExecute`). A request naming no action records
 * nothing, and a custom action's return value never reaches the log.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getGlobalRegistry, setGlobalRegistry, UIBridgeRegistry } from '../core/registry';
import { DefaultActionExecutor } from '../control/action-executor';
import { createHandlers, type RegistryLike } from '../server/handlers';
import type { ControlActionRequest } from '../control/types';

const SECRET = 'app-return-value-7f3a';

/** jsdom has no layout: give a node a box so it reads as visible (and clickable). */
function withBox<T extends HTMLElement>(el: T): T {
  const box = { x: 10, y: 20, width: 96, height: 32 };
  Object.defineProperty(el, 'offsetParent', { configurable: true, get: () => document.body });
  el.getBoundingClientRect = () =>
    ({
      ...box,
      top: box.y,
      left: box.x,
      right: box.x + box.width,
      bottom: box.y + box.height,
    }) as DOMRect;
  return el;
}

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

  vi.resetModules();
  await import('./bootstrap');
  api = window.__uiBridgeInjected!;
  expect(api.ready).toBe(true);
  const registry = getGlobalRegistry();
  handlers = createHandlers(
    registry as unknown as RegistryLike,
    new DefaultActionExecutor(registry) as never
  );

  const pane = withBox(document.createElement('div'));
  document.body.append(pane);
  registry.registerElement('pane', pane, {
    type: 'custom',
    customActions: { write: { id: 'write', handler: () => ({ token: SECRET }) } },
  });
}, 30_000);

afterEach(() => {
  delete window.__uiBridgeInjected;
  setGlobalRegistry(new UIBridgeRegistry());
  document.body.innerHTML = '';
});

type Entry = { eventType: string; data: Record<string, unknown> };

async function history(elementId: string): Promise<Entry[]> {
  return (await api.execute('getElementHistory', { elementId, options: {} })) as Entry[];
}

function eventTypes(entries: Entry[]): string[] {
  return entries.map((e) => e.eventType);
}

const PAIR = ['action:started', 'action:completed'];

describe('controlBatch of N action steps writes exactly N pairs', () => {
  const batch = {
    actions: [
      { type: 'action', id: 'dom-go', request: { action: 'click' } },
      { type: 'wait', ms: 1 },
      { type: 'action', id: 'dom-go', request: { action: 'focus' } },
      { type: 'action', id: 'dom-go', request: { action: 'click' } },
    ],
  };

  it('on the page', async () => {
    const answer = (await api.execute('controlBatch', batch)) as { success: boolean };
    expect(answer.success).toBe(true);
    expect(eventTypes(await history('dom-go'))).toEqual([...PAIR, ...PAIR, ...PAIR]);
  });

  it('in-process', async () => {
    const answer = await handlers.controlBatch(batch as never);
    expect(answer.success).toBe(true);
    expect(eventTypes(await history('dom-go'))).toEqual([...PAIR, ...PAIR, ...PAIR]);
  });
});

describe('executeWithDiff records its action once', () => {
  it('on the page', async () => {
    const answer = (await api.execute('executeWithDiff', {
      elementAction: { elementId: 'dom-go', action: 'click' },
      settleTimeout: 50,
    })) as { actionSuccess: boolean };
    expect(answer.actionSuccess).toBe(true);
    expect(eventTypes(await history('dom-go'))).toEqual(PAIR);
  }, 30_000);

  it('in-process (the change tracker action dependency)', async () => {
    const answer = await handlers.executeWithDiff({
      elementAction: { elementId: 'dom-go', action: 'click' },
      settleTimeout: 50,
    } as never);
    expect((answer.data as { actionSuccess: boolean }).actionSuccess).toBe(true);
    expect(eventTypes(await history('dom-go'))).toEqual(PAIR);
  }, 30_000);
});

describe('the in-process NL executor records the action it ran', () => {
  it('aiExecute "click Go"', async () => {
    const answer = await handlers.aiExecute({ instruction: 'click Go' } as never);
    expect(answer.success).toBe(true);
    const entries = await history('dom-go');
    expect(eventTypes(entries)).toEqual(PAIR);
    expect(entries[1].data).toMatchObject({ elementId: 'dom-go', action: 'click' });
  }, 30_000);
});

describe('a request naming no action records nothing', () => {
  it.each([
    ['an empty action', { action: '' }],
    ['no action', {}],
    ['a non-string action', { action: 7 }],
  ])('in-process: %s', async (_name, request) => {
    await handlers.executeElementAction('dom-go', request as unknown as ControlActionRequest);
    expect(await history('dom-go')).toEqual([]);
  });

  it.each([
    ['an empty action', { id: 'dom-go', request: { action: '' } }],
    ['no request', { id: 'dom-go' }],
  ])('on the page: %s', async (_name, payload) => {
    await api.execute('executeElementAction', payload);
    expect(await history('dom-go')).toEqual([]);
  });
});

describe("a custom action's return value never reaches the history", () => {
  it('on the page', async () => {
    const answer = (await api.execute('executeElementAction', {
      id: 'pane',
      request: { action: 'write' },
    })) as { success: boolean; result?: unknown };
    expect(answer.success).toBe(true);
    // The caller gets it — the log does not keep it.
    expect(JSON.stringify(answer)).toContain(SECRET);
    const entries = await history('pane');
    expect(eventTypes(entries)).toEqual(PAIR);
    expect(JSON.stringify(entries)).not.toContain(SECRET);
  });

  it('in-process', async () => {
    const answer = await handlers.executeElementAction('pane', { action: 'write' });
    expect(answer.success).toBe(true);
    expect(JSON.stringify(answer)).toContain(SECRET);
    const entries = await history('pane');
    expect(eventTypes(entries)).toEqual(PAIR);
    expect(JSON.stringify(entries)).not.toContain(SECRET);
  });
});
