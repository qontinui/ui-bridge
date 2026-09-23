/**
 * `sendKeys` on the RELAY / injected dispatch path (`executeElementAction`).
 *
 * `react/commandHandlers.ts` carries its own DOM implementation of the built-in
 * `sendKeys` verb, separate from `DefaultActionExecutor.performSendKeys`. Both
 * loops used to skip a key element they could not read and still report
 * success (UI-3, plan 2026-09-23-conductor-e2e-phase1-defects). Both now
 * normalize through the shared `normalizeKeyDescriptors` grammar.
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

describe('relay executeElementAction · sendKeys key elements', () => {
  let input: HTMLInputElement;
  let seen: string[];

  beforeEach(() => {
    input = document.createElement('input');
    input.type = 'text';
    makeVisible(input);
    document.body.appendChild(input);
    getGlobalRegistry().registerElement('cmd-bar', input, { type: 'input', label: 'Command' });
    seen = [];
    input.addEventListener('keydown', (e) => seen.push(`keydown:${e.key}`));
  });

  afterEach(() => {
    input.remove();
    getGlobalRegistry().clear();
  });

  it('dispatches a bare string element as a key name', async () => {
    const result = await relayAction('cmd-bar', {
      action: 'sendKeys',
      params: { keys: ['Enter'] },
    });

    expect(result.success).toBe(true);
    expect(seen).toEqual(['keydown:Enter']);
  });

  it('applies the modifiers of a bare-string combo element', async () => {
    // The old relay loop dispatched a string element verbatim, so `"ctrl+a"`
    // arrived as a key literally named "ctrl+a" with no modifier held.
    const mods: boolean[] = [];
    input.addEventListener('keydown', (e) => mods.push(e.ctrlKey));

    const result = await relayAction('cmd-bar', {
      action: 'sendKeys',
      params: { keys: ['ctrl+a'] },
    });

    expect(result.success).toBe(true);
    expect(seen).toEqual(['keydown:a']);
    expect(mods).toEqual([true]);
  });

  it('dispatches a bare-string space element', async () => {
    const result = await relayAction('cmd-bar', {
      action: 'sendKeys',
      params: { keys: ['h', ' ', 'i'] },
    });

    expect(result.success).toBe(true);
    expect(seen).toEqual(['keydown:h', 'keydown: ', 'keydown:i']);
  });

  it('fails on a non-string, non-object element instead of skipping it', async () => {
    const result = await relayAction('cmd-bar', {
      action: 'sendKeys',
      params: { keys: [{ key: 'a' }, 42] },
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/key entry must be a string or a \{ key, modifiers\? \} object/);
    expect((result.failureDetails as { errorCode?: string }).errorCode).toBe('INVALID_PARAMS');
    expect(seen).toEqual([]);
  });

  it('fails on an object element with no usable key instead of skipping it', async () => {
    const result = await relayAction('cmd-bar', {
      action: 'sendKeys',
      params: { keys: [{ key: '' }] },
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/non-empty string 'key'/);
    expect((result.failureDetails as { errorCode?: string }).errorCode).toBe('INVALID_PARAMS');
  });
});
