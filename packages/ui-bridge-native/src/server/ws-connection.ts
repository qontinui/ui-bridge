/**
 * WebSocket connection wrapper for the UI Bridge server.
 *
 * Manages a single WebSocket connection after the HTTP upgrade handshake,
 * handling frame-level I/O, heartbeat, and event subscriptions.
 */

import {
  decodeFrames,
  decodeTextPayload,
  encodeTextFrame,
  encodePingFrame,
  encodePongFrame,
  encodeCloseFrame,
  OPCODE_TEXT,
  OPCODE_CLOSE,
  OPCODE_PING,
  OPCODE_PONG,
  OPCODE_CONTINUATION,
  type DecodedFrame,
} from './ws-protocol';
import type { JsonRpcEvent } from './ws-types';
import { globToRegex } from './ws-event-bridge';

/**
 * Callback for text messages received from the client.
 * Returns a response string to send back, or null for no response.
 */
export type WebSocketMessageHandler = (
  connId: string,
  message: string
) => Promise<string | null>;

export class WebSocketConnection {
  readonly id: string;
  readonly subscriptions = new Set<string>();

  /** Heartbeat liveness flag — set false before ping, set true on pong */
  alive = true;

  private socket: {
    write: (data: Uint8Array | string, encoding?: string, cb?: () => void) => void;
    destroy: () => void;
    on: (event: string, handler: (...args: unknown[]) => void) => void;
    removeAllListeners: (event?: string) => void;
    setNoDelay?: (noDelay: boolean) => void;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private buffer: Uint8Array<any> = new Uint8Array(0);
  private fragmentBuffer: Uint8Array[] = [];
  private fragmentOpcode = 0;
  private closed = false;
  private onMessage: WebSocketMessageHandler;
  private onClose: (connId: string) => void;

  constructor(
    id: string,
    socket: WebSocketConnection['socket'],
    onMessage: WebSocketMessageHandler,
    onClose: (connId: string) => void
  ) {
    this.id = id;
    this.socket = socket;
    this.onMessage = onMessage;
    this.onClose = onClose;

    // Disable Nagle's algorithm for low latency
    if (socket.setNoDelay) {
      socket.setNoDelay(true);
    }

    // Wire up data handler
    socket.on('data', (data: unknown) => {
      if (this.closed) return;
      const chunk =
        data instanceof Uint8Array
          ? data
          : typeof data === 'string'
            ? new TextEncoder().encode(data)
            : new Uint8Array(data as ArrayBuffer);
      this.handleData(chunk);
    });

    socket.on('error', () => {
      this.destroy();
    });

    socket.on('close', () => {
      this.destroy();
    });
  }

  /** Send a text message to the client. */
  send(message: string): void {
    if (this.closed) return;
    try {
      const frame = encodeTextFrame(message);
      this.writeRaw(frame);
    } catch {
      // Socket may be closed
    }
  }

  /**
   * Send an event if the client is subscribed to it. Subscription patterns
   * may be exact event names, `*` (all), or glob patterns containing `*`
   * (e.g. `element:*`, `*:stateChanged`). Exact matches and `*` are checked
   * via fast Set lookups; glob patterns fall through to a regex test.
   */
  sendEvent(event: JsonRpcEvent): void {
    if (this.closed) return;
    if (!this.matchesSubscription(event.event)) return;
    this.send(JSON.stringify(event));
  }

  private matchesSubscription(eventType: string): boolean {
    // Fast paths
    if (this.subscriptions.has(eventType)) return true;
    if (this.subscriptions.has('*')) return true;
    // Glob fallback — only patterns containing `*` (other than the bare `*`
    // already handled above) need the regex test.
    for (const pattern of this.subscriptions) {
      if (!pattern.includes('*')) continue;
      if (globToRegex(pattern).test(eventType)) return true;
    }
    return false;
  }

  /** Send a ping frame for heartbeat. */
  ping(): void {
    if (this.closed) return;
    try {
      this.writeRaw(encodePingFrame());
    } catch {
      // Socket may be closed
    }
  }

  /** Close the connection gracefully. */
  close(code = 1000, reason = ''): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.writeRaw(encodeCloseFrame(code, reason));
      // Give the frame time to flush before destroying
      setTimeout(() => this.socket.destroy(), 100);
    } catch {
      this.socket.destroy();
    }
    this.onClose(this.id);
  }

  /** Forcefully destroy the connection without a close frame. */
  destroy(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.socket.destroy();
    } catch {
      // Already destroyed
    }
    this.onClose(this.id);
  }

  /** Whether the connection is still open. */
  get isOpen(): boolean {
    return !this.closed;
  }

  // ── Internal ────────────────────────────────────────────────────────────

  private writeRaw(data: Uint8Array): void {
    // react-native-tcp-socket write() accepts Buffer/Uint8Array/string.
    // Convert to binary string for compatibility with all socket implementations.
    // Use chunked String.fromCharCode to avoid call-stack limits on large payloads
    // while staying O(n) instead of O(n^2) from single-char concatenation.
    const CHUNK = 8192;
    const parts: string[] = [];
    for (let i = 0; i < data.length; i += CHUNK) {
      const end = Math.min(i + CHUNK, data.length);
      parts.push(String.fromCharCode.apply(null, data.subarray(i, end) as unknown as number[]));
    }
    this.socket.write(parts.join(''), 'binary');
  }

  private handleData(chunk: Uint8Array): void {
    // Append to buffer
    const newBuffer = new Uint8Array(this.buffer.length + chunk.length);
    newBuffer.set(this.buffer);
    newBuffer.set(chunk, this.buffer.length);
    this.buffer = newBuffer;

    // Decode frames
    const { frames, remainder } = decodeFrames(this.buffer);
    this.buffer = remainder;

    for (const frame of frames) {
      this.handleFrame(frame);
    }
  }

  private handleFrame(frame: DecodedFrame): void {
    // Handle fragmented messages
    if (!frame.fin && frame.opcode !== OPCODE_CONTINUATION) {
      // Start of fragmented message
      this.fragmentBuffer = [frame.payload];
      this.fragmentOpcode = frame.opcode;
      return;
    }

    if (frame.opcode === OPCODE_CONTINUATION) {
      this.fragmentBuffer.push(frame.payload);
      if (!frame.fin) return; // More fragments coming

      // Reassemble
      const totalLen = this.fragmentBuffer.reduce((sum, buf) => sum + buf.length, 0);
      const reassembled = new Uint8Array(totalLen);
      let offset = 0;
      for (const buf of this.fragmentBuffer) {
        reassembled.set(buf, offset);
        offset += buf.length;
      }
      this.fragmentBuffer = [];

      // Process as the original opcode
      this.handleFrame({
        opcode: this.fragmentOpcode,
        fin: true,
        payload: reassembled,
        masked: true,
      });
      return;
    }

    switch (frame.opcode) {
      case OPCODE_TEXT: {
        const text = decodeTextPayload(frame.payload);
        this.onMessage(this.id, text)
          .then((response) => {
            if (response !== null) {
              this.send(response);
            }
          })
          .catch((err) => {
            console.warn(`[ws-connection] message handler error:`, err);
            this.send(
              JSON.stringify({
                error: 'Internal error',
                timestamp: Date.now(),
              })
            );
          });
        break;
      }

      case OPCODE_PING:
        // Respond with PONG carrying the same payload
        try {
          this.writeRaw(encodePongFrame(frame.payload));
        } catch {
          // Socket may be closed
        }
        break;

      case OPCODE_PONG:
        this.alive = true;
        break;

      case OPCODE_CLOSE:
        this.close();
        break;
    }
  }
}
