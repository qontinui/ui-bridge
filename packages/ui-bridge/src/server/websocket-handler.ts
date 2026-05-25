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
} from '../core';
import { RecordingSessionManager } from '../recording/session-manager';
import type { CooccurrenceExportData } from '../recording/types';

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
  private handlers: Partial<UIBridgeServerHandlers>;
  private clients = new Map<string, ConnectedClient>();
  private verbose: boolean;
  private log: (message: string) => void;
  private recordingManager: RecordingSessionManager | null = null;
  private lastAutoSavedExport: CooccurrenceExportData | null = null;

  constructor(
    handlers: Partial<UIBridgeServerHandlers>,
    options: {
      verbose?: boolean;
      log?: (message: string) => void;
      /** Registry and change observer for recording session support */
      recording?: {
        registry: import('../core/registry').UIBridgeRegistry;
        changeObserver?: import('../core/change-observer').ChangeObserver;
      };
    } = {}
  ) {
    this.handlers = handlers;
    this.verbose = options.verbose ?? false;
    this.log = options.log ?? console.log;

    // Initialize recording support if registry is provided
    if (options.recording) {
      this.recordingManager = new RecordingSessionManager(
        options.recording.registry,
        options.recording.changeObserver ?? null,
        {
          // Wire auto-save to store exports server-side for disconnect recovery
          onAutoSave: (partialExport) => {
            this.lastAutoSavedExport = partialExport;
          },
        }
      );
    }
  }

  /**
   * Handle new WebSocket connection.
   *
   * @param preferredId Stable tab/client id supplied by the client (e.g. the
   *   persisted `__uiBridge_tabId`, forwarded by the server adapter from the
   *   `?tabId=` query param of the upgrade request). When present, the client
   *   RESUMES under that id across reconnects instead of being assigned a fresh
   *   one — otherwise a tab churns its server-side identity on every reconnect,
   *   defeating `?tabId=` command pinning. Falls back to a generated id.
   */
  handleConnection(ws: WebSocketLike, preferredId?: string): string {
    const clientId = preferredId && preferredId.trim() ? preferredId.trim() : generateId();

    // Resume: if a prior socket is still registered under this id (stale
    // connection not yet reaped), evict it. The old socket's late `onclose`
    // is neutralised by the ws-identity guard in handleDisconnect below.
    const existing = this.clients.get(clientId);
    if (existing && existing.ws !== ws) {
      try {
        existing.ws.close?.();
      } catch {
        /* best-effort */
      }
    }

    const client: ConnectedClient = {
      id: clientId,
      ws,
      subscription: existing?.subscription ?? {
        events: new Set(),
        elementIds: new Set(),
        componentIds: new Set(),
      },
      connectedAt: Date.now(),
    };

    this.clients.set(clientId, client);

    if (this.verbose) {
      this.log(
        `[WS] Client ${existing ? 'resumed' : 'connected'}: ${clientId}` +
          (preferredId ? ' (client-supplied id)' : '')
      );
    }

    // Set up message handler
    ws.onmessage = (event: { data: string }) => {
      this.handleMessage(clientId, event.data);
    };

    // Set up close handler. Capture THIS ws so a stale socket's delayed close
    // cannot evict a newer resumed client registered under the same id.
    ws.onclose = () => {
      this.handleDisconnect(clientId, ws);
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
   * Handle client disconnect.
   *
   * @param ws When provided, only evict the registered client if it is STILL
   *   the same socket. This prevents a stale socket's late close from removing
   *   a newer connection that resumed under the same id (see handleConnection).
   */
  handleDisconnect(clientId: string, ws?: WebSocketLike): void {
    if (ws) {
      const current = this.clients.get(clientId);
      if (current && current.ws !== ws) {
        // A newer socket already resumed this id — leave it intact.
        return;
      }
    }
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
    } catch (_error) {
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

        case 'getElementHistory':
          await this.handleGetElementHistory(clientId, message);
          break;

        case 'changeEvent': {
          // Push-based change observation: broadcast to all other subscribed clients
          const changePayload = (message as import('../core').WSChangeEventMessage).payload;
          this.broadcastEvent(
            {
              type: 'snapshot:changed',
              timestamp: Date.now(),
              data: changePayload ?? {},
            },
            clientId
          );
          break;
        }

        case 'recording:start':
          this.handleRecordingStart(clientId, message);
          break;

        case 'recording:stop':
          this.handleRecordingStop(clientId, message);
          break;

        case 'recording:status':
          this.handleRecordingStatus(clientId, message);
          break;

        case 'recording:autosave':
          this.handleRecordingAutoSave(clientId, message);
          break;

        case 'recording:recover':
          this.handleRecordingRecover(clientId, message);
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
    if (!this.handlers.find) {
      this.sendResponse(clientId, message.id, false, undefined, 'find handler not available');
      return;
    }
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
    if (!this.handlers.getElement) {
      this.sendResponse(clientId, message.id, false, undefined, 'getElement handler not available');
      return;
    }
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
    if (!this.handlers.getControlSnapshot) {
      this.sendResponse(
        clientId,
        message.id,
        false,
        undefined,
        'getControlSnapshot handler not available'
      );
      return;
    }
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
    if (!this.handlers.executeElementAction) {
      this.sendResponse(
        clientId,
        message.id,
        false,
        undefined,
        'executeElementAction handler not available'
      );
      return;
    }
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
    if (!this.handlers.executeComponentAction) {
      this.sendResponse(
        clientId,
        message.id,
        false,
        undefined,
        'executeComponentAction handler not available'
      );
      return;
    }
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
    if (!this.handlers.runWorkflow) {
      this.sendResponse(
        clientId,
        message.id,
        false,
        undefined,
        'runWorkflow handler not available'
      );
      return;
    }
    const result = await this.handlers.runWorkflow(workflowId, { params });

    this.sendResponse(clientId, message.id, result.success, result.data, result.error);
  }

  /**
   * Handle getElementHistory message
   */
  private async handleGetElementHistory(
    clientId: string,
    message: WSClientMessage & { type: 'getElementHistory' }
  ): Promise<void> {
    const { elementId, options } = message.payload;
    if (!this.handlers.getElementHistory) {
      this.sendResponse(
        clientId,
        message.id,
        false,
        undefined,
        'getElementHistory handler not available'
      );
      return;
    }
    const result = await this.handlers.getElementHistory(elementId, options);

    if (result.success) {
      this.sendResponse(clientId, message.id, true, { entries: result.data });
    } else {
      this.sendResponse(clientId, message.id, false, undefined, result.error);
    }
  }

  /**
   * Broadcast event to all subscribed clients
   * @param excludeClientId - optional client ID to skip (e.g. the sender)
   */
  broadcastEvent(event: BridgeEvent, excludeClientId?: string): void {
    for (const [clientId, client] of this.clients) {
      if (clientId === excludeClientId) continue;
      // Check if client is subscribed to this event type
      if (client.subscription.events.size === 0 || client.subscription.events.has(event.type)) {
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

  // ==========================================================================
  // Recording Handlers
  // ==========================================================================

  private handleRecordingStart(clientId: string, message: WSClientMessage): void {
    if (!this.recordingManager) {
      this.sendError(
        clientId,
        message.id,
        'RECORDING_UNAVAILABLE',
        'Recording not configured — registry not provided'
      );
      return;
    }

    try {
      const config = (message as import('../core').WSRecordingStartMessage).payload?.config;
      this.recordingManager.start(config);
      const status = this.recordingManager.getStatus();
      this.sendResponse(clientId, message.id, true, status);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.sendError(clientId, message.id, 'RECORDING_START_ERROR', err.message);
    }
  }

  private handleRecordingStop(clientId: string, message: WSClientMessage): void {
    if (!this.recordingManager) {
      this.sendError(clientId, message.id, 'RECORDING_UNAVAILABLE', 'Recording not configured');
      return;
    }

    try {
      const result = this.recordingManager.stop();
      this.sendResponse(clientId, message.id, true, result);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.sendError(clientId, message.id, 'RECORDING_STOP_ERROR', err.message);
    }
  }

  private handleRecordingStatus(clientId: string, message: WSClientMessage): void {
    if (!this.recordingManager) {
      this.sendResponse(clientId, message.id, true, {
        active: false,
        duration: 0,
        interactionCount: 0,
        captureCount: 0,
      });
      return;
    }

    const status = this.recordingManager.getStatus();
    this.sendResponse(clientId, message.id, true, status);
  }

  /**
   * Handle recording:autosave — stores the latest auto-saved export data.
   * Called by the client or internally when the auto-save callback fires.
   */
  private handleRecordingAutoSave(clientId: string, message: WSClientMessage): void {
    try {
      const payload = (
        message as WSClientMessage & { payload?: { exportData?: CooccurrenceExportData } }
      ).payload;
      if (payload?.exportData) {
        this.lastAutoSavedExport = payload.exportData;
        this.sendResponse(clientId, message.id, true, { stored: true });
      } else {
        this.sendError(
          clientId,
          message.id,
          'AUTOSAVE_INVALID',
          'Missing exportData in autosave payload'
        );
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.sendError(clientId, message.id, 'AUTOSAVE_ERROR', err.message);
    }
  }

  /**
   * Handle recording:recover — returns the last auto-saved export data.
   * Used by clients to recover partial recording data after a disconnect.
   */
  private handleRecordingRecover(clientId: string, message: WSClientMessage): void {
    if (this.lastAutoSavedExport) {
      this.sendResponse(clientId, message.id, true, {
        recovered: true,
        exportData: this.lastAutoSavedExport,
      });
    } else {
      this.sendResponse(clientId, message.id, true, {
        recovered: false,
        exportData: null,
      });
    }
  }
}
