/**
 * The producer of the element-scoped ACTION events (`action:started`,
 * `action:completed`, `action:failed`) a registry's `ElementEventLog` records
 * and `getElementHistory` serves (plan
 * 2026-11-08-relayed-ui-bridge-actions-have-no-browser-case, review rounds 1-2).
 *
 * The log has classified these three as its `info` / `error` events since it
 * was written, and the metrics collector listens for two of them — but nothing
 * emitted them, so a history read answered `[]` for an element that had just
 * been clicked. Every element action now runs through
 * {@link withElementActionEvents} exactly once:
 *   - on the page, the `executeElementAction` command (`react/commandHandlers.ts`)
 *     — every exec-mode and relayed action, and the batch steps, diff actions
 *     and AI executions that delegate to it;
 *   - in-process, the action executor itself, wrapped once by
 *     {@link recordingActionExecutor} when `createHandlers` / `createAIHandlers`
 *     build (`server/handlers.ts`) — so the route, batch steps, the change
 *     tracker's diff actions and the NL executor all record, and none twice.
 *
 * What an event carries is deliberately narrow: the element id, the verb, and
 * an ALLOWLISTED projection of the action's answer ({@link eventResponseOf}):
 * its verdict, timing, error text and canonical error code, and the
 * `elementState` the answer's own §4.6 projection already scrubbed. Never the
 * request's params (a `type` step's `text` is what a password field was sent),
 * never a custom action's `result` (app data no scrub touches), and nothing
 * else the answer carries that no scrub reached (handler-attached error
 * properties, snapshots, change lists).
 */
import type { BridgeEventType } from './types';

/** Where the events go: the registry's event bus. */
export interface ElementActionEventSink {
  dispatchEvent?<T>(type: BridgeEventType, data: T): void;
}

/** `action:started`. */
export interface ElementActionStartedData {
  elementId: string;
  action: string;
}

/** `action:completed` / `action:failed`. */
export interface ElementActionSettledData extends ElementActionStartedData {
  /**
   * The allowlisted projection ({@link eventResponseOf}) of the action's answer
   * (for an envelope, of its `data` when it has one).
   */
  response: Record<string, unknown> | undefined;
  /** The failure's message (`action:failed` only). */
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The action's own answer inside `answer`: an envelope's `data`, else `answer`. */
function actionResponseOf(answer: unknown): unknown {
  if (isRecord(answer) && 'data' in answer && answer.data !== undefined) return answer.data;
  return answer;
}

/** The answer fields an event may carry, as they are. */
const EVENT_RESPONSE_FIELDS = [
  'success',
  'error',
  'durationMs',
  'timestamp',
  'requestId',
  'retryCount',
  'waitDurationMs',
  'idleWaitMs',
  // The answer's own §4.6 projection: scrubbed where it was built.
  'elementState',
] as const;

/**
 * The part of an action answer an event keeps: the allowlisted fields, and of
 * `failureDetails` only the canonical `errorCode` and `message`.
 */
export function eventResponseOf(response: unknown): Record<string, unknown> | undefined {
  if (!isRecord(response)) return undefined;
  const out: Record<string, unknown> = {};
  for (const key of EVENT_RESPONSE_FIELDS) {
    if (response[key] !== undefined) out[key] = response[key];
  }
  const details = response.failureDetails;
  if (isRecord(details)) {
    const kept: Record<string, unknown> = {};
    if (typeof details.errorCode === 'string') kept.errorCode = details.errorCode;
    if (typeof details.message === 'string') kept.message = details.message;
    out.failureDetails = kept;
  }
  return out;
}

/** Did `answer` (or the action answer under it) fail? */
function answerFailed(answer: unknown): boolean {
  if (!isRecord(answer)) return false;
  if (answer.success === false) return true;
  const inner = actionResponseOf(answer);
  return isRecord(inner) && inner.success === false;
}

function errorOf(answer: unknown): string {
  for (const candidate of [answer, actionResponseOf(answer)]) {
    if (isRecord(candidate) && typeof candidate.error === 'string' && candidate.error.length > 0) {
      return candidate.error;
    }
  }
  return 'the action did not report success and supplied no error message';
}

/**
 * Run one bus emission, swallowing a throw: a throwing listener must not change
 * the action's answer. Each call site names its event type as a literal.
 */
function emitSafely(emitOne: () => void): void {
  try {
    emitOne();
  } catch {
    // Swallowed, as above.
  }
}

/**
 * Run one element action between its `action:started` and its
 * `action:completed` / `action:failed` event. A throw is recorded as
 * `action:failed` and rethrown; the answer is returned unchanged.
 */
export async function withElementActionEvents<A>(
  sink: ElementActionEventSink,
  elementId: string,
  action: string,
  run: () => Promise<A>
): Promise<A> {
  const started: ElementActionStartedData = { elementId, action };
  emitSafely(() => sink.dispatchEvent?.('action:started', started));
  let answer: A;
  try {
    answer = await run();
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    // No answer exists; the response is the failure a reader of `response`
    // (the metrics collector) can read like any other.
    const failed: ElementActionSettledData = {
      elementId,
      action,
      response: { success: false, error, timestamp: Date.now() },
      error,
    };
    emitSafely(() => sink.dispatchEvent?.('action:failed', failed));
    throw err;
  }
  const response = eventResponseOf(actionResponseOf(answer));
  if (answerFailed(answer)) {
    const failed: ElementActionSettledData = {
      elementId,
      action,
      response,
      error: errorOf(answer),
    };
    emitSafely(() => sink.dispatchEvent?.('action:failed', failed));
  } else {
    const completed: ElementActionSettledData = { elementId, action, response };
    emitSafely(() => sink.dispatchEvent?.('action:completed', completed));
  }
  return answer;
}

/** The one method {@link recordingActionExecutor} wraps. */
export interface ElementActionExecutor {
  executeAction(elementId: string, request: never): Promise<unknown>;
}

/** Is `action` a verb an event can name? */
function isNamedAction(action: unknown): action is string {
  return typeof action === 'string' && action.length > 0;
}

/**
 * `executor`, with `executeAction` running between its events on `sink`.
 * Every other member reads through to `executor` (methods bound to it, so its
 * own internal calls — and its private state — are untouched and record
 * nothing). A request whose `action` is not a non-empty string names no action
 * an event could record, and runs without events, as the page records nothing
 * for a payload its grammar refuses.
 */
export function recordingActionExecutor<E extends object>(
  executor: E,
  sink: ElementActionEventSink
): E {
  const target = executor as unknown as ElementActionExecutor;
  const executeAction = (elementId: string, request: { action?: unknown } | undefined) => {
    const action = request?.action;
    if (!isNamedAction(action)) return target.executeAction(elementId, request as never);
    return withElementActionEvents(sink, elementId, action, () =>
      target.executeAction(elementId, request as never)
    );
  };
  return new Proxy(executor, {
    get(obj, prop) {
      if (prop === 'executeAction') return executeAction;
      const value = Reflect.get(obj, prop, obj) as unknown;
      return typeof value === 'function'
        ? (value as (...a: unknown[]) => unknown).bind(obj)
        : value;
    },
  });
}
