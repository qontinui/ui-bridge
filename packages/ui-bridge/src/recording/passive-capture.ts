/**
 * Passive real-session capture — relays each interaction a HUMAN takes on a
 * connected page to the runner's journey producer (plan
 * `2026-09-20-ui-bridge-represents-the-users-path-and-the-passage-of-time`,
 * Phase 3).
 *
 * The runner side is `POST {runnerUrl}/apps/{appId}/journey/observe`
 * (qontinui-runner `src-tauri/src/journey/observe.rs`). Its body is a CLOSED
 * shape — the runner refuses any other field with a 422:
 *
 *   { actionType, targetElementId?, tabId?, sessionId?, appVersion? }
 *
 * What is on the wire: the action type, identifiers, and the acted-on
 * element's registry id. NOT on the wire: no typed value, no text field, no
 * fingerprint. The element id is the same registry id every snapshot already
 * carries; it MAY be derived from the element's label (auto-registration's
 * `${type}-${slug}` ids, e.g. `button-jane-doe`), so it is not text-free —
 * the runner needs it to resolve the affordance, resolves it to the journey
 * fingerprint and does not store it. The runner takes the closing snapshot of
 * the page itself (pinned by `appId` + `tabId`).
 *
 * Typed values are kept out STRUCTURALLY, twice:
 *
 *   1. The interceptor runs value-blind (`captureValues: false`): it never
 *      reads a field's value off the DOM, so `InteractionEvent.value` is
 *      always `undefined` here.
 *   2. {@link buildObservation} builds the body from a fixed allowlist of
 *      fields; nothing from the event is spread into it.
 *
 * A human's event is one that is `isTrusted` AND fired while the SDK is not
 * acting on the page ({@link isSdkDispatching}): an agent's relayed action
 * dispatches untrusted events, but the browser answers some of them with
 * TRUSTED consequences (`requestSubmit()` → `submit`, a click on a checkbox →
 * `input` + `change`), and those fire inside the SDK's dispatch scope. Two
 * gaps stay open (core/sdk-dispatch.ts): trusted events app code fires
 * LATER in reaction to an agent's action, and input from an EXTERNAL driver —
 * Playwright / CDP (ui-bridge-wrapper's login drivers) or OS-level input —
 * which arrives `isTrusted` and outside any SDK scope, so it is recorded as a
 * human's.
 *
 * It relays only while the runner says it will admit this page
 * ({@link PassiveCaptureAdmission}: the registration answer's
 * `journeyObserve.admitted === true`), and stops for the mount on a 403.
 *
 * RUNNER DEPENDENCY — fail-closed until it lands: no runner build emits
 * `journeyObserve` yet. The field is being added by a qontinui-runner
 * follow-up PR stacked on qontinui-runner#2438 (the observe route). Until a
 * runner carrying it is running, every mount reports `admission_unknown` and
 * relays NOTHING.
 *
 * Every relay outcome is counted ({@link PassiveCaptureStatus}) and readable
 * per live mount through {@link getPassiveCaptureStatuses}; a failed or
 * refused relay never throws into the app. The runner counts what it receives
 * on `GET /journey/health` (`passiveCapture`); what never reached it is
 * visible only here.
 */

import type { UIBridgeRegistry } from '../core/registry';
import { isSdkDispatching } from '../core/sdk-dispatch';
import { InteractionInterceptor } from './interaction-interceptor';
import type { InteractionActionType, InteractionEvent } from './types';

/** The runner's own webview app id — the observe route refuses it (422). */
export const PASSIVE_CAPTURE_RUNNER_APP_ID = 'qontinui-runner';

/** Most relays in flight at once; past it an interaction is dropped and counted. */
export const PASSIVE_CAPTURE_MAX_IN_FLIGHT = 4;

/**
 * How long a relay may wait for the runner's response HEADERS before it is
 * abandoned (counted as failed) and its in-flight slot released.
 */
export const PASSIVE_CAPTURE_RELAY_TIMEOUT_MS = 10_000;

/** How long a refusal's body is read for its reason before giving up on it. */
export const PASSIVE_CAPTURE_BODY_READ_TIMEOUT_MS = 2_000;

