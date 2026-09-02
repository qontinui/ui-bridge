/**
 * The DIRECT (non-relay) transport must not bless an inner failure either.
 *
 * `createHandlers`' `executeElementAction` detects an executor failure and
 * enriches it with `failureDetails` — and then used to return it as
 * `success({...actionResult, failureDetails})`, i.e.
 * `{ success: true, data: { success: false, … } }` at HTTP 200. That is the
 * same lie as the relay seam wore, on the other transport: a refused action
 * reported as a completed one to every consumer that branches on the envelope
 * (all of them — it is the documented contract).
 *
 * A verification instrument that reports success while doing nothing is worth
 * less than one that fails loudly, and the transport a caller happens to reach
 * must not change the verdict.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { createHandlers, type RegistryLike } from './handlers';
import { UIBridgeRegistry } from '../core/registry';
import { DefaultActionExecutor } from '../control/action-executor';

beforeAll(() => {
  if (typeof document !== 'undefined' && !document.elementFromPoint) {
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => null,
    });
  }
});

describe('direct executeElementAction · an executor failure is an OUTER failure', () => {
  let registry: UIBridgeRegistry;
  let executor: DefaultActionExecutor;
  let handlers: ReturnType<typeof createHandlers>;
  let container: HTMLDivElement;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    executor = new DefaultActionExecutor(registry);
    handlers = createHandlers(registry as unknown as RegistryLike, executor as never);
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    registry.clear();
  });

  it('an unresolvable element is reported as a failure, not a success with a buried one', async () => {
    const result = await handlers.executeElementAction!('no-such-element', { action: 'click' });

    expect(result.success).toBe(false);
    expect(String(result.error).length).toBeGreaterThan(0);
    // The enriched payload is preserved verbatim — only the verdict changed.
    const data = result.data as { success?: boolean; failureDetails?: { errorCode?: string } };
    expect(data.success).toBe(false);
    expect(data.failureDetails?.errorCode).toBeTruthy();
  });

  it("a custom-action handler's typed throw keeps its own code on the envelope", async () => {
    const host = document.createElement('div');
    container.appendChild(host);
    registry.registerElement('terminal-pane', host, {
      type: 'custom',
      customActions: {
        sendKeys: {
          id: 'sendKeys',
          handler: () => {
            throw Object.assign(new Error('terminal has exited'), {
              code: 'TERMINAL_EXITED',
              exitCode: 137,
            });
          },
        },
      },
    });

    const result = await handlers.executeElementAction!('terminal-pane', {
      action: 'sendKeys',
      params: { keys: [{ key: 'Enter' }] },
    });

    expect(result.success).toBe(false);
    // The handler's vocabulary, not the SDK taxonomy — propagated verbatim so a
    // driver can branch on it without prose matching.
    expect(result.code).toBe('TERMINAL_EXITED');
    expect(String(result.error)).toContain('terminal has exited');
  });

  it('a genuinely successful action is untouched', async () => {
    const button = document.createElement('button');
    container.appendChild(button);
    registry.registerElement('btn', button, { type: 'button' });

    let clicks = 0;
    button.addEventListener('click', () => {
      clicks += 1;
    });

    const result = await handlers.executeElementAction!('btn', { action: 'click' });

    expect(result.success).toBe(true);
    expect(clicks).toBe(1);
  });
});
