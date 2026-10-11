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
export { useRouteAwareness } from './useRouteAwareness';
export type { UseRouteAwarenessOptions } from './useRouteAwareness';
export {
  expoRouterPattern,
  expoRouterRouteStack,
  reactNavigationPattern,
  isExpoRouterUnmatched,
} from './routePattern';
export type { NavigationStateLike, ReactNavigationPatternOptions } from './routePattern';
