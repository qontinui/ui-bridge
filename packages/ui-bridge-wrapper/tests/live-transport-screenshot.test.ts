/**
 * LiveSessionTransport answers `getScreenshot` when given a page (plan
 * 2026-11-21-vision-capture-cannot-frame-a-websocket-transport-app, Phase 3).
 *
 * The runner relays `getScreenshot` over the app's socket only to an app whose
 * register frame advertises `screenshot`. These tests drive the transport
 * through a fake socket, so the register frame and the `response` frames are
 * the exact bytes the runner would read.
 */

import { describe, it, expect } from 'vitest';
import { LiveSessionTransport, type LiveTransportOptions } from '../src/transports/live.js';
import { createTransport } from '../src/create-transport.js';
import { HandlerRegistry } from '../src/handler-registry.js';
import { WrapperTransportError } from '../src/types.js';
import {
  captureScreenshotReply,
  registerScreenshotCapture,
  SCREENSHOT_ACTION,
  SCREENSHOT_CAPABILITY,
  type FramePage,
} from '../src/frame-capture.js';
import * as pkg from '../src/index.js';

type Listener = (ev?: unknown) => void;

class FakeWebSocket {
  static last: FakeWebSocket | null = null;
  readonly sent: string[] = [];
  readyState = 0;
  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) {
    FakeWebSocket.last = this;
    queueMicrotask(() => {
      this.readyState = 1;
      this.emit('open');
    });
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
  }

  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  emit(type: string, ev?: unknown): void {
    for (const l of this.listeners.get(type) ?? []) l(ev);
  }

  receive(frame: unknown): void {
    this.emit('message', { data: JSON.stringify(frame) });
  }
}

/** A minimal PNG: signature + IHDR declaring `w`×`h`. Enough for `pngDimensions`. */
function fakePng(w: number, h: number): Uint8Array {
  const buf = new Uint8Array(33);
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(buf.buffer);
  view.setUint32(8, 13);
  buf.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  view.setUint32(16, w);
  view.setUint32(20, h);
  return buf;
}

function fakePage(screenshot: () => Promise<Uint8Array>): FramePage & { shots: number } {
  const page = {
    shots: 0,
    async evaluate<R>(): Promise<R> {
      return {
        devicePixelRatio: 2,
        innerWidth: 640,
        innerHeight: 480,
        colorScheme: 'light',
      } as unknown as R;
    },
    async screenshot(): Promise<Uint8Array> {
      page.shots += 1;
      return screenshot();
    },
  };
  return page;
}

async function connect(options: LiveTransportOptions): Promise<{
  transport: LiveSessionTransport;
  ws: FakeWebSocket;
}> {
  FakeWebSocket.last = null;
  const transport = new LiveSessionTransport(
    { kind: 'live', runnerUrl: 'ws://127.0.0.1:9876/ui-bridge/ws', appId: 'shot-app', options },
    undefined,
    { webSocketCtor: FakeWebSocket as never }
  );
  const ready = transport.ready();
  let ws: FakeWebSocket | null = null;
  for (let i = 0; i < 20 && !(ws && ws.sent.length > 0); i++) {
    ws = FakeWebSocket.last;
    await Promise.resolve();
  }
  if (!ws || ws.sent.length === 0) throw new Error('register frame never sent');
  ws.receive({ type: 'registered', appId: 'shot-app', connId: 1, acceptedAt: 0 });
  await ready;
  return { transport, ws };
}

/** Send a `command` frame and wait for its `response` frame. */
async function command(ws: FakeWebSocket, action: string): Promise<Record<string, unknown>> {
  const commandId = `cmd-${Math.random().toString(36).slice(2)}`;
  ws.receive({ type: 'command', commandId, action, payload: {} });
  for (let i = 0; i < 200; i++) {
    for (const raw of ws.sent) {
      const f = JSON.parse(raw) as Record<string, unknown>;
      if (f['type'] === 'response' && f['commandId'] === commandId) return f;
    }
    await new Promise((r) => setTimeout(r, 1));
  }
  throw new Error(`no response frame for ${action}`);
}

