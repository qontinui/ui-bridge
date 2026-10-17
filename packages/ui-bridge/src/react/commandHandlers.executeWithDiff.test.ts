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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  executeCommand,
  __peekRelayChangeTrackerForTest,
  __resetRelayChangeTrackerForTest,
  type BridgeAccess,
} from './commandHandlers';
import { CompositeIdleDetector } from '../idle';
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

describe('relay executeWithDiff · the same ChangeTracker result as the direct transport', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    makeVisible(host);
    document.body.appendChild(host);
    const registry = getGlobalRegistry();
    registry.registerState({ id: 'saved-toast', name: 'Saved toast', elements: [] });
    registry.registerElement('pane', host, {
      type: 'custom',
      customActions: {
        save: {
          id: 'save',
          handler: () => {
            setTimeout(() => getGlobalRegistry().activateState('saved-toast'), 30);
            return { ok: true };
          },
        },
        noop: { id: 'noop', handler: () => ({ ok: true }) },
      },
    });
  });

  afterEach(() => {
    host.remove();
    getGlobalRegistry().clear();
  });

  const FAST = { settleMinStable: 20, timelineInterval: 10, settleTimeout: 2000 };

  it('returns the timeline by default, with a summary of Observations and a semantic diff', async () => {
    const result = (await executeCommand(
      'executeWithDiff',
      { elementAction: { elementId: 'pane', action: 'noop' }, ...FAST },
      emptyBridge
    )) as Record<string, unknown>;
    expect(result.actionSuccess).toBe(true);
    const timeline = result.timeline as {
      events: Array<{ type: string }>;
      summary: Record<string, { status?: string }>;
    };
    expect(timeline.events[0].type).toBe('action');
    expect(timeline.summary.settleMs.status).toBe('measured');
    // jsdom has no PerformanceObserver: unknown, never a measured 0.
    expect(timeline.summary.layoutShiftTotal).toMatchObject({
      status: 'unknown',
      unknown: { code: 'performance_observer_unsupported' },
    });
    expect((result.diff as { changes?: unknown }).changes).toBeDefined();
  });

  it('timeline: false opts out', async () => {
    const result = (await executeCommand(
      'executeWithDiff',
      {
        elementAction: { elementId: 'pane', action: 'noop' },
        timeline: false,
        settleMinStable: 10,
      },
      emptyBridge
    )) as Record<string, unknown>;
    expect(result.actionSuccess).toBe(true);
    expect(result.timeline).toBeUndefined();
  });

  it('forwards expectStates + withinMs to the declared-state registry', async () => {
    const entered = (await executeCommand(
      'executeWithDiff',
      {
        elementAction: { elementId: 'pane', action: 'save' },
        ...FAST,
        expectStates: ['saved-toast'],
        withinMs: 10_000,
      },
      emptyBridge
    )) as { timeline: { summary: { expectedStates: Array<{ outcome: { value?: object } }> } } };
    expect(entered.timeline.summary.expectedStates[0].outcome).toMatchObject({
      status: 'measured',
      value: { enteredAtMs: expect.any(Number) },
    });

    getGlobalRegistry().deactivateState('saved-toast');
    const missed = (await executeCommand(
      'executeWithDiff',
      {
        elementAction: { elementId: 'pane', action: 'noop' },
        ...FAST,
        expectStates: ['saved-toast'],
        withinMs: 100,
      },
      emptyBridge
    )) as { timeline: { summary: { expectedStates: Array<{ outcome: unknown }> } } };
    expect(missed.timeline.summary.expectedStates[0].outcome).toMatchObject({
      status: 'measured',
      value: { notEnteredWithinMs: 100 },
    });
  }, 30_000);

  it('legacy flat elementId/action fields still drive the action', async () => {
    const result = (await executeCommand(
      'executeWithDiff',
      { elementId: 'pane', action: 'noop', ...FAST },
      emptyBridge
    )) as Record<string, unknown>;
    expect(result.actionSuccess).toBe(true);
    expect(result.timeline).toBeDefined();
  });
});

