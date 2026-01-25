/**
 * WebSocket Handler for UI Bridge Server
 *
 * Handles WebSocket connections and message routing.
 */

import type { UIBridgeServerHandlers } from './types';
import type {
  BridgeEvent,
  BridgeEventType,
  WSClientMessage,
  WSServerMessage,
  WSWelcomeMessage,
  WSPongMessage,
  WSSubscribedMessage,
  WSUnsubscribedMessage,
  WSEventMessage,
  WSResponseMessage,
  WSErrorMessage,
} from '@qontinui/ui-bridge';

/**
 * WebSocket-like interface for compatibility
 */
export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  readyState: number;
  onmessage?: ((event: { data: string }) => void) | null;
  onclose?: (() => void) | null;
  onerror?: ((error: unknown) => void) | null;
}

/**
 * Client subscription state
 */
interface ClientSubscription {
  events: Set<BridgeEventType>;
  elementIds: Set<string>;
  componentIds: Set<string>;
}

/**
 * Connected client info
 */
interface ConnectedClient {
  id: string;
  ws: WebSocketLike;
  subscription: ClientSubscription;
  connectedAt: number;
}

/**
 * Generate unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * UI Bridge server version
 */
const VERSION = '0.1.0';

/**
 * WebSocket handler for UI Bridge server
 */
export class UIBridgeWSHandler {
  private handlers: UIBridgeServerHandlers;
  private clients = new Map<string, ConnectedClient>();
  private verbose: boolean;
  private log: (message: string) => void;

  constructor(
    handlers: UIBridgeServerHandlers,
    options: { verbose?: boolean; log?: (message: string) => void } = {}
  ) {
    this.handlers = handlers;
    this.verbose = options.verbose ?? false;
    this.log = options.log ?? console.log;
  }

  /**
   * Handle new WebSocket connection
   */
  handleConnection(ws: WebSocketLike): string {
    const clientId = generateId();

    const client: ConnectedClient = {
      id: clientId,
      ws,
      subscription: {
        events: new Set(),
        elementIds: new Set(),
        componentIds: new Set(),
      },
      connectedAt: Date.now(),
    };

    this.clients.set(clientId, client);

    if (this.verbose) {
      this.log(`[WS] Client connected: ${clientId}`);
    }

    // Set up message handler
    ws.onmessage = (event: { data: string }) => {
      this.handleMessage(clientId, event.data);
    };

    // Set up close handler
    ws.onclose = () => {
      this.handleDisconnect(clientId);
    };

    // Send welcome message
    this.sendToClient(clientId, {
      id: generateId(),
      type: 'welcome',
      timestamp: Date.now(),
      payload: {
        version: VERSION,
        features: {
          renderLog: true,
          control: true,
          debug: true,
        },
        clientId,
      },
    } as WSWelcomeMessage);

    return clientId;
  }

  /**
   * Handle client disconnect
   */
  handleDisconnect(clientId: string): void {
    this.clients.delete(clientId);

    if (this.verbose) {
      this.log(`[WS] Client disconnected: ${clientId}`);
    }
  }

  /**
   * Handle incoming message
   */
  private async handleMessage(clientId: string, data: string): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return;

    let message: WSClientMessage;
    try {
      message = JSON.parse(data) as WSClientMessage;
    } catch (error) {
      this.sendError(clientId, undefined, 'PARSE_ERROR', 'Invalid JSON message');
      return;
    }

    if (this.verbose) {
      this.log(`[WS] ${clientId} -> ${message.type}`);
    }

