/**
 * Custom-action precedence on the RELAY / injected dispatch path.
 *
 * THE DEFECT these tests pin down: `react/commandHandlers.ts`
 * `case 'executeElementAction'` is a wholly separate DOM implementation from
 * `DefaultActionExecutor.performAction` — it never calls the executor. The
 * executor grew an explicit custom-action-precedence block (a registered
 * handler wins over a same-named built-in verb) precisely because the runner's
 * terminal pane registers a `sendKeys` custom action whose handler writes to
 * the pty, and `sendKeys` is ALSO a built-in verb. That fix landed on the
 * executor path only. On the relay path the built-in KeyboardEvent synthesis
 * still ran over the top of the registered handler: the handler never fired,
 * no bytes reached the pty, and the call returned `success: true` — a
 * transport-success no-op, in the fleet's own verification instrument.
 *
 * These are not `sendKeys` tests. `sendKeys` is the case that was MEASURED;
 * the assertion is that the relay path resolves a registered handler for ANY
 * action name, built-in or not, on the element that registered it — and only
 * on that element.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { executeCommand, type BridgeAccess } from './commandHandlers';
import { getGlobalRegistry } from '../core/registry';

const emptyBridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
};

/** jsdom has no layout, so `offsetParent` is null for everything and the
 *  relay's visibility gate would refuse every action. Stub it truthy. */
function makeVisible(el: HTMLElement): void {
  Object.defineProperty(el, 'offsetParent', {
    configurable: true,
    get: () => document.body,
  });
}

async function relayAction(
  id: string,
  request: Record<string, unknown>
): Promise<Record<string, unknown>> {
  return (await executeCommand('executeElementAction', { id, request }, emptyBridge)) as Record<
    string,
    unknown
  >;
}

describe('relay executeElementAction · a registered handler wins over a same-named built-in', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    makeVisible(host);
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
    getGlobalRegistry().clear();
  });

  it("runs the element's registered `sendKeys` handler instead of DOM key synthesis", async () => {
    // The shape the runner's terminal pane registers: a handler that performs
    // the REAL write. The built-in verb of the same name only dispatches
    // KeyboardEvents at the DOM node, which the pty never sees.
    const written: unknown[] = [];
    getGlobalRegistry().registerElement('terminal-pane', host, {
      type: 'custom',
      customActions: {
        sendKeys: {
          id: 'sendKeys',
          handler: (params) => {
            written.push(params);
            return { bytesWritten: 1 };
          },
        },
      },
    });

    // The built-in arm would dispatch these at `host` and report success.
    const synthesized: string[] = [];
    for (const t of ['keydown', 'keypress', 'keyup']) {
      host.addEventListener(t, () => synthesized.push(t));
    }

    const result = await relayAction('terminal-pane', {
      action: 'sendKeys',
      params: { keys: [{ key: 'Enter' }] },
    });

    // The registered handler ran, with the invocation params.
    expect(written).toEqual([{ keys: [{ key: 'Enter' }] }]);
    // And the built-in synthesis did NOT — precedence, not "both".
    expect(synthesized).toEqual([]);
    expect(result.success).toBe(true);
    expect(result.result).toEqual({ bytesWritten: 1 });
  });

  it('awaits an async handler before reporting success', async () => {
    let resolved = false;
    getGlobalRegistry().registerElement('async-el', host, {
      type: 'custom',
      customActions: {
        sendKeys: {
          id: 'sendKeys',
          handler: async () => {
            await new Promise((r) => setTimeout(r, 5));
            resolved = true;
            return 'done';
          },
        },
      },
    });

    const result = await relayAction('async-el', { action: 'sendKeys', params: {} });

    expect(resolved).toBe(true);
    expect(result.success).toBe(true);
    expect(result.result).toBe('done');
  });

  it('precedence is decided per element — an element without the registration still gets the built-in', async () => {
    const input = document.createElement('input');
    makeVisible(input);
    document.body.appendChild(input);
    getGlobalRegistry().registerElement('plain-input', input, { type: 'input' });

    const synthesized: string[] = [];
    for (const t of ['keydown', 'keyup']) {
      input.addEventListener(t, () => synthesized.push(t));
    }

    const result = await relayAction('plain-input', {
      action: 'sendKeys',
      params: { keys: [{ key: 'Enter' }] },
    });

    expect(result.success).toBe(true);
    // Built-in DOM synthesis, unchanged.
    expect(synthesized).toEqual(['keydown', 'keyup']);
    input.remove();
  });

  it('supplies the options bag — a handler written `(params, { signal })` must not throw', async () => {
    let sawSignal = false;
    getGlobalRegistry().registerElement('bag-el', host, {
      type: 'custom',
      customActions: {
        // The documented handler signature destructures the options bag; an
        // `undefined` second argument throws a TypeError before the handler
        // body runs.
        sendKeys: {
          id: 'sendKeys',
          handler: (_params, { signal } = {}) => {
            sawSignal = signal instanceof AbortSignal;
            return null;
          },
        },
      },
    });

    const result = await relayAction('bag-el', { action: 'sendKeys', params: {} });

    expect(result.success).toBe(true);
    expect(sawSignal).toBe(true);
  });

  it('a handler throw is a FAILURE — and its typed `code` survives to the caller', async () => {
    getGlobalRegistry().registerElement('dead-terminal', host, {
      type: 'custom',
      customActions: {
        sendKeys: {
          id: 'sendKeys',
          handler: () => {
            // How a handler encodes a machine-readable reason: a resolved
            // handler is a success no matter what it resolved WITH, so the
            // only channel is a typed throw.
            throw Object.assign(new Error('terminal has exited'), {
              code: 'TERMINAL_EXITED',
              exitCode: 137,
            });
          },
        },
      },
    });

    const result = await relayAction('dead-terminal', { action: 'sendKeys', params: {} });

    expect(result.success).toBe(false);
    expect(result.code).toBe('TERMINAL_EXITED');
    expect(String(result.error)).toContain('terminal has exited');
    const details = result.failureDetails as { context?: Record<string, unknown> };
    expect(details.context).toMatchObject({
      action: 'sendKeys',
      code: 'TERMINAL_EXITED',
      exitCode: 137,
    });
  });

  it('an ordinary Error keeps the historical untyped failure shape', async () => {
    getGlobalRegistry().registerElement('boom-el', host, {
      type: 'custom',
      customActions: {
        sendKeys: {
          id: 'sendKeys',
          handler: () => {
            throw new Error('plain failure');
          },
        },
      },
    });

    const result = await relayAction('boom-el', { action: 'sendKeys', params: {} });

    expect(result.success).toBe(false);
    // No hoisted `code` — `readHandlerErrorEnvelope` returns undefined for an
    // ordinary Error, so nothing about the old shape changes.
    expect(result.code).toBeUndefined();
    const details = result.failureDetails as { errorCode?: string };
    expect(details.errorCode).toBe('ACTION_REJECTED');
  });

  it('a non-built-in custom action name still resolves (the pre-existing capability is intact)', async () => {
    let ran = false;
    getGlobalRegistry().registerElement('exotic-el', host, {
      type: 'custom',
      customActions: {
        detonate: {
          id: 'detonate',
          handler: () => {
            ran = true;
            return 'boom';
          },
        },
      },
    });

    const result = await relayAction('exotic-el', { action: 'detonate' });

    expect(ran).toBe(true);
    expect(result.success).toBe(true);
    expect(result.result).toBe('boom');
  });
});
