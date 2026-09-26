/**
 * `executeWithDiff` on the RELAY path carries the action's verdict.
 *
 * THE DEFECT these tests pin down: the relay dispatcher answered
 * `executeWithDiff` with `{ actionResult, diff }` — no `actionSuccess` and no
 * `success`. `relayCommand`'s inner-failure lift (`readRelayInnerFailure`)
 * keys on a literal `success: false`, so it never fired: an action that failed
 * reached every caller (the runner's `/ui-bridge/sdk/ai/execute-with-diff`
 * passes the body straight through) as an outer success.
 *
 * The in-process producer (`ChangeTracker.executeWithDiff`) already emitted
 * `actionSuccess`; the relay payload now emits the same field, and a false
 * verdict is reported the way every other relay command reports failure.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { executeCommand, type BridgeAccess } from './commandHandlers';
import { getGlobalRegistry } from '../core/registry';
import { CommandRelay } from '../server/command-relay';
import { createRelayHandlers } from '../server/relay-handlers';

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

/** A relay whose tab answers every command by running the real dispatcher. */
function relayRunningTheDispatcher(): CommandRelay {
  const prefix = `__uiBridgeTest_${Math.random().toString(36).slice(2, 10)}`;
  const relay = new CommandRelay({ globalPrefix: prefix });
  relay.subscribeToCommands((cmd) => {
    void executeCommand(cmd.action, cmd.payload as Record<string, unknown>, emptyBridge).then(
      (result) => relay.resolveCommand(cmd.commandId, result, 'tab-a')
    );
  }, 'tab-a');
  return relay;
}

describe('relay executeWithDiff · the action verdict is on the payload and the envelope', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    makeVisible(host);
    document.body.appendChild(host);
    getGlobalRegistry().registerElement('pane', host, {
      type: 'custom',
      customActions: {
        write: { id: 'write', handler: () => ({ bytesWritten: 3 }) },
        writeDead: {
          id: 'writeDead',
          handler: () => {
            throw Object.assign(new Error('terminal has exited'), { code: 'TERMINAL_EXITED' });
          },
        },
      },
    });
  });

  afterEach(() => {
    host.remove();
    getGlobalRegistry().clear();
  });

  it('a successful action reports actionSuccess: true and no failure', async () => {
    const result = (await executeCommand(
      'executeWithDiff',
      { elementAction: { elementId: 'pane', action: 'write' } },
      emptyBridge
    )) as Record<string, unknown>;

    expect(result.actionSuccess).toBe(true);
    expect(result.success).toBeUndefined();
    expect((result.actionResult as { success?: unknown }).success).toBe(true);
    expect(result.diff).toBeDefined();
  });

  it('a failed action reports actionSuccess: false and a lift-able failure, keeping the diff', async () => {
    const result = (await executeCommand(
      'executeWithDiff',
      { elementAction: { elementId: 'pane', action: 'writeDead' } },
      emptyBridge
    )) as Record<string, unknown>;

    expect(result.actionSuccess).toBe(false);
    expect(result.success).toBe(false);
    expect(String(result.error)).toContain('terminal has exited');
    // The handler's own code is hoisted verbatim for the relay lift.
    expect(result.code).toBe('TERMINAL_EXITED');
    expect((result.actionResult as { success?: unknown }).success).toBe(false);
    expect(result.diff).toBeDefined();
  });

  it('an action on an unknown element fails with the SDK error code hoisted', async () => {
    const result = (await executeCommand(
      'executeWithDiff',
      { elementId: 'no-such-element', action: 'click' },
      emptyBridge
    )) as Record<string, unknown>;

    expect(result.actionSuccess).toBe(false);
    expect(result.success).toBe(false);
    expect(typeof result.errorCode).toBe('string');
    expect(String(result.errorCode).length).toBeGreaterThan(0);
  });

  it('through relayCommand, a failed action is an OUTER failure with the payload kept', async () => {
    const handlers = createRelayHandlers(relayRunningTheDispatcher());

    const result = await handlers.executeWithDiff!({
      elementAction: { elementId: 'pane', action: 'writeDead' },
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('TERMINAL_EXITED');
    expect(String(result.error)).toContain('terminal has exited');
    const data = result.data as unknown as Record<string, unknown>;
    expect(data.actionSuccess).toBe(false);
    expect(data.diff).toBeDefined();
  });

  it('through relayCommand, a successful action is an outer success', async () => {
    const handlers = createRelayHandlers(relayRunningTheDispatcher());

    const result = await handlers.executeWithDiff!({
      elementAction: { elementId: 'pane', action: 'write' },
    });

    expect(result.success).toBe(true);
    expect((result.data as unknown as Record<string, unknown>).actionSuccess).toBe(true);
  });
});
