/**
 * The DIRECT transport wires the declared-state registry into the change
 * tracker, so `expectStates` is answered end to end through `createHandlers`
 * (the producer behind `POST /ai/execute-with-diff`), and the timeline is on
 * without being asked for.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { createHandlers, type RegistryLike } from './handlers';
import { UIBridgeRegistry } from '../core/registry';
import { DefaultActionExecutor } from '../control/action-executor';
import type { ActionDiffResult } from '../ai';

beforeAll(() => {
  if (typeof document !== 'undefined' && !document.elementFromPoint) {
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => null,
    });
  }
});

describe('direct executeWithDiff · timeline and declared states', () => {
  let registry: UIBridgeRegistry;
  let handlers: ReturnType<typeof createHandlers>;
  let container: HTMLDivElement;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    const executor = new DefaultActionExecutor(registry);
    handlers = createHandlers(registry as unknown as RegistryLike, executor as never);
    container = document.createElement('div');
    document.body.appendChild(container);
    registry.registerState({ id: 'saved-toast', name: 'Saved toast', elements: [] });
    registry.registerElement('save', container, {
      type: 'custom',
      customActions: {
        save: {
          id: 'save',
          handler: () => {
            setTimeout(() => registry.activateState('saved-toast'), 50);
            return { ok: true };
          },
        },
        noop: { id: 'noop', handler: () => ({ ok: true }) },
      },
    });
  });

  afterEach(() => {
    container.remove();
    registry.clear();
  });

  it('a declared state the action enters answers enteredAtMs and appears as state-entered', async () => {
    const result = await handlers.executeWithDiff!({
      elementAction: { elementId: 'save', action: 'save' },
      settleTimeout: 1000,
      settleMinStable: 20,
      timelineInterval: 10,
      expectStates: ['saved-toast'],
      // Generous: the state enters at ~50ms; the window only bounds a loaded box.
      withinMs: 10_000,
    });
    expect(result.success).toBe(true);
    const timeline = (result.data as ActionDiffResult).timeline!;
    expect(
      timeline.events.some((e) => e.type === 'state-entered' && e.stateId === 'saved-toast')
    ).toBe(true);
    const outcome = timeline.summary.expectedStates[0].outcome;
    expect(outcome.status).toBe('measured');
    expect(outcome.status === 'measured' && 'enteredAtMs' in outcome.value).toBe(true);
  }, 30_000);

  it('a declared state the action never enters is a measured negative with its window', async () => {
    const result = await handlers.executeWithDiff!({
      elementAction: { elementId: 'save', action: 'noop' },
      settleTimeout: 500,
      settleMinStable: 20,
      timelineInterval: 10,
      expectStates: ['saved-toast'],
      withinMs: 150,
    });
    const timeline = (result.data as ActionDiffResult).timeline!;
    expect(timeline.summary.expectedStates[0].outcome).toMatchObject({
      status: 'measured',
      value: { notEnteredWithinMs: 150 },
    });
  }, 30_000);
});
