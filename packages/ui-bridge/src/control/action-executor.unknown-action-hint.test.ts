/**
 * Unknown-action refusals name the element's verbs and a "did you mean"
 * (plan 2026-10-22-runner-ui-bridge-makes-an-agent-guess-its-own-vocabulary,
 * Phase 8), on both web dispatch paths: the HTTP/SDK executor
 * (`DefaultActionExecutor.executeAction`) and the relay/injected path
 * (`react/commandHandlers.ts` `executeElementAction`). Before, the executor
 * answered with the GLOBAL verb list and the relay with a bare
 * `Unknown action: <verb>`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UIBridgeRegistry, getGlobalRegistry } from '../core/registry';
import type { StandardAction } from '../core/types';
import { DefaultActionExecutor } from './action-executor';
import { executeCommand, type BridgeAccess } from '../react/commandHandlers';

describe('DefaultActionExecutor — unknown action', () => {
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
    container.remove();
  });

  function register(id: string, actions: StandardAction[]): void {
    const el = document.createElement('input');
    el.setAttribute('data-testid', id);
    container.appendChild(el);
    registry.registerElement(id, el, { type: 'input', label: id, actions });
  }

  it("`press` on a text input lists the input's verbs and suggests `sendKeys`", async () => {
    register('terminal.command-bar-input', ['focus', 'blur', 'type', 'sendKeys']);
    const res = await executor.executeAction('terminal.command-bar-input', { action: 'press' });

    expect(res.success).toBe(false);
    expect(res.error).toBe(
      "Unknown action 'press' for element 'terminal.command-bar-input'. " +
        "This element accepts: focus, blur, type, sendKeys. Did you mean 'sendKeys'?"
    );
    expect(res.failureDetails?.errorCode).toBe('UB-UNSUPPORTED-ACTION');
    expect(res.failureDetails?.context).toMatchObject({
      action: 'press',
      didYouMean: 'sendKeys',
      supportedActions: ['focus', 'blur', 'type', 'sendKeys'],
    });
  });

  it('`press` on a button suggests `click`', async () => {
    register('save', ['focus', 'blur', 'click']);
    const res = await executor.executeAction('save', { action: 'press' });
    expect(res.failureDetails?.context).toMatchObject({ didYouMean: 'click' });
  });

  it('suggests an executable built-in the element does not advertise', async () => {
    register('name', ['click']);
    const res = await executor.executeAction('name', { action: 'fill' });
    expect(res.failureDetails?.context).toMatchObject({
      didYouMean: 'type',
      supportedActions: ['click'],
    });
  });

  it('an unregistered target gets the built-in list and still a suggestion', async () => {
    const res = await executor.executeAction('nowhere', { action: 'dblclick' });
    expect(res.error).toMatch(/^Unknown action 'dblclick'\. Supported: click, hoverClick, /);
    expect(res.error).toMatch(/Did you mean 'doubleClick'\?$/);
    expect(res.failureDetails?.context).toMatchObject({ didYouMean: 'doubleClick' });
  });
});

describe('relay executeElementAction — unknown action', () => {
  const emptyBridge: BridgeAccess = {
    elements: [],
    getElement: () => undefined,
    components: [],
    workflows: [],
  };
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    // jsdom has no layout; the relay's visibility gate reads offsetParent.
    Object.defineProperty(host, 'offsetParent', { configurable: true, get: () => document.body });
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
    getGlobalRegistry().clear();
  });

  it("lists the element's verbs and suggests one", async () => {
    getGlobalRegistry().registerElement('pane', host, {
      type: 'custom',
      actions: ['focus', 'sendKeys'],
    });
    const res = (await executeCommand(
      'executeElementAction',
      { id: 'pane', request: { action: 'keyDown' } },
      emptyBridge
    )) as { success: boolean; error: string; failureDetails: { context: unknown } };

    expect(res.success).toBe(false);
    expect(res.error).toBe(
      "Unknown action 'keyDown' for element 'pane'. " +
        "This element accepts: focus, sendKeys. Did you mean 'sendKeys'?"
    );
    expect(res.failureDetails.context).toMatchObject({
      action: 'keyDown',
      didYouMean: 'sendKeys',
      supportedActions: ['focus', 'sendKeys'],
    });
  });
});
