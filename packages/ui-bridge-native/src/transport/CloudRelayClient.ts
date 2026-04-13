/**
 * Cloud Relay Client — WebSocket tunnel from mobile device to backend
 *
 * Maintains a persistent WebSocket connection to the qontinui.io backend.
 * Receives tunneled HTTP requests from runners, calls the local NativeUIBridgeServer,
 * and sends responses back through the tunnel.
 */

import type { NativeUIBridgeServer } from '../server/http-server';

export interface CloudRelayConfig {
  /** WebSocket URL for the device bridge endpoint */
  relayUrl: string;
  /** Stable device identifier */
  deviceId: string;
  /** Authentication token */
  authToken: string;
  /** Reference to the local UI Bridge server for processing requests */
  uiBridgeServer: NativeUIBridgeServer;
}

interface TunnelRequest {
  id: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: unknown;
}

interface TunnelResponse {
  id: string;
  status: number;
  headers: Record<string, string>;
  body?: unknown;
}

const INITIAL_RECONNECT_DELAY_MS = 2_000;
const MAX_RECONNECT_DELAY_MS = 60_000;

/**
 * Manages a WebSocket tunnel from the mobile device to the qontinui.io backend.
 *
 * When a runner sends an HTTP request to a cloud device it is serialised as a
 * `TunnelRequest` JSON frame by the backend and forwarded here. This client
 * deserializes it, calls `NativeUIBridgeServer.handleRequest()` directly
 * (avoiding loopback TCP overhead), and sends the `TunnelResponse` back.
 */
export class CloudRelayClient {
  private ws: WebSocket | null = null;
  private config: CloudRelayConfig;
  private reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
  private maxReconnectDelay = MAX_RECONNECT_DELAY_MS;
  private stopped = false;
  private _isConnected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: CloudRelayConfig) {
    this.config = config;
  }

  /** Whether the relay WebSocket is currently connected */
  get isConnected(): boolean {
    return this._isConnected;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Connect to the relay and start processing tunneled requests. */
  start(): void {
    this.stopped = false;
    this.connect();
  }

  /** Disconnect and stop reconnecting. */
  stop(): void {
    this.stopped = true;
    this._isConnected = false;

    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.onclose = null; // prevent reconnect loop
      this.ws.close();
      this.ws = null;
    }
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private connect(): void {
    if (this.stopped) return;

    const url = `${this.config.relayUrl}?token=${encodeURIComponent(
      this.config.authToken
    )}`;

    console.log('[CloudRelayClient] Connecting to', url);

    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      if (this.stopped) {
        ws.close();
        return;
      }
      this._isConnected = true;
      this.reconnectDelay = INITIAL_RECONNECT_DELAY_MS;

      console.log('[CloudRelayClient] Connected to relay');

      // Register as a device
      ws.send(
        JSON.stringify({
          type: 'device_register',
          device_id: this.config.deviceId,
        })
      );
    };

    ws.onmessage = (event: MessageEvent) => {
      void this.onMessage(event.data as string);
    };

    ws.onclose = () => {
      this._isConnected = false;
      if (!this.stopped) {
        this.scheduleReconnect();
      }
    };

    ws.onerror = (err: Event) => {
      console.warn('[CloudRelayClient] WebSocket error:', err);
      // onclose will fire next and handle reconnect
    };
  }

  private async onMessage(raw: string): Promise<void> {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      console.warn('[CloudRelayClient] Received non-JSON message');
      return;
    }

    // Only handle tunnel_request frames
    if (msg['type'] !== 'tunnel_request') return;

    // Validate required fields
    if (
      typeof msg['id'] !== 'string' ||
      typeof msg['method'] !== 'string' ||
      typeof msg['path'] !== 'string'
    ) {
      console.warn('[CloudRelayClient] Malformed tunnel_request — missing required fields');
      return;
    }

    const req: TunnelRequest = {
      id: msg['id'],
      method: msg['method'],
      path: msg['path'],
      headers: (msg['headers'] as Record<string, string>) ?? {},
      body: msg['body'],
    };

    const resp = await this.handleTunneledRequest(req);

    // Send response back through the WebSocket
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'tunnel_response', ...resp }));
    }
  }

  /**
   * Process a tunneled HTTP request by calling the local NativeUIBridgeServer
   * directly (no loopback TCP involved).
   */
  private async handleTunneledRequest(req: TunnelRequest): Promise<TunnelResponse> {
    try {
      const httpResp = await this.config.uiBridgeServer.handleRequest({
        method: req.method,
        path: req.path,
        headers: req.headers,
        query: parseQueryParams(req.path),
        body: req.body,
      });

      // Parse the JSON body back to an object so it can be re-serialised as a
      // proper JSON value in the tunnel response (avoids double-encoding).
      let bodyValue: unknown;
      try {
        bodyValue = httpResp.body ? (JSON.parse(httpResp.body) as unknown) : undefined;
      } catch {
        bodyValue = httpResp.body || undefined;
      }

      return {
        id: req.id,
        status: httpResp.status,
        headers: httpResp.headers,
        body: bodyValue,
      };
    } catch (err) {
      console.error('[CloudRelayClient] Error handling tunneled request:', err);
      return {
        id: req.id,
        status: 500,
        headers: { 'content-type': 'application/json' },
        body: {
          success: false,
          error: err instanceof Error ? err.message : 'Internal server error',
        },
      };
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const delay = this.reconnectDelay;
    console.log(`[CloudRelayClient] Reconnecting in ${delay}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped) {
        this.connect();
      }
    }, delay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Extract query-string parameters from a URL path.
 * e.g. `/ui-bridge/control/elements?visibleOnly=true` → `{ visibleOnly: 'true' }`
 */
function parseQueryParams(path: string): Record<string, string> {
  const qIdx = path.indexOf('?');
  if (qIdx === -1) return {};
  const qs = path.slice(qIdx + 1);
  const result: Record<string, string> = {};
  for (const pair of qs.split('&')) {
    const [k, v] = pair.split('=');
    if (k) {
      result[decodeURIComponent(k)] = decodeURIComponent(v ?? '');
    }
  }
  return result;
}
