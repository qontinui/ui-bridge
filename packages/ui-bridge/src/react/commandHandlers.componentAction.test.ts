/**
 * The Tauri IPC / relay channel is a FOURTH invocation seam (pre-PR review #3,
 * qontinui/ui-bridge#163).
 *
 * Plan: `2026-08-20-ui-bridge-action-declaration-shape.md`, Phases 2-4.
 *
 * `react/commandHandlers.ts` handled both component-action commands by
 * resolving the action off the registry and calling `action.handler(params)`
 * **directly**, bypassing `DefaultActionExecutor` entirely. So on this channel
 * there was no `paramSchema` validation, no `runAbortable` race, no `signal`
 * and no `timeoutMs` — and this is not a marginal seam: it is half of UI
 * Bridge's dual-channel design, the half a Tauri app uses, and the half the
 * Express relay path lands on.
 *
 * Both spellings are covered: `execute_component_action` (snake_case, the
 * runner's direct IPC) and `executeComponentAction` (camelCase, the relay).
 *
 * Every expectation is a hand-written literal.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { executeCommand, type BridgeAccess } from './commandHandlers';
import { resetGlobalRegistry, getGlobalRegistry } from '../core/registry';
import {
  setDefaultParamValidationMode,
  resetDefaultParamValidationMode,
} from '../core/param-schema';

/** A promise that never settles. */
function hang(): Promise<never> {
  return new Promise<never>(() => {});
}

const emptyBridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
};

async function ipc(action: string, payload: Record<string, unknown>): Promise<unknown> {
  return executeCommand(action, payload as never, emptyBridge);
}

beforeEach(() => {
  resetGlobalRegistry();
});

afterEach(() => {
  resetDefaultParamValidationMode();
  vi.restoreAllMocks();
});

describe('the IPC seam validates params against paramSchema (review #3)', () => {
  beforeEach(() => {
    getGlobalRegistry().registerComponent('login-form', {
      name: 'Login Form',
      actions: [
        {
          id: 'submit',
          paramSchema: {
            type: 'object',
            properties: { username: { type: 'string' } },
            required: ['username'],
          },
          handler: (params) => ({ echoed: params }),
        },
      ],
    });
  });

  it('execute_component_action REJECTS non-conforming params in enforce mode', async () => {
    setDefaultParamValidationMode('enforce');

    const res = (await ipc('execute_component_action', {
      componentId: 'login-form',
      actionId: 'submit',
      params: { username: 42 },
    })) as Record<string, unknown>;

    expect(res.success).toBe(false);
    expect(res.error).toBe(
      'Action "submit" on component "login-form" was rejected: params do not match the action\'s declared paramSchema. Parameter "username" must be of type string, received integer (42).'
    );
  });

  it('executeComponentAction REJECTS non-conforming params in enforce mode', async () => {
    setDefaultParamValidationMode('enforce');

    const res = (await ipc('executeComponentAction', {
      id: 'login-form',
      request: { action: 'submit', params: {} },
    })) as Record<string, unknown>;

    expect(res.success).toBe(false);
    expect(res.error).toBe(
      'Action "submit" on component "login-form" was rejected: params do not match the action\'s declared paramSchema. Required parameter "username" is missing.'
    );
  });

  it('accepts conforming params and returns the handler result', async () => {
    setDefaultParamValidationMode('enforce');

    const res = (await ipc('execute_component_action', {
      componentId: 'login-form',
      actionId: 'submit',
      params: { username: 'ada' },
    })) as Record<string, unknown>;

    expect(res.success).toBe(true);
    expect(res.result).toEqual({ echoed: { username: 'ada' } });
  });
});

