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
  ControlActionResponse,
} from './types';
import type { UiBridgeErrorCode } from '../diagnostics';
import { buildActionFailureDetails } from '../diagnostics';
import {
  SemanticSnapshotManager,
  createSnapshotManager,
} from '../ai/semantic-snapshot';
import { computeDiff } from '../ai/semantic-diff';
import type { SemanticSnapshot, ElementChange } from '../ai/types';
import { computeVerification } from './effect-containment';
import { composeSignatures } from './effect-composition';
import type { CompositionStep } from './effect-composition';
import type { SignatureLookup } from './effect-signatures';
import { createDefaultSignatureRegistry } from './effect-signatures';
import type { EffectVerification, ObservedDelta } from './effect-types';

/**
 * Options controlling the workflow engine's D3 effect-composition behaviour.
 */
export interface WorkflowEngineOptions {
  /**
   * Enable workflow-level effect composition (Phase 3b). Default OFF — when
   * off the engine is byte-identical to its pre-D3 behaviour: no snapshots are
   * captured and no `compositionVerification` is produced. Mirrors the
   * executor's `enableEffectVerification` opt-in.
   */
  enableEffectComposition?: boolean;
  /** Signature registry for composition. Defaults to the Phase 1 registry. */
  signatureRegistry?: SignatureLookup;
}

/** An appeared element is "error-like" by the same heuristic the diff uses. */
function isErrorChange(change: ElementChange): boolean {
  return change.semanticType?.includes('error') === true || change.type === 'alert';
}

/**
 * Derive the navigated-to route from the pre/post page context (mirrors the
 * verifier's `deriveNavigatedTo`). Returns the post route only when it differs.
 */
function deriveNavigatedTo(
  pre: SemanticSnapshot,
  post: SemanticSnapshot,
): string | undefined {
  const preRoute = pre.page.pathname ?? pre.page.url;
  const postRoute = post.page.pathname ?? post.page.url;
  if (postRoute !== undefined && postRoute !== preRoute) return postRoute;
  return undefined;
}

/**
 * Build an {@link ObservedDelta} from a pre/post snapshot pair using the same
 * construction the per-action verifier uses (`effect-verifier.ts`):
 * appeared/disappeared/modified/navigatedTo/errorsAppeared from `computeDiff`.
 */
function observedFromSnapshots(
  pre: SemanticSnapshot,
  post: SemanticSnapshot,
): ObservedDelta {
  const diff = computeDiff(pre, post);
  return {
    appeared: diff.changes.appeared,
    disappeared: diff.changes.disappeared,
    modified: diff.changes.modified,
    navigatedTo: deriveNavigatedTo(pre, post),
    errorsAppeared: diff.changes.appeared.filter(isErrorChange).length,
  };
}

/**
 * Classify a thrown workflow-step error into a canonical diagnostic code.
 * Deterministic from the error message; defaults to `UB-ACTION-FAILED`.
 */
function classifyStepError(message: string): UiBridgeErrorCode {
  const m = message.toLowerCase();
  if (m.includes('timeout') || m.includes('timed out')) return 'UB-ACTION-TIMEOUT';
  if (m.includes('not found')) return 'UB-ELEM-NOT-FOUND';
  if (m.includes('condition not met')) return 'UB-STATE-NOT-REACHED';
  if (m.includes('requires') || m.includes('unknown step type')) return 'UB-VALIDATION-ERROR';
  return 'UB-ACTION-FAILED';
}

/**
 * Read a per-step `effectVerification` off a step's action result, if present.
 * `executeStepInternal` returns the raw `ControlActionResponse` for
 * element/component actions; when the executor has effect verification enabled
 * and a signature resolved, that response carries `effectVerification`. Purely
 * read-only — returns undefined for any non-action result shape.
 */
