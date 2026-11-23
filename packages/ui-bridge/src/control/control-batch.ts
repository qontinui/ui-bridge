/**
 * `controlBatch` — the ONE batch contract, run the same way on every transport.
 *
 * A batch is an ordered list of `action` / `wait` / `snapshot` steps sent as a
 * single command. Two transports serve it and both compose this module:
 *
 *   - the in-page dispatcher (`react/commandHandlers.ts`, `case 'controlBatch'`),
 *     which every relayed command and the injected runtime's exec mode reach.
 *     Its `runAction` / `snapshot` are the dispatcher's own
 *     `executeElementAction` / `getControlSnapshot`, so every per-action rule of
 *     the browser path (settling, the payload grammar, redaction, hover
 *     auto-release) applies to a batched step unchanged;
 *   - the in-process handler (`server/handlers.ts`, `controlBatch`), whose
 *     `runAction` is its `executeElementAction` handler and whose `snapshot` is
 *     `registry.createSnapshot()`.
 *
 * Until this module existed the relay sent `controlBatch` to browser tabs that
 * had no case for it (`Unknown command action: controlBatch`), and a second
 * batch contract, `executeBatchAction`, covered a subset of these steps with a
 * different response. That second contract is deleted; its per-step labels,
 * full failure answers and counts live here.
 *
 * Request grammar — the spellings the runner's own `/control/batch-execute`
 * accepts (`resolve_batch_steps`, `batch_stop_on_error` in qontinui-runner
 * `src-tauri/src/mcp/ui_bridge/capabilities.rs`), so one body works on either
 * surface:
 *
 *   - the step array is `actions`, or its alias `steps` (`actions` wins when
 *     both are present). Neither → refused. A key that is present but not an
 *     array → refused. `actions: []` is a requested empty batch: a success with
 *     `total: 0`;
 *   - the stop flag is the first BOOLEAN among `stop_on_error`, `stopOnError`
 *     and `stopOnFailure`; default `true`;
 *   - a step is `{"type":"wait","ms":<n>}`, `{"type":"snapshot"}` or
 *     `{"type":"action", …element-action payload}`, each with an optional
 *     string `label` that is echoed on its result. The action payload is read
 *     by the dispatcher's own grammar (`readElementActionPayload`,
 *     `react/element-command-payload.ts`): the canonical `{id, request}`, the
 *     `elementId` spelling, or a flat request. The SDK's historical
 *     `element_id` is accepted here as a further id spelling, by mapping it to
 *     `id` before that grammar runs — the grammar's own id keys are NOT
 *     widened, so every other transport reads exactly what it read before.
 *
 * A malformed step never throws and never refuses the batch: it fails AS THAT
 * STEP, with an `INVALID_REQUEST` answer naming the step grammar.
 *
 * Response: `{ success, results, completed, total, succeededCount,
 * failedCount, skippedCount, durationMs }`, plus `error` / `code` when the
 * batch failed. Each result is `{ index, type, label?, success, durationMs,
 * data?, error?, code? }`, and `data` is the step's FULL answer on failure as
 * well as on success. `results` holds the steps that ran; a step after a
 * failure under stop-on-error is not run and counts in `skippedCount`
 * (`completed + skippedCount === total`).
 *
 * The outer `success` is the batch's verdict: true only when every executed
 * step succeeded and none was skipped. A failed batch is therefore a RETURNED
 * `success: false` whose body still holds every step result — the relay seam
 * and the in-process handler both turn it into a failure envelope that keeps
 * the body under `data`.
 *
 * Codes: a step's `code` and the batch's `code` are the envelope code the
 * shared inner-failure rule derives (`describeInnerFailure`): a step's own
 * hoisted `code` verbatim, else its SDK `errorCode` mapped onto the canonical
 * `UB-*` family. So an unknown element reads `UB-ELEM-NOT-FOUND` on every
 * transport, while the raw `ELEMENT_NOT_FOUND` / `INVALID_REQUEST` stays in the
 * step's `data.failureDetails.errorCode`.
 *
 * Plan: 2026-11-08-relayed-ui-bridge-actions-have-no-browser-case (D2).
 */

import { mapInternalErrorCode } from '../diagnostics';
import { describeInnerFailure } from '../server/inner-failure';
import {
  readElementActionPayload,
  type ElementActionCommandPayload,
  type ElementActionRequest,
} from '../react/element-command-payload';

// ============================================================================
// Types
// ============================================================================

