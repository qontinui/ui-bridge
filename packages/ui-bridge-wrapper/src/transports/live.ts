/**
 * LiveSessionTransport
 *
 * Connects to the qontinui runner's wrapper-session WebSocket endpoint,
 * registers as a wrapper instance, and translates incoming `command`
 * frames into local handler invocations. Responses flow back as
 * `response` frames matched by `commandId`.
 *
 * Frame shapes match the Phase 1 runner protocol:
 *
 *   client -> server:
 *     { "type": "register", "transport": "websocket", "appId", "appName" }
 *     { "type": "response", "commandId", "success", "result"?, "error"? }
 *
 *   server -> client:
 *     { "type": "ack" }
 *     { "type": "command", "commandId", "action", "payload"? }
 *
 * The transport also exposes `dispatch` for direct, self-issued commands —
 * useful in tests and in wrappers that want to invoke their own actions
 * without round-tripping through the runner.
 */

import { BaseTransport } from '../base-transport.js';
import { HandlerRegistry } from '../handler-registry.js';
import type { TransportConfig, WrapperTransportKind } from '../types.js';
import { WrapperTransportError } from '../types.js';

/** Options extracted from `TransportConfig.options` for the live transport. */
export interface LiveTransportOptions {
  /** Max time to wait for the server ack after `register`. Defaults to 10 000 ms. */
  handshakeTimeoutMs?: number;
  /** Bearer token for the `Authorization` header on the WebSocket upgrade. */
  authToken?: string;
}

/** Context delivered to live-session handlers. */
export interface LiveContext {
  readonly kind: 'live';
  /** commandId the runner attached to this dispatch, if any. */
  readonly commandId: string | null;
}

/**
 * Minimal WebSocket contract, intersection of browser `WebSocket` and
 * `ws.WebSocket`. Keeps the transport usable in both Node and browser
 * without pulling `ws` as a hard dep.
 */
interface MinimalWebSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open', listener: () => void): void;
  addEventListener(type: 'close', listener: () => void): void;
  addEventListener(type: 'error', listener: (ev: unknown) => void): void;
  addEventListener(type: 'message', listener: (ev: { data: unknown }) => void): void;
}

type WebSocketCtor = new (url: string, protocols?: string | string[]) => MinimalWebSocket;

interface RegisterFrame {
  type: 'register';
  transport: 'websocket';
  appId?: string;
  appName?: string;
}

interface AckFrame {
  type: 'ack';
  ok?: boolean;
  error?: { code?: string; message?: string };
}

interface CommandFrame {
  type: 'command';
  commandId: string;
  action: string;
  payload?: unknown;
}

interface ResponseFrame {
  type: 'response';
  commandId: string;
  success: boolean;
  result?: unknown;
  error?: { code: string; message: string; retryable?: boolean };
}

type IncomingFrame = AckFrame | CommandFrame | { type: string; [k: string]: unknown };

export class LiveSessionTransport extends BaseTransport {
  readonly kind: WrapperTransportKind = 'live';

  private readonly url: string;
  private readonly appId?: string;
  private readonly appName?: string;
  private readonly opts: LiveTransportOptions;
  private readonly wsCtor: WebSocketCtor;