describe('relay aiExecute withDiff · the shared tracker path', () => {
  let button: HTMLButtonElement;

  beforeEach(() => {
    const registry = getGlobalRegistry();
    registry.registerState({ id: 'saved-toast', name: 'Saved toast', elements: [] });
    button = document.createElement('button');
    button.textContent = 'Publish';
    makeVisible(button);
    button.addEventListener('click', () => {
      setTimeout(() => getGlobalRegistry().activateState('saved-toast'), 30);
    });
    document.body.appendChild(button);
    registry.registerElement('publish-button', button, {
      type: 'button',
      label: 'Publish',
      actions: ['click'],
    });
  });

  afterEach(() => {
    button.remove();
    getGlobalRegistry().clear();
  });

  it('answers the NL response merged with the diff and the timeline', async () => {
    const result = (await executeCommand(
      'aiExecute',
      {
        instruction: 'click Publish',
        withDiff: true,
        settleMinStable: 20,
        timelineInterval: 10,
        expectStates: ['saved-toast'],
        withinMs: 10_000,
      },
      emptyBridge
    )) as Record<string, unknown>;
    expect(result.success).toBe(true);
    expect(result.actionSuccess).toBe(true);
    expect(result.executedAction).toBeDefined();
    expect((result.diff as { changes?: unknown }).changes).toBeDefined();
    const timeline = result.timeline as {
      summary: { expectedStates: Array<{ outcome: unknown }> };
    };
    expect(timeline.summary.expectedStates[0].outcome).toMatchObject({
      status: 'measured',
      value: { enteredAtMs: expect.any(Number) },
    });
  }, 30_000);

  it('a failed action is success:false with an error, and an OUTER failure through relayCommand', async () => {
    const payload = {
      instruction: 'click Nonexistent widget',
      withDiff: true,
      settleMinStable: 10,
      timelineInterval: 10,
    };
    const direct = (await executeCommand('aiExecute', payload, emptyBridge)) as Record<
      string,
      unknown
    >;
    expect(direct.success).toBe(false);
    expect(direct.actionSuccess).toBe(false);
    expect(String(direct.error).length).toBeGreaterThan(0);
    expect(direct.timeline).toBeDefined();

    const handlers = createRelayHandlers(relayRunningTheDispatcher());
    const viaRelay = await handlers.aiExecute!(payload as never);
    expect(viaRelay.success).toBe(false);
    expect(String(viaRelay.error).length).toBeGreaterThan(0);
  }, 30_000);

  it('plain aiExecute over the relay: a failed action is already an OUTER failure', async () => {
    const handlers = createRelayHandlers(relayRunningTheDispatcher());
    const failed = await handlers.aiExecute!({ instruction: 'click Nonexistent widget' } as never);
    expect(failed.success).toBe(false);
    expect(String(failed.error).length).toBeGreaterThan(0);

    const ok = await handlers.aiExecute!({ instruction: 'click Publish' } as never);
    expect(ok.success).toBe(true);
  }, 30_000);
});

