/**
 * UI Bridge React Module
 *
 * React hooks and providers for UI Bridge integration.
 */

// Provider
export {
  UIBridgeProvider,
  useUIBridgeContext,
  useUIBridgeOptional,
  type UIBridgeContextValue,
  type UIBridgeProviderProps,
} from './UIBridgeProvider';

// Element hook
export {
  useUIElement,
  useUIElementRef,
  type UseUIElementOptions,
  type UseUIElementReturn,
} from './useUIElement';

// Live bounding-box tracking — used internally by useUIElement and exported
// for consumers (e.g. custom registration paths outside the hook) that need
// to keep a registry entry's bbox fresh.
export { trackElementBbox, pollForTaggedElement, UI_BRIDGE_ID_ATTR } from './bbox-tracker';

// Component hook
export {
  useUIComponent,
  useUIComponentAction,
  type ComponentActionDef,
  type ComputedPropertyDef,
  type UseUIComponentOptions,
  type UseUIComponentReturn,
} from './useUIComponent';

// Component scope — wraps subtrees so child elements auto-link to a component
export {
  UIBridgeComponentScope,
  useOwningComponent,
  type UIBridgeComponentScopeProps,
} from './UIBridgeComponentScope';

// Bridge hook
export { useUIBridge, useUIBridgeRequired, type UseUIBridgeReturn } from './useUIBridge';

// State management hooks
export {
  useUIState,
  useUIStateGroup,
  useActiveStates,
  useStateSnapshot,
  type UseUIStateOptions,
  type UseUIStateReturn,
  type UseUIStateGroupOptions,
  type UseUIStateGroupReturn,
} from './useUIState';

// Transition hook
export {
  useUITransition,
  useTransitions,
  useAvailableTransitions,
  type UseUITransitionOptions,
  type UseUITransitionReturn,
} from './useUITransition';

// Navigation hook
export {
  useUINavigation,
  useCanNavigateTo,
  useNavigationPath,
  type UseUINavigationReturn,
} from './useUINavigation';

// Auto-registration
export {
  useAutoRegister,
  UI_BRIDGE_PERSIST_ATTR,
  UI_BRIDGE_CONTENT_ATTR,
  UI_BRIDGE_ROLE_ATTR,
  UI_BRIDGE_TEST_ID_ATTR,
  type AutoRegisterOptions,
  type IdStrategy,
} from './useAutoRegister';

export { AutoRegisterProvider, type AutoRegisterProviderProps } from './AutoRegisterProvider';

// Content discovery
export { type ContentDiscoveryOptions } from './content-discovery';

// Media discovery
export { type MediaDiscoveryOptions } from './media-discovery';

// Annotation hook
export { useUIAnnotation } from './useUIAnnotation';

// Page/route awareness hooks
export { usePageContext } from './usePageContext';
export { useRouteAwareness } from './useRouteAwareness';

// Keyboard shortcut registration hook
export { useKeyboardShortcuts, type ShortcutDef } from './useKeyboardShortcuts';

// Relationship hooks
export { useUIRelationship, useUIRelationships } from './useUIRelationship';

// Drag-drop discovery hooks
export { useDragSource, useDropZone } from './useDragDrop';

// Undo/redo awareness hook
export { useUndoRedo } from './useUndoRedo';

// Command relay
export { useCommandRelay, type UseCommandRelayOptions } from './useCommandRelay';
export { CommandRelayListener, type CommandRelayListenerProps } from './CommandRelayListener';

// Capture-host pattern: stable outer host + iframe + echo input for driving
// automation loops through pages that would otherwise unmount the SDK.
export { useUIBridgeEcho, type UseUIBridgeEchoOptions } from './useUIBridgeEcho';
export {
  CaptureHostFrame,
  DEFAULT_CAPTURE_HOST_IDS,
  type CaptureHostFrameProps,
} from './CaptureHostFrame';

// Build-id watcher — detect when the server has shipped a new bundle and
// prompt connected tabs to refresh.
export { useBuildIdWatcher, type UseBuildIdWatcherOptions } from './useBuildIdWatcher';
