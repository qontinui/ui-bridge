import { e as BridgeEvent } from './types-DZdu2Fhp.js';

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

/**
 * SSE Manager — manages SSE client connections and broadcasts events
 */
declare class SSEManager {
    private clients;
    private sequence;
    private heartbeatInterval;
    constructor();
    /**
     * Register a new SSE client connection.
     *
     * @param write - Function to write raw SSE data to the response
     * @param close - Function to close the connection
     * @param typeFilter - Optional comma-separated event types to filter
     * @param elementFilter - Optional comma-separated element IDs to filter
     * @returns Client ID (for cleanup on disconnect)
     */
    addClient(write: (data: string) => boolean, close: () => void, typeFilter?: string, elementFilter?: string): string;
    /**
     * Remove a client (called on disconnect)
     */
    removeClient(id: string): void;
    /**
     * Broadcast a BridgeEvent to all matching SSE clients.
     * Call this from the registry's onEvent callback.
     */
    broadcast(event: BridgeEvent): void;
    /**
     * Number of connected clients
     */
    get clientCount(): number;
    /**
     * Dispose — stop heartbeat and close all connections
     */
    dispose(): void;
    private sendToClient;
    private sendHeartbeat;
}

export { SSEManager as S };