/** An element action step. Beside `type` / `label` it IS an element-action payload. */
export interface ControlBatchActionStep {
  type: 'action';
  /** Echoed on the step's result. */
  label?: string;
  /** The element: `id`, `elementId`, or the historical `element_id`. */
  id?: string;
  elementId?: string;
  element_id?: string;
  /** The canonical request; absent for the flat spelling. */
  request?: ElementActionRequest;
  /** The flat spelling's verb (and the SDK's historical `{element_id, action, params}`). */
  action?: string;
  params?: Record<string, unknown>;
  [field: string]: unknown;
}

export interface ControlBatchWaitStep {
  type: 'wait';
  /** Milliseconds to sleep: a finite, non-negative number. */
  ms: number;
  label?: string;
}

export interface ControlBatchSnapshotStep {
  type: 'snapshot';
  label?: string;
}

/** One step of a `controlBatch` request. */
export type ControlBatchStep =
  | ControlBatchActionStep
  | ControlBatchWaitStep
  | ControlBatchSnapshotStep;

/** A `controlBatch` request body (`POST /control/batch-execute`). */
export interface ControlBatchRequest {
  /** The steps. */
  actions?: ControlBatchStep[];
  /** Alias of `actions`, read only when `actions` is absent. */
  steps?: ControlBatchStep[];
  /** Stop at the first failed step (default `true`). */
  stop_on_error?: boolean;
  /** Alias of `stop_on_error`. */
  stopOnError?: boolean;
  /** Alias of `stop_on_error`. */
  stopOnFailure?: boolean;
}

/** The result of one executed step. */
export interface ControlBatchStepResult {
  index: number;
  /** The step's `type` as sent (`'invalid'` when it sent none that is a string). */
  type: string;
  label?: string;
  success: boolean;
  durationMs: number;
  /** The step's FULL answer — on failure as well as on success. */
  data?: unknown;
  error?: string;
  code?: string;
}

/** The batch's answer. */
export interface ControlBatchResponse {
  /** True only when every executed step succeeded and none was skipped. */
  success: boolean;
  /** The steps that ran, in order. */
  results: ControlBatchStepResult[];
  /** How many steps ran (`results.length`). */
  completed: number;
  /** How many steps the request carried. */
  total: number;
  succeededCount: number;
  failedCount: number;
  /** Steps not run because an earlier one failed under stop-on-error. */
  skippedCount: number;
  durationMs: number;
  /** Why the batch failed (absent on success). */
  error?: string;
  /** The first failed step's code, or the refusal's (absent on success). */
  code?: string;
}

/** A step as read: runnable, or a refusal that fails as that step. */
export type ControlBatchParsedStep =
  | { kind: 'action'; type: 'action'; label?: string; payload: ElementActionCommandPayload }
  | { kind: 'wait'; type: 'wait'; label?: string; ms: number }
  | { kind: 'snapshot'; type: 'snapshot'; label?: string }
  | { kind: 'invalid'; type: string; label?: string; message: string; elementId: string };

/** A request as read by {@link readControlBatchRequest}. */
export type ControlBatchReading =
  | { ok: true; steps: ControlBatchParsedStep[]; stopOnError: boolean }
  | { ok: false; message: string };

/** What a transport supplies to run a batch. */
export interface ControlBatchDeps {
  /** Run one element action; resolves with its answer (a `success: false` answer is a failed step). */
  runAction: (payload: ElementActionCommandPayload) => Promise<unknown>;
  /** Take a snapshot; its value is the step's `data`. */
  snapshot: () => unknown;
  /** A monotonic clock in milliseconds, for `durationMs`. */
  now: () => number;
}

// ============================================================================
// Grammar
// ============================================================================

/** The step grammar, as a refusal quotes it. */
export const CONTROL_BATCH_STEP_SHAPE =
  '{"type":"action","id":"<elementId>","request":{"action":"<action>", …}} ' +
  '(also "elementId" or "element_id" in place of "id", or a flat request beside "action"), ' +
  '{"type":"wait","ms":<milliseconds>} or {"type":"snapshot"}, each with an optional string "label"';

/** The request grammar, as a refusal quotes it. */
export const CONTROL_BATCH_REQUEST_SHAPE =
  '{"actions":[<step>, …]} (alias "steps"), with an optional boolean ' +
  '"stop_on_error" (also "stopOnError" / "stopOnFailure"; default true)';

const STEP_ARRAY_KEYS = ['actions', 'steps'] as const;
const STOP_FLAG_KEYS = ['stop_on_error', 'stopOnError', 'stopOnFailure'] as const;

