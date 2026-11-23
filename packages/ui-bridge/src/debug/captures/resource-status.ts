/**
 * Resource Status Capture Sub-module
 *
 * Reports every resource — and the document itself — that answered `>= 400`,
 * read from Resource Timing's `responseStatus`. Three properties set it apart
 * from the `network` capture, which wraps `window.fetch` from install onward:
 *
 * - **Pre-install.** The resource observer is installed with
 *   `buffered: true`, so the browser replays entries recorded before the SDK
 *   mounted, whatever initiated them (fetch, XHR, script, img, …). The
 *   document's own status comes from a one-time read of the `navigation`
 *   entry.
 * - **Nothing ignored.** `network` skips `/api/ui-bridge/*` by default; this
 *   capture filters on status alone, so a relay 429 is visible.
 * - **Survives a same-tab navigation.** On `pagehide` the document's last
 *   {@link PREVIOUS_DOCUMENT_LIMIT} failures (`>= 400`) and blind spots
 *   (`observer-unavailable`, `buffer-full`) go to `sessionStorage`, stamped
 *   with the writing page's origin + path; the next document's install
 *   re-emits them tagged `fromPreviousDocument: true` and clears the key, so
 *   the failures of the page that triggered a navigation are not lost with it.
 *   A carry that cannot have preceded this document (see
 *   {@link precededThisDocument}) is dropped.
 *
 * Every "could not look" is an event, never silence: an engine with no
 * resource observer emits `observerUnavailable`, a Resource Timing buffer at
 * or above the default buffer size (250) at install (the pre-install window
 * may be incomplete; a page that changed its buffer size cannot be judged)
 * emits `bufferFull`, and a status the browser did not report is
 * `responseStatus: null` (UNKNOWN). Unknown statuses are bounded per document
 * ({@link UNKNOWN_STATUS_BUDGET}) — on engines that do not report
 * `responseStatus` (e.g. WebKit, per MDN browser-compat-data) every resource
 * is unknown, and unbounded they would evict every other captured event — and
 * spending the budget is itself one event.
 *
 * What this capture has seen is document state, not install state: an
 * install → uninstall → install on one document does not replay the entries
 * an earlier install already observed: a live observer sees every entry, so
 * an entry that ended before the last uninstall was observed then (a
 * watermark, so no per-entry memory grows with the page). One
 * capture per document is assumed: a second concurrent install is a no-op
 * that warns once.
 *
 * Install-time events (the carry, the document's own status, `bufferFull`,
 * `observerUnavailable`) are emitted on a macrotask after `install()`, so a
 * host that wires its event callback right after installing — the React
 * provider installs during render and wires it in an effect — receives them.
 *
 * Each `status` event carries a `failureId` (a per-document nonce plus the
 * entry's identity) that its carried copy keeps, so a consumer that sees
 * both documents counts distinct `failureId`s.
 *
 * One failure, one event: a live entry whose failure the `network` or
 * `resource-errors` capture already reported (`../observed-reports`) is not
 * emitted. Those captures report first in practice — fetch resolves at the
 * response headers, before Resource Timing records `responseEnd`; an element's
 * `error` event fires before the observer's asynchronous batch. When a sample
 * is observed first anyway, both events are emitted (a known residual).
 * Entries that finished before install, the navigation entry and carried
 * events never consult the reports: no other capture saw them. A suppressed
 * failure is still carried across a navigation — the other capture's report
 * dies with the page — and the next document emits it once, as
 * `fromPreviousDocument`.
 *
 * URLs — the resource's and the page's — are redacted with
 * `redactRequestUrl`: origin + path, never the query or fragment (a page URL
 * routinely carries an OAuth `?code=` or `#access_token=`).
 *
 * A carry older than {@link PREVIOUS_DOCUMENT_MAX_AGE_MS} is dropped: it no
 * longer describes the navigation that led here.
 */

