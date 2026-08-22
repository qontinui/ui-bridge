/**
 * `executeAction` outer catch — typed handler-error propagation.
 *
 * THE DEFECT: throwing is the only way a custom-action handler can make
 * `executeAction` report `success: false` (a handler that RESOLVES is a
 * success no matter what it resolved with), so handlers encode the
 * machine-readable reason on the thrown `Error`:
 *
 *     Object.assign(err, { code: 'TERMINAL_EXITED', terminalId, exitCode })
 *
 * The outer catch kept only `error.message`, so the runner's dead-terminal
 * write — minted as `TERMINAL_EXITED` — reached the caller as a bare
 * `UB-ACTION-FAILED` with the reason available only as prose.
 *
 * The contract these tests pin:
 *   1. A typed throw preserves `code` at the response top level (which is
 *      what the runner reads as `data.code`) and the handler's other fields
 *      in `failureDetails.context`.
 *   2. The canonical SDK taxonomy is unchanged — `failureDetails.errorCode`
 *      stays `UB-ACTION-FAILED`. The handler's vocabulary is propagated,
 *      not translated, and no new taxonomy is invented.
 *   3. An untyped `Error` still degrades to exactly today's generic shape:
 *      no `code`, no extra context keys.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UIBridgeRegistry } from '../core/registry';
import { DefaultActionExecutor } from './action-executor';

/** The runner's `throwIfWriteFailed` shape, reproduced verbatim in spirit. */
function makeTerminalExitedError(): Error {
  const err = new Error(
    'TERMINAL_EXITED: terminal term-3 is not writable — its process exited with code 1. ' +
      'Restart the session before writing to it.'
  );
  Object.assign(err, {
    code: 'TERMINAL_EXITED',
    terminalId: 'term-3',
    exitCode: 1,
  });
  return err;
}

describe('DefaultActionExecutor — typed handler error propagation', () => {
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

  /** Register a DOM element carrying one throwing custom action. */
  function registerThrowingAction(id: string, action: string, thrown: unknown): void {
    const el = document.createElement('div');
    el.setAttribute('data-testid', id);
    container.appendChild(el);
    registry.registerElement(id, el, {
      type: 'custom',
      label: id,
      customActions: {
        [action]: {
          id: action,
          handler: () => {
            throw thrown;
          },
        },
      },
    });
  }

  it('preserves a typed handler code (dead-terminal write → TERMINAL_EXITED)', async () => {
    registerThrowingAction('terminal-pane', 'writeToTerminal', makeTerminalExitedError());

    const res = await executor.executeAction('terminal-pane', {
      action: 'writeToTerminal',
      params: { text: 'ls\n' },
    });

    expect(res.success).toBe(false);
    // The whole point: the handler's own code survives the catch. This is the
    // field the runner surfaces as `data.code`.
    expect(res.code).toBe('TERMINAL_EXITED');
    // The other typed fields ride along in the failure context.
    expect(res.failureDetails?.context?.terminalId).toBe('term-3');
    expect(res.failureDetails?.context?.exitCode).toBe(1);
    expect(res.failureDetails?.context?.code).toBe('TERMINAL_EXITED');
    // The action name that the generic path already recorded is retained.
    expect(res.failureDetails?.context?.action).toBe('writeToTerminal');
    // Prose is still there for the human audience.
    expect(res.error).toContain('TERMINAL_EXITED');
  });

  it('does NOT rewrite the canonical UiBridgeErrorCode taxonomy', async () => {
    registerThrowingAction('terminal-pane', 'writeToTerminal', makeTerminalExitedError());

    const res = await executor.executeAction('terminal-pane', {
      action: 'writeToTerminal',
      params: { text: 'ls\n' },
    });

    // A handler throw remains UB-ACTION-FAILED — `code` carries the handler's
    // vocabulary alongside it, it does not replace the SDK's.
    expect(res.failureDetails?.errorCode).toBe('UB-ACTION-FAILED');
    expect(res.failureDetails?.suggestedActions.length).toBeGreaterThan(0);
  });

  it('propagates the second terminal code (TERMINAL_WRITE_FAILED) unchanged', async () => {
    const err = new Error('TERMINAL_WRITE_FAILED: terminal_write failed for term-9: ipc down');
    Object.assign(err, { code: 'TERMINAL_WRITE_FAILED', terminalId: 'term-9', exitCode: null });
    // NB: a *custom* action name, kept deliberately distinct from the built-in
    // verbs so this file exercises only the typed-error path. (The
    // built-in-shadowing defect that once made `sendKeys` unusable as a custom
    // name is fixed — see `action-executor.custom-action-precedence.test.ts`,
    // which pins the collision case including its typed-code passthrough.)
    registerThrowingAction('pane-9', 'writeToTerminal', err);

    const res = await executor.executeAction('pane-9', { action: 'writeToTerminal' });

    expect(res.success).toBe(false);
    expect(res.code).toBe('TERMINAL_WRITE_FAILED');
    expect(res.failureDetails?.context?.terminalId).toBe('term-9');
    expect(res.failureDetails?.context?.exitCode).toBeNull();
  });

  it('an untyped Error still degrades to the generic shape', async () => {
    registerThrowingAction('plain', 'boom', new Error('handler exploded'));

    const res = await executor.executeAction('plain', { action: 'boom' });

    expect(res.success).toBe(false);
    expect(res.error).toContain('handler exploded');
    expect(res.failureDetails?.errorCode).toBe('UB-ACTION-FAILED');
    // No typed code, and the context is exactly what it was before this change.
    expect(res.code).toBeUndefined();
    expect('code' in res).toBe(false);
    expect(res.failureDetails?.context).toEqual({ action: 'boom' });
  });

  it('ignores a non-string code (DOMException-style numeric codes)', async () => {
    const err = new Error('legacy dom failure');
    Object.assign(err, { code: 18 });
    registerThrowingAction('numeric', 'boom', err);

    const res = await executor.executeAction('numeric', { action: 'boom' });

    expect(res.success).toBe(false);
    expect(res.code).toBeUndefined();
    expect(res.failureDetails?.context).toEqual({ action: 'boom' });
  });

  it('never copies Error plumbing (name/message/stack/cause) into the context', async () => {
    const err = new Error('typed with plumbing');
    Object.assign(err, {
      code: 'CUSTOM_CODE',
      // Own+enumerable copies of the reserved names — must be dropped.
      name: 'WeirdError',
      message: 'shadow message',
      stack: 'shadow stack',
      cause: new Error('inner'),
      detail: 'kept',
    });
    registerThrowingAction('plumbing', 'boom', err);

    const res = await executor.executeAction('plumbing', { action: 'boom' });

    expect(res.code).toBe('CUSTOM_CODE');
    expect(res.failureDetails?.context).toEqual({
      action: 'boom',
      code: 'CUSTOM_CODE',
      detail: 'kept',
    });
  });

  it('leaves successful custom actions untouched (no code field)', async () => {
    const el = document.createElement('div');
    el.setAttribute('data-testid', 'ok-pane');
    container.appendChild(el);
    registry.registerElement('ok-pane', el, {
      type: 'custom',
      label: 'ok-pane',
      customActions: {
        writeToTerminal: { id: 'writeToTerminal', handler: () => ({ bytes: 3 }) },
      },
    });

    const res = await executor.executeAction('ok-pane', { action: 'writeToTerminal' });

    expect(res.success).toBe(true);
    expect(res.code).toBeUndefined();
    expect(res.failureDetails).toBeUndefined();
  });
});
