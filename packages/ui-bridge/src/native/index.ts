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
  type ElementBbox,
  type NativeElementType,
  type NativeStandardAction,
  type NativeCustomAction,
  type RegisteredNativeElement,
  type RegisteredNativeComponent,
  type NativeComponentAction,
  type NativeActionRequest,
  type NativeActionResponse,
  type NativeBridgeSnapshot,
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
  setGlobalRegistry,
  getGlobalRegistry,
  resetGlobalRegistry,
  type RegisterElementOptions,
  type RegisterComponentOptions,
  type NativeRegistryConfig,
} from './core/registry';

// Action declarations: effect annotation, param validation, cancellation
// (plan `2026-08-20-ui-bridge-action-declaration-shape`, Phases 2-4).
//
// These were reachable only from the `./native/core` subpath, because this file uses an explicit export list and was never updated.
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
  STANDARD_ACTION_EFFECTS,
  standardActionEffect,
} from './core/action-effect';

export {
  validateActionParams,
  formatParamValidationFailure,
  DEFAULT_PARAM_VALIDATION_MODE,
  getDefaultParamValidationMode,
  setDefaultParamValidationMode,
  resetDefaultParamValidationMode,
} from '../core/param-schema';
export type {
  ParamSchemaKeyword,
  ParamSchemaIssue,
  ParamValidationResult,
  ParamValidationMode,
} from '../core/param-schema';

export {
  runAbortable,
  inertAbortSignal,
  normalizeActionTimeoutMs,
  MAX_ACTION_TIMEOUT_MS,
} from '../core/abortable';
export type {
  AbortReason,
  AbortableOutcome,
  RunAbortableOptions,
  TimeoutNormalization,
} from '../core/abortable';

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
  type UseUIElementOptionsPressNeedingForbidden,
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
  UI_BRIDGE_NATIVE_ROUTES,
} from './server/types';

export { createServerHandlers } from './server/handlers';

export {
  NativeUIBridgeServer,
  createNativeServer,
  // The envelope-code → HTTP-status mapping the built-in `handleRequest` uses.
  // Exported because this package's whole server story is BYO transport: a
  // consumer implementing `ServerAdapter` for their chosen RN HTTP library
  // needs the same mapping to answer consistently, and without it they would
  // re-derive the blanket 400 this surface just stopped sending.
  httpStatusForResponse,
  type HTTPRequest,
  type HTTPResponse,
  type RequestHandler,
  type ServerAdapter,
} from './server/http-server';

// Debug exports
export { UIBridgeInspector, type UIBridgeInspectorProps } from './debug/inspector';
