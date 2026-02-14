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

  // Server management (placeholder - actual implementation depends on RN HTTP server library)
  const startServer = useCallback(async () => {
    if (!features.server) {
      console.warn('[ui-bridge-native] Server feature not enabled');
      return;
    }

    // TODO: Implement actual HTTP server using react-native-http-bridge or similar
    // For now, just log that we would start the server
    console.log(`[ui-bridge-native] Would start HTTP server on port ${config.serverPort || 8087}`);
    setServerRunning(true);
  }, [features.server, config.serverPort]);

  const stopServer = useCallback(() => {
    // TODO: Implement actual server stop
    console.log('[ui-bridge-native] Would stop HTTP server');
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
