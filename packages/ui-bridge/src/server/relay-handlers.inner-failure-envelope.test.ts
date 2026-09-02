/**
 * An inner `success: false` must never surface as an outer success.
 *
 * THE DEFECT these tests pin down: the browser-side dispatcher
 * (`react/commandHandlers.ts`) reports a failed command by RESOLVING with
 * `{ success: false, error, failureDetails }` — it does not throw. The relay's
 * `relayCommand` only had a `catch` arm, so every resolved result was wrapped
 * in `success(result)`. A refused action therefore reached the caller as
 * `{ success: true, data: { success: false, … } }` at HTTP 200: outer success,
 * failure buried one level down.
 *
 * That is not cosmetic. Every consumer branches on the envelope — it is the
 * documented contract — and the runner's `handle_element_action`
 * (`src-tauri/src/mcp/sdk_client.rs`) reads exactly that top-level `success`
 * field, so a write that never happened was reported, recorded, and acted on
 * as a write that did.
 *
 * The seam is SHARED by every relayed command, so these tests deliberately
 * cover more than the action that was measured: an element action, a component
 * action, a batch action, and a workflow command all ride the same function. A
 * fix scoped to one verb would leave the same lie in place for the rest.
 */

import { describe, it, expect } from 'vitest';
import { CommandRelay } from './command-relay';
import { createRelayHandlers } from './relay-handlers';

function freshRelay(): CommandRelay {
  // Each test gets its own globalThis-key prefix — CommandRelay persists state
  // on globalThis for HMR survival, which would otherwise leak between tests.
  const prefix = `__uiBridgeTest_${Math.random().toString(36).slice(2, 10)}`;
  return new CommandRelay({ globalPrefix: prefix });
}

/**
 * Register a tab that answers every relayed command with `makeResult(action)`,
 * standing in for the browser-side dispatcher.
 */
function registerRespondingTab(
  relay: CommandRelay,
  tabId: string,
  makeResult: (action: string) => unknown
): void {
  relay.subscribeToCommands((cmd) => {
    setTimeout(() => {
      relay.resolveCommand(cmd.commandId, makeResult(cmd.action), tabId);
    }, 0);
  }, tabId);
}

/** The exact shape `createActionFailure` emits in `react/commandHandlers.ts`. */
function browserActionFailure(errorCode: string, message: string): Record<string, unknown> {
  return {
    success: false,
    error: message,
    failureDetails: {
      errorCode,
      message,
      elementId: 'terminal-pane',
      selectorsTried: ['registry:terminal-pane'],
      suggestedActions: [],
      retryRecommended: false,
      durationMs: 3,
    },
    durationMs: 3,
    timestamp: Date.now(),
  };
}

