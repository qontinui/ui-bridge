/**
 * Phase 1 — the `/control/component*` action wire shape.
 *
 * Plan: 2026-08-20-ui-bridge-action-declaration-shape.md, Phase 1.
 *
 * `SerializedComponentAction` used to be `{ id, label?, description? }` with a
 * doc comment asserting that `handler`/`paramSchema` "are runtime-only and
 * never serialized". Two more copies of that claim lived in the `BridgeSnapshot`
 * doc block and in `serializeRegisteredComponent`. All three were wrong about
 * `paramSchema`: `annotateComponentWithInvocationPaths` (`server/handlers.ts`)
 * spreads the whole registered action, so `paramSchema` reaches the wire — and
 * four qontinui-runner consumers read it there
 * (`workflow_generation/wrapper_manifest.rs:308`,
 * `commands/command_interpreter.rs:103,107,161`, `bin/wrappers_mcp.rs:208`).
 * It also emits an undeclared per-action `path` and a component-level
 * `actionInvocationPath`.
 *
 * Nothing pinned the emitted shape, which is why the types and the wire drifted
 * apart unnoticed. This does.
 *
 * The assertions below are deliberately written against **hand-written object
 * literals**, never against `SerializedComponentAction` and never via
 * `satisfies` or a type assertion — a test written against the type it is meant
 * to pin proves nothing, because widening the type would silently widen the
 * test with it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHandlers, type RegistryLike } from './handlers';
import { resetGlobalRegistry, getGlobalRegistry } from '../core/registry';

/** The schema an app author declares on the action. Echoed verbatim on the wire. */
const PARAM_SCHEMA = {
  type: 'object',
  properties: {
    username: { type: 'string' },
    remember: { type: 'boolean' },
  },
  required: ['username'],
};

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

function makeActionExecutor() {
  return {
    executeAction: async () => ({ success: true }),
    executeComponentAction: async () => ({ success: true }),
  };
}

function registerLoginForm(): void {
  getGlobalRegistry().registerComponent('login-form', {
    name: 'Login Form',
    description: 'Signs a user in',
    actions: [
      {
        id: 'submit',
        label: 'Submit',
        description: 'Submit the credentials',
        paramSchema: PARAM_SCHEMA,
        handler: () => 'submitted',
      },
    ],
  });
}

/** The wire is JSON. Whatever survives this round-trip is what a consumer sees. */
function overTheWire<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}

describe('Phase 1 — component action wire shape', () => {
  beforeEach(() => {
    resetGlobalRegistry();
    registerLoginForm();
  });

  afterEach(() => {
    resetGlobalRegistry();
  });

  it('GET /control/components emits the full action incl. paramSchema and path', async () => {
    const handlers = createHandlers(makeRegistryLike(), makeActionExecutor() as never);
    const resp = await handlers.getComponents();

    expect(resp.success).toBe(true);
    const wire = overTheWire(resp.data) as {
      components: Array<{ actions: unknown[] }>;
    };
    expect(wire.components).toHaveLength(1);
    expect(wire.components[0].actions).toHaveLength(1);

    // Hand-written literal. Every key the wire carries, spelled out.
    expect(wire.components[0].actions[0]).toEqual({
      id: 'submit',
      label: 'Submit',
      description: 'Submit the credentials',
      paramSchema: {
        type: 'object',
        properties: {
          username: { type: 'string' },
          remember: { type: 'boolean' },
        },
        required: ['username'],
      },
      path: '/control/component/login-form/action/submit',
    });
  });

  it('GET /control/component/:id emits the same action shape', async () => {
    const handlers = createHandlers(makeRegistryLike(), makeActionExecutor() as never);
    const resp = await handlers.getComponent('login-form');

    expect(resp.success).toBe(true);
    const wire = overTheWire(resp.data) as { actions: unknown[] };
    expect(wire.actions[0]).toEqual({
      id: 'submit',
      label: 'Submit',
      description: 'Submit the credentials',
      paramSchema: {
        type: 'object',
        properties: {
          username: { type: 'string' },
          remember: { type: 'boolean' },
        },
        required: ['username'],
      },
      path: '/control/component/login-form/action/submit',
    });
  });

  it('drops `handler` — it is a function, so JSON.stringify strips it', async () => {
    const handlers = createHandlers(makeRegistryLike(), makeActionExecutor() as never);
    const resp = await handlers.getComponents();

    // Present in memory (the handler must still be callable)...
    const inMemory = (resp.data as { components: Array<{ actions: Array<{ handler?: unknown }> }> })
      .components[0].actions[0];
    expect(typeof inMemory.handler).toBe('function');

    // ...and absent after the round-trip a real HTTP response performs.
    const wire = overTheWire(resp.data) as {
      components: Array<{ actions: Array<Record<string, unknown>> }>;
    };
    const wireAction = wire.components[0].actions[0];
    expect('handler' in wireAction).toBe(false);
    expect(Object.keys(wireAction).sort()).toEqual([
      'description',
      'id',
      'label',
      'paramSchema',
      'path',
    ]);
  });

  it('carries the component-level actionInvocationPath template', async () => {
    const handlers = createHandlers(makeRegistryLike(), makeActionExecutor() as never);
    const resp = await handlers.getComponents();

    const wire = overTheWire(resp.data) as {
      components: Array<{ id: string; actionInvocationPath?: string }>;
    };
    expect(wire.components[0].id).toBe('login-form');
    expect(wire.components[0].actionInvocationPath).toBe(
      '/control/component/login-form/action/{actionId}'
    );
  });

  it('an action with no paramSchema simply omits the key', async () => {
    resetGlobalRegistry();
    getGlobalRegistry().registerComponent('bare', {
      name: 'Bare',
      actions: [{ id: 'ping', handler: () => 'pong' }],
    });

    const handlers = createHandlers(makeRegistryLike(), makeActionExecutor() as never);
    const resp = await handlers.getComponents();

    const wire = overTheWire(resp.data) as {
      components: Array<{ actions: Array<Record<string, unknown>> }>;
    };
    expect(wire.components[0].actions[0]).toEqual({
      id: 'ping',
      path: '/control/component/bare/action/ping',
    });
  });
});
