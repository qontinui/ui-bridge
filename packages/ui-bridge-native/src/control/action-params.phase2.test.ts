/**
 * Phase 2 — param validation at the ui-bridge-native action-invocation seam.
 *
 * Plan: `2026-08-20-ui-bridge-action-declaration-shape.md`, Phase 2.
 *
 * This tree's `ComponentActionResponse` has no `failureDetails` field and this
 * package ships no diagnostics module, so an enforced rejection is asserted on
 * the prose `error` — deliberately, matching the precedent Phase 3's
 * cancellation path set here.
 *
 * Every expectation is a HAND-WRITTEN LITERAL. The default mode is pinned by
 * its OBSERVABLE behaviour (the handler still runs), never by comparing
 * against `DEFAULT_PARAM_VALIDATION_MODE`.
 *
 * `paramSchema` was DROPPED at registration in this tree until Phase 2 — both
 * by `registerComponent`'s closed object literal and by `useUIComponent`'s
 * re-wrap — so the round-trip test below is the one that proves the seam has
 * anything to validate against at all. It is a RUNTIME check, not a
 * type-check: the dropping literal type-checked perfectly.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NativeUIBridgeRegistry } from '../core/registry';
import {
  setDefaultParamValidationMode,
  resetDefaultParamValidationMode,
} from '../core/param-schema';
import { DefaultNativeActionExecutor } from './action-executor';

const OBJECT_FORM = {
  type: 'object',
  properties: {
    username: { type: 'string' },
    remember: { type: 'boolean' },
    mode: { type: 'string', enum: ['fast', 'slow'] },
  },
  required: ['username'],
  additionalProperties: false,
};

describe('Phase 2 — ui-bridge-native executor: param validation', () => {
  let registry: NativeUIBridgeRegistry;
  let executor: DefaultNativeActionExecutor;
  let calls: unknown[];
  let warnings: string[];

  beforeEach(() => {
    registry = new NativeUIBridgeRegistry();
    executor = new DefaultNativeActionExecutor(registry);
    calls = [];
    warnings = [];
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    resetDefaultParamValidationMode();
    vi.restoreAllMocks();
  });

  function registerSubmit(paramSchema?: Record<string, unknown>): void {
    registry.registerComponent('login-form', {
      name: 'Login Form',
      actions: [
        {
          id: 'submit',
          paramSchema,
          handler: (params) => {
            calls.push(params);
            return 'submitted';
          },
        },
      ],
    });
  }

  it('`paramSchema` survives a registerComponent round-trip (it used to be dropped)', () => {
    registerSubmit(OBJECT_FORM);

    expect(registry.getComponent('login-form')?.actions[0].paramSchema).toEqual({
      type: 'object',
      properties: {
        username: { type: 'string' },
        remember: { type: 'boolean' },
        mode: { type: 'string', enum: ['fast', 'slow'] },
      },
      required: ['username'],
      additionalProperties: false,
    });
  });

  it('valid params reach the handler and the response is a success', async () => {
    setDefaultParamValidationMode('enforce');
    registerSubmit(OBJECT_FORM);

    const res = await executor.executeComponentAction('login-form', {
      action: 'submit',
      params: { username: 'ada', mode: 'fast' },
      requestId: 'req-ok',
    });

    expect(res.success).toBe(true);
    expect(res.result).toBe('submitted');
    expect(res.error).toBeUndefined();
    expect(res.requestId).toBe('req-ok');
    expect(calls).toEqual([{ username: 'ada', mode: 'fast' }]);
    expect(warnings).toEqual([]);
  });

  it('an action with NO paramSchema is unaffected, even under enforce', async () => {
    setDefaultParamValidationMode('enforce');
    registerSubmit(undefined);

    const res = await executor.executeComponentAction('login-form', {
      action: 'submit',
      params: { anything: 'at all' },
    });

    expect(res.success).toBe(true);
    expect(res.result).toBe('submitted');
    expect(calls).toEqual([{ anything: 'at all' }]);
    expect(warnings).toEqual([]);
  });

  it('enforce rejects a MISSING REQUIRED param, names it, and never calls the handler', async () => {
    setDefaultParamValidationMode('enforce');
    registerSubmit(OBJECT_FORM);

    const res = await executor.executeComponentAction('login-form', {
      action: 'submit',
      params: { remember: true },
      requestId: 'req-missing',
    });

    expect(res.success).toBe(false);
    expect(calls).toEqual([]);
    expect(res.requestId).toBe('req-missing');
    expect(res.error).toBe(
      'Action "submit" on component "login-form" was rejected: params do not match the ' +
        "action's declared paramSchema. " +
        'Required parameter "username" is missing.'
    );
  });

  it('enforce rejects a WRONGLY-TYPED param and names it', async () => {
    setDefaultParamValidationMode('enforce');
    registerSubmit(OBJECT_FORM);

    const res = await executor.executeComponentAction('login-form', {
      action: 'submit',
      params: { username: 5 },
    });

    expect(res.success).toBe(false);
    expect(calls).toEqual([]);
    expect(res.error).toBe(
      'Action "submit" on component "login-form" was rejected: params do not match the ' +
        "action's declared paramSchema. " +
        'Parameter "username" must be of type string, received integer (5).'
    );
  });

  it('enforce rejects an OUT-OF-ENUM param and names it', async () => {
    setDefaultParamValidationMode('enforce');
    registerSubmit(OBJECT_FORM);

    const res = await executor.executeComponentAction('login-form', {
      action: 'submit',
      params: { username: 'ada', mode: 'medium' },
    });

    expect(res.success).toBe(false);
    expect(calls).toEqual([]);
    expect(res.error).toBe(
      'Action "submit" on component "login-form" was rejected: params do not match the ' +
        "action's declared paramSchema. " +
        'Parameter "mode" must be one of ["fast", "slow"], received "medium".'
    );
  });

  it('enforce rejects an UNDECLARED param under additionalProperties:false and names it', async () => {
    setDefaultParamValidationMode('enforce');
    registerSubmit(OBJECT_FORM);

    const res = await executor.executeComponentAction('login-form', {
      action: 'submit',
      params: { username: 'ada', nickname: 'a' },
    });

    expect(res.success).toBe(false);
    expect(calls).toEqual([]);
    expect(res.error).toBe(
      'Action "submit" on component "login-form" was rejected: params do not match the ' +
        "action's declared paramSchema. " +
        'Parameter "nickname" is not declared by the schema, which sets additionalProperties: false.'
    );
  });

  it('the DEFAULT mode warns and still runs the handler (no mode set anywhere)', async () => {
    registerSubmit(OBJECT_FORM);

    const res = await executor.executeComponentAction('login-form', {
      action: 'submit',
      params: { remember: true },
    });

    expect(res.success).toBe(true);
    expect(res.result).toBe('submitted');
    expect(res.error).toBeUndefined();
    expect(calls).toEqual([{ remember: true }]);
    expect(warnings).toEqual([
      '[ui-bridge-native] Action "submit" on component "login-form" was rejected: params do not ' +
        "match the action's declared paramSchema. " +
        'Required parameter "username" is missing.',
    ]);
  });

  it('a per-invocation `paramValidation` overrides the process default', async () => {
    setDefaultParamValidationMode('warn');
    registerSubmit(OBJECT_FORM);

    const res = await executor.executeComponentAction(
      'login-form',
      { action: 'submit', params: {} },
      { paramValidation: 'enforce' }
    );

    expect(res.success).toBe(false);
    expect(calls).toEqual([]);
  });

  it('`off` skips validation entirely — no rejection, no warning', async () => {
    setDefaultParamValidationMode('enforce');
    registerSubmit(OBJECT_FORM);

    const res = await executor.executeComponentAction(
      'login-form',
      { action: 'submit', params: { totally: 'wrong' } },
      { paramValidation: 'off' }
    );

    expect(res.success).toBe(true);
    expect(res.result).toBe('submitted');
    expect(calls).toEqual([{ totally: 'wrong' }]);
    expect(warnings).toEqual([]);
  });

  it('enforces the MAP form as a type hint and never as a requiredness hint', async () => {
    setDefaultParamValidationMode('enforce');
    registerSubmit({ username: 'string', count: 'number' });

    const omitted = await executor.executeComponentAction('login-form', {
      action: 'submit',
      params: {},
    });
    expect(omitted.success).toBe(true);
    expect(omitted.result).toBe('submitted');

    const wrongType = await executor.executeComponentAction('login-form', {
      action: 'submit',
      params: { count: 'two' },
    });
    expect(wrongType.success).toBe(false);
    expect(wrongType.error).toBe(
      'Action "submit" on component "login-form" was rejected: params do not match the ' +
        "action's declared paramSchema. " +
        'Parameter "count" must be of type number, received string ("two").'
    );
  });

  it("accepts qontinui-runner's prose hint map under ENFORCE", async () => {
    setDefaultParamValidationMode('enforce');
    registerSubmit({
      count: 'number (>= 1, defaults to 1)',
      context: 'string (optional initial prompt auto-typed after `claude` starts)',
    });

    const res = await executor.executeComponentAction('login-form', {
      action: 'submit',
      params: { count: 2 },
    });

    expect(res.success).toBe(true);
    expect(res.result).toBe('submitted');
    expect(warnings).toEqual([]);
  });

  it('ignores keywords outside the documented subset instead of rejecting them', async () => {
    setDefaultParamValidationMode('enforce');
    registerSubmit({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { username: { type: 'string', format: 'email', default: 'anon' } },
      required: ['username'],
      oneOf: [{ required: ['impossible'] }],
    });

    const res = await executor.executeComponentAction('login-form', {
      action: 'submit',
      params: { username: 'ada' },
    });

    expect(res.success).toBe(true);
    expect(res.result).toBe('submitted');
    expect(warnings).toEqual([]);
  });
});
