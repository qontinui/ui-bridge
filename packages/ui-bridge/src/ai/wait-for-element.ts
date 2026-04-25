/**
 * wait-for-element — element-level state polling.
 *
 * Companion to `waitFor` (whole-page idle / textVisible / value-equals). This
 * polls the **registry** every `pollMs` until an element-state predicate flips
 * true, or `timeoutMs` elapses. Resolves `{ found, durationMs, finalState }` on
 * success, `{ found: false, durationMs, lastObservedState }` on timeout.
 *
 * The HTTP wrapper POSTs to `/ui-bridge/ai/wait-for-element` with a body
 * carrying a `state` discriminator (e.g. `"value-not-empty"`). The runner's
 * Rust handler routes by body shape — when `state` is present, it forwards to
 * the SDK runtime (`wait_for_element_state_predicate`) which evaluates the
 * predicate against the live registry. `found: false` is **NOT** an error —
 * the HTTP status stays 200, predicate result lives in `data.found`.
 *
 * The pure predicate evaluator (`evaluateElementPredicate`) is exported so
 * tests + the SDK runtime handler can share one implementation.
 */

import type { RegisteredElement, ElementState } from '../core/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WaitForElementState =
  | 'present'
  | 'visible'
  | 'enabled'
  | 'disabled'
  | 'value-not-empty'
  | 'value-empty'
  | 'checked'
  | 'unchecked'
  | 'absent';

export const WAIT_FOR_ELEMENT_STATES: readonly WaitForElementState[] = [
  'present',
  'visible',
  'enabled',
  'disabled',
  'value-not-empty',
  'value-empty',
  'checked',
  'unchecked',
  'absent',
] as const;

export interface WaitForElementRequest {
  /** Element registry ID. One of `elementId` / `selector` is required. */
  elementId?: string;
  /** CSS selector to query if `elementId` doesn't resolve. */
  selector?: string;
  /** Predicate to wait for. */
  state: WaitForElementState;
  /** Timeout in ms. Default 5000, max 30000. */
  timeoutMs?: number;
  /** Poll interval in ms. Default 50, min 10. */
  pollMs?: number;
}

export interface WaitForElementFoundResult {
  found: true;
  durationMs: number;
  finalState: SerializedElementState;
}

export interface WaitForElementTimeoutResult {
  found: false;
  durationMs: number;
  /** Last observed element state. `null` if the element was absent the whole time. */
  lastObservedState: SerializedElementState | null;
}

export type WaitForElementResult = WaitForElementFoundResult | WaitForElementTimeoutResult;

/**
 * Trimmed-down element snapshot returned in the response. Mirrors the
 * registry's `RegisteredElement` + `ElementState` shape minus the live DOM
 * reference (which is not serializable).
 */
export interface SerializedElementState {
  id: string;
  type?: string;
  label?: string;
  registered: boolean;
  /** True when an element was found in the registry; false for selector-only DOM matches. */
  fromRegistry: boolean;
  state: Partial<ElementState> | null;
}

export interface WaitForElementOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Predicate evaluator (pure)
// ---------------------------------------------------------------------------

/**
 * Snapshot of what the element looks like at one poll instant — produced by
 * the dispatcher and fed into `evaluateElementPredicate`. Decoupled from
 * `RegisteredElement` so tests and runner code can both feed it without
 * needing a live React tree.
 */
export interface ElementSnapshot {
  /** Whether the registry currently has this element. */
  registered: boolean;
  /** Live element state from `RegisteredElement.getState()`, if available. */
  state: Partial<ElementState> | null;
}

/**
 * Evaluates one of the WaitForElementState predicates against an element
 * snapshot. Pure function — no DOM, no globals, no time. Same logic the
 * runner-side handler uses on each poll tick.
 *
 * Predicate semantics (see M1 spec):
 *   - present:         registered AND has rect
 *   - visible:         registered AND visible AND rect has area
 *   - enabled:         registered AND enabled !== false
 *   - disabled:        registered AND enabled === false
 *   - value-not-empty: registered AND (value is non-empty string OR checked === true)
 *   - value-empty:     registered AND value is empty/missing
 *   - checked:         registered AND checked === true
 *   - unchecked:       registered AND (checked === false OR no checked field)
 *   - absent:          NOT registered OR visible === false
 */
