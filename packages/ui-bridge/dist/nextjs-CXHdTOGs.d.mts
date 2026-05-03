import { D as DOMChangeEvent, U as UIBridgeServerConfig, a as UIBridgeServerHandlers } from './types-VtnJDSGD.mjs';
import { S as SSEManager } from './sse-handler-BB8lvLTH.mjs';

/**
 * CommandRelay — Server-side command relay for UI Bridge
 *
 * Manages the command queue between HTTP API handlers (server) and browser tabs
 * (clients). External tools call server handlers, which queue commands here.
 * Browser tabs connect via SSE or WebSocket, receive commands, execute them,
 * and POST results back.
 *
 * Key behaviors:
 * - Primary tab routing with automatic failover
 * - Multi-tab broadcast with grace period (first success wins)
 * - globalThis persistence for Next.js HMR survival
 * - Fire-and-forget mode for navigation commands
 * - Configurable timeouts per transport
 *
 * Extracted from qontinui-web's proven production relay.
 */

interface QueuedCommand {
    commandId: string;
    action: string;
    payload: unknown;
    timestamp: number;
}
type CommandListener = (command: QueuedCommand) => void;
interface TabListener {
    tabId: string;
    callback: CommandListener;
}
interface PendingCommand {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
    tabsNotified: number;
    errorResponseCount: number;
    firstError?: Error;
    graceTimeout?: ReturnType<typeof setTimeout>;
}
interface WebSocketClient {
    clientId: string;
    send: (message: string) => void;
    isConnected: () => boolean;
    close: () => void;
}
interface TabInfo {
    tabId: string;
    url?: string;
    pathname?: string;
    title?: string;
}
interface TransportDiagnostics {
    pendingCommandCount: number;
    pendingCommandIds: string[];
    commandListenerCount: number;
    connectedTabs: string[];
    primaryTabId: string | null;
    demotedTabs: string[];
    buildId: string;
    wsClientCount: number;
    wsClientIds: string[];
    commandQueueLength: number;
    tabHeartbeats: Record<string, number>;
    tabMetadata: Record<string, {
        url: string;
        title: string;
        visibility: string;
        lastSeen: number;
    }>;
}
interface CommandRelayOptions {
    /** Prefix for globalThis keys (default: '__uiBridge') */
    globalPrefix?: string;
    /** WebSocket command timeout in ms (default: 10000) */
    wsTimeoutMs?: number;
    /** SSE/HTTP command timeout in ms (default: 8000) */
    sseTimeoutMs?: number;
    /** Multi-tab grace period in ms (default: 3000) */
    multiTabGraceMs?: number;
    /** Max pending commands before eviction (default: 200) */
    maxPendingCommands?: number;
    /** Heartbeat stale threshold in ms (default: 30000) */
    heartbeatStaleMs?: number;
    /** Time after which a demoted tab with no heartbeat is cleaned up (default: 60000) */
    tabDemotionTtlMs?: number;
}
declare class CommandRelay {
    private readonly prefix;
    private readonly wsTimeoutMs;
    private readonly sseTimeoutMs;
    private readonly multiTabGraceMs;
    private readonly maxPendingCommands;
    private readonly heartbeatStaleMs;
    private readonly tabDemotionTtlMs;
    private readonly pendingCommands;
    private readonly tabListeners;
    private readonly wsClients;
    private readonly demotedTabs;
    private readonly commandQueue;
    private readonly tabHeartbeats;
    private readonly tabMetadata;
    private readonly tabLastSuccess;
    private primaryTabId;
    readonly buildId: string;
    private cleanupInterval;
    private connectionReadyResolve;
    private connectionReady;
    constructor(options?: CommandRelayOptions);
    /**
     * Remove entries from tabHeartbeats and demotedTabs for tabs no longer connected.
     */
    private cleanupStaleTabs;
    /**
     * Reset the connection readiness gate when all transports have disconnected.
     * The next call to queueCommand() will block until a new transport connects.
     */
    private resetConnectionGateIfEmpty;
    private getPrimaryTabId;
    private setPrimaryTab;
    private persistPrimaryTab;
    private demotePrimaryTab;
    private generateCommandId;
    /**
     * Queue a command with primary tab routing, automatic failover,
     * and retry-on-disconnect.
     */
    queueCommand<T>(action: string, payload: unknown, options?: {
        targetTabId?: string;
    }): Promise<T>;
    /**
     * Inner command queue implementation (no retry logic).
     */
    private queueCommandInner;
    /**
     * Low-level: send a command to a specific tab or broadcast to all.
     */
    private sendCommand;
    private broadcastToListeners;
    private sendCommandViaWebSocket;
    private getConnectedClient;
    /**
     * Register a WebSocket client for command delivery.
     */
    registerWebSocketClient(client: WebSocketClient): void;
    /**
     * Unregister a WebSocket client.
     */
    unregisterWebSocketClient(clientId: string): void;
    /**
     * Update WebSocket client activity timestamp.
     */
    updateClientActivity(clientId: string): void;
    /**
     * Get connected WebSocket client count.
     */
    getWebSocketClientCount(): number;
    /**
     * Broadcast an event to all connected WebSocket clients.
     */
    broadcastEvent(eventType: string, data: unknown): void;
    /**
     * Resolve a pending command with a response from the browser.
     */
    resolveCommand(commandId: string, result: unknown, tabId?: string): boolean;
    /**
     * Reject a pending command with an error from the browser.
     */
    rejectCommand(commandId: string, errorMessage: string): boolean;
    /**
     * Subscribe to commands via SSE. Returns an unsubscribe function.
     */
    subscribeToCommands(listener: CommandListener, tabId?: string): () => void;
    /**
     * Check if any SSE listeners are connected.
     */
    hasCommandListeners(): boolean;
    /**
     * Get list of connected tab IDs.
     */
    getConnectedTabs(): string[];
    /**
     * Get connected tabs with page info by querying each tab.
     */
    getTabsWithInfo(): Promise<TabInfo[]>;
    /**
     * Record a heartbeat from the browser, optionally per-tab.
     */
    receiveHeartbeat(tabId?: string, metadata?: {
        url?: string;
        title?: string;
        visibility?: string;
    }): void;
    /**
     * Check if the browser app is responsive based on heartbeat freshness.
     * Returns true if ANY tab has a heartbeat within the stale threshold.
     */
    isAppResponsive(): boolean;
    /**
     * Get the last heartbeat timestamp (max across all tabs).
     */
    getLastHeartbeat(): number;
    /**
     * Get internal transport state for debugging.
     */
    getTransportDiagnostics(): TransportDiagnostics;
    /**
     * Get pending commands for legacy HTTP polling fallback.
     */
    getPendingCommands(): QueuedCommand[];
    private changeEventBuffer;
    private changeEventSubscribers;
    private readonly maxChangeEvents;
    /**
     * Push a change event from a browser tab into the relay's ring buffer
     * and notify all subscribers.
     */
    pushChangeEvent(event: DOMChangeEvent): void;
    /**
     * Subscribe to push-based change events. Returns an unsubscribe function.
     */
    subscribeChanges(callback: (event: DOMChangeEvent) => void): () => void;
    /**
     * Get buffered change events since a timestamp.
     */
    getChangeEventsSince(since: number, limit?: number): DOMChangeEvent[];
    destroy(): void;
}

