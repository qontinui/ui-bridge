/**
 * WebSocket Client for UI Bridge
 *
 * Provides real-time communication with UI Bridge server.
 */

import type {
  BridgeEvent,
  BridgeEventType,
  BridgeSnapshot,
  WSClientConfig,
  WSClientMessage,
  WSConnectionState,
  WSServerMessage,
  WSSubscriptionOptions,
  ActionRequest,
  ActionResponse,
} from './types';

/**
 * Generate unique message ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * WebSocket client for UI Bridge
 */
export class UIBridgeWSClient {
  private ws: WebSocket | null = null;
  private config: Required<WSClientConfig>;
  private state: WSConnectionState = 'disconnected';
  private clientId: string | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pendingRequests = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();

  // Event listeners
  private connectionListeners = new Set<(state: WSConnectionState) => void>();
  private eventListeners = new Map<BridgeEventType | '*', Set<(event: BridgeEvent) => void>>();
  private errorListeners = new Set<(error: Error) => void>();

  // Current subscriptions
  private subscriptions: WSSubscriptionOptions = {};

  constructor(config: WSClientConfig) {
    this.config = {
      url: config.url,
      autoReconnect: config.autoReconnect ?? true,
      reconnectDelay: config.reconnectDelay ?? 1000,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 10,
      pingInterval: config.pingInterval ?? 30000,
      connectionTimeout: config.connectionTimeout ?? 10000,
    };
  }

  /**
   * Get current connection state
   */
  get connectionState(): WSConnectionState {
    return this.state;
  }

  /**
   * Get assigned client ID
   */
  get id(): string | null {
    return this.clientId;
  }

  /**
   * Connect to the WebSocket server
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws && this.state === 'connected') {
        resolve();
        return;
      }

      this.setState('connecting');

      try {
        this.ws = new WebSocket(this.config.url);
      } catch (error) {
        this.setState('disconnected');
        reject(error);
        return;
      }

      const connectionTimeout = setTimeout(() => {
        if (this.state === 'connecting') {
          this.ws?.close();
          this.setState('disconnected');
          reject(new Error('Connection timeout'));
        }
      }, this.config.connectionTimeout);

      this.ws.onopen = () => {
        clearTimeout(connectionTimeout);
        // Wait for welcome message before resolving
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data as string) as WSServerMessage;
          this.handleMessage(message);

          // Resolve connect promise on welcome message
          if (message.type === 'welcome') {
            clearTimeout(connectionTimeout);
            this.reconnectAttempts = 0;
            this.setState('connected');
            this.startPingInterval();

            // Re-subscribe if we have active subscriptions
            if (
              this.subscriptions.events?.length ||
              this.subscriptions.elementIds?.length ||
              this.subscriptions.componentIds?.length
            ) {
              this.subscribe(this.subscriptions);
            }

            resolve();
          }
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      this.ws.onerror = (event) => {
        clearTimeout(connectionTimeout);
        const error = new Error('WebSocket error');
        this.notifyError(error);
        if (this.state === 'connecting') {
          reject(error);
        }
      };

      this.ws.onclose = () => {
        clearTimeout(connectionTimeout);
        this.stopPingInterval();
        this.clientId = null;

        const wasConnected = this.state === 'connected';
        this.setState('disconnected');

        // Reject all pending requests
        for (const [id, pending] of this.pendingRequests) {
          clearTimeout(pending.timeout);
          pending.reject(new Error('Connection closed'));
        }
        this.pendingRequests.clear();

        // Auto-reconnect
        if (
          wasConnected &&
          this.config.autoReconnect &&
          (this.config.maxReconnectAttempts === 0 ||
            this.reconnectAttempts < this.config.maxReconnectAttempts)
        ) {
          this.scheduleReconnect();
        }
      };
    });
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopPingInterval();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.setState('disconnected');
  }

  /**
   * Subscribe to events
   */
  async subscribe(options: WSSubscriptionOptions): Promise<BridgeEventType[]> {
    this.subscriptions = { ...this.subscriptions, ...options };

    const response = await this.sendRequest<{ events: BridgeEventType[] }>({
      id: generateId(),
      type: 'subscribe',
      timestamp: Date.now(),
      payload: options,
    });

    return response.events;
  }

