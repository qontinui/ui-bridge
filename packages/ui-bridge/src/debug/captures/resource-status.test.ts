/**
 * resource-status capture — plan
 * 2026-11-23-an-exec-mode-pass-draws-an-unattributed-load-time-429, Phase 3.
 *
 * Driven through `BrowserEventCapture` with only the default config, so the
 * capture being registered default-on is part of what every test pins.
 * jsdom ships no PerformanceObserver and no `performance.getEntriesByType`,
 * so both are faked: the fake observer replays its type's buffer when
 * observed with `buffered: true`, asynchronously, as a browser does.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserEventCapture } from '../browser-capture';
import type {
  AnyCapturedEvent,
  BrowserCaptureConfig,
  ResourceStatusCapturedEvent,
} from '../browser-capture-types';
import { classifyEvent } from '../error-severity';
import { computeFingerprint } from '../error-fingerprint';
import { extractMessage } from '../error-snapshot';
import { computeHealthReport } from '../health-score';
import * as observedReportsModule from '../observed-reports';
import * as resourceStatusModule from './resource-status';

const STORAGE_KEY = 'qontinui-ui-bridge:resource-status:v1';

type Entry = Record<string, unknown>;
type Callback = (list: { getEntries(): PerformanceEntry[] }) => void;

class FakePerformanceObserver {
  static supportedEntryTypes: string[] = ['resource'];
  static live = new Set<FakePerformanceObserver>();
  /** Entries the browser recorded before any observer existed, per type. */
  static buffers: Record<string, Entry[]> = {};
  type: string | null = null;
  /** Recorded but not yet dispatched; `takeRecords` hands these over. */
  pending: Entry[] = [];
  constructor(private readonly callback: Callback) {}
  observe(init: { type: string; buffered?: boolean }): void {
    this.type = init.type;
    FakePerformanceObserver.live.add(this);
    const replay = init.buffered ? [...(FakePerformanceObserver.buffers[init.type] ?? [])] : [];
    if (replay.length > 0) {
      queueMicrotask(() => {
        if (FakePerformanceObserver.live.has(this)) {
          this.callback({ getEntries: () => replay as unknown as PerformanceEntry[] });
        }
      });
    }
  }
  disconnect(): void {
    FakePerformanceObserver.live.delete(this);
  }
  takeRecords(): PerformanceEntry[] {
    return this.pending.splice(0) as unknown as PerformanceEntry[];
  }
  /**
   * Record entries the browser has not dispatched yet: they reach observers
   * on a later microtask unless `takeRecords` takes them first.
   */
  static queue(type: string, entries: Entry[]): void {
    (FakePerformanceObserver.buffers[type] ??= []).push(...entries);
    for (const obs of FakePerformanceObserver.live) {
      if (obs.type !== type) continue;
      obs.pending.push(...entries);
      queueMicrotask(() => {
        const due = obs.pending.splice(0);
        if (due.length > 0 && FakePerformanceObserver.live.has(obs)) {
          obs.callback({ getEntries: () => due as unknown as PerformanceEntry[] });
        }
      });
    }
  }
  /** Record entries now, delivering them to live observers of `type`. */
  static record(type: string, entries: Entry[]): void {
    (FakePerformanceObserver.buffers[type] ??= []).push(...entries);
    for (const obs of FakePerformanceObserver.live) {
      if (obs.type === type)
        obs.callback({ getEntries: () => entries as unknown as PerformanceEntry[] });
    }
  }
}

function resourceEntry(name: string, responseStatus: unknown, initiatorType = 'fetch'): Entry {
  const entry: Entry = {
    name,
    entryType: 'resource',
    initiatorType,
    startTime: 10,
    duration: 5,
    responseEnd: 15,
  };
  if (responseStatus !== undefined) entry.responseStatus = responseStatus;
  return entry;
}

let navigationEntries: Entry[] = [];

/** A fresh "document": empty timing buffers, a new navigation entry list. */
function newDocument(): void {
  FakePerformanceObserver.buffers = {};
  FakePerformanceObserver.live.clear();
  navigationEntries = [];
  // Module state belongs to the document; jsdom keeps one module instance.
  (
    resourceStatusModule as { __resetResourceStatusDocumentForTest?: () => void }
  ).__resetResourceStatusDocumentForTest?.();
  (
    observedReportsModule as { __resetObservedReportsForTest?: () => void }
  ).__resetObservedReportsForTest?.();
}

