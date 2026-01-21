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

// Component hook
export {
  useUIComponent,
  useUIComponentAction,
  type ComponentActionDef,
  type UseUIComponentOptions,
  type UseUIComponentReturn,
} from './useUIComponent';

// Bridge hook
export {
  useUIBridge,
  useUIBridgeRequired,
  type UseUIBridgeReturn,
} from './useUIBridge';
