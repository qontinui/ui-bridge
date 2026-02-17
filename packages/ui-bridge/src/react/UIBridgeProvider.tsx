/**
 * UI Bridge Provider
 *
 * React context provider for UI Bridge functionality.
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
  UIBridgeFeatures,
  UIBridgeConfig,
  RegisteredElement,
  RegisteredComponent,
  BridgeSnapshot,
  BridgeEventType,
  BridgeEventListener,
  BridgeEvent,
  WSConnectionState,
  WSSubscriptionOptions,
} from '../core/types';
import { UIBridgeRegistry, setGlobalRegistry, resetGlobalRegistry } from '../core/registry';
import { UIBridgeWSClient, createWSClient } from '../core/websocket-client';
import { createActionExecutor } from '../control/action-executor';
import { getGlobalSpecStore } from '../specs/store';
import { createWorkflowEngine } from '../control/workflow-engine';
import { createRenderLogManager, RenderLogManager } from '../render-log/snapshot';
import { createMetricsCollector, MetricsCollector } from '../debug/metrics';
import { BrowserEventCapture } from '../debug/browser-capture';
import type { OnBrowserEventCallback, BrowserCaptureConfig } from '../debug/browser-capture-types';
import type { ActionExecutor, WorkflowEngine } from '../control/types';

/**
 * UI Bridge context value
 */
export interface UIBridgeContextValue {
  /** Feature flags */
  features: UIBridgeFeatures;
  /** Configuration */
  config: UIBridgeConfig;
  /** Element registry */
  registry: UIBridgeRegistry;
  /** Action executor */
  executor: ActionExecutor;
  /** Workflow engine */
  workflowEngine: WorkflowEngine;
  /** Render log manager (if enabled) */
  renderLog?: RenderLogManager;
  /** Metrics collector (if debug enabled) */
  metrics?: MetricsCollector;
  /** WebSocket client (if websocket enabled) */
  wsClient?: UIBridgeWSClient;
  /** WebSocket connection state */
  wsConnectionState: WSConnectionState;
  /** Get all registered elements */
  getElements: () => RegisteredElement[];
  /** Get all registered components */
  getComponents: () => RegisteredComponent[];
  /** Create a snapshot */
  createSnapshot: () => BridgeSnapshot;
  /** Create a snapshot asynchronously (non-blocking) */
  createSnapshotAsync: (batchSize?: number) => Promise<BridgeSnapshot>;
  /** Subscribe to events */
  on: <T = unknown>(type: BridgeEventType, listener: BridgeEventListener<T>) => () => void;
  /** Unsubscribe from events */
  off: <T = unknown>(type: BridgeEventType, listener: BridgeEventListener<T>) => void;
  /** Whether the provider is initialized */
  initialized: boolean;
  /** Connect to WebSocket server */
  wsConnect: () => Promise<void>;
  /** Disconnect from WebSocket server */
  wsDisconnect: () => void;
  /** Subscribe to WebSocket events */
  wsSubscribe: (options: WSSubscriptionOptions) => Promise<BridgeEventType[]>;
  /** Add WebSocket event listener */
  onWsEvent: (
    eventType: BridgeEventType | '*',
    listener: (event: BridgeEvent) => void
  ) => () => void;
}

/**
 * UI Bridge context
 */
const UIBridgeContext = createContext<UIBridgeContextValue | null>(null);

/**
 * UI Bridge provider props
 */
export interface UIBridgeProviderProps {
  /** Child components */
  children: React.ReactNode;
  /** Feature flags */
  features?: UIBridgeFeatures;
  /** Configuration */
  config?: UIBridgeConfig;
  /** Event handler */
  onEvent?: BridgeEventListener;
  /** Callback fired for each captured browser event */
  onBrowserEvent?: OnBrowserEventCallback;
  /** Configuration for browser event capture sub-modules */
  browserCaptureConfig?: BrowserCaptureConfig;
}

/**
 * UI Bridge Provider
 *
 * Provides UI Bridge context to child components.
 */
