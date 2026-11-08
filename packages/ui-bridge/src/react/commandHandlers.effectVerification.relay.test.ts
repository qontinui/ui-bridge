/**
 * Effect verification must survive the relay, in both directions.
 *
 * A component action driven through the relay (`createRelayHandlers` on the
 * server, `CommandRelayListener` → `executeCommand` in the browser) used to
 * lose the verification three times over:
 *
 *   1. the server's `POST /control/component/:id/action/:actionId` arm merged
 *      `verifyEffect` into `params`, as if it were an action argument;
 *   2. the listener rebuilt the request as `{ action, params, timeoutMs }`,
 *      dropping `verifyEffect` (and `requestId`) again;
 *   3. the listener's response envelope listed its fields by hand and left
 *      `effectVerification` out, so even a verdict the executor computed — a
 *      declared signature verifies by itself — never reached the caller.
 *
 * The consequence was that every component action driven through the relay
 * could only ever read as unverified, never as a verified pass.
 *
 * The end-to-end tests below join the two halves for real: whatever the relay
 * server hands its dispatch boundary is fed, unchanged, to the listener's
 * `executeCommand`, and the answer is round-tripped through JSON.
 *
 * Every expectation is a hand-written literal.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { executeCommand, type BridgeAccess } from './commandHandlers';
import { resetGlobalRegistry, getGlobalRegistry } from '../core/registry';
import { DefaultActionExecutor } from '../control/action-executor';
import { resetGlobalEffectStore } from '../control/effect-store';
import { resetGlobalActionWindowRegistry } from '../control/action-window-registry';
import type { EffectSignature, PredictedDelta } from '../control/effect-types';
import { createRelayHandlers } from '../server/relay-handlers';
import { CommandRelay } from '../server/command-relay';

const emptyBridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
};

/** The wire is JSON. Whatever survives this round-trip is what a caller sees. */
function overTheWire<T>(value: T): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

async function listener(action: string, payload: Record<string, unknown>) {
  return overTheWire(await executeCommand(action, payload as never, emptyBridge));
}

let container: HTMLDivElement;

/** A handler that makes `revealId` appear and registers it. */
function reveal(revealId: string): () => string {
  return () => {
    const el = document.createElement('div');
    el.setAttribute('data-testid', revealId);
    container.appendChild(el);
    getGlobalRegistry().registerElement(revealId, el, { type: 'menu', label: revealId });
    return 'done';
  };
}

function appearSignature(id: string): EffectSignature {
  return {
    predicts: (): PredictedDelta => ({ elementsAppear: [{ id }] }),
    scope: { elementIds: [id] },
    reversibility: 'reversible',
    settleMs: 0,
  };
}

/** `drawer.open` declares a signature, so it verifies unless the caller declines. */
function registerDrawer(revealId: string): void {
  getGlobalRegistry().registerComponent('drawer', {
    name: 'Drawer',
    actions: [{ id: 'open', signature: appearSignature(revealId), handler: reveal(revealId) }],
  });
}

beforeEach(() => {
  resetGlobalRegistry();
  resetGlobalEffectStore();
  resetGlobalActionWindowRegistry();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
  resetGlobalEffectStore();
  resetGlobalActionWindowRegistry();
  vi.restoreAllMocks();
});

describe('the listener returns the executor’s effect verification', () => {
  it('executeComponentAction (relay spelling) carries effectVerification and requestId', async () => {
    registerDrawer('panel-camel');

    const res = await listener('executeComponentAction', {
      id: 'drawer',
      request: { action: 'open', requestId: 'req-camel' },
    });

    expect(res.success).toBe(true);
    expect(res.result).toBe('done');
    expect((res.effectVerification as Record<string, unknown>).outcome).toBe('Confirmed');
    expect(res.requestId).toBe('req-camel');
  });

  it('execute_component_action (IPC spelling) carries effectVerification and requestId', async () => {
    registerDrawer('panel-snake');

    const res = await listener('execute_component_action', {
      componentId: 'drawer',
      actionId: 'open',
      requestId: 'req-snake',
    });

    expect(res.success).toBe(true);
    expect((res.effectVerification as Record<string, unknown>).outcome).toBe('Confirmed');
    expect(res.requestId).toBe('req-snake');
  });

  it('an action with no signature still answers without a verification field', async () => {
    getGlobalRegistry().registerComponent('plain', {
      name: 'Plain',
      actions: [{ id: 'go', handler: () => 'went' }],
    });

    const res = await listener('executeComponentAction', {
      id: 'plain',
      request: { action: 'go' },
    });

    expect(res.success).toBe(true);
    expect('effectVerification' in res).toBe(false);
  });
});

