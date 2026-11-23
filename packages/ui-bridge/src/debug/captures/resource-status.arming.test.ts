/**
 * Arming test — plan 2026-11-23-an-exec-mode-pass-draws-an-unattributed-load-time-429,
 * Phase 3: a failure drawn before the SDK mounted reaches `getBrowserEvents`
 * (which reads `BrowserEventCapture.getByType`) through the default capture
 * config alone. jsdom ships no PerformanceObserver, so a minimal one replays
 * its buffer on `observe({ buffered: true })`, asynchronously, as a browser does.
 */

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BrowserEventCapture } from '../browser-capture';

type Entry = Record<string, unknown>;
type Callback = (list: { getEntries(): PerformanceEntry[] }) => void;

const buffer: Entry[] = [];

class BufferedPerformanceObserver {
  static supportedEntryTypes = ['resource'];
  constructor(private readonly callback: Callback) {}
  observe(init: { type: string; buffered?: boolean }): void {
    if (init.type !== 'resource' || !init.buffered) return;
    const replay = [...buffer];
    queueMicrotask(() =>
      this.callback({ getEntries: () => replay as unknown as PerformanceEntry[] })
    );
  }
  disconnect(): void {}
  takeRecords(): PerformanceEntry[] {
    return [];
  }
}

beforeEach(() => {
  vi.stubGlobal('PerformanceObserver', BufferedPerformanceObserver);
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

it('a pre-install 429 reaches getBrowserEvents through BrowserEventCapture.install', async () => {
  buffer.push({
    name: 'https://app.example.com/api/ui-bridge/relay/poll',
    entryType: 'resource',
    initiatorType: 'fetch',
    responseStatus: 429,
    startTime: 10,
    duration: 5,
    responseEnd: 15,
  });
  const capture = new BrowserEventCapture();
  capture.install();
  try {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const statuses = capture
      .getByType('resource-status')
      .filter((e) => 'responseStatus' in e && e.responseStatus === 429);
    expect(statuses).toHaveLength(1);
  } finally {
    capture.uninstall();
  }
});
