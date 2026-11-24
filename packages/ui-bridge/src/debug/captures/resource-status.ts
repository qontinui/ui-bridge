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
 * `responseStatus` (e.g. WebKit, as reported by MDN browser-compat-data; not
 * verified in this repo) every resource
 * is unknown, and unbounded they would evict every other captured event — and
 * spending the budget is itself one event.
 *
 * What this capture has seen is document state, not install state: an
 * install → uninstall → install on one document does not replay the entries
 * an earlier install already delivered: a watermark (the latest `responseEnd`
 * delivered to an owner, so no per-entry memory grows with the page) hides
 * them from the next install's buffered replay. Uninstalling flushes the
 * observer to the last owner first, so nothing undelivered is watermarked.
 * The watermark ASSUMES entries are added in roughly `responseEnd` order; an
 * entry added late with an early `responseEnd` — an iframe's, recorded at the
 * iframe's load — that lands after an uninstall could fall under it and be
 * skipped by the next install. Events already emitted are not lost to a new
 * owner: they are replayed from a bounded per-document store
 * ({@link EMITTED_REPLAY_LIMIT}). A replay the store can no longer complete
 * names its truncation: the owner first receives a `replay-truncated` event
 * carrying how many earlier events it missed. One capture runs
 * per document, reference-counted by its installs: it stays armed until the
 * last one uninstalls. A framed document (not `window.top`) neither takes nor
 * writes a carry: the carry belongs to the tab's top-level navigation.
 *
 * Install-time events (the carry, the document's own status, `bufferFull`,
 * `observerUnavailable`) are emitted on a macrotask after `install()`, so a
 * host that wires its event callback right after installing — the React
 * provider installs during render and wires it in an effect — receives them.
 *
 * Each `status` event carries a `failureId` (a per-document nonce plus a
 * sequence number) that its carried copy keeps, so a consumer that sees both
 * documents counts distinct `failureId`s.
 *
 * One failure, one event: a live entry whose failure the `network` or
 * `resource-errors` capture already reported (`../observed-reports`) is not
 * emitted. A report matches an entry when it falls in the entry's interval on
 * the Resource Timing clock — from just before `startTime` to shortly after
 * `responseEnd` (`../observed-reports` holds the bounds) — so a fetch whose
 * body arrives long after its headers, or an observer batch delivered late,
 * still matches, and a report never absorbs a request that started after it.
 * This ASSUMES those captures report before the entry is observed — fetch
 * resolves at the response headers, before Resource Timing should record
 * `responseEnd`; an element's `error` event should fire before the observer's
 * asynchronous batch. That order is reasoned from the specs, not measured
 * here. When a sample is observed first anyway, both events are emitted (a
 * known residual).
 * Entries that finished before install, the navigation entry and carried
 * events never consult the reports: no other capture saw them. A suppressed
 * failure is still carried across a navigation — the other capture's report
 * dies with the page — and the next document emits it once, as
 * `fromPreviousDocument`, marked `reportedLiveAs` with the capture that
 * reported it.
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
  ResourceStatusReplayTruncatedEvent,
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

/**
 * The Resource Timing buffer's initial size: the spec
 * (https://w3c.github.io/resource-timing/, "resource timing buffer") recommends
 * 250 or greater.
 */
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

/** One install of the capture: where its events go, and who it is. */
interface Owner {
  emit: Emit;
  /** Identity across installs (the capture instance): a re-install is not replayed to. */
  key: object;
  /** The pending replay of earlier events to this owner. */
  replay: ReturnType<typeof setTimeout> | null;
}

/** How many emitted events a document keeps to replay to a late-joining owner. */
export const EMITTED_REPLAY_LIMIT = 100;

/**
 * What this document has seen, kept at module scope — module state lives and
 * dies with the document — so a re-install does not replay it.
 */
