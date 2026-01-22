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
