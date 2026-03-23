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

import type { ControlSnapshot } from '../control';
import type { DOMChangeEvent } from './types';

// ============================================================================
// Types
// ============================================================================

export interface QueuedCommand {
  commandId: string;
  action: string;
  payload: unknown;
  timestamp: number;
}

export type CommandListener = (command: QueuedCommand) => void;

export interface TabListener {
  tabId: string;
  callback: CommandListener;
}

export interface PendingCommand {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  tabsNotified: number;
  errorResponseCount: number;
  firstError?: Error;
  graceTimeout?: ReturnType<typeof setTimeout>;
}

export interface WebSocketClient {
  clientId: string;
  send: (message: string) => void;
  isConnected: () => boolean;
  close: () => void;
}

interface WebSocketClientEntry {
  client: WebSocketClient;
  connectedAt: number;
  lastActivity: number;
}

export interface TabInfo {
  tabId: string;
  url?: string;
  pathname?: string;
  title?: string;
}

export interface TransportDiagnostics {
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
}

export interface CommandRelayOptions {
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

// Commands that cause the page to unload — resolved immediately after delivery
const DEFAULT_FIRE_AND_FORGET = new Set(['pageNavigate', 'pageRefresh']);

// ============================================================================
// CommandRelay
// ============================================================================

export class CommandRelay {
  private readonly prefix: string;
  private readonly wsTimeoutMs: number;
  private readonly sseTimeoutMs: number;
  private readonly multiTabGraceMs: number;
  private readonly maxPendingCommands: number;
  private readonly heartbeatStaleMs: number;
  private readonly tabDemotionTtlMs: number;

  // All state lives on globalThis for HMR survival
  private readonly pendingCommands: Map<string, PendingCommand>;
  private readonly tabListeners: Map<string, TabListener>;
  private readonly wsClients: Map<string, WebSocketClientEntry>;
  private readonly demotedTabs: Set<string>;
  private readonly commandQueue: QueuedCommand[];
  private readonly tabHeartbeats: Map<string, number>;
  private readonly tabLastSuccess: Map<string, number>;

  // Simple value state
  private primaryTabId: string | null;
  readonly buildId: string;

  // Cleanup interval handle
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  // Connection readiness gate
  private connectionReadyResolve: (() => void) | null;
  private connectionReady: Promise<void>;

  constructor(options?: CommandRelayOptions) {
    this.prefix = options?.globalPrefix ?? '__uiBridge';
    this.wsTimeoutMs = options?.wsTimeoutMs ?? 10_000;
    this.sseTimeoutMs = options?.sseTimeoutMs ?? 8_000;
    this.multiTabGraceMs = options?.multiTabGraceMs ?? 3_000;
    this.maxPendingCommands = options?.maxPendingCommands ?? 200;
    this.heartbeatStaleMs = options?.heartbeatStaleMs ?? 30_000;
    this.tabDemotionTtlMs = options?.tabDemotionTtlMs ?? 60_000;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any;
    const key = (suffix: string) => `${this.prefix}${suffix}`;

    if (!g[key('PendingCommands')]) g[key('PendingCommands')] = new Map();
    if (!g[key('TabListeners')]) g[key('TabListeners')] = new Map();
    if (!g[key('WsClients')]) g[key('WsClients')] = new Map();
    if (!g[key('DemotedTabs')]) g[key('DemotedTabs')] = new Set();
    if (!g[key('CommandQueue')]) g[key('CommandQueue')] = [];
    if (!g[key('PrimaryTabId')]) g[key('PrimaryTabId')] = null;
    if (!g[key('TabHeartbeats')]) g[key('TabHeartbeats')] = new Map();
    if (!g[key('TabLastSuccess')]) g[key('TabLastSuccess')] = new Map();
    if (!g[key('BuildId')]) g[key('BuildId')] = Date.now().toString();

    if (!g[key('ConnectionReady')]) {
      let resolve: (() => void) | null = null;
      const promise = new Promise<void>((r) => {
        resolve = r;
      });
      g[key('ConnectionReady')] = promise;
      g[key('ConnectionReadyResolve')] = resolve;
    }
    this.connectionReady = g[key('ConnectionReady')];
    this.connectionReadyResolve = g[key('ConnectionReadyResolve')];

    this.pendingCommands = g[key('PendingCommands')];
    this.tabListeners = g[key('TabListeners')];
    this.wsClients = g[key('WsClients')];
    this.demotedTabs = g[key('DemotedTabs')];
    this.commandQueue = g[key('CommandQueue')];
    this.primaryTabId = g[key('PrimaryTabId')];
    this.tabHeartbeats = g[key('TabHeartbeats')];
    this.tabLastSuccess = g[key('TabLastSuccess')];
    this.buildId = g[key('BuildId')];

    // Periodic cleanup of stale tab entries (every 30s)
    if (!g[key('CleanupInterval')]) {
      g[key('CleanupInterval')] = setInterval(() => {
        this.cleanupStaleTabs();
      }, 30_000);
    }
    this.cleanupInterval = g[key('CleanupInterval')];
  }

