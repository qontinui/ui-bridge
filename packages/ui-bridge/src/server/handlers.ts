/**
 * UI Bridge Server Handlers
 *
 * Factory function to create handler implementations for all UI Bridge endpoints.
 */

import type {
  UIBridgeServerHandlers,
  APIResponse,
  RenderLogQuery,
  BrowserEventsResponse,
  CapabilitiesResponse,
  WaitForElementByConditionRequest,
  WaitForElementByConditionResponse,
  WaitForRouteChangeRequest,
  WaitForRouteChangeResponse,
  WaitForElementRequest,
  WaitForElementSuccessResponse,
  ControlBatchRequest,
  ControlBatchResponse,
  ControlBatchStepResult,
} from './types';
import type {
  ControlSnapshot,
  FindRequest,
  FindResponse,
  DiscoveredElement,
  PageNavigateRequest,
  PageNavigationResponse,
  FillFormRequest,
  ActionChanges,
  ElementFieldChange,
  BatchActionRequest,
  BatchActionResponse,
} from '../control';
import {
  scanDOMForInteractiveElements,
  countDOMInteractiveElements,
  findElementsByText,
  findElementBySelector,
  findElementByLabel,
} from './dom-fallback';
import { matchesElementSelector, type MatchableElement } from './selector-match';
import type { NavigationAdapter } from '../navigation/navigation-adapter';
import { WindowLocationAdapter } from '../navigation/navigation-adapter';
import { extractReactState } from '../control/action-executor';
import type { RenderLogEntry } from '../render-log';
import type { ActionFailureDetails, ActionErrorCode, FillResult } from '../core';
import type {
  SearchCriteria,
  SearchResponse,
  NLActionRequest,
  NLActionResponse,
  AssertionRequest,
  AssertionResult,
  AssertionType,
  BatchAssertionRequest,
  BatchAssertionResult,
  SemanticSnapshot,
  SemanticDiff,
  SemanticSearchCriteria,
  SemanticSearchResponse,
  SemanticSearchResult,
  AIDiscoveredElement,
  Intent,
  IntentSearchResponse,
  IntentExecutionResult,
  RecoveryAttemptRequest,
  RecoveryAttemptResult,
  PageDataMap,
  PageRegionMap,
  StructuredDataExtraction,
  CrossAppComparisonReport,
  ComponentInfo,
  ActionWithDiffRequest,
  ActionDiffResult,
  CategorizedDiff,
  ChangeBufferDrainResult,
  SnapshotBookmark,
  ChangePredicate,
  WaitForChangeOptions,
  FormsResponse,
  StructuredChangeAnalysis,
  FormSnapshot,
  FormDiff,
  FindResult,
  FindContext,
} from '../ai';
import { parseNLAssertion as parseNLAssertionShared } from '../ai/nl-assertion-parser';
import { find } from '../ai/find';
import { captureFormSnapshot, diffFormSnapshots } from '../ai/form-diff';
import { discoverForms } from '../ai/form-discovery';
import type { FormDiscoveryElement } from '../ai/form-discovery';
import type {
  UIState,
  UIStateGroup,
  UITransition,
  PathResult,
  TransitionResult,
  NavigationResult,
  StateSnapshot,
  ElementHistoryOptions,
  ElementLogEntry,
} from '../core';
import {
  SearchEngine,
  NLActionExecutor,
  AssertionExecutor,
  SemanticSnapshotManager,
  SemanticDiffManager,
  ChangeTracker,
  generatePageSummary,
  extractPageData,
  segmentPageRegions,
  extractStructuredData,
  generateComparisonReport,
  getElementDesignData,
  captureStateVariations,
  captureResponsiveSnapshots,
  DEFAULT_VIEWPORTS,
  analyzeStructuredChanges,
} from '../ai';
import type {
  InteractionStateName,
  ElementDesignData,
  StateStyles,
  ResponsiveSnapshot,
  ElementState,
  ContentMetadata,
  MediaMetadata as UiBridgeMediaMetadata,
} from '../core/types';
import type { NavigationTracker } from '../navigation';
import type { ShortcutTracker } from '../shortcuts';
import type { ModalDetector } from '../modal';
import type { ToastCapture } from '../toast';
import type { RelationshipTracker } from '../relationships';
import type { DragDropDetector } from '../drag-drop';
import type { UndoTracker } from '../undo';
import type { StyleGuideConfig, StyleAuditReport } from '../specs/style-types';
import { runStyleAudit } from '../specs/style-validator';
import type {
  QualityEvaluationReport,
  SnapshotDiffReport,
  SnapshotBaseline,
  EvaluateRequest,
  QualityContext,
} from '../specs/quality-types';
import { evaluateQuality } from '../specs/quality-evaluator';
import { listContexts } from '../specs/quality-contexts';
import { createBaseline, diffSnapshots } from '../specs/quality-diff';
import { getGlobalSpecStore } from '../specs/store';
import type { ElementAnnotation, AnnotationConfig, AnnotationCoverage } from '../annotations';
import { AnnotationStore, getGlobalAnnotationStore } from '../annotations';
import type {
  CapturedError,
  AnyCapturedEvent,
  BrowserEventType,
} from '../debug/browser-capture-types';
import { deduplicateEvents, extractSourceLocation } from '../debug/error-fingerprint';
import { classifyEvent, filterBySeverity, type ErrorSeverity } from '../debug/error-severity';
import { TimelineBuffer } from '../debug/error-timeline';
import type { TimelineEntry } from '../debug/error-timeline';
import { computeHealthReport } from '../debug/health-score';
import type { HealthReport } from '../debug/health-score';
import { ErrorSessionManager } from '../debug/error-session';
import type { ErrorSessionSummary, BaselineComparison } from '../debug/error-session';
import { NetworkChainTracker } from '../debug/network-chain';
import type { NetworkChain } from '../debug/network-chain';
import { ErrorSnapshotBuffer } from '../debug/error-snapshot';
import type { ErrorSnapshot } from '../debug/error-snapshot';
import { BrowserEventStream } from '../debug/ws-streaming';
import { CompositeIdleDetector } from '../idle';
import type { CompositeIdleConfig } from '../idle';
import { NetworkRequestTracker } from '../network';
import type { NetworkRequestFilter, NetworkTrackerConfig } from '../network';
import { ChangeObserver } from '../core/change-observer';
import type { BridgeEvent } from '../core';
import { findElements } from '../core/find';
import type { ElementQuery } from '../core/find';
import { classString } from '../core/class-name';

/**
 * Parse a natural language assertion into a structured AssertionRequest.
 * Delegates to the shared NL assertion parser and merges result back into the request.
 */
function parseNLAssertion(request: AssertionRequest & { assertion?: string }): AssertionRequest {
  // If already structured with target and type, pass through
  if (request.target && request.type) return request;

  const parsed = parseNLAssertionShared(request);
  return {
    ...request,
    target: parsed.target,
    type: parsed.type as AssertionType,
    expected: parsed.expected,
  };
}

/**
 * Normalize a batch assertion request: parse NL strings and ensure mode is set.
 */
function normalizeBatchAssertions(
  request: BatchAssertionRequest & { assertions?: (AssertionRequest | string)[] }
): BatchAssertionRequest {
  return {
    ...request,
    mode: request.mode || 'all',
    assertions: (request.assertions || []).map((a: AssertionRequest | string) =>
      typeof a === 'string'
        ? parseNLAssertion({ assertion: a } as AssertionRequest & { assertion: string })
        : parseNLAssertion(a as AssertionRequest & { assertion?: string })
    ),
  };
}

/**
 * Map raw registry elements to snapshot-format elements with computed state
 * (rect, visibility, text content, computed styles). Raw RegisteredElement
 * objects from registry.getAllElements() have a getState() method that must
 * be called to populate these fields — without this mapping, rects are null.
 */
function materializeElements(rawElements: unknown[]): ControlSnapshot['elements'] {
  return rawElements.map((raw) => {
    const el = raw as {
      id: string;
      type?: string;
      label?: string;
      actions?: unknown[];
      customActions?: Record<string, unknown>;
      category?: string;
      contentMetadata?: unknown;
      mediaMetadata?: unknown;
      element: HTMLElement;
      getState?: () => unknown;
      getIdentifier?: () => unknown;
      bbox?: { x: number; y: number; width: number; height: number };
      visible?: boolean;
    };
    // Capture title and aria-label from the live DOM element for explicit
    // attribute-level filtering (Tier 1.2). These are separate from `label`
    // which encodes the best accessible name (aria-label > title > text).
    const ariaLabel = el.element?.getAttribute?.('aria-label') ?? undefined;
    const titleAttr = el.element?.getAttribute?.('title') ?? undefined;
    return {
      id: el.id,
      type: el.type,
      tagName: el.element?.tagName?.toLowerCase?.(),
      label: el.label,
      ariaLabel: ariaLabel || undefined,
      title: titleAttr || undefined,
      identifier: el.getIdentifier?.(),
      state: el.getState?.(),
      actions: el.actions,
      customActions: el.customActions ? Object.keys(el.customActions) : undefined,
      category: el.category,
      contentMetadata: el.contentMetadata,
      mediaMetadata: el.mediaMetadata,
      // Live bbox/visibility maintained by `useUIElement`. Present for
      // SDK-registered elements; absent for DOM-fallback scans.
      bbox: el.bbox,
      visible: el.visible,
    };
  }) as ControlSnapshot['elements'];
}

/**
 * Registry interface - minimal contract for handler usage
 */
export interface RegistryLike {
  getAllElements(): unknown[];
  getElement(id: string): unknown | undefined;
  getAllComponents(): unknown[];
  getComponent(id: string): unknown | undefined;
  getComponentState?(id: string): {
    state: Record<string, unknown>;
    computed: Record<string, unknown>;
    timestamp: number;
  } | null;
  createSnapshot(): ControlSnapshot;
  getRenderLog?(): RenderLogEntry[];
  clearRenderLog?(): void;
  captureSnapshot?(): unknown;
  findElements?(request?: unknown): unknown[];
  getAllWorkflows?(): unknown[];
  getWorkflow?(id: string): unknown;
  getActionHistory?(): unknown[];
  getMetrics?(): unknown;
  highlightElement?(id: string): void;
  getElementTree?(): unknown;

  // State management
  getStates?(): UIState[];
  getState?(id: string): UIState | undefined;
  getActiveStates?(): UIState[];
  activateState?(id: string): void;
  deactivateState?(id: string): void;
  getStateGroups?(): UIStateGroup[];
  activateStateGroup?(id: string): void;
  deactivateStateGroup?(id: string): void;
  getTransitions?(): UITransition[];
  canExecuteTransition?(id: string): { canExecute: boolean; reason?: string };
  executeTransition?(id: string): Promise<TransitionResult>;
  findPath?(targetStates: string[]): PathResult;
  navigateTo?(targetStates: string[]): Promise<NavigationResult>;
  getStateSnapshot?(): StateSnapshot;

  // Element event log
  getElementHistory?(elementId: string, options?: ElementHistoryOptions): ElementLogEntry[];

  // Event subscription (for push-based change observation)
  on?<T = unknown>(
    type: import('../core').BridgeEventType,
    listener: (event: import('../core').BridgeEvent<T>) => void
  ): () => void;
}

/**
 * Action executor interface - minimal contract for handler usage
 */
export interface ActionExecutorLike {
  executeAction(
    elementId: string,
    request: { action: string; params?: Record<string, unknown>; waitOptions?: unknown }
  ): Promise<unknown>;
  executeComponentAction(
    componentId: string,
    request: { action: string; params?: Record<string, unknown> }
  ): Promise<unknown>;
  fillForm?(request: FillFormRequest): Promise<FillResult>;
  executeBatch?(request: BatchActionRequest): Promise<BatchActionResponse>;
}

/**
 * Console capture interface — minimal contract for handler usage
 * @deprecated Use BrowserEventCaptureLike instead
 */
export interface ConsoleCapturelike {
  getConsoleSince(ts: number): CapturedError[];
  getConsoleRecent(n?: number): CapturedError[];
  clear(): void;
}

/**
 * Browser event capture interface — full contract for handler usage.
 * Extends the legacy ConsoleCapturelike with full event query methods.
 */
export interface BrowserEventCaptureLike extends ConsoleCapturelike {
  getSince(ts: number): AnyCapturedEvent[];
  getRecent(n?: number): AnyCapturedEvent[];
  getByType(type: BrowserEventType): AnyCapturedEvent[];
  getFrameworkOverlays?(): import('../debug/captures/framework-overlays').DetectedErrorOverlay[];
}

/**
 * Configuration for creating handlers
 */
export interface CreateHandlersConfig {
  /** Optional render log path */
  renderLogPath?: string;
  /** Verbose logging */
  verbose?: boolean;
  /** Optional annotation store (defaults to global singleton) */
  annotationStore?: AnnotationStore;
  /**
   * Browser event capture instance for error/event monitoring.
   * Accepts either the full BrowserEventCaptureLike or the legacy ConsoleCapturelike.
   */
  consoleCapture?: BrowserEventCaptureLike | ConsoleCapturelike;
  /** Navigation tracker instance for page/route awareness in snapshots */
  navigationTracker?: NavigationTracker;
  /** Shortcut tracker instance for keyboard shortcut discovery in snapshots */
  shortcutTracker?: ShortcutTracker;
  /** Modal detector instance for modal/dialog stack detection in snapshots */
  modalDetector?: ModalDetector;
  /** Toast capture instance for toast/notification detection in snapshots */
  toastCapture?: ToastCapture;
  /** Relationship tracker instance for element relationship hints in snapshots */
  relationshipTracker?: RelationshipTracker;
  /** Drag-drop detector instance for drag source and drop zone discovery in snapshots */
  dragDropDetector?: DragDropDetector;
  /** Undo tracker instance for undo/redo awareness in snapshots */
  undoTracker?: UndoTracker;
  /** Spec store instance for serving loaded specs (defaults to global singleton) */
  specStore?: import('../specs/store').SpecStore;
  /** Idle detection configuration. Set to false to disable. */
  idleDetection?: CompositeIdleConfig | false;
  /**
   * Callback for idle detection events (app:busy, network:idle, etc.).
   * Wire this to UIBridgeWSHandler.broadcastEvent() to push idle events to WebSocket clients.
   */
  onIdleEvent?: (event: import('../core').BridgeEvent) => void;
  /**
   * Callback for browser error/warning events.
   * Wire this to UIBridgeWSHandler.broadcastEvent() to push error events to WebSocket clients.
   * Events are classified by severity before being emitted.
   */
  onBrowserEvent?: (event: import('../core').BridgeEvent) => void;
  /**
   * Network request monitoring configuration.
   * Set to `false` to disable, or provide a `NetworkTrackerConfig` object.
   * Defaults to enabled with default settings.
   */
  networkMonitoring?: NetworkTrackerConfig | false;
  /**
   * Callback for push-based change observation events (snapshot:changed).
   * Wire this to SSEManager.broadcast() and/or UIBridgeWSHandler.broadcastEvent()
   * to push change events to connected clients.
   */
  onChangeEvent?: (event: BridgeEvent) => void;
  /**
   * Navigation adapter for app-agnostic page navigation.
   * If not provided, falls back to window.location navigation.
   */
  navigationAdapter?: NavigationAdapter;
}

/**
 * Add `path` to each action and `actionInvocationPath` to the component itself
 * so callers can discover how to invoke actions without reading docs or
 * reverse-engineering the route. The path uses `{actionId}` as a placeholder
 * at the component level and a concrete URL per action.
 */
function annotateComponentWithInvocationPaths(comp: unknown): Record<string, unknown> {
  const c = (comp ?? {}) as { id?: string; actions?: unknown[]; [k: string]: unknown };
  const id = typeof c.id === 'string' ? c.id : '';
  const rawActions = Array.isArray(c.actions) ? c.actions : [];
  const annotatedActions = rawActions.map((a) => {
    if (a && typeof a === 'object' && 'id' in a) {
      const action = a as { id: string; [k: string]: unknown };
      return {
        ...action,
        path: `/control/component/${id}/action/${action.id}`,
      };
    }
    return a;
  });
  return {
    ...c,
    actions: annotatedActions,
    actionInvocationPath: `/control/component/${id}/action/{actionId}`,
  };
}

/**
 * Create a success response
 */
function success<T>(data: T): APIResponse<T> {
  return {
    success: true,
    data,
    timestamp: Date.now(),
  };
}

/**
 * Create an error response
 */
function error<T = unknown>(message: string, code?: string): APIResponse<T> {
  return {
    success: false,
    error: message,
    code,
    timestamp: Date.now(),
  };
}

/**
 * Generate recovery suggestions based on error code
 */
function getRecoverySuggestions(errorCode: ActionErrorCode): Array<{
  suggestion: string;
  command?: string;
  confidence: number;
  retryable: boolean;
}> {
  switch (errorCode) {
    case 'ELEMENT_NOT_FOUND':
      return [
        {
          suggestion: 'Wait for the page to fully load',
          command: 'wait for page to load',
          confidence: 0.7,
          retryable: true,
        },
        {
          suggestion: 'Use a different description for the element',
          confidence: 0.8,
          retryable: false,
        },
        {
          suggestion: 'Scroll the page to reveal the element',
          command: 'scroll down',
          confidence: 0.6,
          retryable: true,
        },
      ];
    case 'ELEMENT_NOT_VISIBLE':
      return [
        {
          suggestion: 'Scroll to make the element visible',
          command: 'scroll to element',
          confidence: 0.9,
          retryable: true,
        },
        {
          suggestion: 'Wait for any loading overlays to disappear',
          confidence: 0.7,
          retryable: true,
        },
        {
          suggestion: 'Close any blocking modals or popups',
          command: 'click close button',
          confidence: 0.8,
          retryable: true,
        },
      ];
    case 'ELEMENT_NOT_ENABLED':
      return [
        { suggestion: 'Fill in required fields first', confidence: 0.8, retryable: false },
        {
          suggestion: 'Complete prerequisite steps in the form',
          confidence: 0.7,
          retryable: false,
        },
        {
          suggestion: 'Wait for the element to become enabled',
          command: 'wait for element to be enabled',
          confidence: 0.6,
          retryable: true,
        },
      ];
    case 'ELEMENT_NOT_INTERACTABLE':
      return [
        {
          suggestion: 'Close any modal or popup blocking the element',
          command: 'click close button',
          confidence: 0.9,
          retryable: true,
        },
        { suggestion: 'Wait for animations to complete', confidence: 0.7, retryable: true },
        {
          suggestion: 'Scroll the element into the viewport',
          command: 'scroll to element',
          confidence: 0.8,
          retryable: true,
        },
      ];
    case 'ACTION_TIMEOUT':
      return [
        { suggestion: 'Increase the timeout duration', confidence: 0.8, retryable: true },
        { suggestion: 'Check if the condition can ever be met', confidence: 0.7, retryable: false },
        {
          suggestion: 'Verify the page is responding',
          command: 'check page status',
          confidence: 0.6,
          retryable: true,
        },
      ];
    case 'LOW_CONFIDENCE':
      return [
        {
          suggestion: 'Use the exact text shown on the element',
          confidence: 0.9,
          retryable: false,
        },
        {
          suggestion: 'Try a different description that more closely matches the element',
          confidence: 0.8,
          retryable: false,
        },
        {
          suggestion: 'Lower the confidence threshold if the match is correct',
          confidence: 0.7,
          retryable: true,
        },
      ];
    case 'AMBIGUOUS_MATCH':
      return [
        {
          suggestion: 'Be more specific about which element you mean',
          confidence: 0.9,
          retryable: false,
        },
        {
          suggestion: 'Include the section or form name in the description',
          confidence: 0.8,
          retryable: false,
        },
        { suggestion: 'Use the element ID directly', confidence: 0.7, retryable: false },
      ];
    default:
      return [
        {
          suggestion: 'Try a different approach or check the page state',
          confidence: 0.5,
          retryable: false,
        },
      ];
  }
}

/**
 * Create structured failure details
 */
function createFailureDetails(
  errorCode: ActionErrorCode,
  message: string,
  options: {
    elementId?: string;
    selectorsTried?: string[];
    durationMs?: number;
    timeoutMs?: number;
  } = {}
): ActionFailureDetails {
  const retryableErrors: ActionErrorCode[] = [
    'ELEMENT_NOT_VISIBLE',
    'ACTION_TIMEOUT',
    'LOW_CONFIDENCE',
    'NETWORK_ERROR',
    'STATE_NOT_REACHED',
  ];

  return {
    errorCode,
    message,
    elementId: options.elementId,
    selectorsTried: options.selectorsTried,
    suggestedActions: getRecoverySuggestions(errorCode),
    retryRecommended: retryableErrors.includes(errorCode),
    durationMs: options.durationMs,
    timeoutMs: options.timeoutMs,
  };
}

/**
 * Create server handlers for UI Bridge
 *
 * @param registry - The UI Bridge registry instance
 * @param actionExecutor - The action executor instance
 * @param config - Optional configuration
 * @returns Handler implementations for all endpoints
 *
 * @example
 * ```ts
 * import { createHandlers } from '@qontinui/ui-bridge/server';
 * import { getGlobalRegistry, createActionExecutor } from '@qontinui/ui-bridge';
 *
 * const registry = getGlobalRegistry();
 * const executor = createActionExecutor(registry);
 * const handlers = createHandlers(registry, executor);
 *
 * // Use with Express
 * const router = createExpressRouter(handlers);
 *
 * // Use with standalone server
 * const server = new StandaloneServer(handlers);
 * ```
 */
// Module-level heartbeat tracking for health detection
let lastHeartbeatTimestamp = 0;

/**
 * Check if the app is responsive based on heartbeat freshness.
 */
export function isAppResponsive(): boolean {
  return lastHeartbeatTimestamp > 0 && Date.now() - lastHeartbeatTimestamp < 30_000;
}

/**
 * Get the last heartbeat timestamp.
 */
export function getLastHeartbeat(): number {
  return lastHeartbeatTimestamp;
}

