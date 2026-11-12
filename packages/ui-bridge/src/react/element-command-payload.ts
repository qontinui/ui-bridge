/**
 * The payload grammar of the in-page dispatcher's element commands.
 *
 * `executeCommand` (`./commandHandlers.ts`) is the one dispatcher every
 * transport shares: the relay, the injected runtime's exec mode, the runner's
 * WebSocket route and embedded apps. Its element commands used to read their
 * payload unchecked. `executeElementAction` destructured
 * `const { id, request } = payload`, so a flat payload left `request`
 * undefined and the first `request.fromSnapshotId` read threw
 * `TypeError: Cannot read properties of undefined (reading 'fromSnapshotId')`,
 * while `{elementId, request}` left `id` undefined and answered
 * `Element undefined not found`. Neither answer named the shape it wanted.
 *
 * This module is that grammar. It is pure (no DOM), so each switch case stays a
 * few lines of composition, and it is the one place the rules live:
 *
 *   - `executeElementAction` has ONE grammar with two accepted spellings beside
 *     the canonical one, and refuses every other shape with a message that
 *     names the canonical one:
 *       canonical  {"id":"<elementId>","request":{"action":"<action>", …}}
 *       elementId  "elementId" in place of "id" (the WebSocket protocol's name)
 *       flat       {"id":"<elementId>","action":"<action>", …} — the payload,
 *                  minus "id" / "elementId", IS the request
 *     These are the spellings `relayExecuteWithDiff` already accepts.
 *   - `getElement` takes {"id"} or {"elementId"} under the same id rule.
 *
 * No key BESIDE a `request` object is ever silently dropped: one that is not
 * the element id or a dispatcher key must agree with the same key inside
 * `request`, and one that would otherwise be ignored is refused. So
 * `{"id":"q","request":{"action":"type"},"text":"x"}` is refused instead of
 * typing nothing. The request fields themselves (the keys inside `request`, or
 * every key of a flat payload but the id) are not checked here: they reach the
 * action handler as sent, so a misspelt one (`"txt"` for `"text"`) is not
 * caught by this grammar.
 *
 * Refusals name keys and the KIND of a value, never its content (a string is
 * described by its length alone): a typed value can be a secret. The one
 * exception is a pair of element ids that disagree, which are named: they are
 * registered element ids, and naming both is what makes the conflict
 * diagnosable.
 *
 * A refusal is RETURNED by the caller as an `INVALID_REQUEST` action failure,
 * never thrown (`action-outcome.ts` in ui-bridge-wrapper lifts a returned
 * failure onto the CLI's `error` channel).
 *
 * Plan: 2026-11-08-ui-bridge-inject-exec-mode-is-a-second-class-driver (D2, D3).
 */

/** The canonical `executeElementAction` payload, as a refusal quotes it. */
export const ELEMENT_ACTION_PAYLOAD_SHAPE =
  '{"id":"<elementId>","request":{"action":"<action>", …}}';

/** The canonical payload of a single-element read such as `getElement`. */
export const ELEMENT_READ_PAYLOAD_SHAPE = '{"id":"<elementId>"}';

/**
 * Keys a transport or the dispatcher reads before the command runs (the
 * pre-read settle, the relay's tab pin). Tolerated at the top level of every
 * element command and never treated as a request field. A read that does not
 * settle (`getElement`) tolerates the settle keys and ignores them.
 */
const DISPATCHER_KEYS: ReadonlySet<string> = new Set([
  'settleTimeout',
  'skipSettle',
  'targetTabId',
]);

/**
 * Keys a single-element read tolerates and ignores: the WebSocket protocol's
 * own `getElement` payload carries `includeState?` (`WSGetElementMessage`,
 * `../core/types.ts`), and a read always includes the element's state.
 */
const READ_IGNORED_KEYS: ReadonlySet<string> = new Set(['includeState']);

/** The keys that name the target element. */
const ID_KEYS: ReadonlySet<string> = new Set(['id', 'elementId']);

/** The request half of an element action: the verb and the fields it reads. */
export interface ElementActionRequest {
  action: string;
  value?: string;
  params?: Record<string, unknown>;
  text?: string;
  clear?: boolean;
  fromSnapshotId?: string;
  /** Every other request-root field — the flat `drag` spelling reads several. */
  [field: string]: unknown;
}

