/**
 * WebSocket JSON-RPC message types for the UI Bridge protocol.
 */

// ── Client → Server ─────────────────────────────────────────────────────────

/** Standard JSON-RPC request */
export interface JsonRpcRequest {
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

/** Batch request — execute multiple requests concurrently */
export interface JsonRpcBatchRequest {
  id: number | string;
  batch: JsonRpcRequest[];
}

/** Subscribe to registry events */
export interface JsonRpcSubscribe {
  id: number | string;
  method: 'subscribe';
  params: {
    events: string[];
    /** Optional throttle in ms — batch rapid events within this window */
    throttleMs?: number;
  };
}

/** Unsubscribe from registry events */
export interface JsonRpcUnsubscribe {
  id: number | string;
  method: 'unsubscribe';
  params: { events: string[] };
}

/** Any client message */
export type JsonRpcClientMessage =
  | JsonRpcRequest
  | JsonRpcBatchRequest
  | JsonRpcSubscribe
  | JsonRpcUnsubscribe;

// ── Server → Client ─────────────────────────────────────────────────────────

/** Standard JSON-RPC response */
export interface JsonRpcResponse {
  id: number | string;
  result?: {
    success: boolean;
    data?: unknown;
    error?: string;
    code?: string;
    timestamp?: number;
  };
}

/** Batch response */
export interface JsonRpcBatchResponse {
  id: number | string;
  results: JsonRpcResponse[];
}

/** Server-pushed event (no id — not a response to a request) */
export interface JsonRpcEvent {
  event: string;
  data: unknown;
  timestamp: number;
}

/** Any server message */
export type JsonRpcServerMessage = JsonRpcResponse | JsonRpcBatchResponse | JsonRpcEvent;

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Check if a message is a batch request */
export function isBatchRequest(msg: unknown): msg is JsonRpcBatchRequest {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'batch' in msg &&
    Array.isArray((msg as JsonRpcBatchRequest).batch)
  );
}

/** Check if a message is a subscribe request */
export function isSubscribe(msg: unknown): msg is JsonRpcSubscribe {
  return (
    typeof msg === 'object' && msg !== null && (msg as JsonRpcSubscribe).method === 'subscribe'
  );
}

/** Check if a message is an unsubscribe request */
export function isUnsubscribe(msg: unknown): msg is JsonRpcUnsubscribe {
  return (
    typeof msg === 'object' && msg !== null && (msg as JsonRpcUnsubscribe).method === 'unsubscribe'
  );
}
