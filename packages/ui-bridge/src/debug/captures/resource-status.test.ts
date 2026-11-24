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
import { ErrorImpactAssessor } from '../error-impact';
import { BrowserEventStream } from '../ws-streaming';
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
    // The buffered replay is pending like any undispatched entry: it reaches
    // the callback on a later microtask unless takeRecords takes it first.
    const replay = init.buffered ? [...(FakePerformanceObserver.buffers[init.type] ?? [])] : [];
    if (replay.length > 0) {
      this.pending.push(...replay);
      queueMicrotask(() => {
        const due = this.pending.splice(0);
        if (due.length > 0 && FakePerformanceObserver.live.has(this)) {
          this.callback({ getEntries: () => due as unknown as PerformanceEntry[] });
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

/** The `status` events (not blind spots) a capture emitted. */
function statusOnly(capture: BrowserEventCapture): ResourceStatusCapturedEvent[] {
  return statusEvents(capture).filter((e) => e.kind === 'status');
}

/** The `status` events (not blind spots) a capture emitted for `url`. */
function statusFor(capture: BrowserEventCapture, url: string): ResourceStatusCapturedEvent[] {
  return statusEvents(capture).filter((e) => e.kind === 'status' && e.resourceUrl === url);
}

/** The `replay-truncated` markers a capture received. */
function replayTruncated(capture: BrowserEventCapture): ResourceStatusCapturedEvent[] {
  return statusEvents(capture).filter((e) => e.kind === 'replay-truncated');
}

/** Record `count` live failures, each with its own URL (`/f/<i>`). */
function recordFailures(count: number, prefix = 'f'): void {
  FakePerformanceObserver.record(
    'resource',
    Array.from({ length: count }, (_, i) =>
      liveEntry(`https://app.example.com/${prefix}/${i}`, 503)
    )
  );
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

/** An entry the browser records after install: it started just before now and finishes now. */
function liveEntry(name: string, responseStatus: number, initiatorType = 'fetch'): Entry {
  const now = performance.now();
  return {
    ...resourceEntry(name, responseStatus, initiatorType),
    startTime: now - 2,
    responseEnd: now,
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

/** Let the buffered replay (microtasks) and the deferred install-time emits (a macrotask) run. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
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

  it('a fetch 429 the network capture reported still reaches the next document, once', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 429 }))
    );
    const url = 'https://app.example.com/api/ui-bridge/relay/poll';
    const first = install({
      ...WITH_NETWORK_AND_RESOURCE_ERRORS,
      networkOptions: { ignorePatterns: [] },
    });
    await settle();
    await window.fetch(url);
    FakePerformanceObserver.record('resource', [liveEntry(url, 429)]);
    // Live: one event for one failure (the network capture's).
    expect(first.getByType('network')).toHaveLength(1);
    expect(statusFor(first, url)).toHaveLength(0);
    window.dispatchEvent(new Event('pagehide'));
    first.uninstall();

    // The network buffer died with the page; the carry did not.
    newDocument();
    const second = install(WITH_NETWORK_AND_RESOURCE_ERRORS);
    await settle();
    const carried = statusFor(second, url);
    expect(carried).toHaveLength(1);
    expect(carried[0]).toMatchObject({ responseStatus: 429, fromPreviousDocument: true });
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

  it('a pre-install entry never consumes a report; a report never absorbs a later request', async () => {
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
    // A report recorded before a later request started is not that request's:
    // the later entry is emitted, and the leftover report stays unconsumed.
    await window.fetch(url);
    const reportedBy = performance.now();
    FakePerformanceObserver.record('resource', [
      {
        ...resourceEntry(url, 503),
        startTime: reportedBy + 1_000,
        responseEnd: reportedBy + 1_010,
      },
    ]);
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

  it('a fetch whose body ends more than 5 s after its headers counts once', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 503 }))
    );
    const url = 'https://app.example.com/api/v1/slow-body';
    const capture = install(WITH_NETWORK_AND_RESOURCE_ERRORS);
    await settle();
    const t = performance.now();
    await window.fetch(url);
    // The entry is recorded at responseEnd, 6 s after the headers the network
    // capture reported at; the observer delivers it then.
    const spy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 6_000);
    FakePerformanceObserver.record('resource', [
      { ...resourceEntry(url, 503), startTime: t, responseEnd: t + 6_000 },
    ]);
    spy.mockRestore();
    expect(capture.getByType('network')).toHaveLength(1);
    expect(statusFor(capture, url)).toHaveLength(0);
  });

  it('an img error reported just after responseEnd, delivered in a late batch, counts once', async () => {
    const capture = install(WITH_NETWORK_AND_RESOURCE_ERRORS);
    await settle();
    // The error fires 10 s after install, so the entry finished after install.
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 10_000);
    const src = 'https://app.example.com/late-batch.png';
    const img = document.createElement('img');
    img.src = src;
    document.body.appendChild(img);
    img.dispatchEvent(new Event('error'));
    img.remove();
    const errorAt = performance.now();
    nowSpy.mockRestore();
    // An element's error fires after responseEnd; the observer batch arrives 6 s later.
    const spy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 6_000);
    FakePerformanceObserver.record('resource', [
      {
        ...resourceEntry(src, 404, 'img'),
        startTime: errorAt - 2_000,
        responseEnd: errorAt - 1_000,
      },
    ]);
    spy.mockRestore();
    expect(capture.getByType('resource-error')).toHaveLength(1);
    expect(statusFor(capture, src)).toHaveLength(0);
  });

  it('install-time events reach an onEvent set synchronously after install()', async () => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v: 1,
        writtenAt: Date.now(),
        writtenBy: `${window.location.origin}${window.location.pathname}`,
        writerToken: 't',
        events: [
          {
            type: 'resource-status',
            timestamp: 1,
            url: 'x',
            kind: 'buffer-full',
            bufferFull: true,
            resourceEntryCount: 250,
          },
        ],
      })
    );
    navigationEntries = [
      { ...resourceEntry(window.location.href, 429, 'navigation'), entryType: 'navigation' },
    ];
    FakePerformanceObserver.supportedEntryTypes = ['longtask'];
    const capture = new BrowserEventCapture(ONLY_DEFAULT_RESOURCE_STATUS);
    installed.push(capture);
    const seen: AnyCapturedEvent[] = [];
    // The provider's order: install during render, wire the callback in an effect.
    capture.install();
    capture.setOnEvent((e) => seen.push(e));
    await settle();
    const kinds = seen.map((e) => (e.type === 'resource-status' ? e.kind : e.type));
    expect(kinds.sort()).toEqual(['buffer-full', 'observer-unavailable', 'status']);
  });

  it('two same-path requests in one tick get distinct failureIds', async () => {
    const capture = install();
    await settle();
    const now = performance.now();
    const sameTick = (url: string) => ({
      ...resourceEntry(url, 503),
      startTime: now - 2,
      responseEnd: now,
    });
    FakePerformanceObserver.record('resource', [
      sameTick('https://app.example.com/api/v1/same?a=1'),
      sameTick('https://app.example.com/api/v1/same?a=2'),
    ]);
    const ids = statusEvents(capture).map((e) => (e.kind === 'status' ? e.failureId : ''));
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('a failure keeps one failureId across the navigation that carries it', async () => {
    const first = install();
    await settle();
    FakePerformanceObserver.record('resource', [
      resourceEntry('https://app.example.com/api/v1/a?t=1', 429),
      { ...resourceEntry('https://app.example.com/api/v1/a?t=2', 429), startTime: 11 },
    ]);
    const live = statusEvents(first);
    expect(live).toHaveLength(2);
    const ids = live.map((e) => (e.kind === 'status' ? e.failureId : ''));
    expect(new Set(ids).size).toBe(2);
    expect(ids.every((id) => !id.includes('t=1') && !id.includes('t=2'))).toBe(true);
    window.dispatchEvent(new Event('pagehide'));
    first.uninstall();

    newDocument();
    const second = install();
    await settle();
    const carried = statusEvents(second).map((e) => (e.kind === 'status' ? e.failureId : ''));
    expect(carried).toEqual(ids);
  });

  it('a re-install replays none of a page’s many failures (no per-entry memory)', async () => {
    const entries = Array.from({ length: 501 }, (_, i) =>
      resourceEntry(`https://app.example.com/r/${i}`, 503)
    );
    FakePerformanceObserver.record('resource', entries);
    const capture = new BrowserEventCapture({ ...ONLY_DEFAULT_RESOURCE_STATUS, maxEntries: 2000 });
    installed.push(capture);
    capture.install();
    await settle();
    expect(statusOnly(capture)).toHaveLength(501);
    capture.uninstall();
    capture.install();
    await settle();
    expect(statusOnly(capture)).toHaveLength(501);
    // An entry that ends after the uninstall is new.
    FakePerformanceObserver.record('resource', [liveEntry('https://app.example.com/r/new', 503)]);
    expect(statusOnly(capture)).toHaveLength(502);
  });

  it('a status report matches request initiators only, an element report elements only', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 }))
    );
    const url = 'https://app.example.com/shared/asset';
    const capture = install(WITH_NETWORK_AND_RESOURCE_ERRORS);
    await settle();
    await window.fetch(url);
    // An img 404 on the same URL is not the fetch's failure.
    FakePerformanceObserver.record('resource', [liveEntry(url, 404, 'img')]);
    expect(statusFor(capture, url)).toHaveLength(1);
    // The fetch's own entry consumes the network report.
    FakePerformanceObserver.record('resource', [
      { ...liveEntry(url, 404), startTime: performance.now() - 5 },
    ]);
    expect(statusFor(capture, url)).toHaveLength(1);
  });

  it('an uninstall before the first observer batch loses no pre-install failure', async () => {
    FakePerformanceObserver.record('resource', [
      resourceEntry('https://app.example.com/early', 429),
    ]);
    const capture = new BrowserEventCapture(ONLY_DEFAULT_RESOURCE_STATUS);
    installed.push(capture);
    capture.install();
    capture.uninstall();
    capture.install();
    await settle();
    expect(statusFor(capture, 'https://app.example.com/early')).toHaveLength(1);
  });

  it('a throwing owner does not stop the others, and is logged once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const throwing = install();
      throwing.setOnEvent(() => {
        throw new Error('owner bug');
      });
      const healthy = install();
      await settle();
      FakePerformanceObserver.record('resource', [
        liveEntry('https://app.example.com/one', 503),
        liveEntry('https://app.example.com/two', 503),
      ]);
      expect(statusEvents(healthy)).toHaveLength(2);
      expect(warn.mock.calls.filter((c) => String(c[0]).includes('resource-status'))).toHaveLength(
        1
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('a new capture instance after the last owner left receives the page’s failures', async () => {
    FakePerformanceObserver.record('resource', [resourceEntry('https://app.example.com/pre', 429)]);
    const a = install();
    await settle();
    const [seenByA] = statusFor(a, 'https://app.example.com/pre');
    expect(seenByA).toBeDefined();
    a.uninstall();
    // A provider remount: new internals, a different BrowserEventCapture.
    const b = install();
    await settle();
    const seenByB = statusFor(b, 'https://app.example.com/pre');
    expect(seenByB).toHaveLength(1);
    expect(seenByB[0]).toMatchObject({
      failureId: (seenByA as { failureId: string }).failureId,
    });
    expect(replayTruncated(b)).toHaveLength(0);
  });

  it('a late joiner while armed receives the earlier failures once', async () => {
    FakePerformanceObserver.record('resource', [resourceEntry('https://app.example.com/pre', 429)]);
    const a = install();
    await settle();
    const late = install();
    await settle();
    expect(statusFor(late, 'https://app.example.com/pre')).toHaveLength(1);
    FakePerformanceObserver.record('resource', [liveEntry('https://app.example.com/new', 503)]);
    expect(statusOnly(late)).toHaveLength(2);
    expect(statusOnly(a)).toHaveLength(2);
    expect(replayTruncated(late)).toHaveLength(0);
    expect(replayTruncated(a)).toHaveLength(0);
  });

  it('a late joiner past the replay bound is told how many events it missed, first', async () => {
    const a = install();
    await settle();
    recordFailures(105);
    const late = install();
    await settle();
    const markers = replayTruncated(late);
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ replayTruncated: true, droppedCount: 5 });
    // Ordered before the first replayed status.
    expect(statusEvents(late)[0]).toMatchObject({ kind: 'replay-truncated' });
    expect(statusOnly(late)).toHaveLength(100);
    expect(statusOnly(late)[0]).toMatchObject({ resourceUrl: 'https://app.example.com/f/5' });
    // The owner that saw everything live is told nothing.
    expect(statusOnly(a)).toHaveLength(105);
    expect(replayTruncated(a)).toHaveLength(0);
  });

  it('a rejoining instance past the replay bound is told how many events it missed', async () => {
    const a = install();
    install();
    await settle();
    // `a` sees 3 events live before it leaves, so its count is relative to what it saw.
    recordFailures(3, 'seen');
    expect(statusOnly(a)).toHaveLength(3);
    a.uninstall();
    // The other install keeps the capture armed.
    recordFailures(105);
    a.install();
    await settle();
    const markers = replayTruncated(a);
    expect(markers).toHaveLength(1);
    // 108 stored in all, the last 100 kept: 8 dropped, 3 of which `a` already saw.
    expect(markers[0]).toMatchObject({ replayTruncated: true, droppedCount: 5 });
    // The marker comes after what `a` saw live and before its replayed backlog.
    expect(statusEvents(a)[3]).toMatchObject({ kind: 'replay-truncated' });
    expect(statusOnly(a)).toHaveLength(3 + 100);
  });

  it('a replay of exactly the bound is complete; one past it drops one', async () => {
    install();
    await settle();
    recordFailures(100);
    const full = install();
    await settle();
    expect(replayTruncated(full)).toHaveLength(0);
    expect(statusOnly(full)).toHaveLength(100);

    newDocument();
    install();
    await settle();
    recordFailures(101);
    const over = install();
    await settle();
    const markers = replayTruncated(over);
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ droppedCount: 1 });
    expect(statusOnly(over)).toHaveLength(100);
  });

  it('a live failure before a joiner’s replay tick does not cost it the backlog', async () => {
    FakePerformanceObserver.record('resource', [resourceEntry('https://app.example.com/pre', 429)]);
    install();
    await settle();
    const late = install();
    FakePerformanceObserver.record('resource', [liveEntry('https://app.example.com/live', 503)]);
    await settle();
    expect(statusOnly(late).map((e) => (e.kind === 'status' ? e.resourceUrl : ''))).toEqual([
      'https://app.example.com/pre',
      'https://app.example.com/live',
    ]);
    expect(replayTruncated(late)).toHaveLength(0);
  });

  it('a remounted capture receives a failure suppressed live, tagged reportedLiveAs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 429 }))
    );
    const url = 'https://app.example.com/api/v1/suppressed';
    const a = install(WITH_NETWORK_AND_RESOURCE_ERRORS);
    await settle();
    await window.fetch(url);
    FakePerformanceObserver.record('resource', [liveEntry(url, 429)]);
    expect(statusFor(a, url)).toHaveLength(0);
    a.uninstall();
    const b = install(WITH_NETWORK_AND_RESOURCE_ERRORS);
    await settle();
    expect(statusFor(b, url)).toEqual([
      expect.objectContaining({ responseStatus: 429, reportedLiveAs: 'network' }),
    ]);
    // The same instance re-installed does not receive it: its own capture reported it.
    a.install();
    await settle();
    expect(statusFor(a, url)).toHaveLength(0);
  });

  it('a document hidden before the deferred tick keeps its status and the previous carry', async () => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v: 1,
        writtenAt: Date.now(),
        writtenBy: `${window.location.origin}${window.location.pathname}`,
        writerToken: 't',
        events: [
          {
            type: 'resource-status',
            timestamp: 1,
            url: 'x',
            kind: 'status',
            resourceUrl: 'https://app.example.com/before',
            hasQuery: false,
            initiatorType: 'fetch',
            responseStatus: 503,
            startTime: 1,
            responseEnd: 2,
            failureId: 'prev:0',
          },
        ],
      })
    );
    navigationEntries = [
      {
        ...resourceEntry('https://app.example.com/doc', 429, 'navigation'),
        entryType: 'navigation',
      },
    ];
    const quick = install();
    window.dispatchEvent(new Event('pagehide'));
    quick.uninstall();
    expect(statusFor(quick, 'https://app.example.com/before')).toHaveLength(1);
    expect(statusFor(quick, 'https://app.example.com/doc')).toHaveLength(1);

    newDocument();
    const next = install();
    await settle();
    expect(statusFor(next, 'https://app.example.com/doc')).toEqual([
      expect.objectContaining({ responseStatus: 429, fromPreviousDocument: true }),
    ]);
    // A fast redirect passes the earlier carry on too, with its failureId.
    expect(statusFor(next, 'https://app.example.com/before')).toEqual([
      expect.objectContaining({ fromPreviousDocument: true, failureId: 'prev:0' }),
    ]);
  });

  it('stays armed until the last of several owners uninstalls', async () => {
    const a = install();
    const b = install();
    await settle();
    a.uninstall();
    FakePerformanceObserver.record('resource', [liveEntry('https://app.example.com/x', 503)]);
    expect(statusEvents(b)).toHaveLength(1);
    b.uninstall();
    expect(FakePerformanceObserver.live.size).toBe(0);
    FakePerformanceObserver.record('resource', [liveEntry('https://app.example.com/y', 503)]);
    expect(statusEvents(b)).toHaveLength(1);
  });

  it('a nested network wrapper does not record a second report for one failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 503 }))
    );
    const url = 'https://app.example.com/api/v1/nested';
    const outer = install(WITH_NETWORK_AND_RESOURCE_ERRORS);
    install({ ...ONLY_DEFAULT_RESOURCE_STATUS, network: true, resourceStatus: false });
    await settle();
    await window.fetch(url);
    // Two failing entries, one fetch, one report: one is the fetch's, one is not.
    FakePerformanceObserver.record('resource', [liveEntry(url, 503), liveEntry(url, 503)]);
    expect(statusFor(outer, url)).toHaveLength(1);
  });

  it('the network capture resolves a relative URL against <base href>', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 503 }))
    );
    const base = document.createElement('base');
    base.href = 'https://cdn.example.com/sub/';
    document.head.appendChild(base);
    try {
      const capture = install(WITH_NETWORK_AND_RESOURCE_ERRORS);
      await settle();
      await window.fetch('rel/x');
      expect(capture.getByType('network')[0]).toMatchObject({
        requestUrl: 'https://cdn.example.com/sub/rel/x',
      });
    } finally {
      base.remove();
    }
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
    const dropped = install();
    await settle();
    expect(statusEvents(dropped)).toHaveLength(0);
    // Not this document's: left for whom it may concern, not deleted.
    expect(sessionStorage.getItem(STORAGE_KEY)).not.toBeNull();

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

  it('a restored document receives the carry of the page it came back from, once', async () => {
    const here = `${window.location.origin}${window.location.pathname}`;
    // A: draws a 429, leaves (bfcache), writes its carry.
    const a = install();
    await settle();
    FakePerformanceObserver.record('resource', [resourceEntry('https://app.example.com/a', 429)]);
    window.dispatchEvent(new Event('pagehide'));

    // B (referred by A): takes A's carry, draws a 503, leaves, writes its own.
    newDocument();
    setReferrer(here);
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
    expect(sessionStorage.getItem(STORAGE_KEY)).toContain('https://app.example.com/b');

    // A is restored from the cache: it is the document the user sees after B,
    // so it receives B's carry, and takes it out of storage.
    const before = statusEvents(a).length;
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    const received = statusEvents(a).slice(before);
    expect(received).toEqual([
      expect.objectContaining({
        resourceUrl: 'https://app.example.com/b',
        fromPreviousDocument: true,
      }),
    ]);
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    window.dispatchEvent(new Event('pagehide'));
    a.uninstall();

    // C (referred by A): nothing is left; each failure was delivered once.
    newDocument();
    setReferrer(here);
    const c = install();
    await settle();
    expect(statusEvents(c)).toHaveLength(0);
  });

  it('a framed document neither takes nor writes a carry', async () => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v: 1,
        writtenAt: Date.now(),
        writtenBy: `${window.location.origin}${window.location.pathname}`,
        writerToken: 't',
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
    const stored = sessionStorage.getItem(STORAGE_KEY);
    const top = vi.spyOn(window, 'top', 'get').mockReturnValue({} as Window);
    try {
      const framed = install();
      await settle();
      expect(statusEvents(framed)).toHaveLength(0);
      FakePerformanceObserver.record('resource', [liveEntry('https://app.example.com/f', 503)]);
      expect(statusEvents(framed)).toHaveLength(1);
      window.dispatchEvent(new Event('pagehide'));
      expect(sessionStorage.getItem(STORAGE_KEY)).toBe(stored);
    } finally {
      top.mockRestore();
    }
  });

  it('marks a carried failure that another capture reported live', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 503 }))
    );
    const url = 'https://app.example.com/api/v1/marked';
    const first = install(WITH_NETWORK_AND_RESOURCE_ERRORS);
    await settle();
    await window.fetch(url);
    FakePerformanceObserver.record('resource', [
      liveEntry(url, 503),
      liveEntry('https://app.example.com/api/v1/unreported', 503),
    ]);
    window.dispatchEvent(new Event('pagehide'));
    first.uninstall();

    newDocument();
    const second = install();
    await settle();
    expect(statusFor(second, url)).toEqual([
      expect.objectContaining({ fromPreviousDocument: true, reportedLiveAs: 'network' }),
    ]);
    expect(statusFor(second, 'https://app.example.com/api/v1/unreported')[0]).not.toHaveProperty(
      'reportedLiveAs'
    );
  });

  it('an XHR failure is not absorbed by a leftover fetch report', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 503 }))
    );
    const url = 'https://app.example.com/api/v1/xhr-or-fetch';
    const capture = install(WITH_NETWORK_AND_RESOURCE_ERRORS);
    await settle();
    await window.fetch(url);
    FakePerformanceObserver.record('resource', [liveEntry(url, 503, 'xmlhttprequest')]);
    expect(statusFor(capture, url)).toHaveLength(1);
  });

  it('a responsive img is matched on the source it actually loaded', async () => {
    const capture = install(WITH_NETWORK_AND_RESOURCE_ERRORS);
    await settle();
    const img = document.createElement('img');
    img.src = 'https://app.example.com/photo-1x.png';
    img.srcset = 'https://app.example.com/photo-2x.png 2x';
    Object.defineProperty(img, 'currentSrc', { value: 'https://app.example.com/photo-2x.png' });
    document.body.appendChild(img);
    img.dispatchEvent(new Event('error'));
    img.remove();
    FakePerformanceObserver.record('resource', [
      liveEntry('https://app.example.com/photo-2x.png', 404, 'img'),
    ]);
    expect(statusFor(capture, 'https://app.example.com/photo-2x.png')).toHaveLength(0);
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
    FakePerformanceObserver.record('resource', [liveEntry('https://app.example.com/b', 500)]);
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
      failureId: 'doc-1:fetch|1|https://app.example.com/ok',
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
          { ...valid, failureId: 7 },
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
    const reloaded = install();
    await settle();
    expect(statusEvents(reloaded)).toHaveLength(1);

    // An origin-only referrer cannot name the writer: ambiguous, dropped.
    newDocument();
    carry(`${window.location.origin}/some/page`);
    setReferrer(`${window.location.origin}/`);
    const originOnly = install();
    await settle();
    expect(statusEvents(originOnly)).toHaveLength(0);

    // An origin-only referrer from another origin did not precede it.
    newDocument();
    carry(`${window.location.origin}/some/page`);
    setReferrer('https://elsewhere.example/');
    const elsewhere = install();
    await settle();
    expect(statusEvents(elsewhere)).toHaveLength(0);
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
    // A carried failure (>= 400) never drops below warning: the stream's
    // default subscription is minSeverity 'warning'.
    expect(classifyEvent({ ...entry(429), ...carried }).severity).toBe('warning');
    expect(classifyEvent({ ...entry(404), initiatorType: 'img', ...carried }).severity).toBe(
      'warning'
    );
    // A failure graded noise on its own page (a missing favicon) stays noise.
    expect(
      classifyEvent({
        ...entry(404),
        resourceUrl: 'https://app.example.com/favicon.ico',
        ...carried,
      }).severity
    ).toBe('noise');
    expect(
      classifyEvent({
        ...base,
        ...carried,
        kind: 'buffer-full',
        bufferFull: true,
        resourceEntryCount: 250,
      }).severity
    ).toBe('warning');
    // A carried blind spot is floored at warning too.
    expect(
      classifyEvent({
        ...base,
        ...carried,
        kind: 'observer-unavailable',
        observerUnavailable: true,
      }).severity
    ).toBe('warning');
    // One step down from crash is error.
    expect(
      classifyEvent({
        ...entry(503),
        resourceUrl: 'https://app.example.com/api/v1/auth/login',
        ...carried,
      }).severity
    ).toBe('error');
  });

  it('a reportedLiveAs copy is listed and streamed but not scored', () => {
    const covered = {
      ...entry(503),
      responseStatus: 503,
      reportedLiveAs: 'network' as const,
    };
    // Listed and streamed at its grade.
    expect(classifyEvent(covered).severity).toBe('error');
    const stream = new BrowserEventStream();
    stream.subscribe({ minSeverity: 'warning' });
    expect(stream.processEvent(covered).size).toBe(1);
    // Not scored: the reporting capture's own event already counts.
    const now = Date.now();
    const report = computeHealthReport({
      getSince: () => [{ ...covered, timestamp: now }],
      getRecent: () => [],
      getByType: () => [],
    } as unknown as Parameters<typeof computeHealthReport>[0]);
    expect(report.breakdown).toEqual({ crashes: 0, errors: 0, warnings: 0 });
    const assessor = new ErrorImpactAssessor({
      captureUIState: () => ({ elementCount: 0, visibleElements: [], url: '' }) as never,
    });
    expect(assessor.assessEvents([covered])).toHaveLength(0);
    expect(assessor.assessEvents([entry(503)])).toHaveLength(1);
  });

  it('a carried reportedLiveAs copy IS scored: its live counterpart died with its page', () => {
    const carried = {
      ...entry(503),
      reportedLiveAs: 'network' as const,
      fromPreviousDocument: true as const,
    };
    const report = computeHealthReport({
      getSince: () => [{ ...carried, timestamp: Date.now() }],
      getRecent: () => [],
      getByType: () => [],
    } as unknown as Parameters<typeof computeHealthReport>[0]);
    // A carried 503 is demoted one step: a warning.
    expect(report.breakdown).toEqual({ crashes: 0, errors: 0, warnings: 1 });
    const critical = { ...carried, resourceUrl: 'https://app.example.com/api/v1/auth/login' };
    const assessor = new ErrorImpactAssessor({
      captureUIState: () => ({ elementCount: 0, visibleElements: [], url: '' }) as never,
    });
    // assessEvents assesses error and crash; a carried critical 5xx is an error.
    expect(assessor.assessEvents([critical])).toHaveLength(1);
  });

  it('a carried 429 reaches a minSeverity-warning stream subscriber', () => {
    const stream = new BrowserEventStream();
    stream.subscribe({ minSeverity: 'warning', deduplicate: true });
    const messages = stream.processEvent({ ...entry(429), fromPreviousDocument: true as const });
    expect(messages.size).toBe(1);
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

  it('grades a truncated replay as a warning and names what it dropped', () => {
    const marker = {
      ...base,
      kind: 'replay-truncated' as const,
      replayTruncated: true as const,
      droppedCount: 5,
    };
    expect(classifyEvent(marker)).toEqual({
      severity: 'warning',
      reason: 'resource-status replay truncated',
    });
    expect(extractMessage(marker)).toBe(
      'Replay truncated: 5 earlier resource-status events were not replayed'
    );
    expect(extractMessage({ ...marker, droppedCount: 1 })).toBe(
      'Replay truncated: 1 earlier resource-status event was not replayed'
    );
    expect(computeFingerprint(marker)).toBe('resource-status:replay-truncated');
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