/** A normalized `executeElementAction` payload: the canonical `{id, request}`. */
export interface ElementActionCommandPayload {
  id: string;
  request: ElementActionRequest;
}

/** A normalized single-element read payload. */
export interface ElementReadCommandPayload {
  id: string;
}

/** Why a payload was refused, ready to become an `INVALID_REQUEST` failure. */
export interface ElementPayloadRefusal {
  ok: false;
  /** Names every problem found, the canonical shape and the accepted spellings. */
  message: string;
  /** The payload's own top-level keys; empty when it was not an object. */
  receivedKeys: string[];
  /** The element the payload named, or `''` when it named none, or two. */
  elementId: string;
}

export type ElementActionPayloadReading =
  | ({ ok: true } & ElementActionCommandPayload)
  | ElementPayloadRefusal;

export type ElementReadPayloadReading =
  | ({ ok: true } & ElementReadCommandPayload)
  | ElementPayloadRefusal;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * What a value is, for a refusal: its kind, and a string's length — never its
 * content. Whatever a caller put where a key or verb belongs can be a typed
 * value, and a typed value can be a secret.
 */
function describeValue(value: unknown): string {
  if (value === undefined) return 'nothing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'string') {
    if (value.length === 0) return 'an empty string';
    return `a string of ${value.length} character${value.length === 1 ? '' : 's'}`;
  }
  return typeof value === 'object' ? 'an object' : `a ${typeof value}`;
}

