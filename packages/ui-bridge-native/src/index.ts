/**
 * UI Bridge Native
 *
 * UI Bridge framework for React Native applications.
 * Enables AI-driven UI automation and testing for mobile apps.
 *
 * @packageDocumentation
 */

// Core exports
export {
  // Native-specific types
  type NativeElementIdentifier,
  type NativeElementState,
  type NativeLayout,
  type NativeElementType,
  type NativeStandardAction,
  type NativeCustomAction,
  type RegisteredNativeElement,
  type RegisteredNativeComponent,
  type NativeComponentAction,
  type NativeActionRequest,
  type NativeActionResponse,
  type NativeBridgeSnapshot,
  type NativeRegistrationCoverage,
  type NativeModalInfo,
  type NativeSnapshotModalContext,
  type NativeCapturedToast,
  type NativeSnapshotToastContext,
  type NativeSnapshotUndoContext,
  type NativeSnapshotEnrichers,
  type NativeSnapshotEnricher,
  type NativeUIBridgeFeatures,
  type NativeUIBridgeConfig,
  type NativeFindRequest,
  type NativeFindResponse,
  type DiscoveredNativeElement,
  type NativeElementRef,
  // Common types (same interface as ui-bridge)
  type Workflow,
  type WorkflowStep,
  type WorkflowStepType,
  type WaitOptions,
  type BridgeEvent,
  type BridgeEventType,
  type BridgeEventListener,
  type ActionHandler,
  type ActionHandlerOptions,
  type CustomAction,
  type ComponentAction,
  // The safety-annotation vocabulary (Phase 4). Without it a consumer cannot
  // even name the type its `effect` field holds.
  type IREffect,
} from './core/types';

export {
  NativeUIBridgeRegistry,
  extractHandlerNames,
  setGlobalRegistry,
  getGlobalRegistry,
  resetGlobalRegistry,
  type RegisterElementOptions,
  type RegisterComponentOptions,
  type NativeRegistryConfig,
} from './core/registry';

export {
  projectVisionFields,
  deriveInteractable,
  deriveText,
  roleForType,
  parseColorToRgb,
  parseFontSizePx,
  type VisionRgb,
  type VisionElementFields,
} from './core/vision-fields';

// Action declarations: effect annotation, param validation, cancellation
// (plan `2026-08-20-ui-bridge-action-declaration-shape`, Phases 2-4).
//
// These were reachable only from the `./core` subpath, because this file uses an explicit export list and was never updated.
// A consumer holding the root import could not resolve a declared `effect`,
// arm param enforcement, or race a handler — i.e. three shipped features with
// no route to the caller, which is the exact defect class that plan exists to
// remove.
export {
  // NOTE: the NATIVE verb table. `resolveActionEffect` here resolves a native
  // verb (`press`, `swipe`, …); the web table is exported beside it under its
  // own name for callers that need the DOM verbs.
  NATIVE_STANDARD_ACTION_EFFECTS,
  nativeStandardActionEffect,
  resolveActionEffect,
} from './core/action-effect';

export {
  validateActionParams,
  formatParamValidationFailure,
  DEFAULT_PARAM_VALIDATION_MODE,
  getDefaultParamValidationMode,
  setDefaultParamValidationMode,
  resetDefaultParamValidationMode,
} from './core/param-schema';
export type {
  ParamSchemaKeyword,
  ParamSchemaIssue,
  ParamValidationResult,
  ParamValidationMode,
} from './core/param-schema';

export {
  runAbortable,
  inertAbortSignal,
  normalizeActionTimeoutMs,
  MAX_ACTION_TIMEOUT_MS,
} from './core/abortable';
export type {
  AbortReason,
  AbortableOutcome,
  RunAbortableOptions,
  TimeoutNormalization,
} from './core/abortable';

export {
  createNativeElementIdentifier,
  findElementByIdentifier,
  findAllByPattern,
  buildTreePath,
  parseTreePath,
  matchesIdentifier,
} from './core/element-identifier';

// React exports
export {
  UIBridgeNativeProvider,
  useUIBridgeNative,
  useUIBridgeNativeOptional,
  useUIBridgeNativeRequired,
  type UIBridgeNativeContextValue,
  type UIBridgeNativeProviderProps,
} from './react/UIBridgeNativeProvider';

export {
  useUIElement,
  useUIElementWithProps,
  type UseUIElementOptions,
  type UseUIElementOptionsBase,
  type UseUIElementOptionsHandlersRequired,
  type UseUIElementOptionsHandlersOptional,
  type UseUIElementWithPropsOptions,
  type UseUIElementReturn,
  type UseUIElementWithPropsReturn,
  type UIBridgeProps,
  type PressHandler,
  type PressNeedingNativeElementType,
} from './react/useUIElement';

