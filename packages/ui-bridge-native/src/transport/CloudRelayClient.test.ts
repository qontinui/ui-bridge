import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CloudRelayClient, redactRelayUrl } from './CloudRelayClient';
import type { NativeUIBridgeServer } from '../server/http-server';

/**
 * Cloud-relay WebSocket diagnostics.
 *
 * The relay used to log a failure as the raw event object. A DOM `CloseEvent`
 * (and React Native's stand-in) has no own enumerable properties, so the
 * observability capture's `JSON.stringify` rendered every tunnel death as an
 * empty `{}` in `/control/console-errors` — no close code, no reason, no target
 * URL. There was nothing in the record to distinguish "the relay rejected our
 * token" from "the phone lost its network".
 *
 * The target URL carries the device auth token in a `token=` query parameter,
 * so naming the URL in a log is only safe redacted.
 */

const RELAY_URL = 'wss://relay.qontinui.io/device-bridge';
const AUTH_TOKEN = 'super-secret-device-token';

interface FakeSocket {
  url: string;
  onopen: (() => void) | null;
  onmessage: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  readyState: number;
  send: (data: string) => void;
  close: () => void;
}

let sockets: FakeSocket[] = [];

class FakeWebSocket implements FakeSocket {
  static readonly OPEN = 1;
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  readyState = 1;

  constructor(url: string) {
    this.url = url;
    sockets.push(this);
  }

  send(): void {
    /* no-op */
  }

  close(): void {
    /* no-op */
  }
}

function newClient(): CloudRelayClient {
  return new CloudRelayClient({
    relayUrl: RELAY_URL,
    deviceId: 'device-1',
    authToken: AUTH_TOKEN,
    uiBridgeServer: {} as NativeUIBridgeServer,
  });
}

describe('redactRelayUrl', () => {
  it('masks the token query parameter', () => {
    expect(redactRelayUrl(`${RELAY_URL}?token=${AUTH_TOKEN}`)).toBe(
      `${RELAY_URL}?token=<redacted>`
    );
  });

  it('masks the token when it is not the first parameter, keeping the rest', () => {
    expect(redactRelayUrl(`${RELAY_URL}?v=2&token=${AUTH_TOKEN}&mode=tunnel`)).toBe(
      `${RELAY_URL}?v=2&token=<redacted>&mode=tunnel`
    );
  });

  it('leaves a URL with no token untouched', () => {
    expect(redactRelayUrl(RELAY_URL)).toBe(RELAY_URL);
  });
});

describe('CloudRelayClient — WebSocket failure diagnostics', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let originalWebSocket: unknown;

  beforeEach(() => {
    sockets = [];
    originalWebSocket = (globalThis as Record<string, unknown>).WebSocket;
    (globalThis as Record<string, unknown>).WebSocket = FakeWebSocket;
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>).WebSocket = originalWebSocket;
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('names the close code, reason, wasClean and target URL on an unexpected close', () => {
    const client = newClient();
    client.start();
    const socket = sockets[0]!;

    socket.onclose?.({ code: 1006, reason: 'abnormal closure', wasClean: false });
    client.stop(); // clear the scheduled reconnect

    const message = String(warnSpy.mock.calls.at(-1)?.[0]);
    expect(message).toContain('code=1006');
    expect(message).toContain('reason=abnormal closure');
    expect(message).toContain('wasClean=false');
    expect(message).toContain(RELAY_URL);
  });

  it('reports UNKNOWN rather than `undefined` for fields the transport omitted', () => {
    const client = newClient();
    client.start();
    const socket = sockets[0]!;

    socket.onclose?.({});
    client.stop();

    const message = String(warnSpy.mock.calls.at(-1)?.[0]);
    expect(message).toContain('code=unknown');
    expect(message).toContain('reason=(none)');
    expect(message).toContain('wasClean=unknown');
    expect(message).not.toContain('undefined');
  });

  it('names the error message and target URL on onerror', () => {
    const client = newClient();
    client.start();
    const socket = sockets[0]!;

    // React Native's WebSocket delivers an error event carrying `message`.
    socket.onerror?.({ message: 'Connection reset by peer' });
    client.stop();

    const message = String(warnSpy.mock.calls.at(-1)?.[0]);
    expect(message).toContain('message=Connection reset by peer');
    expect(message).toContain(RELAY_URL);
  });

  it('still says something useful when the error event carries nothing at all', () => {
    const client = newClient();
    client.start();
    sockets[0]!.onerror?.({});
    client.stop();

    expect(String(warnSpy.mock.calls.at(-1)?.[0])).toContain('none reported by the transport');
  });

  it('never writes the auth token to any log sink', () => {
    const client = newClient();
    client.start();
    const socket = sockets[0]!;
    socket.onerror?.({ message: 'boom' });
    socket.onclose?.({ code: 1008, reason: 'unauthorized', wasClean: true });
    client.stop();

    const emitted = [...warnSpy.mock.calls, ...logSpy.mock.calls].flat().map(String).join(' ');
    expect(emitted).not.toContain(AUTH_TOKEN);
    expect(emitted).toContain('token=<redacted>');
    // …and the connection is still diagnosable from what IS emitted.
    expect(emitted).toContain('code=1008');
  });

  it('does not warn for a close we asked for', () => {
    const client = newClient();
    client.start();
    const socket = sockets[0]!;
    client.stop();

    // `stop()` nulls the handler on the live socket; a late frame from a socket
    // the client already released must not be reported as a failure either.
    socket.onclose?.({ code: 1000, reason: '', wasClean: true });
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
