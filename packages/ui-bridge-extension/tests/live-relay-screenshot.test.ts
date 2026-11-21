/**
 * The live relay answers `getScreenshot` from an opted-in, visible tab (plan
 * 2026-11-21-vision-capture-cannot-frame-a-websocket-transport-app, Phase 4).
 *
 * The content-script handler and the service worker's CAPTURE_VISIBLE_TAB
 * dispatch are driven together: the handler's `sendMessage` is wired to the
 * listener the service worker registers on a mocked `chrome.runtime.onMessage`,
 * so a reply crosses the same typed dispatch Chrome would route it through.
 */

import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as wrapper from '@qontinui/ui-bridge-wrapper/live';
import { installChromeMock, type ChromeMock } from './chrome-mock';
import {
  createScreenshotHandler,
  readCaptureReply,
  SCREENSHOT_ACTION,
  SCREENSHOT_CAPABILITY,
} from '../src/content/screenshot-handler';
import { buildLiveRelayOptions } from '../src/content/live-relay-config';
import { CAPTURE_FINAL_PATTERNS } from '../src/background/capture-visible-tab';
import type { ExtensionMessage } from '../src/shared/messages';

const SENDER_TAB = { id: 7, windowId: 3 };
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

let chromeMock: ChromeMock;

/** Chrome match-pattern coverage, enough for host_permissions: `<all_urls>` or scheme://host/path with `*`. */
function grantCovers(pattern: string, url: string): boolean {
  if (pattern === '<all_urls>') return /^(https?|wss?|ftp|file):/.test(url);
  const m = /^(\*|https?|wss?|file|ftp):\/\/([^/]*)(\/.*)$/.exec(pattern);
  if (!m) return false;
  const u = new URL(url);
  const [, scheme, host, path] = m as unknown as [string, string, string, string];
  const schemeOk =
    scheme === '*'
      ? u.protocol === 'http:' || u.protocol === 'https:'
      : u.protocol === `${scheme}:`;
  const hostName = host.replace(/:\*$/, '').replace(/:\d+$/, '');
  const hostOk =
    hostName === '*' ||
    u.hostname === hostName ||
    (hostName.startsWith('*.') && u.hostname.endsWith(hostName.slice(1)));
  const pathRe = new RegExp(
    `^${path
      .split('*')
      .map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`
  );
  return schemeOk && hostOk && pathRe.test(u.pathname);
}

/** Deliver `message` to the service worker's onMessage listener, as from `sender`. */
function deliverToServiceWorker(message: ExtensionMessage, sender: unknown): Promise<unknown> {
  const [listener] = chromeMock.listeners['runtime.onMessage'] ?? [];
  if (!listener) throw new Error('service worker registered no onMessage listener');
  return new Promise((resolve) => {
    (listener as (m: unknown, s: unknown, r: (v: unknown) => void) => unknown)(
      message,
      sender,
      resolve
    );
  });
}

function handlerFor(
  visibilityState: DocumentVisibilityState,
  sender: unknown = { tab: SENDER_TAB }
) {
  const sendMessage = vi.fn((m: ExtensionMessage) => deliverToServiceWorker(m, sender));
  const handler = createScreenshotHandler({
    WrapperTransportError: wrapper.WrapperTransportError,
    doc: { visibilityState },
    win: { innerWidth: 1024, innerHeight: 768 },
    sendMessage,
  });
  return { handler, sendMessage };
}

beforeAll(async () => {
  chromeMock = installChromeMock();
  // Registers the service worker's listeners on the mock.
  await import('../src/background/service-worker');
});

beforeEach(() => {
  chromeMock.tabs.query.mockReset();
  chromeMock.tabs.captureVisibleTab.mockReset();
  chromeMock.tabs.captureVisibleTab.mockResolvedValue(`data:image/png;base64,${PNG_B64}`);
});