  /**
   * Unsubscribe from events
   */
  async unsubscribe(events?: BridgeEventType[]): Promise<BridgeEventType[]> {
    if (events) {
      this.subscriptions.events = this.subscriptions.events?.filter((e) => !events.includes(e));
    } else {
      this.subscriptions = {};
    }

    const response = await this.sendRequest<{ events: BridgeEventType[] }>({
      id: generateId(),
      type: 'unsubscribe',
      timestamp: Date.now(),
      payload: { events },
    });

    return response.events;
  }

  /**
   * Discover elements
   */
  async discover(options?: {
    interactiveOnly?: boolean;
    includeState?: boolean;
    selector?: string;
  }): Promise<BridgeSnapshot['elements']> {
    const response = await this.sendRequest<{ elements: BridgeSnapshot['elements'] }>({
      id: generateId(),
      type: 'discover',
      timestamp: Date.now(),
      payload: options,
    });

    return response.elements;
  }

  /**
   * Get element details
   */
  async getElement(
    elementId: string,
    includeState = true
  ): Promise<BridgeSnapshot['elements'][0] | null> {
    const response = await this.sendRequest<{ element: BridgeSnapshot['elements'][0] | null }>({
      id: generateId(),
      type: 'getElement',
      timestamp: Date.now(),
      payload: { elementId, includeState },
    });

    return response.element;
  }

  /**
   * Get full snapshot
   */
  async getSnapshot(): Promise<BridgeSnapshot> {
    const response = await this.sendRequest<BridgeSnapshot>({
      id: generateId(),
      type: 'getSnapshot',
      timestamp: Date.now(),
    });

    return response;
  }

  /**
   * Execute action on an element
   */
  async executeAction(elementId: string, action: ActionRequest): Promise<ActionResponse> {
    const response = await this.sendRequest<ActionResponse>({
      id: generateId(),
      type: 'executeAction',
      timestamp: Date.now(),
      payload: { elementId, action },
    });

    return response;
  }

  /**
   * Execute component action
   */
  async executeComponentAction(
    componentId: string,
    action: string,
    params?: Record<string, unknown>
  ): Promise<ActionResponse> {
    const response = await this.sendRequest<ActionResponse>({
      id: generateId(),
      type: 'executeComponentAction',
      timestamp: Date.now(),
      payload: { componentId, action, params },
    });

    return response;
  }

  /**
   * Execute workflow with optional progress streaming
   */
  async executeWorkflow(
    workflowId: string,
    params?: Record<string, unknown>,
    onProgress?: (progress: {
      currentStep: number;
      totalSteps: number;
      step: { id: string; status: string };
    }) => void
  ): Promise<{ success: boolean; results: unknown[] }> {
    const id = generateId();

    // Set up progress listener if provided
    const progressHandler: ((message: WSServerMessage) => void) | undefined = onProgress
      ? (message: WSServerMessage) => {
          if (message.type === 'workflowProgress' && message.requestId === id) {
            onProgress({
              currentStep: message.payload.currentStep,
              totalSteps: message.payload.totalSteps,
              step: {
                id: message.payload.step.id,
                status: message.payload.step.status,
              },
            });
          }
        }
      : undefined;

    const response = await this.sendRequest<{ success: boolean; results: unknown[] }>(
      {
        id,
        type: 'executeWorkflow',
        timestamp: Date.now(),
        payload: { workflowId, params, streamProgress: !!onProgress },
      },
      progressHandler
    );

    return response;
  }