  private ws: MinimalWebSocket | null = null;
  private ackResolvers: {
    resolve: () => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  constructor(
    config: TransportConfig,
    registry?: HandlerRegistry,
    injected?: { webSocketCtor?: WebSocketCtor }
  ) {
    super(registry);
    if (!config.runnerUrl) {
      throw new WrapperTransportError('INVALID_CONFIG', `Transport kind 'live' requires runnerUrl`);
    }
    this.url = config.runnerUrl;
    this.appId = config.appId;
    this.appName = config.appName;
    this.opts = (config.options ?? {}) as LiveTransportOptions;
    const fromInjection = injected?.webSocketCtor;
    // Prefer the browser's global WebSocket if present; allow the caller
    // to inject a Node-side `ws` implementation.
    const fromGlobal =
      typeof (globalThis as { WebSocket?: WebSocketCtor }).WebSocket === 'function'
        ? ((globalThis as { WebSocket?: WebSocketCtor }).WebSocket as WebSocketCtor)
        : undefined;
    const resolved = fromInjection ?? fromGlobal;
    if (!resolved) {
      throw new WrapperTransportError(
        'NO_WEBSOCKET',
        `No WebSocket constructor available. Provide one via the second constructor arg or run in an environment with global WebSocket.`
      );
    }
    this.wsCtor = resolved;
  }

  protected async onReady(): Promise<void> {
    const ws = new this.wsCtor(this.url);
    this.ws = ws;

    ws.addEventListener('message', (ev) => this.handleMessage(ev.data));
    ws.addEventListener('close', () => this.handleClose());
    ws.addEventListener('error', (ev) => this.handleError(ev));

    // Wait for `open`, then send `register` and wait for `ack` (or timeout).
    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        try {
          const frame: RegisterFrame = {
            type: 'register',
            transport: 'websocket',
            appId: this.appId,
            appName: this.appName,
          };
          ws.send(JSON.stringify(frame));
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
          return;
        }
        const timeoutMs = this.opts.handshakeTimeoutMs ?? 10_000;
        const timer = setTimeout(() => {
          this.ackResolvers = null;
          reject(
            new WrapperTransportError(
              'HANDSHAKE_TIMEOUT',
              `Did not receive register ack within ${timeoutMs}ms`
            )
          );
        }, timeoutMs);
        this.ackResolvers = { resolve, reject, timer };
      };
      ws.addEventListener('open', onOpen);
    });
  }

  protected async onClose(): Promise<void> {
    const ws = this.ws;
    this.ws = null;
    if (this.ackResolvers) {
      clearTimeout(this.ackResolvers.timer);
      this.ackResolvers.reject(
        new WrapperTransportError('TRANSPORT_CLOSED', 'Transport closed during handshake')
      );
      this.ackResolvers = null;
    }
    if (ws) {
      try {
        ws.close();
      } catch {
        // ignore — best-effort teardown
      }
    }
  }

  protected async buildContext(): Promise<LiveContext> {
    return { kind: 'live', commandId: null };
  }

  private handleMessage(data: unknown): void {
    let frame: IncomingFrame;
    try {
      const text = typeof data === 'string' ? data : String(data);
      frame = JSON.parse(text) as IncomingFrame;
    } catch {
      return;
    }

    switch (frame.type) {
      case 'ack': {
        const f = frame as AckFrame;
        if (!this.ackResolvers) return;
        clearTimeout(this.ackResolvers.timer);
        if (f.ok === false) {
          const err = new WrapperTransportError(
            f.error?.code ?? 'REGISTER_FAILED',
            f.error?.message ?? 'Runner refused registration'
          );
          this.ackResolvers.reject(err);
        } else {
          this.ackResolvers.resolve();
        }
        this.ackResolvers = null;
        return;
      }
      case 'command': {
        const f = frame as CommandFrame;
        void this.handleCommand(f);
        return;
      }
      default:
        return; // ignore unknown frames
    }
  }

  private async handleCommand(frame: CommandFrame): Promise<void> {
    const ctx: LiveContext = { kind: 'live', commandId: frame.commandId };
    let response: ResponseFrame;
    try {
      const result = await this.registry.dispatch(frame.action, frame.payload, ctx);
      response = {
        type: 'response',
        commandId: frame.commandId,
        success: true,
        result,
      };
    } catch (err) {
      const code = err instanceof WrapperTransportError ? err.code : 'HANDLER_ERROR';
      const retryable = err instanceof WrapperTransportError ? err.retryable : false;
      const message = err instanceof Error ? err.message : String(err);
      response = {
        type: 'response',
        commandId: frame.commandId,
        success: false,
        error: { code, message, retryable },
      };
    }
    try {
      this.ws?.send(JSON.stringify(response));
    } catch {
      // socket died mid-response; nothing to be done.
    }
  }

  private handleClose(): void {
    if (this._status === 'closed') return;
    this.setStatus('closed');
    if (this.ackResolvers) {
      clearTimeout(this.ackResolvers.timer);
      this.ackResolvers.reject(
        new WrapperTransportError('DISCONNECTED', 'WebSocket closed before ack')
      );
      this.ackResolvers = null;
    }
  }

  private handleError(ev: unknown): void {
    if (this.ackResolvers) {
      clearTimeout(this.ackResolvers.timer);
      const message = this.extractErrorMessage(ev);
      this.ackResolvers.reject(
        new WrapperTransportError('WEBSOCKET_ERROR', message, { retryable: true })
      );
      this.ackResolvers = null;
    } else {
      this.setStatus('error');
    }
  }

  private extractErrorMessage(ev: unknown): string {
    if (ev && typeof ev === 'object' && 'message' in ev) {
      const m = (ev as { message?: unknown }).message;
      if (typeof m === 'string') return m;
    }
    if (ev instanceof Error) return ev.message;
    return 'WebSocket error';
  }
}
