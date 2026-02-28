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
  type CustomAction,
  type ComponentAction,
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
  type UseUIElementReturn,
  type UseUIElementWithPropsReturn,
  type UIBridgeProps,
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
  type HTTPRequest,
  type HTTPResponse,
  type RequestHandler,
  type ServerAdapter,
} from './server/http-server';

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
