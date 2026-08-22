/**
 * `performAction` — custom-action precedence over same-named built-ins.
 *
 * THE DEFECT: the `customActions` lookup lived ONLY in the `default:` arm of
 * the built-in action switch, so any registered handler whose name collides
 * with an entry in `SUPPORTED_ACTIONS` was unreachable. The runner's terminal
 * pane registers `sendKeys` — also a built-in verb — so:
 *
 *   - `sendKeys { keys: "echo hi\r" }` (string form) failed with the SDK's own
 *     "requires a non-empty 'keys' array" prose, a string that exists only in
 *     the BUILT-IN. Proof the built-in ran, not the handler.
 *   - `sendKeys { keys: [{key:'X'}, …] }` (descriptor form) reported
 *     `success: true` while the bytes went into the DOM node and never reached
 *     the pty — a silent ghost write. The handler never got the chance to
 *     report `TERMINAL_EXITED` for a dead terminal.
 *
 * The contract these tests pin:
 *   1. A same-named customAction WINS over the built-in, in BOTH param shapes.
 *   2. Precedence is per-element: an element that does NOT register the name
 *      still gets the built-in (in both param shapes).
 *   3. A handler's typed error code still survives the outer catch (the
 *      property 0.23.0 shipped in `8ac909e`).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UIBridgeRegistry } from '../core/registry';
import { DefaultActionExecutor } from './action-executor';

/** Substring that exists ONLY inside the built-in `performSendKeys`. */
const BUILTIN_SENDKEYS_PROSE = "requires a non-empty 'keys' array";

interface HandlerCall {
  params: Record<string, unknown> | undefined;
}