interface DocumentState {
  /** Random per document: the prefix of every `failureId` it mints. */
  nonce: string;
  /** The next `failureId` sequence number on this document. */
  sequence: number;
  /** The installs currently owning the capture; it runs while any remain. */
  owners: Set<Owner>;
  /**
   * The last {@link EMITTED_REPLAY_LIMIT} events emitted on this document, by
   * emission index, replayed to an owner that joins later — a remounted
   * provider's new capture, or a second install while armed.
   */
  emitted: { index: number; event: AnyCapturedEvent }[];
  /** The next emission index. */
  nextIndex: number;
  /** The highest emission index each owner identity (a capture instance) received. */
  deliveredIndex: WeakMap<object, number>;
  /** Stops the running capture; `null` when none runs. */
  teardown: (() => void) | null;
  /** The latest `responseEnd` the running capture delivered to an owner. */
  deliveredUntil: number | null;
  /** `deliveredUntil` at the last uninstall; a re-install skips entries up to it. */
  observedUntil: number | null;
  /** Whether a throwing owner was already logged. */
  warnedOwnerThrew: boolean;
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
    sequence: 0,
    owners: new Set(),
    emitted: [],
    nextIndex: 0,
    deliveredIndex: new WeakMap(),
    teardown: null,
    deliveredUntil: null,
    observedUntil: null,
    warnedOwnerThrew: false,
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
        typeof v.failureId !== 'string' ||
        !(
          v.reportedLiveAs === undefined ||
          v.reportedLiveAs === 'network' ||
          v.reportedLiveAs === 'resource-error'
        )
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
        ...(v.reportedLiveAs === 'network' || v.reportedLiveAs === 'resource-error'
          ? { reportedLiveAs: v.reportedLiveAs }
          : {}),
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
    case 'replay-truncated':
      // One owner's view of its replay, not the document's.
      return false;
  }
}

/**
 * The events of a stored carry that is well-formed and young enough, or
 * `null` when it is not (garbage, whoever it was for).
 */
function carryEvents(parsed: Partial<StoredEvents>): ResourceStatusCapturedEvent[] | null {
  if (parsed.v !== STORAGE_VERSION || !Array.isArray(parsed.events)) return null;
  const age = isFiniteNumber(parsed.writtenAt) ? Date.now() - parsed.writtenAt : NaN;
  if (!(age >= 0 && age <= PREVIOUS_DOCUMENT_MAX_AGE_MS)) return null;
  if (typeof parsed.writtenBy !== 'string') return null;
  return parsed.events
    .map(restoreStoredEvent)
    .filter((e): e is ResourceStatusCapturedEvent => e !== null)
    .slice(-PREVIOUS_DOCUMENT_LIMIT);
}

/** Read the stored carry, or `null` when there is none or storage is unreadable. Never throws. */
function readCarry(storage: Storage): Partial<StoredEvents> | 'garbage' | null {
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as Partial<StoredEvents>;
  } catch {
    return 'garbage';
  }
}

function removeCarry(storage: Storage): void {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Blocked storage: nothing was readable for a later document either.
  }
}

/**
 * Take the previous document's carry: it is removed only once it passes every
 * gate. Garbage (malformed, wrong version, too old) is removed too; a carry
 * that did not precede this document (the referrer gate) is left in place.
 * Never throws.
 */
function takePreviousDocumentEvents(): ResourceStatusCapturedEvent[] {
  const storage = getSessionStorage();
  if (!storage) return [];
  const parsed = readCarry(storage);
  if (parsed === null) return [];
  const events = parsed === 'garbage' ? null : carryEvents(parsed);
  if (events === null) {
    removeCarry(storage);
    return [];
  }
  if (parsed === 'garbage' || !precededThisDocument(parsed.writtenBy as string)) return [];
  removeCarry(storage);
  return events;
}

/** Whether this is the top-level document; a framed one has no carry of its own. */
function isTopLevelDocument(): boolean {
  try {
    return window.top === window;
  } catch {
    return false;
  }
}

/** Hand one event to one owner; an owner that throws is logged once, never rethrown. */
function emitTo(doc: DocumentState, owner: Owner, event: AnyCapturedEvent): void {
  try {
    owner.emit(event);
  } catch (err) {
    if (!doc.warnedOwnerThrew) {
      doc.warnedOwnerThrew = true;
      console.warn(
        '[ui-bridge] resource-status: an event owner threw; others still receive events',
        err
      );
    }
  }
}

