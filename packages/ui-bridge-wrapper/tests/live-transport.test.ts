/**
 * LiveSessionTransport handshake refusal (plan
 * 2026-09-17-ui-bridge-relay-registration-is-unauthenticated, Phase 1b).
 *
 * The runner refuses a WebSocket registration by sending
 * `{type:"ack", ok:false, error:{code, message}}` and closing the socket
 * (`ws_relay.rs` `refuse_handshake`). `ready()` must reject with the runner's
 * `UIB_*` code — not a generic handshake/close error — so a caller can tell
 * "another app holds this appId" apart from "the runner went away".
 */

import { describe, it, expect } from 'vitest';
import { LiveSessionTransport } from '../src/transports/live.js';
import { WrapperTransportError } from '../src/types.js';

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

  /** Deliver a server frame. */
  receive(frame: unknown): void {
    this.emit('message', { data: JSON.stringify(frame) });
  }
}

function makeTransport(): LiveSessionTransport {
  return new LiveSessionTransport(
    { kind: 'live', runnerUrl: 'ws://127.0.0.1:9876/ui-bridge/ws', appId: 'victim-app' },
    undefined,
    { webSocketCtor: FakeWebSocket as never }
  );
}

/** Wait until the transport has sent its register frame. */
async function registered(): Promise<FakeWebSocket> {
  for (let i = 0; i < 20; i++) {
    const ws = FakeWebSocket.last;
    if (ws && ws.sent.length > 0) return ws;
    await Promise.resolve();
  }
  throw new Error('register frame never sent');
}

describe('LiveSessionTransport handshake refusal', () => {
  for (const [frameType, code] of [
    ['ack', 'UIB_REGISTRATION_HELD'],
    ['ack', 'UIB_ORIGIN_MISMATCH'],
    ['registered', 'UIB_OPAQUE_ORIGIN'],
  ] as const) {
    it(`rejects ready() with ${code} from a ${frameType} ok:false frame`, async () => {
      FakeWebSocket.last = null;
      const transport = makeTransport();
      const ready = transport.ready();
      const ws = await registered();

      expect(JSON.parse(ws.sent[0])).toMatchObject({ type: 'register', appId: 'victim-app' });

      ws.receive({
        type: frameType,
        ok: false,
        error: { code, message: 'refused by the runner' },
      });
      // The runner closes right after the refusal; the close must not
      // overwrite the refusal code with a generic DISCONNECTED.
      ws.emit('close');

      const err = await ready.then(
        () => {
          throw new Error('ready() resolved despite a refusal');
        },
        (e: unknown) => e
      );
      expect(err).toBeInstanceOf(WrapperTransportError);
      expect((err as WrapperTransportError).code).toBe(code);
      expect((err as WrapperTransportError).message).toBe('refused by the runner');
      expect(transport.status).not.toBe('ready');
    });
  }

  it('resolves ready() on an ok ack', async () => {
    FakeWebSocket.last = null;
    const transport = makeTransport();
    const ready = transport.ready();
    const ws = await registered();
    ws.receive({ type: 'registered', appId: 'victim-app', connId: 1, acceptedAt: 0 });
    await expect(ready).resolves.toBeUndefined();
    expect(transport.status).toBe('ready');
    await transport.close();
  });
});

/**
 * The runner's RegisterFrame requires a non-blank `appId` and `appName`
 * (qontinui-runner src-tauri/src/mcp/ws_relay.rs): a frame missing either is
 * refused and the socket closed before the ack, which the caller would see as
 * DISCONNECTED "WebSocket closed before ack".
 */
describe('LiveSessionTransport register frame always carries appName', () => {
  async function registerFrameFor(config: { appId?: string; appName?: string }) {
    FakeWebSocket.last = null;
    const transport = new LiveSessionTransport(
      { kind: 'live', runnerUrl: 'ws://127.0.0.1:9876/ui-bridge/ws', ...config },
      undefined,
      { webSocketCtor: FakeWebSocket as never }
    );
    const ready = transport.ready();
    const ws = await registered();
    const frame = JSON.parse(ws.sent[0]!) as Record<string, unknown>;
    ws.receive({ type: 'registered', appId: config.appId, connId: 1, acceptedAt: 0 });
    await ready;
    await transport.close();
    return frame;
  }

  it('sends the configured appName', async () => {
    const frame = await registerFrameFor({ appId: 'my-app', appName: 'My app' });
    expect(frame['appName']).toBe('My app');
  });

  it('defaults appName to appId when only appId is configured', async () => {
    const frame = await registerFrameFor({ appId: 'my-app' });
    expect(frame['appName']).toBe('my-app');
    expect(frame['appId']).toBe('my-app');
  });

  it('defaults a blank appName to appId', async () => {
    const frame = await registerFrameFor({ appId: 'my-app', appName: '  ' });
    expect(frame['appName']).toBe('my-app');
  });

  it('refuses a missing or blank appId with INVALID_CONFIG', () => {
    for (const appId of [undefined, '', '   ']) {
      expect(
        () =>
          new LiveSessionTransport(
            { kind: 'live', runnerUrl: 'ws://127.0.0.1:9876/ui-bridge/ws', appId },
            undefined,
            { webSocketCtor: FakeWebSocket as never }
          )
      ).toThrow(expect.objectContaining({ code: 'INVALID_CONFIG' }));
    }
  });
});