export function createHandlers(
  registry: RegistryLike,
  actionExecutor: ActionExecutorLike,
  config: CreateHandlersConfig = {}
): UIBridgeServerHandlers {
  // Create AI module instances
  const searchEngine = new SearchEngine();
  const nlExecutor = new NLActionExecutor();
  const assertionExecutor = new AssertionExecutor();
  const snapshotManager = new SemanticSnapshotManager();
  const diffManager = new SemanticDiffManager();

  // Intent registry (in-memory store for registered intents)
  const intentRegistry = new Map<string, Intent>();

  // Console/browser event capture
  const consoleCapture = config.consoleCapture ?? null;

  // Navigation tracker for page/route awareness
  const navigationTracker = config.navigationTracker ?? null;

  // Shortcut tracker for keyboard shortcut discovery
  const shortcutTracker = config.shortcutTracker ?? null;

  // Modal detector for modal/dialog stack
  const modalDetector = config.modalDetector ?? null;

  // Toast capture for notification detection
  const toastCapture = config.toastCapture ?? null;

  // Relationship tracker for element relationship hints
  const relationshipTracker = config.relationshipTracker ?? null;

  // Drag-drop detector for drag source and drop zone discovery
  const dragDropDetector = config.dragDropDetector ?? null;

  // Navigation adapter for app-agnostic page navigation
  const navAdapter: NavigationAdapter = config.navigationAdapter ?? new WindowLocationAdapter();

  // Undo tracker for undo/redo awareness
  const undoTracker = config.undoTracker ?? null;

  // Spec store for /control/specs
  const specStore = config.specStore ?? getGlobalSpecStore();

  // Timeline buffer for action/error timeline
  const timelineBuffer = new TimelineBuffer(500);

  // Error session manager
  const errorSessionManager = new ErrorSessionManager();

  // Network request monitoring — create early so idle detector and chain tracker
  // can subscribe to events instead of independently patching fetch/XHR.
  const networkTracker =
    config.networkMonitoring !== false
      ? new NetworkRequestTracker(
          typeof config.networkMonitoring === 'object' ? config.networkMonitoring : undefined
        )
      : null;
  if (networkTracker) {
    networkTracker.install();
  }

  // Network chain tracker — uses the shared tracker when available to avoid
  // redundant fetch/XHR interception.
  const networkChainTracker = new NetworkChainTracker(
    networkTracker ? { tracker: networkTracker } : undefined
  );
  networkChainTracker.install();

  // Error snapshot buffer — captures app state on significant errors
  const errorSnapshotBuffer = new ErrorSnapshotBuffer({
    capturePageState: () => {
      const snapshot = registry.createSnapshot();
      // Extract visible error text from elements with alert roles or error classes
      const visibleErrors: string[] = [];
      if (typeof document !== 'undefined') {
        const errorElements = document.querySelectorAll(
          '[role="alert"], .error, .toast-error, .error-message, [data-error]'
        );
        errorElements.forEach((el) => {
          const text = (el as HTMLElement).textContent?.trim();
          if (text) visibleErrors.push(text.slice(0, 200));
        });
      }
      return {
        url: typeof window !== 'undefined' ? window.location.href : '',
        title: typeof document !== 'undefined' ? document.title : '',
        elementCount: snapshot.elements.length,
        visibleErrors,
      };
    },
    getRecentActions: () => {
      const history = registry.getActionHistory?.() as Array<{ description?: string }> | undefined;
      return (history ?? []).slice(-5).map((a) => a.description ?? 'unknown action');
    },
  });

  // Browser event stream for real-time WebSocket broadcasting
  const browserEventStream = new BrowserEventStream();

  // When onBrowserEvent is provided, create a default subscription so events
  // actually flow through the stream's filters to the callback. Without this,
  // processEvent() returns an empty Map and the callback is never invoked.
  if (config.onBrowserEvent) {
    browserEventStream.subscribe({
      minSeverity: 'warning',
      deduplicate: true,
    });
  }

  // Detect if the capture instance supports the full browser event API
  function hasFullEventAPI(
    cap: BrowserEventCaptureLike | ConsoleCapturelike | null
  ): cap is BrowserEventCaptureLike {
    return cap !== null && 'getSince' in cap && 'getRecent' in cap && 'getByType' in cap;
  }

  // Tier 3.3: broadcaster for BrowserEventCapture events so the change buffer
  // can subscribe without displacing the existing session/snapshot/streaming handlers.
  const browserEventListeners: Array<(event: AnyCapturedEvent) => void> = [];

  // Wire BrowserEventCapture's onEvent callback to feed sessions, snapshots, and streaming
  if (
    consoleCapture &&
    'setOnEvent' in consoleCapture &&
    typeof (consoleCapture as any).setOnEvent === 'function'
  ) {
    const emitBrowserEvent = config.onBrowserEvent;

    (consoleCapture as any).setOnEvent((event: AnyCapturedEvent) => {
      // Feed error session manager
      errorSessionManager.recordEvent(event);

      // Feed error snapshot buffer
      errorSnapshotBuffer.processEvent(event);

      // Feed browser event stream (for WebSocket subscribers)
      const messages = browserEventStream.processEvent(event);
      if (emitBrowserEvent && messages.size > 0) {
        const { severity } = classifyEvent(event);
        const eventType: import('../core').BridgeEventType =
          severity === 'crash'
            ? 'browser:crash'
            : severity === 'error'
              ? 'browser:error'
              : 'browser:warning';

        emitBrowserEvent({
          type: eventType,
          timestamp: Date.now(),
          data: { event, severity },
        });
      }

      // Tier 3.3: broadcast to change-buffer subscribers
      for (const listener of browserEventListeners) {
        try {
          listener(event);
        } catch {
          /* ignore */
        }
      }
    });
  }

  // Annotation store
  const annotationStore = config.annotationStore ?? getGlobalAnnotationStore();

  // Design review: loaded style guide (in-memory)
  let loadedStyleGuide: StyleGuideConfig | null = null;
  let savedBaseline: SnapshotBaseline | null = null;

  // Idle detection — pass the shared network tracker so the idle detector
  // subscribes to events instead of independently patching fetch/XHR.
  const idleDetector =
    config.idleDetection !== false
      ? CompositeIdleDetector.create(
          (() => {
            const idleConfig =
              typeof config.idleDetection === 'object' ? { ...config.idleDetection } : {};
            if (networkTracker) {
              idleConfig.network = { ...idleConfig.network, tracker: networkTracker };
            }
            return idleConfig;
          })()
        )
      : null;

  // Wire idle detector events to the onIdleEvent callback
  if (idleDetector && config.onIdleEvent) {
    const emit = config.onIdleEvent;
    const mkEvent = (type: import('../core').BridgeEventType, data: unknown) => ({
      type,
      timestamp: Date.now(),
      data,
    });

    // Composite transitions → app:busy / app:idle
    idleDetector.onTransition((status) => {
      emit(mkEvent(status.idle ? 'app:idle' : 'app:busy', status));
    });

    // Per-signal transitions
    const networkSignal = idleDetector.getSignal('network') as
      | import('../idle').NetworkIdleDetector
      | undefined;
    if (networkSignal) {
      networkSignal.onTransition((idle, status) => {
        emit(mkEvent(idle ? 'network:idle' : 'network:busy', status));
      });
      networkSignal.onRequestStart = (data) => {
        emit(mkEvent('network:requestStart', data));
      };
      networkSignal.onRequestEnd = (data) => {
        emit(mkEvent('network:requestEnd', data));
      };
    }

    const domSignal = idleDetector.getSignal('dom');
    if (domSignal) {
      domSignal.onTransition((idle, status) => {
        emit(mkEvent(idle ? 'dom:settled' : 'dom:mutating', status));
      });
    }

    const loadingSignal = idleDetector.getSignal('loading-indicators');
    if (loadingSignal) {
      loadingSignal.onTransition((idle, status) => {
        emit(mkEvent(idle ? 'loading:cleared' : 'loading:detected', status));
      });
    }

    const formMutationSignal = idleDetector.getSignal('form-mutation');
    if (formMutationSignal) {
      formMutationSignal.onTransition((idle, status) => {
        emit(mkEvent(idle ? 'form:settled' : 'form:mutating', status));
      });
    }
  }

  // Wire idle detector to action executor for waitAfter support
  if (idleDetector && typeof (actionExecutor as any).setIdleDetector === 'function') {
    (actionExecutor as any).setIdleDetector(idleDetector);
  }

  async function awaitDOMSettled(timeout = 500): Promise<void> {
    if (!idleDetector) return;
    const domSignal = idleDetector.getSignal('dom');
    if (!domSignal || domSignal.isIdle()) return;
    try {
      await domSignal.waitForIdle({ timeout, minStableMs: 0 });
    } catch {
      // Timeout is non-fatal — return whatever is registered
    }
  }

  // Push-based change observation (allio-inspired)
  const changeObserver = new ChangeObserver({ bufferCapacity: 5000, batchIntervalMs: 16 });

  // Wire registry element events → ChangeObserver via public on() API
  const unsubscribes: Array<() => void> = [];
  if (registry.on) {
    const unsub1 = registry.on('element:registered', (event: BridgeEvent) => {
      const id = (event.data as { id?: string })?.id;
      if (id) changeObserver.onElementAdded(id);
    });
    if (unsub1) unsubscribes.push(unsub1);
    const unsub2 = registry.on('element:unregistered', (event: BridgeEvent) => {
      const id = (event.data as { id?: string })?.id;
      if (id) changeObserver.onElementRemoved(id);
    });
    if (unsub2) unsubscribes.push(unsub2);
    const unsub3 = registry.on('element:stateChanged', (event: BridgeEvent) => {
      const id =
        (event.data as { id?: string; elementId?: string })?.id ??
        (event.data as { elementId?: string })?.elementId;
      if (id) changeObserver.onElementModified(id);
    });
    if (unsub3) unsubscribes.push(unsub3);
  }

  // Wire ChangeObserver → SSEManager/WS broadcast via onChangeEvent callback
  if (config.onChangeEvent) {
    const emitChange = config.onChangeEvent;
    changeObserver.subscribe((domChange) => {
      emitChange({
        type: 'snapshot:changed',
        timestamp: domChange.timestamp,
        data: domChange,
      });
    });
  }

  // Change tracker
  const changeTracker = new ChangeTracker({
    snapshotManager,
    idleDetector,
    createControlSnapshot: () => registry.createSnapshot(),
    executeNLAction: async (instruction: string) => {
      refreshElements();
      return nlExecutor.execute({ instruction }) as Promise<any>;
    },
    executeElementAction: async (elementId: string, request) => {
      return actionExecutor.executeAction(elementId, request);
    },
    refreshElements: () => refreshElements(),
    subscribeChanges: (callback) => {
      return changeObserver.subscribe((event) => {
        callback({ type: 'snapshot:changed', timestamp: event.timestamp });
      });
    },
    resolveScope: (scope: string): Set<string> | null => {
      // Use DOM containment when running in a browser environment
      if (typeof document === 'undefined') return null;
      try {
        const container = document.querySelector(scope);
        if (!container) return null;

        // Collect IDs of all registered elements inside this container
        const ids = new Set<string>();
        const allElements = registry.getAllElements() as Array<{
          id: string;
          element?: HTMLElement;
        }>;
        for (const el of allElements) {
          if (el.element && container.contains(el.element)) {
            ids.add(el.id);
          }
        }
        return ids;
      } catch {
        // Invalid CSS selector — fall back to string matching
        return null;
      }
    },

    // Tier 3.3: hook into BrowserEventCapture for console errors via the shared broadcaster
    subscribeBrowserEvents:
      consoleCapture && 'setOnEvent' in consoleCapture
        ? (callback) => {
            const listener = (event: AnyCapturedEvent) => {
              if (event.type === 'console') {
                callback({
                  type: event.type,
                  timestamp: event.timestamp,
                  level: (event as import('../debug/browser-capture-types').ConsoleCapturedEvent)
                    .level,
                  message: (event as import('../debug/browser-capture-types').ConsoleCapturedEvent)
                    .message,
                  stack: (event as import('../debug/browser-capture-types').ConsoleCapturedEvent)
                    .stack,
                });
              }
            };
            browserEventListeners.push(listener);
            return () => {
              const idx = browserEventListeners.indexOf(listener);
              if (idx >= 0) browserEventListeners.splice(idx, 1);
            };
          }
        : undefined,

    // Tier 3.3: hook into NetworkRequestTracker for network requests
    subscribeNetworkEvents: networkTracker
      ? (callback) => {
          return networkTracker.onEvent((event) => {
            callback({
              type: event.type,
              timestamp: event.timestamp,
              entry: {
                request: {
                  url: event.entry.request.url,
                  method: event.entry.request.method,
                  startedAt: event.entry.request.startedAt,
                },
                response: event.entry.response
                  ? {
                      statusCode: event.entry.response.statusCode,
                      durationMs: event.entry.response.durationMs,
                    }
                  : undefined,
              },
            });
          });
        }
      : undefined,
  });

  // -----------------------------------------------------------------------
  // Helper to get fresh elements and update AI modules.
  //
  // B0 — Use the same composition snapshot's `getControlSnapshot` builds
  // (registry → DOM-fallback) so the SearchEngine, NLActionExecutor, and
  // AssertionExecutor see exactly the elements the snapshot endpoint
  // returns. Earlier, `refreshElements()` was bare `registry.getAllElements()`
  // while `getControlSnapshot` had a DOM-fallback for the case where
  // `createSnapshot()` lagged behind. That left the AI modules blind during
  // hot navigation/auto-register settle while snapshot callers still
  // succeeded — a registry-vs-cache discrepancy that produced the
  // "snapshot has it, /ai/find doesn't" symptom this work targets.
  //
  // The merged set is built here and shared across all three consumers so
  // they cannot drift again. The consumers all accept the loose
  // `Array<DiscoveredElement | RegisteredElement>` shape, so feeding raw
  // RegisteredElement entries (preferred — they expose `.element` and
  // `.getState()`) or DOM-fallback DiscoveredElement entries works
  // uniformly.
  // -----------------------------------------------------------------------
  function refreshElements(): void {
    let elements: unknown[] = registry.getAllElements();
    if (elements.length === 0) {
      const domElements = scanDOMForInteractiveElements();
      if (domElements.length > 0) {
        elements = domElements;
      }
    }
    searchEngine.updateElements(elements as any[]);
    nlExecutor.updateElements(elements as any[]);
    nlExecutor.setActionExecutor(actionExecutor as any);
    assertionExecutor.updateElements(elements as any[]);
  }

  function applyFindFilters(elements: any[], request: FindRequest): any[] {
    return elements.filter((el: any) => {
      // Filter by interactiveOnly (support both camelCase and snake_case)
      if (request.interactiveOnly || (request as any).interactive_only) {
        // Item 1: drop `kind: "content"` entries up front — they're the
        // semantic card/badge/pill elements authors opt into via
        // `data-ui-bridge-content`, not interactive elements.
        if ((el as { kind?: string }).kind === 'content') return false;
        const interactiveTypes = new Set([
          'button',
          'input',
          'select',
          'textarea',
          'link',
          'checkbox',
          'radio',
          'switch',
          'tab',
          'slider',
          'menuitem',
        ]);
        const isInteractive =
          interactiveTypes.has(el.type) || (el.actions && el.actions.length > 0);
        if (!isInteractive) return false;
      }
      if (request.types && el.type && !request.types.includes(el.type)) return false;
      if (request.element_type && el.type && el.type !== request.element_type) return false;
      if (request.role) {
        const elRole = (el.role || '').toLowerCase();
        if (elRole !== request.role.toLowerCase()) return false;
      }
      if (request.text) {
        const searchText = request.text.toLowerCase();
        const label = (el.label || '').toLowerCase();
        const textContent = (el.state?.textContent || el.textContent || '').toLowerCase();
        const accessibleName = (el.accessibleName || '').toLowerCase();
        if (
          !label.includes(searchText) &&
          !textContent.includes(searchText) &&
          !accessibleName.includes(searchText)
        ) {
          return false;
        }
      }
      if (request.exact_text) {
        const exactLc = request.exact_text.toLowerCase();
        const elLabel = (el.label || '').toLowerCase();
        const textContent = (el.state?.textContent || el.textContent || '').trim().toLowerCase();
        const accessibleName = (el.accessibleName || '').toLowerCase();
        if (elLabel !== exactLc && textContent !== exactLc && accessibleName !== exactLc) {
          return false;
        }
      }
      if (request.label) {
        const labelSearch = request.label.toLowerCase();
        const elLabel = (el.label || '').toLowerCase();
        if (!elLabel.includes(labelSearch)) return false;
      }
      if (request.testId) {
        const elTestId = el.testId || el.identifiers?.testId || '';
        if (elTestId !== request.testId) return false;
      }
      return true;
    });
  }

  return {
    // =========================================================================
    // Render Log Handlers
    // =========================================================================

    getRenderLog: async (query?: RenderLogQuery): Promise<APIResponse<RenderLogEntry[]>> => {
      try {
        const entries = registry.getRenderLog?.() ?? [];

        let filtered = entries;

        if (query?.type) {
          filtered = filtered.filter((e) => e.type === query.type);
        }
        if (query?.since) {
          filtered = filtered.filter((e) => e.timestamp >= query.since!);
        }
        if (query?.until) {
          filtered = filtered.filter((e) => e.timestamp <= query.until!);
        }
        if (query?.limit) {
          filtered = filtered.slice(0, query.limit);
        }

        return success(filtered);
      } catch (err) {
        return error((err as Error).message, 'RENDER_LOG_ERROR');
      }
    },

    clearRenderLog: async (): Promise<APIResponse<void>> => {
      try {
        registry.clearRenderLog?.();
        return success(undefined);
      } catch (err) {
        return error((err as Error).message, 'RENDER_LOG_ERROR');
      }
    },

    captureSnapshot: async (): Promise<APIResponse<unknown>> => {
      try {
        const snapshot = registry.captureSnapshot?.();
        return success(snapshot);
      } catch (err) {
        return error((err as Error).message, 'SNAPSHOT_ERROR');
      }
    },

    getRenderLogPath: async (): Promise<APIResponse<{ path: string }>> => {
      return success({ path: config.renderLogPath || '' });
    },

    // =========================================================================
    // Element Handlers
    // =========================================================================

    getElements: async (options?: {
      recency?: string;
      title?: string;
      aria_label?: string;
      text?: string;
    }): Promise<APIResponse<ControlSnapshot['elements']>> => {
      try {
        const elements = registry.getAllElements();
        let materialized = materializeElements(elements);

        // Apply case-insensitive substring filters via the shared matcher
        // (uses the accessible-name fallback chain so callers see consistent
        // results across getElements / waitForElementByCondition / relay).
        if (options?.title || options?.aria_label || options?.text) {
          materialized = materialized.filter((el) =>
            matchesElementSelector(el as unknown as MatchableElement, {
              title: options?.title,
              aria_label: options?.aria_label,
              text: options?.text,
            })
          );
        }

        return success(materialized);
      } catch (err) {
        return error((err as Error).message, 'ELEMENTS_ERROR');
      }
    },

    rankElements: async (
      request?: ElementQuery
    ): Promise<
      APIResponse<
        Array<{
          id: string;
          score: number;
          reasons: string[];
          element: ControlSnapshot['elements'][0];
        }>
      >
    > => {
      try {
        const elements = registry.getAllElements();
        const materialized = materializeElements(elements) as ControlSnapshot['elements'];
        const matches = findElements(
          materialized as unknown as Parameters<typeof findElements>[0],
          request ?? {}
        );
        return success(
          matches.map((m) => ({
            id: m.id,
            score: m.score,
            reasons: m.reasons,
            element: m.element as unknown as ControlSnapshot['elements'][0],
          }))
        );
      } catch (err) {
        return error((err as Error).message, 'RANK_ELEMENTS_ERROR');
      }
    },

    getElement: async (id: string): Promise<APIResponse<ControlSnapshot['elements'][0]>> => {
      try {
        const element = registry.getElement(id);
        if (!element) {
          const failureDetails = createFailureDetails(
            'ELEMENT_NOT_FOUND',
            `Element not found: ${id}`,
            {
              elementId: id,
              selectorsTried: [id],
            }
          );
          return {
            success: false,
            error: `Element not found: ${id}`,
            code: 'ELEMENT_NOT_FOUND',
            data: { failureDetails } as any,
            timestamp: Date.now(),
          };
        }
        return success(materializeElements([element])[0]);
      } catch (err) {
        return error((err as Error).message, 'ELEMENT_ERROR');
      }
    },

    getElementState: async (id: string): Promise<APIResponse<unknown>> => {
      try {
        const element = registry.getElement(id) as { state?: unknown } | undefined;
        if (!element) {
          return error(`Element not found: ${id}`, 'NOT_FOUND');
        }
        return success(element.state);
      } catch (err) {
        return error((err as Error).message, 'ELEMENT_STATE_ERROR');
      }
    },

    getElementReactState: async (id: string): Promise<APIResponse<unknown>> => {
      try {
        const element = registry.getElement(id) as { element?: HTMLElement } | undefined;
        if (!element) {
          return error(`Element not found: ${id}`, 'NOT_FOUND');
        }
        if (!element.element) {
          return error(`Element ${id} has no DOM node`, 'NO_DOM_NODE');
        }
        const reactState = extractReactState(element.element);
        if (!reactState) {
          return success({
            props: {},
            fiberState: [],
            componentName: undefined,
            note: 'No React internals found on this element',
          });
        }
        return success(reactState);
      } catch (err) {
        return error((err as Error).message, 'REACT_STATE_ERROR');
      }
    },

    executeElementAction: async (
      id: string,
      request: {
        action: string;
        params?: Record<string, unknown>;
        waitOptions?: unknown;
        captureAfter?: boolean;
      }
    ) => {
      const startTime = Date.now();
      try {
        // Pre-flight registry check.
        // Page-level sentinel IDs ("document", "body", "window") bypass the registry
        // check — the action executor resolves them to document.documentElement directly.
        const isPageScrollSentinel =
          request.action === 'scroll' && (id === 'document' || id === 'body' || id === 'window');
        let element = isPageScrollSentinel ? true : registry.getElement(id);

        // Auto-rediscover: if the element isn't in the registry, refresh the
        // search/NL modules and let the action executor's richer lookup chain
        // (findElementByIdentifier → CTR → discovery cache) take a crack at it
        // before we return ELEMENT_NOT_FOUND. This handles cases where the
        // registry was stale between discover() and executeAction() — e.g.
        // React re-rendered the tree and the client is still using an older
        // ID that maps to a DOM node with a matching data-testid/id attribute.
        if (!element && !isPageScrollSentinel) {
          refreshElements();
          element = registry.getElement(id);
        }

        // Capture pre-action element states for diffing if captureAfter is requested
        type ElementStateSnapshot = { id: string; state: Record<string, unknown> };
        let preActionStates: Map<string, ElementStateSnapshot> | undefined;
        if (request.captureAfter) {
          preActionStates = new Map();
          for (const rawEl of registry.getAllElements()) {
            const el = rawEl as { id: string; getState?: () => unknown };
            try {
              if (el.getState) {
                const state = el.getState();
                preActionStates.set(el.id, { id: el.id, state: state as Record<string, unknown> });
              }
            } catch {
              // Skip elements whose state can't be captured
            }
          }
        }

        const result = await actionExecutor.executeAction(id, {
          action: request.action,
          params: request.params,
          waitOptions: request.waitOptions,
        });

        // Record successful action for undo correlation
        if (
          undoTracker &&
          result &&
          typeof result === 'object' &&
          'success' in result &&
          (result as { success: boolean }).success
        ) {
          undoTracker.recordAction({
            id: `action-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            target: id,
            action: request.action,
            params: request.params,
          });
        }

        // If the action executor returned a failure, enhance with structured details
        if (result && typeof result === 'object' && 'success' in result && !result.success) {
          const actionResult = result as {
            success: boolean;
            error?: string;
            elementState?: unknown;
          };
          // Determine error code based on error message
          let errorCode: ActionErrorCode = 'UNKNOWN_ERROR';
          const errorMsg = actionResult.error?.toLowerCase() || '';

          if (errorMsg.includes('not found')) {
            errorCode = 'ELEMENT_NOT_FOUND';
          } else if (errorMsg.includes('not visible') || errorMsg.includes('hidden')) {
            errorCode = 'ELEMENT_NOT_VISIBLE';
          } else if (errorMsg.includes('disabled') || errorMsg.includes('not enabled')) {
            errorCode = 'ELEMENT_NOT_ENABLED';
          } else if (errorMsg.includes('timeout')) {
            errorCode = 'ACTION_TIMEOUT';
          } else if (errorMsg.includes('blocked') || errorMsg.includes('interactable')) {
            errorCode = 'ELEMENT_NOT_INTERACTABLE';
          }

          const failureDetails = createFailureDetails(
            errorCode,
            actionResult.error || 'Action failed',
            {
              elementId: id,
              durationMs: Date.now() - startTime,
            }
          );

          return success({
            ...actionResult,
            failureDetails,
          }) as APIResponse<any>;
        }

        // Compute changes diff when captureAfter was requested
        if (request.captureAfter && preActionStates && result && typeof result === 'object') {
          const postElements = registry.getAllElements() as Array<{
            id: string;
            getState?: () => unknown;
          }>;
          const postIds = new Set(postElements.map((el) => el.id));
          const preIds = new Set(preActionStates.keys());

          const appeared = [...postIds].filter((eid) => !preIds.has(eid));
          const disappeared = [...preIds].filter((eid) => !postIds.has(eid));
          const stateChanged: ElementFieldChange[] = [];

          // Compare state fields for elements that exist in both
          const compareFields = [
            'visible',
            'enabled',
            'focused',
            'value',
            'checked',
            'textContent',
          ] as const;
          for (const el of postElements) {
            const pre = preActionStates.get(el.id);
            if (!pre || !el.getState) continue;
            try {
              const postState = el.getState() as Record<string, unknown>;
              const preState = pre.state;
              for (const field of compareFields) {
                const before = preState[field];
                const after = postState[field];
                if (before !== after && (before !== undefined || after !== undefined)) {
                  stateChanged.push({ elementId: el.id, field, before, after });
                }
              }
            } catch {
              // Skip elements whose state can't be read
            }
          }

          const changes: ActionChanges = { appeared, disappeared, stateChanged };
          (result as Record<string, unknown>).changes = changes;
        }

        return success(result) as APIResponse<any>;
      } catch (err) {
        const errorMessage = (err as Error).message;
        let errorCode: ActionErrorCode = 'UNKNOWN_ERROR';

        if (errorMessage.includes('not found')) {
          errorCode = 'ELEMENT_NOT_FOUND';
        } else if (errorMessage.includes('timeout')) {
          errorCode = 'ACTION_TIMEOUT';
        } else if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
          errorCode = 'NETWORK_ERROR';
        }

        const failureDetails = createFailureDetails(errorCode, errorMessage, {
          elementId: id,
          durationMs: Date.now() - startTime,
        });

        return {
          success: false,
          error: errorMessage,
          code: errorCode,
          data: {
            success: false,
            error: errorMessage,
            failureDetails,
            durationMs: Date.now() - startTime,
            timestamp: Date.now(),
          },
          timestamp: Date.now(),
        } as APIResponse<any>;
      }
    },

    executeBatchAction: async (
      request: BatchActionRequest
    ): Promise<APIResponse<BatchActionResponse>> => {
      try {
        if (!request?.steps || !Array.isArray(request.steps) || request.steps.length === 0) {
          return error('Batch request must include a non-empty "steps" array', 'VALIDATION_ERROR');
        }

        if (actionExecutor.executeBatch) {
          const result = await actionExecutor.executeBatch(request);
          return success(result);
        }

        // Fallback: execute steps sequentially if executor doesn't support native batch
        const startTime = performance.now();
        const results: BatchActionResponse['results'] = [];
        let succeededCount = 0;
        let failedCount = 0;
        let skippedCount = 0;
        let stopped = false;
        const stopOnFailure = request.stopOnFailure ?? true;
        const delayBetweenMs = request.delayBetweenMs ?? 0;

        for (let i = 0; i < request.steps.length; i++) {
          if (stopped) {
            skippedCount++;
            continue;
          }

          const step = request.steps[i];
          if (i > 0 && delayBetweenMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, delayBetweenMs));
          }

          refreshElements();
          const response = await actionExecutor.executeAction(step.elementId, step.action);
          results.push({
            index: i,
            label: step.label,
            elementId: step.elementId,
            response: response as any,
          });

          if ((response as any).success) {
            succeededCount++;
          } else {
            failedCount++;
            if (stopOnFailure) stopped = true;
          }
        }

        return success({
          success: failedCount === 0,
          results,
          succeededCount,
          failedCount,
          skippedCount,
          durationMs: performance.now() - startTime,
          timestamp: Date.now(),
        });
      } catch (err) {
        return error((err as Error).message, 'BATCH_ACTION_ERROR');
      }
    },

    // =========================================================================
    // Component Handlers
    // =========================================================================

    getComponents: async (): Promise<APIResponse<ControlSnapshot['components']>> => {
      try {
        const components = registry.getAllComponents().map(annotateComponentWithInvocationPaths);
        return success(components as ControlSnapshot['components']);
      } catch (err) {
        return error((err as Error).message, 'COMPONENTS_ERROR');
      }
    },

    getComponent: async (id: string): Promise<APIResponse<ControlSnapshot['components'][0]>> => {
      try {
        const component = registry.getComponent(id);
        if (!component) {
          return error(`Component not found: ${id}`, 'NOT_FOUND');
        }
        return success(
          annotateComponentWithInvocationPaths(component) as ControlSnapshot['components'][0]
        );
      } catch (err) {
        return error((err as Error).message, 'COMPONENT_ERROR');
      }
    },

    getComponentState: async (
      id: string
    ): Promise<
      APIResponse<{
        state: Record<string, unknown>;
        computed: Record<string, unknown>;
        timestamp: number;
      }>
    > => {
      try {
        // First check if the component exists
        const component = registry.getComponent(id);
        if (!component) {
          return error(`Component not found: ${id}`, 'NOT_FOUND');
        }

        // Use registry's getComponentState if available
        if (registry.getComponentState) {
          const stateResponse = registry.getComponentState(id);
          if (!stateResponse) {
            return error(`Component not found or not mounted: ${id}`, 'NOT_FOUND');
          }
          return success(stateResponse);
        }

        // Fallback: component exists but doesn't expose state
        const comp = component as {
          getState?: () => Record<string, unknown>;
          getComputed?: () => Record<string, unknown>;
        };
        return success({
          state: comp.getState?.() ?? {},
          computed: comp.getComputed?.() ?? {},
          timestamp: Date.now(),
        });
      } catch (err) {
        return error((err as Error).message, 'COMPONENT_STATE_ERROR');
      }
    },

    executeComponentAction: async (
      id: string,
      request: { action: string; params?: Record<string, unknown> }
    ) => {
      try {
        const result = await actionExecutor.executeComponentAction(id, {
          action: request.action,
          params: request.params,
        });
        return success(result) as APIResponse<any>;
      } catch (err) {
        return error((err as Error).message, 'COMPONENT_ACTION_ERROR');
      }
    },

    // =========================================================================
    // Find/Discovery Handlers
    // =========================================================================

    find: async (request?: unknown) => {
      try {
        const findRequest = request as FindRequest | undefined;
        if (!findRequest?.skipSettle) {
          await awaitDOMSettled(findRequest?.settleTimeout);
        }
        let elements = registry.findElements?.(findRequest) ?? registry.getAllElements();

        // Always apply filters — registry.findElements may not handle all filter types
        if (findRequest) {
          elements = applyFindFilters(elements as any[], findRequest) as unknown[];
        }

        // DOM fallback: when registry returns 0 elements, scan the DOM directly
        if ((elements as unknown[]).length === 0) {
          const domElements = scanDOMForInteractiveElements();
          if (domElements.length > 0) {
            elements = findRequest
              ? (applyFindFilters(domElements as any[], findRequest) as unknown[])
              : domElements;
          }
        }

        return success({
          elements: materializeElements(elements as unknown[]),
          timestamp: Date.now(),
          total: (elements as unknown[]).length,
          durationMs: 0,
        }) as APIResponse<any>;
      } catch (err) {
        return error((err as Error).message, 'FIND_ERROR');
      }
    },

    getElementImages: async (_request?: Record<string, unknown>) => {
      // This handler is a stub for direct-mode (non-relay) usage.
      // In relay mode, the command goes to the browser via commandHandlers.ts.
      // In direct mode, we scan the registry but can't access DOM img elements.
      return success({
        images: [],
        total: 0,
        note: 'Use relay mode for DOM image scanning',
      }) as APIResponse<any>;
    },

    discover: async (request?: unknown) => {
      // Deprecated, delegates to find
      try {
        const findRequest = request as FindRequest | undefined;
        if (!findRequest?.skipSettle) {
          await awaitDOMSettled(findRequest?.settleTimeout);
        }
        let elements = registry.findElements?.(findRequest) ?? registry.getAllElements();

        // Always apply filters — registry.findElements may not handle all filter types
        if (findRequest) {
          elements = applyFindFilters(elements as any[], findRequest) as unknown[];
        }

        // DOM fallback: when registry returns 0 elements, scan the DOM directly
        if ((elements as unknown[]).length === 0) {
          const domElements = scanDOMForInteractiveElements();
          if (domElements.length > 0) {
            elements = findRequest
              ? (applyFindFilters(domElements as any[], findRequest) as unknown[])
              : domElements;
          }
        }

        return success({
          elements: materializeElements(elements as unknown[]),
          timestamp: Date.now(),
          total: (elements as unknown[]).length,
          durationMs: 0,
        }) as APIResponse<any>;
      } catch (err) {
        return error((err as Error).message, 'DISCOVER_ERROR');
      }
    },

    getControlSnapshot: async (request?: {
      targetTabId?: string;
      url?: string;
      skipSettle?: boolean | string;
      settleTimeout?: number | string;
      /**
       * Item 1: when true, filter `kind: "content"` entries out of the
       * snapshot's `elements` array. Default false — new semantic content
       * entries are returned by default so authors get richer snapshots
       * without changing any caller code. GET query params arrive as
       * strings, so accept `'true'` alongside a real boolean.
       */
      interactiveOnly?: boolean | string;
      /** snake_case alias for interactiveOnly (match find/discover). */
      interactive_only?: boolean | string;
    }): Promise<APIResponse<ControlSnapshot>> => {
      try {
        // GET query params arrive as strings from standalone server
        const shouldSkip = request?.skipSettle === true || request?.skipSettle === 'true';
        if (!shouldSkip) {
          const timeout =
            typeof request?.settleTimeout === 'string'
              ? parseInt(request.settleTimeout, 10) || undefined
              : request?.settleTimeout;
          await awaitDOMSettled(timeout);
        }
        const snapshot = registry.createSnapshot();
        // Item 1: `?interactiveOnly=true` is an opt-in filter that drops
        // every `kind: "content"` entry — useful for legacy callers that
        // walk `elements` expecting actionable items. Default (absent or
        // `false`) keeps content entries in so new tests can assert on
        // card/badge text alongside interactive elements.
        const wantInteractiveOnly =
          request?.interactiveOnly === true ||
          request?.interactiveOnly === 'true' ||
          request?.interactive_only === true ||
          request?.interactive_only === 'true';
        if (wantInteractiveOnly) {
          snapshot.elements = snapshot.elements.filter(
            (e: unknown) => (e as { kind?: string }).kind !== 'content'
          );
        }

        // Fix snapshot/discover discrepancy: createSnapshot() sometimes returns
        // an empty elements[] field even when registry.getAllElements() has
        // entries (observed during rapid navigation when the snapshot's
        // internal serialization lags behind registration events). Fall back
        // to getAllElements() before the DOM scan so callers get a
        // registry-consistent view that matches discover()'s output.
        if (snapshot.elements.length === 0) {
          const registryElements = registry.getAllElements();
          if (registryElements.length > 0) {
            snapshot.elements = materializeElements(registryElements);
          }
        }

        // DOM fallback: when both the snapshot and registry have no elements,
        // populate from a live DOM scan.
        if (snapshot.elements.length === 0) {
          const domElements = scanDOMForInteractiveElements();
          if (domElements.length > 0) {
            snapshot.elements = domElements as any[];
          }
        }

        // Enrich snapshot with error summary if capture is available
        if (consoleCapture) {
          const thirtySecondsAgo = Date.now() - 30_000;
          const recentErrors = consoleCapture.getConsoleSince(thirtySecondsAgo);
          const errorCount = recentErrors.filter(
            (e) => e.level === 'error' || e.level === 'unhandledrejection'
          ).length;
          const warningCount = recentErrors.filter((e) => e.level === 'warn').length;

          // Find most critical recent error
          const criticalError = recentErrors.find(
            (e) => e.level === 'error' || e.level === 'unhandledrejection'
          );

          // Detect framework error overlays (Next.js, Vite, React error boundary)
          const errorOverlays = hasFullEventAPI(consoleCapture)
            ? (consoleCapture.getFrameworkOverlays?.() ?? [])
            : [];
          const hasVisibleOverlay = errorOverlays.length > 0;

          snapshot.errorSummary = {
            errorCount,
            warningCount,
            mostRecentError: criticalError
              ? {
                  message: criticalError.message,
                  timestamp: criticalError.timestamp,
                  sourceLocation: extractSourceLocation(criticalError.stack),
                }
              : undefined,
            health: hasVisibleOverlay
              ? 'broken'
              : errorCount === 0
                ? 'healthy'
                : errorCount <= 2 && !recentErrors.some((e) => e.level === 'unhandledrejection')
                  ? 'degraded'
                  : 'broken',
            errorOverlays: hasVisibleOverlay ? errorOverlays : undefined,
          };
        }

        // Enrich snapshot with page/route context
        if (navigationTracker) {
          snapshot.page = navigationTracker.getSnapshotPageContext();
        }
        // Fallback: always include basic page context from window.location
        if (!snapshot.page) {
          snapshot.page = {
            url: window.location.href,
            title: document.title,
            pathname: window.location.pathname,
            search: window.location.search,
            hash: window.location.hash,
            recentNavigations: [],
          };
        }

        // Enrich snapshot with keyboard shortcuts if shortcut tracker is available
        if (shortcutTracker) {
          snapshot.shortcuts = shortcutTracker.getSnapshotShortcutContext();
        }

        // Enrich snapshot with modal/dialog stack if detector is available
        if (modalDetector) {
          snapshot.modalStack = modalDetector.getSnapshotModalContext();
        }

        // Enrich snapshot with toast/notification state if capture is available
        if (toastCapture) {
          snapshot.toasts = toastCapture.getSnapshotToastContext();
        }

        // Enrich snapshot with element relationships if tracker is available
        if (relationshipTracker) {
          const allElements = registry.getAllElements() as Array<{ id: string; element: Element }>;
          const elementPairs = allElements.map((el) => ({
            id: el.id,
            element: el.element,
          }));
          snapshot.relationships = relationshipTracker.getSnapshotRelationshipContext(elementPairs);
        }

        // Enrich snapshot with drag source and drop zone discovery if detector is available
        if (dragDropDetector) {
          const allElementsForDnD = registry.getAllElements() as Array<{
            id: string;
            element: Element;
          }>;
          const elementPairsForDnD = allElementsForDnD.map((el) => ({
            id: el.id,
            element: el.element,
          }));
          snapshot.dragDrop = dragDropDetector.getSnapshotDragDropContext(elementPairsForDnD);
        }

        // Enrich snapshot with undo/redo awareness if tracker is available
        if (undoTracker) {
          snapshot.undoRedo = undoTracker.getSnapshotUndoContext();
        }

        // Enrich snapshot with viewport/scroll context
        if (typeof window !== 'undefined') {
          const docEl = document.documentElement;
          snapshot.viewport = {
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            scrollX: window.scrollX,
            scrollY: window.scrollY,
            documentWidth: docEl.scrollWidth,
            documentHeight: docEl.scrollHeight,
            canScrollDown: window.scrollY + window.innerHeight < docEl.scrollHeight - 1,
            canScrollRight: window.scrollX + window.innerWidth < docEl.scrollWidth - 1,
          };
        }

        return success(snapshot);
      } catch (err) {
        return error((err as Error).message, 'SNAPSHOT_ERROR');
      }
    },

    // =========================================================================
    // Workflow Handlers
    // =========================================================================

    getWorkflows: async (): Promise<APIResponse<ControlSnapshot['workflows']>> => {
      try {
        const workflows = registry.getAllWorkflows?.() ?? [];
        return success(workflows as ControlSnapshot['workflows']);
      } catch (err) {
        return error((err as Error).message, 'WORKFLOWS_ERROR');
      }
    },

    runWorkflow: async (id: string, request?: unknown) => {
      try {
        // Soft check — the runner has its own workflow database,
        // so a missing registry entry is not a blocker.
        const workflow = registry.getWorkflow?.(id);
        if (!workflow) {
          console.warn(
            `[handlers] Workflow "${id}" not in local registry — proxying to runner anyway`
          );
        }

        // Proxy to runner's unified workflow execution engine
        const runnerPort = 9876;
        const req = (request && typeof request === 'object' ? request : {}) as Record<
          string,
          unknown
        >;
        const body = {
          force_fresh_start: req.forceFreshStart ?? req.force_fresh_start ?? false,
          task_run_id: req.taskRunId ?? req.task_run_id,
          monitor_index: req.monitorIndex ?? req.monitor_index,
        };

        const response = await fetch(
          `http://127.0.0.1:${runnerPort}/unified-workflows/${encodeURIComponent(id)}/run`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }
        );

        const result = await response.json();

        if (!response.ok || result.success === false) {
          return error(result.error || `Runner returned ${response.status}`, 'WORKFLOW_ERROR');
        }

        const data = result.data || result;
        return success({
          runId: data.task_run_id || data.execution_id || `run-${Date.now()}`,
          workflowId: id,
          status: 'running' as const,
          startedAt: Date.now(),
          steps: [],
          totalSteps: 0,
        }) as APIResponse<any>;
      } catch (err) {
        return error((err as Error).message, 'WORKFLOW_ERROR');
      }
    },

    getWorkflowStatus: async (runId: string) => {
      try {
        // Proxy to runner's task run status
        const runnerPort = 9876;
        const response = await fetch(
          `http://127.0.0.1:${runnerPort}/task-runs/${encodeURIComponent(runId)}`
        );

        const result = await response.json();

        if (!response.ok || result.success === false) {
          return error(
            result.error || `Runner returned ${response.status}`,
            'WORKFLOW_STATUS_ERROR'
          );
        }

        const data = result.data || result;
        const statusMap: Record<string, string> = {
          in_progress: 'running',
          running: 'running',
          completed: 'completed',
          success: 'completed',
          failed: 'failed',
          error: 'failed',
          cancelled: 'cancelled',
          stopped: 'cancelled',
        };

        return success({
          runId,
          workflowId: data.workflow_id || data.workflowId || '',
          status: (statusMap[data.status] || 'pending') as any,
          steps: data.steps || [],
          totalSteps: data.total_steps || data.totalSteps || 0,
          currentStep: data.current_step || data.currentStep,
          startedAt: data.created_at ? new Date(data.created_at).getTime() : Date.now(),
          completedAt: data.completed_at ? new Date(data.completed_at).getTime() : undefined,
          durationMs: data.duration_ms || data.durationMs,
          success: ['completed', 'success', 'failed', 'error', 'cancelled', 'stopped'].includes(
            data.status
          )
            ? data.status === 'completed' || data.status === 'success'
            : undefined,
          error: data.error,
        }) as APIResponse<any>;
      } catch (err) {
        return error((err as Error).message, 'WORKFLOW_STATUS_ERROR');
      }
    },

    // =========================================================================
    // Debug Handlers
    // =========================================================================

    getActionHistory: async (limit?: number): Promise<APIResponse<unknown[]>> => {
      try {
        const history = registry.getActionHistory?.() ?? [];
        const limited = limit ? history.slice(-limit) : history;
        return success(limited);
      } catch (err) {
        return error((err as Error).message, 'ACTION_HISTORY_ERROR');
      }
    },

    getMetrics: async (): Promise<APIResponse<unknown>> => {
      try {
        const metrics = registry.getMetrics?.() ?? {
          elementCount: registry.getAllElements().length,
          componentCount: registry.getAllComponents().length,
        };
        return success(metrics);
      } catch (err) {
        return error((err as Error).message, 'METRICS_ERROR');
      }
    },

    highlightElement: async (id: string): Promise<APIResponse<void>> => {
      try {
        registry.highlightElement?.(id);
        return success(undefined);
      } catch (err) {
        return error((err as Error).message, 'HIGHLIGHT_ERROR');
      }
    },

    getElementTree: async (): Promise<APIResponse<unknown>> => {
      try {
        const tree = registry.getElementTree?.() ?? { root: null, elements: [] };
        return success(tree);
      } catch (err) {
        return error((err as Error).message, 'ELEMENT_TREE_ERROR');
      }
    },

    getConsoleErrors: async (params?: {
      since?: number;
      sinceId?: number;
      limit?: number;
      group?: boolean;
      groupBy?: 'fingerprint' | 'message' | 'source';
    }): Promise<
      APIResponse<
        | {
            errors: CapturedError[];
            count: number;
            nextSinceId?: number;
            droppedCount?: number;
            bufferedCount?: number;
          }
        | { groups: unknown[]; totalErrors: number; totalGroups: number }
      >
    > => {
      try {
        if (!consoleCapture) {
          if (params?.group) {
            return success({ groups: [], totalErrors: 0, totalGroups: 0 });
          }
          return success({
            errors: [],
            count: 0,
            nextSinceId: typeof params?.sinceId === 'number' ? params.sinceId : 0,
            droppedCount: 0,
            bufferedCount: 0,
          });
        }

        // Cursor path — `sinceId` takes precedence over the legacy `since`
        // timestamp filter. The cursor variant returns the richer
        // ConsoleRecentResponse shape, which we surface additively so
        // existing callers that ignore the new fields keep working.
        if (typeof params?.sinceId === 'number' || !params?.group) {
          const hasNewApi =
            consoleCapture &&
            typeof (consoleCapture as { getConsoleRecent?: unknown }).getConsoleRecent ===
              'function';

          if (
            typeof params?.sinceId === 'number' &&
            hasNewApi &&
            // The new signature accepts an options object — detect by trying it.
            // The legacy numeric signature just returns CapturedError[], which
            // we'd also detect via Array.isArray below.
            true
          ) {
            const response = (
              consoleCapture as unknown as {
                getConsoleRecent: (opts: { sinceId?: number; limit?: number }) => {
                  errors: CapturedError[];
                  nextSinceId: number;
                  droppedCount: number;
                  bufferedCount: number;
                };
              }
            ).getConsoleRecent({
              sinceId: params.sinceId,
              limit: params.limit,
            });
            if (response && !Array.isArray(response) && 'errors' in response) {
              if (!params?.group) {
                return success({
                  errors: response.errors,
                  count: response.errors.length,
                  nextSinceId: response.nextSinceId,
                  droppedCount: response.droppedCount,
                  bufferedCount: response.bufferedCount,
                });
              }
            }
          }
        }

        const errors = params?.since
          ? consoleCapture.getConsoleSince(params.since)
          : consoleCapture.getConsoleRecent(params?.limit ?? 50);

        if (!params?.group) {
          // Attempt to surface buffer stats additively. The new BrowserEventCapture
          // exposes these via a one-arg-object getConsoleRecent; fall back to the
          // legacy shape (no stats) when the capture source doesn't support it.
          let nextSinceId: number | undefined;
          let droppedCount: number | undefined;
          let bufferedCount: number | undefined;
          try {
            const maybe = (
              consoleCapture as unknown as {
                getConsoleRecent?: (opts: unknown) => unknown;
              }
            ).getConsoleRecent?.({
              sinceId: 0,
              limit: params?.limit ?? 50,
            });
            if (
              maybe &&
              typeof maybe === 'object' &&
              !Array.isArray(maybe) &&
              'errors' in (maybe as Record<string, unknown>)
            ) {
              const m = maybe as {
                nextSinceId?: number;
                droppedCount?: number;
                bufferedCount?: number;
              };
              nextSinceId = m.nextSinceId;
              droppedCount = m.droppedCount;
              bufferedCount = m.bufferedCount;
            }
          } catch {
            /* ignore — legacy capture shape */
          }

          return success({
            errors,
            count: errors.length,
            ...(nextSinceId !== undefined ? { nextSinceId } : {}),
            ...(droppedCount !== undefined ? { droppedCount } : {}),
            ...(bufferedCount !== undefined ? { bufferedCount } : {}),
          });
        }

        // Grouped mode: delegate to the relay/IPC which handles grouping
        // For direct (non-relay) mode, do grouping here
        const groupBy = params.groupBy ?? 'fingerprint';
        const { computeFingerprint: fp, extractSourceLocation: extractSrc } =
          await import('../debug/error-fingerprint');
        const { getEventStack: getStack } = await import('../debug/shared-utils');

        // Get raw events for grouping (consoleCapture may be full BrowserEventCapture)
        let rawEvents: AnyCapturedEvent[] = [];
        if (hasFullEventAPI(consoleCapture)) {
          rawEvents = (
            params.since
              ? consoleCapture.getSince(params.since)
              : consoleCapture.getRecent((params.limit ?? 50) * 10)
          ).filter((e: AnyCapturedEvent) => e.type === 'console' || e.type === 'hmr');
        }

        if (rawEvents.length === 0) {
          // Fallback: return errors as single-item groups
          const groups = errors.map((e) => ({
            fingerprint: `msg:${e.message}`,
            count: 1,
            firstSeen: e.timestamp,
            lastSeen: e.timestamp,
            level: e.level,
            message: e.message,
            source: undefined as string | undefined,
            sample: e,
          }));
          return success({ groups, totalErrors: errors.length, totalGroups: groups.length });
        }

        const groupMap = new Map<
          string,
          {
            fingerprint: string;
            count: number;
            firstSeen: number;
            lastSeen: number;
            level: string;
            message: string;
            source: string | undefined;
            sample: unknown;
          }
        >();
        const order: string[] = [];

        for (const event of rawEvents) {
          let key: string;
          if (groupBy === 'message') {
            key = `msg:${(event as { message?: string }).message ?? ''}`;
          } else if (groupBy === 'source') {
            key = `src:${extractSrc(getStack(event)) ?? 'unknown'}`;
          } else {
            key = fp(event);
          }

          const existing = groupMap.get(key);
          if (existing) {
            existing.count += 1;
            existing.lastSeen = event.timestamp;
          } else {
            const msg = (event as { message?: string }).message ?? '';
            const lvl =
              event.type === 'hmr'
                ? (event as { level: string }).level === 'warning'
                  ? 'warn'
                  : (event as { level: string }).level
                : (event as { level: string }).level;
            const src = extractSrc(getStack(event));
            groupMap.set(key, {
              fingerprint: key,
              count: 1,
              firstSeen: event.timestamp,
              lastSeen: event.timestamp,
              level: lvl,
              message: msg,
              source: src,
              sample: {
                timestamp: event.timestamp,
                level: lvl,
                message: msg,
                stack: (event as { stack?: string }).stack,
              },
            });
            order.push(key);
          }
        }

        const groups = order.map((k) => groupMap.get(k)!);
        return success({ groups, totalErrors: rawEvents.length, totalGroups: groups.length });
      } catch (err) {
        return error((err as Error).message, 'CONSOLE_ERRORS_ERROR');
      }
    },

    clearConsoleErrors: async (): Promise<APIResponse<{ cleared: boolean }>> => {
      try {
        if (!consoleCapture) {
          return success({ cleared: false });
        }
        consoleCapture.clear();
        return success({ cleared: true });
      } catch (err) {
        return error((err as Error).message, 'CONSOLE_CLEAR_ERROR');
      }
    },

    // =========================================================================
    // AI-Native Handlers
    // =========================================================================

    aiSearch: async (criteria: SearchCriteria): Promise<APIResponse<SearchResponse>> => {
      try {
        // Refresh elements before search
        refreshElements();
        // Support callers that pass { query: "..." } instead of structured SearchCriteria.
        // Map the query field to text so the search engine can match against it.
        const resolved: SearchCriteria = { ...criteria };
        if (!resolved.text && (criteria as any).query) {
          resolved.text = (criteria as any).query;
          if (resolved.fuzzy === undefined) {
            resolved.fuzzy = true;
          }
        }
        const response = searchEngine.search(resolved);
        return success(response);
      } catch (err) {
        return error((err as Error).message, 'AI_SEARCH_ERROR');
      }
    },

    aiFind: async (request: {
      query: string;
      context?: FindContext;
      confidenceThreshold?: number;
    }): Promise<APIResponse<FindResult>> => {
      try {
        // Refresh elements before search
        refreshElements();

        // Build context, auto-detecting active modal if not provided
        const context: FindContext = { ...request.context };
        if (!context.activeModalId && modalDetector) {
          try {
            const modalStack = modalDetector.detect();
            if (modalStack.modals.length > 0) {
              const topModal = modalStack.modals[modalStack.modals.length - 1];
              context.activeModalId = topModal.id;
            }
          } catch {
            // Modal detection failed — proceed without modal context
          }
        }

        const result = find(request.query, searchEngine, {
          context,
          confidenceThreshold: request.confidenceThreshold,
          pickFirst: true,
        });

        return success(result);
      } catch (err) {
        return error((err as Error).message, 'AI_FIND_ERROR');
      }
    },

    aiExecute: async (request: NLActionRequest): Promise<APIResponse<NLActionResponse>> => {
      try {
        // Refresh elements before execution
        refreshElements();

        // If withDiff requested, use change tracker for integrated diffing
        if ((request as any).withDiff) {
          const diffResult = await changeTracker.executeWithDiff({
            instruction: request.instruction,
            settleTimeout: (request as any).settleTimeout,
            settleMinStable: (request as any).settleMinStable,
            scope: (request as any).scope,
            categorize: true,
            summaryBudget: (request as any).summaryBudget,
            analyzeStructured: (request as any).analyzeStructured,
          });

          // Merge NL action response with diff result
          const nlResult = diffResult.actionResult as NLActionResponse;
          return success({
            ...nlResult,
            diff: diffResult.diff,
            categorized: diffResult.categorized,
            budgetSummary: diffResult.budgetSummary,
            structuredChanges: diffResult.structuredChanges,
            settleTimedOut: diffResult.settleTimedOut,
            timeline: diffResult.timeline,
          } as any);
        }

        const result = await nlExecutor.execute(request);
        return success(result);
      } catch (err) {
        return error((err as Error).message, 'AI_EXECUTE_ERROR');
      }
    },

    aiAssert: async (
      request: AssertionRequest & { assertion?: string }
    ): Promise<APIResponse<AssertionResult>> => {
      try {
        // Refresh elements before assertion
        refreshElements();
        // Support natural language assertions: {assertion: "a button exists"} → {target, type}
        const normalized = parseNLAssertion(request);
        const result = await assertionExecutor.assert(normalized);
        return success(result);
      } catch (err) {
        return error((err as Error).message, 'AI_ASSERT_ERROR');
      }
    },

    aiAssertBatch: async (
      request: BatchAssertionRequest & { assertions?: (AssertionRequest | string)[] }
    ): Promise<APIResponse<BatchAssertionResult>> => {
      try {
        // Refresh elements before batch assertion
        refreshElements();
        const normalized = normalizeBatchAssertions(request);
        const result = await assertionExecutor.assertBatch(normalized);
        return success(result);
      } catch (err) {
        return error((err as Error).message, 'AI_ASSERT_BATCH_ERROR');
      }
    },

    getSemanticSnapshot: async (options?: {
      includeForms?: string | boolean;
    }): Promise<APIResponse<SemanticSnapshot>> => {
      try {
        const controlSnapshot = registry.createSnapshot();
        const wantForms = options?.includeForms === true || options?.includeForms === 'true';
        const formsResponse = wantForms
          ? discoverForms(registry.getAllElements() as FormDiscoveryElement[])
          : undefined;
        const snapshot = snapshotManager.createSnapshot(controlSnapshot, undefined, formsResponse);

        // Enrich with network activity if network monitoring is enabled
        if (networkTracker) {
          const inFlight = networkTracker.getInFlight();
          const failures = networkTracker.getCompleted({ failuresOnly: true, limit: 10 });
          const now = Date.now();

          snapshot.networkActivity = {
            inFlightCount: inFlight.length,
            inFlightRequests: inFlight.map((e) => ({
              url: e.request.url,
              method: e.request.method,
              durationMs: now - e.request.startedAt,
            })),
            recentFailures: failures.map((e) => ({
              url: e.request.url,
              method: e.request.method,
              statusCode: e.response?.statusCode ?? 0,
              durationMs: e.response?.durationMs ?? 0,
              error: e.error,
            })),
            recentFailureCount: failures.length,
          };
        }

        return success(snapshot);
      } catch (err) {
        return error((err as Error).message, 'SEMANTIC_SNAPSHOT_ERROR');
      }
    },

    getSemanticDiff: async (_since?: number): Promise<APIResponse<SemanticDiff | null>> => {
      try {
        // Create current snapshot
        const controlSnapshot = registry.createSnapshot();
        const currentSnapshot = snapshotManager.createSnapshot(controlSnapshot);

        // Update the diff manager and get the diff from previous state
        const diff = diffManager.update(currentSnapshot);
        return success(diff);
      } catch (err) {
        return error((err as Error).message, 'SEMANTIC_DIFF_ERROR');
      }
    },

    getPageSummary: async (): Promise<APIResponse<string>> => {
      try {
        const snapshot = registry.createSnapshot();
        let elements = snapshot.elements.map((el) => ({
          ...el,
          description: el.label || el.id,
          aliases: [],
          suggestedActions: [],
          tagName: el.type,
          accessibleName: el.label,
          registered: true,
        })) as any[];

        // DOM fallback: when registry has no elements, scan the DOM
        if (elements.length === 0) {
          const domElements = scanDOMForInteractiveElements();
          elements = domElements.map((el) => ({
            ...el,
            description: el.label || el.id,
            aliases: [],
            suggestedActions: el.actions.map((a: string) => ({ action: a })),
            accessibleName: el.label,
            registered: false,
          })) as any[];
        }

        const summary = generatePageSummary(elements);
        return success(summary);
      } catch (err) {
        return error((err as Error).message, 'PAGE_SUMMARY_ERROR');
      }
    },

    // =========================================================================
    // App-Agnostic Convenience Endpoints
    // =========================================================================

    clickByText: async (request: {
      text: string;
      tag?: string;
      exact?: boolean;
    }): Promise<APIResponse<{ clicked: boolean; element?: unknown }>> => {
      try {
        if (!request.text?.trim()) {
          return error('text is required and must not be empty', 'INVALID_PARAMS');
        }
        const matches = findElementsByText(request.text, {
          tag: request.tag,
          exact: request.exact,
        });
        if (matches.length === 0) {
          return error(`No element found with text "${request.text}"`, 'ELEMENT_NOT_FOUND');
        }
        const el = matches[0];
        el.click();
        return success({
          clicked: true,
          element: {
            tag: el.tagName.toLowerCase(),
            text: el.textContent?.trim().slice(0, 200) ?? '',
            rect: el.getBoundingClientRect(),
          },
        });
      } catch (err) {
        return error((err as Error).message, 'CLICK_BY_TEXT_ERROR');
      }
    },

    clickBySelector: async (request: {
      selector: string;
      index?: number;
    }): Promise<APIResponse<{ clicked: boolean; element?: unknown }>> => {
      try {
        if (!request.selector?.trim()) {
          return error('selector is required and must not be empty', 'INVALID_PARAMS');
        }
        const el = findElementBySelector(request.selector, request.index);
        if (!el) {
          return error(`No element found for selector "${request.selector}"`, 'ELEMENT_NOT_FOUND');
        }
        el.click();
        return success({
          clicked: true,
          element: {
            tag: el.tagName.toLowerCase(),
            text: el.textContent?.trim().slice(0, 200) ?? '',
            rect: el.getBoundingClientRect(),
          },
        });
      } catch (err) {
        return error((err as Error).message, 'CLICK_BY_SELECTOR_ERROR');
      }
    },

    typeInto: async (request: {
      selector?: string;
      label?: string;
      text: string;
      clear?: boolean;
    }): Promise<APIResponse<{ typed: boolean; element?: unknown }>> => {
      try {
        if (!request.label && !request.selector) {
          return error('Either label or selector is required', 'INVALID_PARAMS');
        }
        let el: HTMLElement | null = null;
        if (request.label) {
          el = findElementByLabel(request.label);
        } else if (request.selector) {
          el = findElementBySelector(request.selector);
        }
        if (!el) {
          return error(
            `No input found for ${request.label ? 'label "' + request.label + '"' : 'selector "' + request.selector + '"'}`,
            'ELEMENT_NOT_FOUND'
          );
        }
        el.focus();
        if (request.clear) {
          if ('value' in el) {
            (el as HTMLInputElement).value = '';
          } else {
            el.textContent = '';
          }
        }
        if ('value' in el) {
          (el as HTMLInputElement).value += request.text;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (el.isContentEditable) {
          document.execCommand('insertText', false, request.text);
        }
        return success({
          typed: true,
          element: {
            tag: el.tagName.toLowerCase(),
            value: 'value' in el ? (el as HTMLInputElement).value : el.textContent,
          },
        });
      } catch (err) {
        return error((err as Error).message, 'TYPE_INTO_ERROR');
      }
    },

    readValue: async (request: {
      selector: string;
      index?: number;
    }): Promise<APIResponse<{ value: string | null; length: number }>> => {
      try {
        if (!request.selector?.trim()) {
          return error('selector is required and must not be empty', 'INVALID_PARAMS');
        }
        const el = findElementBySelector(request.selector, request.index);
        if (!el) {
          return error(`No element found for selector "${request.selector}"`, 'ELEMENT_NOT_FOUND');
        }
        const value = 'value' in el ? (el as HTMLInputElement).value : (el.textContent ?? null);
        return success({
          value,
          length: value?.length ?? 0,
        });
      } catch (err) {
        return error((err as Error).message, 'READ_VALUE_ERROR');
      }
    },

    findByText: async (request: {
      text: string;
      tag?: string;
      exact?: boolean;
    }): Promise<
      APIResponse<
        Array<{
          index: number;
          tag: string;
          text: string;
          rect: { x: number; y: number; width: number; height: number };
          disabled: boolean;
          visible: boolean;
        }>
      >
    > => {
      try {
        if (!request.text?.trim()) {
          return error('text is required and must not be empty', 'INVALID_PARAMS');
        }
        const matches = findElementsByText(request.text, {
          tag: request.tag,
          exact: request.exact,
        });
        const results = matches.map((el, i) => {
          const rect = el.getBoundingClientRect();
          return {
            index: i,
            tag: el.tagName.toLowerCase(),
            text: el.textContent?.trim().slice(0, 200) ?? '',
            rect: {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            },
            disabled: 'disabled' in el ? !!(el as HTMLButtonElement).disabled : false,
            visible: el.offsetParent !== null || getComputedStyle(el).position === 'fixed',
          };
        });
        return success(results);
      } catch (err) {
        return error((err as Error).message, 'FIND_BY_TEXT_ERROR');
      }
    },

    // =========================================================================
    // Diagnostics Endpoint
    // =========================================================================

    getDiagnostics: async (): Promise<
      APIResponse<{
        sdk_initialized: boolean;
        auto_register_active: boolean;
        registered_elements: number;
        dom_interactive_elements: number;
        mutation_observer_active: boolean;
        navigation_adapter: string;
        page_title: string;
        page_url: string;
        page_ready: boolean;
        providers_mounted: string[];
        last_discover_at: string | null;
        capabilities: string[];
      }>
    > => {
      try {
        const registeredCount = registry.getAllElements().length;
        const domCount = countDOMInteractiveElements();
        const globalBridge = typeof window !== 'undefined' ? (window as any).__UI_BRIDGE__ : null;

        return success({
          sdk_initialized: !!globalBridge,
          auto_register_active: !!globalBridge?.autoRegisterActive,
          registered_elements: registeredCount,
          dom_interactive_elements: domCount,
          mutation_observer_active: !!globalBridge?.mutationObserverActive,
          navigation_adapter: config.navigationAdapter ? 'custom' : 'window-location',
          page_title: typeof document !== 'undefined' ? document.title : '',
          page_url: typeof window !== 'undefined' ? window.location.href : '',
          page_ready: typeof document !== 'undefined' ? document.readyState === 'complete' : false,
          providers_mounted: globalBridge?.providers ?? [],
          last_discover_at: null,
          capabilities: [
            'control',
            'find',
            'ai',
            ...(config.consoleCapture ? ['debug'] : []),
            ...(config.navigationTracker ? ['navigation'] : []),
            ...(config.navigationAdapter ? ['navigation-adapter'] : []),
          ],
        });
      } catch (err) {
        return error((err as Error).message, 'DIAGNOSTICS_ERROR');
      }
    },

    // =========================================================================
    // Navigation Adapter Endpoints
    // =========================================================================

    getRoutes: async (): Promise<APIResponse<Array<{ name: string; path: string }>>> => {
      try {
        const routes = navAdapter.getRoutes();
        return success(routes);
      } catch (err) {
        return error((err as Error).message, 'GET_ROUTES_ERROR');
      }
    },

    navigateByAdapter: async (request: {
      page: string;
    }): Promise<APIResponse<{ navigated: boolean; route: { name: string; path: string } }>> => {
      try {
        await navAdapter.navigate(request.page);
        const current = navAdapter.getCurrentRoute();
        return success({ navigated: true, route: current });
      } catch (err) {
        return error((err as Error).message, 'NAVIGATE_ERROR');
      }
    },

    // =========================================================================
    // Change Tracking Handlers
    // =========================================================================

    executeWithDiff: async (
      request: ActionWithDiffRequest
    ): Promise<APIResponse<ActionDiffResult>> => {
      try {
        refreshElements();
        const result = await changeTracker.executeWithDiff(request);
        return success(result);
      } catch (err) {
        return error((err as Error).message, 'EXECUTE_WITH_DIFF_ERROR');
      }
    },

    waitForChange: async (request: {
      predicate: ChangePredicate;
      options?: WaitForChangeOptions;
    }): Promise<APIResponse<SemanticDiff>> => {
      try {
        refreshElements();
        const diff = await changeTracker.waitForChange(request.predicate, request.options);
        return success(diff);
      } catch (err) {
        return error((err as Error).message, 'WAIT_FOR_CHANGE_ERROR');
      }
    },

    categorizeLastDiff: async (): Promise<APIResponse<CategorizedDiff | null>> => {
      try {
        const result = changeTracker.categorizeLastDiff();
        return success(result);
      } catch (err) {
        return error((err as Error).message, 'CATEGORIZE_DIFF_ERROR');
      }
    },

    getScopedDiff: async (request: {
      scope: string;
      fromBookmark?: string;
    }): Promise<APIResponse<SemanticDiff | null>> => {
      try {
        if (request.fromBookmark) {
          const diff = changeTracker.scopedDiffFromBookmark(request.fromBookmark, request.scope);
          return success(diff);
        }

        // Scoped diff from last state (use diffManager's last snapshot)
        refreshElements();
        const controlSnapshot = registry.createSnapshot();
        const currentSnapshot = snapshotManager.createSnapshot(controlSnapshot);
        const lastSnapshot = diffManager.getLastSnapshot();
        if (!lastSnapshot) {
          return success(null);
        }
        const diff = changeTracker.computeScopedDiff(lastSnapshot, currentSnapshot, request.scope);
        return success(diff);
      } catch (err) {
        return error((err as Error).message, 'SCOPED_DIFF_ERROR');
      }
    },

    summarizeDiff: async (request: {
      budget: number;
      includeIds?: boolean;
      includeCategory?: boolean;
      fromBookmark?: string;
    }): Promise<APIResponse<{ summary: string }>> => {
      try {
        if (!request.budget || request.budget < 1) {
          return error('Budget must be a positive number', 'VALIDATION_ERROR');
        }

        let diff: SemanticDiff | null = null;

        if (request.fromBookmark) {
          diff = changeTracker.diffFromBookmark(request.fromBookmark);
          if (!diff) return error(`Bookmark not found: ${request.fromBookmark}`, 'NOT_FOUND');
        } else {
          diff = changeTracker.categorizeLastDiff()?.diff ?? null;
          if (!diff)
            return error(
              'No diff available. Execute an action or diff from a bookmark first.',
              'NO_DIFF'
            );
        }

        const summary = changeTracker.summarizeDiff(diff, {
          budget: request.budget,
          includeIds: request.includeIds,
          includeCategory: request.includeCategory,
        });
        return success({ summary });
      } catch (err) {
        return error((err as Error).message, 'SUMMARIZE_DIFF_ERROR');
      }
    },

    analyzeStructuredChanges: async (request: {
      fromBookmark?: string;
    }): Promise<APIResponse<StructuredChangeAnalysis>> => {
      try {
        let beforeSnapshot: SemanticSnapshot;
        let afterSnapshot: SemanticSnapshot;

        if (request?.fromBookmark) {
          const bookmark = changeTracker.getBookmark(request.fromBookmark);
          if (!bookmark) return error(`Bookmark not found: ${request.fromBookmark}`, 'NOT_FOUND');
          beforeSnapshot = bookmark.snapshot;

          refreshElements();
          const controlSnapshot = registry.createSnapshot();
          afterSnapshot = snapshotManager.createSnapshot(controlSnapshot);
        } else {
          // Use diffManager's last snapshot as "before" and current as "after"
          const lastSnapshot = diffManager.getLastSnapshot();
          if (!lastSnapshot) {
            return error(
              'No previous snapshot available. Save a bookmark or take a snapshot first.',
              'NO_SNAPSHOT'
            );
          }
          beforeSnapshot = lastSnapshot;

          refreshElements();
          const controlSnapshot = registry.createSnapshot();
          afterSnapshot = snapshotManager.createSnapshot(controlSnapshot);
        }

        const result = analyzeStructuredChanges(beforeSnapshot, afterSnapshot);
        return success(result);
      } catch (err) {
        return error((err as Error).message, 'STRUCTURED_CHANGES_ERROR');
      }
    },

    // =========================================================================
    // Change Buffer Handlers
    // =========================================================================

    enableChangeBuffer: async (): Promise<APIResponse<{ enabled: boolean }>> => {
      try {
        await changeTracker.enableBuffer();
        return success({ enabled: true });
      } catch (err) {
        return error((err as Error).message, 'CHANGE_BUFFER_ERROR');
      }
    },

    disableChangeBuffer: async (): Promise<APIResponse<{ enabled: boolean }>> => {
      try {
        changeTracker.disableBuffer();
        return success({ enabled: false });
      } catch (err) {
        return error((err as Error).message, 'CHANGE_BUFFER_ERROR');
      }
    },

    drainChangeBuffer: async (): Promise<APIResponse<ChangeBufferDrainResult>> => {
      try {
        const result = changeTracker.drainBuffer();
        return success(result);
      } catch (err) {
        return error((err as Error).message, 'CHANGE_BUFFER_ERROR');
      }
    },

    getChangeBufferSize: async (): Promise<APIResponse<{ size: number; enabled: boolean }>> => {
      try {
        return success({
          size: changeTracker.getBufferSize(),
          enabled: changeTracker.isBufferEnabled(),
        });
      } catch (err) {
        return error((err as Error).message, 'CHANGE_BUFFER_ERROR');
      }
    },

    // =========================================================================
    // Snapshot Bookmark Handlers
    // =========================================================================

    saveBookmark: async (request: { name: string }): Promise<APIResponse<SnapshotBookmark>> => {
      try {
        if (!request.name) {
          return error('Bookmark name is required', 'VALIDATION_ERROR');
        }
        const bookmark = changeTracker.saveBookmark(request.name);
        return success(bookmark);
      } catch (err) {
        return error((err as Error).message, 'BOOKMARK_ERROR');
      }
    },

    getBookmark: async (name: string): Promise<APIResponse<SnapshotBookmark>> => {
      try {
        const bookmark = changeTracker.getBookmark(name);
        if (!bookmark) {
          return error(`Bookmark not found: ${name}`, 'NOT_FOUND');
        }
        return success(bookmark);
      } catch (err) {
        return error((err as Error).message, 'BOOKMARK_ERROR');
      }
    },

    deleteBookmark: async (name: string): Promise<APIResponse<{ deleted: boolean }>> => {
      try {
        const deleted = changeTracker.deleteBookmark(name);
        return success({ deleted });
      } catch (err) {
        return error((err as Error).message, 'BOOKMARK_ERROR');
      }
    },

    listBookmarks: async (): Promise<APIResponse<string[]>> => {
      try {
        return success(changeTracker.listBookmarks());
      } catch (err) {
        return error((err as Error).message, 'BOOKMARK_ERROR');
      }
    },

    diffFromBookmark: async (name: string): Promise<APIResponse<SemanticDiff | null>> => {
      try {
        const diff = changeTracker.diffFromBookmark(name);
        if (diff === null && !changeTracker.getBookmark(name)) {
          return error(`Bookmark not found: ${name}`, 'NOT_FOUND');
        }
        return success(diff);
      } catch (err) {
        return error((err as Error).message, 'BOOKMARK_ERROR');
      }
    },

    // =========================================================================
    // Semantic Search Handler (Embedding-based)
    // =========================================================================

    // =========================================================================
    // Page Navigation Handlers
    // =========================================================================

    pageRefresh: async (): Promise<APIResponse<PageNavigationResponse>> => {
      try {
        window.location.reload();
        return success({ success: true, url: window.location.href, timestamp: Date.now() });
      } catch (err) {
        return error((err as Error).message, 'PAGE_REFRESH_ERROR');
      }
    },

    pageNavigate: async (
      request: PageNavigateRequest
    ): Promise<APIResponse<PageNavigationResponse>> => {
      try {
        if (!request.url) {
          return error('URL is required', 'INVALID_REQUEST');
        }
        // F1: optional `mode` ("hard" | "soft"). Default: "hard" for back-compat.
        const rawMode = request.mode;
        if (rawMode !== undefined && rawMode !== 'hard' && rawMode !== 'soft') {
          return error(`invalid mode: "${rawMode}" (expected "hard" or "soft")`, 'INVALID_REQUEST');
        }
        const mode: 'hard' | 'soft' = rawMode ?? 'hard';

        // Validate URL scheme to prevent javascript:/data: injection
        try {
          const parsed = new URL(request.url, window.location.origin);
          if (!['http:', 'https:'].includes(parsed.protocol) && !request.url.startsWith('/')) {
            return error(
              'Invalid URL protocol — only http/https and relative paths allowed',
              'INVALID_REQUEST'
            );
          }
        } catch {
          // Relative URLs like "/foo" won't parse without a base — they're safe
          if (!request.url.startsWith('/')) {
            return error('Invalid URL format', 'INVALID_REQUEST');
          }
        }

        if (mode === 'soft') {
          // SPA-friendly navigation: pushState + synthetic popstate event so
          // React Router v6 picks up the change without a full reload. This
          // preserves injected test state (fetch patches, `window.__*` globals).
          let pathname = request.url;
          try {
            const target = new URL(request.url, window.location.origin);
            if (target.origin === window.location.origin) {
              pathname = target.pathname + target.search + target.hash;
            }
          } catch {
            // Relative URL — use as-is.
          }
          window.history.pushState(null, '', pathname);
          try {
            window.dispatchEvent(new PopStateEvent('popstate'));
          } catch {
            window.dispatchEvent(new Event('popstate'));
          }
          window.dispatchEvent(
            new CustomEvent('ui-bridge:navigate', { detail: { url: pathname, mode: 'soft' } })
          );
          return success({
            success: true,
            url: pathname,
            hard: false,
            mode: 'soft',
            timestamp: Date.now(),
          });
        }

        // Hard mode: legacy path.
        // Dispatch ui-bridge-navigate event for apps with tab-based navigation (e.g., runner)
        // This allows navigating by tab ID (e.g., "activity-timeline") in addition to URLs
        window.dispatchEvent(
          new CustomEvent('ui-bridge-navigate', {
            detail: { page: request.url, url: request.url },
          })
        );

        // Only perform location.href navigation for actual URLs (not tab IDs)
        if (request.url.startsWith('/') || request.url.startsWith('http')) {
          window.location.href = request.url;
        }
        return success({
          success: true,
          url: request.url,
          hard: true,
          mode: 'hard',
          timestamp: Date.now(),
        });
      } catch (err) {
        return error((err as Error).message, 'PAGE_NAVIGATE_ERROR');
      }
    },

    pageGoBack: async (): Promise<APIResponse<PageNavigationResponse>> => {
      try {
        window.history.back();
        return success({ success: true, url: window.location.href, timestamp: Date.now() });
      } catch (err) {
        return error((err as Error).message, 'PAGE_GO_BACK_ERROR');
      }
    },

    pageGoForward: async (): Promise<APIResponse<PageNavigationResponse>> => {
      try {
        window.history.forward();
        return success({ success: true, url: window.location.href, timestamp: Date.now() });
      } catch (err) {
        return error((err as Error).message, 'PAGE_GO_FORWARD_ERROR');
      }
    },

    // =========================================================================
    // Annotation Handlers
    //
    // REST API endpoints for managing element annotations:
    //   GET    /annotations           - List all annotations
    //   GET    /annotations/export    - Export all annotations as AnnotationConfig
    //   GET    /annotations/coverage  - Get annotation coverage statistics
    //   GET    /annotations/:id       - Get annotation for a specific element
    //   PUT    /annotations/:id       - Create or update an annotation
    //   DELETE /annotations/:id       - Delete an annotation
    //   POST   /annotations/import    - Import annotations from AnnotationConfig
    // =========================================================================

    getAnnotations: async (): Promise<APIResponse<Record<string, ElementAnnotation>>> => {
      try {
        return success(annotationStore.getAll());
      } catch (err) {
        return error((err as Error).message, 'ANNOTATIONS_ERROR');
      }
    },

    getAnnotation: async (id: string): Promise<APIResponse<ElementAnnotation>> => {
      try {
        const annotation = annotationStore.get(id);
        if (!annotation) {
          return error(`Annotation not found: ${id}`, 'NOT_FOUND');
        }
        return success(annotation);
      } catch (err) {
        return error((err as Error).message, 'ANNOTATION_ERROR');
      }
    },

    setAnnotation: async (
      id: string,
      annotation: ElementAnnotation
    ): Promise<APIResponse<ElementAnnotation>> => {
      try {
        annotationStore.set(id, annotation);
        return success(annotationStore.get(id)!);
      } catch (err) {
        return error((err as Error).message, 'ANNOTATION_SET_ERROR');
      }
    },

    deleteAnnotation: async (id: string): Promise<APIResponse<void>> => {
      try {
        const existed = annotationStore.delete(id);
        if (!existed) {
          return error(`Annotation not found: ${id}`, 'NOT_FOUND');
        }
        return success(undefined);
      } catch (err) {
        return error((err as Error).message, 'ANNOTATION_DELETE_ERROR');
      }
    },

    importAnnotations: async (
      config: AnnotationConfig
    ): Promise<APIResponse<{ count: number }>> => {
      try {
        const count = annotationStore.importConfig(config);
        return success({ count });
      } catch (err) {
        return error((err as Error).message, 'ANNOTATION_IMPORT_ERROR');
      }
    },

    exportAnnotations: async (): Promise<APIResponse<AnnotationConfig>> => {
      try {
        return success(annotationStore.exportConfig());
      } catch (err) {
        return error((err as Error).message, 'ANNOTATION_EXPORT_ERROR');
      }
    },

    getAnnotationCoverage: async (): Promise<APIResponse<AnnotationCoverage>> => {
      try {
        const allElements = registry.getAllElements() as Array<{ id: string }>;
        const allIds = allElements.map((el) => el.id);
        return success(annotationStore.getCoverage(allIds));
      } catch (err) {
        return error((err as Error).message, 'ANNOTATION_COVERAGE_ERROR');
      }
    },

    aiSemanticSearch: async (
      criteria: SemanticSearchCriteria
    ): Promise<APIResponse<SemanticSearchResponse>> => {
      const startTime = performance.now();
      try {
        // Refresh elements for search
        refreshElements();

        // Get all elements
        const allElements = registry.getAllElements() as any[];

        // Convert to AI discovered elements for semantic search
        const aiElements: Array<{ element: AIDiscoveredElement; text: string }> = allElements.map(
          (el) => {
            // Build searchable text from element properties
            const textParts: string[] = [];

            // Prioritize description and accessible name for semantic matching
            const state = 'getState' in el ? (el as any).getState() : el.state;
            const textContent = state?.textContent || '';
            const label = el.label || '';
            const accessibleName = el.accessibleName || '';
            const placeholder = el.placeholder || '';
            const title = el.title || '';

            if (label) textParts.push(label);
            if (accessibleName && accessibleName !== label) textParts.push(accessibleName);
            if (textContent && textContent !== label && textContent !== accessibleName) {
              textParts.push(textContent);
            }
            if (placeholder) textParts.push(`placeholder: ${placeholder}`);
            if (title) textParts.push(title);

            const combinedText = textParts.join(' ').trim() || el.id;

            return {
              element: {
                id: el.id,
                type: el.type,
                label: el.label,
                tagName: el.tagName || el.type,
                role: el.role,
                accessibleName: el.accessibleName,
                actions: el.actions || [],
                state: state || {},
                registered: true,
                description: label || el.id,
                aliases: [],
                suggestedActions: [],
              } as AIDiscoveredElement,
              text: combinedText,
            };
          }
        );

        // Apply type/role filters if specified
        let filteredElements = aiElements;
        if (criteria.type) {
          filteredElements = filteredElements.filter(
            ({ element }) => element.type.toLowerCase() === criteria.type!.toLowerCase()
          );
        }
        if (criteria.role) {
          filteredElements = filteredElements.filter(
            ({ element }) => element.role?.toLowerCase() === criteria.role!.toLowerCase()
          );
        }

        // NOTE: Semantic search with embeddings requires server-side embedding support.
        // This handler provides the API structure. Actual embedding computation
        // should be delegated to the qontinui library or a separate embedding service.
        //
        // For now, we fall back to fuzzy text matching as a placeholder.
        // In production, this would call the qontinui embeddings module.

        const query = criteria.query.toLowerCase();
        const threshold = criteria.threshold ?? 0.5;
        const limit = criteria.limit ?? 10;

        // Simple text similarity as fallback (to be replaced with embedding similarity)
        const scoredResults: SemanticSearchResult[] = filteredElements.map(({ element, text }) => {
          // Calculate basic text similarity
          const textLower = text.toLowerCase();
          let similarity = 0;

          // Exact match
          if (textLower.includes(query)) {
            similarity = 0.9;
          } else {
            // Word overlap similarity
            const queryWords = new Set(query.split(/\s+/).filter((w: string) => w.length > 2));
            const textWords = new Set(textLower.split(/\s+/).filter((w: string) => w.length > 2));

            if (queryWords.size > 0 && textWords.size > 0) {
              let matchCount = 0;
              for (const word of queryWords) {
                for (const textWord of textWords) {
                  if (textWord.includes(word) || word.includes(textWord)) {
                    matchCount++;
                    break;
                  }
                }
              }
              similarity = (matchCount / queryWords.size) * 0.7;
            }
          }

          return {
            element,
            similarity,
            rank: 0, // Will be set after sorting
            embeddedText: text,
          };
        });

        // Filter by threshold and sort by similarity
        const filteredResults = scoredResults
          .filter((r) => r.similarity >= threshold)
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, limit);

        // Set ranks
        filteredResults.forEach((result, index) => {
          result.rank = index + 1;
        });

        const response: SemanticSearchResponse = {
          results: filteredResults,
          bestMatch: filteredResults.length > 0 ? filteredResults[0] : null,
          scannedCount: filteredElements.length,
          durationMs: performance.now() - startTime,
          query: criteria.query,
          providerInfo: {
            provider: 'text-fallback',
            model: 'simple-similarity',
            dimension: 0,
          },
          timestamp: Date.now(),
        };

        return success(response);
      } catch (err) {
        return error((err as Error).message, 'AI_SEMANTIC_SEARCH_ERROR');
      }
    },

    // =========================================================================
    // State Management Handlers
    // =========================================================================

    getStates: async (): Promise<APIResponse<UIState[]>> => {
      try {
        const states = registry.getStates?.() ?? [];
        return success(states);
      } catch (err) {
        return error((err as Error).message, 'STATES_ERROR');
      }
    },

    getState: async (id: string): Promise<APIResponse<UIState>> => {
      try {
        const state = registry.getState?.(id);
        if (!state) {
          return error(`State not found: ${id}`, 'NOT_FOUND');
        }
        return success(state);
      } catch (err) {
        return error((err as Error).message, 'STATE_ERROR');
      }
    },

    getActiveStates: async (): Promise<APIResponse<UIState[]>> => {
      try {
        const states = registry.getActiveStates?.() ?? [];
        return success(states);
      } catch (err) {
        return error((err as Error).message, 'ACTIVE_STATES_ERROR');
      }
    },

    activateState: async (id: string): Promise<APIResponse<void>> => {
      try {
        if (!registry.activateState) {
          return error('State management not available', 'NOT_IMPLEMENTED');
        }
        registry.activateState(id);
        return success(undefined);
      } catch (err) {
        return error((err as Error).message, 'ACTIVATE_STATE_ERROR');
      }
    },

    deactivateState: async (id: string): Promise<APIResponse<void>> => {
      try {
        if (!registry.deactivateState) {
          return error('State management not available', 'NOT_IMPLEMENTED');
        }
        registry.deactivateState(id);
        return success(undefined);
      } catch (err) {
        return error((err as Error).message, 'DEACTIVATE_STATE_ERROR');
      }
    },

    getStateGroups: async (): Promise<APIResponse<UIStateGroup[]>> => {
      try {
        const groups = registry.getStateGroups?.() ?? [];
        return success(groups);
      } catch (err) {
        return error((err as Error).message, 'STATE_GROUPS_ERROR');
      }
    },

    activateStateGroup: async (id: string): Promise<APIResponse<void>> => {
      try {
        if (!registry.activateStateGroup) {
          return error('State group management not available', 'NOT_IMPLEMENTED');
        }
        registry.activateStateGroup(id);
        return success(undefined);
      } catch (err) {
        return error((err as Error).message, 'ACTIVATE_STATE_GROUP_ERROR');
      }
    },

    deactivateStateGroup: async (id: string): Promise<APIResponse<void>> => {
      try {
        if (!registry.deactivateStateGroup) {
          return error('State group management not available', 'NOT_IMPLEMENTED');
        }
        registry.deactivateStateGroup(id);
        return success(undefined);
      } catch (err) {
        return error((err as Error).message, 'DEACTIVATE_STATE_GROUP_ERROR');
      }
    },

    getTransitions: async (): Promise<APIResponse<UITransition[]>> => {
      try {
        const transitions = registry.getTransitions?.() ?? [];
        return success(transitions);
      } catch (err) {
        return error((err as Error).message, 'TRANSITIONS_ERROR');
      }
    },

    canExecuteTransition: async (
      id: string
    ): Promise<APIResponse<{ canExecute: boolean; reason?: string }>> => {
      try {
        if (!registry.canExecuteTransition) {
          return error('Transition management not available', 'NOT_IMPLEMENTED');
        }
        const result = registry.canExecuteTransition(id);
        return success(result);
      } catch (err) {
        return error((err as Error).message, 'CAN_EXECUTE_TRANSITION_ERROR');
      }
    },

    executeTransition: async (id: string): Promise<APIResponse<TransitionResult>> => {
      try {
        if (!registry.executeTransition) {
          return error('Transition execution not available', 'NOT_IMPLEMENTED');
        }
        const result = await registry.executeTransition(id);
        return success(result);
      } catch (err) {
        return error((err as Error).message, 'EXECUTE_TRANSITION_ERROR');
      }
    },

    findPath: async (request: { targetStates: string[] }): Promise<APIResponse<PathResult>> => {
      try {
        if (!registry.findPath) {
          return error('Pathfinding not available', 'NOT_IMPLEMENTED');
        }
        const result = registry.findPath(request.targetStates);
        return success(result);
      } catch (err) {
        return error((err as Error).message, 'FIND_PATH_ERROR');
      }
    },

    navigateTo: async (request: {
      targetStates: string[];
    }): Promise<APIResponse<NavigationResult>> => {
      try {
        if (!registry.navigateTo) {
          return error('Navigation not available', 'NOT_IMPLEMENTED');
        }
        const result = await registry.navigateTo(request.targetStates);
        return success(result);
      } catch (err) {
        return error((err as Error).message, 'NAVIGATE_TO_ERROR');
      }
    },

    getStateSnapshot: async (): Promise<APIResponse<StateSnapshot>> => {
      try {
        if (!registry.getStateSnapshot) {
          // Fallback: build from available data
          const snapshot: StateSnapshot = {
            timestamp: Date.now(),
            activeStates: (registry.getActiveStates?.() ?? []).map((s) => s.id),
            states: registry.getStates?.() ?? [],
            groups: registry.getStateGroups?.() ?? [],
            transitions: registry.getTransitions?.() ?? [],
          };
          return success(snapshot);
        }
        return success(registry.getStateSnapshot());
      } catch (err) {
        return error((err as Error).message, 'STATE_SNAPSHOT_ERROR');
      }
    },

    // =========================================================================
    // Intent Handlers
    // =========================================================================

    executeIntent: async (request: {
      intentId: string;
      params?: Record<string, unknown>;
    }): Promise<APIResponse<IntentExecutionResult>> => {
      const startTime = Date.now();
      try {
        refreshElements();
        const intent = intentRegistry.get(request.intentId);
        if (!intent) {
          return error(`Intent not found: ${request.intentId}`, 'NOT_FOUND');
        }
        // Execute via NL executor using intent description as instruction
        const nlResponse = await nlExecutor.execute({
          instruction: intent.description,
          context: `Executing intent: ${intent.name}`,
        });
        return success({
          success: nlResponse.success,
          intentId: request.intentId,
          result: nlResponse,
          error: nlResponse.error,
          durationMs: Date.now() - startTime,
        });
      } catch (err) {
        return error((err as Error).message, 'EXECUTE_INTENT_ERROR');
      }
    },

    findIntent: async (request: { query: string }): Promise<APIResponse<IntentSearchResponse>> => {
      try {
        const query = request.query.toLowerCase();
        const results: Array<{ intent: Intent; confidence: number }> = [];

        for (const intent of intentRegistry.values()) {
          let confidence = 0;
          const nameLower = intent.name.toLowerCase();
          const descLower = intent.description.toLowerCase();

          if (nameLower === query) {
            confidence = 1.0;
          } else if (nameLower.includes(query) || query.includes(nameLower)) {
            confidence = 0.8;
          } else if (descLower.includes(query)) {
            confidence = 0.6;
          } else if (intent.tags?.some((t) => t.toLowerCase().includes(query))) {
            confidence = 0.5;
          }

          if (confidence > 0) {
            results.push({ intent, confidence });
          }
        }

        results.sort((a, b) => b.confidence - a.confidence);
        return success({ intents: results });
      } catch (err) {
        return error((err as Error).message, 'FIND_INTENT_ERROR');
      }
    },

    listIntents: async (): Promise<APIResponse<Intent[]>> => {
      try {
        return success(Array.from(intentRegistry.values()));
      } catch (err) {
        return error((err as Error).message, 'LIST_INTENTS_ERROR');
      }
    },

    registerIntent: async (intent: Intent): Promise<APIResponse<Intent>> => {
      try {
        intentRegistry.set(intent.id, intent);
        return success(intent);
      } catch (err) {
        return error((err as Error).message, 'REGISTER_INTENT_ERROR');
      }
    },

    deleteIntent: async (name: string): Promise<APIResponse<{ deleted: boolean }>> => {
      try {
        // Search by name or id
        let found = false;
        for (const [id, intent] of intentRegistry.entries()) {
          if (intent.name === name || id === name) {
            intentRegistry.delete(id);
            found = true;
            break;
          }
        }
        return success({ deleted: found });
      } catch (err) {
        return error((err as Error).message, 'DELETE_INTENT_ERROR');
      }
    },

    executeIntentFromQuery: async (request: {
      query: string;
      params?: Record<string, unknown>;
    }): Promise<APIResponse<IntentExecutionResult>> => {
      const startTime = Date.now();
      try {
        refreshElements();
        // Find best matching intent
        const query = request.query.toLowerCase();
        let bestIntent: Intent | null = null;
        let bestConfidence = 0;

        for (const intent of intentRegistry.values()) {
          let confidence = 0;
          const nameLower = intent.name.toLowerCase();
          const descLower = intent.description.toLowerCase();

          if (nameLower === query) {
            confidence = 1.0;
          } else if (nameLower.includes(query) || query.includes(nameLower)) {
            confidence = 0.8;
          } else if (descLower.includes(query)) {
            confidence = 0.6;
          }

          if (confidence > bestConfidence) {
            bestConfidence = confidence;
            bestIntent = intent;
          }
        }

        if (!bestIntent) {
          return success({
            success: false,
            intentId: '',
            error: `No intent found matching query: ${request.query}`,
            durationMs: Date.now() - startTime,
          });
        }

        const nlResponse = await nlExecutor.execute({
          instruction: bestIntent.description,
          context: `Executing intent from query: ${request.query}`,
        });

        return success({
          success: nlResponse.success,
          intentId: bestIntent.id,
          result: nlResponse,
          error: nlResponse.error,
          durationMs: Date.now() - startTime,
        });
      } catch (err) {
        return error((err as Error).message, 'EXECUTE_INTENT_FROM_QUERY_ERROR');
      }
    },

    // =========================================================================
    // Recovery Handler
    // =========================================================================

    attemptRecovery: async (
      request: RecoveryAttemptRequest
    ): Promise<APIResponse<RecoveryAttemptResult>> => {
      const startTime = Date.now();
      try {
        refreshElements();
        const strategiesAttempted: string[] = [];
        let lastResult: NLActionResponse | undefined;

        // Try recovery strategies based on the failure info
        const suggestions = request.failure.suggestedActions ?? [];

        for (let i = 0; i < Math.min(suggestions.length, request.maxRetries); i++) {
          const suggestion = suggestions[i];
          strategiesAttempted.push(suggestion.suggestion || `strategy-${i}`);

          // If the suggestion has a command, try executing it
          const instruction = suggestion.command || request.instruction;
          try {
            const result = await nlExecutor.execute({
              instruction,
              context: `Recovery attempt ${i + 1}: ${suggestion.suggestion}`,
            });
            lastResult = result;

            if (result.success) {
              return success({
                recovered: true,
                strategiesAttempted,
                finalResult: result,
                durationMs: Date.now() - startTime,
              });
            }
          } catch {
            // Continue to next strategy
          }
        }

        // If no suggestions or all failed, try the instruction directly
        if (strategiesAttempted.length === 0 || !lastResult?.success) {
          strategiesAttempted.push('direct-instruction');
          try {
            const result = await nlExecutor.execute({
              instruction: request.instruction,
              context: 'Recovery: direct instruction attempt',
            });
            lastResult = result;

            if (result.success) {
              return success({
                recovered: true,
                strategiesAttempted,
                finalResult: result,
                durationMs: Date.now() - startTime,
              });
            }
          } catch {
            // Fall through to failure
          }
        }

        return success({
          recovered: false,
          strategiesAttempted,
          finalResult: lastResult,
          error: 'All recovery strategies exhausted',
          durationMs: Date.now() - startTime,
        });
      } catch (err) {
        return error((err as Error).message, 'RECOVERY_ERROR');
      }
    },

    // =========================================================================
    // Cross-App Analysis Handlers
    // =========================================================================

    analyzePageData: async (): Promise<APIResponse<PageDataMap>> => {
      try {
        const controlSnapshot = registry.createSnapshot();
        const snapshot = snapshotManager.createSnapshot(controlSnapshot);
        const result = extractPageData(snapshot.elements);
        return success(result);
      } catch (err) {
        return error((err as Error).message, 'ANALYZE_DATA_ERROR');
      }
    },

    analyzePageRegions: async (): Promise<APIResponse<PageRegionMap>> => {
      try {
        const controlSnapshot = registry.createSnapshot();
        const snapshot = snapshotManager.createSnapshot(controlSnapshot);
        const result = segmentPageRegions(snapshot.elements);
        return success(result);
      } catch (err) {
        return error((err as Error).message, 'ANALYZE_REGIONS_ERROR');
      }
    },

    analyzeStructuredData: async (): Promise<APIResponse<StructuredDataExtraction>> => {
      try {
        const controlSnapshot = registry.createSnapshot();
        const snapshot = snapshotManager.createSnapshot(controlSnapshot);
        const result = extractStructuredData(snapshot.elements);
        return success(result);
      } catch (err) {
        return error((err as Error).message, 'ANALYZE_STRUCTURED_DATA_ERROR');
      }
    },

    crossAppCompare: async (request: {
      sourceSnapshot: SemanticSnapshot;
      targetSnapshot: SemanticSnapshot;
      sourceComponents?: ComponentInfo[];
      targetComponents?: ComponentInfo[];
    }): Promise<APIResponse<CrossAppComparisonReport>> => {
      try {
        const hasComponents = request.sourceComponents && request.targetComponents;
        const report = generateComparisonReport(
          request.sourceSnapshot,
          request.targetSnapshot,
          hasComponents
            ? {
                config: { includeComponents: true },
                sourceComponents: request.sourceComponents,
                targetComponents: request.targetComponents,
              }
            : undefined
        );
        return success(report);
      } catch (err) {
        return error((err as Error).message, 'CROSS_APP_COMPARE_ERROR');
      }
    },

    // =========================================================================
    // Performance Diagnostics Handlers
    // =========================================================================

    getPerformanceEntries: async (): Promise<APIResponse<unknown>> => {
      // Performance entries are browser-only; the SDK handler returns empty data.
      // The actual implementation lives in the browser transport (useUIBridgeTransport).
      return {
        success: true,
        data: { navigation: null, resources: [], paint: [] },
        timestamp: Date.now(),
      };
    },

    clearPerformanceEntries: async (): Promise<APIResponse<{ cleared: boolean }>> => {
      return { success: true, data: { cleared: true }, timestamp: Date.now() };
    },

    getBrowserEvents: async (params?: {
      type?: string;
      since?: number;
      limit?: number;
      severity?: string;
      deduplicate?: boolean;
    }): Promise<APIResponse<BrowserEventsResponse>> => {
      try {
        if (!hasFullEventAPI(consoleCapture)) {
          // Fallback: legacy ConsoleCapturelike only has console errors
          if (consoleCapture) {
            const errors = params?.since
              ? consoleCapture.getConsoleSince(params.since)
              : consoleCapture.getConsoleRecent(params?.limit ?? 50);
            return success({ events: errors, count: errors.length });
          }
          return success({ events: [], count: 0 });
        }

        // Full browser event API available
        let events: AnyCapturedEvent[];
        if (params?.type) {
          events = consoleCapture.getByType(params.type as BrowserEventType);
          if (params.since) {
            events = events.filter((e) => e.timestamp >= params.since!);
          }
        } else if (params?.since) {
          events = consoleCapture.getSince(params.since);
        } else {
          events = consoleCapture.getRecent(params?.limit ?? 100);
        }

        // Apply severity filter
        if (params?.severity) {
          events = filterBySeverity(events, params.severity as ErrorSeverity);
        }

        // Apply deduplication
        if (params?.deduplicate) {
          const grouped = deduplicateEvents(events);
          return success({
            events,
            count: events.length,
            deduplicated: grouped,
            uniqueCount: grouped.length,
          });
        }

        // Apply limit after filtering
        if (params?.limit && events.length > params.limit) {
          events = events.slice(-params.limit);
        }

        return success({ events, count: events.length });
      } catch (err) {
        return error((err as Error).message, 'BROWSER_EVENTS_ERROR');
      }
    },

    getTimeline: async (params?: {
      since?: number;
      limit?: number;
      minSeverity?: string;
    }): Promise<APIResponse<{ entries: TimelineEntry[]; count: number }>> => {
      try {
        if (!hasFullEventAPI(consoleCapture)) {
          return success({ entries: [], count: 0 });
        }

        const entries = timelineBuffer.getTimeline(consoleCapture, {
          since: params?.since,
          limit: params?.limit,
          minSeverity: params?.minSeverity as ErrorSeverity | undefined,
        });

        return success({ entries, count: entries.length });
      } catch (err) {
        return error((err as Error).message, 'TIMELINE_ERROR');
      }
    },

    // =========================================================================
    // Health Score Handler
    // =========================================================================

    getHealthReport: async (params?: { windowMs?: number }): Promise<APIResponse<HealthReport>> => {
      try {
        if (!hasFullEventAPI(consoleCapture)) {
          return success({
            status: 'healthy' as const,
            score: 100,
            summary: 'No event capture available',
            breakdown: { crashes: 0, errors: 0, warnings: 0 },
            errorRate: 0,
            windowMs: params?.windowMs ?? 60_000,
            timestamp: Date.now(),
          });
        }

        const report = computeHealthReport(consoleCapture, {
          windowMs: params?.windowMs,
        });

        // Factor in visible framework error overlays — any visible overlay means broken
        if (hasFullEventAPI(consoleCapture)) {
          const overlays = consoleCapture.getFrameworkOverlays?.() ?? [];
          if (overlays.length > 0) {
            report.status = 'broken';
            report.score = Math.min(report.score, 10);
            const overlayNames = overlays.map((o) => o.framework).join(', ');
            report.summary = `Broken: ${overlayNames} error overlay visible. ${report.summary}`;
          }
        }

        return success(report);
      } catch (err) {
        return error((err as Error).message, 'HEALTH_REPORT_ERROR');
      }
    },

    // =========================================================================
    // Network Chain Handlers
    // =========================================================================

    getNetworkChains: async (params?: {
      since?: number;
      limit?: number;
      failuresOnly?: boolean;
      url?: string;
    }): Promise<APIResponse<{ chains: NetworkChain[]; count: number }>> => {
      try {
        let chains: NetworkChain[];
        if (params?.failuresOnly) {
          chains = networkChainTracker.getFailures();
        } else if (params?.url) {
          chains = networkChainTracker.getByUrl(params.url);
        } else if (params?.since) {
          chains = networkChainTracker.getSince(params.since);
        } else {
          chains = networkChainTracker.getRecent(params?.limit ?? 50);
        }

        if (params?.since && !params?.failuresOnly && !params?.url) {
          // already filtered by since
        } else if (params?.since) {
          chains = chains.filter((c) => c.timestamp >= params.since!);
        }

        if (params?.limit && chains.length > params.limit) {
          chains = chains.slice(-params.limit);
        }

        // Correlate with recent console errors if capture available
        if (hasFullEventAPI(consoleCapture)) {
          const recentEvents = consoleCapture.getRecent(100);
          networkChainTracker.correlateErrors(recentEvents);
        }

        return success({ chains, count: chains.length });
      } catch (err) {
        return error((err as Error).message, 'NETWORK_CHAINS_ERROR');
      }
    },

    // =========================================================================
    // Error Session Handlers
    // =========================================================================

    startErrorSession: async (request: {
      label?: string;
    }): Promise<APIResponse<{ sessionId: string }>> => {
      try {
        const session = errorSessionManager.startSession(request.label);
        return success({ sessionId: session.id });
      } catch (err) {
        return error((err as Error).message, 'SESSION_ERROR');
      }
    },

    endErrorSession: async (): Promise<APIResponse<ErrorSessionSummary | null>> => {
      try {
        const summary = errorSessionManager.endSession();
        return success(summary);
      } catch (err) {
        return error((err as Error).message, 'SESSION_ERROR');
      }
    },

    getErrorSessions: async (): Promise<APIResponse<ErrorSessionSummary[]>> => {
      try {
        return success(errorSessionManager.getSessions());
      } catch (err) {
        return error((err as Error).message, 'SESSION_ERROR');
      }
    },

    captureErrorBaseline: async (request: {
      label: string;
    }): Promise<APIResponse<{ label: string; capturedAt: number; fingerprintCount: number }>> => {
      try {
        const label = request?.label;
        if (!label) {
          return error('Missing required "label" field in request body', 'VALIDATION_ERROR');
        }
        if (!hasFullEventAPI(consoleCapture)) {
          return error('Browser event capture not available', 'NO_CAPTURE');
        }
        const baseline = errorSessionManager.captureBaseline(label, consoleCapture);
        return success({
          label: baseline.label,
          capturedAt: baseline.capturedAt,
          fingerprintCount: baseline.fingerprints.size,
        });
      } catch (err) {
        return error((err as Error).message, 'BASELINE_ERROR');
      }
    },

    compareErrorBaseline: async (request: {
      label: string;
    }): Promise<APIResponse<BaselineComparison | null>> => {
      try {
        const label = request?.label;
        if (!label) {
          return error('Missing required "label" field in request body', 'VALIDATION_ERROR');
        }
        const comparison = errorSessionManager.compareToBaseline(
          label,
          hasFullEventAPI(consoleCapture) ? consoleCapture : undefined
        );
        if (comparison === null) {
          return error(`Baseline '${label}' not found`, 'NOT_FOUND');
        }
        return success(comparison);
      } catch (err) {
        return error((err as Error).message, 'BASELINE_ERROR');
      }
    },

    // =========================================================================
    // Error Snapshot Handlers
    // =========================================================================

    getErrorSnapshots: async (params?: {
      limit?: number;
    }): Promise<APIResponse<{ snapshots: ErrorSnapshot[]; count: number }>> => {
      try {
        const snapshots = errorSnapshotBuffer.getRecent(params?.limit ?? 10);
        return success({ snapshots, count: snapshots.length });
      } catch (err) {
        return error((err as Error).message, 'ERROR_SNAPSHOTS_ERROR');
      }
    },

    // =========================================================================
    // Composite Error Report (one-call summary)
    // =========================================================================

    getErrorReport: async (): Promise<
      APIResponse<{
        health: HealthReport;
        recentErrors: AnyCapturedEvent[];
        activeSession: ErrorSessionSummary | null;
        snapshots: ErrorSnapshot[];
      }>
    > => {
      try {
        // Health report
        const health = hasFullEventAPI(consoleCapture)
          ? computeHealthReport(consoleCapture)
          : {
              status: 'healthy' as const,
              score: 100,
              summary: 'No event capture available',
              breakdown: { crashes: 0, errors: 0, warnings: 0 },
              errorRate: 0,
              windowMs: 60_000,
              timestamp: Date.now(),
            };

        // Recent errors (last 30s, error severity or above)
        const recentErrors = hasFullEventAPI(consoleCapture)
          ? filterBySeverity(consoleCapture.getSince(Date.now() - 30_000), 'error')
          : [];

        // Active session summary
        const activeSession = errorSessionManager.getActive()?.getSummary() ?? null;

        // Recent error snapshots
        const snapshots = errorSnapshotBuffer.getRecent(5);

        return success({ health, recentErrors, activeSession, snapshots });
      } catch (err) {
        return error((err as Error).message, 'ERROR_REPORT_ERROR');
      }
    },

    // =========================================================================
    // Design Review Handlers
    // =========================================================================

    getElementStyles: async (id: string): Promise<APIResponse<ElementDesignData>> => {
      try {
        const rawElement = registry.getElement(id);
        if (!rawElement) {
          return error(`Element not found: ${id}`, 'ELEMENT_NOT_FOUND');
        }
        const el = rawElement as any;
        if (!el.element || !(el.element instanceof HTMLElement)) {
          return error('Element does not have a DOM reference', 'NO_DOM_REFERENCE');
        }
        const data = getElementDesignData(el.element, {
          elementId: el.id,
          label: el.label,
          type: el.type,
          includePseudoElements: true,
        });
        return success(data);
      } catch (err) {
        return error((err as Error).message, 'DESIGN_STYLES_ERROR');
      }
    },

    getElementStateStyles: async (
      id: string,
      request: { states?: InteractionStateName[] }
    ): Promise<APIResponse<{ elementId: string; stateStyles: StateStyles[] }>> => {
      try {
        const rawElement = registry.getElement(id);
        if (!rawElement) {
          return error(`Element not found: ${id}`, 'ELEMENT_NOT_FOUND');
        }
        const el = rawElement as any;
        if (!el.element || !(el.element instanceof HTMLElement)) {
          return error('Element does not have a DOM reference', 'NO_DOM_REFERENCE');
        }
        const stateStyles = await captureStateVariations(el.element, request.states);
        return success({ elementId: id, stateStyles });
      } catch (err) {
        return error((err as Error).message, 'DESIGN_STATE_STYLES_ERROR');
      }
    },

    getDesignSnapshot: async (request?: {
      elementIds?: string[];
      includePseudoElements?: boolean;
    }): Promise<APIResponse<{ elements: ElementDesignData[]; timestamp: number }>> => {
      try {
        const allElements = registry.getAllElements() as any[];
        const elements = request?.elementIds
          ? allElements.filter((el: any) => request.elementIds!.includes(el.id))
          : allElements;

        const designData: ElementDesignData[] = [];
        for (const el of elements) {
          if (el.element && el.element instanceof HTMLElement) {
            designData.push(
              getElementDesignData(el.element, {
                elementId: el.id,
                label: el.label,
                type: el.type,
                includePseudoElements: request?.includePseudoElements,
              })
            );
          }
        }

        return success({ elements: designData, timestamp: Date.now() });
      } catch (err) {
        return error((err as Error).message, 'DESIGN_SNAPSHOT_ERROR');
      }
    },

    getResponsiveSnapshots: async (request: {
      viewports?: Record<string, number>;
      elementIds?: string[];
    }): Promise<APIResponse<ResponsiveSnapshot[]>> => {
      try {
        const viewports = request.viewports || DEFAULT_VIEWPORTS;

        // Create a minimal registry adapter that filters by elementIds if specified
        const allElements = registry.getAllElements() as any[];
        const filteredElements = request.elementIds
          ? allElements.filter((el: any) => request.elementIds!.includes(el.id))
          : allElements;

        const registryAdapter = {
          getAllElements: () =>
            filteredElements
              .filter((el: any) => el.element instanceof HTMLElement)
              .map((el: any) => ({
                id: el.id,
                element: el.element,
                type: el.type,
                label: el.label,
              })),
        };

        const snapshots = await captureResponsiveSnapshots(registryAdapter, viewports);
        return success(snapshots);
      } catch (err) {
        return error((err as Error).message, 'RESPONSIVE_SNAPSHOT_ERROR');
      }
    },

    setViewportConstraints: async (request: {
      width?: number;
      restore?: boolean;
    }): Promise<
      APIResponse<{
        success: boolean;
        viewportWidth: number;
        constrainedWidth: number;
        timestamp: number;
      }>
    > => {
      try {
        const root = document.documentElement;
        if (request.restore) {
          root.style.removeProperty('max-width');
          root.style.removeProperty('margin');
          root.style.removeProperty('overflow-x');
        } else if (request.width && request.width > 0) {
          root.style.maxWidth = `${request.width}px`;
          root.style.margin = '0 auto';
          root.style.overflowX = 'hidden';
        }
        return success({
          success: true,
          viewportWidth: window.innerWidth,
          constrainedWidth: root.clientWidth,
          timestamp: Date.now(),
        });
      } catch (err) {
        return error((err as Error).message, 'VIEWPORT_CONSTRAINTS_ERROR');
      }
    },

    runDesignAudit: async (request?: {
      guide?: StyleGuideConfig;
      elementIds?: string[];
    }): Promise<APIResponse<StyleAuditReport>> => {
      try {
        const guide = request?.guide || loadedStyleGuide;
        if (!guide) {
          return error('No style guide loaded or provided', 'NO_STYLE_GUIDE');
        }

        const allElements = registry.getAllElements() as any[];
        const elements = request?.elementIds
          ? allElements.filter((el: any) => request.elementIds!.includes(el.id))
          : allElements;

        const designData: ElementDesignData[] = [];
        for (const el of elements) {
          if (el.element && el.element instanceof HTMLElement) {
            designData.push(
              getElementDesignData(el.element, {
                elementId: el.id,
                label: el.label,
                type: el.type,
              })
            );
          }
        }

        const report = runStyleAudit(designData, guide);
        return success(report);
      } catch (err) {
        return error((err as Error).message, 'DESIGN_AUDIT_ERROR');
      }
    },

    loadStyleGuide: async (request: {
      guide: StyleGuideConfig;
    }): Promise<APIResponse<{ loaded: boolean }>> => {
      try {
        loadedStyleGuide = request.guide;
        return success({ loaded: true });
      } catch (err) {
        return error((err as Error).message, 'LOAD_STYLE_GUIDE_ERROR');
      }
    },

    getStyleGuide: async (): Promise<APIResponse<StyleGuideConfig | null>> => {
      return success(loadedStyleGuide);
    },

    clearStyleGuide: async (): Promise<APIResponse<{ cleared: boolean }>> => {
      loadedStyleGuide = null;
      return success({ cleared: true });
    },

    // Quality evaluation endpoints

    evaluateQuality: async (
      request?: EvaluateRequest
    ): Promise<APIResponse<QualityEvaluationReport>> => {
      try {
        const allElements = registry.getAllElements() as any[];
        const elements = request?.elementIds
          ? allElements.filter((el: any) => request.elementIds!.includes(el.id))
          : allElements;

        const designData: ElementDesignData[] = [];
        for (const el of elements) {
          if (el.element && el.element instanceof HTMLElement) {
            designData.push(
              getElementDesignData(el.element, {
                elementId: el.id,
                label: el.label,
                type: el.type,
              })
            );
          }
        }

        const viewport = request?.viewport ?? {
          width: window.innerWidth,
          height: window.innerHeight,
        };

        // Resolve context: custom object > style guide context > built-in name
        let context: QualityContext | string =
          request?.customContext ?? request?.context ?? 'general';
        if (typeof context === 'string' && loadedStyleGuide?.qualityContexts?.[context]) {
          context = loadedStyleGuide.qualityContexts[context];
        }
        const report = evaluateQuality(designData, viewport, context);
        return success(report);
      } catch (err) {
        return error((err as Error).message, 'QUALITY_EVALUATION_ERROR');
      }
    },

    getQualityContexts: async (): Promise<
      APIResponse<Array<{ name: string; description: string }>>
    > => {
      return success(listContexts());
    },

    saveBaseline: async (request?: {
      label?: string;
      elementIds?: string[];
    }): Promise<APIResponse<{ saved: boolean; elementCount: number }>> => {
      try {
        const allElements = registry.getAllElements() as any[];
        const elements = request?.elementIds
          ? allElements.filter((el: any) => request.elementIds!.includes(el.id))
          : allElements;

        const designData: ElementDesignData[] = [];
        for (const el of elements) {
          if (el.element && el.element instanceof HTMLElement) {
            designData.push(
              getElementDesignData(el.element, {
                elementId: el.id,
                label: el.label,
                type: el.type,
              })
            );
          }
        }

        const viewport = {
          width: window.innerWidth,
          height: window.innerHeight,
        };

        savedBaseline = createBaseline(designData, viewport, request?.label);
        return success({ saved: true, elementCount: designData.length });
      } catch (err) {
        return error((err as Error).message, 'SAVE_BASELINE_ERROR');
      }
    },

    diffBaseline: async (request?: {
      elementIds?: string[];
    }): Promise<APIResponse<SnapshotDiffReport>> => {
      try {
        if (!savedBaseline) {
          return error('No baseline saved. Call saveBaseline first.', 'NO_BASELINE');
        }

        const allElements = registry.getAllElements() as any[];
        const elements = request?.elementIds
          ? allElements.filter((el: any) => request.elementIds!.includes(el.id))
          : allElements;

        const designData: ElementDesignData[] = [];
        for (const el of elements) {
          if (el.element && el.element instanceof HTMLElement) {
            designData.push(
              getElementDesignData(el.element, {
                elementId: el.id,
                label: el.label,
                type: el.type,
              })
            );
          }
        }

        const report = diffSnapshots(savedBaseline, designData);
        return success(report);
      } catch (err) {
        return error((err as Error).message, 'DIFF_BASELINE_ERROR');
      }
    },

    // =========================================================================
    // Form State Awareness Handlers
    // =========================================================================

    getForms: async (): Promise<APIResponse<FormsResponse>> => {
      try {
        refreshElements();
        const elements = registry.getAllElements() as FormDiscoveryElement[];
        return success<FormsResponse>(discoverForms(elements));
      } catch (err) {
        return error((err as Error).message, 'FORMS_ERROR');
      }
    },

    fillForm: async (request: FillFormRequest): Promise<APIResponse<FillResult>> => {
      try {
        if (!request?.fields || Object.keys(request.fields).length === 0) {
          return error('Request must include a non-empty "fields" map', 'VALIDATION_ERROR');
        }
        if (actionExecutor.fillForm) {
          const result = await actionExecutor.fillForm(request);
          return success<FillResult>(result);
        }
        return error('fillForm is not supported by the current action executor', 'UNSUPPORTED');
      } catch (err) {
        return error((err as Error).message, 'FILL_FORM_ERROR');
      }
    },

    snapshotForms: async (): Promise<APIResponse<FormSnapshot>> => {
      try {
        const snapshot = captureFormSnapshot();
        return success<FormSnapshot>(snapshot);
      } catch (err) {
        return error((err as Error).message, 'FORM_SNAPSHOT_ERROR');
      }
    },

    diffForms: async (request: {
      before: FormSnapshot;
      after: FormSnapshot;
    }): Promise<APIResponse<FormDiff>> => {
      try {
        if (!request.before || !request.after) {
          return error('Both "before" and "after" snapshots are required', 'INVALID_REQUEST');
        }
        const diff = diffFormSnapshots(request.before, request.after);
        return success<FormDiff>(diff);
      } catch (err) {
        return error((err as Error).message, 'FORM_DIFF_ERROR');
      }
    },

    // =========================================================================
    // Clipboard Handlers
    // =========================================================================

    getClipboard: async (): Promise<APIResponse<{ text: string | null; formats: string[] }>> => {
      try {
        if (typeof navigator === 'undefined' || !navigator.clipboard) {
          return error('Clipboard API not available in this environment', 'CLIPBOARD_UNAVAILABLE');
        }

        try {
          const perm = await navigator.permissions.query({
            name: 'clipboard-read' as PermissionName,
          });
          if (perm.state === 'denied') {
            return error('Clipboard read permission denied', 'CLIPBOARD_PERMISSION_DENIED');
          }
        } catch {
          // Permissions API may not support clipboard-read query in all browsers
        }

        const text = await navigator.clipboard.readText();
        const formats: string[] = ['text/plain'];

        return success({ text, formats });
      } catch (err) {
        return error((err as Error).message, 'CLIPBOARD_READ_ERROR');
      }
    },

    setClipboard: async (request: {
      text: string;
      html?: string;
    }): Promise<APIResponse<{ written: boolean; formats: string[] }>> => {
      try {
        if (typeof navigator === 'undefined' || !navigator.clipboard) {
          return error('Clipboard API not available in this environment', 'CLIPBOARD_UNAVAILABLE');
        }

        if (!request?.text && !request?.html) {
          return error('Request must include "text" or "html"', 'VALIDATION_ERROR');
        }

        const formats: string[] = [];

        if (request.html) {
          const items = [
            new ClipboardItem({
              'text/html': new Blob([request.html], { type: 'text/html' }),
              'text/plain': new Blob([request.text || ''], { type: 'text/plain' }),
            }),
          ];
          await navigator.clipboard.write(items);
          formats.push('text/html', 'text/plain');
        } else {
          await navigator.clipboard.writeText(request.text);
          formats.push('text/plain');
        }

        return success({ written: true, formats });
      } catch (err) {
        return error((err as Error).message, 'CLIPBOARD_WRITE_ERROR');
      }
    },

    // =========================================================================
    // Network Request Monitoring Handlers
    // =========================================================================

    getNetworkRequests: async (params) => {
      if (!networkTracker) {
        return error('Network monitoring is disabled', 'NETWORK_MONITORING_DISABLED');
      }
      const filter: NetworkRequestFilter = {};
      if (params?.status) filter.status = params.status as any;
      if (params?.method) filter.method = params.method;
      if (params?.urlPattern) filter.urlPattern = params.urlPattern;
      if (params?.failuresOnly) filter.failuresOnly = params.failuresOnly;
      if (params?.since) filter.since = params.since;
      if (params?.limit) filter.limit = params.limit;

      const requests = networkTracker.getAll(filter);
      const inFlight = networkTracker.getInFlight();
      return {
        success: true,
        data: { requests, count: requests.length, inFlightCount: inFlight.length },
        timestamp: Date.now(),
      };
    },

    getNetworkRequestsInFlight: async () => {
      if (!networkTracker) {
        return error('Network monitoring is disabled', 'NETWORK_MONITORING_DISABLED');
      }
      const requests = networkTracker.getInFlight();
      return {
        success: true,
        data: { requests, count: requests.length },
        timestamp: Date.now(),
      };
    },

    waitForNetworkRequest: async (request) => {
      if (!networkTracker) {
        return error('Network monitoring is disabled', 'NETWORK_MONITORING_DISABLED');
      }
      try {
        const result = await networkTracker.waitForRequest(request);
        return {
          success: true,
          data: result,
          timestamp: Date.now(),
        };
      } catch (err) {
        return error((err as Error).message, 'NETWORK_WAIT_ERROR');
      }
    },

    getNetworkRequest: async (id) => {
      if (!networkTracker) {
        return error('Network monitoring is disabled', 'NETWORK_MONITORING_DISABLED');
      }
      const entry = networkTracker.getById(id);
      if (!entry) {
        return {
          success: false,
          error: `Request not found: ${id}`,
          code: 'NOT_FOUND',
          timestamp: Date.now(),
        };
      }
      return {
        success: true,
        data: entry,
        timestamp: Date.now(),
      };
    },

    // =========================================================================
    // Idle Detection Handlers
    // =========================================================================

    getIdleStatus: async () => {
      if (!idleDetector) {
        return error('Idle detection is disabled', 'IDLE_DISABLED');
      }
      return success(idleDetector.getStatus());
    },

    getIdleSignalStatus: async (signal: string) => {
      if (!idleDetector) {
        return error('Idle detection is disabled', 'IDLE_DISABLED');
      }
      const status = idleDetector.getSignalStatus(signal);
      if (!status) {
        return error(
          `Signal not found: ${signal}. Available: ${idleDetector.getSignalNames().join(', ')}`,
          'SIGNAL_NOT_FOUND'
        );
      }
      return success(status);
    },

    waitForIdle: async (request?: {
      timeout?: number;
      minStableMs?: number;
      exclude?: string[];
    }) => {
      if (!idleDetector) {
        return error('Idle detection is disabled', 'IDLE_DISABLED');
      }
      try {
        const status = await idleDetector.waitForIdle({
          timeout: request?.timeout,
          minStableMs: request?.minStableMs,
          exclude: request?.exclude,
        });
        return success(status);
      } catch (err) {
        return error((err as Error).message, 'IDLE_TIMEOUT');
      }
    },

    waitForSignalIdle: async (
      signal: string,
      request?: { timeout?: number; minStableMs?: number }
    ) => {
      if (!idleDetector) {
        return error('Idle detection is disabled', 'IDLE_DISABLED');
      }
      try {
        const status = await idleDetector.waitForSignal(signal, {
          timeout: request?.timeout,
          minStableMs: request?.minStableMs,
        });
        return success(status);
      } catch (err) {
        return error((err as Error).message, 'IDLE_TIMEOUT');
      }
    },

    waitForTargets: async (request: {
      targets: Array<string | { indicator: string }>;
      timeout?: number;
      minStableMs?: number;
    }) => {
      if (!idleDetector) {
        return error('Idle detection is disabled', 'IDLE_DISABLED');
      }
      try {
        const results = await idleDetector.waitFor(request.targets, {
          timeout: request.timeout,
          minStableMs: request.minStableMs,
        });
        return success(results);
      } catch (err) {
        return error((err as Error).message, 'IDLE_TIMEOUT');
      }
    },

    // Undo/redo awareness endpoints
    getUndoState: async () => {
      if (!undoTracker) {
        return error('Undo tracking is not available', 'UNDO_UNAVAILABLE');
      }
      try {
        const state = undoTracker.getState();
        return success(state);
      } catch (err) {
        return error((err as Error).message, 'UNDO_ERROR');
      }
    },

    executeUndo: async () => {
      if (!undoTracker) {
        return error('Undo tracking is not available', 'UNDO_UNAVAILABLE');
      }
      try {
        const executed = undoTracker.executeUndo();
        return success({ executed });
      } catch (err) {
        return error((err as Error).message, 'UNDO_ERROR');
      }
    },

    executeRedo: async () => {
      if (!undoTracker) {
        return error('Undo tracking is not available', 'UNDO_UNAVAILABLE');
      }
      try {
        const executed = undoTracker.executeRedo();
        return success({ executed });
      } catch (err) {
        return error((err as Error).message, 'UNDO_ERROR');
      }
    },

    // =========================================================================
    // API Discovery
    // =========================================================================

    getCapabilities: async (): Promise<APIResponse<CapabilitiesResponse>> => {
      return {
        success: true,
        data: {
          version: '0.3.0',
          categories: {
            elements: {
              description: 'Discover, inspect, and interact with UI elements',
              endpoints: [
                {
                  method: 'GET',
                  path: '/control/elements',
                  description: 'List all registered elements',
                },
                {
                  method: 'GET',
                  path: '/control/element/:id',
                  description: 'Get element details by ID',
                },
                {
                  method: 'GET',
                  path: '/control/element/:id/state',
                  description: 'Get element state',
                },
                {
                  method: 'GET',
                  path: '/control/element/:id/react-state',
                  description: 'Get React props and fiber state for element',
                },
                {
                  method: 'POST',
                  path: '/control/element/:id/action',
                  description: 'Execute action on element',
                },
                {
                  method: 'POST',
                  path: '/control/actions/batch',
                  description: 'Execute batch actions on multiple elements',
                },
                {
                  method: 'POST',
                  path: '/control/get-element-images',
                  description: 'Get rendered images for elements',
                },
              ],
            },
            components: {
              description: 'Inspect and interact with UI components',
              endpoints: [
                {
                  method: 'GET',
                  path: '/control/components',
                  description: 'List all registered components',
                },
                {
                  method: 'GET',
                  path: '/control/component/:id',
                  description: 'Get component details by ID',
                },
                {
                  method: 'GET',
                  path: '/control/component/:id/state',
                  description: 'Get component state',
                },
                {
                  method: 'POST',
                  path: '/control/component/:id/action/:actionId',
                  description: 'Execute action on component',
                },
              ],
            },
            discovery: {
              description: 'Find elements and capture page snapshots',
              endpoints: [
                {
                  method: 'POST',
                  path: '/control/find',
                  description: 'Find elements matching criteria',
                },
                {
                  method: 'POST',
                  path: '/control/discover',
                  description: 'Discover elements (deprecated, use /control/find)',
                },
                {
                  method: 'GET',
                  path: '/control/snapshot',
                  description: 'Capture full control snapshot',
                },
                { method: 'GET', path: '/control/workflows', description: 'List all workflows' },
                {
                  method: 'POST',
                  path: '/control/workflow/:id/run',
                  description: 'Run a workflow',
                },
                {
                  method: 'GET',
                  path: '/control/workflow/:runId/status',
                  description: 'Get workflow run status',
                },
              ],
            },
            navigation: {
              description: 'Page navigation controls',
              endpoints: [
                {
                  method: 'POST',
                  path: '/control/page/refresh',
                  description: 'Refresh current page',
                },
                { method: 'POST', path: '/control/page/navigate', description: 'Navigate to URL' },
                { method: 'POST', path: '/control/page/back', description: 'Navigate back' },
                { method: 'POST', path: '/control/page/forward', description: 'Navigate forward' },
              ],
            },
            ai: {
              description: 'AI-native search, execution, assertions, and semantic analysis',
              endpoints: [
                {
                  method: 'POST',
                  path: '/ai/search',
                  description: 'Search elements using natural language',
                },
                {
                  method: 'POST',
                  path: '/ai/find',
                  description: 'Find element by natural language query',
                },
                {
                  method: 'POST',
                  path: '/ai/execute',
                  description: 'Execute action via natural language',
                },
                { method: 'POST', path: '/ai/assert', description: 'Assert UI condition' },
                {
                  method: 'POST',
                  path: '/ai/assert/batch',
                  description: 'Assert multiple UI conditions',
                },
                {
                  method: 'GET',
                  path: '/ai/snapshot',
                  description: 'Get semantic snapshot of current page',
                },
                {
                  method: 'GET',
                  path: '/ai/diff',
                  description: 'Get semantic diff since last snapshot',
                },
                {
                  method: 'GET',
                  path: '/ai/summary',
                  description: 'Get natural language page summary',
                },
                {
                  method: 'POST',
                  path: '/ai/semantic-search',
                  description: 'Search using semantic embeddings',
                },
              ],
            },
            change_tracking: {
              description: 'Track, diff, and analyze UI changes',
              endpoints: [
                {
                  method: 'POST',
                  path: '/ai/execute-with-diff',
                  description: 'Execute action and capture diff',
                },
                {
                  method: 'POST',
                  path: '/ai/wait-for-change',
                  description: 'Wait for UI change matching predicate',
                },
                {
                  method: 'GET',
                  path: '/ai/categorize-last-diff',
                  description: 'Categorize the last diff',
                },
                {
                  method: 'POST',
                  path: '/ai/scoped-diff',
                  description: 'Get diff scoped to element/region',
                },
                {
                  method: 'POST',
                  path: '/ai/summarize-diff',
                  description: 'Summarize diff within token budget',
                },
                {
                  method: 'POST',
                  path: '/ai/structured-changes',
                  description: 'Analyze structured changes (tables, lists)',
                },
                {
                  method: 'POST',
                  path: '/ai/change-buffer/enable',
                  description: 'Enable change buffer',
                },
                {
                  method: 'POST',
                  path: '/ai/change-buffer/disable',
                  description: 'Disable change buffer',
                },
                {
                  method: 'POST',
                  path: '/ai/change-buffer/drain',
                  description: 'Drain buffered changes',
                },
                {
                  method: 'GET',
                  path: '/ai/change-buffer/size',
                  description: 'Get change buffer size',
                },
                { method: 'POST', path: '/ai/bookmarks', description: 'Save snapshot bookmark' },
                { method: 'GET', path: '/ai/bookmarks', description: 'List all bookmarks' },
                { method: 'GET', path: '/ai/bookmark/:name', description: 'Get bookmark by name' },
                { method: 'DELETE', path: '/ai/bookmark/:name', description: 'Delete bookmark' },
                {
                  method: 'GET',
                  path: '/ai/bookmark/:name/diff',
                  description: 'Get diff from bookmark',
                },
              ],
            },
            idle_detection: {
              description: 'Detect and wait for UI idle states',
              endpoints: [
                {
                  method: 'GET',
                  path: '/control/idle-status',
                  description: 'Get composite idle status',
                },
                {
                  method: 'POST',
                  path: '/control/wait-for-idle',
                  description: 'Wait for UI to become idle',
                },
                {
                  method: 'POST',
                  path: '/control/wait-for-targets',
                  description: 'Wait for specific idle targets',
                },
                {
                  method: 'GET',
                  path: '/control/idle-status/:signal',
                  description: 'Get idle status for specific signal',
                },
                {
                  method: 'POST',
                  path: '/control/wait-for-idle/:signal',
                  description: 'Wait for specific signal to become idle',
                },
              ],
            },
            network: {
              description: 'Monitor network requests',
              endpoints: [
                {
                  method: 'GET',
                  path: '/control/network-requests',
                  description: 'List network requests',
                },
                {
                  method: 'GET',
                  path: '/control/network-requests/in-flight',
                  description: 'List in-flight requests',
                },
                {
                  method: 'POST',
                  path: '/control/network-requests/wait',
                  description: 'Wait for network request matching criteria',
                },
                {
                  method: 'GET',
                  path: '/control/network-request/:id',
                  description: 'Get network request details',
                },
                {
                  method: 'GET',
                  path: '/control/network-chains',
                  description: 'Get network request chains',
                },
              ],
            },
            forms: {
              description: 'Form state inspection, filling, and diffing',
              endpoints: [
                { method: 'GET', path: '/control/forms', description: 'Get all form states' },
                { method: 'POST', path: '/control/fill', description: 'Fill form fields' },
                {
                  method: 'POST',
                  path: '/control/forms/snapshot',
                  description: 'Capture form snapshot',
                },
                {
                  method: 'POST',
                  path: '/control/forms/diff',
                  description: 'Diff two form snapshots',
                },
              ],
            },
            design: {
              description: 'Design review, style auditing, and quality evaluation',
              endpoints: [
                {
                  method: 'GET',
                  path: '/design/element/:id/styles',
                  description: 'Get element computed styles',
                },
                {
                  method: 'POST',
                  path: '/design/element/:id/state-styles',
                  description: 'Get element styles across interaction states',
                },
                {
                  method: 'POST',
                  path: '/design/snapshot',
                  description: 'Capture design snapshot',
                },
                {
                  method: 'POST',
                  path: '/design/responsive',
                  description: 'Capture responsive snapshots at viewports',
                },
                { method: 'POST', path: '/design/audit', description: 'Run design style audit' },
                {
                  method: 'POST',
                  path: '/design/style-guide/load',
                  description: 'Load style guide configuration',
                },
                {
                  method: 'GET',
                  path: '/design/style-guide',
                  description: 'Get current style guide',
                },
                { method: 'DELETE', path: '/design/style-guide', description: 'Clear style guide' },
                { method: 'POST', path: '/design/evaluate', description: 'Evaluate UI quality' },
                {
                  method: 'GET',
                  path: '/design/evaluate/contexts',
                  description: 'List quality evaluation contexts',
                },
                {
                  method: 'POST',
                  path: '/design/evaluate/baseline',
                  description: 'Save quality baseline',
                },
                {
                  method: 'POST',
                  path: '/design/evaluate/diff',
                  description: 'Diff against quality baseline',
                },
              ],
            },
            debug: {
              description: 'Debugging tools, diagnostics, and error tracking',
              endpoints: [
                { method: 'GET', path: '/debug/action-history', description: 'Get action history' },
                { method: 'GET', path: '/debug/metrics', description: 'Get bridge metrics' },
                {
                  method: 'POST',
                  path: '/debug/highlight/:id',
                  description: 'Highlight element in UI',
                },
                {
                  method: 'GET',
                  path: '/debug/element-tree',
                  description: 'Get element tree structure',
                },
                {
                  method: 'GET',
                  path: '/debug/element-history/:id',
                  description: 'Get element event history',
                },
                {
                  method: 'GET',
                  path: '/control/console-errors',
                  description: 'Get captured console errors',
                  queryParams: {
                    since: 'number (epoch ms) — filter errors after this timestamp',
                    sinceId:
                      'number — monotonic cursor id; return entries with id > sinceId (takes precedence over since)',
                    limit: 'number (default 50, max 500) — max errors to return',
                    group: 'boolean (default false) — group errors by fingerprint',
                    groupBy:
                      "'fingerprint' | 'message' | 'source' (default 'fingerprint') — grouping strategy",
                  },
                },
                {
                  method: 'POST',
                  path: '/control/console-errors/clear',
                  description: 'Clear captured console errors',
                },
                {
                  method: 'GET',
                  path: '/control/performance-entries',
                  description: 'Get performance entries',
                },
                {
                  method: 'POST',
                  path: '/control/performance-entries/clear',
                  description: 'Clear performance entries',
                },
                {
                  method: 'GET',
                  path: '/control/browser-events',
                  description: 'Get captured browser events',
                },
                { method: 'GET', path: '/control/timeline', description: 'Get error timeline' },
                { method: 'GET', path: '/control/health', description: 'Get health score report' },
                {
                  method: 'POST',
                  path: '/control/error-sessions/start',
                  description: 'Start error tracking session',
                },
                {
                  method: 'POST',
                  path: '/control/error-sessions/end',
                  description: 'End error tracking session',
                },
                {
                  method: 'GET',
                  path: '/control/error-sessions',
                  description: 'List error sessions',
                },
                {
                  method: 'POST',
                  path: '/control/error-baselines/capture',
                  description: 'Capture error baseline',
                },
                {
                  method: 'POST',
                  path: '/control/error-baselines/compare',
                  description: 'Compare against error baseline',
                },
                {
                  method: 'GET',
                  path: '/control/error-snapshots',
                  description: 'Get auto-captured error snapshots',
                },
                {
                  method: 'GET',
                  path: '/control/error-report',
                  description: 'Get composite error report',
                },
                { method: 'GET', path: '/render-log', description: 'Get render log entries' },
                {
                  method: 'GET',
                  path: '/control/render-log',
                  description: 'Get render log entries (alias)',
                },
                { method: 'DELETE', path: '/render-log', description: 'Clear render log' },
                {
                  method: 'POST',
                  path: '/render-log/snapshot',
                  description: 'Capture render snapshot',
                },
                {
                  method: 'GET',
                  path: '/render-log/path',
                  description: 'Get render log file path',
                },
              ],
            },
            events: {
              description: 'Real-time event streaming via SSE and browser event capture',
              endpoints: [
                {
                  method: 'GET',
                  path: '/control/events/stream',
                  description: 'SSE stream of bridge events',
                },
                {
                  method: 'GET',
                  path: '/control/changes/stream',
                  description: 'SSE stream of UI changes',
                },
                {
                  method: 'GET',
                  path: '/control/changes/since',
                  description: 'Get changes since timestamp',
                },
                {
                  method: 'GET',
                  path: '/control/browser-events',
                  description: 'Get captured browser events',
                },
              ],
            },
            annotations: {
              description: 'Element annotation CRUD, import/export, and coverage',
              endpoints: [
                { method: 'GET', path: '/annotations', description: 'Get all annotations' },
                {
                  method: 'GET',
                  path: '/annotations/:id',
                  description: 'Get annotation by element ID',
                },
                {
                  method: 'PUT',
                  path: '/annotations/:id',
                  description: 'Set annotation for element',
                },
                { method: 'DELETE', path: '/annotations/:id', description: 'Delete annotation' },
                {
                  method: 'POST',
                  path: '/annotations/import',
                  description: 'Import annotations from config',
                },
                {
                  method: 'GET',
                  path: '/annotations/export',
                  description: 'Export all annotations',
                },
                {
                  method: 'GET',
                  path: '/annotations/coverage',
                  description: 'Get annotation coverage report',
                },
              ],
            },
            state_management: {
              description: 'UI state machines, transitions, and navigation',
              endpoints: [
                { method: 'GET', path: '/control/states', description: 'List all states' },
                { method: 'GET', path: '/control/states/active', description: 'Get active states' },
                {
                  method: 'GET',
                  path: '/control/states/snapshot',
                  description: 'Get state snapshot',
                },
                {
                  method: 'POST',
                  path: '/control/states/find-path',
                  description: 'Find path to target states',
                },
                {
                  method: 'POST',
                  path: '/control/states/navigate',
                  description: 'Navigate to target states',
                },
                { method: 'GET', path: '/control/state/:id', description: 'Get state by ID' },
                {
                  method: 'POST',
                  path: '/control/state/:id/activate',
                  description: 'Activate state',
                },
                {
                  method: 'POST',
                  path: '/control/state/:id/deactivate',
                  description: 'Deactivate state',
                },
                { method: 'GET', path: '/control/state-groups', description: 'List state groups' },
                {
                  method: 'POST',
                  path: '/control/state-group/:id/activate',
                  description: 'Activate state group',
                },
                {
                  method: 'POST',
                  path: '/control/state-group/:id/deactivate',
                  description: 'Deactivate state group',
                },
                {
                  method: 'GET',
                  path: '/control/transitions',
                  description: 'List all transitions',
                },
                {
                  method: 'GET',
                  path: '/control/transition/:id/can-execute',
                  description: 'Check if transition can execute',
                },
                {
                  method: 'POST',
                  path: '/control/transition/:id/execute',
                  description: 'Execute transition',
                },
              ],
            },
            clipboard: {
              description: 'Read and write clipboard contents',
              endpoints: [
                {
                  method: 'GET',
                  path: '/control/clipboard',
                  description: 'Read clipboard contents',
                },
                { method: 'POST', path: '/control/clipboard', description: 'Write to clipboard' },
              ],
            },
            undo_redo: {
              description: 'Undo/redo state inspection and execution',
              endpoints: [
                { method: 'GET', path: '/control/undo-state', description: 'Get undo/redo state' },
                { method: 'POST', path: '/control/undo', description: 'Execute undo' },
                { method: 'POST', path: '/control/redo', description: 'Execute redo' },
              ],
            },
            recovery: {
              description: 'Error recovery attempts',
              endpoints: [
                {
                  method: 'POST',
                  path: '/ai/recovery/attempt',
                  description: 'Attempt error recovery',
                },
              ],
            },
            intents: {
              description: 'Intent-based action discovery and execution',
              endpoints: [
                { method: 'GET', path: '/ai/intents', description: 'List available intents' },
                {
                  method: 'POST',
                  path: '/ai/intents/execute',
                  description: 'Execute intent by ID',
                },
                {
                  method: 'POST',
                  path: '/ai/intents/find',
                  description: 'Find intent matching query',
                },
                {
                  method: 'POST',
                  path: '/ai/intents/register',
                  description: 'Register new intent',
                },
                {
                  method: 'POST',
                  path: '/ai/intents/execute-from-query',
                  description: 'Find and execute intent from query',
                },
              ],
            },
            specs: {
              description: 'Loaded spec configurations for runner discovery',
              endpoints: [
                { method: 'GET', path: '/control/specs', description: 'List all loaded specs' },
              ],
            },
            analysis: {
              description: 'Cross-app page analysis and structured data extraction',
              endpoints: [
                {
                  method: 'GET',
                  path: '/ai/analyze/data',
                  description: 'Analyze page data',
                },
                {
                  method: 'GET',
                  path: '/ai/analyze/regions',
                  description: 'Analyze page regions',
                },
                {
                  method: 'GET',
                  path: '/ai/analyze/structured-data',
                  description: 'Analyze structured data on page',
                },
                {
                  method: 'POST',
                  path: '/ai/analyze/cross-app-compare',
                  description: 'Compare data across apps',
                },
              ],
            },
            media: {
              description: 'Media discovery, analysis, and auditing',
              endpoints: [
                {
                  method: 'POST',
                  path: '/ai/media/find',
                  description: 'Find media elements on page',
                },
                {
                  method: 'POST',
                  path: '/ai/media/audit/accessibility',
                  description: 'Audit media accessibility',
                },
                {
                  method: 'POST',
                  path: '/ai/media/audit/performance',
                  description: 'Audit media performance',
                },
                {
                  method: 'POST',
                  path: '/ai/media/snapshot',
                  description: 'Capture media snapshot',
                },
                {
                  method: 'POST',
                  path: '/ai/media/compare',
                  description: 'Compare media snapshots',
                },
                {
                  method: 'POST',
                  path: '/ai/media/analyze',
                  description: 'Analyze media element',
                },
                {
                  method: 'POST',
                  path: '/ai/media/analyze/batch',
                  description: 'Batch analyze media elements',
                },
                {
                  method: 'POST',
                  path: '/ai/media/analyze/page',
                  description: 'Analyze all media on page',
                },
              ],
            },
            system: {
              description: 'System and lifecycle endpoints',
              endpoints: [
                {
                  method: 'POST',
                  path: '/heartbeat',
                  description: 'Send heartbeat to keep connection alive',
                },
                {
                  method: 'GET',
                  path: '/capabilities',
                  description: 'Get API capabilities and endpoint listing',
                },
              ],
            },
          },
        },
        timestamp: Date.now(),
      };
    },

    // =========================================================================
    // Specs
    // =========================================================================

    getSpecs: async (): Promise<APIResponse<Record<string, unknown>>> => {
      const allSpecs = specStore.getAll();
      const result: Record<string, unknown> = {};
      for (const [specId, config] of allSpecs) {
        result[specId] = config;
      }
      return {
        success: true,
        data: result,
        timestamp: Date.now(),
      };
    },

    receiveHeartbeat: async (): Promise<APIResponse<{ received: boolean }>> => {
      // Track heartbeat timestamp for health detection
      lastHeartbeatTimestamp = Date.now();
      return {
        success: true,
        data: { received: true },
        timestamp: Date.now(),
      };
    },

    getElementHistory: async (
      elementId: string,
      options?: ElementHistoryOptions
    ): Promise<APIResponse<ElementLogEntry[]>> => {
      try {
        const entries = registry.getElementHistory?.(elementId, options) ?? [];
        return success(entries);
      } catch (err) {
        return error((err as Error).message, 'ELEMENT_HISTORY_ERROR');
      }
    },

    // =========================================================================
    // Media Discovery & Analysis (delegated to browser via relay in relay-handlers)
    // =========================================================================

    findMedia: async (_request) => {
      try {
        refreshElements();
        const allElements = registry.getAllElements();
        const mediaTypes = new Set(['image', 'video', 'audio', 'svg', 'picture', 'icon']);
        const rawMediaElements = allElements.filter((el) => {
          const elType = (el as { type?: string }).type ?? '';
          return mediaTypes.has(elType);
        });
        // Materialize state via getState() so fields like rect/visibility are populated,
        // then map to DiscoveredElement shape expected by FindResponse.
        const mediaElements: DiscoveredElement[] = rawMediaElements.map((raw) => {
          const el = raw as {
            id: string;
            type?: string;
            label?: string;
            actions?: string[];
            category?: 'interactive' | 'content' | 'media';
            contentMetadata?: ContentMetadata;
            mediaMetadata?: UiBridgeMediaMetadata;
            element?: HTMLElement;
            tagName?: string;
            role?: string;
            accessibleName?: string;
            getState?: () => unknown;
          };
          const state = (el.getState?.() ?? {}) as ElementState;
          return {
            id: el.id,
            type: el.type ?? 'unknown',
            label: el.label,
            tagName: el.element?.tagName?.toLowerCase?.() ?? el.tagName ?? el.type ?? 'unknown',
            role: el.role,
            accessibleName: el.accessibleName,
            actions: el.actions ?? [],
            state,
            registered: true,
            category: el.category ?? 'media',
            contentMetadata: el.contentMetadata,
            mediaMetadata: el.mediaMetadata,
          };
        });
        const response: FindResponse = {
          elements: mediaElements,
          total: mediaElements.length,
          durationMs: 0,
          timestamp: Date.now(),
        };
        return success(response);
      } catch (err) {
        return error((err as Error).message, 'FIND_MEDIA_ERROR');
      }
    },

    mediaAuditAccessibility: async () => {
      return error(
        'mediaAuditAccessibility not implemented in direct handlers — use relay-handlers',
        'NOT_IMPLEMENTED'
      );
    },

    mediaAuditPerformance: async () => {
      return error(
        'mediaAuditPerformance not implemented in direct handlers — use relay-handlers',
        'NOT_IMPLEMENTED'
      );
    },

    captureMediaSnapshot: async (_request) => {
      return error(
        'captureMediaSnapshot not implemented in direct handlers — use relay-handlers',
        'NOT_IMPLEMENTED'
      );
    },

    compareMediaSnapshots: async (_request) => {
      return error(
        'compareMediaSnapshots not implemented in direct handlers — use relay-handlers',
        'NOT_IMPLEMENTED'
      );
    },

    analyzeMedia: async (_request) => {
      return error(
        'analyzeMedia not implemented in direct handlers — use relay-handlers',
        'NOT_IMPLEMENTED'
      );
    },

    analyzeMediaBatch: async (_request) => {
      return error(
        'analyzeMediaBatch not implemented in direct handlers — use relay-handlers',
        'NOT_IMPLEMENTED'
      );
    },

    analyzeMediaPage: async (_request) => {
      return error(
        'analyzeMediaPage not implemented in direct handlers — use relay-handlers',
        'NOT_IMPLEMENTED'
      );
    },

    getChangesSince: async (_params) => {
      // Direct handlers don't maintain a change event buffer — use relay-handlers
      return success({ events: [], count: 0 });
    },

    pageEvaluate: async (_request) => {
      return error('pageEvaluate requires browser context — use relay-handlers', 'NOT_IMPLEMENTED');
    },

    pageScroll: async (_request) => {
      return error('pageScroll requires browser context — use relay-handlers', 'NOT_IMPLEMENTED');
    },

    clipboardWrite: async (_request) => {
      return error(
        'clipboardWrite requires browser context — use relay-handlers',
        'NOT_IMPLEMENTED'
      );
    },

    clipboardRead: async () => {
      return error(
        'clipboardRead requires browser context — use relay-handlers',
        'NOT_IMPLEMENTED'
      );
    },

    // =========================================================================
    // Enhanced Discovery & Navigation
    // =========================================================================

    query: async (request: { selector: string; limit?: number; includeState?: boolean }) => {
      try {
        const { selector, limit = 50, includeState = true } = request;
        const found = document.querySelectorAll(selector);
        const results: unknown[] = [];

        for (let i = 0; i < Math.min(found.length, limit); i++) {
          const el = found[i] as HTMLElement;
          const info: Record<string, unknown> = {
            tagName: el.tagName.toLowerCase(),
            id: el.id || undefined,
            className: classString(el) || undefined,
            textContent: el.textContent?.trim().substring(0, 200) || '',
            visible: el.offsetParent !== null,
          };
          if (includeState) {
            const rect = el.getBoundingClientRect();
            info.rect = {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            };
            if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
              info.value = el.value;
              info.placeholder = el.placeholder;
              info.disabled = el.disabled;
            }
            if (el instanceof HTMLSelectElement) {
              info.value = el.value;
              info.options = Array.from(el.options).map((o) => ({
                value: o.value,
                text: o.text,
                selected: o.selected,
              }));
            }
            if (el instanceof HTMLButtonElement) info.disabled = el.disabled;
            const attrs: Record<string, string> = {};
            for (const a of [
              'data-tutorial-id',
              'title',
              'aria-label',
              'role',
              'href',
              'placeholder',
            ]) {
              const v = el.getAttribute(a);
              if (v) attrs[a] = v;
            }
            if (Object.keys(attrs).length > 0) info.attributes = attrs;
          }
          results.push(info);
        }
        return success({ elements: results, count: found.length });
      } catch (err) {
        return error((err as Error).message, 'QUERY_ERROR');
      }
    },

    waitForElement: async (request: {
      selector?: string;
      elementId?: string;
      timeout?: number;
      pollInterval?: number;
    }) => {
      const { selector, elementId, timeout = 10000, pollInterval = 200 } = request;
      const target = selector || (elementId ? `#${elementId}, [data-testid="${elementId}"]` : null);
      if (!target) return error('Must provide selector or elementId', 'INVALID_REQUEST');

      const start = Date.now();
      return new Promise((resolve) => {
        const check = () => {
          const el = document.querySelector(target) as HTMLElement | null;
          const waited = Date.now() - start;
          if (el && el.offsetParent !== null) {
            resolve(
              success({
                found: true,
                element: {
                  tagName: el.tagName.toLowerCase(),
                  id: el.id,
                  textContent: el.textContent?.trim().substring(0, 200),
                  visible: true,
                },
                waitedMs: waited,
              })
            );
          } else if (waited >= timeout) {
            resolve(success({ found: false, waitedMs: waited }));
          } else {
            setTimeout(check, pollInterval);
          }
        };
        check();
      });
    },

    // =========================================================================
    // Tier 3.1 — Registry-based wait-for-element with structured conditions
    // =========================================================================

    waitForElementByCondition: async (
      request: WaitForElementByConditionRequest
    ): Promise<APIResponse<WaitForElementByConditionResponse>> => {
      const { selector = {}, condition = 'present', text_match } = request;

      // Cap timeout between 100 ms and 60 s; default 5 s.
      const timeoutMs = Math.min(
        Math.max(typeof request.timeout_ms === 'number' ? request.timeout_ms : 5000, 100),
        60_000
      );

      const start = Date.now();
      const POLL_MS = 100;

      /**
       * Filter elements from the registry by the selector criteria.
       * All provided selector fields must match (case-insensitive substring).
       *
       * Field fallback logic mirrors the relay-handlers getElements filter so that
       * the same element found by GET /control/elements?title=X is also matched here:
       *   - selector.id        → exact match on el.id
       *   - selector.title     → el.title OR el.ariaLabel OR el.label (accessible name chain)
       *   - selector.aria_label → el.ariaLabel OR el.label
       *   - selector.text      → el.label OR el.id (same as relay)
       */
      function matchesSelector(el: Record<string, unknown>): boolean {
        // Type selector falls back to tagName here (live DOM) since elements
        // may have either field; the shared helper only checks `type`.
        if (selector.type) {
          const elType = (typeof el.type === 'string' ? el.type : '').toLowerCase();
          const elTag = (typeof el.tagName === 'string' ? el.tagName : '').toLowerCase();
          const needle = selector.type.toLowerCase();
          if (!elType.includes(needle) && !elTag.includes(needle)) return false;
        }
        // Delegate id/title/aria_label/text to the shared matcher so this stays
        // in lockstep with getElements / relay-handlers.
        return matchesElementSelector(el as unknown as MatchableElement, {
          id: selector.id,
          title: selector.title,
          aria_label: selector.aria_label,
          text: selector.text,
        });
      }

      /**
       * Evaluate the condition against a matched element.
       * Returns true when the condition is satisfied.
       */
      function checkCondition(el: Record<string, unknown>, domEl: HTMLElement | null): boolean {
        switch (condition) {
          case 'present':
            return true;

          case 'visible': {
            if (!domEl) return false;
            if (domEl.offsetParent === null) return false;
            const rect = domEl.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          }

          case 'clickable': {
            if (!domEl) return false;
            if (domEl.offsetParent === null) return false;
            const rect = domEl.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return false;
            if ((domEl as HTMLButtonElement | HTMLInputElement).disabled) return false;
            if (domEl.getAttribute('aria-disabled') === 'true') return false;
            return true;
          }

          case 'text-matches': {
            if (!text_match) return true; // degenerate — no needle means always match
            const needle = text_match.toLowerCase();
            const label = (typeof el.label === 'string' ? el.label : '').toLowerCase();
            const ariaLabel = (typeof el.ariaLabel === 'string' ? el.ariaLabel : '').toLowerCase();
            const title = (typeof el.title === 'string' ? el.title : '').toLowerCase();
            const textContent = domEl?.textContent?.toLowerCase() ?? '';
            return (
              label.includes(needle) ||
              ariaLabel.includes(needle) ||
              title.includes(needle) ||
              textContent.includes(needle)
            );
          }

          default:
            return true;
        }
      }

      return new Promise<APIResponse<WaitForElementByConditionResponse>>((resolve) => {
        let done = false;

        const poll = () => {
          if (done) return;
          const waited_ms = Date.now() - start;

          try {
            const raw = registry.getAllElements() as Record<string, unknown>[];
            const materialized = materializeElements(raw) as unknown as Array<
              Record<string, unknown>
            >;

            for (const el of materialized) {
              if (!matchesSelector(el)) continue;

              // Try to obtain the live DOM element for visibility/clickable checks.
              const rawEl = raw.find((r) => r.id === el.id) as
                | { element?: HTMLElement }
                | undefined;
              const domEl: HTMLElement | null = rawEl?.element ?? null;

              if (checkCondition(el, domEl)) {
                done = true;
                resolve(
                  success<WaitForElementByConditionResponse>({
                    matched: true,
                    element: el,
                    waited_ms,
                  })
                );
                return;
              }
            }
          } catch {
            // Registry read errors are non-fatal; keep polling.
          }

          if (waited_ms >= timeoutMs) {
            done = true;
            resolve(
              // 408-style: matched=false, no element, waited_ms reflects the timeout
              success<WaitForElementByConditionResponse>({
                matched: false,
                waited_ms,
              })
            );
            return;
          }

          setTimeout(poll, POLL_MS);
        };

        poll();
      });
    },

    // =========================================================================
    // Testing-friendliness — wait-for-route-change + wait-for-element
    // =========================================================================

    waitForRouteChange: async (
      request?: WaitForRouteChangeRequest
    ): Promise<
      APIResponse<
        | WaitForRouteChangeResponse
        | { reason: 'timeout'; lastKnownRoute?: string; elapsedMs: number }
      >
    > => {
      const req = request ?? {};
      const matchMode = req.matchMode ?? 'exact';

      // Validate + build the `toRoute` matcher once up front. Invalid regex
      // surfaces as a 400-equivalent API error — callers shouldn't block on
      // requests the server can't satisfy.
      let toMatcher: ((candidate: string) => boolean) | null = null;
      if (typeof req.toRoute === 'string' && req.toRoute.length > 0) {
        const needle = req.toRoute;
        if (matchMode === 'exact') {
          toMatcher = (c) => c === needle;
        } else if (matchMode === 'prefix') {
          toMatcher = (c) => c.startsWith(needle);
        } else if (matchMode === 'regex') {
          let re: RegExp;
          try {
            re = new RegExp(needle);
          } catch (err) {
            return error(`Invalid regex toRoute: ${(err as Error).message}`, 'VALIDATION_ERROR');
          }
          toMatcher = (c) => re.test(c);
        }
      }

      const fromMatcher =
        typeof req.fromRoute === 'string' && req.fromRoute.length > 0
          ? (candidate: string) => candidate === req.fromRoute
          : null;

      // Clamp timeout to [100, 60000]; default 5000.
      const timeoutMs = Math.min(
        Math.max(typeof req.timeoutMs === 'number' ? req.timeoutMs : 5000, 100),
        60_000
      );

      const started = Date.now();

      const matchEntry = (entry: { from: string; to: string }): boolean => {
        if (fromMatcher && !fromMatcher(entry.from)) return false;
        if (toMatcher && !toMatcher(entry.to)) return false;
        return true;
      };

      // Race mitigation: scan the always-on ring buffer for an entry that
      // landed within the configured lookback window (= timeoutMs). If we
      // find one, resolve immediately with `elapsedMs: 0` so callers that
      // ran an action *before* calling this endpoint don't hang.
      const lookbackFrom = started - timeoutMs;
      const recent = changeTracker.getRecentRouteChanges(lookbackFrom);
      for (const entry of recent) {
        if (matchEntry(entry)) {
          return success<WaitForRouteChangeResponse>({
            from: entry.from,
            to: entry.to,
            elapsedMs: 0,
          });
        }
      }

      return new Promise<
        APIResponse<
          | WaitForRouteChangeResponse
          | { reason: 'timeout'; lastKnownRoute?: string; elapsedMs: number }
        >
      >((resolve) => {
        let settled = false;
        let unsubscribe: (() => void) | null = null;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const done = (
          value: APIResponse<
            | WaitForRouteChangeResponse
            | { reason: 'timeout'; lastKnownRoute?: string; elapsedMs: number }
          >
        ) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          unsubscribe?.();
          resolve(value);
        };

        unsubscribe = changeTracker.subscribeRouteChange((evt) => {
          if (!matchEntry(evt)) return;
          done(
            success<WaitForRouteChangeResponse>({
              from: evt.from,
              to: evt.to,
              elapsedMs: Date.now() - started,
            })
          );
        });

        timer = setTimeout(() => {
          const history = changeTracker.getRecentRouteChanges();
          const lastKnownRoute = history.length > 0 ? history[history.length - 1].to : undefined;
          done(
            success<{ reason: 'timeout'; lastKnownRoute?: string; elapsedMs: number }>({
              reason: 'timeout',
              lastKnownRoute,
              elapsedMs: Date.now() - started,
            })
          );
        }, timeoutMs);
      });
    },

    waitForElementRegistered: async (
      request: WaitForElementRequest
    ): Promise<
      APIResponse<
        | WaitForElementSuccessResponse
        | { reason: 'timeout'; elapsedMs: number; closestMatch?: Record<string, unknown> }
      >
    > => {
      const predicate = request?.predicate ?? {};
      const requirement = request?.requirement ?? 'registered';
      const pollMs = Math.min(
        Math.max(typeof request?.pollMs === 'number' ? request.pollMs : 100, 50),
        1000
      );
      const timeoutMs = Math.min(
        Math.max(typeof request?.timeoutMs === 'number' ? request.timeoutMs : 5000, 100),
        60_000
      );

      const labelNeedle =
        typeof predicate.label === 'string' && predicate.label.length > 0
          ? predicate.label.toLowerCase()
          : null;

      function predicateMatches(el: Record<string, unknown>, domEl: HTMLElement | null): boolean {
        if (typeof predicate.id === 'string' && predicate.id.length > 0) {
          if (el.id !== predicate.id) return false;
        }
        if (labelNeedle) {
          const label = typeof el.label === 'string' ? el.label.toLowerCase() : '';
          const ariaLabel = typeof el.ariaLabel === 'string' ? el.ariaLabel.toLowerCase() : '';
          const accessible =
            typeof (el.state as { accessibleName?: string } | undefined)?.accessibleName ===
            'string'
              ? (el.state as { accessibleName: string }).accessibleName.toLowerCase()
              : '';
          if (
            !label.includes(labelNeedle) &&
            !ariaLabel.includes(labelNeedle) &&
            !accessible.includes(labelNeedle)
          ) {
            return false;
          }
        }
        if (typeof predicate.testId === 'string' && predicate.testId.length > 0) {
          const testId = domEl?.getAttribute?.('data-testid');
          if (testId !== predicate.testId) return false;
        }
        return true;
      }

      function requirementMet(el: Record<string, unknown>, domEl: HTMLElement | null): boolean {
        if (requirement === 'registered') return true;

        const state = el.state as
          | {
              visible?: boolean;
              rect?: { width?: number; height?: number };
            }
          | undefined;

        if (requirement === 'visible') {
          if (state && typeof state.visible === 'boolean') return state.visible;
          if (!domEl) return false;
          if (domEl.offsetParent === null) return false;
          const rect = domEl.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }

        if (requirement === 'has-layout') {
          const w = state?.rect?.width ?? 0;
          const h = state?.rect?.height ?? 0;
          if (w > 0 && h > 0) return true;
          if (domEl) {
            const rect = domEl.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          }
          return false;
        }

        return true;
      }

      const started = Date.now();

      /**
       * One poll pass. Returns the matched element/dom-el pair (if any) or
       * null. Scans the in-memory registry first, then falls back to
       * `document.querySelector` when `predicate.selector` is present and
       * the registry didn't produce a match.
       */
      function attempt(): {
        element: Record<string, unknown>;
        domEl: HTMLElement | null;
      } | null {
        try {
          const raw = registry.getAllElements() as Record<string, unknown>[];
          const materialized = materializeElements(raw) as unknown as Array<
            Record<string, unknown>
          >;

          for (const el of materialized) {
            const rawEl = raw.find((r) => r.id === el.id) as { element?: HTMLElement } | undefined;
            const domEl: HTMLElement | null = rawEl?.element ?? null;
            if (!predicateMatches(el, domEl)) continue;
            if (!requirementMet(el, domEl)) continue;
            return { element: el, domEl };
          }
        } catch {
          // Registry errors are non-fatal; keep polling.
        }

        // DOM-selector fallback — only kicks in when the caller provided
        // one and the registry couldn't satisfy the predicate. Lets tests
        // wait on elements that aren't registered with the SDK
        // (third-party widgets, unmounted portals, etc.).
        if (
          typeof predicate.selector === 'string' &&
          predicate.selector.length > 0 &&
          typeof document !== 'undefined'
        ) {
          try {
            const domEl = document.querySelector(predicate.selector) as HTMLElement | null;
            if (domEl) {
              const syntheticEl: Record<string, unknown> = {
                id: domEl.id || `dom-${predicate.selector}`,
                label: domEl.getAttribute('aria-label') ?? domEl.textContent?.trim() ?? undefined,
                type: domEl.tagName?.toLowerCase?.(),
                ariaLabel: domEl.getAttribute('aria-label') ?? undefined,
              };
              if (!requirementMet(syntheticEl, domEl)) return null;
              return { element: syntheticEl, domEl };
            }
          } catch {
            // Invalid selector — treat as no match.
          }
        }

        return null;
      }

      // Fast path — check before scheduling any timers.
      const first = attempt();
      if (first) {
        return success<WaitForElementSuccessResponse>({
          element: first.element as WaitForElementSuccessResponse['element'],
          elapsedMs: Date.now() - started,
        });
      }

      return new Promise<
        APIResponse<
          | WaitForElementSuccessResponse
          | { reason: 'timeout'; elapsedMs: number; closestMatch?: Record<string, unknown> }
        >
      >((resolve) => {
        let done = false;
        let lastPartial: Record<string, unknown> | undefined;

        const poll = () => {
          if (done) return;
          const elapsed = Date.now() - started;

          const match = attempt();
          if (match) {
            done = true;
            resolve(
              success<WaitForElementSuccessResponse>({
                element: match.element as WaitForElementSuccessResponse['element'],
                elapsedMs: Date.now() - started,
              })
            );
            return;
          }

          // Track a "closest match" — an element that matched the predicate
          // but failed the requirement (visibility/layout). Helps callers
          // debug why their wait timed out.
          if (requirement !== 'registered') {
            try {
              const raw = registry.getAllElements() as Record<string, unknown>[];
              const materialized = materializeElements(raw) as unknown as Array<
                Record<string, unknown>
              >;
              for (const el of materialized) {
                const rawEl = raw.find((r) => r.id === el.id) as
                  | { element?: HTMLElement }
                  | undefined;
                const domEl: HTMLElement | null = rawEl?.element ?? null;
                if (predicateMatches(el, domEl)) {
                  lastPartial = el;
                  break;
                }
              }
            } catch {
              /* ignore */
            }
          }

          if (elapsed >= timeoutMs) {
            done = true;
            resolve(
              success<{
                reason: 'timeout';
                elapsedMs: number;
                closestMatch?: Record<string, unknown>;
              }>({
                reason: 'timeout',
                elapsedMs: elapsed,
                closestMatch: lastPartial,
              })
            );
            return;
          }

          setTimeout(poll, pollMs);
        };

        setTimeout(poll, pollMs);
      });
    },

    // =========================================================================
    // Tier 3.2 — Mixed action/wait/snapshot batch execution
    // =========================================================================

    controlBatch: async (
      request: ControlBatchRequest
    ): Promise<APIResponse<ControlBatchResponse>> => {
      const { actions = [], stop_on_error = true } = request;
      const results: ControlBatchStepResult[] = [];
      let completed = 0;

      for (let i = 0; i < actions.length; i++) {
        const step = actions[i];
        let stepResult: ControlBatchStepResult;

        try {
          if (step.type === 'wait') {
            await new Promise<void>((r) => setTimeout(r, step.ms));
            stepResult = { index: i, success: true, data: { waited_ms: step.ms } };
          } else if (step.type === 'snapshot') {
            // Capture a snapshot directly from the registry to avoid circular deps.
            try {
              const snap = registry.createSnapshot();
              stepResult = { index: i, success: true, data: snap };
            } catch (snapErr) {
              stepResult = {
                index: i,
                success: false,
                error: (snapErr as Error).message ?? 'Snapshot failed',
              };
            }
          } else if (step.type === 'action') {
            // Dispatch via the action executor directly — same as executeElementAction.
            refreshElements();
            const actionResult = await actionExecutor.executeAction(step.element_id, {
              action: step.action,
              params: step.params,
            });
            const resultAny = actionResult as { success?: boolean; error?: string };
            if (resultAny?.success !== false) {
              stepResult = { index: i, success: true, data: actionResult };
            } else {
              stepResult = {
                index: i,
                success: false,
                error: resultAny.error ?? 'Action failed',
              };
            }
          } else {
            stepResult = {
              index: i,
              success: false,
              error: `Unknown step type: ${(step as { type: string }).type}`,
            };
          }
        } catch (err) {
          stepResult = {
            index: i,
            success: false,
            error: (err as Error).message ?? String(err),
          };
        }

        results.push(stepResult);
        completed++;

        if (!stepResult.success && stop_on_error) {
          break;
        }
      }

      return success<ControlBatchResponse>({
        results,
        completed,
        total: actions.length,
      });
    },
  };
}

