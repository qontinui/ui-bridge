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

// Build-time IR markers — Fragment-rendering JSX wrappers consumed by the
// ui-bridge-auto extractor. They do NOT couple to the native registry; they
// exist so the build-time IR pipeline has stable JSX tags to match.
export { State, type StateProps, type StateRequiredElement } from './State';
export { TransitionTo, type TransitionToProps } from './TransitionTo';