  /**
   * Remove entries from tabHeartbeats and demotedTabs for tabs no longer connected.
   */
  private cleanupStaleTabs(): void {
    const now = Date.now();
    for (const [tabId, lastBeat] of this.tabHeartbeats.entries()) {
      const hasListener = this.tabListeners.has(tabId);
      const hasWs = this.wsClients.has(tabId);
      if (!hasListener && !hasWs) {
        // Tab is no longer connected — remove if heartbeat is stale
        if (now - lastBeat > this.tabDemotionTtlMs) {
          this.tabHeartbeats.delete(tabId);
          this.demotedTabs.delete(tabId);
          this.tabLastSuccess.delete(tabId);
        }
      }
    }
    // Also clean demoted tabs that have no heartbeat entry and no connection
    for (const tabId of this.demotedTabs) {
      if (
        !this.tabListeners.has(tabId) &&
        !this.wsClients.has(tabId) &&
        !this.tabHeartbeats.has(tabId)
      ) {
        this.demotedTabs.delete(tabId);
      }
    }
  }

  /**
   * Reset the connection readiness gate when all transports have disconnected.
   * The next call to queueCommand() will block until a new transport connects.
   */
  private resetConnectionGateIfEmpty(): void {
    if (this.tabListeners.size === 0 && this.wsClients.size === 0 && !this.connectionReadyResolve) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = globalThis as any;
      const key = (suffix: string) => `${this.prefix}${suffix}`;
      let resolve: (() => void) | null = null;
      const promise = new Promise<void>((r) => {
        resolve = r;
      });
      g[key('ConnectionReady')] = promise;
      g[key('ConnectionReadyResolve')] = resolve;
      this.connectionReady = promise;
      this.connectionReadyResolve = resolve;
    }
  }

  // --------------------------------------------------------------------------
  // Primary Tab Routing
  // --------------------------------------------------------------------------

  private getPrimaryTabId(): string | null {
    // Re-promote demoted tabs whose heartbeat is fresh AND still have an active connection
    const now = Date.now();
    for (const tabId of Array.from(this.demotedTabs)) {
      const lastBeat = this.tabHeartbeats.get(tabId);
      if (lastBeat && now - lastBeat < this.heartbeatStaleMs) {
        if (this.tabListeners.has(tabId) || this.wsClients.has(tabId)) {
          this.demotedTabs.delete(tabId);
          console.log(`[ui-bridge] Re-promoted tab with fresh heartbeat: ${tabId}`);
        }
      }
    }

    if (this.primaryTabId && !this.demotedTabs.has(this.primaryTabId)) {
      if (this.tabListeners.has(this.primaryTabId) || this.wsClients.has(this.primaryTabId)) {
        return this.primaryTabId;
      }
      this.primaryTabId = null;
      this.persistPrimaryTab();
    }

    // Collect all candidate tabs (non-demoted, connected)
    const candidates: string[] = [];
    for (const tab of this.tabListeners.keys()) {
      if (!this.demotedTabs.has(tab)) {
        candidates.push(tab);
      }
    }
    for (const [clientId, entry] of this.wsClients.entries()) {
      if (
        entry.client.isConnected() &&
        !this.demotedTabs.has(clientId) &&
        !candidates.includes(clientId)
      ) {
        candidates.push(clientId);
      }
    }

    if (candidates.length === 0) return null;

    // Sort candidates by tabLastSuccess (most recent first), then by insertion order
    candidates.sort((a, b) => {
      const aSuccess = this.tabLastSuccess.get(a) ?? 0;
      const bSuccess = this.tabLastSuccess.get(b) ?? 0;
      return bSuccess - aSuccess;
    });

    this.setPrimaryTab(candidates[0]!);
    return this.primaryTabId;
  }

