/**
 * UI Bridge Native - React
 *
 * React hooks and provider for React Native.
 */

export * from './UIBridgeNativeProvider';
export * from './useUIElement';
export * from './useUIComponent';
export * from './useUIBridge';
export * from './useAutoRegister';
export { useUIBridgeModal } from './useUIBridgeModal';
export type { UseUIBridgeModalOptions } from './useUIBridgeModal';
export { useUIBridgeToast, useToastRecorder } from './useUIBridgeToast';
export type { UseUIBridgeToastOptions, ToastRecorderInput } from './useUIBridgeToast';
export { State, TransitionTo } from './StateAnnotation';
export type { StateProps, TransitionToProps, StateAnnotationRequiredElement } from './StateAnnotation';
export { useRouteAwareness } from './useRouteAwareness';
export type { UseRouteAwarenessOptions } from './useRouteAwareness';
export {
  expoRouterPattern,
  expoRouterRouteStack,
  reactNavigationPattern,
  isExpoRouterUnmatched,
} from './routePattern';
export type { NavigationStateLike, ReactNavigationPatternOptions } from './routePattern';