/** Structural equality over JSON-shaped values, for the field-agreement rule. */
function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => sameValue(item, b[i]));
  }
  if (!isPlainObject(a) || !isPlainObject(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every(
    (key) => Object.prototype.hasOwnProperty.call(b, key) && sameValue(a[key], b[key])
  );
}

/**
 * The target element, under the id rule both commands share: `id` or
 * `elementId`, each a non-empty string when present, and the two equal when
 * both are present. Problems are appended to `problems`. Two disagreeing ids
 * are the one place a refusal names values (see the module comment).
 */
function readTargetId(payload: Record<string, unknown>, problems: string[]): string {
  const { id, elementId } = payload;
  for (const [key, value] of [
    ['id', id],
    ['elementId', elementId],
  ] as const) {
    if (value !== undefined && !isNonEmptyString(value)) {
      problems.push(`"${key}" must be a non-empty string, got ${describeValue(value)}`);
    }
  }
  if (id === undefined && elementId === undefined) {
    problems.push('names no element: "id" (or "elementId") is missing');
    return '';
  }
  if (isNonEmptyString(id) && isNonEmptyString(elementId) && id !== elementId) {
    problems.push(
      `names two elements: "id" is ${JSON.stringify(id)} but "elementId" is ${JSON.stringify(elementId)}`
    );
    return '';
  }
  if (isNonEmptyString(id)) return id;
  return isNonEmptyString(elementId) ? elementId : '';
}

function refusal(
  command: string,
  problems: readonly string[],
  expected: string,
  receivedKeys: string[],
  elementId: string
): ElementPayloadRefusal {
  return {
    ok: false,
    message: `${command} payload refused: ${problems.join('; ')}. Expected ${expected}.`,
    receivedKeys,
    elementId,
  };
}

const ACTION_SPELLINGS =
  `${ELEMENT_ACTION_PAYLOAD_SHAPE}; also accepted: "elementId" in place of "id", and a flat ` +
  '{"id":"<elementId>","action":"<action>", …} whose request fields sit beside "action" in place of "request"';

const READ_SPELLINGS = `${ELEMENT_READ_PAYLOAD_SHAPE}; also accepted: "elementId" in place of "id"`;

/**
 * Read an `executeElementAction` payload into its canonical `{id, request}`,
 * or refuse it.
 *
 * - When `request` is present it must be an object whose `action` is a
 *   non-empty string, and it IS the request.
 * - Every other top-level key that is not `id` / `elementId` or a dispatcher
 *   key (`settleTimeout`, `skipSettle`, `targetTabId`) must carry the same
 *   value inside `request`: a top-level `action` naming a different action, or
 *   a `value` / `text` / `clear` / `params` / `fromSnapshotId` (or any other
 *   field) present only at the top level or present at both levels with
 *   different values, is refused. An agreeing duplicate is accepted.
 * - When `request` is absent, a non-empty top-level `action` makes the
 *   payload, minus `id` / `elementId`, the request.
 */
export function readElementActionPayload(payload: unknown): ElementActionPayloadReading {
  const command = 'executeElementAction';
  if (!isPlainObject(payload)) {
    return refusal(
      command,
      [`must be a JSON object, got ${describeValue(payload)}`],
      ACTION_SPELLINGS,
      [],
      ''
    );
  }
  const receivedKeys = Object.keys(payload);
  const problems: string[] = [];
  const id = readTargetId(payload, problems);

  if (payload.request !== undefined) {
    const request = payload.request;
    if (!isPlainObject(request)) {
      problems.push(`"request" must be an object, got ${describeValue(request)}`);
    } else {
      if (!isNonEmptyString(request.action)) {
        problems.push(
          `"request.action" must be a non-empty string, got ${describeValue(request.action)}`
        );
      }
      for (const key of receivedKeys) {
        if (key === 'request' || ID_KEYS.has(key) || DISPATCHER_KEYS.has(key)) continue;
        const outer = payload[key];
        if (outer === undefined) continue;
        if (key === 'action') {
          if (!sameValue(outer, request.action)) {
            problems.push('names two actions: the top-level "action" and "request.action" differ');
          }
          continue;
        }
        if (!Object.prototype.hasOwnProperty.call(request, key) || request[key] === undefined) {
          problems.push(
            `"${key}" is at the top level beside "request", where nothing reads it — put it inside "request"`
          );
        } else if (!sameValue(outer, request[key])) {
          problems.push(`"${key}" is at both levels with different values`);
        }
      }
    }
    if (problems.length > 0) return refusal(command, problems, ACTION_SPELLINGS, receivedKeys, id);
    return { ok: true, id, request: request as ElementActionRequest };
  }

  if (!isNonEmptyString(payload.action)) {
    problems.push(
      payload.action === undefined
        ? 'names no action: "request.action" (or a flat top-level "action") is missing'
        : `"action" must be a non-empty string, got ${describeValue(payload.action)}`
    );
  }
  if (problems.length > 0) return refusal(command, problems, ACTION_SPELLINGS, receivedKeys, id);
  // Defined, never assigned: `flat[key] = …` with the key `__proto__` would run
  // the prototype setter and hand the payload's object to the request as its
  // prototype, so every field it holds would read as a request field.
  const flat = Object.fromEntries(
    receivedKeys.filter((key) => !ID_KEYS.has(key)).map((key) => [key, payload[key]])
  );
  return { ok: true, id, request: flat as ElementActionRequest };
}

/**
 * Read a single-element read payload (`getElement`) into `{id}`, or refuse it.
 * `command` names the read in the refusal. Beside the id it tolerates, and
 * ignores, the dispatcher keys (`settleTimeout` / `skipSettle`: the read does
 * not settle; `targetTabId`: the transport's tab pin) and the WebSocket
 * protocol's `includeState` (the state is always included). Any other key is
 * refused, never ignored.
 */
export function readElementIdPayload(command: string, payload: unknown): ElementReadPayloadReading {
  if (!isPlainObject(payload)) {
    return refusal(
      command,
      [`must be a JSON object, got ${describeValue(payload)}`],
      READ_SPELLINGS,
      [],
      ''
    );
  }
  const receivedKeys = Object.keys(payload);
  const problems: string[] = [];
  const id = readTargetId(payload, problems);
  const unread = receivedKeys.filter(
    (key) =>
      !ID_KEYS.has(key) &&
      !DISPATCHER_KEYS.has(key) &&
      !READ_IGNORED_KEYS.has(key) &&
      payload[key] !== undefined
  );
  if (unread.length > 0) {
    problems.push(
      `${unread.map((key) => `"${key}"`).join(', ')} ${unread.length === 1 ? 'is' : 'are'} not read by ${command}`
    );
  }
  if (problems.length > 0) return refusal(command, problems, READ_SPELLINGS, receivedKeys, id);
  return { ok: true, id };
}