/** The `status` events (not blind spots) a capture emitted for `url`. */
function statusFor(capture: BrowserEventCapture, url: string): ResourceStatusCapturedEvent[] {
  return statusEvents(capture).filter((e) => e.kind === 'status' && e.resourceUrl === url);
}

/** Every capture but resource-status off, resource-status left at its default. */
const ONLY_DEFAULT_RESOURCE_STATUS: BrowserCaptureConfig = {
  console: false,
  network: false,
  navigation: false,
  longTasks: false,
  longAnimationFrames: false,
  resourceErrors: false,
  wsDisconnections: false,
  hmr: false,
  frameworkOverlays: false,
};

/** resource-status beside the two captures that already report some failures. */
const WITH_NETWORK_AND_RESOURCE_ERRORS: BrowserCaptureConfig = {
  ...ONLY_DEFAULT_RESOURCE_STATUS,
  network: true,
  resourceErrors: true,
};

/** An entry the browser records after install, finishing now. */
function liveEntry(name: string, responseStatus: number, initiatorType = 'fetch'): Entry {
  const now = performance.now();
  return {
    ...resourceEntry(name, responseStatus, initiatorType),
    startTime: now + 1,
    responseEnd: now + 2,
  };
}

function setReferrer(value: string): void {
  Object.defineProperty(document, 'referrer', { configurable: true, get: () => value });
}

const installed: BrowserEventCapture[] = [];

function install(config: BrowserCaptureConfig = ONLY_DEFAULT_RESOURCE_STATUS): BrowserEventCapture {
  const capture = new BrowserEventCapture(config);
  capture.install();
  installed.push(capture);
  return capture;
}

function statusEvents(capture: BrowserEventCapture): ResourceStatusCapturedEvent[] {
  // `getByType` is what the `getBrowserEvents` handler reads.
  return capture
    .getByType('resource-status')
    .filter(
      (e: AnyCapturedEvent): e is ResourceStatusCapturedEvent => e.type === 'resource-status'
    );
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  newDocument();
  FakePerformanceObserver.supportedEntryTypes = ['resource'];
  vi.stubGlobal('PerformanceObserver', FakePerformanceObserver);
  Object.defineProperty(performance, 'getEntriesByType', {
    configurable: true,
    writable: true,
    value: (type: string) =>
      type === 'navigation' ? navigationEntries : (FakePerformanceObserver.buffers[type] ?? []),
  });
  sessionStorage.clear();
});

afterEach(() => {
  for (const c of installed.splice(0)) c.uninstall();
  delete (document as unknown as { referrer?: unknown }).referrer;
  vi.unstubAllGlobals();
  delete (performance as unknown as { getEntriesByType?: unknown }).getEntriesByType;
  sessionStorage.clear();
});