/** Longest identifier the observe route stores (`observe.rs` `MAX_ID_LEN`). */
const MAX_ID_LEN = 128;

const IDENTIFIER = /^[A-Za-z0-9._:+-]+$/;

/**
 * Mirrors `observe.rs` `is_identifier`: 1..=128 of `[A-Za-z0-9._:+-]`. The
 * route holds `appId` (path), `tabId`, `sessionId` and `appVersion` to it and
 * refuses the WHOLE relay when one is not, so a non-identifier is caught here
 * rather than turned into a 422 per click.
 */
export function isObserveIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_ID_LEN &&
    IDENTIFIER.test(value)
  );
}

/** The exact request body `POST /apps/{appId}/journey/observe` accepts. */
export interface PassiveObservation {
  actionType: InteractionActionType;
  targetElementId?: string;
  tabId?: string;
  sessionId?: string;
  appVersion?: string;
}

/** The identifiers a relay carries besides the interaction itself. */
export interface PassiveObservationIds {
  tabId?: string;
  sessionId?: string;
  appVersion?: string;
}

/**
 * Build the observe body from a FIXED allowlist: the action type, the target's
 * registry id, and the identifiers. `event.value` and `event.targetElement`
 * are never read — there is no field for them to land in.
 */
export function buildObservation(
  event: Pick<InteractionEvent, 'actionType' | 'targetElementId'>,
  ids: PassiveObservationIds
): PassiveObservation {
  const body: PassiveObservation = { actionType: event.actionType };
  if (event.actionType !== 'navigate') body.targetElementId = event.targetElementId;
  if (ids.tabId !== undefined) body.tabId = ids.tabId;
  if (ids.sessionId !== undefined) body.sessionId = ids.sessionId;
  if (ids.appVersion !== undefined) body.appVersion = ids.appVersion;
  return body;
}

/** The observe route's URL for an app. */
export function observeUrl(runnerUrl: string, appId: string): string {
  return `${runnerUrl.replace(/\/+$/, '')}/apps/${encodeURIComponent(appId)}/journey/observe`;
}

/**
 * Whether the runner will admit this page's relays:
 *
 * - `admitted` — the registration answer carried `journeyObserve.admitted: true`;
 * - `not_admitted` — it carried `false` (the runner will not admit this origin);
 * - `admission_unknown` — the runner accepted the registration but said
 *   nothing (a build predating the field): NOT relayed;
 * - `unregistered` — no accepted registration (runner down, or it refused).
 */
export type PassiveCaptureAdmission =
  | 'admitted'
  | 'not_admitted'
  | 'admission_unknown'
  | 'unregistered';

/**
 * Read the admission from a phone-home registration response body. The runner
 * answers registration in its `ApiResponse` envelope, so the field is read at
 * `data.journeyObserve.admitted`, else at top-level `journeyObserve.admitted`.
 * Only a boolean counts: anything else (absent, malformed) is
 * `admission_unknown`.
 */
export function admissionFromRegistration(body: unknown): PassiveCaptureAdmission {
  const pick = (v: unknown): boolean | undefined => {
    if (!v || typeof v !== 'object') return undefined;
    const jo = (v as Record<string, unknown>).journeyObserve;
    if (!jo || typeof jo !== 'object') return undefined;
    const admitted = (jo as Record<string, unknown>).admitted;
    return typeof admitted === 'boolean' ? admitted : undefined;
  };
  const data =
    body && typeof body === 'object' ? (body as Record<string, unknown>).data : undefined;
  const admitted = pick(data) ?? pick(body);
  if (admitted === true) return 'admitted';
  if (admitted === false) return 'not_admitted';
  return 'admission_unknown';
}

export type PassiveCaptureState =
  /** Listening; each human interaction is relayed while the runner admits it. */
  | 'active'
  /** Stopped (unmount / relay disabled). */
  | 'stopped'
  /** Will not relay for this mount — `disabledReason` says why. */
  | 'disabled';