/**
 * Create partial handlers for AI-specific functionality only
 *
 * Use this when you want to add AI endpoints to an existing handler setup.
 */
export function createAIHandlers(
  registry: RegistryLike,
  actionExecutor: ActionExecutorLike
): Pick<
  UIBridgeServerHandlers,
  | 'aiSearch'
  | 'aiFind'
  | 'aiExecute'
  | 'aiAssert'
  | 'aiAssertBatch'
  | 'getSemanticSnapshot'
  | 'getSemanticDiff'
  | 'getPageSummary'
> {
  const searchEngine = new SearchEngine();
  const nlExecutor = new NLActionExecutor();
  const assertionExecutor = new AssertionExecutor();
  const snapshotManager = new SemanticSnapshotManager();
  const diffManager = new SemanticDiffManager();

  // B0 — Match the registry-then-DOM-fallback composition the snapshot
  // endpoint uses, so the SearchEngine and friends never see a strictly
  // smaller element set than `/control/snapshot`. See the longer comment on
  // the primary `refreshElements` definition above.
  function refreshElements(): void {
    let elements: unknown[] = registry.getAllElements();
    if (elements.length === 0) {
      const domElements = scanDOMForInteractiveElements();
      if (domElements.length > 0) {
        elements = domElements;
      }
    }
    searchEngine.updateElements(elements as any[]);
    nlExecutor.updateElements(elements as any[]);
    nlExecutor.setActionExecutor(actionExecutor as any);
    assertionExecutor.updateElements(elements as any[]);
  }

  return {
    aiSearch: async (criteria: SearchCriteria): Promise<APIResponse<SearchResponse>> => {
      try {
        refreshElements();
        // Support callers that pass { query: "..." } instead of structured SearchCriteria.
        const resolved: SearchCriteria = { ...criteria };
        if (!resolved.text && (criteria as any).query) {
          resolved.text = (criteria as any).query;
          if (resolved.fuzzy === undefined) {
            resolved.fuzzy = true;
          }
        }
        const response = searchEngine.search(resolved);
        return { success: true, data: response, timestamp: Date.now() };
      } catch (err) {
        return {
          success: false,
          error: (err as Error).message,
          code: 'AI_SEARCH_ERROR',
          timestamp: Date.now(),
        };
      }
    },

    aiFind: async (request: {
      query: string;
      context?: FindContext;
      confidenceThreshold?: number;
    }): Promise<APIResponse<FindResult>> => {
      try {
        refreshElements();
        const result = find(request.query, searchEngine, {
          context: request.context,
          confidenceThreshold: request.confidenceThreshold,
          pickFirst: true,
        });
        return { success: true, data: result, timestamp: Date.now() };
      } catch (err) {
        return {
          success: false,
          error: (err as Error).message,
          code: 'AI_FIND_ERROR',
          timestamp: Date.now(),
        };
      }
    },

    aiExecute: async (request: NLActionRequest): Promise<APIResponse<NLActionResponse>> => {
      try {
        refreshElements();
        const response = await nlExecutor.execute(request);
        return { success: true, data: response, timestamp: Date.now() };
      } catch (err) {
        return {
          success: false,
          error: (err as Error).message,
          code: 'AI_EXECUTE_ERROR',
          timestamp: Date.now(),
        };
      }
    },

    aiAssert: async (
      request: AssertionRequest & { assertion?: string }
    ): Promise<APIResponse<AssertionResult>> => {
      try {
        refreshElements();
        const normalized = parseNLAssertion(request);
        const result = await assertionExecutor.assert(normalized);
        return { success: true, data: result, timestamp: Date.now() };
      } catch (err) {
        return {
          success: false,
          error: (err as Error).message,
          code: 'AI_ASSERT_ERROR',
          timestamp: Date.now(),
        };
      }
    },

    aiAssertBatch: async (
      request: BatchAssertionRequest & { assertions?: (AssertionRequest | string)[] }
    ): Promise<APIResponse<BatchAssertionResult>> => {
      try {
        refreshElements();
        const normalized = normalizeBatchAssertions(request);
        const result = await assertionExecutor.assertBatch(normalized);
        return { success: true, data: result, timestamp: Date.now() };
      } catch (err) {
        return {
          success: false,
          error: (err as Error).message,
          code: 'AI_ASSERT_BATCH_ERROR',
          timestamp: Date.now(),
        };
      }
    },

    getSemanticSnapshot: async (options?: {
      includeForms?: string | boolean;
    }): Promise<APIResponse<SemanticSnapshot>> => {
      try {
        const controlSnapshot = registry.createSnapshot();
        const wantForms = options?.includeForms === true || options?.includeForms === 'true';
        const formsResponse = wantForms
          ? discoverForms(registry.getAllElements() as FormDiscoveryElement[])
          : undefined;
        const snapshot = snapshotManager.createSnapshot(controlSnapshot, undefined, formsResponse);
        return { success: true, data: snapshot, timestamp: Date.now() };
      } catch (err) {
        return {
          success: false,
          error: (err as Error).message,
          code: 'SEMANTIC_SNAPSHOT_ERROR',
          timestamp: Date.now(),
        };
      }
    },

    getSemanticDiff: async (_since?: number): Promise<APIResponse<SemanticDiff | null>> => {
      try {
        const controlSnapshot = registry.createSnapshot();
        const currentSnapshot = snapshotManager.createSnapshot(controlSnapshot);
        const diff = diffManager.update(currentSnapshot);
        return { success: true, data: diff, timestamp: Date.now() };
      } catch (err) {
        return {
          success: false,
          error: (err as Error).message,
          code: 'SEMANTIC_DIFF_ERROR',
          timestamp: Date.now(),
        };
      }
    },

    getPageSummary: async (): Promise<APIResponse<string>> => {
      try {
        const snapshot = registry.createSnapshot();
        // Convert snapshot elements to AI elements format for summary
        const elements = snapshot.elements.map((el) => ({
          ...el,
          description: el.label || el.id,
          aliases: [],
          suggestedActions: [],
          tagName: el.type,
          accessibleName: el.label,
          registered: true,
        })) as any[];
        const summary = generatePageSummary(elements);
        return { success: true, data: summary, timestamp: Date.now() };
      } catch (err) {
        return {
          success: false,
          error: (err as Error).message,
          code: 'PAGE_SUMMARY_ERROR',
          timestamp: Date.now(),
        };
      }
    },
  };
}
