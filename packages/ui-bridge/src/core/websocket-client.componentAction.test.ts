/**
 * The bundled WebSocket client can send the component-action request fields
 * the WS handlers forward: `timeoutMs`, `verifyEffect` and `requestId`.
 *
 * Every expectation is a hand-written literal.
 */

import { describe, it, expect, vi } from 'vitest';
import { UIBridgeWSClient } from './websocket-client';

/** The message the client would put on the socket, captured before it is sent. */
function captureSend(client: UIBridgeWSClient): Array<Record<string, unknown>> {
  const sent: Array<Record<string, unknown>> = [];
  vi.spyOn(
    client as unknown as { sendRequest: () => Promise<unknown> },
    'sendRequest'
  ).mockImplementation((async (message: Record<string, unknown>) => {
    sent.push(message);
    return { success: true };
  }) as never);
  return sent;
}

describe('UIBridgeWSClient.executeComponentAction', () => {
  it('carries verifyEffect and requestId in the payload', async () => {
    const client = new UIBridgeWSClient({ url: 'ws://127.0.0.1:1/ws', autoReconnect: false });
    const sent = captureSend(client);

    await client.executeComponentAction('drawer', 'open', { a: 1 }, 500, {
      verifyEffect: true,
      requestId: 'req-c',
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe('executeComponentAction');
    expect(sent[0].payload).toEqual({
      componentId: 'drawer',
      action: 'open',
      params: { a: 1 },
      timeoutMs: 500,
      verifyEffect: true,
      requestId: 'req-c',
    });
  });

  it('omits both when the caller passes no options', async () => {
    const client = new UIBridgeWSClient({ url: 'ws://127.0.0.1:1/ws', autoReconnect: false });
    const sent = captureSend(client);

    await client.executeComponentAction('drawer', 'open');

    expect(JSON.parse(JSON.stringify(sent[0].payload))).toEqual({
      componentId: 'drawer',
      action: 'open',
    });
  });
});
