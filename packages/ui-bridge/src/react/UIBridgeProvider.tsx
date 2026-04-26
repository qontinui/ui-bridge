/**
 * UI Bridge Provider
 *
 * React context provider for UI Bridge functionality. Tracker construction
 * and window-scope exposure live in UIBridgeProviderInit; this file focuses
 * on the component, its effects, and the context it publishes.
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
import { UIBridgeRegistry, setGlobalRegistry } from '../core/registry';
import { UIBridgeWSClient } from '../core/websocket-client';
import { createActionExecutor } from '../control/action-executor';
import { createWorkflowEngine } from '../control/workflow-engine';
import type { RenderLogManager } from '../render-log/snapshot';
import type { MetricsCollector } from '../debug/metrics';
import { ElementEventLog } from '../debug/element-event-log';
import type { OnBrowserEventCallback, BrowserCaptureConfig } from '../debug/browser-capture-types';
import type { ActionExecutor, WorkflowEngine } from '../control/types';
import { NavigationTracker } from '../navigation';
import { ShortcutTracker } from '../shortcuts';
import { ModalDetector } from '../modal';
import { ToastCapture } from '../toast';
import { RelationshipTracker } from '../relationships';
import { DragDropDetector } from '../drag-drop';
import { UndoTracker } from '../undo';
import {
  initializeUIBridge,
  exposeProviderOnWindow,
  clearProvidersOnWindow,
  type UIBridgeInternals,
} from './UIBridgeProviderInit';

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
  createSnapshot: (options?: {
    componentBasePath?: string;
    getActiveTab?: () => string | null | undefined;
  }) => BridgeSnapshot;
  /** Create a snapshot asynchronously (non-blocking) */
  createSnapshotAsync: (
    batchSize?: number,
    options?: {
      componentBasePath?: string;
      getActiveTab?: () => string | null | undefined;
    }
  ) => Promise<BridgeSnapshot>;
  /** Subscribe to events */
  on: <T = unknown>(type: BridgeEventType, listener: BridgeEventListener<T>) => () => void;
  /** Unsubscribe from events */
  off: <T = unknown>(type: BridgeEventType, listener: BridgeEventListener<T>) => void;
  /** Navigation tracker for page/route awareness */
  navigationTracker: NavigationTracker;
  /** Shortcut tracker for keyboard shortcut discovery */
  shortcutTracker: ShortcutTracker;
  /** Modal detector for modal/dialog stack detection */
  modalDetector: ModalDetector;
  /** Toast capture for notification detection */
  toastCapture: ToastCapture;
  /** Relationship tracker for element relationship management */
  relationshipTracker: RelationshipTracker;
  /** Drag-drop detector for drag source and drop zone discovery */
  dragDropDetector: DragDropDetector;
  /** Undo/redo tracker for undo awareness */
  undoTracker: UndoTracker;
  /** Element event log for per-element observability (if enabled) */
  elementEventLog?: ElementEventLog;
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
 * Main UI Bridge context (stable — never changes after mount).
 */
const UIBridgeContext = createContext<UIBridgeContextValue | null>(null);

