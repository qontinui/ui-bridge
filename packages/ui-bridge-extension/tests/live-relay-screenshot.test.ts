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
import * as wrapper from '@qontinui/ui-bridge-wrapper';
import { installChromeMock, type ChromeMock } from './chrome-mock';
import {
  createScreenshotHandler,
  SCREENSHOT_ACTION,
  SCREENSHOT_CAPABILITY,
} from '../src/content/screenshot-handler';
import { buildLiveRelayOptions } from '../src/content/live-relay-config';
import type { ExtensionMessage } from '../src/shared/messages';

const SENDER_TAB = { id: 7, windowId: 3 };
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

let chromeMock: ChromeMock;

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

  it('a capture Chrome refuses answers CAPTURE_FAILED carrying its message', async () => {
    chromeMock.tabs.query.mockResolvedValue([{ id: SENDER_TAB.id }]);
    chromeMock.tabs.captureVisibleTab.mockRejectedValue(
      new Error('This request exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota.')
    );
    const { handler } = handlerFor('visible');

    const err = (await handler().catch((e: unknown) => e)) as wrapper.WrapperTransportError;
    expect(err.code).toBe('CAPTURE_FAILED');
    expect(err.message).toContain('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND');
  });

  it('the register frame carries the screenshot capability, and the command answers over the socket', async () => {
    // The relay's own constants are the wrapper's — one string on each side.
    expect(SCREENSHOT_CAPABILITY).toBe(wrapper.SCREENSHOT_CAPABILITY);
    expect(SCREENSHOT_ACTION).toBe(wrapper.SCREENSHOT_ACTION);

    const sent: string[] = [];
    let socket: { emit(type: string, ev?: unknown): void } | null = null;
    class FakeWebSocket {
      readyState = 0;
      private readonly listeners = new Map<string, Array<(ev?: unknown) => void>>();
      constructor() {
        socket = this;
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
          ...buildLiveRelayOptions({
            origin: 'https://example.com',
            href: 'https://example.com/a',
          }),
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

    const deliver = (frame: unknown) => socket!.emit('message', { data: JSON.stringify(frame) });
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

  it('the manifest grants the host permission captureVisibleTab needs without a gesture', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../manifest.json', import.meta.url), 'utf8')
    ) as {
      host_permissions: string[];
    };
    // `<all_urls>` per Chrome's captureVisibleTab documentation; the plan's
    // headed-Chromium probe of `https://*/*` alone has not been run (see
    // src/background/capture-visible-tab.ts).
    expect(manifest.host_permissions).toEqual(['<all_urls>']);
  });
});
