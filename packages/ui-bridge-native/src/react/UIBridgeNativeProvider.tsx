/**
 * UI Bridge Native Provider
 *
 * React context provider for UI Bridge Native functionality.
 */

import React, {
  createContext,
  useContext,
  useMemo,
  useEffect,
  useCallback,
  useRef,
  useState,
} from 'react';
import type {
  NativeUIBridgeFeatures,
  NativeUIBridgeConfig,
  RegisteredNativeElement,
  RegisteredNativeComponent,
  NativeBridgeSnapshot,
  BridgeEventType,
  BridgeEventListener,
} from '../core/types';
import { NativeUIBridgeRegistry, setGlobalRegistry, resetGlobalRegistry } from '../core/registry';
import { createNativeActionExecutor } from '../control/action-executor';
import type { NativeActionExecutor } from '../control/types';
import { createNativeServer, type NativeUIBridgeServer, type ServerAdapter, type WebSocketServerAdapter } from '../server/http-server';
import { WebSocketEventBridge } from '../server/ws-event-bridge';

/**
 * UI Bridge Native context value
 */
export interface UIBridgeNativeContextValue {
  /** Feature flags */
  features: NativeUIBridgeFeatures;
  /** Configuration */
  config: NativeUIBridgeConfig;
  /** Element registry */
  registry: NativeUIBridgeRegistry;
  /** Action executor */
  executor: NativeActionExecutor;
  /** Get all registered elements */
  getElements: () => RegisteredNativeElement[];
  /** Get all registered components */
  getComponents: () => RegisteredNativeComponent[];
  /** Create a snapshot */
  createSnapshot: () => NativeBridgeSnapshot;
  /** Subscribe to events */
  on: <T = unknown>(type: BridgeEventType, listener: BridgeEventListener<T>) => () => void;
  /** Unsubscribe from events */
  off: <T = unknown>(type: BridgeEventType, listener: BridgeEventListener<T>) => void;
  /** Whether the provider is initialized */
  initialized: boolean;
  /** Server running status */
  serverRunning: boolean;
  /** Start the HTTP server */
  startServer: () => Promise<void>;
  /** Stop the HTTP server */
  stopServer: () => void;
}

/**
 * UI Bridge Native context
 */
const UIBridgeNativeContext = createContext<UIBridgeNativeContextValue | null>(null);

/**
 * UI Bridge Native provider props
 */
export interface UIBridgeNativeProviderProps {
  /** Child components */
  children: React.ReactNode;
  /** Feature flags */
  features?: NativeUIBridgeFeatures;
  /** Configuration */
  config?: NativeUIBridgeConfig;
  /** Event handler */
  onEvent?: BridgeEventListener;
  /**
   * A ServerAdapter instance for the HTTP server.
   * The app is responsible for creating this using its preferred native TCP/HTTP library.
   * @see ServerAdapter interface in server/http-server.ts
   */
  serverAdapter?: ServerAdapter;
  /**
   * Navigation provider for programmatic route navigation via UI Bridge.
   * Pass Expo Router's push/back functions to enable `control/page/navigate`.
   */
  navigationProvider?: { navigate: (url: string) => void; back?: () => void };
}

/**
 * UI Bridge Native Provider
 *
 * Provides UI Bridge Native context to child components.
 *
 * @example
 * ```tsx
 * // app/_layout.tsx
 * import { UIBridgeNativeProvider } from 'ui-bridge-native';
 *
 * export default function RootLayout() {
 *   return (
 *     <UIBridgeNativeProvider
 *       features={{ server: __DEV__, debug: __DEV__ }}
 *       config={{ serverPort: 8087 }}
 *     >
 *       <Stack>{children}</Stack>
 *     </UIBridgeNativeProvider>
 *   );
 * }
 * ```
 */