  /**
   * Add connection state listener
   */
  onConnectionChange(listener: (state: WSConnectionState) => void): () => void {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  /**
   * Add event listener
   */
  onEvent(
    eventType: BridgeEventType | '*',
    listener: (event: BridgeEvent) => void
  ): () => void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, new Set());
    }
    this.eventListeners.get(eventType)!.add(listener);
    return () => this.eventListeners.get(eventType)?.delete(listener);
  }

  /**
   * Add error listener
   */
  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  // Private methods

  private setState(state: WSConnectionState): void {
    this.state = state;
    for (const listener of this.connectionListeners) {
      try {
        listener(state);
      } catch (error) {
        console.error('Connection listener error:', error);
      }
    }
  }

  private handleMessage(message: WSServerMessage): void {
    switch (message.type) {
      case 'welcome':
        this.clientId = message.payload.clientId;
        break;

      case 'pong':
        // Ping/pong handled automatically
        break;

      case 'subscribed':
      case 'unsubscribed':
        // Handled by request/response
        break;

      case 'event':
        this.notifyEvent(message.payload);
        break;

      case 'response':
        this.handleResponse(message);
        break;

      case 'error':
        if (message.requestId) {
          this.handleResponse({
            ...message,
            type: 'response',
            requestId: message.requestId,
            payload: {
              success: false,
              error: message.payload.message,
            },
          });
        } else {
          this.notifyError(new Error(message.payload.message));
        }
        break;

      case 'workflowProgress':
        // Handled by progress callback in executeWorkflow
        break;
    }
  }

  private handleResponse(message: WSServerMessage & { requestId: string }): void {
    const pending = this.pendingRequests.get(message.requestId);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(message.requestId);

    if (message.type === 'response') {
      if (message.payload.success) {
        pending.resolve(message.payload.data);
      } else {
        pending.reject(new Error(message.payload.error || 'Request failed'));
      }
    }
  }

  private notifyEvent(event: BridgeEvent): void {
    // Notify specific type listeners
    const typeListeners = this.eventListeners.get(event.type);
    if (typeListeners) {
      for (const listener of typeListeners) {
        try {
          listener(event);
        } catch (error) {
          console.error('Event listener error:', error);
        }
      }
    }

    // Notify wildcard listeners
    const wildcardListeners = this.eventListeners.get('*');
    if (wildcardListeners) {
      for (const listener of wildcardListeners) {
        try {
          listener(event);
        } catch (error) {
          console.error('Event listener error:', error);
        }
      }
    }
  }

  private notifyError(error: Error): void {
    for (const listener of this.errorListeners) {
      try {
        listener(error);
      } catch (e) {
        console.error('Error listener error:', e);
      }
    }
  }

  private sendRequest<T>(
    message: WSClientMessage,
    progressHandler?: (message: WSServerMessage) => void
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.state !== 'connected') {
        reject(new Error('Not connected'));
        return;
      }

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(message.id);
        reject(new Error('Request timeout'));
      }, 30000);

      this.pendingRequests.set(message.id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      });

      // Handle progress messages during workflow execution
      if (progressHandler && this.ws) {
        const originalHandler = this.ws.onmessage;
        const wsRef = this.ws;
        const wrappedHandler = (event: MessageEvent) => {
          try {
            const msg = JSON.parse(event.data as string) as WSServerMessage;
            if (msg.type === 'workflowProgress') {
              progressHandler(msg);
            }
          } catch {
            // Ignore parse errors for progress
          }
          // Call original handler
          if (originalHandler) {
            originalHandler.call(wsRef, event);
          }
        };
        this.ws.onmessage = wrappedHandler;
      }

      this.ws.send(JSON.stringify(message));
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    this.setState('reconnecting');
    this.reconnectAttempts++;

    const delay = Math.min(
      this.config.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      30000
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {
        // Will auto-retry if configured
      });
    }, delay);
  }

  private startPingInterval(): void {
    if (this.config.pingInterval <= 0) return;

    this.pingTimer = setInterval(() => {
      if (this.ws && this.state === 'connected') {
        this.ws.send(
          JSON.stringify({
            id: generateId(),
            type: 'ping',
            timestamp: Date.now(),
          })
        );
      }
    }, this.config.pingInterval);
  }

  private stopPingInterval(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}

/**
 * Create a WebSocket client instance
 */
export function createWSClient(config: WSClientConfig): UIBridgeWSClient {
  return new UIBridgeWSClient(config);
}
