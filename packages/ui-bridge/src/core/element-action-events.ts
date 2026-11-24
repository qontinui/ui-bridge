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
 * What an event carries is deliberately narrow, because the log outlives the
 * call. It holds: the element id the caller named; the verb, only when it is a
 * built-in verb (`./action-verbs.ts`) or a custom action that element
 * registered, else `'unknown'` ({@link recordedVerb}); and an ALLOWLISTED
 * projection of the action's answer ({@link eventResponseOf}) — its verdict,
 * its timing, the element's NON-CONTENT state after the action (visibility,
 * enabled/disabled, focus, checked/pressed/expanded/selected flags, role;
 * {@link EVENT_ELEMENT_STATE_FIELDS}), and, on a failure, only the error CODE
 * with a fixed message built from it ({@link failureMessage}).
 *
 * So no request param reaches the log — neither directly (a `type` step's
 * `text`) nor through the element's post-action content (`value`,
 * `textContent`, `selectedOptions`, options, `innerHTML`, `dataset`, `href`,
 * the accessible name: an unmarked text input's value IS the text just typed
 * into it, scrubbed only when the element's own verdict redacts it) — nor the
 * `requestId`, a free-text verb, or any error TEXT: an error message can echo a
 * param (a `sendKeys` refusal quotes the key token it rejected) or be
 * app-authored (a custom handler's throw). Nor a custom action's `result`, nor
 * anything else the answer carries that no scrub reached (handler-attached
 * error properties, snapshots, change lists). The caller's own answer is
 * unchanged.
 */
import type { BridgeEventType } from './types';
import { BUILT_IN_ACTION_VERBS } from './action-verbs';

/**
 * Where the events go: the registry's event bus — and the registry's
 * registration lookup, which says whether a non-built-in verb is a custom
 * action the element registered.
 */
export interface ElementActionEventSink {
  dispatchEvent?<T>(type: BridgeEventType, data: T): void;
  getElement?(id: string): unknown;
}

/** The verb an event records for a verb that is neither built in nor registered. */
export const UNKNOWN_VERB = 'unknown';

/**
 * The verb an event may record for `action` on `elementId`: a built-in verb, or
 * a custom action the element's registration declares; anything else is
 * caller-chosen free text and is recorded as {@link UNKNOWN_VERB}.
 */
export function recordedVerb(
  sink: ElementActionEventSink,
  elementId: string,
  action: string
): string {
  if (BUILT_IN_ACTION_VERBS.has(action)) return action;
  let registration: unknown;
  try {
    registration = sink.getElement?.(elementId);
  } catch {
    registration = undefined;
  }
  const custom = isRecord(registration) ? registration.customActions : undefined;
  return isRecord(custom) && Object.prototype.hasOwnProperty.call(custom, action)
    ? action
    : UNKNOWN_VERB;
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
  /** The failure's FIXED message, `action failed (<code>)` (`action:failed` only). */
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

/** The answer fields an event may carry, as they are: none is caller text. */
const EVENT_RESPONSE_FIELDS = [
  'success',
  'durationMs',
  'timestamp',
  'retryCount',
  'waitDurationMs',
  'idleWaitMs',
] as const;

/**
 * The `elementState` fields an event keeps: NON-CONTENT state only. Every
 * content-bearing field (`value`, `textContent`, `selectedOptions`,
 * `availableOptions`, `innerHTML`, `accessibleName`, `dataset`, `href`, …) is
 * left out — an allowlist, so a field added to `ElementState` later is left out
 * too until it is reviewed here.
 */
export const EVENT_ELEMENT_STATE_FIELDS = [
  'visible',
  'enabled',
  'disabled',
  'ariaDisabled',
  'focused',
  'role',
  'checked',
  'opacityHidden',
  'ariaSelected',
  'ariaPressed',
  'ariaExpanded',
  'ariaChecked',
  'required',
  'inViewport',
  'visibilityReason',
] as const;

function elementStateProjection(state: unknown): Record<string, unknown> | undefined {
  if (!isRecord(state)) return undefined;
  const out: Record<string, unknown> = {};
  for (const key of EVENT_ELEMENT_STATE_FIELDS) {
    if (state[key] !== undefined) out[key] = state[key];
  }
  return out;
}

/** The code a failure with no code of its own is recorded under. */
export const UNCODED_FAILURE = 'UB-ACTION-FAILED';

/** The fixed message an event carries for a failure with code `code`. */
export function failureMessage(code: string): string {
  return `action failed (${code})`;
}

/**
 * An error code as an event may keep it: a code-shaped token, never prose.
 * This is a SHAPE filter, not a known-code check: an app-thrown error's
 * single-token `code` (`TERMINAL_EXITED`) is recorded as it is, and so would
 * be any other identifier-shaped string an app chose to put there.
 */
function codeToken(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)
    ? value
    : undefined;
}

/**
 * The failure's code: the action answer's `failureDetails.errorCode`, else the
 * envelope's (or the answer's) `code`, else {@link UNCODED_FAILURE}.
 */
function failureCodeOf(answer: unknown): string {
  const inner = actionResponseOf(answer);
  for (const candidate of [inner, answer]) {
    if (!isRecord(candidate)) continue;
    const details = candidate.failureDetails;
    const fromDetails = isRecord(details) ? codeToken(details.errorCode) : undefined;
    if (fromDetails) return fromDetails;
  }
  for (const candidate of [answer, inner]) {
    if (!isRecord(candidate)) continue;
    const code = codeToken(candidate.code);
    if (code) return code;
  }
  return UNCODED_FAILURE;
}

/**
 * The part of an action answer an event keeps: the allowlisted fields and,
 * when it failed, `error` and `failureDetails.errorCode` as
 * {@link failureCodeOf} / {@link failureMessage} derive them — never its text.
 */
export function eventResponseOf(
  response: unknown,
  failureCode: string | undefined = isRecord(response) && response.success === false
    ? failureCodeOf(response)
    : undefined
): Record<string, unknown> | undefined {
  if (!isRecord(response)) return undefined;
  const out: Record<string, unknown> = {};
  for (const key of EVENT_RESPONSE_FIELDS) {
    if (response[key] !== undefined) out[key] = response[key];
  }
  const elementState = elementStateProjection(response.elementState);
  if (elementState) out.elementState = elementState;
  if (failureCode !== undefined) {
    const code = failureCode;
    out.error = failureMessage(code);
    out.failureDetails = { errorCode: code };
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
  requestedAction: string,
  run: () => Promise<A>
): Promise<A> {
  const action = recordedVerb(sink, elementId, requestedAction);
  const started: ElementActionStartedData = { elementId, action };
  emitSafely(() => sink.dispatchEvent?.('action:started', started));
  let answer: A;
  try {
    answer = await run();
  } catch (err) {
    // No answer exists; the response is the failure a reader of `response`
    // (the metrics collector) can read like any other. The thrown message is
    // not kept (it may be app-authored or echo a param), only its code.
    const code = failureCodeOf(err);
    const error = failureMessage(code);
    const failed: ElementActionSettledData = {
      elementId,
      action,
      response: {
        success: false,
        error,
        failureDetails: { errorCode: code },
        timestamp: Date.now(),
      },
      error,
    };
    emitSafely(() => sink.dispatchEvent?.('action:failed', failed));
    throw err;
  }
  if (answerFailed(answer)) {
    // One code for the whole answer (the envelope's, when the action answer
    // under it carries none), on the event and its response alike.
    const code = failureCodeOf(answer);
    const failed: ElementActionSettledData = {
      elementId,
      action,
      response: eventResponseOf(actionResponseOf(answer), code),
      error: failureMessage(code),
    };
    emitSafely(() => sink.dispatchEvent?.('action:failed', failed));
  } else {
    const completed: ElementActionSettledData = {
      elementId,
      action,
      response: eventResponseOf(actionResponseOf(answer)),
    };
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
