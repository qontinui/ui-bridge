/**
 * UIBridgeProvider internal initialization helpers.
 *
 * Extracted from UIBridgeProvider so the component itself stays focused on
 * React plumbing (context, effects, memoization). Nothing here depends on
 * React hooks — pure setup routines that the provider calls on first render.
 */

import type { UIBridgeFeatures, UIBridgeConfig, BridgeEventListener } from '../core/types';
import { UIBridgeRegistry, setGlobalRegistry } from '../core/registry';
import { UIBridgeWSClient, createWSClient } from '../core/websocket-client';
import { getGlobalSpecStore } from '../specs/store';
import { createRenderLogManager, RenderLogManager } from '../render-log/snapshot';
import { createMetricsCollector, MetricsCollector } from '../debug/metrics';
import { ElementEventLog } from '../debug/element-event-log';
import { BrowserEventCapture } from '../debug/browser-capture';
import type { BrowserCaptureConfig } from '../debug/browser-capture-types';
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
 * Bundle of every singleton the provider lazily constructs. Each field is
 * populated once in initializeUIBridge and read by the component through
 * useMemo/useRef afterwards.
 */
export interface UIBridgeInternals {
  registry: UIBridgeRegistry;
  renderLog: RenderLogManager | null;
  metrics: MetricsCollector | null;
  browserCapture: BrowserEventCapture;
  navigationTracker: NavigationTracker;
  shortcutTracker: ShortcutTracker;
  modalDetector: ModalDetector;
  toastCapture: ToastCapture;
  relationshipTracker: RelationshipTracker;
  dragDropDetector: DragDropDetector;
  undoTracker: UndoTracker;
  changeObserver: ChangeObserver;
  elementEventLog: ElementEventLog | null;
  wsClient: UIBridgeWSClient | null;
}

export interface InitializeUIBridgeArgs {
  config: UIBridgeConfig;
  features: UIBridgeFeatures;
  onEvent?: BridgeEventListener;
  browserCaptureConfig?: BrowserCaptureConfig;
}

/**
 * Build and wire every tracker the provider owns. Mirrors the original
 * one-shot initialization block in UIBridgeProvider so the refactor is a
 * pure move, not a behavior change.
 */
export function initializeUIBridge({
  config,
  features,
  onEvent,
  browserCaptureConfig,
}: InitializeUIBridgeArgs): UIBridgeInternals {
  const elementEventLog = config.elementLog?.enabled
    ? new ElementEventLog(config.elementLog)
    : null;

  const registry = new UIBridgeRegistry({
    verbose: config.verbose,
    onEvent,
    elementEventLog: elementEventLog ?? undefined,
  });
  setGlobalRegistry(registry);

  const renderLog = features.renderLog
    ? createRenderLogManager({
        maxEntries: config.maxLogEntries,
        captureChanges: config.captureChanges,
      })
    : null;

  const metrics = features.debug ? createMetricsCollector() : null;

  // Always-on capture — lightweight and needed for action responses.
  const browserCapture = new BrowserEventCapture(browserCaptureConfig);
  browserCapture.install();

  const navigationTracker = new NavigationTracker();
  navigationTracker.install((data: NavigationEventData) => {
    registry.dispatchEvent('navigation:change', data);
  });

  const shortcutTracker = new ShortcutTracker();
  shortcutTracker.install();

  // Modal detector is stateless — no install step.
  const modalDetector = new ModalDetector();

  const toastCapture = new ToastCapture();
  toastCapture.install((data: ToastEventData) => {
    registry.dispatchEvent(data.action === 'appeared' ? 'toast:appeared' : 'toast:dismissed', data);
  });

  const relationshipTracker = new RelationshipTracker();
  const dragDropDetector = new DragDropDetector();
  const undoTracker = new UndoTracker();
  const changeObserver = new ChangeObserver({ bufferCapacity: 5000, batchIntervalMs: 16 });

  let wsClient: UIBridgeWSClient | null = null;
  if (config.websocket) {
    const wsPort = config.websocketPort || config.serverPort || 9876;
    wsClient = createWSClient({
      url: `ws://localhost:${wsPort}`,
      autoReconnect: true,
      reconnectDelay: 1000,
      maxReconnectAttempts: 10,
      pingInterval: 30000,
    });
  }

  return {
    registry,
    renderLog,
    metrics,
    browserCapture,
    navigationTracker,
    shortcutTracker,
    modalDetector,
    toastCapture,
    relationshipTracker,
    dragDropDetector,
    undoTracker,
    changeObserver,
    elementEventLog,
    wsClient,
  };
}

/**
 * Publish the initialized trackers on `window.__UI_BRIDGE__` so the Chrome
 * extension, diagnostics endpoint, and external tooling can reach them
 * without importing React state.
 */
export function exposeProviderOnWindow(internals: UIBridgeInternals): void {
  if (typeof window === 'undefined') return;

  const w = window as unknown as Record<string, unknown>;
  const root = (w.__UI_BRIDGE__ ??= {}) as Record<string, unknown>;

  root.specs = { getGlobalSpecStore };
  root.browserCapture = internals.browserCapture;
  // Backward-compat alias (same instance supports getSince / getRecent).
  root.consoleCapture = internals.browserCapture;
  root.navigationTracker = internals.navigationTracker;
  root.shortcutTracker = internals.shortcutTracker;
  root.modalDetector = internals.modalDetector;
  root.toastCapture = internals.toastCapture;
  root.relationshipTracker = internals.relationshipTracker;
  root.dragDropDetector = internals.dragDropDetector;
  root.undoTracker = internals.undoTracker;

  const providers: string[] = ['UIBridgeProvider'];
  if (internals.browserCapture) providers.push('BrowserCapture');
  if (internals.navigationTracker) providers.push('NavigationTracker');
  if (internals.shortcutTracker) providers.push('ShortcutTracker');
  if (internals.modalDetector) providers.push('ModalDetector');
  if (internals.toastCapture) providers.push('ToastCapture');
  if (internals.relationshipTracker) providers.push('RelationshipTracker');
  if (internals.dragDropDetector) providers.push('DragDropDetector');
  if (internals.undoTracker) providers.push('UndoTracker');
  root.providers = providers;
}

/** Clear the diagnostics provider list on unmount. */
export function clearProvidersOnWindow(): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as Record<string, unknown>;
  const root = w.__UI_BRIDGE__ as Record<string, unknown> | undefined;
  if (root) root.providers = [];
}