    try {
      switch (message.type) {
        case 'ping':
          this.handlePing(clientId, message.id);
          break;

        case 'subscribe':
          await this.handleSubscribe(clientId, message);
          break;

        case 'unsubscribe':
          await this.handleUnsubscribe(clientId, message);
          break;

        case 'find':
          await this.handleFind(clientId, message);
          break;

        case 'discover':
          // @deprecated Use 'find' instead
          await this.handleFind(clientId, message as unknown as WSClientMessage & { type: 'find' });
          break;

        case 'getElement':
          await this.handleGetElement(clientId, message);
          break;

        case 'getSnapshot':
          await this.handleGetSnapshot(clientId, message);
          break;

        case 'executeAction':
          await this.handleExecuteAction(clientId, message);
          break;

        case 'executeComponentAction':
          await this.handleExecuteComponentAction(clientId, message);
          break;

        case 'executeWorkflow':
          await this.handleExecuteWorkflow(clientId, message);
          break;

        default:
          this.sendError(
            clientId,
            (message as WSClientMessage).id,
            'UNKNOWN_MESSAGE',
            `Unknown message type: ${(message as WSClientMessage).type}`
          );
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.sendError(clientId, message.id, 'HANDLER_ERROR', err.message);
    }
  }

  /**
   * Handle ping message
   */
  private handlePing(clientId: string, _requestId: string): void {
    this.sendToClient(clientId, {
      id: generateId(),
      type: 'pong',
      timestamp: Date.now(),
    } as WSPongMessage);
  }

  /**
   * Handle subscribe message
   */
  private async handleSubscribe(
    clientId: string,
    message: WSClientMessage & { type: 'subscribe' }
  ): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return;

    const { events, elementIds, componentIds } = message.payload;

    // Add to subscriptions
    if (events?.length) {
      for (const event of events) {
        client.subscription.events.add(event);
      }
    }
    if (elementIds?.length) {
      for (const id of elementIds) {
        client.subscription.elementIds.add(id);
      }
    }
    if (componentIds?.length) {
      for (const id of componentIds) {
        client.subscription.componentIds.add(id);
      }
    }