/**
 * Next.js Adapter
 *
 * Next.js API route handlers for UI Bridge server.
 */
interface NextRequest extends Request {
    nextUrl: URL;
}

/**
 * Next.js specific configuration
 */
interface NextJSAdapterConfig extends UIBridgeServerConfig {
    /** Runtime for edge/serverless */
    runtime?: 'edge' | 'nodejs';
    /** SSE manager for streaming events to clients */
    sseManager?: SSEManager;
    /** CommandRelay instance for relay route support */
    relay?: CommandRelay;
}
/**
 * Route handler factory for Next.js App Router
 */
type NextRouteHandler = (request: NextRequest, context: {
    params: Record<string, string>;
}) => Promise<Response>;
/**
 * Create Next.js route handlers for UI Bridge
 *
 * Use this to create route handlers for the App Router.
 *
 * @example
 * ```ts
 * // app/api/ui-bridge/[...path]/route.ts
 * import { createNextRouteHandlers } from 'ui-bridge-server/nextjs';
 * import { handlers } from '@/lib/ui-bridge';
 *
 * export const { GET, POST, DELETE } = createNextRouteHandlers(handlers);
 * ```
 */
declare function createNextRouteHandlers(handlers: Partial<UIBridgeServerHandlers>, config?: NextJSAdapterConfig): {
    GET: NextRouteHandler;
    POST: NextRouteHandler;
    PUT: NextRouteHandler;
    DELETE: NextRouteHandler;
};
/**
 * Individual route handler creators for more granular control
 */