describe('the listener forwards verifyEffect to the executor', () => {
  it('verifyEffect: false declines a declared signature (relay spelling)', async () => {
    registerDrawer('panel-declined-camel');

    // Control: the same action, not declined, does verify — so the absence
    // below is the decline, not an envelope that drops the field.
    const control = await listener('executeComponentAction', {
      id: 'drawer',
      request: { action: 'open' },
    });
    expect((control.effectVerification as Record<string, unknown>).outcome).toBe('Confirmed');

    const res = await listener('executeComponentAction', {
      id: 'drawer',
      request: { action: 'open', verifyEffect: false },
    });

    expect(res.success).toBe(true);
    expect('effectVerification' in res).toBe(false);
  });

  it('verifyEffect: false declines a declared signature (IPC spelling)', async () => {
    registerDrawer('panel-declined-snake');

    const control = await listener('execute_component_action', {
      componentId: 'drawer',
      actionId: 'open',
    });
    expect((control.effectVerification as Record<string, unknown>).outcome).toBe('Confirmed');

    const res = await listener('execute_component_action', {
      componentId: 'drawer',
      actionId: 'open',
      verifyEffect: false,
    });

    expect(res.success).toBe(true);
    expect('effectVerification' in res).toBe(false);
  });

  it('verifyEffect: true reaches the executor on both spellings', async () => {
    getGlobalRegistry().registerComponent('plain', {
      name: 'Plain',
      actions: [{ id: 'go', handler: () => 'went' }],
    });
    const spy = vi.spyOn(DefaultActionExecutor.prototype, 'executeComponentAction');

    await listener('executeComponentAction', {
      id: 'plain',
      request: { action: 'go', verifyEffect: true },
    });
    await listener('execute_component_action', {
      componentId: 'plain',
      actionId: 'go',
      verifyEffect: true,
    });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0][1]).toMatchObject({ action: 'go', verifyEffect: true });
    expect(spy.mock.calls[1][1]).toMatchObject({ action: 'go', verifyEffect: true });
  });

  it('a non-boolean verifyEffect is not forwarded as an instruction', async () => {
    registerDrawer('panel-string');

    const res = await listener('executeComponentAction', {
      id: 'drawer',
      request: { action: 'open', verifyEffect: 'false' },
    });

    // The string is ignored, so the declared signature still verifies.
    expect((res.effectVerification as Record<string, unknown>).outcome).toBe('Confirmed');
  });
});

describe('end to end: relay server → listener → caller', () => {
  /**
   * A relay whose dispatch boundary hands the command straight to the
   * listener's `executeCommand`, JSON round-tripped both ways, exactly as the
   * browser tab would receive and answer it.
   */
  function relayIntoListener(): ReturnType<typeof createRelayHandlers> {
    const relay = new CommandRelay({
      globalPrefix: `__uiBridgeEffectRelayTest_${Math.random().toString(36).slice(2, 10)}`,
    });
    relay.queueCommand = (async (action: string, payload: Record<string, unknown>) =>
      listener(action, overTheWire(payload))) as typeof relay.queueCommand;
    return createRelayHandlers(relay);
  }

  it('POST /control/component/:id/action/:actionId returns a verified pass', async () => {
    registerDrawer('panel-route');
    const handlers = relayIntoListener();

    const res = overTheWire(
      await handlers.invokeComponentAction('drawer', 'open', { verifyEffect: true })
    );

    expect(res.success).toBe(true);
    const data = res.data as Record<string, unknown>;
    expect(data.success).toBe(true);
    expect((data.effectVerification as Record<string, unknown>).outcome).toBe('Confirmed');
  });

  it('verifyEffect: false over the route declines, and is not passed as a param', async () => {
    let seenParams: unknown = 'handler not called';
    getGlobalRegistry().registerComponent('drawer', {
      name: 'Drawer',
      actions: [
        {
          id: 'open',
          signature: appearSignature('panel-route-declined'),
          handler: (params) => {
            seenParams = params;
            return reveal('panel-route-declined')();
          },
        },
      ],
    });
    const handlers = relayIntoListener();

    const res = overTheWire(
      await handlers.invokeComponentAction('drawer', 'open', { verifyEffect: false })
    );

    const data = res.data as Record<string, unknown>;
    expect(data.success).toBe(true);
    expect('effectVerification' in data).toBe(false);
    expect(seenParams).toEqual({});
  });

  it('executeComponentAction (whole-request relay arm) returns a verified pass', async () => {
    registerDrawer('panel-whole');
    const handlers = relayIntoListener();

    const res = overTheWire(
      await handlers.executeComponentAction('drawer', { action: 'open', requestId: 'req-w' })
    );

    const data = res.data as Record<string, unknown>;
    expect(data.success).toBe(true);
    expect((data.effectVerification as Record<string, unknown>).outcome).toBe('Confirmed');
    expect(data.requestId).toBe('req-w');
  });
});
