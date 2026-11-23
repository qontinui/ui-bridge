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
 *   {@link PREVIOUS_DOCUMENT_LIMIT} events go to `sessionStorage`; the next
 *   document's install re-emits them tagged `fromPreviousDocument: true` and
 *   clears the key, so the failures of the page that triggered a navigation
 *   are not lost with it.
 *
 * Every "could not look" is an event, never silence: an engine with no
 * resource observer emits `observerUnavailable`, a full Resource Timing buffer
 * (the pre-install window may be incomplete) emits `bufferFull`, and a status
 * the browser did not report is `responseStatus: null` (UNKNOWN). Unknown
 * statuses are bounded per document ({@link UNKNOWN_STATUS_BUDGET}) — on an
 * engine without `responseStatus` (WebKit) every resource is unknown, and
 * unbounded they would evict every other captured event — and spending the
 * budget is itself one event.
 *
 * URLs are redacted with `redactRequestUrl`: origin + path and `hasQuery`,
 * never the query.
 */

import type {
  AnyCapturedEvent,
  ResourceStatusCapturedEvent,
  ResourceStatusEntryEvent,
} from '../browser-capture-types';
import { observeResources, toResourceSample, type ResourceSample } from '../../perf';
import { redactRequestUrl } from '../../network/redact-request-url';

type Emit = (event: AnyCapturedEvent) => void;

/** The one `sessionStorage` key the previous document's events travel under. */
const STORAGE_KEY = 'qontinui-ui-bridge:resource-status:v1';
const STORAGE_VERSION = 1;

/** How many of a document's events are carried across its navigation. */
export const PREVIOUS_DOCUMENT_LIMIT = 50;

/** How many `responseStatus: null` events one document reports individually. */
export const UNKNOWN_STATUS_BUDGET = 25;

/** The browser's default Resource Timing buffer size. */
const DEFAULT_RESOURCE_TIMING_BUFFER_SIZE = 250;

interface StoredEvents {
  v: number;
  events: ResourceStatusCapturedEvent[];
}

function pageUrl(): string {
  return window.location.href;
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

function isStoredEvent(value: unknown): value is ResourceStatusCapturedEvent {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { type?: unknown; kind?: unknown; timestamp?: unknown; url?: unknown };
  return (
    v.type === 'resource-status' &&
    typeof v.kind === 'string' &&
    typeof v.timestamp === 'number' &&
    typeof v.url === 'string'
  );
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
    return parsed.events.filter(isStoredEvent).slice(-PREVIOUS_DOCUMENT_LIMIT);
  } catch {
    return [];
  }
}

export function installResourceStatusCapture(emit: Emit): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  /** This document's own events, newest last, bounded for the carry-over. */
  const recent: ResourceStatusCapturedEvent[] = [];
  let unknownEmitted = 0;
  let unknownCapped = false;
  let wroteStorage = false;

  const record = (event: ResourceStatusCapturedEvent) => {
    recent.push(event);
    if (recent.length > PREVIOUS_DOCUMENT_LIMIT) recent.shift();
    emit(event);
  };

  const origin = timeOrigin();
  const onSample = (sample: ResourceSample) => {
    const status = sample.responseStatus;
    if (status !== null && status < 400) return;
    if (status === null) {
      if (unknownCapped) return;
      if (unknownEmitted >= UNKNOWN_STATUS_BUDGET) {
        unknownCapped = true;
        record({
          type: 'resource-status',
          timestamp: Date.now(),
          url: pageUrl(),
          kind: 'unknown-status-capped',
          unknownStatusCapped: true,
          budget: UNKNOWN_STATUS_BUDGET,
        });
        return;
      }
      unknownEmitted++;
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
    };
    record(event);
  };

  const emitBufferFull = (resourceEntryCount: number) => {
    record({
      type: 'resource-status',
      timestamp: Date.now(),
      url: pageUrl(),
      kind: 'buffer-full',
      bufferFull: true,
      resourceEntryCount,
    });
  };

  // 1. The previous same-tab document's failures, re-emitted once.
  for (const previous of takePreviousDocumentEvents()) {
    emit({ ...previous, fromPreviousDocument: true });
  }

  // 2. The document's own status, read once.
  const navigation = getEntries('navigation');
  if (navigation && navigation.length > 0) {
    onSample(toResourceSample(navigation[0]!));
  }

  // 3. Buffer fullness: a full buffer means the buffered replay below may be
  //    missing pre-install entries.
  const preInstall = getEntries('resource');
  if (preInstall && preInstall.length >= DEFAULT_RESOURCE_TIMING_BUFFER_SIZE) {
    emitBufferFull(preInstall.length);
  }
  const onBufferFull = () => {
    emitBufferFull(getEntries('resource')?.length ?? DEFAULT_RESOURCE_TIMING_BUFFER_SIZE);
  };
  const canListenToPerformance =
    typeof performance !== 'undefined' && typeof performance.addEventListener === 'function';
  if (canListenToPerformance) {
    performance.addEventListener('resourcetimingbufferfull', onBufferFull);
  }

  // 4. Every resource, including those recorded before install.
  const handle = observeResources(
    (samples) => {
      for (const sample of samples) onSample(sample);
    },
    { buffered: true }
  );
  if (handle === null) {
    record({
      type: 'resource-status',
      timestamp: Date.now(),
      url: pageUrl(),
      kind: 'observer-unavailable',
      observerUnavailable: true,
    });
  }

  // 5. Carry this document's events across a same-tab navigation.
  const onPageHide = () => {
    handle?.flush();
    if (recent.length === 0) return;
    const storage = getSessionStorage();
    if (!storage) return;
    try {
      const payload: StoredEvents = { v: STORAGE_VERSION, events: recent.slice() };
      storage.setItem(STORAGE_KEY, JSON.stringify(payload));
      wroteStorage = true;
    } catch {
      // Quota or a blocked storage: the carry-over is lost, the live events were emitted.
    }
  };
  // A document restored from the back/forward cache is the same document: the
  // events it wrote on pagehide must not be re-emitted by a later one.
  const onPageShow = (event: PageTransitionEvent) => {
    if (!event.persisted || !wroteStorage) return;
    wroteStorage = false;
    try {
      getSessionStorage()?.removeItem(STORAGE_KEY);
    } catch {
      // Blocked storage: nothing was readable for a later document either.
    }
  };
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);

  return () => {
    handle?.disconnect();
    if (canListenToPerformance) {
      performance.removeEventListener('resourcetimingbufferfull', onBufferFull);
    }
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
  };
}