/** Keys every step may carry beside its own. */
const COMMON_STEP_KEYS: ReadonlySet<string> = new Set(['type', 'label']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** A value's kind, never its content (a step can carry a typed secret). */
function describeKind(value: unknown): string {
  if (value === undefined) return 'nothing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value === 'object' ? 'an object' : `a ${typeof value}`;
}

function invalidStep(
  index: number,
  type: string,
  label: string | undefined,
  problem: string,
  elementId = ''
): ControlBatchParsedStep {
  return {
    kind: 'invalid',
    type,
    ...(label !== undefined ? { label } : {}),
    message: `controlBatch step ${index} refused: ${problem}. Expected ${CONTROL_BATCH_STEP_SHAPE}.`,
    elementId,
  };
}

/** Keys of a wait / snapshot step that nothing reads. */
function unreadKeys(step: Record<string, unknown>, own: readonly string[]): string[] {
  return Object.keys(step).filter(
    (key) => !COMMON_STEP_KEYS.has(key) && !own.includes(key) && step[key] !== undefined
  );
}

function readStep(raw: unknown, index: number): ControlBatchParsedStep {
  if (!isPlainObject(raw)) {
    return invalidStep(
      index,
      'invalid',
      undefined,
      `must be a JSON object, got ${describeKind(raw)}`
    );
  }
  const type = typeof raw.type === 'string' && raw.type.length > 0 ? raw.type : 'invalid';
  let label: string | undefined;
  if (raw.label !== undefined) {
    if (typeof raw.label !== 'string') {
      return invalidStep(
        index,
        type,
        undefined,
        `"label" must be a string, got ${describeKind(raw.label)}`
      );
    }
    label = raw.label;
  }
  const withLabel = label !== undefined ? { label } : {};

  if (raw.type === 'wait') {
    const unread = unreadKeys(raw, ['ms']);
    if (unread.length > 0) {
      return invalidStep(
        index,
        type,
        label,
        `${unread.map((k) => `"${k}"`).join(', ')} not read by a wait step`
      );
    }
    if (typeof raw.ms !== 'number' || !Number.isFinite(raw.ms) || raw.ms < 0) {
      return invalidStep(
        index,
        type,
        label,
        `"ms" must be a finite, non-negative number, got ${describeKind(raw.ms)}`
      );
    }
    return { kind: 'wait', type: 'wait', ...withLabel, ms: raw.ms };
  }

  if (raw.type === 'snapshot') {
    const unread = unreadKeys(raw, []);
    if (unread.length > 0) {
      return invalidStep(
        index,
        type,
        label,
        `${unread.map((k) => `"${k}"`).join(', ')} not read by a snapshot step`
      );
    }
    return { kind: 'snapshot', type: 'snapshot', ...withLabel };
  }

  if (raw.type === 'action') {
    // Strip the step's own keys, and map the historical `element_id` to `id`,
    // so what remains is an element-action payload in the dispatcher's grammar.
    const payload: Record<string, unknown> = Object.fromEntries(
      Object.keys(raw)
        .filter((key) => !COMMON_STEP_KEYS.has(key) && key !== 'element_id')
        .map((key) => [key, raw[key]])
    );
    if (raw.element_id !== undefined) {
      if (raw.id !== undefined || raw.elementId !== undefined) {
        return invalidStep(
          index,
          type,
          label,
          'names its element twice: use one of "id", "elementId" or "element_id"'
        );
      }
      payload.id = raw.element_id;
    }
    const parsed = readElementActionPayload(payload);
    if (!parsed.ok) {
      return invalidStep(index, type, label, parsed.message, parsed.elementId);
    }
    return {
      kind: 'action',
      type: 'action',
      ...withLabel,
      payload: { id: parsed.id, request: parsed.request },
    };
  }

  return invalidStep(
    index,
    type,
    label,
    raw.type === undefined
      ? 'names no "type"'
      : typeof raw.type === 'string'
        ? `unknown step type "${raw.type.length > 40 ? `${raw.type.slice(0, 40)}…` : raw.type}"`
        : `"type" must be a string, got ${describeKind(raw.type)}`
  );
}

/**
 * Read a `controlBatch` payload. Refuses only a payload that carries no usable
 * step array; a malformed STEP is read as an `invalid` step that fails on its
 * own when the batch runs.
 */
export function readControlBatchRequest(payload: unknown): ControlBatchReading {
  if (!isPlainObject(payload)) {
    return {
      ok: false,
      message: `controlBatch request refused: must be a JSON object, got ${describeKind(payload)}. Expected ${CONTROL_BATCH_REQUEST_SHAPE}.`,
    };
  }
  const key = STEP_ARRAY_KEYS.find((k) => payload[k] !== undefined);
  if (key === undefined) {
    return {
      ok: false,
      message: `controlBatch request refused: carries no "actions" array (alias "steps"). Expected ${CONTROL_BATCH_REQUEST_SHAPE}.`,
    };
  }
  const rawSteps = payload[key];
  if (!Array.isArray(rawSteps)) {
    return {
      ok: false,
      message: `controlBatch request refused: "${key}" must be an array of steps, got ${describeKind(rawSteps)}. Expected ${CONTROL_BATCH_REQUEST_SHAPE}.`,
    };
  }
  const flag = STOP_FLAG_KEYS.map((k) => payload[k]).find((v) => typeof v === 'boolean');
  return {
    ok: true,
    steps: rawSteps.map((raw, index) => readStep(raw, index)),
    stopOnError: typeof flag === 'boolean' ? flag : true,
  };
}

// ============================================================================
// Execution
// ============================================================================

/** A step's answer reports failure only by a literal `success: false`. */
function answerFailed(answer: unknown): boolean {
  return isPlainObject(answer) && answer.success === false;
}

/** A thrown error as a failed step's answer, keeping a typed `code`. */
function thrownAnswer(err: unknown): Record<string, unknown> {
  const message = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: unknown } | null)?.code;
  return {
    success: false,
    error: message,
    ...(typeof code === 'string' && code.length > 0 ? { code } : {}),
  };
}

