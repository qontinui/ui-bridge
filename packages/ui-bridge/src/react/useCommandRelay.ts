'use client';

/**
 * useCommandRelay — Browser-side hook for the SDK command relay
 *
 * Connects to the server's command relay via SSE, receives commands,
 * executes them using the UIBridgeRegistry, and POSTs results back.
 * Also sends periodic heartbeats to signal app responsiveness.
 *
 * This is the SDK equivalent of qontinui-web's useUIBridgeCommandHandler,
 * but portable to any app using @qontinui/ui-bridge.
 */

import { useEffect, useRef, useCallback, useMemo } from 'react';
import { useUIBridge } from './useUIBridge';
import { useUIBridgeOptional } from './UIBridgeProvider';
import { executeCommand, type BridgeAccess } from './commandHandlers';

// SSE reconnection delay (10s to avoid Next.js route recompilation cascades)
const SSE_RECONNECT_DELAY_MS = 10_000;

// Heartbeat interval — kept alive even when tab is hidden
const HEARTBEAT_INTERVAL_MS = 10_000;

interface QueuedCommand {
  commandId: string;
  action: string;
  payload: unknown;
  timestamp: number;
}

export interface UseCommandRelayOptions {
  /** Whether the relay is enabled (default: true) */
  enabled?: boolean;
  /** Base path for UI Bridge API routes (default: '/api/ui-bridge') */
  basePath?: string;
  /** Heartbeat interval in ms (default: 10000) */
  heartbeatInterval?: number;
}

/**
 * Hook that connects the browser to the server's command relay.
 *
 * 1. Connects to `{basePath}/commands/stream` via SSE
 * 2. Receives commands, executes via UIBridge registry + browser APIs
 * 3. POSTs results back to `{basePath}/commands`
 * 4. Sends heartbeat every 10s to `{basePath}/heartbeat`
 * 5. Handles reconnection on visibility change
 */
