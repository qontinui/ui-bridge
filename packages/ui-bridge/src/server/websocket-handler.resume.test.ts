/**
 * Regression tests for WS tab-id resume (P0b).
 *
 * A reconnecting client that supplies its persisted `__uiBridge_tabId` (via the
 * `?tabId=` query the server adapter forwards as `preferredId`) must keep the
 * same server-side identity instead of churning a fresh id on every reconnect —
 * otherwise `?tabId=` command routing breaks. A stale socket's late `onclose`
 * must not evict the resumed client.
 */
import { describe, it, expect } from 'vitest';
import { UIBridgeWSHandler, type WebSocketLike } from './websocket-handler';

function fakeWs(): WebSocketLike & { sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    readyState: 1,
    send(data: string) {
      sent.push(data);
    },
    close() {
      /* no-op for tests */
    },
    onmessage: null,
    onclose: null,
    onerror: null,
  };
}

function welcomeClientId(ws: WebSocketLike & { sent: string[] }): string | undefined {
  for (const raw of ws.sent) {
    const msg = JSON.parse(raw);
    if (msg.type === 'welcome') return msg.payload?.clientId;
  }
  return undefined;
}

describe('UIBridgeWSHandler tab-id resume', () => {
  it('uses the client-supplied preferredId as the client id', () => {
    const handler = new UIBridgeWSHandler({});
    const ws = fakeWs();
    const id = handler.handleConnection(ws, 'tab-abc');
    expect(id).toBe('tab-abc');
    expect(welcomeClientId(ws)).toBe('tab-abc');
    expect(handler.clientCount).toBe(1);
  });

  it('falls back to a generated id when no preferredId is supplied', () => {
    const handler = new UIBridgeWSHandler({});
    const ws = fakeWs();
    const id = handler.handleConnection(ws);
    expect(id).not.toBe('');
    expect(welcomeClientId(ws)).toBe(id);
  });

  it('resumes the same id on reconnect and does not double-count', () => {
    const handler = new UIBridgeWSHandler({});
    const ws1 = fakeWs();
    handler.handleConnection(ws1, 'tab-1');
    expect(handler.clientCount).toBe(1);

    // Reconnect under the same id (new socket).
    const ws2 = fakeWs();
    const id2 = handler.handleConnection(ws2, 'tab-1');
    expect(id2).toBe('tab-1');
    expect(handler.clientCount).toBe(1); // resumed, not added

    // The stale socket's late close must NOT evict the resumed client.
    ws1.onclose?.();
    expect(handler.clientCount).toBe(1);

    // Closing the live socket DOES evict.
    ws2.onclose?.();
    expect(handler.clientCount).toBe(0);
  });
});