export function evaluateElementPredicate(
  snapshot: ElementSnapshot,
  predicate: WaitForElementState
): boolean {
  const { registered, state } = snapshot;

  switch (predicate) {
    case 'absent': {
      if (!registered) return true;
      if (state && state.visible === false) return true;
      return false;
    }

    case 'present': {
      if (!registered) return false;
      // "has a layout" — any rect at all (zero-size still counts as present).
      return Boolean(state?.rect);
    }

    case 'visible': {
      if (!registered || !state) return false;
      if (state.visible !== true) return false;
      const w = state.rect?.width ?? 0;
      const h = state.rect?.height ?? 0;
      return w > 0 && h > 0;
    }

    case 'enabled': {
      if (!registered || !state) return false;
      return state.enabled !== false;
    }

    case 'disabled': {
      if (!registered || !state) return false;
      return state.enabled === false;
    }

    case 'value-not-empty': {
      if (!registered || !state) return false;
      if (typeof state.value === 'string' && state.value.length > 0) return true;
      if (state.checked === true) return true;
      return false;
    }

    case 'value-empty': {
      if (!registered || !state) return false;
      if (typeof state.value === 'string' && state.value.length > 0) return false;
      // Missing or empty-string value → empty.
      return true;
    }

    case 'checked': {
      if (!registered || !state) return false;
      return state.checked === true;
    }

    case 'unchecked': {
      if (!registered || !state) return false;
      // Per spec: checked === false OR no checked field.
      return state.checked !== true;
    }

    default: {
      // Exhaustiveness — compile error if a state is added without a branch.
      const _exhaustive: never = predicate;
      void _exhaustive;
      return false;
    }
  }
}

/**
 * Validate a request body against the spec. Returns `null` on success, or
 * a human-readable error string on failure. Callers map the error to HTTP
 * 400. Shared by the SDK client and (mirrored in) the runner handler.
 */