describe('relayCommand · a browser-reported failure is an OUTER failure', () => {
  it('executeElementAction: inner success:false does not surface as outer success', async () => {
    const relay = freshRelay();
    registerRespondingTab(relay, 'tab-a', () =>
      browserActionFailure('ELEMENT_NOT_VISIBLE', 'Element terminal-pane exists but is not visible')
    );
    const handlers = createRelayHandlers(relay);

    const result = await handlers.executeElementAction!('terminal-pane', {
      action: 'sendKeys',
      params: { keys: [{ key: 'Enter' }] },
    });

    // The whole point: the caller is told the truth.
    expect(result.success).toBe(false);
    expect(result.error).toBe('Element terminal-pane exists but is not visible');
    // The payload is preserved verbatim — only the verdict changed, so nothing
    // that reads `failureDetails` loses information.
    const data = result.data as Record<string, unknown>;
    expect(data.success).toBe(false);
    expect((data.failureDetails as { errorCode: string }).errorCode).toBe('ELEMENT_NOT_VISIBLE');
  });

  it('the machine-readable code is carried onto the envelope, not left in prose', async () => {
    const relay = freshRelay();
    registerRespondingTab(relay, 'tab-a', () =>
      browserActionFailure('ELEMENT_NOT_VISIBLE', 'Element terminal-pane exists but is not visible')
    );
    const handlers = createRelayHandlers(relay);

    const result = await handlers.executeElementAction!('terminal-pane', { action: 'click' });

    expect(result.success).toBe(false);
    expect(typeof result.code).toBe('string');
    expect(result.code).toBeTruthy();
  });

  it("a custom-action handler's hoisted `code` survives to the envelope", async () => {
    const relay = freshRelay();
    registerRespondingTab(relay, 'tab-a', () => ({
      success: false,
      error: 'terminal has exited',
      code: 'TERMINAL_EXITED',
      failureDetails: { errorCode: 'ACTION_REJECTED', message: 'terminal has exited' },
    }));
    const handlers = createRelayHandlers(relay);

    const result = await handlers.executeElementAction!('terminal-pane', { action: 'sendKeys' });

    expect(result.success).toBe(false);
    expect(result.code).toBe('TERMINAL_EXITED');
  });

  it('executeComponentAction shares the seam — same verdict', async () => {
    const relay = freshRelay();
    registerRespondingTab(relay, 'tab-a', () => ({
      success: false,
      error: 'Action "submit" not found on component "login-form"',
      timestamp: Date.now(),
    }));
    const handlers = createRelayHandlers(relay);

    const result = await handlers.executeComponentAction!('login-form', {
      action: 'submit',
      params: {},
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found on component');
  });

  it('executeBatchAction shares the seam — same verdict', async () => {
    const relay = freshRelay();
    registerRespondingTab(relay, 'tab-a', () => ({
      success: false,
      error: 'step 2 failed: Element checkout-btn is disabled',
      timestamp: Date.now(),
    }));
    const handlers = createRelayHandlers(relay);

    const result = await handlers.executeBatchAction!({
      steps: [{ elementId: 'a', action: 'click' }],
    } as never);

    expect(result.success).toBe(false);
    expect(result.error).toContain('step 2 failed');
  });

  it('runWorkflow shares the seam — the fix is not action-shaped', async () => {
    const relay = freshRelay();
    registerRespondingTab(relay, 'tab-a', () => ({
      success: false,
      error: 'Workflows not available',
    }));
    const handlers = createRelayHandlers(relay);

    const result = await handlers.runWorkflow!('wf-1', {} as never);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Workflows not available');
  });

  it('a failure with no error message still fails — never a silent success', async () => {
    const relay = freshRelay();
    registerRespondingTab(relay, 'tab-a', () => ({ success: false }));
    const handlers = createRelayHandlers(relay);

    const result = await handlers.executeElementAction!('el', { action: 'click' });

    expect(result.success).toBe(false);
    expect(String(result.error).length).toBeGreaterThan(0);
  });
});

describe('relayCommand · genuine successes are untouched', () => {
  it('inner success:true stays an outer success with the payload under data', async () => {
    const relay = freshRelay();
    registerRespondingTab(relay, 'tab-a', (action) => ({
      success: true,
      action,
      elementId: 'el',
      durationMs: 2,
    }));
    const handlers = createRelayHandlers(relay);

    const result = await handlers.executeElementAction!('el', { action: 'click' });

    expect(result.success).toBe(true);
    expect((result.data as { action: string }).action).toBe('executeElementAction');
  });

  it('a payload with no `success` field at all is passed through unchanged', async () => {
    const relay = freshRelay();
    // Most relay results are plain data — element states, trees, summaries.
    // They must not be re-interpreted by the new check.
    registerRespondingTab(relay, 'tab-a', () => ({ state: { value: 'hello' }, visible: true }));
    const handlers = createRelayHandlers(relay);

    const result = await handlers.getElementState!('el');

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ state: { value: 'hello' }, visible: true });
  });

  it('an array payload is not mistaken for a failure', async () => {
    const relay = freshRelay();
    registerRespondingTab(relay, 'tab-a', () => [{ id: 'a' }, { id: 'b' }]);
    const handlers = createRelayHandlers(relay);

    const result = await handlers.getElementTree!();

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(2);
  });

  it('a null payload is not mistaken for a failure', async () => {
    const relay = freshRelay();
    registerRespondingTab(relay, 'tab-a', () => null);
    const handlers = createRelayHandlers(relay);

    // `getElementReactState` is a straight `relayCommand` pass-through — no
    // cache fallback or not-found synthesis in front of it.
    const result = await handlers.getElementReactState!('el');

    expect(result.success).toBe(true);
    expect(result.data).toBeNull();
  });
});
