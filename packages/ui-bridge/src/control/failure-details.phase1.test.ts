/**
 * Phase 1 — Diagnostic discipline: ComponentActionResponse.failureDetails
 * and WorkflowStepResult.failureDetails.
 *
 * Plan: 2026-05-18-ui-bridge-diagnostic-discipline-plan.md §8 (Phase 1).
 *
 * Fires every `success: false` path on both surfaces and asserts the
 * structured `failureDetails` is present with a valid `UiBridgeErrorCode`
 * and a non-empty canonical `suggestedActions[]`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { UIBridgeRegistry } from '../core/registry';
import { DefaultActionExecutor } from './action-executor';
import { DefaultWorkflowEngine } from './workflow-engine';
import { UI_BRIDGE_ERROR_CODES } from '../diagnostics';
import type { Workflow } from '../core/types';

const VALID_CODES = new Set<string>(UI_BRIDGE_ERROR_CODES);

function expectValidFailureDetails(details: unknown): void {
  expect(details, 'failureDetails must be populated on failure').toBeDefined();
  const d = details as {
    errorCode: string;
    message: string;
    suggestedActions: unknown[];
    retryRecommended: boolean;
  };
  expect(VALID_CODES.has(d.errorCode)).toBe(true);
  expect(typeof d.message).toBe('string');
  expect(d.message.length).toBeGreaterThan(0);
  expect(Array.isArray(d.suggestedActions)).toBe(true);
  expect(d.suggestedActions.length).toBeGreaterThan(0);
  expect(typeof d.retryRecommended).toBe('boolean');
}

describe('Phase 1 — ComponentActionResponse.failureDetails', () => {
  let registry: UIBridgeRegistry;
  let executor: DefaultActionExecutor;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    executor = new DefaultActionExecutor(registry);
  });

  it('component-not-found populates failureDetails (UB-ELEM-NOT-FOUND)', async () => {
    const res = await executor.executeComponentAction('no-such-component', {
      action: 'doThing',
    });
    expect(res.success).toBe(false);
    expect(typeof res.error).toBe('string'); // prose retained (goal #3)
    expectValidFailureDetails(res.failureDetails);
    expect(res.failureDetails?.errorCode).toBe('UB-ELEM-NOT-FOUND');
  });

  it('action-not-found populates failureDetails (UB-UNSUPPORTED-ACTION)', async () => {
    registry.registerComponent('cmp', {
      name: 'Cmp',
      actions: [{ id: 'known', handler: () => 'ok' }],
    });
    const res = await executor.executeComponentAction('cmp', { action: 'unknown' });
    expect(res.success).toBe(false);
    expectValidFailureDetails(res.failureDetails);
    expect(res.failureDetails?.errorCode).toBe('UB-UNSUPPORTED-ACTION');
  });

  it('handler throwing populates failureDetails (UB-ACTION-FAILED)', async () => {
    registry.registerComponent('cmp', {
      name: 'Cmp',
      actions: [
        {
          id: 'boom',
          handler: () => {
            throw new Error('handler exploded');
          },
        },
      ],
    });
    const res = await executor.executeComponentAction('cmp', { action: 'boom' });
    expect(res.success).toBe(false);
    expect(res.error).toContain('handler exploded');
    expectValidFailureDetails(res.failureDetails);
    expect(res.failureDetails?.errorCode).toBe('UB-ACTION-FAILED');
  });

  it('successful component action omits failureDetails', async () => {
    registry.registerComponent('cmp', {
      name: 'Cmp',
      actions: [{ id: 'ok', handler: () => 'done' }],
    });
    const res = await executor.executeComponentAction('cmp', { action: 'ok' });
    expect(res.success).toBe(true);
    expect(res.failureDetails).toBeUndefined();
  });
});

describe('Phase 1 — WorkflowStepResult.failureDetails', () => {
  let registry: UIBridgeRegistry;
  let executor: DefaultActionExecutor;
  let engine: DefaultWorkflowEngine;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    executor = new DefaultActionExecutor(registry);
    engine = new DefaultWorkflowEngine(registry, executor);
  });

  it('a throwing step yields a failed step with valid failureDetails', async () => {
    const wf: Workflow = {
      id: 'wf-fail',
      name: 'Failing workflow',
      steps: [
        // Missing target/action → executeStepInternal throws → caught path.
        { id: 'step-1', type: 'element-action' },
      ],
    };
    registry.registerWorkflow(wf);

    const run = await engine.run('wf-fail');
    const failed = run.steps.find((s) => !s.success);
    expect(failed, 'expected a failed step').toBeDefined();
    expect(typeof failed?.error).toBe('string'); // prose retained (goal #3)
    expectValidFailureDetails(failed?.failureDetails);
  });

  it('a missing-target wait step classifies via failureDetails', async () => {
    const wf: Workflow = {
      id: 'wf-wait',
      name: 'Wait workflow',
      steps: [{ id: 'w', type: 'wait' }],
    };
    registry.registerWorkflow(wf);
    const run = await engine.run('wf-wait');
    const failed = run.steps.find((s) => !s.success);
    expect(failed).toBeDefined();
    expectValidFailureDetails(failed?.failureDetails);
  });
});
