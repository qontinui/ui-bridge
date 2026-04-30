import { C as ChangeObserver } from './change-observer-hiF2OiFX.js';
import { ar as UIBridgeRegistry, e as BridgeEvent } from './types-CXCbCmRP.js';
import { a as UIBridgeServerHandlers, U as UIBridgeServerConfig, W as WebSocketMessage } from './types-DhipyJTn.js';
import { S as SSEManager } from './sse-handler-7RrWBnEy.js';

/**
 * WebSocket-like interface for compatibility
 */
interface WebSocketLike {
    send(data: string): void;
    close(): void;
    readyState: number;
    onmessage?: ((event: {
        data: string;
    }) => void) | null;
    onclose?: (() => void) | null;
    onerror?: ((error: unknown) => void) | null;
}
/**
 * WebSocket handler for UI Bridge server
 */
declare class UIBridgeWSHandler {
    private handlers;
    private clients;
    private verbose;
    private log;
    private recordingManager;
    private lastAutoSavedExport;
    constructor(handlers: Partial<UIBridgeServerHandlers>, options?: {
        verbose?: boolean;
        log?: (message: string) => void;
        /** Registry and change observer for recording session support */
        recording?: {
            registry: UIBridgeRegistry;
            changeObserver?: ChangeObserver;
        };
    });
    /**
     * Handle new WebSocket connection
     */
    handleConnection(ws: WebSocketLike): string;
    /**
     * Handle client disconnect
     */
    handleDisconnect(clientId: string): void;
    /**
     * Handle incoming message
     */
    private handleMessage;
    /**
     * Handle ping message
     */
    private handlePing;
    /**
     * Handle subscribe message
     */
    private handleSubscribe;
    /**
     * Handle unsubscribe message
     */
    private handleUnsubscribe;
    /**
     * Handle find message
     */
    private handleFind;
    /**
     * Handle getElement message
     */
    private handleGetElement;
    /**
     * Handle getSnapshot message
     */
    private handleGetSnapshot;
    /**
     * Handle executeAction message
     */
    private handleExecuteAction;
    /**
     * Handle executeComponentAction message
     */
    private handleExecuteComponentAction;
    /**
     * Handle executeWorkflow message
     */
    private handleExecuteWorkflow;
    /**
     * Handle getElementHistory message
     */
    private handleGetElementHistory;
    /**
     * Broadcast event to all subscribed clients
     * @param excludeClientId - optional client ID to skip (e.g. the sender)
     */
    broadcastEvent(event: BridgeEvent, excludeClientId?: string): void;
    /**
     * Send message to specific client
     */
    private sendToClient;
    /**
     * Send response message
     */
    private sendResponse;
    /**
     * Send error message
     */
    private sendError;
    /**
     * Get connected client count
     */
    get clientCount(): number;
    /**
     * Get all connected client IDs
     */
    get clientIds(): string[];
    /**
     * Disconnect all clients
     */
    disconnectAll(): void;
    private handleRecordingStart;
    private handleRecordingStop;
    private handleRecordingStatus;
    /**
     * Handle recording:autosave — stores the latest auto-saved export data.
     * Called by the client or internally when the auto-save callback fires.
     */
    private handleRecordingAutoSave;
    /**
     * Handle recording:recover — returns the last auto-saved export data.
     * Used by clients to recover partial recording data after a disconnect.
     */
    private handleRecordingRecover;
}

/**
 * Standalone server configuration
 */
interface StandaloneServerConfig extends UIBridgeServerConfig {
    /** Host to bind to */
    host?: string;
    /** Port to listen on */
    port?: number;
    /** Enable WebSocket support */
    websocket?: boolean;
    /** WebSocket port (defaults to port) */
    websocketPort?: number;
    /** Logging function */
    log?: (message: string) => void;
    /** Enable recording session support — pass the registry and optional changeObserver */
    recording?: {
        registry: UIBridgeRegistry;
        changeObserver?: ChangeObserver;
    };
}
/**
 * Simple HTTP server implementation using Node.js built-in http module
 * with optional WebSocket support.
 */
declare class StandaloneServer {
    private server;
    private wsServer;
    private config;
    private handlers;
    private wsHandler;
    private wsConnections;
    private sseManager;
    constructor(handlers: Partial<UIBridgeServerHandlers>, config?: StandaloneServerConfig);
    /**
     * Get enabled capabilities based on handlers
     */
    private getCapabilities;
    /**
     * Start the server
     */
    start(): Promise<void>;
    /**
     * Start WebSocket server
     */
    private startWebSocketServer;
    /**
     * Stop the server
     */
    stop(): Promise<void>;
    /**
     * Handle an HTTP request
     */
    private handleRequest;
    /**
     * Find a matching route
     */
    private findRoute;
    /**
     * Extract params from path
     */
    private extractParams;
    /**
     * Parse request body
     */
    private parseBody;
    /**
     * Send JSON response (safe against circular refs from DOM nodes)
     */
    private sendJSON;
    /**
     * Broadcast a message to all WebSocket connections (legacy)
     */
    broadcast(message: WebSocketMessage): void;
    /**
     * Broadcast an event to all subscribed WebSocket and SSE clients
     */
    broadcastEvent(event: BridgeEvent): void;
    /**
     * Get the SSE manager for direct access (e.g., wiring to registry.onEvent)
     */
    getSSEManager(): SSEManager;
    /**
     * Create an `onBrowserEvent` callback wired to the WS handler's broadcast.
     *
     * Call this **before** `createHandlers()` to get a callback you can pass as
     * `config.onBrowserEvent`. The internal BrowserEventStream in handlers.ts
     * will auto-subscribe and forward classified events through this callback
     * to all connected WebSocket clients.
     *
     * Returns `undefined` if WebSocket is not enabled, so it's safe to spread
     * into the config unconditionally.
     *
     * @example
     * ```ts
     * const server = new StandaloneServer({}, { websocket: true, port: 9876 });
     * const handlers = createHandlers(registry, executor, {
     *   onBrowserEvent: server.createBrowserEventCallback(),
     * });
     * ```
     */
    createBrowserEventCallback(): ((event: BridgeEvent) => void) | undefined;
    /**
     * Create an `onChangeEvent` callback wired to SSE + WS broadcast.
     *
     * Call this **before** `createHandlers()` to get a callback you can pass as
     * `config.onChangeEvent`. The ChangeObserver in handlers.ts will forward
     * batched DOM change events through this callback to all connected clients.
     */
    createChangeEventCallback(): (event: BridgeEvent) => void;
    /**
     * Get WebSocket handler for direct access
     */
    getWSHandler(): UIBridgeWSHandler | null;
    /**
     * Get number of connected WebSocket clients
     */
    get wsClientCount(): number;
    /**
     * Get the server address
     */
    getAddress(): {
        host: string;
        port: number;
    } | null;
}
/**
 * Create and start a standalone server
 */
declare function createStandaloneServer(handlers: Partial<UIBridgeServerHandlers>, config?: StandaloneServerConfig): Promise<StandaloneServer>;
/**
 * CLI entry point
 */
declare function startCLI(handlers: Partial<UIBridgeServerHandlers>, args?: string[]): Promise<void>;

export { StandaloneServer as S, UIBridgeWSHandler as U, type WebSocketLike as W, type StandaloneServerConfig as a, createStandaloneServer as c, startCLI as s };
