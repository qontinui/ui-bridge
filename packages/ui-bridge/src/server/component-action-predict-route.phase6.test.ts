/**
 * Phase 6 — the predict route's WIRING, as distinct from its answer.
 *
 * Plan: `2026-09-04-effect-calculus-joins-the-component-action-registry`,
 * Phase 6. `control/component-action-predict.phase6.test.ts` asserts what the
 * twin says; this asserts that a caller can reach it, and that every adapter
 * hands the handler the arguments its signature names.
 *
 * The route table is the contract three separate consumers read — the Express
 * adapter, the Next.js adapter and the standalone server all iterate
 * `UI_BRIDGE_ROUTES`, and qontinui-runner's `sdk_manifest_routes_are_exposed_by_runner`
 * scrapes it from source. A route declared with the wrong `params` or without
 * `bodyRequired` still LOOKS registered and still answers 200; it just answers
 * the wrong question, silently, over HTTP only. That is the failure this file
 * exists to make loud.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UI_BRIDGE_ROUTES } from './types';
import { createHandlers, normalizePredictBody, type RegistryLike } from './handlers';
import { resetGlobalRegistry, getGlobalRegistry } from '../core/registry';
import { DefaultActionExecutor } from '../control/action-executor';
import type { PredictedDelta } from '../control/effect-types';

describe('UI_BRIDGE_ROUTES · the predict route', () => {
  const route = UI_BRIDGE_ROUTES.find(
    (r) => r.path === '/control/component/:id/action/:actionId/predict',
  );

  it('is registered as POST → predictComponentAction', () => {
    expect(route).toBeDefined();
    expect(route?.method).toBe('POST');
    expect(route?.handler).toBe('predictComponentAction');
  });

  it('declares BOTH path params, in the order the adapters push them', () => {
    // Express (`createRouteHandler`) and Next.js (`handleRequest`) both push
    // `route.params` in declaration order ahead of the body. Reversing this
    // array silently swaps componentId and actionId at every HTTP call site
    // while every in-process test keeps passing.
    expect(route?.params).toEqual(['id', 'actionId']);
  });

  it('declares bodyRequired — without it the params never reach the handler', () => {
    // The `/control/visibility` note in `types.ts` records this exact bug:
    // a POST without `bodyRequired` is treated as a context-only handler, so
    // the body is dropped and every knob is unreachable over HTTP while still
    // working in unit tests.
    expect(route?.bodyRequired).toBe(true);
  });

  it('does not collide with the invocation route it extends', () => {
    // Both adapters match with `:seg` → `([^/]+)`, which cannot cross a `/`,
    // so `/action/:actionId` never swallows the `/predict` tail. Pinned
    // because a future change to a greedier pattern would route every predict
    // call into the INVOKING handler — the worst possible failure for this
    // endpoint.
    const invoke = UI_BRIDGE_ROUTES.find(
      (r) => r.path === '/control/component/:id/action/:actionId',
    );
    expect(invoke).toBeDefined();
    const toRegex = (p: string): RegExp =>
      new RegExp(`^${p.replace(/:[^/]+/g, '([^/]+)').replace(/\//g, '\\/')}$`);
    expect(toRegex(invoke!.path).test('/control/component/c1/action/a1/predict')).toBe(false);
    expect(toRegex(route!.path).test('/control/component/c1/action/a1/predict')).toBe(true);
    expect(toRegex(route!.path).test('/control/component/c1/action/a1')).toBe(false);
  });
});

describe('normalizePredictBody', () => {
  it('accepts the wrapped shape', () => {
    expect(normalizePredictBody({ params: { layoutId: 'split' } })).toEqual({
      params: { layoutId: 'split' },
      requestId: undefined,
    });
  });

  it('accepts the bare shape an action paramSchema advertises', () => {
    expect(normalizePredictBody({ layoutId: 'split' })).toEqual({
      params: { layoutId: 'split' },
      requestId: undefined,
    });
  });

  it('keeps request-level and adapter-spliced keys OUT of params', () => {
    const out = normalizePredictBody({
      requestId: 'r1',
      tabId: 't1',
      targetTabId: 't2',
      __callerUserId: 'u1',
      layoutId: 'split',
    });
    expect(out.params).toEqual({ layoutId: 'split' });
    expect(out.requestId).toBe('r1');
  });

  it('an empty body yields undefined params, not {}', () => {
    // `ActionParams.params` is optional, and a signature testing
    // `params === undefined` must see what an in-process caller passing
    // nothing produces.
    expect(normalizePredictBody({}).params).toBeUndefined();
    expect(normalizePredictBody(undefined).params).toBeUndefined();
  });

  it('an explicit params object wins over a colliding flat key', () => {
    const out = normalizePredictBody({ layoutId: 'flat', params: { layoutId: 'explicit' } });
    expect(out.params).toEqual({ layoutId: 'explicit' });
  });
});

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

describe('createHandlers · predictComponentAction', () => {
  beforeEach(() => {
    resetGlobalRegistry();
  });

  afterEach(() => {
    resetGlobalRegistry();
  });

  it('answers with the executor prediction and never runs the handler', async () => {
    const registry = getGlobalRegistry();
    registry.registerComponent('layout', {
      name: 'Layout',
      actions: [
        {
          id: 'setLayout',
          effect: 'write',
          signature: {
            predicts: (p): PredictedDelta => ({
              elementsAppear: [{ id: `pane-${String(p.params?.layoutId ?? 'none')}` }],
            }),
            scope: {},
            reversibility: 'reversible',
          },
          handler: () => {
            throw new Error('HANDLER RAN — predict must not invoke');
          },
        },
      ],
    });

    const handlers = createHandlers(makeRegistryLike(), new DefaultActionExecutor(registry));
    // The BARE body shape, deliberately: this is what an agent posting the
    // action's own `paramSchema` sends, and it must reach `predicts`.
    const resp = await handlers.predictComponentAction('layout', 'setLayout', {
      layoutId: 'split',
    });

    expect(resp.success).toBe(true);
    expect(resp.data?.status).toBe('predicted');
    expect(resp.data?.predicted).toEqual({ elementsAppear: [{ id: 'pane-split' }] });
    expect(resp.data?.handlerInvoked).toBe(false);
  });

  it('an executor with no predict arm answers UNSUPPORTED, not a null prediction', async () => {
    const registry = getGlobalRegistry();
    registry.registerComponent('drawer', {
      name: 'Drawer',
      actions: [{ id: 'open', handler: () => 'ok' }],
    });

    // The shape every legacy host and test double has: two invocation methods
    // and nothing else.
    const legacyExecutor = {
      executeAction: async () => ({ success: true }),
      executeComponentAction: async () => ({ success: true }),
    };
    const handlers = createHandlers(makeRegistryLike(), legacyExecutor as never);

    const resp = await handlers.predictComponentAction('drawer', 'open', {});

    expect(resp.success).toBe(false);
    // Canonical, not `UB-UNKNOWN-ERROR`: a diagnosed wiring gap must not be
    // reported as an unknown fault.
    expect(resp.code).toBe('UB-UNSUPPORTED-ACTION');
    // A wiring gap must not be reported as a fact about the action
    // [policy: unknown-must-not-render-as-a-default].
    expect(resp.error).toContain('nothing was evaluated');
    expect(resp.error).toContain('drawer.open');
  });
});