import type {
  AnyCapturedEvent,
  ResourceStatusCapturedEvent,
  ResourceStatusEntryEvent,
} from '../browser-capture-types';
import { observeResources, toResourceSample, type ResourceSample } from '../../perf';
import { redactRequestUrl } from '../../network/redact-request-url';
import { consumeObservedReport, elementReportKey, statusReportKey } from '../observed-reports';

type Emit = (event: AnyCapturedEvent) => void;

/** The one `sessionStorage` key the previous document's events travel under. */
const STORAGE_KEY = 'qontinui-ui-bridge:resource-status:v1';
const STORAGE_VERSION = 1;

/** How many of a document's events are carried across its navigation. */
export const PREVIOUS_DOCUMENT_LIMIT = 50;

/** How many `responseStatus: null` events one document reports individually. */
export const UNKNOWN_STATUS_BUDGET = 25;

/** A previous document's carry older than this is dropped unread. */
export const PREVIOUS_DOCUMENT_MAX_AGE_MS = 5 * 60_000;

/** The Resource Timing spec's recommended initial buffer size (250 or greater). */
const DEFAULT_RESOURCE_TIMING_BUFFER_SIZE = 250;

interface StoredEvents {
  v: number;
  /** `Date.now()` when the previous document wrote the carry. */
  writtenAt: number;
  /** The writing page's origin + path, compared with the next document's referrer. */
  writtenBy: string;
  /** Random per write: lets a restored writer tell its own carry from a later one. */
  writerToken: string;
  events: ResourceStatusCapturedEvent[];
}

/**
 * What this document has seen, kept at module scope — module state lives and
 * dies with the document — so a re-install does not replay it.
 */
interface DocumentState {
  /** Random per document: the prefix of every `failureId` it mints. */
  nonce: string;
  /** Whether a capture is installed on this document (one per document). */
  installed: boolean;
  /** Whether the duplicate-install warning was already logged. */
  warnedDuplicate: boolean;
  /**
   * `performance.now()` at the last uninstall: an entry that ended by then was
   * observed by that install. `null` before any uninstall.
   */
  observedUntil: number | null;
  /** Whether the document's own navigation entry was read. */
  navigationRead: boolean;
  /** The blind-spot and cap events already emitted (at most one of each). */
  blindSpots: Set<string>;
  /** Carry candidates, newest last, bounded by {@link PREVIOUS_DOCUMENT_LIMIT}. */
  recent: ResourceStatusCapturedEvent[];
  unknownEmitted: number;
  unknownCapped: boolean;
  /** Whether the previous document's carry was already taken. */
  carryTaken: boolean;
}

function freshDocumentState(): DocumentState {
  return {
    nonce: randomToken(),
    installed: false,
    warnedDuplicate: false,
    observedUntil: null,
    navigationRead: false,
    blindSpots: new Set(),
    recent: [],
    unknownEmitted: 0,
    unknownCapped: false,
    carryTaken: false,
  };
}

let documentState = freshDocumentState();

/** Test-only: simulate a new document (module state survives jsdom "navigations"). */
export function __resetResourceStatusDocumentForTest(): void {
  documentState = freshDocumentState();
}

/** The page URL, redacted: origin + path only. */
function pageUrl(): string {
  return redactRequestUrl(window.location.href).url;
}

function timeOrigin(): number | null {
  try {
    const origin = performance.timeOrigin;
    return typeof origin === 'number' && Number.isFinite(origin) ? origin : null;
  } catch {
    return null;
  }
}

function getEntries(type: string): PerformanceEntry[] | null {
  try {
    if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') {
      return null;
    }
    return performance.getEntriesByType(type);
  } catch {
    return null;
  }
}