describe('DefaultActionExecutor — customActions win over same-named built-ins', () => {
  let registry: UIBridgeRegistry;
  let executor: DefaultActionExecutor;
  let container: HTMLDivElement;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    executor = new DefaultActionExecutor(registry);
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  /**
   * A terminal-pane-shaped element that registers `sendKeys` as a customAction
   * — the exact collision the runner hits. Returns the recorded handler calls
   * and the keydown events the DOM node actually saw (a built-in dispatch
   * would show up there and a handler dispatch would not).
   */
  function registerPaneWithSendKeys(
    id: string,
    handler: (params?: Record<string, unknown>) => unknown
  ): { calls: HandlerCall[]; keydowns: string[]; el: HTMLElement } {
    const el = document.createElement('div');
    el.setAttribute('data-testid', id);
    el.tabIndex = 0;
    container.appendChild(el);

    const calls: HandlerCall[] = [];
    const keydowns: string[] = [];
    el.addEventListener('keydown', (e) => keydowns.push((e as KeyboardEvent).key));

    registry.registerElement(id, el, {
      type: 'custom',
      label: id,
      customActions: {
        sendKeys: {
          id: 'sendKeys',
          handler: (params?: unknown) => {
            calls.push({ params: params as Record<string, unknown> | undefined });
            return handler(params as Record<string, unknown> | undefined);
          },
        },
      },
    });

    return { calls, keydowns, el };
  }

  /** A plain input that registers NO custom actions — the built-in path. */
  function registerPlainInput(id: string): { keydowns: string[]; el: HTMLInputElement } {
    const el = document.createElement('input');
    el.setAttribute('data-testid', id);
    container.appendChild(el);

    const keydowns: string[] = [];
    el.addEventListener('keydown', (e) => keydowns.push((e as KeyboardEvent).key));

    registry.registerElement(id, el, { type: 'input', label: id });
    return { keydowns, el };
  }

  // ---------------------------------------------------------------------
  // 1. A same-named customAction WINS over the built-in.
  // ---------------------------------------------------------------------

  it('string `keys` form: the handler runs instead of the built-in', async () => {
    // Before the fix this shape hit the built-in's array validation and came
    // back `success: false` quoting SDK prose the handler never wrote.
    const { calls, keydowns } = registerPaneWithSendKeys('terminal-pane', () => ({
      bytesWritten: 19,
    }));

    const res = await executor.executeAction('terminal-pane', {
      action: 'sendKeys',
      params: { keys: 'echo MTL9_LIVE_SK\r' },
    });

    expect(res.success).toBe(true);
    expect(res.error).toBeUndefined();
    expect(res.result).toEqual({ bytesWritten: 19 });
    // The handler saw the raw params, untouched by built-in coercion.
    expect(calls).toHaveLength(1);
    expect(calls[0].params).toEqual({ keys: 'echo MTL9_LIVE_SK\r' });
    // ...and the built-in never ran.
    expect(keydowns).toEqual([]);
  });

  it('string `keys` form: the built-in validation prose is gone', async () => {
    registerPaneWithSendKeys('terminal-pane', () => ({ ok: true }));

    const res = await executor.executeAction('terminal-pane', {
      action: 'sendKeys',
      params: { keys: 'echo hi\r' },
    });

    expect(JSON.stringify(res)).not.toContain(BUILTIN_SENDKEYS_PROSE);
  });

  it('descriptor `keys` form: the handler runs, no ghost DOM write', async () => {
    // This is the shape that MASKED the bug: it reported success either way.
    // The discriminator is who actually consumed it.
    const { calls, keydowns } = registerPaneWithSendKeys('terminal-pane', () => ({
      bytesWritten: 3,
    }));

    const res = await executor.executeAction('terminal-pane', {
      action: 'sendKeys',
      params: { keys: [{ key: 'X' }, { key: 'Y' }, { key: 'Z' }] },
    });

    expect(res.success).toBe(true);
    expect(res.result).toEqual({ bytesWritten: 3 });
    expect(calls).toHaveLength(1);
    expect(calls[0].params).toEqual({ keys: [{ key: 'X' }, { key: 'Y' }, { key: 'Z' }] });
    // The built-in would have dispatched keydown X/Y/Z onto the DOM node.
    // Nothing here means the SDK did not write behind the handler's back.
    expect(keydowns).toEqual([]);
  });

  it('a NON-colliding built-in on the same element still uses the built-in', async () => {
    // Registering `sendKeys` must not divert unrelated verbs on that element.
    const { el } = registerPaneWithSendKeys('terminal-pane', () => ({ ok: true }));
    let clicked = 0;
    el.addEventListener('click', () => clicked++);

    const res = await executor.executeAction('terminal-pane', { action: 'click' });

    expect(res.success).toBe(true);
    expect(clicked).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------
  // 2. Precedence is per-element, not a global name check.
  // ---------------------------------------------------------------------

  it('descriptor form on a NON-registering element still gets the built-in', async () => {
    const { keydowns } = registerPlainInput('plain-input');

    const res = await executor.executeAction('plain-input', {
      action: 'sendKeys',
      params: { keys: [{ key: 'A' }, { key: 'B' }] },
    });

    expect(res.success).toBe(true);
    expect(keydowns).toEqual(['A', 'B']);
  });

  it('string form on a NON-registering element still gets the built-in error', async () => {
    // The built-in's own validation must remain reachable — this is the
    // regression guard against "custom actions bypass built-ins globally".
    registerPlainInput('plain-input');

    const res = await executor.executeAction('plain-input', {
      action: 'sendKeys',
      params: { keys: 'echo hi\r' },
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain(BUILTIN_SENDKEYS_PROSE);
    expect(res.failureDetails?.errorCode).toBe('UB-ACTION-FAILED');
  });

  it('both elements coexist in one registry: each gets its own dispatch', async () => {
    const pane = registerPaneWithSendKeys('terminal-pane', () => ({ bytesWritten: 1 }));
    const plain = registerPlainInput('plain-input');

    const paneRes = await executor.executeAction('terminal-pane', {
      action: 'sendKeys',
      params: { keys: [{ key: 'Q' }] },
    });
    const plainRes = await executor.executeAction('plain-input', {
      action: 'sendKeys',
      params: { keys: [{ key: 'Q' }] },
    });

    expect(paneRes.success).toBe(true);
    expect(pane.calls).toHaveLength(1);
    expect(pane.keydowns).toEqual([]);

    expect(plainRes.success).toBe(true);
    expect(plain.keydowns).toEqual(['Q']);
  });

  // ---------------------------------------------------------------------
  // 3. The 0.23.0 typed-error-code passthrough still holds on this path.
  // ---------------------------------------------------------------------

  it("a colliding handler's typed error code survives (TERMINAL_EXITED)", async () => {
    // The dead-pty case: before the fix the built-in ran, reported
    // `success: true`, and the handler never got to mint this code.
    const { keydowns } = registerPaneWithSendKeys('terminal-pane', () => {
      const err = new Error(
        'TERMINAL_EXITED: terminal term-3 is not writable — its process exited with code 1.'
      );
      Object.assign(err, { code: 'TERMINAL_EXITED', terminalId: 'term-3', exitCode: 1 });
      throw err;
    });

    const res = await executor.executeAction('terminal-pane', {
      action: 'sendKeys',
      params: { keys: [{ key: 'X' }] },
    });

    expect(res.success).toBe(false);
    expect(res.code).toBe('TERMINAL_EXITED');
    expect(res.failureDetails?.errorCode).toBe('UB-ACTION-FAILED');
    expect(res.failureDetails?.context?.terminalId).toBe('term-3');
    expect(res.failureDetails?.context?.exitCode).toBe(1);
    expect(res.error).toContain('TERMINAL_EXITED');
    // And no ghost write happened on the way to the failure.
    expect(keydowns).toEqual([]);
  });

  it("a colliding handler's typed code survives the string `keys` form too", async () => {
    registerPaneWithSendKeys('terminal-pane', () => {
      const err = new Error('TERMINAL_WRITE_FAILED: terminal_write failed for term-9: ipc down');
      Object.assign(err, { code: 'TERMINAL_WRITE_FAILED', terminalId: 'term-9', exitCode: null });
      throw err;
    });

    const res = await executor.executeAction('terminal-pane', {
      action: 'sendKeys',
      params: { keys: 'echo hi\r' },
    });

    expect(res.success).toBe(false);
    expect(res.code).toBe('TERMINAL_WRITE_FAILED');
    expect(res.failureDetails?.context?.terminalId).toBe('term-9');
    // Not the built-in's validation error wearing the handler's name.
    expect(res.error).not.toContain(BUILTIN_SENDKEYS_PROSE);
  });

  it('an async handler that rejects is still typed (not swallowed)', async () => {
    registerPaneWithSendKeys('terminal-pane', () => {
      const err = new Error('TERMINAL_EXITED: async form');
      Object.assign(err, { code: 'TERMINAL_EXITED' });
      return Promise.reject(err);
    });

    const res = await executor.executeAction('terminal-pane', {
      action: 'sendKeys',
      params: { keys: [{ key: 'X' }] },
    });

    expect(res.success).toBe(false);
    expect(res.code).toBe('TERMINAL_EXITED');
  });
});
