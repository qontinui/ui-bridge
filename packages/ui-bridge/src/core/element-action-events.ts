/**
 * The producer of the element-scoped ACTION events (`action:started`,
 * `action:completed`, `action:failed`) a registry's `ElementEventLog` records
 * and `getElementHistory` serves (plan
 * 2026-11-08-relayed-ui-bridge-actions-have-no-browser-case, review round 1).
 *
 * The log has classified these three as its `info` / `error` events since it
 * was written, and the metrics collector listens for two of them — but nothing
 * emitted them, so a history read answered `[]` for an element that had just
 * been clicked. Both element-action transports now run through
 * {@link withElementActionEvents}: the page's `executeElementAction` command
 * (`react/commandHandlers.ts`, every exec-mode and relayed action, batch steps
 * included) and the in-process `executeElementAction` handler
 * (`server/handlers.ts`).
 *
 * What an event carries is deliberately narrow: the element id, the verb, and
 * the action's own wire answer (already §4.6-scrubbed, as every caller
 * receives it). Never the request's params — a `type` step's `text` is exactly
 * what a password field was sent.
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
  /** The action's wire answer (for an envelope, its `data` when it has one). */
  response: unknown;
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
  const response = actionResponseOf(answer);
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