describe('resource-status capture', () => {
  it('(a) emits a 429 recorded before install, from the buffered replay', async () => {
    FakePerformanceObserver.record('resource', [
      resourceEntry('https://app.example.com/api/v1/sessions', 429),
      resourceEntry('https://app.example.com/ok', 200),
    ]);
    const capture = install();
    await settle();

    const events = statusEvents(capture);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'resource-status',
      kind: 'status',
      resourceUrl: 'https://app.example.com/api/v1/sessions',
      hasQuery: false,
      initiatorType: 'fetch',
      responseStatus: 429,
      startTime: 10,
      responseEnd: 15,
    });
    expect(events[0]).not.toHaveProperty('fromPreviousDocument');
  });

  it('(b) emits an /api/ui-bridge/ entry — nothing is ignored by default', async () => {
    const capture = install();
    await settle();
    FakePerformanceObserver.record('resource', [
      resourceEntry('https://app.example.com/api/ui-bridge/relay/poll?token=s3cret', 429),
    ]);

    const events = statusEvents(capture);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'status',
      resourceUrl: 'https://app.example.com/api/ui-bridge/relay/poll',
      hasQuery: true,
      responseStatus: 429,
    });
    expect(JSON.stringify(events)).not.toContain('s3cret');
  });

  it('(c) re-emits the previous document’s 429 once, tagged, after pagehide + re-install', async () => {
    const first = install();
    await settle();
    FakePerformanceObserver.record('resource', [
      resourceEntry('https://app.example.com/api/ui-bridge/x', 429),
    ]);
    window.dispatchEvent(new Event('pagehide'));
    first.uninstall();

    newDocument();
    const second = install();
    await settle();
    const carried = statusEvents(second);
    expect(carried).toHaveLength(1);
    expect(carried[0]).toMatchObject({
      kind: 'status',
      resourceUrl: 'https://app.example.com/api/ui-bridge/x',
      responseStatus: 429,
      fromPreviousDocument: true,
    });
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();

    second.uninstall();
    newDocument();
    const third = install();
    await settle();
    expect(statusEvents(third)).toHaveLength(0);
  });

  it('(d) an undefined responseStatus is emitted as null, never as a success', async () => {
    FakePerformanceObserver.record('resource', [
      resourceEntry('https://cdn.example.com/lib.js', undefined, 'script'),
    ]);
    const capture = install();
    await settle();

    const events = statusEvents(capture);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'status',
      responseStatus: null,
      initiatorType: 'script',
    });
  });

  it('(e) carries at most the last 50 events across a navigation', async () => {
    const first = install();
    await settle();
    FakePerformanceObserver.record(
      'resource',
      Array.from({ length: 60 }, (_, i) => resourceEntry(`https://app.example.com/r/${i}`, 503))
    );
    expect(statusEvents(first)).toHaveLength(60);
    window.dispatchEvent(new Event('pagehide'));
    first.uninstall();

    newDocument();
    const second = install();
    await settle();
    const carried = statusEvents(second);
    expect(carried).toHaveLength(50);
    expect(carried.every((e) => e.fromPreviousDocument === true)).toBe(true);
    expect(carried[0]).toMatchObject({ resourceUrl: 'https://app.example.com/r/10' });
    expect(carried[49]).toMatchObject({ resourceUrl: 'https://app.example.com/r/59' });
  });

  it('(f) a buffer already full at install emits bufferFull: true, once', async () => {
    FakePerformanceObserver.record(
      'resource',
      Array.from({ length: 250 }, (_, i) => resourceEntry(`https://app.example.com/a/${i}`, 200))
    );
    const capture = install();
    await settle();
    let events = statusEvents(capture);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'buffer-full',
      bufferFull: true,
      resourceEntryCount: 250,
    });

    // A buffer that fills AFTER install is no gap: the live observer still
    // receives every entry, so nothing more is emitted.
    FakePerformanceObserver.record('resource', [resourceEntry('https://app.example.com/z', 429)]);
    events = statusEvents(capture);
    expect(events.filter((e) => e.kind === 'buffer-full')).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ kind: 'status', responseStatus: 429 });
  });

  it('one failed fetch seen by network and resource-status counts as one error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 503 }))
    );
    const capture = install(WITH_NETWORK_AND_RESOURCE_ERRORS);
    await settle();
    await window.fetch('https://app.example.com/api/v1/sessions');
    FakePerformanceObserver.record('resource', [
      liveEntry('https://app.example.com/api/v1/sessions', 503),
    ]);
    // Deduplicated at emission: every consumer sees one event for one failure.
    expect(capture.getByType('network')).toHaveLength(1);
    expect(statusFor(capture, 'https://app.example.com/api/v1/sessions')).toHaveLength(0);
    const report = computeHealthReport(capture);
    expect(report.breakdown).toEqual({ crashes: 0, errors: 1, warnings: 0 });
  });

  it('a failure observed before the network report is emitted by both (documented residual)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 503 }))
    );
    const capture = install(WITH_NETWORK_AND_RESOURCE_ERRORS);
    await settle();
    FakePerformanceObserver.record('resource', [
      liveEntry('https://app.example.com/api/v1/early-timing', 503),
    ]);
    await window.fetch('https://app.example.com/api/v1/early-timing');
    expect(capture.getByType('network')).toHaveLength(1);
    expect(statusFor(capture, 'https://app.example.com/api/v1/early-timing')).toHaveLength(1);
  });

  it('a pre-install entry never consumes a report; a stale report matches nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 503 }))
    );
    const url = 'https://app.example.com/api/v1/twice';
    const capture = install(WITH_NETWORK_AND_RESOURCE_ERRORS);
    await settle();
    await window.fetch(url);
    // An entry that finished before install (responseEnd 15) is its own
    // failure, whenever the observer delivers it: emitted, report untouched.
    FakePerformanceObserver.record('resource', [resourceEntry(url, 503)]);
    expect(statusFor(capture, url)).toHaveLength(1);
    // The live one is the network report's: consumed.
    FakePerformanceObserver.record('resource', [liveEntry(url, 503)]);
    expect(statusFor(capture, url)).toHaveLength(1);
    // A report older than 30 s matches nothing.
    await window.fetch(url);
    const later = Date.now() + 31_000;
    const spy = vi.spyOn(Date, 'now').mockReturnValue(later);
    FakePerformanceObserver.record('resource', [liveEntry(url, 503)]);
    spy.mockRestore();
    expect(statusFor(capture, url)).toHaveLength(2);
  });

  it('one failed img seen by resource-errors and resource-status counts once', async () => {
    const capture = install(WITH_NETWORK_AND_RESOURCE_ERRORS);
    await settle();
    const img = document.createElement('img');
    img.src = 'https://app.example.com/missing.png';
    document.body.appendChild(img);
    img.dispatchEvent(new Event('error'));
    img.remove();
    FakePerformanceObserver.record('resource', [
      liveEntry('https://app.example.com/missing.png', 404, 'img'),
    ]);
    expect(capture.getByType('resource-error')).toHaveLength(1);
    expect(statusFor(capture, 'https://app.example.com/missing.png')).toHaveLength(0);
    const { breakdown } = computeHealthReport(capture);
    expect(breakdown.crashes + breakdown.errors + breakdown.warnings).toBe(1);
  });

  it('an img that starts before install and fails after counts once', async () => {
    const capture = install(WITH_NETWORK_AND_RESOURCE_ERRORS);
    await settle();
    const img = document.createElement('img');
    img.src = 'https://app.example.com/slow.png';
    document.body.appendChild(img);
    img.dispatchEvent(new Event('error'));
    img.remove();
    const now = performance.now();
    FakePerformanceObserver.record('resource', [
      {
        ...resourceEntry('https://app.example.com/slow.png', 404, 'img'),
        startTime: 1,
        responseEnd: now,
      },
    ]);
    const { breakdown } = computeHealthReport(capture);
    expect(breakdown.crashes + breakdown.errors + breakdown.warnings).toBe(1);
  });

  it('a relative fetch with a host-bearing ignore pattern counts once', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 503 }))
    );
    const capture = install({
      ...WITH_NETWORK_AND_RESOURCE_ERRORS,
      networkOptions: { ignorePatterns: [`${window.location.host}/api/ui-bridge/`] },
    });
    await settle();
    await window.fetch('/api/v1/relative?x=1');
    FakePerformanceObserver.record('resource', [
      liveEntry(`${window.location.origin}/api/v1/relative?x=1`, 503),
    ]);
    expect(computeHealthReport(capture).breakdown).toEqual({ crashes: 0, errors: 1, warnings: 0 });
  });

  it('a detached Image failure with no resource-error event still counts', async () => {
    const capture = install(WITH_NETWORK_AND_RESOURCE_ERRORS);
    await settle();
    FakePerformanceObserver.record('resource', [
      liveEntry('https://app.example.com/pixel.gif', 404, 'img'),
    ]);
    expect(capture.getByType('resource-error')).toHaveLength(0);
    expect(computeHealthReport(capture).breakdown).toEqual({ crashes: 0, errors: 0, warnings: 1 });
  });

  it('two failures of one URL with one observed report emit one resource-status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 503 }))
    );
    const url = 'https://app.example.com/api/v1/x';
    const capture = install(WITH_NETWORK_AND_RESOURCE_ERRORS);
    await settle();
    await window.fetch(`${url}?q=1`);
    FakePerformanceObserver.record('resource', [liveEntry(url, 503), liveEntry(url, 503)]);
    expect(statusFor(capture, url)).toHaveLength(1);
    // A different status is a different failure.
    await window.fetch(url);
    FakePerformanceObserver.record('resource', [liveEntry(url, 500)]);
    expect(statusFor(capture, url)).toHaveLength(2);
  });

  it('carries only failures and blind spots — never unknown statuses or the cap', async () => {
    const first = install();
    await settle();
    FakePerformanceObserver.record('resource', [
      ...Array.from({ length: 30 }, (_, i) =>
        resourceEntry(`https://cdn.example.com/${i}.png`, 0, 'img')
      ),
      resourceEntry('https://app.example.com/api/v1/x', 429),
    ]);
    window.dispatchEvent(new Event('pagehide'));
    first.uninstall();

    newDocument();
    const second = install();
    await settle();
    const carried = statusEvents(second);
    expect(carried).toHaveLength(1);
    expect(carried[0]).toMatchObject({ responseStatus: 429, fromPreviousDocument: true });
  });

  it('carries an observer-unavailable blind spot', async () => {
    FakePerformanceObserver.supportedEntryTypes = ['longtask'];
    const first = install();
    await settle();
    window.dispatchEvent(new Event('pagehide'));
    first.uninstall();

    newDocument();
    FakePerformanceObserver.supportedEntryTypes = ['resource'];
    const second = install();
    await settle();
    const carried = statusEvents(second);
    expect(carried).toHaveLength(1);
    expect(carried[0]).toMatchObject({ kind: 'observer-unavailable', fromPreviousDocument: true });
  });

  it('drops a carry whose writer is not this document’s referrer', async () => {
    const write = async () => {
      const capture = install();
      await settle();
      FakePerformanceObserver.record('resource', [resourceEntry('https://app.example.com/q', 429)]);
      window.dispatchEvent(new Event('pagehide'));
      capture.uninstall();
      newDocument();
    };

    await write();
    setReferrer('https://elsewhere.example/other?x=1');
    expect(statusEvents(install())).toHaveLength(0);
    await settle();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();

    await write();
    setReferrer(`${window.location.origin}${window.location.pathname}?from=nav#frag`);
    const kept = install();
    await settle();
    expect(statusEvents(kept)).toHaveLength(1);
  });

  it('pageshow from the back/forward cache withdraws the carry it wrote', async () => {
    const capture = install();
    await settle();
    FakePerformanceObserver.record('resource', [resourceEntry('https://app.example.com/q', 429)]);
    window.dispatchEvent(new Event('pagehide'));
    expect(sessionStorage.getItem(STORAGE_KEY)).not.toBeNull();
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    capture.uninstall();
  });

  it('a back/forward-cache round trip carries its events exactly once', async () => {
    const first = install();
    await settle();
    FakePerformanceObserver.record('resource', [resourceEntry('https://app.example.com/q', 429)]);
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    // The restored document took its events back; leaving again carries them once.
    window.dispatchEvent(new Event('pagehide'));
    first.uninstall();

    newDocument();
    const second = install();
    await settle();
    const carried = statusEvents(second);
    expect(carried).toHaveLength(1);
    expect(carried[0]).toMatchObject({ responseStatus: 429, fromPreviousDocument: true });
  });

  it('a restored document leaves the next document’s carry alone', async () => {
    // A: draws a 429, leaves (bfcache), writes its carry.
    const a = install();
    await settle();
    FakePerformanceObserver.record('resource', [resourceEntry('https://app.example.com/a', 429)]);
    window.dispatchEvent(new Event('pagehide'));

    // B: takes A's carry, draws a 503, leaves, writes its own.
    newDocument();
    const b = install();
    await settle();
    expect(statusEvents(b)).toEqual([
      expect.objectContaining({
        resourceUrl: 'https://app.example.com/a',
        fromPreviousDocument: true,
      }),
    ]);
    FakePerformanceObserver.record('resource', [resourceEntry('https://app.example.com/b', 503)]);
    window.dispatchEvent(new Event('pagehide'));
    b.uninstall();
    const bCarry = sessionStorage.getItem(STORAGE_KEY);
    expect(bCarry).toContain('https://app.example.com/b');

    // A is restored from the cache, then leaves again.
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(bCarry);
    window.dispatchEvent(new Event('pagehide'));
    a.uninstall();

    // C: B's carry survives; A's 429 (already delivered to B) does not come again.
    newDocument();
    const c = install();
    await settle();
    const carried = statusEvents(c).map((e) => (e.kind === 'status' ? e.resourceUrl : e.kind));
    expect(carried).toEqual(['https://app.example.com/b']);
  });

  it('pagehide flushes entries the observer has not dispatched yet', async () => {
    const first = install();
    await settle();
    FakePerformanceObserver.queue('resource', [resourceEntry('https://app.example.com/late', 503)]);
    window.dispatchEvent(new Event('pagehide'));
    first.uninstall();

    newDocument();
    const second = install();
    await settle();
    expect(statusEvents(second)).toEqual([
      expect.objectContaining({
        resourceUrl: 'https://app.example.com/late',
        fromPreviousDocument: true,
      }),
    ]);
  });

  it('install → uninstall → install on one document does not replay', async () => {
    FakePerformanceObserver.record('resource', [resourceEntry('https://app.example.com/a', 429)]);
    navigationEntries = [
      {
        ...resourceEntry('https://app.example.com/page', 403, 'navigation'),
        entryType: 'navigation',
      },
    ];
    const capture = new BrowserEventCapture(ONLY_DEFAULT_RESOURCE_STATUS);
    installed.push(capture);
    capture.install();
    await settle();
    expect(statusEvents(capture)).toHaveLength(2);
    capture.uninstall();
    capture.install();
    await settle();
    expect(statusEvents(capture)).toHaveLength(2);
    FakePerformanceObserver.record('resource', [resourceEntry('https://app.example.com/b', 500)]);
    expect(statusEvents(capture)).toHaveLength(3);
  });

  it('redacts the page url: no query or fragment in events or in the carry', async () => {
    const original = window.location.href;
    window.history.replaceState({}, '', '/auth/callback?code=s3cretcode#access_token=s3crettoken');
    try {
      const capture = install();
      await settle();
      FakePerformanceObserver.record('resource', [resourceEntry('https://app.example.com/q', 429)]);
      const [event] = statusEvents(capture);
      expect(event!.url).toBe(`${window.location.origin}/auth/callback`);
      window.dispatchEvent(new Event('pagehide'));
      const stored = sessionStorage.getItem(STORAGE_KEY) ?? '';
      expect(stored).toContain('/auth/callback');
      for (const text of [JSON.stringify(statusEvents(capture)), stored]) {
        expect(text).not.toContain('s3cretcode');
        expect(text).not.toContain('s3crettoken');
      }
    } finally {
      window.history.replaceState({}, '', original);
    }
  });

  it('drops tampered stored entries and keeps the valid one', async () => {
    const valid = {
      type: 'resource-status',
      timestamp: 1,
      url: 'https://app.example.com/',
      kind: 'status',
      resourceUrl: 'https://app.example.com/ok',
      hasQuery: false,
      initiatorType: 'fetch',
      responseStatus: 429,
      startTime: 1,
      responseEnd: 2,
    };
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v: 1,
        writtenAt: Date.now(),
        writtenBy: `${window.location.origin}${window.location.pathname}`,
        events: [
          { ...valid, responseStatus: '429' },
          { ...valid, hasQuery: 'no' },
          { ...valid, startTime: '1' },
          { ...valid, responseEnd: null },
          {
            type: 'resource-status',
            timestamp: 1,
            url: 'x',
            kind: 'buffer-full',
            bufferFull: true,
          },
          { type: 'resource-status', timestamp: 1, url: 'x', kind: 'unknown-status-capped' },
          { type: 'resource-status', timestamp: 1, url: 'x', kind: 'observer-unavailable' },
          { ...valid, kind: 'bogus' },
          {
            type: 'resource-status',
            timestamp: 1,
            url: 'https://app.example.com/',
            kind: 'status',
          },
          { ...valid, initiatorType: 7 },
          {
            ...valid,
            url: 'https://app.example.com/page?code=s3cret#t',
            resourceUrl: 'https://app.example.com/ok?token=s3cret',
            injected: '<script>',
          },
        ],
      })
    );
    const capture = install();
    await settle();
    const carried = statusEvents(capture);
    expect(carried).toHaveLength(1);
    // Rebuilt from known fields only, URLs re-redacted.
    expect(carried[0]).toEqual({
      ...valid,
      url: 'https://app.example.com/page',
      hasQuery: true,
      fromPreviousDocument: true,
    });
    expect(JSON.stringify(carried)).not.toContain('s3cret');
  });

  it('drops a carry stamped in the future', async () => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v: 1,
        writtenAt: Date.now() + 60_000,
        writtenBy: `${window.location.origin}${window.location.pathname}`,
        events: [
          {
            type: 'resource-status',
            timestamp: 1,
            url: 'x',
            kind: 'observer-unavailable',
            observerUnavailable: true,
          },
        ],
      })
    );
    const capture = install();
    await settle();
    expect(statusEvents(capture)).toHaveLength(0);
  });

  it('accepts a carry on a reload of its writer; an origin-only referrer is ambiguous', async () => {
    const carry = (writtenBy: string) =>
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          v: 1,
          writtenAt: Date.now(),
          writtenBy,
          events: [
            {
              type: 'resource-status',
              timestamp: 1,
              url: 'x',
              kind: 'observer-unavailable',
              observerUnavailable: true,
            },
          ],
        })
      );
    const here = `${window.location.origin}${window.location.pathname}`;

    // Reload: the referrer is the original navigation's, not the writer.
    carry(here);
    setReferrer('https://elsewhere.example/start');
    navigationEntries = [
      {
        ...resourceEntry(window.location.href, 200, 'navigation'),
        entryType: 'navigation',
        type: 'reload',
      },
    ];
    expect(statusEvents(install())).toHaveLength(1);

    // An origin-only referrer cannot name the writer: ambiguous, dropped.
    newDocument();
    carry(`${window.location.origin}/some/page`);
    setReferrer(`${window.location.origin}/`);
    expect(statusEvents(install())).toHaveLength(0);

    // An origin-only referrer from another origin did not precede it.
    newDocument();
    carry(`${window.location.origin}/some/page`);
    setReferrer('https://elsewhere.example/');
    expect(statusEvents(install())).toHaveLength(0);
  });

  it('drops a carry written more than 5 minutes ago', async () => {
    const first = install();
    await settle();
    FakePerformanceObserver.record('resource', [resourceEntry('https://app.example.com/q', 429)]);
    window.dispatchEvent(new Event('pagehide'));
    first.uninstall();
    const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY)!) as { writtenAt: number };
    expect(typeof stored.writtenAt).toBe('number');
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...stored, writtenAt: Date.now() - 5 * 60_000 - 1 })
    );

    newDocument();
    const second = install();
    await settle();
    expect(statusEvents(second)).toHaveLength(0);
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('emits observerUnavailable when the webview cannot observe resources', async () => {
    FakePerformanceObserver.supportedEntryTypes = ['longtask'];
    const capture = install();
    await settle();
    const events = statusEvents(capture);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'observer-unavailable', observerUnavailable: true });
  });

  it('reads the navigation entry once: a document that answered 429 is emitted', async () => {
    navigationEntries = [
      {
        name: 'https://app.example.com/sessions?tab=1',
        entryType: 'navigation',
        initiatorType: 'navigation',
        responseStatus: 429,
        startTime: 0,
        duration: 40,
        responseEnd: 30,
      },
    ];
    const capture = install();
    await settle();
    const events = statusEvents(capture);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'status',
      initiatorType: 'navigation',
      resourceUrl: 'https://app.example.com/sessions',
      hasQuery: true,
      responseStatus: 429,
    });
  });

  it('bounds per-document unknown-status events and says so once', async () => {
    const capture = install();
    await settle();
    FakePerformanceObserver.record(
      'resource',
      Array.from({ length: 40 }, (_, i) =>
        resourceEntry(`https://cdn.example.com/${i}.png`, 0, 'img')
      )
    );
    const events = statusEvents(capture);
    const unknown = events.filter((e) => e.kind === 'status');
    const capped = events.filter((e) => e.kind === 'unknown-status-capped');
    expect(unknown.length).toBe(25);
    expect(unknown.every((e) => e.kind === 'status' && e.responseStatus === null)).toBe(true);
    expect(capped).toHaveLength(1);
    // A failing status is still reported after the unknown budget is spent.
    FakePerformanceObserver.record('resource', [resourceEntry('https://app.example.com/z', 429)]);
    expect(statusEvents(capture).at(-1)).toMatchObject({ responseStatus: 429 });
  });

  it('can be switched off', async () => {
    FakePerformanceObserver.record('resource', [resourceEntry('https://app.example.com/a', 429)]);
    const capture = new BrowserEventCapture({
      ...ONLY_DEFAULT_RESOURCE_STATUS,
      resourceStatus: false,
    });
    capture.install();
    installed.push(capture);
    await settle();
    expect(statusEvents(capture)).toHaveLength(0);
  });
});

