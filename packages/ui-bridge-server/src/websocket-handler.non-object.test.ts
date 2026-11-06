/**
 * A WebSocket frame that is valid JSON but not an object is refused with an
 * error frame. `null` used to throw on `message.type` outside the try block,
 * and `onmessage` did not catch the rejection, so the process exited.
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
    close() {},
    onmessage: null,
    onclose: null,
    onerror: null,
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('UIBridgeWSHandler — a frame that is not a JSON object', () => {
  for (const frame of ['null', '1', '"x"', '[]', 'true']) {
    it(`answers ${frame} with an error frame`, async () => {
      const handler = new UIBridgeWSHandler({}, { verbose: true, log: () => {} });
      const ws = fakeWs();
      handler.handleConnection(ws);
      const before = ws.sent.length;
      ws.onmessage!({ data: frame });
      await settle();
      const replies = ws.sent.slice(before).map((raw) => JSON.parse(raw));
      expect(replies).toHaveLength(1);
      expect(replies[0].type).toBe('error');
      expect(replies[0].payload.code).toBe('PARSE_ERROR');
    });
  }

  it('answers a type that cannot be stringified with an error frame', async () => {
    const handler = new UIBridgeWSHandler({}, { verbose: true, log: () => {} });
    const ws = fakeWs();
    handler.handleConnection(ws);
    const before = ws.sent.length;
    ws.onmessage!({ data: '{"type":{"toString":1}}' });
    await settle();
    const replies = ws.sent.slice(before).map((raw) => JSON.parse(raw));
    expect(replies).toHaveLength(1);
    expect(replies[0].type).toBe('error');
  });

  it('still serves the connection afterwards', async () => {
    const handler = new UIBridgeWSHandler({}, { verbose: true, log: () => {} });
    const ws = fakeWs();
    handler.handleConnection(ws);
    ws.onmessage!({ data: 'null' });
    await settle();
    const before = ws.sent.length;
    ws.onmessage!({ data: JSON.stringify({ type: 'ping', id: 'p1' }) });
    await settle();
    expect(JSON.parse(ws.sent[before]).type).toBe('pong');
  });
});