export {
  useUIComponent,
  useUIComponentAction,
  type ComponentActionDef,
  type UseUIComponentOptions,
  type UseUIComponentReturn,
} from './react/useUIComponent';

export {
  useUIBridge,
  useUIBridgeRequired,
  type UseUIBridgeReturn,
  type ComponentActionRequest,
  type ComponentActionResponse,
} from './react/useUIBridge';

export { useUIBridgeModal, type UseUIBridgeModalOptions } from './react/useUIBridgeModal';

export {
  useUIBridgeToast,
  useToastRecorder,
  type UseUIBridgeToastOptions,
  type ToastRecorderInput,
} from './react/useUIBridgeToast';

// IR annotation wrappers — runtime-no-op render-children-only components.
// Build-time IR extractor (in @qontinui/ui-bridge-auto) reads these JSX tags
// to derive the page IR. Their props mirror the IR schema; the runtime
// implementation just renders children, so wrapping any subtree in <State>
// or <TransitionTo> never changes UI behavior.
export {
  State,
  TransitionTo,
  type StateProps,
  type TransitionToProps,
  type StateAnnotationRequiredElement,
} from './react/StateAnnotation';

// Tracker classes (modal/toast/undo) — usually consumed via hooks but exported
// so non-React contexts (e.g. unit tests, custom enrichers) can instantiate them.
export { ModalDetector } from './modal/modal-detector';
export type { ModalPushInput } from './modal/modal-detector';
export { ToastCapture } from './toast/toast-capture';
export type { ToastRecordInput, ToastCaptureConfig } from './toast/toast-capture';
export { UndoTracker } from './undo';
export type { ActionRecord, DeclaredUndoState, UndoTrackerConfig } from './undo';

// Control exports
export {
  type ControlActionRequest,
  type ControlActionResponse,
  type ComponentActionRequest as ControlComponentActionRequest,
  type ComponentActionResponse as ControlComponentActionResponse,
  type WaitResult,
  type NativeActionExecutor,
  type ActionExecutionOptions,
  type TypeActionParams,
  type ScrollActionParams,
  type SwipeActionParams,
  type PressActionParams,
} from './control/types';

export { DefaultNativeActionExecutor, createNativeActionExecutor } from './control/action-executor';

// Server exports
export {
  type NativeServerConfig,
  type RouteDefinition,
  type APIResponse,
  type HandlerContext,
  type HandlerFunction,
  type NativeServerHandlers,
  type NavigationProvider,
  type ScreenshotProvider,
  type KeepAwakeProvider,
  type RouteProvider,
  type FillFormFieldInput,
  type FillFormFieldResult,
  type FillFormRequest,
  type FillFormResponse,
  UI_BRIDGE_NATIVE_ROUTES,
} from './server/types';

export { createServerHandlers } from './server/handlers';

export {
  NativeUIBridgeServer,
  createNativeServer,
  type HTTPRequest,
  type HTTPResponse,
  type RequestHandler,
  type ServerAdapter,
  type WebSocketServerAdapter,
} from './server/http-server';

export { buildUpgradeResponse, computeAcceptKey } from './server/ws-protocol';
export { bindWithRetry, isAddrInUseError } from './server/bind-retry';
export type { BindWithRetryOptions } from './server/bind-retry';
export { WebSocketConnection } from './server/ws-connection';
export type { WebSocketMessageHandler } from './server/ws-connection';
export { WebSocketEventBridge } from './server/ws-event-bridge';
export type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcEvent,
  JsonRpcBatchRequest,
  JsonRpcBatchResponse,
} from './server/ws-types';

// Design exports
export {
  type ExtendedComputedStyles,
  type StyleDiff,
  type StateStyles,
  type ElementDesignData,
  type PseudoElementStyles,
  type ResponsiveSnapshot,
  type FlattenedNativeStyle,
  type NativeStateStyles,
  type NativeInteractionStateName,
} from './design/design-types';

export {
  mapNativeStyleToExtended,
  getNativeElementDesignData,
  captureNativeStateVariations,
  captureNativeResponsiveSnapshot,
} from './design/design-inspector-native';

export { createDesignHandlers, type NativeDesignHandlers } from './server/design-handlers';

// Debug exports
export { UIBridgeInspector, type UIBridgeInspectorProps } from './debug/inspector';

// Transport exports (cloud relay + mDNS announcer)
export * from './transport';
