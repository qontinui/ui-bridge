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

  it('(f) a full resource-timing buffer emits bufferFull: true', async () => {
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

    expect(listeners).toHaveLength(1);
    listeners[0]!();
    events = statusEvents(capture);
    expect(events.filter((e) => e.kind === 'buffer-full')).toHaveLength(2);
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

  it('classifies 4xx and 5xx as error and an unknown status as noise', () => {
    expect(classifyEvent(entry(429)).severity).toBe('error');
    expect(classifyEvent(entry(503)).severity).toBe('error');
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