export function useCommandRelay(options?: UseCommandRelayOptions): void {
  const enabled = options?.enabled ?? true;
  const basePath = options?.basePath ?? '/api/ui-bridge';
  const heartbeatIntervalMs = options?.heartbeatInterval ?? HEARTBEAT_INTERVAL_MS;

  const uiBridge = useUIBridge();
  const context = useUIBridgeOptional();

  // Build BridgeAccess with registry from context
  const bridge = useMemo<BridgeAccess>(() => ({
    ...uiBridge as unknown as BridgeAccess,
    registry: context?.registry ? {
      getAllStates: () => context.registry.getAllStates(),
      getState: (id: string) => context.registry.getState(id),
      getActiveStates: () => context.registry.getActiveStates(),
      activateState: (id: string) => context.registry.activateState(id),
      deactivateState: (id: string) => context.registry.deactivateState(id),
      getAllStateGroups: () => context.registry.getAllStateGroups(),
      getStateGroup: (id: string) => context.registry.getStateGroup(id),
      activateStateGroup: (id: string) => context.registry.activateStateGroup(id),
      deactivateStateGroup: (id: string) => context.registry.deactivateStateGroup(id),
      getAllTransitions: () => context.registry.getAllTransitions(),
      getTransition: (id: string) => context.registry.getTransition(id),
      canExecuteTransition: (id: string) => context.registry.canExecuteTransition(id),
      executeTransition: (id: string) => context.registry.executeTransition(id),
      findPath: (targets: string[]) => context.registry.findPath(targets),
      navigateTo: (targets: string[]) => context.registry.navigateTo(targets),
      getStateSnapshot: () => ({
        timestamp: Date.now(),
        activeStates: context.registry.getActiveStates(),
        states: context.registry.getAllStates(),
        groups: context.registry.getAllStateGroups(),
        transitions: context.registry.getAllTransitions(),
      }),
    } : undefined,
  }), [uiBridge, context]);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable per-tab identifier, persisted across re-renders but unique per browser tab
  const tabIdRef = useRef<string | null>(null);
  if (tabIdRef.current === null) {
    const STORAGE_KEY = '__uiBridge_tabId';
    let stored = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(STORAGE_KEY) : null;
    if (!stored) {
      stored = crypto.randomUUID();
      try { sessionStorage.setItem(STORAGE_KEY, stored); } catch { /* SSR or quota */ }
    }
    tabIdRef.current = stored;
  }
  const tabId = tabIdRef.current;

  // ========================================================================
  // Response Sender
  // ========================================================================

  const sendResponse = useCallback(
    async (commandId: string, ok: boolean, result: unknown) => {
      try {
        await fetch(`${basePath}/commands`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            commandId, success: ok, result, tabId,
            error: ok ? undefined : (result as { error?: string })?.error,
          }),
        });
      } catch (e) {
        console.error('[UIBridge] Failed to send command response:', e);
      }
    },
    [basePath, tabId]
  );

  // ========================================================================
  // Command Processor
  // ========================================================================

  const processCommand = useCallback(
    async (command: QueuedCommand) => {
      try {
        const result = await executeCommand(
          command.action,
          command.payload as Record<string, unknown>,
          bridge as unknown as BridgeAccess,
        );
        const resultObj = result as { success?: boolean };
        if (resultObj && resultObj.success === false) {
          await sendResponse(command.commandId, false, result);
          return;
        }
        await sendResponse(command.commandId, true, result);
      } catch (e: unknown) {
        const errorMessage = (e as Error).message;
        let errorCode = 'UNKNOWN_ERROR';
        if (errorMessage.includes('not found')) errorCode = 'ELEMENT_NOT_FOUND';
        else if (errorMessage.includes('timeout')) errorCode = 'ACTION_TIMEOUT';
        else if (errorMessage.includes('Unknown command')) errorCode = 'UNKNOWN_COMMAND';

        await sendResponse(command.commandId, false, {
          success: false, error: errorMessage,
          failureDetails: {
            errorCode, message: errorMessage,
            timestamp: Date.now(),
          },
          durationMs: 0, timestamp: Date.now(),
        });
      }
    },
    [bridge, sendResponse]
  );

  // ========================================================================
  // SSE Connection
  // ========================================================================

  useEffect(() => {
    if (!enabled) {
      if (eventSourceRef.current) { eventSourceRef.current.close(); eventSourceRef.current = null; }
      if (reconnectTimeoutRef.current) { clearTimeout(reconnectTimeoutRef.current); reconnectTimeoutRef.current = null; }
      return;
    }

    let isMounted = true;

    const connect = () => {
      if (!isMounted) return;
      const es = new EventSource(`${basePath}/commands/stream${tabId ? `?tabId=${encodeURIComponent(tabId)}` : ''}`);
      eventSourceRef.current = es;

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'connected') return;
          if (data.commandId && data.action) processCommand(data as QueuedCommand);
        } catch (e) {
          console.error('[UIBridge] Failed to parse SSE message:', e);
        }
      };

      es.onerror = () => {
        es.close();
        eventSourceRef.current = null;
        if (isMounted && document.visibilityState === 'visible') {
          reconnectTimeoutRef.current = setTimeout(() => {
            if (isMounted) connect();
          }, SSE_RECONNECT_DELAY_MS);
        }
      };
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Reconnect if SSE was dropped for any reason
        if (!eventSourceRef.current) connect();
        // Proactive refresh could be added here
      }
      // Do NOT disconnect on hide — automation tools need background access
    };

    if (document.visibilityState === 'visible') connect();
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      isMounted = false;
      if (eventSourceRef.current) { eventSourceRef.current.close(); eventSourceRef.current = null; }
      if (reconnectTimeoutRef.current) { clearTimeout(reconnectTimeoutRef.current); reconnectTimeoutRef.current = null; }
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [enabled, basePath, processCommand]);

  // ========================================================================
  // Heartbeat
  // ========================================================================

  // Include tabId as SSE query param when connecting
  useEffect(() => {
    if (!enabled) return;
    // Patch the SSE connect to include tabId — reconnect if already connected
    const existingEs = eventSourceRef.current;
    if (existingEs) {
      const currentUrl = new URL(existingEs.url);
      if (currentUrl.searchParams.get('tabId') !== tabId) {
        existingEs.close();
        eventSourceRef.current = null;
      }
    }
  }, [enabled, tabId]);

  useEffect(() => {
    if (!enabled) return;

    const sendHeartbeat = () => {
      fetch(`${basePath}/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timestamp: Date.now(), tabId }),
      }).catch(() => { /* non-fatal */ });
    };

    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, heartbeatIntervalMs);
    return () => clearInterval(interval);
  }, [enabled, basePath, heartbeatIntervalMs, tabId]);
}