describe('resource-status classification', () => {
  const base = { type: 'resource-status' as const, timestamp: 1, url: 'https://app.example.com/' };
  const entry = (responseStatus: number | null) => ({
    ...base,
    kind: 'status' as const,
    resourceUrl: 'https://app.example.com/api/v1/x',
    hasQuery: false,
    initiatorType: 'fetch',
    responseStatus,
    startTime: 1,
    responseEnd: 2,
  });

  it('grades by initiator, as the capture that sees the same failure grades it', () => {
    const as = (initiatorType: string, status: number) =>
      classifyEvent({ ...entry(status), initiatorType }).severity;
    // fetch/XHR as classifyNetwork: 4xx warning, 5xx error.
    expect(as('fetch', 429)).toBe('warning');
    expect(as('xmlhttprequest', 404)).toBe('warning');
    expect(as('fetch', 503)).toBe('error');
    // Media as classifyResourceError grades a failed media element: warning.
    for (const media of ['img', 'css', 'video', 'audio']) {
      expect(as(media, 404)).toBe('warning');
      expect(as(media, 503)).toBe('warning');
    }
    // Script and stylesheet as classifyResourceError: error.
    expect(as('script', 404)).toBe('error');
    expect(as('link', 404)).toBe('error');
    // Other request initiators as fetch: 4xx warning, 5xx error.
    for (const request of ['beacon', 'ping', 'other']) {
      expect(as(request, 404)).toBe('warning');
      expect(as(request, 500)).toBe('error');
    }
    // The document itself, and anything else: error.
    expect(as('navigation', 403)).toBe('error');
    expect(as('iframe', 404)).toBe('error');
  });

  it('a request 5xx on a critical endpoint is a crash, as classifyNetwork grades it', () => {
    const critical = { ...entry(503), resourceUrl: 'https://app.example.com/api/v1/auth/login' };
    expect(classifyEvent(critical).severity).toBe('crash');
    expect(classifyEvent({ ...critical, responseStatus: 401 }).severity).toBe('warning');
    expect(classifyEvent({ ...critical, initiatorType: 'img' }).severity).toBe('warning');
  });

  it('matches critical endpoints and common assets on the URL path, not the query', () => {
    const network = (requestUrl: string, status: number) =>
      classifyEvent({
        type: 'network',
        timestamp: 1,
        url: 'x',
        method: 'GET',
        requestUrl,
        status,
        durationMs: 1,
        kind: 'http-error',
      }).severity;
    expect(network('https://app.example.com/search?next=/api/v1/auth/', 503)).toBe('error');
    expect(network('https://app.example.com/api/v1/auth/me', 503)).toBe('crash');
    expect(network('https://app.example.com/api/v1/items?f=a.map', 404)).toBe('warning');
    expect(network('https://app.example.com/app.js.map', 404)).toBe('noise');
    expect(
      classifyEvent({ ...entry(404), resourceUrl: 'https://app.example.com/favicon.ico' }).severity
    ).toBe('noise');
  });

  it('grades a previous document’s event one step down', () => {
    const carried = { fromPreviousDocument: true as const };
    expect(classifyEvent({ ...entry(503), ...carried }).severity).toBe('warning');
    expect(classifyEvent({ ...entry(429), ...carried }).severity).toBe('noise');
    expect(
      classifyEvent({
        ...base,
        ...carried,
        kind: 'buffer-full',
        bufferFull: true,
        resourceEntryCount: 250,
      }).severity
    ).toBe('noise');
  });

  it('grades the unknown-status cap as noise', () => {
    expect(
      classifyEvent({
        ...base,
        kind: 'unknown-status-capped',
        unknownStatusCapped: true,
        budget: 25,
      }).severity
    ).toBe('noise');
  });

  it('classifies an unknown status as noise and a blind spot as warning', () => {
    expect(classifyEvent(entry(null)).severity).toBe('noise');
    expect(
      classifyEvent({ ...base, kind: 'buffer-full', bufferFull: true, resourceEntryCount: 250 })
        .severity
    ).toBe('warning');
  });

  it('fingerprints and describes a status event', () => {
    expect(computeFingerprint(entry(429))).toBe(
      'resource-status:fetch|https://app.example.com/api/v1/x|429'
    );
    expect(extractMessage(entry(429))).toBe('fetch https://app.example.com/api/v1/x → 429');
    expect(extractMessage(entry(null))).toBe(
      'fetch https://app.example.com/api/v1/x → status unknown'
    );
  });
});