export interface PassiveCaptureStatus {
  /** Distinguishes concurrent mounts on one page. */
  mountId: number;
  state: PassiveCaptureState;
  /** Why the capture is `disabled` (a fixed phrase, never page content). */
  disabledReason?: string;
  /** The runner's admission as of this read. */
  admission: PassiveCaptureAdmission;
  appId?: string;
  /** The `sessionId` this mount relays (stored by the runner as the edge's `run_id`). */
  sessionId?: string;
  /** Interactions the runner accepted (2xx). */
  relayed: number;
  /** Interactions the runner answered with a non-2xx status. */
  refused: number;
  /** Interactions whose relay never got an answer (network error, CORS refusal, runner down). */
  failed: number;
  /**
   * DOM EVENTS (not interactions — one per keystroke on a field) on a
   * registered element skipped because the browser marked them untrusted.
   */
  skippedSyntheticEvents: number;
  /**
   * DOM EVENTS on a registered element fired while the SDK itself was acting
   * on the page (an agent's action and the browser's trusted consequences).
   */
  suppressedSdkActionEvents: number;
  /** Interactions dropped because the runner had no accepted registration. */
  skippedUnregistered: number;
  /** Interactions dropped because the runner did not (or did not say it would) admit them. */
  skippedNotAdmitted: number;
  /** Interactions dropped because {@link PASSIVE_CAPTURE_MAX_IN_FLIGHT} relays were pending. */
  droppedInFlightCap: number;
  /** The last non-2xx HTTP status the runner answered. */
  lastRefusalStatus?: number;
  /** The runner's refusal phrase (`error` / `code` of its body). */
  lastRefusalReason?: string;
  /** The last transport error message. */
  lastFailure?: string;
  /** Set when a supplied app version / tab id was dropped for not being an identifier. */
  droppedIds?: Array<'appVersion' | 'tabId'>;
}

export interface PassiveCaptureOptions {
  /** The provider's element registry — only registered elements are recorded. */
  registry: UIBridgeRegistry;
  /** The runner base URL (the same one phone-home registration uses). */
  runnerUrl: string;
  /** This app's id in the runner registry (phone-home's `appId`). */
  appId: string;
  /** The relay tab id — the runner pins the closing snapshot to it. */
  tabId?: string;
  /** The app's self-reported version (relayed only when it is an identifier). */
  appVersion?: string;
  /**
   * The runner's current admission of this page (default: `admission_unknown`
   * — nothing is relayed until a caller says the runner admits it).
   */
  admission?: () => PassiveCaptureAdmission;
  /** Which DOM events are a human's, before the SDK-dispatch check (default: `event.isTrusted`). */
  isHumanEvent?: (event: Event) => boolean;
  /** Keystroke coalescing window (default: the interceptor's 100ms). */
  keystrokeCoalesceMs?: number;
  /** `fetch` to relay with (default: the global). */
  fetchImpl?: typeof fetch;
  /** Called once per mount on the first refusal or failure (default: `console.warn`). */
  warn?: (message: string) => void;
}

export interface PassiveCaptureHandle {
  stop(): void;
  status(): PassiveCaptureStatus;
}

interface PassiveCaptureStore {
  nextMountId: number;
  live: Map<number, () => PassiveCaptureStatus>;
}

/** globalThis-backed so every bundle copy (and an HMR reload) shares one view. */
function store(): PassiveCaptureStore {
  const g = globalThis as unknown as { __UI_BRIDGE_PASSIVE_CAPTURE__?: PassiveCaptureStore };
  if (!g.__UI_BRIDGE_PASSIVE_CAPTURE__) {
    g.__UI_BRIDGE_PASSIVE_CAPTURE__ = { nextMountId: 1, live: new Map() };
  }
  return g.__UI_BRIDGE_PASSIVE_CAPTURE__;
}

/**
 * The status of every passive capture mounted on this page and not yet
 * stopped (a disabled mount stays listed, with its reason). Empty when none
 * is mounted. This is where a relay that never reached the runner is visible.
 */
export function getPassiveCaptureStatuses(): PassiveCaptureStatus[] {
  return [...store().live.values()].map((read) => read());
}

/** Test-only: forget every mount. */
export function __clearPassiveCaptureStatusForTest(): void {
  store().live.clear();
}

function newSessionId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  // randomUUID is absent in an insecure context (plain-http LAN host).
  const rand =
    typeof c?.randomUUID === 'function'
      ? c.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `passive-${rand}`;
}

