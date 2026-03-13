/**
 * SSE (Server-Sent Events) Handler for UI Bridge
 *
 * Streams real-time bridge events to connected clients via SSE.
 * Each event is a JSON-encoded BridgeEvent with optional type filtering.
 *
 * Usage:
 *   GET /control/events/stream?types=element:stateChanged,action:completed
 *
 * Event format:
 *   event: <BridgeEventType>
 *   data: <JSON BridgeEvent>
 *   id: <sequence number>
 *
 * Special events:
 *   event: heartbeat (every 15s to keep connection alive)
 *   event: connected (sent on initial connection)
 */

import type { BridgeEvent, BridgeEventType } from '../core';

/**
 * A connected SSE client
 */
interface SSEClient {
  id: string;
  /** Write a raw string to the response stream */
  write: (data: string) => boolean;
  /** Close the connection */
  close: () => void;
  /** Event type filter (empty = all events) */
  typeFilter: Set<BridgeEventType>;
  /** Element ID filter (empty = all elements) */
  elementFilter: Set<string>;
  /** Connected timestamp */
  connectedAt: number;
}

/**
 * SSE Manager — manages SSE client connections and broadcasts events
 */
export class SSEManager {
  private clients = new Map<string, SSEClient>();
  private sequence = 0;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Start heartbeat to keep connections alive
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, 15_000);
  }

  /**
   * Register a new SSE client connection.
   *
   * @param write - Function to write raw SSE data to the response
   * @param close - Function to close the connection
   * @param typeFilter - Optional comma-separated event types to filter
   * @param elementFilter - Optional comma-separated element IDs to filter
   * @returns Client ID (for cleanup on disconnect)
   */
  addClient(
    write: (data: string) => boolean,
    close: () => void,
    typeFilter?: string,
    elementFilter?: string
  ): string {
    const id = `sse-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const types = new Set<BridgeEventType>();
    if (typeFilter) {
      for (const t of typeFilter.split(',')) {
        const trimmed = t.trim();
        if (trimmed) types.add(trimmed as BridgeEventType);
      }
    }

    const elements = new Set<string>();
    if (elementFilter) {
      for (const e of elementFilter.split(',')) {
        const trimmed = e.trim();
        if (trimmed) elements.add(trimmed);
      }
    }

    const client: SSEClient = {
      id,
      write,
      close,
      typeFilter: types,
      elementFilter: elements,
      connectedAt: Date.now(),
    };

    this.clients.set(id, client);

    // Send connected event
    this.sendToClient(client, 'connected', {
      clientId: id,
      timestamp: Date.now(),
      filters: {
        types: types.size > 0 ? Array.from(types) : 'all',
        elements: elements.size > 0 ? Array.from(elements) : 'all',
      },
    });

    return id;
  }

  /**
   * Remove a client (called on disconnect)
   */
  removeClient(id: string): void {
    this.clients.delete(id);
  }

  /**
   * Broadcast a BridgeEvent to all matching SSE clients.
   * Call this from the registry's onEvent callback.
   */
  broadcast(event: BridgeEvent): void {
    if (this.clients.size === 0) return;

    const eventData = event.data as { elementId?: string; id?: string } | undefined;
    const elementId = eventData?.elementId || eventData?.id;

    for (const client of this.clients.values()) {
      // Type filter
      if (client.typeFilter.size > 0 && !client.typeFilter.has(event.type)) {
        continue;
      }

      // Element filter
      if (client.elementFilter.size > 0 && elementId && !client.elementFilter.has(elementId)) {
        continue;
      }

      this.sendToClient(client, event.type, event);
    }
  }

  /**
   * Number of connected clients
   */
  get clientCount(): number {
    return this.clients.size;
  }

  /**
   * Dispose — stop heartbeat and close all connections
   */
  dispose(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    for (const client of this.clients.values()) {
      try {
        client.close();
      } catch {
        // Ignore close errors
      }
    }
    this.clients.clear();
  }

  // ---- Private ----

  private sendToClient(client: SSEClient, eventType: string, data: unknown): void {
    const id = ++this.sequence;
    const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\nid: ${id}\n\n`;
    try {
      client.write(payload);
    } catch {
      // Client disconnected — remove it
      this.clients.delete(client.id);
    }
  }

  private sendHeartbeat(): void {
    const payload = `event: heartbeat\ndata: ${JSON.stringify({ timestamp: Date.now(), clients: this.clients.size })}\n\n`;
    const failed: string[] = [];
    for (const client of this.clients.values()) {
      try {
        client.write(payload);
      } catch {
        failed.push(client.id);
      }
    }
    for (const id of failed) {
      this.clients.delete(id);
    }
  }
}