function extractStepEffectVerification(result: unknown): EffectVerification | undefined {
  if (result && typeof result === 'object' && 'effectVerification' in result) {
    const v = (result as Partial<ControlActionResponse>).effectVerification;
    return v ?? undefined;
  }
  return undefined;
}

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

  /** D3 Phase 3b: workflow-level effect composition. Default OFF. */
  private effectCompositionEnabled: boolean;
  private signatureRegistry: SignatureLookup;
  /** Lazily-constructed snapshot manager (only built when composition runs). */
  private snapshotManager?: SemanticSnapshotManager;

  constructor(
    private registry: UIBridgeRegistry,
    private executor: ActionExecutor,
    options: WorkflowEngineOptions = {}
  ) {
    this.effectCompositionEnabled = options.enableEffectComposition ?? false;
    this.signatureRegistry = options.signatureRegistry ?? createDefaultSignatureRegistry();
  }

  /**
   * Toggle workflow-level effect composition at runtime. When disabled the
   * engine behaves exactly as it did pre-D3 (no snapshots, no
   * `compositionVerification`).
   */
  setEffectCompositionEnabled(enabled: boolean): void {
    this.effectCompositionEnabled = enabled;
  }

  /** Lazy snapshot manager — built on first use so the off-path stays cheap. */
  private getSnapshotManager(): SemanticSnapshotManager {
    if (!this.snapshotManager) {
      this.snapshotManager = createSnapshotManager();
    }
    return this.snapshotManager;
  }

  /** Capture a workflow-level semantic snapshot of the current control state. */
  private async captureSnapshot(): Promise<SemanticSnapshot> {
    const controlSnapshot = await this.executor.getSnapshot();
    return this.getSnapshotManager().createSnapshot(controlSnapshot);
  }

  /**
   * Run a workflow
   */
  async run(workflowId: string, request?: WorkflowRunRequest): Promise<WorkflowRunResponse> {
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

    // D3 Phase 3b: capture ONE workflow-level pre-snapshot before the first
    // step (only when composition is enabled). §6.4 — a single pre/post pair
    // for the whole run is the hot-loop mitigation vs N per-step captures.
    const compositionEnabled = this.effectCompositionEnabled;
    let preSnapshot: SemanticSnapshot | undefined;
    let compositionStartedAt = 0;
    if (compositionEnabled) {
      preSnapshot = await this.captureSnapshot();
      compositionStartedAt = Date.now();
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
        // Still attempt composition verification on the partial run so a drift
        // that caused the failure is surfaced.
        if (compositionEnabled && preSnapshot) {
          await this.verifyComposition(
            state,
            workflow.steps.slice(startIndex, i + 1),
            params,
            preSnapshot,
            compositionStartedAt,
          );
        }
        return;
      }
    }

    state.status = 'completed';

    // D3 Phase 3b: capture the post-snapshot AFTER the last step and verify the
    // composed prediction against the end-to-end observed delta.
    if (compositionEnabled && preSnapshot) {
      await this.verifyComposition(
        state,
        workflow.steps.slice(startIndex, stopIndex),
        params,
        preSnapshot,
        compositionStartedAt,
      );
    }
  }

  /**
   * D3 Phase 3b: compose the executed steps' signatures into one workflow-level
   * prediction and verify it against the end-to-end observed delta. Stores the
   * result on `state.compositionVerification`. Skips entirely when no step
   * contributed a signature (composition is a no-op). Never throws.
   */
  private async verifyComposition(
    state: WorkflowRunState,
    executedSteps: WorkflowStep[],
    params: Record<string, unknown>,
    preSnapshot: SemanticSnapshot,
    startedAt: number,
  ): Promise<void> {
    const compositionSteps = this.toCompositionSteps(executedSteps, params);
    const composed = composeSignatures(compositionSteps, preSnapshot, this.signatureRegistry);

    // 0 signatures → composition is a no-op; leave compositionVerification unset.
    if (composed.stepsWithSignatures === 0) return;

    const post = await this.captureSnapshot();
    const observed = observedFromSnapshots(preSnapshot, post);
    const durationMs = Date.now() - startedAt;

    state.compositionVerification = computeVerification(
      composed.predicted,
      observed,
      preSnapshot,
      composed.scope,
      'causal',
      durationMs,
    );
  }

  /**
   * Map workflow steps to the `{ action, element, params }` shape
   * {@link composeSignatures} consumes. Only ACTION steps contribute — a step
   * is an action iff it has a `step.action` AND its type is an action-dispatch
   * type (`element-action` / `component-action`). The action name + params +
   * target element id are read exactly as `executeStepInternal` reads them when
   * dispatching to `executor.executeAction`. The element's `reveals` glob list
   * is read from the registry (the same source the executor's signature
   * resolution uses), so a click whose target declares `reveals` predicts those
   * appearances; a click without `reveals` resolves no signature (correct).
   */
  private toCompositionSteps(
    steps: WorkflowStep[],
    workflowParams: Record<string, unknown>,
  ): CompositionStep[] {
    const out: CompositionStep[] = [];
    for (const step of steps) {
      if (step.type !== 'element-action' && step.type !== 'component-action') continue;
      if (!step.action) continue;
      const resolvedParams = this.interpolateParams(step.params || {}, workflowParams);
      const registered = step.target ? this.registry.getElement(step.target) : undefined;
      out.push({
        action: step.action,
        element: step.target
          ? { id: step.target, reveals: registered?.reveals }
          : undefined,
        params: resolvedParams,
      });
    }
    return out;
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

      // D3: thread a per-step effect verification from the underlying action
      // response, if the executor produced one (read-only — the engine never
      // computes it; it only surfaces what `executeAction` already returned).
      const effectVerification = extractStepEffectVerification(result);

      return {
        stepId: step.id,
        stepType: step.type,
        success: true,
        result,
        ...(effectVerification ? { effectVerification } : {}),
        durationMs: performance.now() - startTime,
        timestamp: Date.now(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorCode = classifyStepError(message);
      return {
        stepId: step.id,
        stepType: step.type,
        success: false,
        error: message,
        failureDetails: buildActionFailureDetails(errorCode, message, {
          context: { stepId: step.id, stepType: step.type },
          durationMs: performance.now() - startTime,
        }),
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
        const waitResult = await this.executor.waitFor(step.target, step.waitOptions || {});
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
      ...(state.compositionVerification
        ? { compositionVerification: state.compositionVerification }
        : {}),
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
  /** D3 Phase 3b workflow-level composition verification, when enabled. */
  compositionVerification?: EffectVerification;
}

/**
 * Create a workflow engine
 */
export function createWorkflowEngine(
  registry: UIBridgeRegistry,
  executor: ActionExecutor,
  options?: WorkflowEngineOptions
): WorkflowEngine {
  return new DefaultWorkflowEngine(registry, executor, options);
}
