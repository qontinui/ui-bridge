/**
 * Phase 2 — param validation at the WEB action-invocation seam.
 *
 * Plan: `2026-08-20-ui-bridge-action-declaration-shape.md`, Phase 2.
 *
 * Every expectation is a HAND-WRITTEN LITERAL. Nothing is asserted via
 * `satisfies`, a type assertion, or a constant imported from the code under
 * test — including the default mode, which is pinned by its OBSERVABLE
 * behaviour (the handler still runs) rather than by comparing against
 * `DEFAULT_PARAM_VALIDATION_MODE`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { UIBridgeRegistry } from '../core/registry';
import {
  setDefaultParamValidationMode,
  resetDefaultParamValidationMode,
} from '../core/param-schema';
import { DefaultActionExecutor } from './action-executor';

/** The object-schema form, as `paramSchemaOf()` emits it. */
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

describe('Phase 2 — web executor: param validation', () => {
  let registry: UIBridgeRegistry;
  let executor: DefaultActionExecutor;
  let calls: unknown[];
  let warnings: string[];

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    executor = new DefaultActionExecutor(registry);
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

  // -------------------------------------------------------------------------
  // The silent-drop trap: verified at RUNTIME, not by type-check.
  // -------------------------------------------------------------------------

  it('`paramSchema` survives a registerComponent round-trip', () => {
    registerSubmit(OBJECT_FORM);

    const stored = registry.getComponent('login-form');
    expect(stored?.actions[0].paramSchema).toEqual({
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

  it('`paramSchema` survives an updateComponent round-trip', () => {
    registerSubmit(OBJECT_FORM);
    registry.updateComponent('login-form', {
      actions: [{ id: 'submit', paramSchema: { nickname: 'string' }, handler: () => 'x' }],
    });

    expect(registry.getComponent('login-form')?.actions[0].paramSchema).toEqual({
      nickname: 'string',
    });
  });

  // -------------------------------------------------------------------------
  // Valid params pass through.
  // -------------------------------------------------------------------------

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
    expect(res.failureDetails).toBeUndefined();
    expect(res.requestId).toBe('req-ok');
    expect(calls).toEqual([{ username: 'ada', mode: 'fast' }]);
    expect(warnings).toEqual([]);
  });

  it('an action with NO paramSchema is unaffected, even under enforce', async () => {
    setDefaultParamValidationMode('enforce');
    registerSubmit(undefined);

    const res = await executor.executeComponentAction('login-form', {
      action: 'submit',
      params: { anything: 'at all', nested: { deep: true } },
    });

    expect(res.success).toBe(true);
    expect(res.result).toBe('submitted');
    expect(calls).toEqual([{ anything: 'at all', nested: { deep: true } }]);
    expect(warnings).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Enforce: each rejection kind, with the offending param NAMED.
  // -------------------------------------------------------------------------

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
    expect(res.failureDetails?.errorCode).toBe('UB-ACTION-REJECTED');
    expect(res.failureDetails?.invalidParams).toEqual([
      {
        path: 'username',
        keyword: 'required',
        expected: 'present',
        message: 'Required parameter "username" is missing.',
      },
    ]);
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
    expect(res.failureDetails?.errorCode).toBe('UB-ACTION-REJECTED');
    expect(res.failureDetails?.invalidParams).toEqual([
      {
        path: 'username',
        keyword: 'type',
        expected: 'string',
        received: '5',
        message: 'Parameter "username" must be of type string, received integer (5).',
      },
    ]);
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
    expect(res.failureDetails?.invalidParams).toEqual([
      {
        path: 'mode',
        keyword: 'enum',
        expected: '"fast", "slow"',
        received: '"medium"',
        message: 'Parameter "mode" must be one of ["fast", "slow"], received "medium".',
      },
    ]);
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
    expect(res.failureDetails?.invalidParams).toEqual([
      {
        path: 'nickname',
        keyword: 'additionalProperties',
        expected: 'one of [username, remember, mode]',
        received: '"a"',
        message:
          'Parameter "nickname" is not declared by the schema, which sets additionalProperties: false.',
      },
    ]);
  });

  it('the failure details reach an agent over the wire (JSON round-trip)', async () => {
    setDefaultParamValidationMode('enforce');
    registerSubmit(OBJECT_FORM);

    const res = await executor.executeComponentAction('login-form', {
      action: 'submit',
      params: {},
    });
    const wire = JSON.parse(JSON.stringify(res.failureDetails)) as {
      errorCode: string;
      invalidParams: unknown;
    };

    expect(wire.errorCode).toBe('UB-ACTION-REJECTED');
    expect(wire.invalidParams).toEqual([
      {
        path: 'username',
        keyword: 'required',
        expected: 'present',
        message: 'Required parameter "username" is missing.',
      },
    ]);
  });

  // -------------------------------------------------------------------------
  // Warn — the default.
  // -------------------------------------------------------------------------

  it('the DEFAULT mode warns and still runs the handler (no mode set anywhere)', async () => {
    registerSubmit(OBJECT_FORM);

    const res = await executor.executeComponentAction('login-form', {
      action: 'submit',
      params: { remember: true },
    });

    expect(res.success).toBe(true);
    expect(res.result).toBe('submitted');
    expect(res.error).toBeUndefined();
    expect(res.failureDetails).toBeUndefined();
    expect(calls).toEqual([{ remember: true }]);
    expect(warnings).toEqual([
      '[ui-bridge] Action "submit" on component "login-form" was rejected: params do not match ' +
        "the action's declared paramSchema. " +
        'Required parameter "username" is missing.',
    ]);
  });

  it('an explicit warn mode does not block either', async () => {
    setDefaultParamValidationMode('warn');
    registerSubmit(OBJECT_FORM);

    const res = await executor.executeComponentAction('login-form', {
      action: 'submit',
      params: { username: 5 },
    });

    expect(res.success).toBe(true);
    expect(res.result).toBe('submitted');
    expect(calls).toEqual([{ username: 5 }]);
    expect(warnings).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Mode resolution.
  // -------------------------------------------------------------------------

  it('a per-invocation `paramValidation` overrides the process default', async () => {
    setDefaultParamValidationMode('warn');
    registerSubmit(OBJECT_FORM);

    const res = await executor.executeComponentAction(
      'login-form',
      { action: 'submit', params: {} },
      { paramValidation: 'enforce' }
    );

    expect(res.success).toBe(false);
    expect(res.failureDetails?.errorCode).toBe('UB-ACTION-REJECTED');
    expect(calls).toEqual([]);
  });

  it("`off` skips validation entirely — no rejection, no warning", async () => {
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

  // -------------------------------------------------------------------------
  // Both schema shapes; unknown keywords.
  // -------------------------------------------------------------------------

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
    expect(wrongType.failureDetails?.invalidParams).toEqual([
      {
        path: 'count',
        keyword: 'type',
        expected: 'number',
        received: '"two"',
        message: 'Parameter "count" must be of type number, received string ("two").',
      },
    ]);
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
      patternProperties: { '^x-': { type: 'string' } },
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
