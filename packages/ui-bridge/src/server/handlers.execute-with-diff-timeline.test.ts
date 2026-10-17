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

  describe('aiExecute withDiff forwards the timeline fields', () => {
    let button: HTMLButtonElement;

    beforeEach(() => {
      button = document.createElement('button');
      button.textContent = 'Publish';
      Object.defineProperty(button, 'offsetParent', {
        configurable: true,
        get: () => document.body,
      });
      // jsdom has no layout: give the button a box so the click is not refused.
      button.getBoundingClientRect = () =>
        ({ x: 0, y: 0, width: 80, height: 24, top: 0, left: 0, right: 80, bottom: 24 }) as DOMRect;
      button.addEventListener('click', () => {
        setTimeout(() => registry.activateState('saved-toast'), 30);
      });
      document.body.appendChild(button);
      registry.registerElement('publish-button', button, {
        type: 'button',
        label: 'Publish',
        actions: ['click'],
      });
    });

    afterEach(() => button.remove());

    it('expectStates + withinMs are answered; timeline: false opts out', async () => {
      const withTimeline = await handlers.aiExecute!({
        instruction: 'click Publish',
        withDiff: true,
        settleMinStable: 20,
        timelineInterval: 10,
        expectStates: ['saved-toast'],
        withinMs: 10_000,
      } as never);
      expect(withTimeline.success).toBe(true);
      expect((withTimeline.data as unknown as { success?: unknown }).success).toBe(true);
      const timeline = (withTimeline.data as unknown as { timeline: ActionDiffResult['timeline'] })
        .timeline!;
      expect(timeline.summary.expectedStates[0]).toMatchObject({
        stateId: 'saved-toast',
        outcome: { status: 'measured', value: { enteredAtMs: expect.any(Number) } },
      });

      const without = await handlers.aiExecute!({
        instruction: 'click Publish',
        withDiff: true,
        settleMinStable: 10,
        timeline: false,
      } as never);
      expect(without.success).toBe(true);
      expect((without.data as unknown as { timeline?: unknown }).timeline).toBeUndefined();
    }, 30_000);

    it('a FAILED action is an outer failure, the merged diff result kept under data', async () => {
      const result = await handlers.aiExecute!({
        instruction: 'click Nonexistent widget',
        withDiff: true,
        settleMinStable: 10,
        timelineInterval: 10,
      } as never);
      expect(result.success).toBe(false);
      expect(String(result.error).length).toBeGreaterThan(0);
      expect(typeof result.code).toBe('string');
      const data = result.data as unknown as {
        success: boolean;
        actionSuccess: boolean;
        timeline?: unknown;
        diff?: unknown;
      };
      expect(data.success).toBe(false);
      expect(data.actionSuccess).toBe(false);
      expect(data.diff).toBeDefined();
      expect(data.timeline).toBeDefined();
    }, 30_000);
  });
});