export function UIBridgeNativeProvider({
  children,
  features = {},
  config = {},
  onEvent,
  serverAdapter,
  navigationProvider,
}: UIBridgeNativeProviderProps) {
  const registryRef = useRef<NativeUIBridgeRegistry | null>(null);
  const executorRef = useRef<NativeActionExecutor | null>(null);
  const [serverRunning, setServerRunning] = useState(false);

  // Initialize on first render
  if (!registryRef.current) {
    registryRef.current = new NativeUIBridgeRegistry({
      verbose: config.verbose,
      onEvent,
    });
    setGlobalRegistry(registryRef.current);
  }

  const registry = registryRef.current;

  // Create executor (memoized)
  if (!executorRef.current) {
    executorRef.current = createNativeActionExecutor(registry);
  }

  const executor = executorRef.current;

  // Server instance (persisted across renders)
  const serverRef = useRef<NativeUIBridgeServer | null>(null);
  const eventBridgeRef = useRef<WebSocketEventBridge | null>(null);

  // Server management — uses injected serverAdapter if provided
  const startServer = useCallback(async () => {
    if (!features.server) return;

    if (!serverAdapter) {
      console.warn(
        `[ui-bridge-native] HTTP server not available: no serverAdapter prop provided. ` +
          `Pass a serverAdapter to UIBridgeNativeProvider to enable the HTTP server.`
      );
      return;
    }

    const server = createNativeServer(registry, executor, {
      serverPort: config.serverPort || 8087,
      cors: true,
    });

    server.setAdapter(serverAdapter);

    // Wire navigation provider if supplied
    if (navigationProvider) {
      server.setNavigationProvider(navigationProvider);
    }

    // Wire up WebSocket event bridge if adapter supports it
    const wsAdapter = serverAdapter as WebSocketServerAdapter;
    if (typeof wsAdapter.broadcast === 'function') {
      const eventBridge = new WebSocketEventBridge(registry);
      server.setEventBridge(eventBridge);

      wsAdapter.onWebSocketConnect = (connId: string) => {
        // Create a lightweight connection proxy for the event bridge
        // The actual WebSocketConnection lives in the adapter
        eventBridge.addConnection({
          id: connId,
          subscriptions: new Set(),
          alive: true,
          isOpen: true,
          send: (msg: string) => wsAdapter.sendToConnection?.(connId, msg),
          sendEvent: (event: { event: string }) => {
            // Check subscriptions before sending
            const conn = eventBridge['connections'].get(connId);
            if (!conn) return;
            if (!conn.subscriptions.has(event.event) && !conn.subscriptions.has('*')) return;
            wsAdapter.sendToConnection?.(connId, JSON.stringify(event));
          },
          ping: () => { /* adapter handles heartbeat */ },
          close: () => { /* adapter handles close */ },
          destroy: () => { /* adapter handles destroy */ },
        } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      };

      wsAdapter.onWebSocketDisconnect = (connId: string) => {
        eventBridge.removeConnection(connId);
      };

      wsAdapter.onWebSocketMessage = async (connId: string, message: string) => {
        return server.handleWebSocketMessage(connId, message);
      };

      eventBridge.start();
      eventBridgeRef.current = eventBridge;
    }

    try {
      await server.start();
      serverRef.current = server;
      setServerRunning(true);
    } catch (err) {
      console.warn('[ui-bridge-native] Failed to start HTTP server:', err);
    }
  }, [features.server, config.serverPort, registry, executor, serverAdapter]);

  const stopServer = useCallback(() => {
    if (eventBridgeRef.current) {
      eventBridgeRef.current.stop();
      eventBridgeRef.current = null;
    }
    if (serverRef.current) {
      serverRef.current.stop().catch(() => {});
      serverRef.current = null;
    }
    setServerRunning(false);
  }, []);

  // Auto-start server if enabled
  useEffect(() => {
    if (features.server) {
      startServer();
      return () => stopServer();
    }
  }, [features.server, startServer, stopServer]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopServer();
      resetGlobalRegistry();
    };
  }, [stopServer]);

  // Context methods
  const getElements = useCallback(() => registry.getAllElements(), [registry]);

  const getComponents = useCallback(() => registry.getAllComponents(), [registry]);

  const createSnapshot = useCallback(() => registry.createSnapshot(), [registry]);

  const on = useCallback(
    <T = unknown,>(type: BridgeEventType, listener: BridgeEventListener<T>) =>
      registry.on(type, listener),
    [registry]
  );

  const off = useCallback(
    <T = unknown,>(type: BridgeEventType, listener: BridgeEventListener<T>) =>
      registry.off(type, listener),
    [registry]
  );

  const contextValue = useMemo<UIBridgeNativeContextValue>(
    () => ({
      features,
      config,
      registry,
      executor,
      getElements,
      getComponents,
      createSnapshot,
      on,
      off,
      initialized: true,
      serverRunning,
      startServer,
      stopServer,
    }),
    [
      features,
      config,
      registry,
      executor,
      getElements,
      getComponents,
      createSnapshot,
      on,
      off,
      serverRunning,
      startServer,
      stopServer,
    ]
  );

  return (
    <UIBridgeNativeContext.Provider value={contextValue}>{children}</UIBridgeNativeContext.Provider>
  );
}

/**
 * useUIBridgeNative hook
 *
 * Access the UI Bridge Native context. Throws if used outside provider.
 */
export function useUIBridgeNative(): UIBridgeNativeContextValue {
  const context = useContext(UIBridgeNativeContext);
  if (!context) {
    throw new Error('useUIBridgeNative must be used within a UIBridgeNativeProvider');
  }
  return context;
}

/**
 * useUIBridgeNativeOptional hook
 *
 * Access the UI Bridge Native context, returning null if outside provider.
 */
export function useUIBridgeNativeOptional(): UIBridgeNativeContextValue | null {
  return useContext(UIBridgeNativeContext);
}

/**
 * useUIBridgeNativeRequired hook
 *
 * Alias for useUIBridgeNative (throws if outside provider).
 */
export const useUIBridgeNativeRequired = useUIBridgeNative;