/** `promise`, or `onTimeout` after `ms` — whichever settles first. */
function within<T>(promise: Promise<T>, ms: number, onTimeout: () => T | Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => {
      try {
        resolve(onTimeout());
      } catch (err) {
        reject(err);
      }
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * The refusal phrase of a runner answer — bounded: a runner that sent headers
 * but stalls its body yields no reason after
 * {@link PASSIVE_CAPTURE_BODY_READ_TIMEOUT_MS} rather than a pending read.
 */
async function readRefusalReason(resp: Response): Promise<string | undefined> {
  try {
    const body = (await within(
      resp.json() as Promise<unknown>,
      PASSIVE_CAPTURE_BODY_READ_TIMEOUT_MS,
      () => undefined
    )) as unknown;
    if (body && typeof body === 'object') {
      const b = body as Record<string, unknown>;
      for (const v of [b.error, b.code]) {
        if (typeof v === 'string' && v.length > 0) return v.slice(0, 300);
      }
    }
  } catch {
    /* not JSON — the status alone is the signal */
  }
  return undefined;
}

/**
 * Start relaying human interactions on registered elements to the runner's
 * observe route. Returns a handle whose `stop()` removes every listener; after
 * it nothing more is relayed (a keystroke buffer flushed by the stop is
 * dropped, not sent).
 *
 * Never throws: an `appId` the route cannot accept yields a `disabled` mount
 * that listens to nothing.
 */
export function startPassiveCapture(options: PassiveCaptureOptions): PassiveCaptureHandle {
  const mountId = store().nextMountId++;
  const admission = options.admission ?? ((): PassiveCaptureAdmission => 'admission_unknown');
  const counts = {
    relayed: 0,
    refused: 0,
    failed: 0,
    skippedSyntheticEvents: 0,
    suppressedSdkActionEvents: 0,
    skippedUnregistered: 0,
    skippedNotAdmitted: 0,
    droppedInFlightCap: 0,
  };
  const meta: {
    state: PassiveCaptureState;
    disabledReason?: string;
    sessionId?: string;
    lastRefusalStatus?: number;
    lastRefusalReason?: string;
    lastFailure?: string;
    droppedIds?: Array<'appVersion' | 'tabId'>;
  } = { state: 'active' };

  const readStatus = (): PassiveCaptureStatus => {
    let current: PassiveCaptureAdmission;
    try {
      current = admission();
    } catch {
      current = 'admission_unknown';
    }
    return {
      mountId,
      appId: options.appId,
      admission: current,
      ...meta,
      ...counts,
      droppedIds: meta.droppedIds && [...meta.droppedIds],
    };
  };
  store().live.set(mountId, readStatus);

  let interceptor: InteractionInterceptor | null = null;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    interceptor?.stop();
    if (meta.state === 'active') meta.state = 'stopped';
    store().live.delete(mountId);
  };
  const handle: PassiveCaptureHandle = { stop, status: readStatus };

  const disable = (reason: string) => {
    meta.state = 'disabled';
    meta.disabledReason = reason;
    interceptor?.stop();
  };

  if (!isObserveIdentifier(options.appId)) {
    disable('app id is not an identifier ([A-Za-z0-9._:+-], ≤128)');
    return handle;
  }
  if (options.appId.toLowerCase() === PASSIVE_CAPTURE_RUNNER_APP_ID) {
    disable("the runner does not record its own webview's interactions");
    return handle;
  }
  const fetchImpl = options.fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined);
  if (!fetchImpl) {
    disable('no fetch in this environment');
    return handle;
  }
  if (typeof document === 'undefined') {
    disable('no document in this environment');
    return handle;
  }

  const droppedIds: Array<'appVersion' | 'tabId'> = [];
  const keep = (key: 'appVersion' | 'tabId', v: string | undefined): string | undefined => {
    if (v === undefined || v === '') return undefined;
    if (isObserveIdentifier(v)) return v;
    droppedIds.push(key);
    return undefined;
  };
  const ids: PassiveObservationIds = {
    tabId: keep('tabId', options.tabId),
    appVersion: keep('appVersion', options.appVersion),
    sessionId: newSessionId(),
  };
  meta.sessionId = ids.sessionId;
  if (droppedIds.length > 0) meta.droppedIds = droppedIds;

  const url = observeUrl(options.runnerUrl, options.appId);
  const isHumanEvent = options.isHumanEvent ?? ((e: Event) => e.isTrusted);
  const warn = options.warn ?? ((m: string) => console.warn(m));
  let warned = false;
  const warnOnce = (m: string) => {
    if (warned) return;
    warned = true;
    try {
      warn(m);
    } catch {
      /* a throwing logger must not reach the app */
    }
  };
  let inFlight = 0;

  const relay = (event: InteractionEvent): void => {
    if (stopped || meta.state !== 'active') return;
    let current: PassiveCaptureAdmission;
    try {
      current = admission();
    } catch {
      current = 'admission_unknown';
    }
    if (current === 'unregistered') {
      counts.skippedUnregistered++;
      return;
    }
    if (current !== 'admitted') {
      counts.skippedNotAdmitted++;
      return;
    }
    if (inFlight >= PASSIVE_CAPTURE_MAX_IN_FLIGHT) {
      // A hung runner must not hold the page's keepalive quota, which
      // phone-home's beforeunload deregister needs.
      counts.droppedInFlightCap++;
      return;
    }
    const body = JSON.stringify(buildObservation(event, ids));
    const abort = typeof AbortController === 'function' ? new AbortController() : undefined;
    let sent: Promise<Response>;
    try {
      sent = fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        // A click that navigates the document away must not cancel its relay.
        keepalive: true,
        signal: abort?.signal,
      });
    } catch (err) {
      sent = Promise.reject(err);
    }
    // The slot is held until the response HEADERS arrive (or the relay is
    // abandoned) — never across a body read — so a runner that stalls
    // cannot hold the keepalive quota indefinitely.
    inFlight++;
    let held = true;
    const releaseSlot = () => {
      if (!held) return;
      held = false;
      inFlight--;
    };
    const pending = within(sent, PASSIVE_CAPTURE_RELAY_TIMEOUT_MS, () => {
      abort?.abort();
      throw new Error(`no answer from the runner within ${PASSIVE_CAPTURE_RELAY_TIMEOUT_MS}ms`);
    });
    pending
      .then(
        async (resp) => {
          releaseSlot();
          if (resp.ok) {
            counts.relayed++;
            return;
          }
          counts.refused++;
          meta.lastRefusalStatus = resp.status;
          meta.lastRefusalReason = await readRefusalReason(resp);
          if (resp.status === 403 && !stopped) {
            // The runner will not admit this origin: stop for the mount
            // rather than send a refused relay per click.
            disable(
              `the runner refused journey observe for this page (HTTP 403${
                meta.lastRefusalReason ? `: ${meta.lastRefusalReason}` : ''
              })`
            );
          }
          warnOnce(
            `[ui-bridge] passive capture: the runner refused a relayed interaction for app ` +
              `"${options.appId}" (HTTP ${resp.status}${
                meta.lastRefusalReason ? `: ${meta.lastRefusalReason}` : ''
              }). Counted in getPassiveCaptureStatuses().`
          );
        },
        (err: unknown) => {
          releaseSlot();
          counts.failed++;
          meta.lastFailure = err instanceof Error ? err.message : String(err);
          warnOnce(
            `[ui-bridge] passive capture: a relayed interaction for app "${options.appId}" did ` +
              `not reach the runner (${meta.lastFailure}). Counted in getPassiveCaptureStatuses().`
          );
        }
      )
      .finally(releaseSlot);
  };

  interceptor = new InteractionInterceptor(options.registry, relay, {
    filterUnregistered: true,
    captureValues: false,
    ...(options.keystrokeCoalesceMs !== undefined
      ? { keystrokeCoalesceMs: options.keystrokeCoalesceMs }
      : {}),
    acceptEvent: (e) => {
      if (isSdkDispatching()) {
        counts.suppressedSdkActionEvents++;
        return false;
      }
      let human: boolean;
      try {
        human = isHumanEvent(e);
      } catch {
        human = false;
      }
      if (!human) counts.skippedSyntheticEvents++;
      return human;
    },
  });
  interceptor.start();

  return handle;
}