declare function createRenderLogHandlers(handlers: UIBridgeServerHandlers): {
    GET(request: NextRequest): Promise<Response>;
    DELETE(): Promise<Response>;
};
declare function createControlHandlers(handlers: UIBridgeServerHandlers): {
    elements: {
        GET(request: NextRequest): Promise<Response>;
    };
    element: {
        GET(_request: NextRequest, context: {
            params: {
                id: string;
            };
        }): Promise<Response>;
        POST(request: NextRequest, context: {
            params: {
                id: string;
            };
        }): Promise<Response>;
    };
    components: {
        GET(): Promise<Response>;
    };
    component: {
        GET(_request: NextRequest, context: {
            params: {
                id: string;
            };
        }): Promise<Response>;
        POST(request: NextRequest, context: {
            params: {
                id: string;
                actionId: string;
            };
        }): Promise<Response>;
    };
    find: {
        POST(request: NextRequest): Promise<Response>;
    };
    discover: {
        /**
         * @deprecated Use /control/find instead
         */
        POST(request: NextRequest): Promise<Response>;
    };
    snapshot: {
        GET(request: NextRequest): Promise<Response>;
    };
    workflows: {
        GET(): Promise<Response>;
    };
    workflow: {
        POST(request: NextRequest, context: {
            params: {
                id: string;
            };
        }): Promise<Response>;
    };
};
declare function createDebugHandlers(handlers: UIBridgeServerHandlers): {
    actionHistory: {
        GET(request: NextRequest): Promise<Response>;
    };
    metrics: {
        GET(): Promise<Response>;
    };
    highlight: {
        POST(_request: NextRequest, context: {
            params: {
                id: string;
            };
        }): Promise<Response>;
    };
};
/**
 * Zero-config convenience wrapper for Next.js App Router.
 *
 * Creates a single route handler with server-safe stub implementations.
 * Read operations return empty data; write operations return errors.
 *
 * For full control API access (live snapshots, element actions, AI search),
 * use the runtime injection proxy or implement a custom client-server relay.
 *
 * @example
 * ```ts
 * // app/api/ui-bridge/[...path]/route.ts
 * import { createUIBridgeHandler } from '@qontinui/ui-bridge/server';
 *
 * const handler = createUIBridgeHandler();
 *
 * export const GET = handler;
 * export const POST = handler;
 * export const DELETE = handler;
 * ```
 */
declare function createUIBridgeHandler(config?: NextJSAdapterConfig): NextRouteHandler;

export { CommandRelay as C, type NextJSAdapterConfig as N, type PendingCommand as P, type QueuedCommand as Q, type TabInfo as T, type WebSocketClient as W, type CommandListener as a, type CommandRelayOptions as b, type NextRouteHandler as c, type TabListener as d, type TransportDiagnostics as e, createControlHandlers as f, createDebugHandlers as g, createNextRouteHandlers as h, createRenderLogHandlers as i, createUIBridgeHandler as j };
