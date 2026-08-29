import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

import { DeviceAnnouncer } from './DeviceAnnouncer';

/**
 * `DeviceAnnouncer` is the second dialler of the cloud relay, and it carried
 * every defect that was fixed in `CloudRelayClient`:
 *
 *  - it built `<cloudRelayUrl>?token=<cloudToken>` — the SAME device auth token
 *    `CloudRelayClient` uses — and logged it VERBATIM on connect, into
 *    `transportLogger`, whose sink is the ring buffer behind
 *    `GET /control/console-errors`. Redacting one of two sinks for one secret
 *    is not a redaction.
 *  - its `onerror` logged the bare event, which a DOM `CloseEvent`/`ErrorEvent`
 *    renders as `{}` under `JSON.stringify` (no own enumerable properties).
 *  - its `onclose` logged NOTHING at all, so a relay that rejects this device's
 *    token was indistinguishable from a flaky network — the announcer just
 *    reconnected forever in silence.
 */

const RELAY_URL = 'wss://relay.qontinui.io/device-bridge';
const CLOUD_TOKEN = 'super-secret-device-token';

interface FakeSocket {
  url: string;
  onopen: (() => void) | null;
  onmessage: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  readyState: number;
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

function newAnnouncer(): DeviceAnnouncer {
  return new DeviceAnnouncer({
    deviceId: 'device-1',
    appId: 'io.qontinui.mobile',
    cloudRelayUrl: RELAY_URL,
    cloudToken: CLOUD_TOKEN,
  });
}

describe('DeviceAnnouncer — cloud relay diagnostics and token hygiene', () => {
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

  it('still dials the relay with the real token', async () => {
    const announcer = newAnnouncer();
    await announcer.connectCloudRelay();

    // Redaction is a LOGGING concern — the socket must still carry the token.
    expect(sockets[0]!.url).toContain(`token=${encodeURIComponent(CLOUD_TOKEN)}`);
    await announcer.stop();
  });

  it('never writes the auth token to any log sink', async () => {
    const announcer = newAnnouncer();
    await announcer.connectCloudRelay();
    const socket = sockets[0]!;
    socket.onerror?.({ message: 'boom' });
    socket.onclose?.({ code: 1008, reason: 'unauthorized', wasClean: true });
    await announcer.stop();

    const emitted = [...warnSpy.mock.calls, ...logSpy.mock.calls].flat().map(String).join(' ');
    expect(emitted).not.toContain(CLOUD_TOKEN);
    expect(emitted).toContain('token=<redacted>');
    // …and the failure is still diagnosable from what IS emitted.
    expect(emitted).toContain('code=1008');
    expect(emitted).toContain('reason=unauthorized');
  });

  it('names the close code on an unexpected close instead of saying nothing', async () => {
    const announcer = newAnnouncer();
    await announcer.connectCloudRelay();

    sockets[0]!.onclose?.({ code: 1006, reason: 'abnormal closure', wasClean: false });
    await announcer.stop(); // clear the scheduled reconnect

    const message = String(warnSpy.mock.calls.at(-1)?.[0]);
    expect(message).toContain('code=1006');
    expect(message).toContain('reason=abnormal closure');
    expect(message).toContain('wasClean=false');
    expect(message).toContain(RELAY_URL);
  });

  it('reports UNKNOWN rather than `undefined` for fields the transport omitted', async () => {
    const announcer = newAnnouncer();
    await announcer.connectCloudRelay();

    sockets[0]!.onclose?.({});
    await announcer.stop();

    const message = String(warnSpy.mock.calls.at(-1)?.[0]);
    expect(message).toContain('code=unknown');
    expect(message).toContain('reason=(none)');
    expect(message).toContain('wasClean=unknown');
    expect(message).not.toContain('undefined');
  });

  it('renders an error event as fields rather than `{}`', async () => {
    const announcer = newAnnouncer();
    await announcer.connectCloudRelay();

    sockets[0]!.onerror?.({ message: 'Connection reset by peer' });
    await announcer.stop();

    const message = String(warnSpy.mock.calls.at(-1)?.[0]);
    expect(message).toContain('message=Connection reset by peer');
    expect(message).toContain(RELAY_URL);
  });

  it('still says something useful when the error event carries nothing at all', async () => {
    const announcer = newAnnouncer();
    await announcer.connectCloudRelay();

    sockets[0]!.onerror?.({});
    await announcer.stop();

    expect(String(warnSpy.mock.calls.at(-1)?.[0])).toContain('none reported by the transport');
  });

  it('does not warn for a close we asked for', async () => {
    const announcer = newAnnouncer();
    await announcer.connectCloudRelay();
    const socket = sockets[0]!;
    await announcer.stop();

    // `stop()` NULLS the handler on the live socket before closing it, so this
    // frame reaches nothing — that is the real mechanism, and the assertion
    // below is about the whole shutdown emitting no warning, not about the
    // handler's `stopped` arm (which this fixture cannot reach; see the arm's
    // own comment in DeviceAnnouncer.ts).
    expect(socket.onclose).toBeNull();
    socket.onclose?.({ code: 1000, reason: '', wasClean: true });
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