function getSessionStorage(): Storage | null {
  try {
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function randomToken(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

/** One Resource Timing entry's identity within a document; the URL is redacted. */
function entryKey(sample: ResourceSample): string {
  return `${sample.initiatorType}|${sample.startTime}|${redactRequestUrl(sample.name).url}`;
}

/** Initiators whose failure the network capture reports with a status. */
const REQUEST_INITIATORS = new Set(['fetch', 'xmlhttprequest', 'beacon', 'ping', 'other']);
/** Initiators whose failure the resource-errors capture reports as an element error. */
const ELEMENT_INITIATORS = new Set(['img', 'script', 'link', 'css']);

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Rebuild a stored event from the fields its kind defines, re-redacting its
 * URLs; `null` when a field is missing or mistyped. Nothing else stored is
 * carried through.
 */
function restoreStoredEvent(value: unknown): ResourceStatusCapturedEvent | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.type !== 'resource-status' || !isFiniteNumber(v.timestamp) || typeof v.url !== 'string') {
    return null;
  }
  const base = {
    type: 'resource-status' as const,
    timestamp: v.timestamp,
    url: redactRequestUrl(v.url).url,
  };
  switch (v.kind) {
    case 'status': {
      if (
        typeof v.resourceUrl !== 'string' ||
        typeof v.hasQuery !== 'boolean' ||
        typeof v.initiatorType !== 'string' ||
        !(v.responseStatus === null || isFiniteNumber(v.responseStatus)) ||
        !isFiniteNumber(v.startTime) ||
        !isFiniteNumber(v.responseEnd) ||
        typeof v.failureId !== 'string'
      ) {
        return null;
      }
      const { url, hasQuery } = redactRequestUrl(v.resourceUrl);
      return {
        ...base,
        kind: 'status',
        resourceUrl: url,
        hasQuery: v.hasQuery || hasQuery,
        initiatorType: v.initiatorType,
        responseStatus: v.responseStatus,
        startTime: v.startTime,
        responseEnd: v.responseEnd,
        failureId: v.failureId,
      };
    }
    case 'observer-unavailable':
      return v.observerUnavailable === true
        ? { ...base, kind: 'observer-unavailable', observerUnavailable: true }
        : null;
    case 'buffer-full':
      return v.bufferFull === true && isFiniteNumber(v.resourceEntryCount)
        ? {
            ...base,
            kind: 'buffer-full',
            bufferFull: true,
            resourceEntryCount: v.resourceEntryCount,
          }
        : null;
    case 'unknown-status-capped':
      return v.unknownStatusCapped === true && isFiniteNumber(v.budget)
        ? { ...base, kind: 'unknown-status-capped', unknownStatusCapped: true, budget: v.budget }
        : null;
    default:
      return null;
  }
}

/**
 * Whether the page that wrote a carry can have led to this document:
 * - an empty referrer (a `no-referrer` policy, a typed URL) cannot rule it out;
 * - a referrer naming the writer's page (origin + path) is the writer;
 * - a reload of the writer's own page (its referrer is the original one's).
 * Any other referrer — including an origin-only one, which cannot name the
 * writer — drops the carry. A known gap: a back/forward navigation that misses
 * the back/forward cache loads a new document whose referrer is the original
 * one's, so a carry written by the page it came back from cannot be
 * attributed and is dropped.
 */
function precededThisDocument(writtenBy: string): boolean {
  let referrer: string;
  try {
    referrer = document.referrer;
  } catch {
    return true;
  }
  if (!referrer) return true;
  if (redactRequestUrl(referrer).url === writtenBy) return true;
  const navigation = getEntries('navigation')?.[0] as
    | (PerformanceEntry & { type?: unknown })
    | undefined;
  return navigation?.type === 'reload' && writtenBy === pageUrl();
}

/** Whether an event belongs in the carry: a failure or a blind spot, never an unknown. */
function isCarried(event: ResourceStatusCapturedEvent): boolean {
  switch (event.kind) {
    case 'status':
      return event.responseStatus !== null && event.responseStatus >= 400;
    case 'observer-unavailable':
    case 'buffer-full':
      return true;
    case 'unknown-status-capped':
      return false;
  }
}

/** Read and clear the previous document's events. Never throws. */
function takePreviousDocumentEvents(): ResourceStatusCapturedEvent[] {
  const storage = getSessionStorage();
  if (!storage) return [];
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
    storage.removeItem(STORAGE_KEY);
  } catch {
    return [];
  }
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw) as Partial<StoredEvents>;
    if (parsed.v !== STORAGE_VERSION || !Array.isArray(parsed.events)) return [];
    const age = isFiniteNumber(parsed.writtenAt) ? Date.now() - parsed.writtenAt : NaN;
    if (!(age >= 0 && age <= PREVIOUS_DOCUMENT_MAX_AGE_MS)) return [];
    if (typeof parsed.writtenBy !== 'string' || !precededThisDocument(parsed.writtenBy)) return [];
    return parsed.events
      .map(restoreStoredEvent)
      .filter((e): e is ResourceStatusCapturedEvent => e !== null)
      .slice(-PREVIOUS_DOCUMENT_LIMIT);
  } catch {
    return [];
  }
}