describe('LiveSessionTransport getScreenshot', () => {
  it('with screenshotPage: advertises the capability and answers {screenshot, width, height}', async () => {
    const png = fakePng(1280, 960);
    const page = fakePage(async () => png);
    const { transport, ws } = await connect({ capabilities: ['custom'], screenshotPage: page });

    const register = JSON.parse(ws.sent[0]!) as Record<string, unknown>;
    expect(register['type']).toBe('register');
    expect(register['capabilities']).toEqual(['custom', SCREENSHOT_CAPABILITY]);
    // The page handle is never serialized into the frame.
    expect(register).not.toHaveProperty('screenshotPage');

    const reply = await command(ws, SCREENSHOT_ACTION);
    expect(reply['success']).toBe(true);
    expect(reply['result']).toEqual({
      screenshot: Buffer.from(png).toString('base64'),
      width: 640,
      height: 480,
    });
    await transport.close();
  });

  it('does not duplicate a hand-listed screenshot capability', async () => {
    const page = fakePage(async () => fakePng(2, 2));
    const { transport, ws } = await connect({ capabilities: ['screenshot'], screenshotPage: page });
    expect(JSON.parse(ws.sent[0]!)['capabilities']).toEqual(['screenshot']);
    await transport.close();
  });

  it('without screenshotPage: no capability, and getScreenshot answers NO_HANDLER', async () => {
    const { transport, ws } = await connect({});
    const register = JSON.parse(ws.sent[0]!) as Record<string, unknown>;
    expect(register).not.toHaveProperty('capabilities');

    const reply = await command(ws, SCREENSHOT_ACTION);
    expect(reply['success']).toBe(false);
    expect((reply['error'] as { code: string }).code).toBe('NO_HANDLER');
    await transport.close();
  });

  it('a page whose screenshot throws answers success:false with a typed code', async () => {
    const page = fakePage(async () => {
      throw new Error('Target page, context or browser has been closed');
    });
    const { transport, ws } = await connect({ screenshotPage: page });
    const reply = await command(ws, SCREENSHOT_ACTION);
    expect(reply['success']).toBe(false);
    const error = reply['error'] as { code: string; message: string; retryable: boolean };
    expect(error.code).toBe('SCREENSHOT_FAILED');
    expect(error.message).toContain('has been closed');
    expect(error.retryable).toBe(false);
    await transport.close();
  });

  it('refuses a screenshotPage that is not a page', () => {
    expect(
      () =>
        new LiveSessionTransport(
          {
            kind: 'live',
            runnerUrl: 'ws://127.0.0.1:9876/ui-bridge/ws',
            options: { screenshotPage: {} as FramePage },
          },
          undefined,
          { webSocketCtor: FakeWebSocket as never }
        )
    ).toThrow(/screenshotPage/);
  });

  it('createTransport threads options.screenshotPage through the live case', () => {
    const t = createTransport({
      kind: 'live',
      runnerUrl: 'ws://127.0.0.1:9876/ui-bridge/ws',
      options: {
        webSocketCtor: FakeWebSocket,
        screenshotPage: fakePage(async () => fakePng(1, 1)),
      },
    });
    expect(t.handlerRegistry.has(SCREENSHOT_ACTION)).toBe(true);
  });

  it('exports the capability and action constants from the package index', () => {
    expect(pkg.SCREENSHOT_CAPABILITY).toBe('screenshot');
    expect(pkg.SCREENSHOT_ACTION).toBe('getScreenshot');
    expect(typeof pkg.registerScreenshotCapture).toBe('function');
  });
});

describe('captureScreenshotReply bounds and retry', () => {
  it("retries Chromium's no-compositor-frame refusal, then answers", async () => {
    let calls = 0;
    const page = fakePage(async () => {
      calls += 1;
      if (calls < 3) throw new Error('Protocol error: Unable to capture screenshot');
      return fakePng(4, 4);
    });
    const reply = await captureScreenshotReply(page, { retryMs: 1 });
    expect(calls).toBe(3);
    expect(reply.width).toBe(640);
  });

  it('does not retry any other screenshot error', async () => {
    const page = fakePage(async () => {
      throw new Error('boom');
    });
    await expect(captureScreenshotReply(page, { retryMs: 1 })).rejects.toMatchObject({
      code: 'SCREENSHOT_FAILED',
    });
    expect(page.shots).toBe(1);
  });

  it('surfaces a capture that outlives the bound as retryable SCREENSHOT_TIMEOUT', async () => {
    const page = fakePage(() => new Promise<Uint8Array>(() => {}));
    const err = await captureScreenshotReply(page, { timeoutMs: 20 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WrapperTransportError);
    expect((err as WrapperTransportError).code).toBe('SCREENSHOT_TIMEOUT');
    expect((err as WrapperTransportError).retryable).toBe(true);
  });

  it('a refusal that persists to the bound stops retrying and reports a typed error', async () => {
    const page = fakePage(async () => {
      throw new Error('Unable to capture screenshot');
    });
    const err = (await captureScreenshotReply(page, { timeoutMs: 40, retryMs: 5 }).catch(
      (e: unknown) => e
    )) as WrapperTransportError;
    expect(['SCREENSHOT_TIMEOUT', 'SCREENSHOT_FAILED']).toContain(err.code);
    expect(err.retryable).toBe(true);
    const shotsAtEnd = page.shots;
    await new Promise((r) => setTimeout(r, 30));
    expect(page.shots).toBe(shotsAtEnd);
  });

  it('a non-PNG screenshot is SCREENSHOT_FAILED, not a reply', async () => {
    const page = fakePage(async () => new Uint8Array([1, 2, 3]));
    await expect(captureScreenshotReply(page)).rejects.toMatchObject({ code: 'SCREENSHOT_FAILED' });
  });

  it('registerScreenshotCapture registers exactly the getScreenshot action', () => {
    const registry = new HandlerRegistry();
    registerScreenshotCapture(
      registry,
      fakePage(async () => fakePng(1, 1))
    );
    expect(registry.list()).toEqual([SCREENSHOT_ACTION]);
  });
});