describe('relay executeWithDiff · inputs: idle detector, network, one tracker, no inner settle', () => {
  let host: HTMLElement;

  beforeEach(() => {
    __resetRelayChangeTrackerForTest();
    host = document.createElement('div');
    makeVisible(host);
    document.body.appendChild(host);
    getGlobalRegistry().registerElement('pane', host, {
      type: 'custom',
      customActions: { noop: { id: 'noop', handler: () => ({ ok: true }) } },
    });
  });

  afterEach(() => {
    host.remove();
    getGlobalRegistry().clear();
    delete (globalThis as { __UI_BRIDGE__?: unknown }).__UI_BRIDGE__;
    __resetRelayChangeTrackerForTest();
    vi.restoreAllMocks();
  });

  const run = () =>
    executeCommand(
      'executeWithDiff',
      {
        elementAction: { elementId: 'pane', action: 'noop' },
        settleMinStable: 20,
        timelineInterval: 10,
      },
      emptyBridge
    ) as Promise<{ timeline: { observedSources: string[]; events: Array<{ type: string }> } }>;

  it('gates settle on the idle detector; a fetch after the action is recorded by the relay network tracker', async () => {
    getGlobalRegistry().registerElement('fetcher', host, {
      type: 'custom',
      customActions: {
        load: {
          id: 'load',
          handler: () => {
            // The page fetches after the action (no server here: it errors).
            void fetch('/api/items?page=2').catch(() => undefined);
            return { ok: true };
          },
        },
      },
    });
    const result = (await executeCommand(
      'executeWithDiff',
      {
        elementAction: { elementId: 'fetcher', action: 'load' },
        settleMinStable: 20,
        timelineInterval: 10,
      },
      emptyBridge
    )) as { timeline: { observedSources: string[]; events: Array<Record<string, unknown>> } };
    expect(result.timeline.observedSources).toContain('idle-detector');
    expect(result.timeline.observedSources).toContain('network');
    const started = result.timeline.events.find((e) => e.type === 'network-request-started');
    expect(started).toMatchObject({
      method: 'GET',
      url: `${location.origin}/api/items`,
      hasQuery: true,
    });
  }, 30_000);

  it("records the page's NetworkRequestTracker when the app exposes one", async () => {
    let listener: ((e: unknown) => void) | null = null;
    (globalThis as { __UI_BRIDGE__?: unknown }).__UI_BRIDGE__ = {
      networkTracker: {
        onEvent: (cb: (e: unknown) => void) => {
          listener = cb;
          return () => (listener = null);
        },
      },
    };
    getGlobalRegistry().registerElement('net', host, {
      type: 'custom',
      customActions: {
        fetch: {
          id: 'fetch',
          handler: () => {
            listener?.({
              type: 'request-start',
              timestamp: Date.now(),
              entry: {
                request: { id: 'n1', url: '/api/x?y=1', method: 'GET', startedAt: Date.now() },
              },
            });
            return { ok: true };
          },
        },
      },
    });
    const result = (await executeCommand(
      'executeWithDiff',
      {
        elementAction: { elementId: 'net', action: 'fetch' },
        settleMinStable: 20,
        timelineInterval: 10,
      },
      emptyBridge
    )) as { timeline: { observedSources: string[]; events: Array<Record<string, unknown>> } };
    expect(result.timeline.observedSources).toContain('network');
    expect(result.timeline.events.find((e) => e.type === 'network-request-started')).toMatchObject({
      requestId: 'n1',
      hasQuery: true,
    });
  }, 30_000);

  it('builds ONE relay ChangeTracker, reused across calls', async () => {
    await run();
    const first = __peekRelayChangeTrackerForTest();
    expect(first).not.toBeNull();
    await run();
    expect(__peekRelayChangeTrackerForTest()).toBe(first);
  }, 30_000);

  it('settles ONCE before the timeline; the inner action runs with skipSettle', async () => {
    const getSignal = vi.spyOn(CompositeIdleDetector.prototype, 'getSignal');
    await run();
    // Exactly one pre-read DOM settle (relayExecuteWithDiff's), none inside the action.
    expect(getSignal.mock.calls.filter(([name]) => name === 'dom')).toHaveLength(1);
    getSignal.mockClear();
    await executeCommand(
      'executeWithDiff',
      {
        elementAction: { elementId: 'pane', action: 'noop' },
        skipSettle: true,
        settleMinStable: 20,
        timelineInterval: 10,
      },
      emptyBridge
    );
    expect(getSignal.mock.calls.filter(([name]) => name === 'dom')).toHaveLength(0);
  }, 30_000);
});
