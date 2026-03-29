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
import { ElementEventLog } from '../debug/element-event-log';
import { BrowserEventCapture } from '../debug/browser-capture';
import type { OnBrowserEventCallback, BrowserCaptureConfig } from '../debug/browser-capture-types';
import type { ActionExecutor, WorkflowEngine } from '../control/types';
import { NavigationTracker } from '../navigation';
import type { NavigationEventData } from '../navigation';
import { ShortcutTracker } from '../shortcuts';
import { ModalDetector } from '../modal';
import { ToastCapture } from '../toast';
import type { ToastEventData } from '../toast';
import { RelationshipTracker } from '../relationships';
import { DragDropDetector } from '../drag-drop';
import { UndoTracker } from '../undo';
import { ChangeObserver } from '../core/change-observer';

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
  const navigationTrackerRef = useRef<NavigationTracker | null>(null);
  const shortcutTrackerRef = useRef<ShortcutTracker | null>(null);
  const modalDetectorRef = useRef<ModalDetector | null>(null);
  const toastCaptureRef = useRef<ToastCapture | null>(null);
  const relationshipTrackerRef = useRef<RelationshipTracker | null>(null);
  const dragDropDetectorRef = useRef<DragDropDetector | null>(null);
  const undoTrackerRef = useRef<UndoTracker | null>(null);
  const changeObserverRef = useRef<ChangeObserver | null>(null);
  const elementEventLogRef = useRef<ElementEventLog | null>(null);
  const wsClientRef = useRef<UIBridgeWSClient | null>(null);
  const [wsConnectionState, setWsConnectionState] = useState<WSConnectionState>('disconnected');
  const prevWsStateRef = useRef<WSConnectionState>('disconnected');

  // Initialize on first render
  if (!registryRef.current) {
    if (config.elementLog?.enabled) {
      elementEventLogRef.current = new ElementEventLog(config.elementLog);
    }

    registryRef.current = new UIBridgeRegistry({
      verbose: config.verbose,
      onEvent,
      elementEventLog: elementEventLogRef.current ?? undefined,
    });
    setGlobalRegistry(registryRef.current);

    if (features.renderLog) {
      renderLogRef.current = createRenderLogManager({
        maxEntries: config.maxLogEntries,
        captureChanges: config.captureChanges,
      });
    }

    if (features.debug) {
      metricsRef.current = createMetricsCollector();
    }

    // Install browser event capture (always on — lightweight and needed for action responses)
    browserCaptureRef.current = new BrowserEventCapture(browserCaptureConfig);
    browserCaptureRef.current.install();

    // Install navigation tracker for page/route awareness
    navigationTrackerRef.current = new NavigationTracker();
    navigationTrackerRef.current.install((data: NavigationEventData) => {
      registryRef.current?.dispatchEvent('navigation:change', data);
    });

    // Install shortcut tracker for keyboard shortcut discovery
    shortcutTrackerRef.current = new ShortcutTracker();
    shortcutTrackerRef.current.install();

    // Install modal detector (stateless — no install needed)
    modalDetectorRef.current = new ModalDetector();

    // Install toast capture for notification detection
    toastCaptureRef.current = new ToastCapture();
    toastCaptureRef.current.install((data: ToastEventData) => {
      registryRef.current?.dispatchEvent(
        data.action === 'appeared' ? 'toast:appeared' : 'toast:dismissed',
        data
      );
    });

    // Install relationship tracker for element relationship management
    relationshipTrackerRef.current = new RelationshipTracker();

    // Install drag-drop detector for drag source and drop zone discovery
    dragDropDetectorRef.current = new DragDropDetector();

    // Install undo/redo tracker (stateless detector + action correlation)
    undoTrackerRef.current = new UndoTracker();

    // Initialize push-based change observer (allio-inspired)
    changeObserverRef.current = new ChangeObserver({ bufferCapacity: 5000, batchIntervalMs: 16 });

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
      (w.__UI_BRIDGE__ as Record<string, unknown>).navigationTracker = navigationTrackerRef.current;
      (w.__UI_BRIDGE__ as Record<string, unknown>).shortcutTracker = shortcutTrackerRef.current;
      (w.__UI_BRIDGE__ as Record<string, unknown>).modalDetector = modalDetectorRef.current;
      (w.__UI_BRIDGE__ as Record<string, unknown>).toastCapture = toastCaptureRef.current;
      (w.__UI_BRIDGE__ as Record<string, unknown>).relationshipTracker =
        relationshipTrackerRef.current;
      (w.__UI_BRIDGE__ as Record<string, unknown>).dragDropDetector = dragDropDetectorRef.current;
      (w.__UI_BRIDGE__ as Record<string, unknown>).undoTracker = undoTrackerRef.current;
    }
  }

  const registry = registryRef.current;
  const renderLog = renderLogRef.current || undefined;
  const metrics = metricsRef.current || undefined;
  const navigationTracker = navigationTrackerRef.current!;
  const shortcutTracker = shortcutTrackerRef.current!;
  const modalDetector = modalDetectorRef.current!;
  const toastCapture = toastCaptureRef.current!;
  const relationshipTracker = relationshipTrackerRef.current!;
  const dragDropDetector = dragDropDetectorRef.current!;
  const undoTracker = undoTrackerRef.current!;
  const elementEventLog = elementEventLogRef.current || undefined;
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

  // Wire ChangeObserver: registry events → batched changes → WS push to server
  useEffect(() => {
    const observer = changeObserverRef.current;
    if (!observer) return;

    // Feed registry element events into the observer
    const unsubs = [
      registry.on('element:registered', (event: BridgeEvent) => {
        const id = (event.data as { id?: string })?.id;
        if (id) observer.onElementAdded(id);
      }),
      registry.on('element:unregistered', (event: BridgeEvent) => {
        const id = (event.data as { id?: string })?.id;
        if (id) observer.onElementRemoved(id);
      }),
      registry.on('element:stateChanged', (event: BridgeEvent) => {
        const id =
          (event.data as { id?: string; elementId?: string })?.id ??
          (event.data as { elementId?: string })?.elementId;
        if (id) observer.onElementModified(id);
      }),
    ];

    // Push batched changes to the server via WebSocket (fire-and-forget)
    let changeSub: (() => void) | undefined;
    if (wsClient) {
      changeSub = observer.subscribe((domChange) => {
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
  }, [registry, wsClient]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      renderLog?.stop();
      browserCaptureRef.current?.setOnEvent(null);
      browserCaptureRef.current?.uninstall();
      navigationTrackerRef.current?.uninstall();
      shortcutTrackerRef.current?.uninstall();
      toastCaptureRef.current?.uninstall();
      changeObserverRef.current?.destroy();
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

  return <UIBridgeContext value={contextValue}>{children}</UIBridgeContext>;
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