  private setPrimaryTab(tabId: string): void {
    this.primaryTabId = tabId;
    this.persistPrimaryTab();
    console.log(`[ui-bridge] Primary tab: ${tabId}`);
  }

  private persistPrimaryTab(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any)[`${this.prefix}PrimaryTabId`] = this.primaryTabId;
  }

  private demotePrimaryTab(tabId: string): void {
    this.demotedTabs.add(tabId);
    if (this.primaryTabId === tabId) {
      this.primaryTabId = null;
      this.persistPrimaryTab();
      console.log(`[ui-bridge] Primary tab demoted: ${tabId}`);
    }
  }

  // --------------------------------------------------------------------------
  // Command Queue
  // --------------------------------------------------------------------------

  private generateCommandId(): string {
    return `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  /**
   * Queue a command with primary tab routing, automatic failover,
   * and retry-on-disconnect.
   */
  async queueCommand<T>(
    action: string,
    payload: unknown,
    options?: { targetTabId?: string }
  ): Promise<T> {
    // Wait for at least one transport if none available
    if (!options?.targetTabId && this.tabListeners.size === 0 && this.wsClients.size === 0) {
      await Promise.race([
        this.connectionReady,
        new Promise<void>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  'No browser connected — no WebSocket clients and no SSE listeners. ' +
                    'Ensure the web app is open in a browser tab.'
                )
              ),
            3000
          )
        ),
      ]);
    }

    // Attempt the command — if SDK_DISCONNECTED, wait for reconnection and retry once
    try {
      return await this.queueCommandInner<T>(action, payload, options);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('SDK_DISCONNECTED') || msg.includes('No browser connected')) {
        console.log(`[ui-bridge] ${action} failed (disconnected), waiting for reconnection...`);
        try {
          await Promise.race([
            this.connectionReady,
            new Promise<void>((_, reject) =>
              setTimeout(() => reject(new Error('Reconnection timeout')), 2000)
            ),
          ]);
          console.log(`[ui-bridge] Reconnected, retrying ${action}`);
          return await this.queueCommandInner<T>(action, payload, options);
        } catch {
          // Retry failed — throw original error
          throw err;
        }
      }
      throw err;
    }
  }

  /**
   * Inner command queue implementation (no retry logic).
   */
  private async queueCommandInner<T>(
    action: string,
    payload: unknown,
    options?: { targetTabId?: string }
  ): Promise<T> {
    const targetTabId = options?.targetTabId;

    // Explicit target — send directly, no failover
    if (targetTabId) {
      return this.sendCommand<T>(action, payload, options);
    }

    // Primary tab routing with automatic failover
    const primaryId = this.getPrimaryTabId();
    if (primaryId) {
      return this.sendCommand<T>(action, payload, { targetTabId: primaryId }).catch(
        (firstError: Error) => {
          this.demotePrimaryTab(primaryId);
          const newPrimaryId = this.getPrimaryTabId();
          if (newPrimaryId) {
            console.log(
              `[ui-bridge] Primary tab ${primaryId} failed for ${action}, retrying on ${newPrimaryId}`
            );
            return this.sendCommand<T>(action, payload, { targetTabId: newPrimaryId });
          }
          throw firstError;
        }
      );
    }

    // No primary tab — broadcast to all
    return this.sendCommand<T>(action, payload);
  }

  /**
   * Low-level: send a command to a specific tab or broadcast to all.
   */
  private sendCommand<T>(
    action: string,
    payload: unknown,
    options?: { targetTabId?: string }
  ): Promise<T> {
    const targetTabId = options?.targetTabId;
    const commandId = this.generateCommandId();
    const fireAndForget = DEFAULT_FIRE_AND_FORGET.has(action);
    console.log(
      `[ui-bridge] queueCommand: ${action} (ws=${this.wsClients.size}, sse=${this.tabListeners.size}${targetTabId ? `, target=${targetTabId}` : ''}${fireAndForget ? ', fire-and-forget' : ''})`
    );

    return new Promise((resolve, reject) => {
      // Try WebSocket delivery first
      const sentViaWebSocket = this.sendCommandViaWebSocket(
        commandId,
        action,
        payload,
        targetTabId
      );

      let transport = 'none';
      let timeoutMs = this.sseTimeoutMs;

      if (sentViaWebSocket) {
        transport = 'WebSocket';
        timeoutMs = this.wsTimeoutMs;
      }

      // Fail fast if no transport available
      if (!sentViaWebSocket && this.tabListeners.size === 0) {
        reject(
          new Error(
            `SDK_DISCONNECTED: No browser connected to receive ${action} command. ` +
              'No WebSocket clients and no SSE listeners registered. ' +
              'Ensure the web app is open in a browser tab with the UI Bridge SDK loaded.'
          )
        );
        return;
      }

      // Fire-and-forget: resolve immediately after delivery
      if (fireAndForget) {
        if (!sentViaWebSocket && this.tabListeners.size > 0) {
          const command: QueuedCommand = { commandId, action, payload, timestamp: Date.now() };
          this.broadcastToListeners(command, targetTabId);
        }
        resolve({ success: true, fireAndForget: true, action, timestamp: Date.now() } as T);
        return;
      }

      const timeout = setTimeout(() => {
        const pending = this.pendingCommands.get(commandId);
        if (pending?.graceTimeout) clearTimeout(pending.graceTimeout);
        const notified = pending?.tabsNotified ?? 0;
        this.pendingCommands.delete(commandId);
        reject(
          new Error(
            `Command ${action} timed out after ${timeoutMs}ms (${transport}). ` +
              `${notified} client(s) were notified but none responded. ` +
              'The UI Bridge SDK may not be loaded or the page may be unresponsive.'
          )
        );
      }, timeoutMs);

      // Evict oldest if at capacity
      if (this.pendingCommands.size >= this.maxPendingCommands) {
        const oldestKey = this.pendingCommands.keys().next().value;
        if (oldestKey) {
          const oldest = this.pendingCommands.get(oldestKey);
          if (oldest) {
            clearTimeout(oldest.timeout);
            if (oldest.graceTimeout) clearTimeout(oldest.graceTimeout);
            oldest.reject(new Error('Command evicted: too many pending commands'));
          }
          this.pendingCommands.delete(oldestKey);
        }
      }

      const pending: PendingCommand = {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
        tabsNotified: sentViaWebSocket ? 1 : 0,
        errorResponseCount: 0,
      };
      this.pendingCommands.set(commandId, pending);

      // If WebSocket failed, push via SSE
      if (!sentViaWebSocket) {
        const command: QueuedCommand = { commandId, action, payload, timestamp: Date.now() };

        if (this.tabListeners.size > 0) {
          transport = 'SSE';
          pending.tabsNotified = this.broadcastToListeners(command, targetTabId);

          // If broadcast reached no listeners, fail immediately
          if (pending.tabsNotified === 0) {
            clearTimeout(timeout);
            this.pendingCommands.delete(commandId);
            reject(
              new Error(
                `No active UI Bridge SDK client received the ${action} command. ` +
                  `${this.tabListeners.size} SSE listener(s) registered but none accepted the command. ` +
                  'Ensure the web app is open in a browser tab with the UI Bridge SDK loaded.'
              )
            );
            return;
          }
        } else {
          transport = 'HTTP-poll';
          this.commandQueue.push(command);
          while (this.commandQueue.length > 100) {
            const dropped = this.commandQueue.shift();
            if (dropped) {
              const p = this.pendingCommands.get(dropped.commandId);
              if (p) {
                clearTimeout(p.timeout);
                p.reject(new Error('Command dropped from queue'));
                this.pendingCommands.delete(dropped.commandId);
              }
            }
          }
        }
      }
    });
  }

  private broadcastToListeners(command: QueuedCommand, targetTabId?: string): number {
    if (targetTabId) {
      const listener = this.tabListeners.get(targetTabId);
      if (listener) {
        try {
          listener.callback(command);
          return 1;
        } catch {
          /* self-cleaning */
        }
      }
      return 0;
    }
    let notified = 0;
    for (const listener of this.tabListeners.values()) {
      try {
        listener.callback(command);
        notified++;
      } catch {
        /* self-cleaning */
      }
    }
    return notified;
  }

  // --------------------------------------------------------------------------
  // WebSocket Client Registry
  // --------------------------------------------------------------------------

  private sendCommandViaWebSocket(
    commandId: string,
    action: string,
    payload: unknown,
    targetTabId?: string
  ): boolean {
    const clientEntry = this.getConnectedClient(targetTabId);
    if (!clientEntry) return false;

    try {
      clientEntry.client.send(
        JSON.stringify({
          type: 'command',
          commandId,
          action,
          payload,
          timestamp: Date.now(),
        })
      );
      clientEntry.lastActivity = Date.now();
      return true;
    } catch (e) {
      console.error('[UIBridge] Failed to send WebSocket command:', e);
      return false;
    }
  }

  private getConnectedClient(targetTabId?: string): WebSocketClientEntry | null {
    if (targetTabId) {
      const entry = this.wsClients.get(targetTabId);
      if (entry) {
        if (entry.client.isConnected()) return entry;
        this.wsClients.delete(targetTabId);
      }
      return null;
    }
    for (const [clientId, entry] of this.wsClients.entries()) {
      if (entry.client.isConnected()) return entry;
      this.wsClients.delete(clientId);
    }
    return null;
  }

  /**
   * Register a WebSocket client for command delivery.
   */
  registerWebSocketClient(client: WebSocketClient): void {
    const now = Date.now();
    this.wsClients.set(client.clientId, { client, connectedAt: now, lastActivity: now });

    // Signal that a transport is ready
    if (this.connectionReadyResolve) {
      this.connectionReadyResolve();
      this.connectionReadyResolve = null;
    }

    console.log(`[UIBridge] WebSocket client registered: ${client.clientId}`);

    // Proactive snapshot capture
    setTimeout(async () => {
      if (!this.wsClients.has(client.clientId)) return;
      try {
        const result = await this.queueCommand<ControlSnapshot>(
          'getControlSnapshot',
          {},
          { targetTabId: client.clientId }
        );
        if (result.elements && result.elements.length > 0) {
          console.log(
            `[ui-bridge] Proactive WS snapshot captured: ${result.elements.length} elements`
          );
        }
      } catch {
        /* Client may have disconnected */
      }
    }, 500);
  }

  /**
   * Unregister a WebSocket client.
   */
  unregisterWebSocketClient(clientId: string): void {
    this.wsClients.delete(clientId);
    console.log(`[UIBridge] WebSocket client unregistered: ${clientId}`);
    this.resetConnectionGateIfEmpty();
  }

  /**
   * Update WebSocket client activity timestamp.
   */
  updateClientActivity(clientId: string): void {
    const entry = this.wsClients.get(clientId);
    if (entry) entry.lastActivity = Date.now();
  }

  /**
   * Get connected WebSocket client count.
   */
  getWebSocketClientCount(): number {
    for (const [clientId, entry] of this.wsClients.entries()) {
      if (!entry.client.isConnected()) this.wsClients.delete(clientId);
    }
    return this.wsClients.size;
  }

  /**
   * Broadcast an event to all connected WebSocket clients.
   */
  broadcastEvent(eventType: string, data: unknown): void {
    const message = JSON.stringify({ type: eventType, data, timestamp: Date.now() });
    for (const [clientId, entry] of this.wsClients.entries()) {
      if (entry.client.isConnected()) {
        try {
          entry.client.send(message);
          entry.lastActivity = Date.now();
        } catch {
          this.wsClients.delete(clientId);
        }
      } else {
        this.wsClients.delete(clientId);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Command Resolution
  // --------------------------------------------------------------------------

  /**
   * Resolve a pending command with a response from the browser.
   */
  resolveCommand(commandId: string, result: unknown, tabId?: string): boolean {
    const pending = this.pendingCommands.get(commandId);
    if (!pending) return false;

    clearTimeout(pending.timeout);
    if (pending.graceTimeout) clearTimeout(pending.graceTimeout);
    this.pendingCommands.delete(commandId);
    pending.resolve(result);

    // Track per-tab command success and remove from demoted set
    if (tabId) {
      this.tabLastSuccess.set(tabId, Date.now());
      this.demotedTabs.delete(tabId);
    }

    return true;
  }

  /**
   * Reject a pending command with an error from the browser.
   */
  rejectCommand(commandId: string, errorMessage: string): boolean {
    const pending = this.pendingCommands.get(commandId);
    if (!pending) return false;

    pending.errorResponseCount++;
    if (!pending.firstError) {
      pending.firstError = new Error(errorMessage);
    }

    // All notified tabs responded with errors — reject immediately
    if (pending.errorResponseCount >= pending.tabsNotified) {
      clearTimeout(pending.timeout);
      if (pending.graceTimeout) clearTimeout(pending.graceTimeout);
      this.pendingCommands.delete(commandId);
      pending.reject(pending.firstError!);
      return true;
    }

    // Start grace timer for tabs that may go silent
    if (!pending.graceTimeout) {
      pending.graceTimeout = setTimeout(() => {
        const stillPending = this.pendingCommands.get(commandId);
        if (stillPending) {
          clearTimeout(stillPending.timeout);
          this.pendingCommands.delete(commandId);
          stillPending.reject(stillPending.firstError || new Error(errorMessage));
        }
      }, this.multiTabGraceMs);
    }

    return true;
  }

  // --------------------------------------------------------------------------
  // Tab / Client Management
  // --------------------------------------------------------------------------

  /**
   * Subscribe to commands via SSE. Returns an unsubscribe function.
   */
  subscribeToCommands(listener: CommandListener, tabId?: string): () => void {
    const id = tabId || `anon_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    this.tabListeners.set(id, { tabId: id, callback: listener });

    // New tab becomes primary
    this.demotedTabs.delete(id);
    this.setPrimaryTab(id);

    // Signal that a transport is ready
    if (this.connectionReadyResolve) {
      this.connectionReadyResolve();
      this.connectionReadyResolve = null;
    }

    console.log(`[ui-bridge] SSE listener connected: ${id} (total: ${this.tabListeners.size})`);

    // Proactive snapshot capture
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const captureSnapshot = async (): Promise<boolean> => {
      if (!this.tabListeners.has(id)) return false;
      try {
        const result = await this.queueCommand<ControlSnapshot>(
          'getControlSnapshot',
          {},
          { targetTabId: id }
        );
        if (result.elements && result.elements.length > 0) {
          console.log(
            `[ui-bridge] Proactive snapshot captured: ${result.elements.length} elements`
          );
          return true;
        }
      } catch {
        /* Tab may have disconnected */
      }
      return false;
    };

    const proactiveTimer = setTimeout(async () => {
      const captured = await captureSnapshot();
      if (!captured && this.tabListeners.has(id)) {
        retryTimer = setTimeout(() => captureSnapshot(), 1500);
      }
    }, 500);

    return () => {
      clearTimeout(proactiveTimer);
      if (retryTimer) clearTimeout(retryTimer);
      this.tabListeners.delete(id);
      this.demotedTabs.delete(id);
      console.log(
        `[ui-bridge] SSE listener disconnected: ${id} (total: ${this.tabListeners.size})`
      );
      this.resetConnectionGateIfEmpty();
    };
  }

  /**
   * Check if any SSE listeners are connected.
   */
  hasCommandListeners(): boolean {
    return this.tabListeners.size > 0;
  }

  /**
   * Get list of connected tab IDs.
   */
  getConnectedTabs(): string[] {
    return Array.from(this.tabListeners.keys());
  }

  /**
   * Get connected tabs with page info by querying each tab.
   */
  async getTabsWithInfo(): Promise<TabInfo[]> {
    const tabIds = this.getConnectedTabs();
    return Promise.all(
      tabIds.map(async (tabId): Promise<TabInfo> => {
        try {
          const info = await Promise.race([
            this.queueCommand<{ url?: string; pathname?: string; title?: string }>(
              'getTabInfo',
              {},
              { targetTabId: tabId }
            ),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
          ]);
          return { tabId, url: info?.url, pathname: info?.pathname, title: info?.title };
        } catch {
          return { tabId };
        }
      })
    );
  }

  // --------------------------------------------------------------------------
  // Health
  // --------------------------------------------------------------------------

  /**
   * Record a heartbeat from the browser, optionally per-tab.
   */
  receiveHeartbeat(tabId?: string): void {
    const now = Date.now();
    if (tabId) {
      this.tabHeartbeats.set(tabId, now);
    } else {
      // Anonymous heartbeat — store under a synthetic key
      this.tabHeartbeats.set('__anonymous__', now);
    }
  }

  /**
   * Check if the browser app is responsive based on heartbeat freshness.
   * Returns true if ANY tab has a heartbeat within the stale threshold.
   */
  isAppResponsive(): boolean {
    const now = Date.now();
    for (const lastBeat of this.tabHeartbeats.values()) {
      if (now - lastBeat < this.heartbeatStaleMs) return true;
    }
    return false;
  }

  /**
   * Get the last heartbeat timestamp (max across all tabs).
   */
  getLastHeartbeat(): number {
    let max = 0;
    for (const lastBeat of this.tabHeartbeats.values()) {
      if (lastBeat > max) max = lastBeat;
    }
    return max;
  }

  // --------------------------------------------------------------------------
  // Diagnostics
  // --------------------------------------------------------------------------

  /**
   * Get internal transport state for debugging.
   */
  getTransportDiagnostics(): TransportDiagnostics {
    return {
      pendingCommandCount: this.pendingCommands.size,
      pendingCommandIds: Array.from(this.pendingCommands.keys()),
      commandListenerCount: this.tabListeners.size,
      connectedTabs: Array.from(this.tabListeners.keys()),
      primaryTabId: this.getPrimaryTabId(),
      demotedTabs: Array.from(this.demotedTabs),
      buildId: this.buildId,
      wsClientCount: this.wsClients.size,
      wsClientIds: Array.from(this.wsClients.keys()),
      commandQueueLength: this.commandQueue.length,
    };
  }

  /**
   * Get pending commands for legacy HTTP polling fallback.
   */
  getPendingCommands(): QueuedCommand[] {
    return this.commandQueue.splice(0, this.commandQueue.length);
  }

  // --------------------------------------------------------------------------
  // Push-Based Change Events
  // --------------------------------------------------------------------------

  private changeEventBuffer: DOMChangeEvent[] = [];
  private changeEventSubscribers = new Set<(event: DOMChangeEvent) => void>();
  private readonly maxChangeEvents = 5000;

  /**
   * Push a change event from a browser tab into the relay's ring buffer
   * and notify all subscribers.
   */
  pushChangeEvent(event: DOMChangeEvent): void {
    this.changeEventBuffer.push(event);
    if (this.changeEventBuffer.length > this.maxChangeEvents) {
      this.changeEventBuffer.splice(0, this.changeEventBuffer.length - this.maxChangeEvents);
    }
    for (const sub of this.changeEventSubscribers) {
      try {
        sub(event);
      } catch {
        /* subscriber errors are non-fatal */
      }
    }
  }

  /**
   * Subscribe to push-based change events. Returns an unsubscribe function.
   */
  subscribeChanges(callback: (event: DOMChangeEvent) => void): () => void {
    this.changeEventSubscribers.add(callback);
    return () => {
      this.changeEventSubscribers.delete(callback);
    };
  }

  /**
   * Get buffered change events since a timestamp.
   */
  getChangeEventsSince(since: number, limit = 100): DOMChangeEvent[] {
    return this.changeEventBuffer.filter((e) => e.timestamp > since).slice(-limit);
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.tabHeartbeats.clear();
    this.tabLastSuccess.clear();
    this.demotedTabs.clear();
    this.tabListeners.clear();
    this.commandQueue.length = 0;
    this.changeEventBuffer.length = 0;
    this.changeEventSubscribers.clear();
  }
}