const EMPTY_FEATURES: UIBridgeFeatures = {};
const EMPTY_CONFIG: UIBridgeConfig = {};

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
  features = EMPTY_FEATURES,
  config = EMPTY_CONFIG,
  onEvent,
  onBrowserEvent,
  browserCaptureConfig,
}: UIBridgeProviderProps) {
  // All the singletons — built lazily on first render by initializeUIBridge.
  const internalsRef = useRef<UIBridgeInternals | null>(null);
  if (!internalsRef.current) {
    internalsRef.current = initializeUIBridge({
      config,
      features,
      onEvent,
      browserCaptureConfig,
    });
    exposeProviderOnWindow(internalsRef.current);
  }
  const internals = internalsRef.current;

  const {
    registry,
    browserCapture,
    navigationTracker,
    shortcutTracker,
    modalDetector,
    toastCapture,
    relationshipTracker,
    dragDropDetector,
    undoTracker,
    changeObserver,
  } = internals;
  const renderLog = internals.renderLog ?? undefined;
  const metrics = internals.metrics ?? undefined;
  const elementEventLog = internals.elementEventLog ?? undefined;
  const wsClient = internals.wsClient ?? undefined;

  const [wsConnectionState, setWsConnectionState] = useState<WSConnectionState>('disconnected');
  const prevWsStateRef = useRef<WSConnectionState>('disconnected');

  const executor = useMemo(
    () => createActionExecutor(registry, browserCapture),
    [registry, browserCapture]
  );
  const workflowEngine = useMemo(
    () => createWorkflowEngine(registry, executor),
    [registry, executor]
  );

  // Render log lifecycle.
  useEffect(() => {
    if (features.renderLog && renderLog) {
      renderLog.start();
      return () => renderLog.stop();
    }
  }, [features.renderLog, renderLog]);

  // Metrics wiring.
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

  // WebSocket state fan-out — forward transitions into browser capture too.
  useEffect(() => {
    if (!wsClient) return;
    return wsClient.onConnectionChange((state) => {
      const prev = prevWsStateRef.current;
      prevWsStateRef.current = state;
      setWsConnectionState(state);
      browserCapture.reportWsStateChange(prev, state);
    });
  }, [wsClient, browserCapture]);

  // onBrowserEvent prop is live — re-register the callback when it changes.
  useEffect(() => {
    browserCapture.setOnEvent(onBrowserEvent ?? null);
  }, [onBrowserEvent, browserCapture]);

  // ChangeObserver: registry events → batched changes → WS push to server.
  useEffect(() => {
    const unsubs = [
      registry.on('element:registered', (event: BridgeEvent) => {
        const id = (event.data as { id?: string })?.id;
        if (id) changeObserver.onElementAdded(id);
      }),
      registry.on('element:unregistered', (event: BridgeEvent) => {
        const id = (event.data as { id?: string })?.id;
        if (id) changeObserver.onElementRemoved(id);
      }),
      registry.on('element:stateChanged', (event: BridgeEvent) => {
        const id =
          (event.data as { id?: string; elementId?: string })?.id ??
          (event.data as { elementId?: string })?.elementId;
        if (id) changeObserver.onElementModified(id);
      }),
    ];

    let changeSub: (() => void) | undefined;
    if (wsClient) {
      changeSub = changeObserver.subscribe((domChange) => {
        wsClient.sendEvent({
          id: `change-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          type: 'changeEvent',
          timestamp: domChange.timestamp,
          payload: {
            added: domChange.added,
            removed: domChange.removed,
            modified: domChange.modified,
          },
        });
      });
    }

    return () => {
      unsubs.forEach((u) => u());
      changeSub?.();
    };
  }, [registry, wsClient, changeObserver]);

  // Re-assert this provider's registry as the global on every mount. Without
  // this, a remount (React StrictMode in dev, or any unmount/remount cycle in
  // production) would leave the global pointing at a torn-down instance and
  // downstream consumers — `commandHandlers.ts` reads from
  // `getGlobalRegistry()` for `aiFind` and friends — would silently see an
  // empty registry while `useUIElement` continued registering into the live
  // `bridge.registry` from React context. The runner's `/ui-bridge/ai/find`
  // and `/ui-bridge/control/snapshot` came from two different element sources
  // before this fix because of exactly that divergence.
  useEffect(() => {
    setGlobalRegistry(registry);
  }, [registry]);

  // Unmount cleanup — tear down every tracker the init step installed.
  // Note: we deliberately do NOT call resetGlobalRegistry() here. A nested or
  // sibling provider may still be mounted (or about to remount under React
  // StrictMode), and clearing the global mid-flight strands every consumer
  // that resolves the registry through `getGlobalRegistry()` against a fresh,
  // empty singleton. Tests use `resetGlobalRegistry()` directly when they
  // need a clean slate — production code never should.
  useEffect(() => {
    return () => {
      renderLog?.stop();
      browserCapture.setOnEvent(null);
      browserCapture.uninstall();
      navigationTracker.uninstall();
      shortcutTracker.uninstall();
      toastCapture.uninstall();
      changeObserver.destroy();
      wsClient?.disconnect();
      clearProvidersOnWindow();
    };
  }, [
    renderLog,
    browserCapture,
    navigationTracker,
    shortcutTracker,
    toastCapture,
    changeObserver,
    wsClient,
  ]);

  // ── WebSocket API ─────────────────────────────────────────────────────────
  const wsConnect = useCallback(async () => {
    if (wsClient) await wsClient.connect();
  }, [wsClient]);

  const wsDisconnect = useCallback(() => {
    wsClient?.disconnect();
  }, [wsClient]);

  const wsSubscribe = useCallback(
    async (options: WSSubscriptionOptions) => {
      if (!wsClient) return [];
      return wsClient.subscribe(options);
    },
    [wsClient]
  );

  const onWsEvent = useCallback(
    (eventType: BridgeEventType | '*', listener: (event: BridgeEvent) => void) => {
      if (!wsClient) return () => {};
      return wsClient.onEvent(eventType, listener);
    },
    [wsClient]
  );

  // ── Registry pass-throughs ────────────────────────────────────────────────
  const getElements = useCallback(() => registry.getAllElements(), [registry]);
  const getComponents = useCallback(() => registry.getAllComponents(), [registry]);
  const createSnapshot = useCallback(
    (options?: { componentBasePath?: string; getActiveTab?: () => string | null | undefined }) =>
      registry.createSnapshot(options),
    [registry]
  );
  const createSnapshotAsync = useCallback(
    (
      batchSize?: number,
      options?: {
        componentBasePath?: string;
        getActiveTab?: () => string | null | undefined;
      }
    ) => registry.createSnapshotAsync(batchSize, options),
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
      navigationTracker,
      shortcutTracker,
      modalDetector,
      toastCapture,
      relationshipTracker,
      dragDropDetector,
      undoTracker,
      elementEventLog,
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
      navigationTracker,
      shortcutTracker,
      modalDetector,
      toastCapture,
      relationshipTracker,
      dragDropDetector,
      undoTracker,
      elementEventLog,
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