export function installResourceStatusCapture(emit: Emit): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }
  const doc = documentState;
  if (doc.installed) {
    if (!doc.warnedDuplicate) {
      doc.warnedDuplicate = true;
      console.warn(
        '[ui-bridge] resource-status capture is already installed on this document; ' +
          'a second concurrent install is a no-op (one capture per document).'
      );
    }
    return () => {};
  }
  doc.installed = true;

  const pushRecent = (events: ResourceStatusCapturedEvent[]) => {
    doc.recent.push(...events.filter(isCarried));
    if (doc.recent.length > PREVIOUS_DOCUMENT_LIMIT) {
      doc.recent.splice(0, doc.recent.length - PREVIOUS_DOCUMENT_LIMIT);
    }
  };

  /** Emit a blind-spot or cap event once per document. */
  const recordOnce = (key: string, event: ResourceStatusCapturedEvent) => {
    if (doc.blindSpots.has(key)) return;
    doc.blindSpots.add(key);
    pushRecent([event]);
    emit(event);
  };

  const origin = timeOrigin();
  // An entry that finished at or after this point may have been reported by
  // the network or resource-errors capture, installed in the same pass.
  const installedAt = typeof performance !== 'undefined' ? performance.now() : null;
  /** Consume the report of a live failure another capture already emitted. */
  const reportedElsewhere = (sample: ResourceSample, status: number): boolean => {
    if (installedAt === null || sample.responseEnd < installedAt) return false;
    const now = Date.now();
    if (REQUEST_INITIATORS.has(sample.initiatorType)) {
      return consumeObservedReport(statusReportKey(sample.name, status), now);
    }
    if (ELEMENT_INITIATORS.has(sample.initiatorType)) {
      return consumeObservedReport(elementReportKey(sample.name, sample.initiatorType), now);
    }
    return false;
  };

  const onSample = (sample: ResourceSample, isNavigation = false) => {
    const status = sample.responseStatus;
    if (status !== null && status < 400) return;
    if (!isNavigation && doc.observedUntil !== null && sample.responseEnd <= doc.observedUntil) {
      return;
    }
    if (status === null) {
      if (doc.unknownCapped) return;
      if (doc.unknownEmitted >= UNKNOWN_STATUS_BUDGET) {
        doc.unknownCapped = true;
        recordOnce('unknown-status-capped', {
          type: 'resource-status',
          timestamp: Date.now(),
          url: pageUrl(),
          kind: 'unknown-status-capped',
          unknownStatusCapped: true,
          budget: UNKNOWN_STATUS_BUDGET,
        });
        return;
      }
      doc.unknownEmitted++;
    }
    const { url, hasQuery } = redactRequestUrl(sample.name);
    const event: ResourceStatusEntryEvent = {
      type: 'resource-status',
      timestamp: origin !== null ? Math.round(origin + sample.responseEnd) : Date.now(),
      url: pageUrl(),
      kind: 'status',
      resourceUrl: url,
      hasQuery,
      initiatorType: sample.initiatorType,
      responseStatus: status,
      startTime: sample.startTime,
      responseEnd: sample.responseEnd,
      failureId: `${doc.nonce}:${entryKey(sample)}`,
    };
    // Carried either way: the other capture's report dies with this page.
    pushRecent([event]);
    if (status !== null && !isNavigation && reportedElsewhere(sample, status)) return;
    emit(event);
  };

  // Read at install, emitted on a macrotask (see the module doc).
  const resourceCountAtInstall = getEntries('resource')?.length ?? null;

  // 4. Every resource, including those recorded before install.
  const handle = observeResources(
    (samples) => {
      for (const sample of samples) onSample(sample);
    },
    { buffered: true }
  );

  const deferred = setTimeout(() => {
    // 1. The previous same-tab document's failures, re-emitted once per document.
    if (!doc.carryTaken) {
      doc.carryTaken = true;
      for (const previous of takePreviousDocumentEvents()) {
        emit({ ...previous, fromPreviousDocument: true });
      }
    }

    // 2. The document's own status, read once.
    const navigation = getEntries('navigation');
    if (!doc.navigationRead && navigation && navigation.length > 0) {
      doc.navigationRead = true;
      onSample(toResourceSample(navigation[0]!), true);
    }

    // 3. Buffer fullness at install: at or above the default size, the
    //    buffered replay may be missing pre-install entries (a page that
    //    changed its buffer size cannot be judged). A buffer that fills later
    //    is no gap — the live observer receives every entry regardless.
    if (
      resourceCountAtInstall !== null &&
      resourceCountAtInstall >= DEFAULT_RESOURCE_TIMING_BUFFER_SIZE
    ) {
      recordOnce('buffer-full', {
        type: 'resource-status',
        timestamp: Date.now(),
        url: pageUrl(),
        kind: 'buffer-full',
        bufferFull: true,
        resourceEntryCount: resourceCountAtInstall,
      });
    }

    if (handle === null) {
      recordOnce('observer-unavailable', {
        type: 'resource-status',
        timestamp: Date.now(),
        url: pageUrl(),
        kind: 'observer-unavailable',
        observerUnavailable: true,
      });
    }
  }, 0);

  // 5. Carry this document's events across a same-tab navigation.
  /** What the last pagehide wrote, so a back/forward-cache restore can take it back. */
  let written: { token: string; events: ResourceStatusCapturedEvent[] } | null = null;
  const onPageHide = () => {
    handle?.flush();
    if (doc.recent.length === 0) return;
    const storage = getSessionStorage();
    if (!storage) return;
    try {
      const payload: StoredEvents = {
        v: STORAGE_VERSION,
        writtenAt: Date.now(),
        writtenBy: pageUrl(),
        writerToken: randomToken(),
        events: doc.recent.slice(),
      };
      storage.setItem(STORAGE_KEY, JSON.stringify(payload));
      // Carried once: the events now live in storage, not here.
      written = { token: payload.writerToken, events: doc.recent.splice(0) };
    } catch {
      // Quota or a blocked storage: the carry-over is lost, the live events were emitted.
    }
  };
  // A document restored from the back/forward cache is the same document. If
  // its carry is still in storage — no later document took it — it withdraws
  // the carry and takes the events back, so its next pagehide carries them
  // once with whatever happened since. If a later document took it (and may
  // have written its own carry since), those events were delivered: storage
  // is left alone and nothing is taken back.
  const onPageShow = (event: PageTransitionEvent) => {
    if (!event.persisted || written === null) return;
    const mine = written;
    written = null;
    const storage = getSessionStorage();
    try {
      const raw = storage?.getItem(STORAGE_KEY) ?? null;
      const stored = raw === null ? null : (JSON.parse(raw) as Partial<StoredEvents>);
      if (stored?.writerToken !== mine.token) return;
      storage?.removeItem(STORAGE_KEY);
    } catch {
      // Unreadable or blocked storage: ownership is unknown, so nothing is taken back.
      return;
    }
    const since = doc.recent.splice(0);
    pushRecent([...mine.events, ...since]);
  };
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);

  return () => {
    clearTimeout(deferred);
    doc.installed = false;
    handle?.flush();
    handle?.disconnect();
    if (typeof performance !== 'undefined') doc.observedUntil = performance.now();
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
  };
}