/** The answer an `invalid` step fails with: the dispatcher's refusal shape. */
function invalidAnswer(step: Extract<ControlBatchParsedStep, { kind: 'invalid' }>) {
  return {
    success: false,
    error: step.message,
    failureDetails: {
      errorCode: 'INVALID_REQUEST',
      message: step.message,
      elementId: step.elementId,
      expectedPayload: CONTROL_BATCH_STEP_SHAPE,
    },
  };
}

async function answerStep(step: ControlBatchParsedStep, deps: ControlBatchDeps): Promise<unknown> {
  switch (step.kind) {
    case 'invalid':
      return invalidAnswer(step);
    case 'wait':
      await new Promise<void>((resolve) => setTimeout(resolve, step.ms));
      return { waited_ms: step.ms };
    case 'snapshot':
      return await deps.snapshot();
    case 'action':
      return await deps.runAction(step.payload);
  }
}

/**
 * Run a read batch. A refused request answers a failed, empty batch; nothing
 * here throws.
 */
export async function runControlBatch(
  reading: ControlBatchReading,
  deps: ControlBatchDeps
): Promise<ControlBatchResponse> {
  const batchStart = deps.now();
  if (!reading.ok) {
    return {
      success: false,
      results: [],
      completed: 0,
      total: 0,
      succeededCount: 0,
      failedCount: 0,
      skippedCount: 0,
      durationMs: deps.now() - batchStart,
      error: reading.message,
      code: mapInternalErrorCode('INVALID_REQUEST', reading.message),
    };
  }

  const { steps, stopOnError } = reading;
  const results: ControlBatchStepResult[] = [];
  let failedCount = 0;

  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    const start = deps.now();
    let answer: unknown;
    try {
      answer = await answerStep(step, deps);
    } catch (err) {
      answer = thrownAnswer(err);
    }
    const base = {
      index,
      type: step.type,
      ...(step.label !== undefined ? { label: step.label } : {}),
    };
    if (answerFailed(answer)) {
      failedCount++;
      const { message, code } = describeInnerFailure(
        answer,
        `controlBatch step ${index} (${step.type}) failed but supplied no error message.`
      );
      results.push({
        ...base,
        success: false,
        durationMs: deps.now() - start,
        data: answer,
        error: message,
        code,
      });
      if (stopOnError) break;
    } else {
      results.push({ ...base, success: true, durationMs: deps.now() - start, data: answer });
    }
  }

  const completed = results.length;
  const skippedCount = steps.length - completed;
  const response: ControlBatchResponse = {
    success: failedCount === 0 && skippedCount === 0,
    results,
    completed,
    total: steps.length,
    succeededCount: completed - failedCount,
    failedCount,
    skippedCount,
    durationMs: deps.now() - batchStart,
  };
  const firstFailure = results.find((r) => !r.success);
  if (firstFailure) {
    response.error =
      `controlBatch: ${failedCount} of ${steps.length} step${steps.length === 1 ? '' : 's'} failed ` +
      `(first: step ${firstFailure.index} (${firstFailure.type}): ${firstFailure.error})` +
      (skippedCount > 0 ? `; ${skippedCount} skipped after it (stop_on_error)` : '');
    response.code = firstFailure.code;
  }
  return response;
}