describe('the IPC seam honours timeoutMs and the abort race (review #3)', () => {
  beforeEach(() => {
    getGlobalRegistry().registerComponent('slow', {
      name: 'Slow',
      actions: [{ id: 'hung', handler: () => hang() }],
    });
  });

  it('execute_component_action abandons a hung handler at timeoutMs', async () => {
    const res = (await ipc('execute_component_action', {
      componentId: 'slow',
      actionId: 'hung',
      timeoutMs: 5,
    })) as Record<string, unknown>;

    expect(res.success).toBe(false);
    expect(res.error).toBe(
      'Action "hung" on component "slow" was abandoned after its 5ms timeout elapsed.'
    );
    expect((res.failureDetails as Record<string, unknown>).errorCode).toBe('UB-ACTION-TIMEOUT');
    expect((res.failureDetails as Record<string, unknown>).cancelReason).toBe('timeout');
  });

  it('executeComponentAction abandons a hung handler at timeoutMs', async () => {
    const res = (await ipc('executeComponentAction', {
      id: 'slow',
      request: { action: 'hung', timeoutMs: 5 },
    })) as Record<string, unknown>;

    expect(res.success).toBe(false);
    expect(res.error).toBe(
      'Action "hung" on component "slow" was abandoned after its 5ms timeout elapsed.'
    );
  });

  it('hands the handler an options bag carrying a live signal', async () => {
    let seen: unknown = 'HANDLER-NOT-CALLED';
    getGlobalRegistry().registerComponent('watched', {
      name: 'Watched',
      actions: [
        {
          id: 'go',
          handler: (_params, options) => {
            seen = options === undefined ? 'NO-OPTIONS-BAG' : options.signal;
            return 'done';
          },
        },
      ],
    });

    const res = (await ipc('execute_component_action', {
      componentId: 'watched',
      actionId: 'go',
    })) as Record<string, unknown>;

    expect(res.success).toBe(true);
    expect(seen).toBeInstanceOf(AbortSignal);
    expect((seen as AbortSignal).aborted).toBe(false);
  });

  it('refuses a malformed timeoutMs without running the handler', async () => {
    let calls = 0;
    getGlobalRegistry().registerComponent('counted', {
      name: 'Counted',
      actions: [
        {
          id: 'go',
          handler: () => {
            calls += 1;
            return 'ok';
          },
        },
      ],
    });

    const res = (await ipc('execute_component_action', {
      componentId: 'counted',
      actionId: 'go',
      timeoutMs: -5,
    })) as Record<string, unknown>;

    expect(res.success).toBe(false);
    expect(res.error).toBe(
      'Action "go" on component "counted" was rejected: timeoutMs must not be negative, received -5.'
    );
    expect(calls).toBe(0);
  });
});

describe('the IPC component projections carry paramSchema (review #3)', () => {
  beforeEach(() => {
    getGlobalRegistry().registerComponent('login-form', {
      name: 'Login Form',
      description: 'Signs a user in',
      actions: [
        {
          id: 'submit',
          label: 'Submit',
          description: 'Submit the credentials',
          effect: 'write',
          paramSchema: {
            type: 'object',
            properties: { username: { type: 'string' } },
            required: ['username'],
          },
          handler: () => 'submitted',
        },
      ],
    });
  });

  it('get_components emits paramSchema alongside effect', async () => {
    const res = (await ipc('get_components', {})) as {
      components: Array<{ actions: unknown[] }>;
    };

    expect(res.components).toHaveLength(1);
    expect(res.components[0].actions).toEqual([
      {
        id: 'submit',
        label: 'Submit',
        description: 'Submit the credentials',
        effect: 'write',
        paramSchema: {
          type: 'object',
          properties: { username: { type: 'string' } },
          required: ['username'],
        },
      },
    ]);
  });

  it('get_component emits the same action shape', async () => {
    const res = (await ipc('get_component', { componentId: 'login-form' })) as {
      actions: unknown[];
    };

    expect(res.actions).toEqual([
      {
        id: 'submit',
        label: 'Submit',
        description: 'Submit the credentials',
        effect: 'write',
        paramSchema: {
          type: 'object',
          properties: { username: { type: 'string' } },
          required: ['username'],
        },
      },
    ]);
  });
});
