/**
 * Workflow Engine
 *
 * Executes multi-step workflows with error handling and state tracking.
 */

import type { UIBridgeRegistry } from '../core/registry';
import type { WorkflowStep, Workflow } from '../core/types';
import type {
  WorkflowRunRequest,
  WorkflowRunResponse,
  WorkflowStepResult,
  WorkflowRunStatus,
  WorkflowEngine,
  ActionExecutor,
} from './types';

/**
 * Generate a unique run ID
 */
function generateRunId(): string {
  return `run-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;
}

/**
 * Default workflow engine implementation
 */
export class DefaultWorkflowEngine implements WorkflowEngine {
  private activeRuns = new Map<string, WorkflowRunState>();

  constructor(
    private registry: UIBridgeRegistry,
    private executor: ActionExecutor
  ) {}

  /**
   * Run a workflow
   */
  async run(
    workflowId: string,
    request?: WorkflowRunRequest
  ): Promise<WorkflowRunResponse> {
    const workflow = this.registry.getWorkflow(workflowId);
    if (!workflow) {
      return {
        workflowId,
        runId: generateRunId(),
        status: 'failed',
        steps: [],
        totalSteps: 0,
        success: false,
        error: `Workflow not found: ${workflowId}`,
        startedAt: Date.now(),
        completedAt: Date.now(),
        durationMs: 0,
      };
    }

    const runId = generateRunId();
    const state: WorkflowRunState = {
      workflowId,
      runId,
      workflow,
      request,
      status: 'running',
      steps: [],
      currentStep: 0,
      startedAt: Date.now(),
    };

    this.activeRuns.set(runId, state);

    try {
      await this.executeWorkflow(state);
    } catch (error) {
      state.status = 'failed';
      state.error = error instanceof Error ? error.message : String(error);
    }

    state.completedAt = Date.now();
    state.durationMs = state.completedAt - state.startedAt;

    // Determine overall success
    state.success = state.status === 'completed' && state.steps.every((s) => s.success);

    // Clean up after a delay
    setTimeout(() => {
      this.activeRuns.delete(runId);
    }, 60000);

    return this.buildResponse(state);
  }

  /**
   * Get workflow run status
   */
  async getRunStatus(runId: string): Promise<WorkflowRunResponse | null> {
    const state = this.activeRuns.get(runId);
    if (!state) return null;
    return this.buildResponse(state);
  }

  /**
   * Cancel a running workflow
   */
  async cancel(runId: string): Promise<boolean> {
    const state = this.activeRuns.get(runId);
    if (!state || state.status !== 'running') return false;

    state.status = 'cancelled';
    state.completedAt = Date.now();
    state.durationMs = state.completedAt - state.startedAt;
    state.error = 'Workflow cancelled by user';

    return true;
  }

  /**
   * List active runs
   */
  async listActiveRuns(): Promise<WorkflowRunResponse[]> {
    return Array.from(this.activeRuns.values())
      .filter((state) => state.status === 'running')
      .map((state) => this.buildResponse(state));
  }

  /**
   * Execute a workflow
   */
  private async executeWorkflow(state: WorkflowRunState): Promise<void> {
    const { workflow, request } = state;
    const params = { ...workflow.defaultParams, ...request?.params };

    // Find start step index
    let startIndex = 0;
    if (request?.startStep) {
      const idx = workflow.steps.findIndex((s) => s.id === request.startStep);
      if (idx >= 0) startIndex = idx;
    }

    // Find stop step index
    let stopIndex = workflow.steps.length;
    if (request?.stopStep) {
      const idx = workflow.steps.findIndex((s) => s.id === request.stopStep);
      if (idx >= 0) stopIndex = idx + 1;
    }

    // Execute steps
    for (let i = startIndex; i < stopIndex; i++) {
      // Check for cancellation
      if (state.status === 'cancelled') break;

      state.currentStep = i;
      const step = workflow.steps[i];

      const stepResult = await this.executeStep(step, params, request?.stepTimeout);
      state.steps.push(stepResult);

      // Stop on failure
      if (!stepResult.success) {
        state.status = 'failed';
        state.error = stepResult.error;
        return;
      }
    }

    state.status = 'completed';
  }

  /**
   * Execute a single step
   */
  private async executeStep(
    step: WorkflowStep,
    params: Record<string, unknown>,
    timeout?: number
  ): Promise<WorkflowStepResult> {
    const startTime = performance.now();

    try {
      // Apply timeout if specified
      const timeoutPromise = timeout
        ? new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Step timeout')), timeout)
          )
        : null;

      const executePromise = this.executeStepInternal(step, params);

      const result = timeoutPromise
        ? await Promise.race([executePromise, timeoutPromise])
        : await executePromise;

      return {
        stepId: step.id,
        stepType: step.type,
        success: true,
        result,
        durationMs: performance.now() - startTime,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        stepId: step.id,
        stepType: step.type,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs: performance.now() - startTime,
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Execute step internal logic
   */
  private async executeStepInternal(
    step: WorkflowStep,
    params: Record<string, unknown>
  ): Promise<unknown> {
    // Interpolate params in step
    const resolvedParams = this.interpolateParams(step.params || {}, params);

    switch (step.type) {
      case 'element-action':
        if (!step.target || !step.action) {
          throw new Error('Element action requires target and action');
        }
        return this.executor.executeAction(step.target, {
          action: step.action,
          params: resolvedParams,
          waitOptions: step.waitOptions,
        });

      case 'component-action':
        if (!step.target || !step.action) {
          throw new Error('Component action requires target and action');
        }
        return this.executor.executeComponentAction(step.target, {
          action: step.action,
          params: resolvedParams,
        });

      case 'wait': {
        if (!step.target) {
          throw new Error('Wait step requires target');
        }
        const waitResult = await this.executor.waitFor(
          step.target,
          step.waitOptions || {}
        );
        if (!waitResult.met) {
          throw new Error(waitResult.error || 'Wait condition not met');
        }
        return waitResult;
      }

      case 'assert':
        if (!step.target || !step.expectedState) {
          throw new Error('Assert step requires target and expectedState');
        }
        return this.performAssertion(step.target, step.expectedState);

      case 'custom':
        if (!step.handler) {
          throw new Error('Custom step requires handler');
        }
        return step.handler();

      default:
        throw new Error(`Unknown step type: ${step.type}`);
    }
  }

  /**
   * Perform state assertion
   */
  private async performAssertion(
    target: string,
    expectedState: Record<string, unknown>
  ): Promise<{ passed: boolean; differences: string[] }> {
    const snapshot = await this.executor.getSnapshot();
    const element = snapshot.elements.find((e) => e.id === target);

    if (!element) {
      throw new Error(`Element not found for assertion: ${target}`);
    }

    const differences: string[] = [];

    for (const [key, expected] of Object.entries(expectedState)) {
      const actual = (element.state as unknown as Record<string, unknown>)[key];
      if (actual !== expected) {
        differences.push(`${key}: expected ${expected}, got ${actual}`);
      }
    }

    if (differences.length > 0) {
      throw new Error(`Assertion failed:\n${differences.join('\n')}`);
    }

    return { passed: true, differences };
  }

  /**
   * Interpolate parameters with {{param}} syntax
   */
  private interpolateParams(
    stepParams: Record<string, unknown>,
    workflowParams: Record<string, unknown>
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(stepParams)) {
      if (typeof value === 'string') {
        result[key] = value.replace(/\{\{(\w+)\}\}/g, (_, name) => {
          return String(workflowParams[name] ?? '');
        });
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Build response from state
   */
  private buildResponse(state: WorkflowRunState): WorkflowRunResponse {
    return {
      workflowId: state.workflowId,
      runId: state.runId,
      status: state.status,
      steps: [...state.steps],
      currentStep: state.currentStep,
      totalSteps: state.workflow.steps.length,
      success: state.success,
      error: state.error,
      startedAt: state.startedAt,
      completedAt: state.completedAt,
      durationMs: state.durationMs,
    };
  }
}

/**
 * Internal workflow run state
 */
interface WorkflowRunState {
  workflowId: string;
  runId: string;
  workflow: Workflow;
  request?: WorkflowRunRequest;
  status: WorkflowRunStatus;
  steps: WorkflowStepResult[];
  currentStep: number;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  success?: boolean;
  error?: string;
}

/**
 * Create a workflow engine
 */
export function createWorkflowEngine(
  registry: UIBridgeRegistry,
  executor: ActionExecutor
): WorkflowEngine {
  return new DefaultWorkflowEngine(registry, executor);
}
