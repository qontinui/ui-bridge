import { W as WSClientConfig, a as WSConnectionState, b as WSSubscriptionOptions, B as BridgeEventType, c as BridgeSnapshot, A as ActionRequest, d as ActionResponse, e as BridgeEvent, f as WSClientMessage } from './types-X8pyInrK.js';

/**
 * WebSocket Client for UI Bridge
 *
 * Provides real-time communication with UI Bridge server.
 */

/**
 * WebSocket client for UI Bridge
 */
declare class UIBridgeWSClient {
    private ws;
    private config;
    private state;
    private clientId;
    private reconnectAttempts;
    private reconnectTimer;
    private pingTimer;
    private pendingRequests;
    private connectionListeners;
    private eventListeners;
    private errorListeners;
    private subscriptions;
    constructor(config: WSClientConfig);
    /**
     * Get current connection state
     */
    get connectionState(): WSConnectionState;
    /**
     * Get assigned client ID
     */
    get id(): string | null;
    /**
     * Connect to the WebSocket server
     */
    connect(): Promise<void>;
    /**
     * Disconnect from the server
     */
    disconnect(): void;
    /**
     * Subscribe to events
     */
    subscribe(options: WSSubscriptionOptions): Promise<BridgeEventType[]>;
    /**
     * Unsubscribe from events
     */
    unsubscribe(events?: BridgeEventType[]): Promise<BridgeEventType[]>;
    /**
     * Find elements
     */
    find(options?: {
        interactiveOnly?: boolean;
        includeState?: boolean;
        selector?: string;
    }): Promise<BridgeSnapshot['elements']>;
    /**
     * Discover elements
     * @deprecated Use find() instead
     */
    discover(options?: {
        interactiveOnly?: boolean;
        includeState?: boolean;
        selector?: string;
    }): Promise<BridgeSnapshot['elements']>;
    /**
     * Get element details
     */
    getElement(elementId: string, includeState?: boolean): Promise<BridgeSnapshot['elements'][0] | null>;
    /**
     * Get full snapshot
     */
    getSnapshot(): Promise<BridgeSnapshot>;
    /**
     * Execute action on an element
     */
    executeAction(elementId: string, action: ActionRequest): Promise<ActionResponse>;
    /**
     * Execute component action
     */
    executeComponentAction(componentId: string, action: string, params?: Record<string, unknown>): Promise<ActionResponse>;
    /**
     * Execute workflow with optional progress streaming
     */
    executeWorkflow(workflowId: string, params?: Record<string, unknown>, onProgress?: (progress: {
        currentStep: number;
        totalSteps: number;
        step: {
            id: string;
            status: string;
        };
    }) => void): Promise<{
        success: boolean;
        results: unknown[];
    }>;
    /**
     * Add connection state listener
     */
    onConnectionChange(listener: (state: WSConnectionState) => void): () => void;
    /**
     * Add event listener
     */
    onEvent(eventType: BridgeEventType | '*', listener: (event: BridgeEvent) => void): () => void;
    /**
     * Add error listener
     */
    onError(listener: (error: Error) => void): () => void;
    private setState;
    private handleMessage;
    private handleResponse;
    private notifyEvent;
    private notifyError;
    /**
     * Send a fire-and-forget event (no response expected).
     * Used for push-based change observation to stream DOM changes to the server.
     */
    sendEvent(message: WSClientMessage): void;
    private sendRequest;
    private scheduleReconnect;
    private startPingInterval;
    private stopPingInterval;
}
/**
 * Create a WebSocket client instance
 */
declare function createWSClient(config: WSClientConfig): UIBridgeWSClient;

export { UIBridgeWSClient as U, createWSClient as c };
