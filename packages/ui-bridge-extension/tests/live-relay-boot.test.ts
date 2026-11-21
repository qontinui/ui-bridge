/**
 * The live relay, booted the way Chrome boots it, answers the runner's
 * `getScreenshot` (plan
 * 2026-11-21-vision-capture-cannot-frame-a-websocket-transport-app, Phase 4).
 *
 * This test crosses the seam the unit tests in live-relay-screenshot.test.ts
 * do not: nothing here builds the handler or the transport options by hand.
 * The content script is imported (it boots itself, as on document_idle), the
 * service worker is imported (it registers its onMessage listener), and the
 * only things the test does are what the runner and Chrome do — speak frames
 * on the socket the relay opened, and route `chrome.runtime.sendMessage` from
 * the tab to the service worker's listener.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { installChromeMock, type ChromeMock } from './chrome-mock';

const TAB = { id: 11, windowId: 4 };
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

type Listener = (ev?: unknown) => void;

/** The socket the relay opens; the test plays the runner on it. */
class RunnerSocket {
  static opened: RunnerSocket[] = [];
  readonly sent: Array<Record<string, unknown>> = [];
  readyState = 0;
  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) {
    RunnerSocket.opened.push(this);
    setTimeout(() => {
      this.readyState = 1;
      this.emit('open');
    }, 0);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(): void {
    this.readyState = 3;
  }

  addEventListener(type: string, l: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), l]);
  }

  emit(type: string, ev?: unknown): void {
    for (const l of this.listeners.get(type) ?? []) l(ev);
  }

  /** Deliver a runner frame. */
  deliver(frame: unknown): void {
    this.emit('message', { data: JSON.stringify(frame) });
  }
}

async function until<T>(read: () => T | undefined, what: string): Promise<T> {
  for (let i = 0; i < 400; i++) {
    const v = read();
    if (v !== undefined) return v;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for ${what}`);
}

let chromeMock: ChromeMock;
const doc = { title: 'Example', visibilityState: 'visible' as DocumentVisibilityState };
let socket: RunnerSocket;

/** Send a `command` frame as the runner and wait for the relay's `response`. */
async function runnerCommand(commandId: string, action: string): Promise<Record<string, unknown>> {
  socket.deliver({ type: 'command', commandId, action, payload: {} });
  return until(
    () => socket.sent.find((f) => f['type'] === 'response' && f['commandId'] === commandId),
    `the response to ${commandId}`
  );
}

beforeAll(async () => {
  chromeMock = installChromeMock();
  // The popup toggle is ON for this tab; no runner URL is configured.
  chromeMock.storage.local.get.mockImplementation(async (key: string) =>
    key === 'qontinui_live_relay_enabled' ? { [key]: true } : {}
  );
  // Chrome routes the tab's runtime.sendMessage to the service worker.
  chromeMock.runtime.sendMessage.mockImplementation(
    (message: unknown) =>
      new Promise((resolve) => {
        const [listener] = chromeMock.listeners['runtime.onMessage'] ?? [];
        (listener as (m: unknown, s: unknown, r: (v: unknown) => void) => unknown)(
          message,
          { tab: TAB },
          resolve
        );
      })
  );
  chromeMock.tabs.query.mockResolvedValue([{ id: TAB.id }]);
  chromeMock.tabs.captureVisibleTab.mockResolvedValue(`data:image/png;base64,${PNG_B64}`);

  Object.assign(globalThis, {
    WebSocket: RunnerSocket,
    document: doc,
    location: {
      host: 'example.com',
      pathname: '/app',
      origin: 'https://example.com',
      href: 'https://example.com/app',
    },
    window: { innerWidth: 1280, innerHeight: 720 },
    innerWidth: 1280,
    innerHeight: 720,
  });

  await import('../src/background/service-worker');
  await import('../src/content/live-relay');

  socket = await until(() => RunnerSocket.opened[0], 'the relay to open its socket');
  const register = await until(
    () => socket.sent.find((f) => f['type'] === 'register'),
    'the register frame'
  );
  socket.deliver({ type: 'registered', appId: register['appId'], connId: 1, acceptedAt: 0 });
});

describe('the booted live relay', () => {
  it('registers advertising screenshot and answers getScreenshot with the visible tab frame', async () => {
    const register = socket.sent.find((f) => f['type'] === 'register')!;
    expect(register).toMatchObject({ appId: 'example.com-app', capabilities: ['screenshot'] });

    doc.visibilityState = 'visible';
    const reply = await runnerCommand('shot-1', 'getScreenshot');
    expect(reply).toMatchObject({
      success: true,
      result: { screenshot: PNG_B64, width: 1280, height: 720 },
    });
    expect(chromeMock.tabs.captureVisibleTab).toHaveBeenCalledWith(TAB.windowId, { format: 'png' });
  });

  it('answers TAB_NOT_VISIBLE while the tab is hidden', async () => {
    doc.visibilityState = 'hidden';
    chromeMock.tabs.captureVisibleTab.mockClear();
    const reply = await runnerCommand('shot-2', 'getScreenshot');
    expect(reply).toMatchObject({
      success: false,
      error: { code: 'TAB_NOT_VISIBLE', retryable: true },
    });
    expect(chromeMock.tabs.captureVisibleTab).not.toHaveBeenCalled();
    doc.visibilityState = 'visible';
  });
});
