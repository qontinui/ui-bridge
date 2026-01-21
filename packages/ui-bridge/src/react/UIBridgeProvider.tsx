/**
 * UI Bridge Provider
 *
 * React context provider for UI Bridge functionality.
 */

import React, { createContext, useContext, useMemo, useEffect, useCallback, useRef } from 'react';
import type {
  UIBridgeFeatures,
  UIBridgeConfig,
  RegisteredElement,
  RegisteredComponent,
  BridgeSnapshot,
  BridgeEventType,
  BridgeEventListener,
} from '../core/types';
import { UIBridgeRegistry, setGlobalRegistry, resetGlobalRegistry } from '../core/registry';
import { createActionExecutor } from '../control/action-executor';
import { createWorkflowEngine } from '../control/workflow-engine';
import { createRenderLogManager, RenderLogManager } from '../render-log/snapshot';
import { createMetricsCollector, MetricsCollector } from '../debug/metrics';
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
  /** Get all registered elements */
  getElements: () => RegisteredElement[];
  /** Get all registered components */
  getComponents: () => RegisteredComponent[];
  /** Create a snapshot */
  createSnapshot: () => BridgeSnapshot;
  /** Subscribe to events */
  on: <T = unknown>(type: BridgeEventType, listener: BridgeEventListener<T>) => () => void;
  /** Unsubscribe from events */
  off: <T = unknown>(type: BridgeEventType, listener: BridgeEventListener<T>) => void;
  /** Whether the provider is initialized */
  initialized: boolean;
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
}: UIBridgeProviderProps) {
  const registryRef = useRef<UIBridgeRegistry | null>(null);
  const renderLogRef = useRef<RenderLogManager | null>(null);
  const metricsRef = useRef<MetricsCollector | null>(null);

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
  }

  const registry = registryRef.current;
  const renderLog = renderLogRef.current || undefined;
  const metrics = metricsRef.current || undefined;

  // Create executor and workflow engine
  const executor = useMemo(() => createActionExecutor(registry), [registry]);
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      renderLog?.stop();
      resetGlobalRegistry();
    };
  }, [renderLog]);

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

  const contextValue = useMemo<UIBridgeContextValue>(
    () => ({
      features,
      config,
      registry,
      executor,
      workflowEngine,
      renderLog,
      metrics,
      getElements,
      getComponents,
      createSnapshot,
      on,
      off,
      initialized: true,
    }),
    [
      features,
      config,
      registry,
      executor,
      workflowEngine,
      renderLog,
      metrics,
      getElements,
      getComponents,
      createSnapshot,
      on,
      off,
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