/** Deliver one stored event to one owner and record it as delivered. */
function deliver(doc: DocumentState, owner: Owner, index: number, event: AnyCapturedEvent): void {
  emitTo(doc, owner, event);
  doc.deliveredIndex.set(owner.key, index);
}

/**
 * Replay to an owner the stored events its identity has not received. When
 * the store no longer holds the oldest of them, the owner is first told how
 * many were dropped — to it alone: the marker is not stored, carried, or
 * counted as delivered.
 */
function replayTo(doc: DocumentState, owner: Owner): void {
  const seen = doc.deliveredIndex.get(owner.key) ?? -1;
  const firstStored = doc.emitted[0]?.index;
  if (firstStored !== undefined && firstStored > seen + 1) {
    const marker: ResourceStatusReplayTruncatedEvent = {
      type: 'resource-status',
      timestamp: Date.now(),
      url: pageUrl(),
      kind: 'replay-truncated',
      replayTruncated: true,
      droppedCount: firstStored - (seen + 1),
    };
    emitTo(doc, owner, marker);
  }
  for (const { index, event } of doc.emitted) {
    if (index > seen) deliver(doc, owner, index, event);
  }
}

/**
 * Install the capture. One capture runs per document; every install is an
 * owner of it, events go to every current owner, and it stays armed until the
 * last owner uninstalls. An owner that joins later — a remounted provider's
 * new capture, or a second install while armed — is replayed, on the next
 * tick, the document's last {@link EMITTED_REPLAY_LIMIT} events its identity
 * (`ownerKey`, the capture instance) has not received; a re-install of the
 * same instance receives nothing twice. That replay includes failures another
 * capture reported live, tagged `reportedLiveAs` — a consumer that also sees
 * that capture's events dedupes them. When earlier events this identity never
 * received have already left the store, the replay begins with one
 * `replay-truncated` event whose `droppedCount` says how many.
 */
