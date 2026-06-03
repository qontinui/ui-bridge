/**
 * UI Bridge Native Provider
 *
 * React context provider for UI Bridge Native functionality.
 */

import React, {
  createContext,
  use,
  useMemo,
  useEffect,
  useCallback,
  useRef,
  useState,
} from 'react';
import { Dimensions, PixelRatio } from 'react-native';
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
import {
  createNativeServer,
  type NativeUIBridgeServer,
  type ServerAdapter,
  type WebSocketServerAdapter,
} from '../server/http-server';
import type { RouteProvider, KeepAwakeProvider } from '../server/types';
import { WebSocketEventBridge } from '../server/ws-event-bridge';
import { DeviceAnnouncer } from '../transport/DeviceAnnouncer';
import { CloudRelayClient, type CloudRelayConfig } from '../transport/CloudRelayClient';
import { ModalDetector } from '../modal/modal-detector';
import { ToastCapture } from '../toast/toast-capture';
import { UndoTracker } from '../undo/undo-tracker';

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
  /** Modal stack tracker (declarative pushModal/dismissModal) */
  modalDetector: ModalDetector;
  /** Toast/snackbar tracker (declarative recordToast/dismissToast) */
  toastCapture: ToastCapture;
  /** Undo/redo action-correlation tracker */
  undoTracker: UndoTracker;
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
  /** Get the current navigation route (if a RouteProvider is configured) */
  getCurrentRoute: () => string | null;
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
  /**
   * Screenshot provider for native screen capture via UI Bridge.
   * Pass a function that captures the current screen as base64 PNG.
   */
  screenshotProvider?: {
    capture: () => Promise<{ base64: string; width: number; height: number }>;
  };
  /**
   * Keep-awake provider for native screen-wake control via UI Bridge.
   * Pass expo-keep-awake's activateKeepAwakeAsync/deactivateKeepAwake (wrapped
   * to the request/release shape) so an external runner never loses the device
   * to a screen lock. The SDK never imports expo-keep-awake directly.
   */
  keepAwakeProvider?: KeepAwakeProvider;
  /**
   * Route provider for exposing the current navigation route in snapshots.
   * Wire this to Expo Router's `usePathname()` / `useSegments()` via a module-level ref.
   */
  routeProvider?: RouteProvider;
  /**
   * Configuration for the cloud relay tunnel (enables remote device verification
   * when USB/LAN are not available).  Omit `uiBridgeServer` — the provider wires
   * that automatically after the server starts.
   */
  cloudRelayConfig?: Omit<CloudRelayConfig, 'uiBridgeServer'>;
  /**
   * Enable mDNS advertisement so that runners on the same LAN can discover this
   * device automatically (requires react-native-zeroconf).
   */
  enableMdnsAnnounce?: boolean;
  /**
   * Stable device identifier used for mDNS TXT records and cloud relay
   * registration.  Typically sourced from expo-device or a UUID stored in
   * AsyncStorage.
   */
  deviceId?: string;
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
  screenshotProvider,
  keepAwakeProvider,
  routeProvider,
  cloudRelayConfig,
  enableMdnsAnnounce,
  deviceId,
}: UIBridgeNativeProviderProps) {
  const registryRef = useRef<NativeUIBridgeRegistry | null>(null);
  const executorRef = useRef<NativeActionExecutor | null>(null);
  const modalDetectorRef = useRef<ModalDetector | null>(null);
  const toastCaptureRef = useRef<ToastCapture | null>(null);
  const undoTrackerRef = useRef<UndoTracker | null>(null);
  const [serverRunning, setServerRunning] = useState(false);

  // Initialize on first render
  if (!registryRef.current) {
    registryRef.current = new NativeUIBridgeRegistry({
      verbose: config.verbose,
      onEvent,
    });
    // Inject the device pixel ratio so `createSnapshot` can project each
    // element's `state.layout` (logical dp) into a physical-pixel `bbox` the
    // runner's vision pipeline accepts. Done here (a React file that already
    // imports react-native) rather than inside the core registry, which must
    // stay free of react-native imports — see the `projectBbox` doc comment.
    registryRef.current.setPixelRatio(PixelRatio.get());
    setGlobalRegistry(registryRef.current);
  }

  const registry = registryRef.current;

  // Create executor (memoized)
  if (!executorRef.current) {
    executorRef.current = createNativeActionExecutor(registry);
  }

  const executor = executorRef.current;

  // Trackers — lazy-init the same way as registry/executor so each provider
  // lifecycle has exactly one stable instance.
  if (!modalDetectorRef.current) modalDetectorRef.current = new ModalDetector();
  if (!toastCaptureRef.current) toastCaptureRef.current = new ToastCapture();
  if (!undoTrackerRef.current) undoTrackerRef.current = new UndoTracker();

  const modalDetector = modalDetectorRef.current;
  const toastCapture = toastCaptureRef.current;
  const undoTracker = undoTrackerRef.current;

  // Server instance (persisted across renders)
  const serverRef = useRef<NativeUIBridgeServer | null>(null);
  const eventBridgeRef = useRef<WebSocketEventBridge | null>(null);

  // Cloud / mDNS transport references
  const announcerRef = useRef<DeviceAnnouncer | null>(null);
  const cloudRelayRef = useRef<CloudRelayClient | null>(null);

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
      appInfo: config.appInfo,
      testHooks: features.testHooks === true,
      // Injected device-viewport getter for POST /control/page-health. The
      // server doesn't import `react-native` itself — the require/import
      // pattern there crashed the host RN app in 0.6.3/0.6.4 (Metro/Hermes
      // raised `unknownModuleError` past every try/catch). This provider
      // already has a live react-native import, so it's the safe injection
      // point. See feedback_metro_require_gotcha for the full incident.
      viewportProvider: () => {
        const win = Dimensions.get('window');
        return { width: win.width, height: win.height };
      },
    });

    server.setAdapter(serverAdapter);

    // Wire navigation provider if supplied
    if (navigationProvider) {
      server.setNavigationProvider(navigationProvider);
    }

    // Wire screenshot provider if supplied
    if (screenshotProvider) {
      server.setScreenshotProvider(screenshotProvider);
    }

    // Wire keep-awake provider if supplied
    if (keepAwakeProvider) {
      server.setKeepAwakeProvider(keepAwakeProvider);
    }

    // Wire route provider if supplied (must be set AFTER navigationProvider
    // since both may override getSnapshot / pageNavigate handlers)
    if (routeProvider) {
      server.setRouteProvider(routeProvider);
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
            if (!eventBridge.isSubscribed(connId, event.event)) return;
            wsAdapter.sendToConnection?.(connId, JSON.stringify(event));
          },
          ping: () => {
            /* adapter handles heartbeat */
          },
          close: () => {
            /* adapter handles close */
          },
          destroy: () => {
            /* adapter handles destroy */
          },
        } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      };

      wsAdapter.onWebSocketDisconnect = (connId: string) => {
        // Abort any pending waiters (waitForElement / waitForCondition)
        // for this connection BEFORE removing it — stops leaked timers
        // and registry listeners.
        server.abortWaitersForConnection(connId);
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
  }, [
    features.server,
    features.testHooks,
    config.serverPort,
    config.appInfo,
    registry,
    executor,
    serverAdapter,
    navigationProvider,
    screenshotProvider,
    keepAwakeProvider,
    routeProvider,
  ]);

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

  // Start mDNS announcement and cloud relay.
  //
  // The cloud relay path does NOT require the HTTP server to be running —
  // it calls `server.handleRequest()` directly, bypassing HTTP. This matters
  // for preview/production builds where `features.server` is typically
  // false (no native TCP server adapter available). We still need a
  // NativeUIBridgeServer instance to handle tunneled requests, so we create
  // a bare instance here if startServer() didn't already make one.
  //
  // mDNS also doesn't need the HTTP server — it just advertises on the
  // network so remote devices can discover this phone's address.
  useEffect(() => {
    // Everything here is best-effort — any exception must not crash the app.
    try {
      const needsBareServer = !serverRef.current && !!cloudRelayConfig;
      if (needsBareServer) {
        try {
          // Create a server instance for handleRequest() use only; no adapter,
          // no HTTP listener. This is safe without features.server.
          const bareServer = createNativeServer(registry, executor, {
            serverPort: config.serverPort || 8087,
            cors: true,
            appInfo: config.appInfo,
            testHooks: features.testHooks === true,
            viewportProvider: () => {
              const win = Dimensions.get('window');
              return { width: win.width, height: win.height };
            },
          });
          if (navigationProvider) bareServer.setNavigationProvider(navigationProvider);
          if (screenshotProvider) bareServer.setScreenshotProvider(screenshotProvider);
          if (keepAwakeProvider) bareServer.setKeepAwakeProvider(keepAwakeProvider);
          if (routeProvider) bareServer.setRouteProvider(routeProvider);
          serverRef.current = bareServer;
        } catch (err) {
          console.warn('[ui-bridge-native] Failed to create bare server:', err);
        }
      }

      // mDNS advertisement
      if (enableMdnsAnnounce && deviceId) {
        try {
          const announcer = new DeviceAnnouncer({
            deviceId,
            appId: config.appInfo?.appId ?? 'unknown',
            port: config.serverPort ?? 8087,
            cloudRelayUrl: cloudRelayConfig?.relayUrl,
            cloudToken: cloudRelayConfig?.authToken,
          });
          announcerRef.current = announcer;
          void announcer.startMdnsAdvertise().catch((err) => {
            console.warn('[ui-bridge-native] mDNS advertise failed:', err);
          });
        } catch (err) {
          console.warn('[ui-bridge-native] Failed to start DeviceAnnouncer:', err);
        }
      }

      // Cloud relay tunnel (works without HTTP server)
      if (cloudRelayConfig && serverRef.current) {
        try {
          const relayClient = new CloudRelayClient({
            ...cloudRelayConfig,
            uiBridgeServer: serverRef.current,
          });
          cloudRelayRef.current = relayClient;
          relayClient.start();
        } catch (err) {
          console.warn('[ui-bridge-native] Failed to start CloudRelayClient:', err);
        }
      }
    } catch (err) {
      console.warn('[ui-bridge-native] Transport effect failed:', err);
    }

    return () => {
      try {
        if (announcerRef.current) {
          void announcerRef.current.stop().catch(() => {});
          announcerRef.current = null;
        }
        if (cloudRelayRef.current) {
          cloudRelayRef.current.stop();
          cloudRelayRef.current = null;
        }
      } catch {
        // cleanup must never throw
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    serverRunning,
    cloudRelayConfig?.relayUrl,
    cloudRelayConfig?.authToken,
    enableMdnsAnnounce,
    deviceId,
  ]);

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

  const getCurrentRoute = useCallback(() => {
    return routeProvider?.getCurrentRoute() ?? null;
  }, [routeProvider]);

  // Mark the previous route's elements offscreen when the active route changes.
  // Without this, React Navigation's persistent-mount behavior leaves stale
  // layouts in the registry for tabs the user has left. Elements on the new
  // route re-fire `onLayout` and repopulate their layout.
  useEffect(() => {
    if (!routeProvider) return;

    let lastRoute: string | null = routeProvider.getCurrentRoute();

    return routeProvider.subscribe((current: string | null) => {
      if (current !== lastRoute && lastRoute != null) {
        registry.markRouteOffscreen(lastRoute);
      }
      lastRoute = current;
    });
  }, [routeProvider, registry]);

  // Wire trackers into the registry's snapshot enricher slots. Trackers are
  // stable refs, so this effect runs exactly once per provider lifecycle.
  useEffect(() => {
    registry.setEnrichers({ modalDetector, toastCapture, undoTracker });
  }, [registry, modalDetector, toastCapture, undoTracker]);

  // Mirror successful bridge actions into UndoTracker's rolling history so
  // snapshots can surface action-correlation undo context without each
  // action site needing to call recordAction manually.
  useEffect(() => {
    const unsubscribe = executor.onActionExecuted((event) => {
      if (!event.success) return;
      undoTracker.recordAction({
        id: event.requestId ?? `action-${event.timestamp}`,
        type: event.action,
        targetId: event.elementId,
        timestamp: event.timestamp,
        reversible: true,
      });
    });
    return unsubscribe;
  }, [executor, undoTracker]);

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
      modalDetector,
      toastCapture,
      undoTracker,
      getElements,
      getComponents,
      createSnapshot,
      on,
      off,
      initialized: true,
      serverRunning,
      startServer,
      stopServer,
      getCurrentRoute,
    }),
    [
      features,
      config,
      registry,
      executor,
      modalDetector,
      toastCapture,
      undoTracker,
      getElements,
      getComponents,
      createSnapshot,
      on,
      off,
      serverRunning,
      startServer,
      stopServer,
      getCurrentRoute,
    ]
  );

  return <UIBridgeNativeContext value={contextValue}>{children}</UIBridgeNativeContext>;
}

/**
 * useUIBridgeNative hook
 *
 * Access the UI Bridge Native context. Throws if used outside provider.
 */
export function useUIBridgeNative(): UIBridgeNativeContextValue {
  const context = use(UIBridgeNativeContext);
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
  return use(UIBridgeNativeContext);
}

/**
 * useUIBridgeNativeRequired hook
 *
 * Alias for useUIBridgeNative (throws if outside provider).
 */
export const useUIBridgeNativeRequired = useUIBridgeNative;
