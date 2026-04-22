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

/**
 * JSON.stringify replacer that strips DOM nodes and handles circular references.
 * Command handler results can contain HTMLElement refs (e.g., from component
 * getState() or action handlers), which create cycles via React's __reactFiber$.
 */
function safeJsonStringify(value: unknown): string {
  const seen = new WeakSet();
  return JSON.stringify(value, (_key, val) => {
    if (val !== null && typeof val === 'object') {
      // Strip DOM nodes — they're never meaningful in JSON responses
      if (typeof Node !== 'undefined' && val instanceof Node) {
        return `[${val.constructor.name}]`;
      }
      // Break circular references
      if (seen.has(val)) return '[Circular]';
      seen.add(val);
    }
    // Strip functions
    if (typeof val === 'function') return undefined;
    return val;
  });
}

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
  /**
   * Explicit runner URL override for phone-home registration.
   * Default: 'http://127.0.0.1:9876'. When set, phone-home fires regardless
   * of hostname; otherwise it is gated to localhost-family hosts.
   */
  runnerUrl?: string;
  /** Opt out of the phone-home registration entirely. */
  disablePhoneHome?: boolean;
  /** Stable identity for this app in the runner's registry. Default: hostname. */
  appId?: string;
  /** Display name. Default: `document.title || location.hostname`. */
  appName?: string;
  /** App classification. Default: 'web'. */
  appType?: 'web' | 'desktop' | 'mobile' | 'dashboard' | 'other';
  /** Framework hint. Default: 'react'. */
  framework?: string;
  /** Capability tags. Default: ['control']. */
  capabilities?: string[];
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
  const bridge = useMemo<BridgeAccess>(
    () => ({
      ...(uiBridge as unknown as BridgeAccess),
      registry: context?.registry
        ? {
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
          }
        : undefined,
    }),
    [uiBridge, context]
  );

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const processCommandRef = useRef<(command: QueuedCommand) => void>(() => {});
  // Exposes a force-reconnect function that the heartbeat loop can call when
  // the server reports our tabId is no longer registered (silent SSE drop).
  const forceReconnectRef = useRef<() => void>(() => {});

  // Stable per-tab identifier, persisted across re-renders but unique per browser tab
  const tabIdRef = useRef<string | null>(null);
  if (tabIdRef.current === null) {
    const STORAGE_KEY = '__uiBridge_tabId';
    let stored = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(STORAGE_KEY) : null;
    if (!stored) {
      stored = crypto.randomUUID();
      try {
        sessionStorage.setItem(STORAGE_KEY, stored);
      } catch {
        /* SSR or quota */
      }
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
          body: safeJsonStringify({
            commandId,
            success: ok,
            result,
            tabId,
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
          bridge as unknown as BridgeAccess
        );
        const resultObj = result as { success?: boolean };
        if (resultObj && resultObj.success === false) {
          await sendResponse(command.commandId, false, result);
          return;
        }
        await sendResponse(command.commandId, true, result);
      } catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        let errorCode = 'UNKNOWN_ERROR';
        if (errorMessage.includes('not found')) errorCode = 'ELEMENT_NOT_FOUND';
        else if (errorMessage.includes('timeout')) errorCode = 'ACTION_TIMEOUT';
        else if (errorMessage.includes('Unknown command')) errorCode = 'UNKNOWN_COMMAND';

        await sendResponse(command.commandId, false, {
          success: false,
          error: errorMessage,
          failureDetails: {
            errorCode,
            message: errorMessage,
            timestamp: Date.now(),
          },
          durationMs: 0,
          timestamp: Date.now(),
        });
      }
    },
    [bridge, sendResponse]
  );

  // Keep processCommand ref current without triggering SSE reconnect
  processCommandRef.current = processCommand;

  // ========================================================================
  // SSE Connection
  // ========================================================================

  useEffect(() => {
    if (!enabled) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      return;
    }

    let isMounted = true;

    const connect = () => {
      if (!isMounted) return;
      const es = new EventSource(
        `${basePath}/commands/stream${tabId ? `?tabId=${encodeURIComponent(tabId)}` : ''}`
      );
      eventSourceRef.current = es;

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'connected') return;
          if (data.commandId && data.action) processCommandRef.current(data as QueuedCommand);
        } catch (e) {
          console.error('[UIBridge] Failed to parse SSE message:', e);
        }
      };

      es.onerror = () => {
        es.close();
        // Only nullify ref if it still points to this EventSource (avoid race with new connection)
        if (eventSourceRef.current === es) eventSourceRef.current = null;
        // Always reconnect — automation tools need SSE even in background tabs
        if (isMounted) {
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectTimeoutRef.current = null;
            if (isMounted) connect();
          }, SSE_RECONNECT_DELAY_MS);
        }
      };
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Reconnect immediately if SSE was dropped while hidden.
        // Clear any pending reconnect timeout to prevent the error handler's
        // delayed reconnect from racing with this immediate one.
        if (!eventSourceRef.current) {
          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
          }
          connect();
        }
      }
      // Do NOT disconnect on hide — automation tools need background access
    };

    // Always connect immediately — automation tools need background tab access
    connect();
    document.addEventListener('visibilitychange', handleVisibility);

    // Publish a force-reconnect hook callable by the heartbeat recovery loop
    forceReconnectRef.current = () => {
      if (!isMounted) return;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      connect();
    };

    return () => {
      isMounted = false;
      forceReconnectRef.current = () => {};
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [enabled, basePath, tabId]);

  // ========================================================================
  // Heartbeat
  // ========================================================================

  useEffect(() => {
    if (!enabled) return;

    const sendHeartbeat = async () => {
      try {
        const resp = await fetch(`${basePath}/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            timestamp: Date.now(),
            tabId,
            url: typeof window !== 'undefined' ? window.location.href : undefined,
            title: typeof document !== 'undefined' ? document.title : undefined,
            visibility: typeof document !== 'undefined' ? document.visibilityState : undefined,
          }),
        });
        // Recovery: the server reports whether our tabId is a registered SSE
        // listener. If it is not (e.g. after a client-side navigation that
        // silently closed the EventSource without triggering onerror), we
        // need to reopen the stream — otherwise the tab will appear
        // disconnected to all automation tools until the user reloads.
        if (resp.ok) {
          try {
            const data = await resp.json();
            const tabRegistered = data?.tabRegistered ?? data?.data?.tabRegistered ?? null;
            if (tabRegistered === false) {
              // Server lost our registration. Force a full reconnect
              // regardless of the EventSource's local readyState — the SSE
              // may appear open locally while the server-side stream has
              // already been reaped (e.g. after a client-side navigation
              // that ran strict-mode double-effects or after a proxy
              // dropped the idle connection).
              forceReconnectRef.current();
            }
          } catch {
            /* older server — no recovery payload */
          }
        }
      } catch {
        /* non-fatal */
      }
    };

    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, heartbeatIntervalMs);
    return () => clearInterval(interval);
  }, [enabled, basePath, heartbeatIntervalMs, tabId]);

  // ========================================================================
  // Phone-home registration
  // ========================================================================
  // POSTs a registration payload to the local qontinui-runner so the
  // integration tool can discover this app without a port scan. Gated to
  // localhost-family hostnames by default; opt in on non-localhost via
  // `runnerUrl`, or opt out with `disablePhoneHome`.
  useEffect(() => {
    if (!enabled || options?.disablePhoneHome) return;
    if (typeof window === 'undefined') return; // SSR guard

    const host = window.location.hostname;
    const isLocalhost =
      host === '127.0.0.1' ||
      host === 'localhost' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host.endsWith('.local');
    const runnerUrl = options?.runnerUrl ?? 'http://127.0.0.1:9876';
    // Guard: only phone home on localhost unless explicitly overridden.
    if (!isLocalhost && !options?.runnerUrl) return;

    const origin = window.location.origin;
    const baseUrl = `${origin}${basePath}`;
    const resolvedAppId = options?.appId ?? host;
    const appName = options?.appName ?? (document.title || host);
    const appType = options?.appType ?? 'web';
    const framework = options?.framework ?? 'react';
    const capabilities = options?.capabilities ?? ['control'];

    const payload = {
      appId: resolvedAppId,
      appName,
      appType,
      transport: 'http',
      baseUrl,
      framework,
      capabilities,
      origin,
    };

    let cancelled = false;

    const register = async () => {
      try {
        await fetch(`${runnerUrl}/ui-bridge/apps/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch {
        // Runner not reachable — silent. Expected when runner is down or
        // unreachable (e.g. DNS failure inside a container).
      }
    };

    register();
    const interval = setInterval(() => {
      if (!cancelled) register();
    }, 10_000);

    // Best-effort deregister on tab close. Uses fetch(keepalive) because
    // sendBeacon only supports POST and the runner's deregister route is a
    // DELETE. keepalive lets the browser finish the request after the tab
    // navigates away. If this fails (older browser, request blocked, etc.)
    // the runner's 30s staleness sweeper will evict the entry anyway.
    const onBeforeUnload = () => {
      try {
        void fetch(`${runnerUrl}/ui-bridge/apps/register/${encodeURIComponent(resolvedAppId)}`, {
          method: 'DELETE',
          keepalive: true,
        });
      } catch {
        /* swallow: unreachable-runner is the common case and not actionable here */
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- values read from options are stable for the component's lifetime
  }, [
    enabled,
    basePath,
    options?.disablePhoneHome,
    options?.runnerUrl,
    options?.appId,
    options?.appName,
    options?.appType,
    options?.framework,
  ]);
}