export function UIBridgeProvider({
  children,
  features = {},
  config = {},
  onEvent,
  onBrowserEvent,
  browserCaptureConfig,
}: UIBridgeProviderProps) {
  const registryRef = useRef<UIBridgeRegistry | null>(null);
  const renderLogRef = useRef<RenderLogManager | null>(null);
  const metricsRef = useRef<MetricsCollector | null>(null);
  const browserCaptureRef = useRef<BrowserEventCapture | null>(null);
  const wsClientRef = useRef<UIBridgeWSClient | null>(null);
  const [wsConnectionState, setWsConnectionState] = useState<WSConnectionState>('disconnected');
  const prevWsStateRef = useRef<WSConnectionState>('disconnected');

  // Initialize on first render
  if (!registryRef.current) {
    registryRef.current = new UIBridgeRegistry({
      verbose: config.verbose,
      onEvent,
    });
    setGlobalRegistry(registryRef.current);

    if (features.renderLog) {
      renderLogRef.current = createRenderLogManager({
        maxEntries: config.maxLogEntries,
      });
    }

    if (features.debug) {
      metricsRef.current = createMetricsCollector();
    }

    // Install browser event capture (always on — lightweight and needed for action responses)
    browserCaptureRef.current = new BrowserEventCapture(browserCaptureConfig);
    browserCaptureRef.current.install();

    // Initialize WebSocket client if enabled
    if (config.websocket) {
      const wsPort = config.websocketPort || config.serverPort || 9876;
      const wsUrl = `ws://localhost:${wsPort}`;
      wsClientRef.current = createWSClient({
        url: wsUrl,
        autoReconnect: true,
        reconnectDelay: 1000,
        maxReconnectAttempts: 10,
        pingInterval: 30000,
      });
    }

    // Expose on window.__UI_BRIDGE__ for Chrome extension and external access
    if (typeof window !== 'undefined') {
      const w = window as unknown as Record<string, unknown>;
      if (!w.__UI_BRIDGE__) {
        w.__UI_BRIDGE__ = {};
      }
      (w.__UI_BRIDGE__ as Record<string, unknown>).specs = {
        getGlobalSpecStore,
      };
      (w.__UI_BRIDGE__ as Record<string, unknown>).browserCapture = browserCaptureRef.current;
      // Backward-compat: also expose as consoleCapture (same instance supports getSince/getRecent)
      (w.__UI_BRIDGE__ as Record<string, unknown>).consoleCapture = browserCaptureRef.current;
    }
  }

  const registry = registryRef.current;
  const renderLog = renderLogRef.current || undefined;
  const metrics = metricsRef.current || undefined;
  const wsClient = wsClientRef.current || undefined;

  // Create executor and workflow engine
  const browserCapture = browserCaptureRef.current || undefined;
  const executor = useMemo(
    () => createActionExecutor(registry, browserCapture),
    [registry, browserCapture]
  );
  const workflowEngine = useMemo(
    () => createWorkflowEngine(registry, executor),
    [registry, executor]
  );

  // Start render log on mount
  useEffect(() => {
    if (features.renderLog && renderLog) {
      renderLog.start();
      return () => renderLog.stop();
    }
  }, [features.renderLog, renderLog]);

  // Wire up metrics to events
  useEffect(() => {
    if (!metrics) return;

    const unsubCompleted = registry.on('action:completed', (event) => {
      metrics.recordEvent(event);
    });
    const unsubFailed = registry.on('action:failed', (event) => {
      metrics.recordEvent(event);
    });

    return () => {
      unsubCompleted();
      unsubFailed();
    };
  }, [registry, metrics]);

  // Setup WebSocket connection state listener + forward WS state changes to browser capture
  useEffect(() => {
    if (!wsClient) return;

    const unsubscribe = wsClient.onConnectionChange((state) => {
      const prev = prevWsStateRef.current;
      prevWsStateRef.current = state;
      setWsConnectionState(state);
      browserCaptureRef.current?.reportWsStateChange(prev, state);
    });

    return unsubscribe;
  }, [wsClient]);

  // Wire up onBrowserEvent callback
  useEffect(() => {
    browserCaptureRef.current?.setOnEvent(onBrowserEvent ?? null);
  }, [onBrowserEvent]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      renderLog?.stop();
      browserCaptureRef.current?.setOnEvent(null);
      browserCaptureRef.current?.uninstall();
      wsClient?.disconnect();
      resetGlobalRegistry();
    };
  }, [renderLog, wsClient]);

  // WebSocket methods
  const wsConnect = useCallback(async () => {
    if (wsClient) {
      await wsClient.connect();
    }
  }, [wsClient]);

  const wsDisconnect = useCallback(() => {
    wsClient?.disconnect();
  }, [wsClient]);

  const wsSubscribe = useCallback(
    async (options: WSSubscriptionOptions) => {
      if (!wsClient) {
        return [];
      }
      return wsClient.subscribe(options);
    },
    [wsClient]
  );

  const onWsEvent = useCallback(
    (eventType: BridgeEventType | '*', listener: (event: BridgeEvent) => void) => {
      if (!wsClient) {
        return () => {};
      }
      return wsClient.onEvent(eventType, listener);
    },
    [wsClient]
  );

  // Context methods
  const getElements = useCallback(() => registry.getAllElements(), [registry]);

  const getComponents = useCallback(() => registry.getAllComponents(), [registry]);

  const createSnapshot = useCallback(() => registry.createSnapshot(), [registry]);

  const createSnapshotAsync = useCallback(
    (batchSize?: number) => registry.createSnapshotAsync(batchSize),
    [registry]
  );

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

  const contextValue = useMemo<UIBridgeContextValue>(
    () => ({
      features,
      config,
      registry,
      executor,
      workflowEngine,
      renderLog,
      metrics,
      wsClient,
      wsConnectionState,
      getElements,
      getComponents,
      createSnapshot,
      createSnapshotAsync,
      on,
      off,
      initialized: true,
      wsConnect,
      wsDisconnect,
      wsSubscribe,
      onWsEvent,
    }),
    [
      features,
      config,
      registry,
      executor,
      workflowEngine,
      renderLog,
      metrics,
      wsClient,
      wsConnectionState,
      getElements,
      getComponents,
      createSnapshot,
      createSnapshotAsync,
      on,
      off,
      wsConnect,
      wsDisconnect,
      wsSubscribe,
      onWsEvent,
    ]
  );

  return <UIBridgeContext.Provider value={contextValue}>{children}</UIBridgeContext.Provider>;
}

/**
 * useUIBridgeContext hook
 *
 * Access the UI Bridge context. Throws if used outside provider.
 */
export function useUIBridgeContext(): UIBridgeContextValue {
  const context = useContext(UIBridgeContext);
  if (!context) {
    throw new Error('useUIBridgeContext must be used within a UIBridgeProvider');
  }
  return context;
}

/**
 * useUIBridgeOptional hook
 *
 * Access the UI Bridge context, returning null if outside provider.
 */
export function useUIBridgeOptional(): UIBridgeContextValue | null {
  return useContext(UIBridgeContext);
}