export function installResourceStatusCapture(
  ownerEmit: Emit,
  ownerKey: object = ownerEmit
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }
  const doc = documentState;
  const owner: Owner = { emit: ownerEmit, key: ownerKey, replay: null };
  doc.owners.add(owner);
  owner.replay = setTimeout(() => {
    owner.replay = null;
    replayTo(doc, owner);
  }, 0);
  const release = () => {
    if (!doc.owners.has(owner)) return;
    if (owner.replay !== null) clearTimeout(owner.replay);
    if (doc.owners.size === 1) {
      // The last owner still receives what the teardown flush delivers.
      doc.teardown?.();
      doc.teardown = null;
    }
    doc.owners.delete(owner);
  };
  if (doc.teardown !== null) return release;

  /** Fan out to every owner, and keep the event for owners that join later. */
  // An owner whose replay is still pending gets it now, before anything new:
  // the replay delivers its backlog and this event in index order, so a live
  // event never advances it past an undelivered backlog. A `live: false`
  // event (a failure another capture reported live) goes to no up-to-date
  // owner but is kept for owners that join later.
  const emit = (event: AnyCapturedEvent, live = true) => {
    const index = doc.nextIndex++;
    doc.emitted.push({ index, event });
    if (doc.emitted.length > EMITTED_REPLAY_LIMIT) doc.emitted.shift();
    for (const current of [...doc.owners]) {
      if (current.replay !== null) {
        clearTimeout(current.replay);
        current.replay = null;
        replayTo(doc, current);
      } else if (live) {
        deliver(doc, current, index, event);
      } else {
        doc.deliveredIndex.set(current.key, index);
      }
    }
  };
  const carries = isTopLevelDocument();

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
  /** Consume the report of a live failure another capture already emitted; name that capture. */
  const reportedElsewhere = (
    sample: ResourceSample,
    status: number
  ): ResourceStatusEntryEvent['reportedLiveAs'] => {
    if (installedAt === null || sample.responseEnd < installedAt) return undefined;
    // Matched against this entry's own interval, not against delivery time.
    const interval = { startTime: sample.startTime, responseEnd: sample.responseEnd };
    // The network capture wraps fetch only.
    if (sample.initiatorType === 'fetch') {
      return consumeObservedReport(statusReportKey(sample.name, status), interval)
        ? 'network'
        : undefined;
    }
    if (ELEMENT_INITIATORS.has(sample.initiatorType)) {
      return consumeObservedReport(elementReportKey(sample.name, sample.initiatorType), interval)
        ? 'resource-error'
        : undefined;
    }
    return undefined;
  };

  const onSample = (sample: ResourceSample, isNavigation = false) => {
    const status = sample.responseStatus;
    if (status !== null && status < 400) return;
    if (!isNavigation) {
      if (doc.observedUntil !== null && sample.responseEnd <= doc.observedUntil) return;
      doc.deliveredUntil = Math.max(doc.deliveredUntil ?? sample.responseEnd, sample.responseEnd);
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
      failureId: `${doc.nonce}:${doc.sequence++}`,
    };
    const reportedLiveAs =
      status !== null && !isNavigation ? reportedElsewhere(sample, status) : undefined;
    // Carried either way: the other capture's report dies with this page. The
    // carried copy says which capture reported it, so a consumer that saw
    // that report can exclude it.
    if (reportedLiveAs) {
      const covered = { ...event, reportedLiveAs };
      pushRecent([covered]);
      emit(covered, false);
      return;
    }
    pushRecent([event]);
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

  // Install-time work, deferred so a host wiring its callback right after
  // install() receives it; run early by a pagehide that comes first.
  let deferredPending = true;
  const runDeferred = (hiding = false) => {
    deferredPending = false;
    // 1. The previous same-tab document's failures, re-emitted once per document.
    //    A document hidden before this tick (a fast redirect) also carries
    //    them on, keeping their failureId, so they are not lost with it.
    if (carries && !doc.carryTaken) {
      doc.carryTaken = true;
      for (const previous of takePreviousDocumentEvents()) {
        const carried = { ...previous, fromPreviousDocument: true as const };
        if (hiding) pushRecent([carried]);
        emit(carried);
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
  };
  const deferred = setTimeout(() => runDeferred(), 0);

  // 5. Carry this document's events across a same-tab navigation.
  /** What the last pagehide wrote, so a back/forward-cache restore can take it back. */
  let written: { token: string; events: ResourceStatusCapturedEvent[] } | null = null;
  const onPageHide = () => {
    // Hidden before the deferred tick: its status and the previous carry must
    // still be emitted (and carried), not lost.
    if (deferredPending) {
      clearTimeout(deferred);
      runDeferred(true);
    }
    handle?.flush();
    if (!carries || doc.recent.length === 0) return;
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
  // A document restored from the back/forward cache is the same document.
  // - Its own carry still in storage (no later document took it): it
  //   withdraws the carry and takes the events back, so its next pagehide
  //   carries them once with whatever happened since.
  // - Another page's carry in storage: that page was left for this one, so
  //   this restored document is the next one the user sees — it takes the
  //   carry and emits it, once. (Leaving it for a later document would fail
  //   that document's referrer gate, which names this page, not the writer.)
  // Each carried failure is thereby delivered exactly once.
  const onPageShow = (event: PageTransitionEvent) => {
    if (!carries || !event.persisted) return;
    const mine = written;
    written = null;
    const storage = getSessionStorage();
    if (!storage) return;
    const parsed = readCarry(storage);
    if (parsed === null || parsed === 'garbage') return;
    if (mine !== null && parsed.writerToken === mine.token) {
      removeCarry(storage);
      const since = doc.recent.splice(0);
      pushRecent([...mine.events, ...since]);
      return;
    }
    const foreign = carryEvents(parsed);
    if (foreign === null) return;
    removeCarry(storage);
    for (const previous of foreign) emit({ ...previous, fromPreviousDocument: true });
  };
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);

  doc.teardown = () => {
    clearTimeout(deferred);
    handle?.flush();
    handle?.disconnect();
    doc.observedUntil = doc.deliveredUntil;
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
  };
  return release;
}
