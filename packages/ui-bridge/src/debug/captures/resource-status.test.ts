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

const STORAGE_KEY = 'qontinui-ui-bridge:resource-status:v1';

type Entry = Record<string, unknown>;
type Callback = (list: { getEntries(): PerformanceEntry[] }) => void;

class FakePerformanceObserver {
  static supportedEntryTypes: string[] = ['resource'];
  static live = new Set<FakePerformanceObserver>();
  /** Entries the browser recorded before any observer existed, per type. */
  static buffers: Record<string, Entry[]> = {};
  type: string | null = null;
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
    return [];
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

const installed: BrowserEventCapture[] = [];

function install(): BrowserEventCapture {
  const capture = new BrowserEventCapture(ONLY_DEFAULT_RESOURCE_STATUS);
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
    // Under vitest's jsdom environment `performance` is Node's, which refuses a
    // jsdom Event; capture the listener instead of dispatching.
    const listeners: Array<() => void> = [];
    const spy = vi
      .spyOn(performance, 'addEventListener')
      .mockImplementation((type: string, listener: unknown) => {
        if (type === 'resourcetimingbufferfull') listeners.push(listener as () => void);
      });
    const capture = install();
    await settle();
    spy.mockRestore();
    let events = statusEvents(capture);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'buffer-full',
      bufferFull: true,
      resourceEntryCount: 250,
    });

    // A buffer that fills AFTER install is no gap: the live observer still
    // receives every entry, so no listener is registered and nothing is emitted.
    expect(listeners).toHaveLength(0);
    FakePerformanceObserver.record('resource', [resourceEntry('https://app.example.com/z', 429)]);
    events = statusEvents(capture);
    expect(events.filter((e) => e.kind === 'buffer-full')).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ kind: 'status', responseStatus: 429 });
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

  it('a back/forward-cache round trip does not re-carry already-carried events', async () => {
    const first = install();
    await settle();
    FakePerformanceObserver.record('resource', [resourceEntry('https://app.example.com/q', 429)]);
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    // Leaving the restored document again: nothing new happened on it.
    window.dispatchEvent(new Event('pagehide'));
    first.uninstall();

    newDocument();
    const second = install();
    await settle();
    expect(statusEvents(second)).toHaveLength(0);
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
        events: [
          { ...valid, kind: 'bogus' },
          {
            type: 'resource-status',
            timestamp: 1,
            url: 'https://app.example.com/',
            kind: 'status',
          },
          { ...valid, initiatorType: 7 },
          valid,
        ],
      })
    );
    const capture = install();
    await settle();
    const carried = statusEvents(capture);
    expect(carried).toHaveLength(1);
    expect(carried[0]).toMatchObject({
      resourceUrl: 'https://app.example.com/ok',
      fromPreviousDocument: true,
    });
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

  it('grades a fetch/XHR 4xx as warning (the network capture also sees it), 5xx as error', () => {
    expect(classifyEvent(entry(429)).severity).toBe('warning');
    expect(classifyEvent({ ...entry(429), initiatorType: 'xmlhttprequest' }).severity).toBe(
      'warning'
    );
    expect(classifyEvent(entry(503)).severity).toBe('error');
    expect(classifyEvent({ ...entry(429), initiatorType: 'script' }).severity).toBe('error');
    expect(classifyEvent({ ...entry(403), initiatorType: 'navigation' }).severity).toBe('error');
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
