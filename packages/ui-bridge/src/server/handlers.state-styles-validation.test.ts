/**
 * `getElementStateStyles` refuses a state name it cannot apply, on both doors.
 *
 * `captureStateVariations` applies nothing for an unknown name, so before this
 * check the HTTP door answered a typo such as `focus_visible` with the default
 * styles labelled `focus_visible` (a reply that reads like a measurement),
 * and the relay dropped the name without saying so.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHandlers, type RegistryLike } from './handlers';
import { resetGlobalRegistry, getGlobalRegistry } from '../core/registry';
import { executeCommand, type BridgeAccess } from '../react/commandHandlers';
import { invalidStatesMessage, unknownInteractionStates } from '../ai/interaction-states';
import { CommandRelay } from './command-relay';
import { createRelayHandlers } from './relay-handlers';

function makeRegistryLike(): RegistryLike {
  const reg = getGlobalRegistry();
  return {
    getAllElements: () => reg.getAllElements(),
    getElement: (id) => reg.getElement(id),
    getAllComponents: () => reg.getAllComponents(),
    getComponent: (id) => reg.getComponent(id),
    getComponentState: (id) => reg.getComponentState?.(id) ?? null,
    createSnapshot: () => reg.createSnapshot() as ReturnType<RegistryLike['createSnapshot']>,
  };
}

const actionExecutor = {
  executeAction: async () => ({ success: true }),
  executeComponentAction: async () => ({ success: true }),
};

const emptyBridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
};

describe('unknownInteractionStates / invalidStatesMessage', () => {
  it('accepts every interaction state and default', () => {
    expect(
      unknownInteractionStates(['default', 'hover', 'focus', 'focus-visible', 'active', 'disabled'])
    ).toEqual([]);
    expect(invalidStatesMessage(undefined)).toBeNull();
    expect(invalidStatesMessage(null)).toBeNull();
    expect(invalidStatesMessage(['focus-visible'])).toBeNull();
  });

  it('names each unknown entry, including non-strings', () => {
    expect(unknownInteractionStates(['hover', 'focus_visible', 3])).toEqual(['focus_visible', '3']);
    const msg = invalidStatesMessage(['focus_visible']);
    expect(msg).toContain('focus_visible');
    expect(msg).toContain('focus-visible');
  });

  it('refuses a states value that is not an array', () => {
    expect(invalidStatesMessage('hover')).toMatch(/must be an array/);
  });
});

describe('getElementStateStyles refuses unknown states', () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    resetGlobalRegistry();
    root = document.createElement('div');
    const btn = document.createElement('button');
    btn.id = 'b';
    root.appendChild(btn);
    document.body.appendChild(root);
    getGlobalRegistry().registerElement('b', btn, { type: 'button' });
  });

  afterEach(() => {
    root.remove();
    resetGlobalRegistry();
  });

  it('HTTP door: a typo is a validation error, not default styles under the typo', async () => {
    const handlers = createHandlers(makeRegistryLike(), actionExecutor as never, {
      consoleCapture: null as never,
    });
    const resp = await handlers.getElementStateStyles('b', {
      states: ['focus_visible'] as never,
    });
    expect(resp.success).toBe(false);
    expect(resp.error).toContain('focus_visible');
    expect(resp.code).toBe('UB-VALIDATION-ERROR');
    expect(resp.data).toBeUndefined();
  });

  it('HTTP door: known states still read', async () => {
    const handlers = createHandlers(makeRegistryLike(), actionExecutor as never, {
      consoleCapture: null as never,
    });
    const resp = await handlers.getElementStateStyles('b', { states: ['hover'] });
    expect(resp.success).toBe(true);
    expect(resp.data!.stateStyles.map((s) => s.state)).toEqual(['default', 'hover']);
  });

  it('relay: a typo is refused rather than silently dropped', async () => {
    const out = (await executeCommand(
      'getElementStateStyles',
      { id: 'b', states: ['hover', 'focus_visible'] },
      emptyBridge
    )) as { success?: boolean; error?: string; code?: string; stateStyles?: unknown };
    expect(out.success).toBe(false);
    expect(out.error).toContain('focus_visible');
    expect(out.code).toBe('UB-VALIDATION-ERROR');
    expect(out.stateStyles).toBeUndefined();
  });

  it('HTTP door and relay: null states mean the default set, as omitted does', async () => {
    const handlers = createHandlers(makeRegistryLike(), actionExecutor as never, {
      consoleCapture: null as never,
    });
    const resp = await handlers.getElementStateStyles('b', { states: null as never });
    expect(resp.success).toBe(true);
    expect(resp.data!.stateStyles.map((s) => s.state)).toContain('focus-visible');
    const out = (await executeCommand(
      'getElementStateStyles',
      { id: 'b', states: null },
      emptyBridge
    )) as { stateStyles: Array<{ state: string }> };
    expect(out.stateStyles.map((s) => s.state)).toEqual([
      'default',
      'hover',
      'focus',
      'focus-visible',
      'active',
    ]);
  });

  it('relay server: refuses before any tab is consulted', async () => {
    const relay = new CommandRelay({
      globalPrefix: `__uiBridgeStateStylesValidation_${Math.random().toString(36).slice(2, 10)}`,
    });
    const queue = vi.spyOn(relay, 'queueCommand');
    try {
      const resp = await createRelayHandlers(relay).getElementStateStyles(
        'b',
        { states: ['focus_visible'] as never },
        undefined as never
      );
      expect(resp.success).toBe(false);
      expect(resp.code).toBe('UB-VALIDATION-ERROR');
      expect(resp.error).toContain('focus_visible');
      expect(queue).not.toHaveBeenCalled();
    } finally {
      relay.destroy();
    }
  });
});