    this.sendToClient(clientId, {
      id: generateId(),
      type: 'subscribed',
      timestamp: Date.now(),
      payload: {
        events: Array.from(client.subscription.events),
      },
    } as WSSubscribedMessage);
  }

  /**
   * Handle unsubscribe message
   */
  private async handleUnsubscribe(
    clientId: string,
    message: WSClientMessage & { type: 'unsubscribe' }
  ): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return;

    const { events } = message.payload;

    let removedEvents: BridgeEventType[];
    if (events?.length) {
      removedEvents = events.filter((e: BridgeEventType) => client.subscription.events.has(e));
      for (const event of events) {
        client.subscription.events.delete(event);
      }
    } else {
      removedEvents = Array.from(client.subscription.events);
      client.subscription.events.clear();
      client.subscription.elementIds.clear();
      client.subscription.componentIds.clear();
    }

    this.sendToClient(clientId, {
      id: generateId(),
      type: 'unsubscribed',
      timestamp: Date.now(),
      payload: {
        events: removedEvents,
      },
    } as WSUnsubscribedMessage);
  }

  /**
   * Handle find message
   */
  private async handleFind(
    clientId: string,
    message: WSClientMessage & { type: 'find' }
  ): Promise<void> {
    const result = await this.handlers.find(message.payload || {});

    if (result.success && result.data) {
      this.sendResponse(clientId, message.id, true, { elements: result.data.elements });
    } else {
      this.sendResponse(clientId, message.id, false, undefined, result.error);
    }
  }

  /**
   * Handle getElement message
   */
  private async handleGetElement(
    clientId: string,
    message: WSClientMessage & { type: 'getElement' }
  ): Promise<void> {
    const { elementId } = message.payload;
    const result = await this.handlers.getElement(elementId);

    if (result.success) {
      this.sendResponse(clientId, message.id, true, { element: result.data });
    } else {
      this.sendResponse(clientId, message.id, false, undefined, result.error);
    }
  }

  /**
   * Handle getSnapshot message
   */
  private async handleGetSnapshot(
    clientId: string,
    message: WSClientMessage & { type: 'getSnapshot' }
  ): Promise<void> {
    const result = await this.handlers.getControlSnapshot();

    if (result.success) {
      this.sendResponse(clientId, message.id, true, result.data);
    } else {
      this.sendResponse(clientId, message.id, false, undefined, result.error);
    }
  }

  /**
   * Handle executeAction message
   */
  private async handleExecuteAction(
    clientId: string,
    message: WSClientMessage & { type: 'executeAction' }
  ): Promise<void> {
    const { elementId, action } = message.payload;
    const result = await this.handlers.executeElementAction(elementId, action);

    this.sendResponse(clientId, message.id, result.success, result.data, result.error);
  }

  /**
   * Handle executeComponentAction message
   */
  private async handleExecuteComponentAction(
    clientId: string,
    message: WSClientMessage & { type: 'executeComponentAction' }
  ): Promise<void> {
    const { componentId, action, params } = message.payload;
    const result = await this.handlers.executeComponentAction(componentId, { action, params });

    this.sendResponse(clientId, message.id, result.success, result.data, result.error);
  }

  /**
   * Handle executeWorkflow message
   */
  private async handleExecuteWorkflow(
    clientId: string,
    message: WSClientMessage & { type: 'executeWorkflow' }
  ): Promise<void> {
    const { workflowId, params } = message.payload;

    // Note: Progress streaming would need to be added to the handlers interface
    // For now, we just run the workflow without progress callbacks
    const result = await this.handlers.runWorkflow(workflowId, { params });

    this.sendResponse(clientId, message.id, result.success, result.data, result.error);
  }

  /**
   * Broadcast event to all subscribed clients
   */
  broadcastEvent(event: BridgeEvent): void {
    for (const [clientId, client] of this.clients) {
      // Check if client is subscribed to this event type
      if (
        client.subscription.events.size === 0 ||
        client.subscription.events.has(event.type)
      ) {
        // Check element/component filters if applicable
        const eventData = event.data as { elementId?: string; componentId?: string };

        if (
          eventData.elementId &&
          client.subscription.elementIds.size > 0 &&
          !client.subscription.elementIds.has(eventData.elementId)
        ) {
          continue;
        }

        if (
          eventData.componentId &&
          client.subscription.componentIds.size > 0 &&
          !client.subscription.componentIds.has(eventData.componentId)
        ) {
          continue;
        }

        this.sendToClient(clientId, {
          id: generateId(),
          type: 'event',
          timestamp: Date.now(),
          payload: event,
        } as WSEventMessage);
      }
    }
  }

  /**
   * Send message to specific client
   */
  private sendToClient(clientId: string, message: WSServerMessage): void {
    const client = this.clients.get(clientId);
    if (!client || client.ws.readyState !== 1) return;

    try {
      client.ws.send(JSON.stringify(message));

      if (this.verbose && message.type !== 'pong') {
        this.log(`[WS] ${clientId} <- ${message.type}`);
      }
    } catch (error) {
      console.error(`Failed to send message to ${clientId}:`, error);
    }
  }

  /**
   * Send response message
   */
  private sendResponse<T>(
    clientId: string,
    requestId: string,
    success: boolean,
    data?: T,
    error?: string
  ): void {
    this.sendToClient(clientId, {
      id: generateId(),
      type: 'response',
      timestamp: Date.now(),
      requestId,
      payload: {
        success,
        data,
        error,
      },
    } as WSResponseMessage<T>);
  }

  /**
   * Send error message
   */
  private sendError(
    clientId: string,
    requestId: string | undefined,
    code: string,
    message: string
  ): void {
    this.sendToClient(clientId, {
      id: generateId(),
      type: 'error',
      timestamp: Date.now(),
      requestId,
      payload: {
        code,
        message,
      },
    } as WSErrorMessage);
  }

  /**
   * Get connected client count
   */
  get clientCount(): number {
    return this.clients.size;
  }

  /**
   * Get all connected client IDs
   */
  get clientIds(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * Disconnect all clients
   */
  disconnectAll(): void {
    for (const [_clientId, client] of this.clients) {
      try {
        client.ws.close();
      } catch {
        // Ignore close errors
      }
    }
    this.clients.clear();
  }
}