export function validateWaitForElementRequest(body: {
  elementId?: unknown;
  selector?: unknown;
  state?: unknown;
  timeoutMs?: unknown;
  pollMs?: unknown;
}): string | null {
  const hasId = typeof body.elementId === 'string' && body.elementId.length > 0;
  const hasSelector = typeof body.selector === 'string' && body.selector.length > 0;
  if (!hasId && !hasSelector) {
    return "wait-for-element: 'elementId' or 'selector' is required";
  }
  if (typeof body.state !== 'string') {
    return "wait-for-element: 'state' is required";
  }
  if (!WAIT_FOR_ELEMENT_STATES.includes(body.state as WaitForElementState)) {
    return `wait-for-element: invalid state '${body.state}', expected one of ${WAIT_FOR_ELEMENT_STATES.join('|')}`;
  }
  if (body.timeoutMs !== undefined) {
    if (typeof body.timeoutMs !== 'number' || !Number.isFinite(body.timeoutMs)) {
      return "wait-for-element: 'timeoutMs' must be a number";
    }
    if (body.timeoutMs < 0 || body.timeoutMs > 30_000) {
      return "wait-for-element: 'timeoutMs' must be between 0 and 30000";
    }
  }
  if (body.pollMs !== undefined) {
    if (typeof body.pollMs !== 'number' || !Number.isFinite(body.pollMs)) {
      return "wait-for-element: 'pollMs' must be a number";
    }
    if (body.pollMs < 10) {
      return "wait-for-element: 'pollMs' must be >= 10";
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// SDK runtime poller — used by useAISearchEvents to drive the wait inside the
// webview. Operates on a callback that produces a fresh snapshot on each tick.
// ---------------------------------------------------------------------------

export interface PollWaitForElementOptions {
  /** Called once per poll tick — must return the current snapshot. */
  takeSnapshot: () => ElementSnapshot;
  predicate: WaitForElementState;
  /** Resolved (clamped) timeout in ms. */
  timeoutMs: number;
  /** Resolved (clamped) poll interval in ms. */
  pollMs: number;
  /** Optional injection point for tests — defaults to `setTimeout`/`Date.now`. */
  now?: () => number;
  schedule?: (cb: () => void, ms: number) => void;
}

export interface PollWaitForElementOutcome {
  found: boolean;
  durationMs: number;
  /**
   * The snapshot at the moment the predicate flipped true (on success), or
   * the most recent registered snapshot before timeout (on failure). Null if
   * the element was never registered.
   */
  observed: ElementSnapshot | null;
}

/**
 * Runs the predicate poll loop. Resolves the moment the predicate is true,
 * or `timeoutMs` after the first attempt. Tolerates the element being absent
 * → present mid-wait by tracking the last registered snapshot in
 * `lastObserved`. Caller is expected to clamp `timeoutMs`/`pollMs` to the
 * spec ranges before invoking.
 */
export function pollWaitForElement(
  options: PollWaitForElementOptions
): Promise<PollWaitForElementOutcome> {
  const {
    takeSnapshot,
    predicate,
    timeoutMs,
    pollMs,
    now = () => Date.now(),
    schedule = (cb, ms) => {
      setTimeout(cb, ms);
    },
  } = options;

  return new Promise((resolve) => {
    const started = now();
    let lastObserved: ElementSnapshot | null = null;
    let done = false;

    const tick = () => {
      if (done) return;
      const snapshot = takeSnapshot();
      if (snapshot.registered || snapshot.state) {
        lastObserved = snapshot;
      }

      if (evaluateElementPredicate(snapshot, predicate)) {
        done = true;
        resolve({
          found: true,
          durationMs: now() - started,
          observed: snapshot,
        });
        return;
      }

      const elapsed = now() - started;
      if (elapsed >= timeoutMs) {
        done = true;
        resolve({
          found: false,
          durationMs: elapsed,
          observed: lastObserved,
        });
        return;
      }
      schedule(tick, pollMs);
    };

    // Synchronous first attempt — short-circuit if the predicate is already
    // satisfied without a poll delay.
    tick();
  });
}

// ---------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------

/**
 * POST /ui-bridge/ai/wait-for-element. Returns the predicate outcome —
 * `found: false` on timeout is **not** thrown; HTTP 4xx/5xx is.
 */
export async function waitForElement(
  request: WaitForElementRequest,
  options: WaitForElementOptions = {}
): Promise<WaitForElementResult> {
  const { baseUrl = '', fetchImpl = fetch, signal } = options;
  const url = `${baseUrl.replace(/\/+$/, '')}/ui-bridge/ai/wait-for-element`;

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `ai/wait-for-element: HTTP ${response.status} ${response.statusText}${text ? ` — ${text}` : ''}`
    );
  }

  const envelope = (await response.json()) as {
    success: boolean;
    data?: WaitForElementResult;
    error?: string;
  };

  if (!envelope.success || !envelope.data) {
    throw new Error(`ai/wait-for-element: ${envelope.error ?? 'request failed'}`);
  }

  return envelope.data;
}

// ---------------------------------------------------------------------------
// Helpers used by the SDK runtime dispatcher to project a RegisteredElement
// into the serialized response shape.
// ---------------------------------------------------------------------------

export function snapshotFromRegisteredElement(
  el: RegisteredElement | null | undefined
): ElementSnapshot {
  if (!el) return { registered: false, state: null };
  let state: Partial<ElementState> | null;
  try {
    state = el.getState() ?? null;
  } catch {
    state = null;
  }
  return { registered: true, state };
}

export function serializeSnapshot(
  el: RegisteredElement | null | undefined,
  snapshot: ElementSnapshot,
  fallbackId: string | undefined
): SerializedElementState {
  return {
    id: el?.id ?? fallbackId ?? '',
    type: el?.type as string | undefined,
    label: el?.label,
    registered: snapshot.registered,
    fromRegistry: snapshot.registered,
    state: snapshot.state,
  };
}