describe('live relay getScreenshot', () => {
  it('a visible tab that is the active tab of its window returns {screenshot, width, height}', async () => {
    chromeMock.tabs.query.mockResolvedValue([{ id: SENDER_TAB.id }]);
    const { handler } = handlerFor('visible');

    await expect(handler()).resolves.toEqual({ screenshot: PNG_B64, width: 1024, height: 768 });
    expect(chromeMock.tabs.query).toHaveBeenCalledWith({
      active: true,
      windowId: SENDER_TAB.windowId,
    });
    expect(chromeMock.tabs.captureVisibleTab).toHaveBeenCalledWith(SENDER_TAB.windowId, {
      format: 'png',
    });
  });

  it('a hidden document refuses with TAB_NOT_VISIBLE and sends no message', async () => {
    const { handler, sendMessage } = handlerFor('hidden');

    const err = await handler().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(wrapper.WrapperTransportError);
    expect((err as wrapper.WrapperTransportError).code).toBe('TAB_NOT_VISIBLE');
    expect(sendMessage).not.toHaveBeenCalled();
    expect(chromeMock.tabs.captureVisibleTab).not.toHaveBeenCalled();
  });

  it('a sender that is not the active tab of its window refuses with TAB_NOT_VISIBLE', async () => {
    chromeMock.tabs.query.mockResolvedValue([{ id: 99 }]);
    const { handler } = handlerFor('visible');

    const err = await handler().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(wrapper.WrapperTransportError);
    expect((err as wrapper.WrapperTransportError).code).toBe('TAB_NOT_VISIBLE');
    // Never captured another tab's pixels.
    expect(chromeMock.tabs.captureVisibleTab).not.toHaveBeenCalled();

    // The service worker's own answer, read directly.
    await expect(
      deliverToServiceWorker({ type: 'CAPTURE_VISIBLE_TAB' }, { tab: SENDER_TAB })
    ).resolves.toMatchObject({
      success: false,
      code: 'TAB_NOT_VISIBLE',
    });
  });

  it("Chrome's per-second capture quota answers retryable CAPTURE_RATE_LIMITED", async () => {
    chromeMock.tabs.query.mockResolvedValue([{ id: SENDER_TAB.id }]);
    chromeMock.tabs.captureVisibleTab.mockRejectedValue(
      new Error('This request exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota.')
    );
    const { handler } = handlerFor('visible');

    const err = (await handler().catch((e: unknown) => e)) as wrapper.WrapperTransportError;
    expect(err).toBeInstanceOf(wrapper.WrapperTransportError);
    expect(err.code).toBe('CAPTURE_RATE_LIMITED');
    expect(err.retryable).toBe(true);
    expect(err.message).toContain('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND');
  });

  it('a known-final capture refusal answers non-retryable CAPTURE_FAILED, carrying its message', async () => {
    chromeMock.tabs.query.mockResolvedValue([{ id: SENDER_TAB.id }]);
    chromeMock.tabs.captureVisibleTab.mockRejectedValue(
      new Error('Cannot access contents of the page.')
    );
    const { handler } = handlerFor('visible');

    const err = (await handler().catch((e: unknown) => e)) as wrapper.WrapperTransportError;
    expect(err.code).toBe('CAPTURE_FAILED');
    expect(err.retryable).toBe(false);
    expect(err.message).toContain('Cannot access contents of the page');
  });

  it('a tab switched away between the check and the capture gets no frame: TAB_NOT_VISIBLE', async () => {
    // Active when checked, another tab active by the time the capture returns.
    chromeMock.tabs.query
      .mockResolvedValueOnce([{ id: SENDER_TAB.id }])
      .mockResolvedValueOnce([{ id: 99 }]);
    const reply = await deliverToServiceWorker(
      { type: 'CAPTURE_VISIBLE_TAB' },
      { tab: SENDER_TAB }
    );

    expect(chromeMock.tabs.captureVisibleTab).toHaveBeenCalledTimes(1);
    expect(reply).toMatchObject({ success: false, code: 'TAB_NOT_VISIBLE', retryable: true });
    expect(JSON.stringify(reply)).not.toContain(PNG_B64);
  });

  it('a malformed service-worker reply is a typed CAPTURE_FAILED, never an undefined code or a TypeError', async () => {
    for (const bad of [
      { success: false },
      { success: false, code: 'SOMETHING_ELSE', error: 'x' },
      { success: true },
      { success: true, data: { screenshot: 42 } },
      'nonsense',
    ]) {
      const handler = createScreenshotHandler({
        WrapperTransportError: wrapper.WrapperTransportError,
        doc: { visibilityState: 'visible' },
        win: { innerWidth: 1, innerHeight: 1 },
        sendMessage: async () => bad,
      });
      const err = await handler().catch((e: unknown) => e);
      expect(err, JSON.stringify(bad)).toBeInstanceOf(wrapper.WrapperTransportError);
      expect((err as wrapper.WrapperTransportError).code, JSON.stringify(bad)).toBe(
        'CAPTURE_FAILED'
      );
    }
  });

  it('a tabs.query that rejects BEFORE the capture answers retryable CAPTURE_FAILED and captures nothing', async () => {
    chromeMock.tabs.query.mockRejectedValueOnce(new Error('No window with id: 3.'));
    const reply = await deliverToServiceWorker(
      { type: 'CAPTURE_VISIBLE_TAB' },
      { tab: SENDER_TAB }
    );
    expect(reply).toMatchObject({ success: false, code: 'CAPTURE_FAILED', retryable: true });
    expect(chromeMock.tabs.captureVisibleTab).not.toHaveBeenCalled();
  });

  it('a tabs.query that rejects AFTER the capture discards the frame: retryable CAPTURE_FAILED', async () => {
    chromeMock.tabs.query
      .mockResolvedValueOnce([{ id: SENDER_TAB.id }])
      .mockRejectedValueOnce(new Error('No window with id: 3.'));
    const reply = await deliverToServiceWorker(
      { type: 'CAPTURE_VISIBLE_TAB' },
      { tab: SENDER_TAB }
    );
    expect(chromeMock.tabs.captureVisibleTab).toHaveBeenCalledTimes(1);
    expect(reply).toMatchObject({ success: false, code: 'CAPTURE_FAILED', retryable: true });
    expect(JSON.stringify(reply)).not.toContain(PNG_B64);
  });

  it('a capture that is not a PNG data URL answers CAPTURE_FAILED, not a frame', async () => {
    chromeMock.tabs.query.mockResolvedValue([{ id: SENDER_TAB.id }]);
    chromeMock.tabs.captureVisibleTab.mockResolvedValue('data:image/jpeg;base64,/9j/4AAQ');
    const reply = await deliverToServiceWorker(
      { type: 'CAPTURE_VISIBLE_TAB' },
      { tab: SENDER_TAB }
    );
    expect(reply).toMatchObject({ success: false, code: 'CAPTURE_FAILED', retryable: false });
  });

  it('a sender with no tab answers TAB_NOT_VISIBLE without reading or capturing any tab', async () => {
    const reply = await deliverToServiceWorker({ type: 'CAPTURE_VISIBLE_TAB' }, {});
    expect(reply).toMatchObject({ success: false, code: 'TAB_NOT_VISIBLE', retryable: false });
    expect(chromeMock.tabs.query).not.toHaveBeenCalled();
    expect(chromeMock.tabs.captureVisibleTab).not.toHaveBeenCalled();
  });

  it('each known-final pattern matches a real Chrome refusal, which answers non-retryable CAPTURE_FAILED', async () => {
    // One real Chrome message per CAPTURE_FINAL_PATTERNS entry, in order.
    const messages = [
      "Either the '<all_urls>' or 'activeTab' permission is required.",
      'Cannot access contents of url "chrome://settings/". Extension manifest must request permission to access this host.',
      'The extensions gallery cannot be scripted.',
      'Cannot access a chrome:// URL',
      'The extensions gallery cannot be scripted.',
      'Cannot access a chrome-extension:// URL of different extension',
    ];
    expect(messages).toHaveLength(CAPTURE_FINAL_PATTERNS.length);
    for (const [i, pattern] of CAPTURE_FINAL_PATTERNS.entries()) {
      const message = messages[i]!;
      expect(pattern.test(message), `${pattern} vs ${message}`).toBe(true);
      chromeMock.tabs.query.mockResolvedValue([{ id: SENDER_TAB.id }]);
      chromeMock.tabs.captureVisibleTab.mockRejectedValueOnce(new Error(message));
      const reply = await deliverToServiceWorker(
        { type: 'CAPTURE_VISIBLE_TAB' },
        { tab: SENDER_TAB }
      );
      expect(reply, message).toMatchObject({
        success: false,
        code: 'CAPTURE_FAILED',
        retryable: false,
      });
    }
  });

  it('an unrecognised capture refusal is retryable CAPTURE_FAILED', async () => {
    chromeMock.tabs.query.mockResolvedValue([{ id: SENDER_TAB.id }]);
    chromeMock.tabs.captureVisibleTab.mockRejectedValue(
      new Error('Failed to capture tab: unknown error')
    );
    const reply = await deliverToServiceWorker(
      { type: 'CAPTURE_VISIBLE_TAB' },
      { tab: SENDER_TAB }
    );
    expect(reply).toMatchObject({ success: false, code: 'CAPTURE_FAILED', retryable: true });
  });

  it('readCaptureReply names an unrecognised code while falling back to CAPTURE_FAILED', () => {
    const reply = readCaptureReply({ success: false, code: 'SOMETHING_ELSE', error: 'boom' });
    expect(reply).toMatchObject({ ok: false, code: 'CAPTURE_FAILED', retryable: false });
    expect((reply as { error: string }).error).toBe('boom (unrecognised code "SOMETHING_ELSE")');
    expect(readCaptureReply({ success: false })).toMatchObject({
      ok: false,
      code: 'CAPTURE_FAILED',
      error: 'CAPTURE_VISIBLE_TAB failed',
    });
  });

  it('readCaptureReply keeps known codes and their retryability', () => {
    expect(
      readCaptureReply({ success: false, code: 'TAB_NOT_VISIBLE', error: 'e', retryable: true })
    ).toEqual({ ok: false, code: 'TAB_NOT_VISIBLE', error: 'e', retryable: true });
    expect(readCaptureReply({ success: false, code: 'CAPTURE_RATE_LIMITED', error: 'q' })).toEqual({
      ok: false,
      code: 'CAPTURE_RATE_LIMITED',
      error: 'q',
      retryable: true,
    });
    expect(readCaptureReply({ success: true, data: { screenshot: 'abc' } })).toEqual({
      ok: true,
      screenshot: 'abc',
    });
  });

  it('the screenshot capability is advertised only when the handler was registered', () => {
    const loc = { origin: 'https://example.com', href: 'https://example.com/a' };
    expect(buildLiveRelayOptions(loc, { screenshot: true }).capabilities).toEqual([
      SCREENSHOT_CAPABILITY,
    ]);
    expect(buildLiveRelayOptions(loc, { screenshot: false })).not.toHaveProperty('capabilities');
  });

  it('the register frame carries the screenshot capability, and the command answers over the socket', async () => {
    // The relay's own constants are the wrapper's — one string on each side.
    expect(SCREENSHOT_CAPABILITY).toBe(wrapper.SCREENSHOT_CAPABILITY);
    expect(SCREENSHOT_ACTION).toBe(wrapper.SCREENSHOT_ACTION);

    const sent: string[] = [];
    const sockets: Array<{ emit(type: string, ev?: unknown): void }> = [];
    class FakeWebSocket {
      readyState = 0;
      private readonly listeners = new Map<string, Array<(ev?: unknown) => void>>();
      constructor() {
        sockets.push(this);
        queueMicrotask(() => {
          this.readyState = 1;
          this.emit('open');
        });
      }
      send(data: string): void {
        sent.push(data);
      }
      close(): void {
        this.readyState = 3;
      }
      addEventListener(type: string, l: (ev?: unknown) => void): void {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), l]);
      }
      emit(type: string, ev?: unknown): void {
        for (const l of this.listeners.get(type) ?? []) l(ev);
      }
    }

    const t = new wrapper.LiveSessionTransport(
      {
        kind: 'live',
        runnerUrl: 'ws://127.0.0.1:9876/ui-bridge/ws',
        appId: 'example.com',
        options: {
          ...buildLiveRelayOptions(
            { origin: 'https://example.com', href: 'https://example.com/a' },
            { screenshot: true }
          ),
        },
      },
      undefined,
      { webSocketCtor: FakeWebSocket as never }
    );
    chromeMock.tabs.query.mockResolvedValue([{ id: SENDER_TAB.id }]);
    t.register(SCREENSHOT_ACTION, handlerFor('visible').handler);

    const ready = t.ready();
    for (let i = 0; i < 20 && sent.length === 0; i++) await Promise.resolve();
    const register = JSON.parse(sent[0]!) as Record<string, unknown>;
    expect(register).toMatchObject({
      type: 'register',
      appType: 'wrapper',
      origin: 'https://example.com',
      pageUrl: 'https://example.com/a',
    });
    expect(register['capabilities']).toEqual([SCREENSHOT_CAPABILITY]);

    const deliver = (frame: unknown) =>
      sockets[0]!.emit('message', { data: JSON.stringify(frame) });
    deliver({ type: 'registered', appId: 'example.com', connId: 1, acceptedAt: 0 });
    await ready;

    deliver({ type: 'command', commandId: 'c1', action: SCREENSHOT_ACTION, payload: {} });
    let response: Record<string, unknown> | undefined;
    for (let i = 0; i < 100 && !response; i++) {
      await new Promise((r) => setTimeout(r, 1));
      response = sent
        .map((s) => JSON.parse(s) as Record<string, unknown>)
        .find((f) => f['type'] === 'response' && f['commandId'] === 'c1');
    }
    expect(response).toMatchObject({
      success: true,
      result: { screenshot: PNG_B64, width: 1024, height: 768 },
    });
    await t.close();
  });

  it("the manifest's host grant covers the relay's origins", () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../manifest.json', import.meta.url), 'utf8')
    ) as {
      host_permissions: string[];
    };
    // The PROPERTY, not the literal: the grant must cover the origins the live
    // relay runs on (https pages and http localhost). This test cannot know what
    // Chrome REQUIRES for a no-gesture capture: Chrome's chrome.tabs page
    // disagrees with itself (the captureVisibleTab reference names <all_urls>
    // or activeTab; its Host permissions section says host permissions allow
    // captureVisibleTab), so the plan's D6 headed probe decides, and it has not
    // been run (see src/background/capture-visible-tab.ts). A narrowing that
    // probe proves sufficient keeps this green.
    for (const url of [
      'https://example.com/app',
      'http://localhost:3001/x',
      'http://127.0.0.1:5173/',
    ]) {
      expect(
        manifest.host_permissions.some((p) => grantCovers(p, url)),
        url
      ).toBe(true);
    }
  });
});
