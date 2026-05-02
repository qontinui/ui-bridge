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

// Section 4 — build-time markers for IR extraction. Render Fragment; no
// native registry coupling. The extractor matches by JSX tag name.
export { State } from './State';
export type { StateProps, StateRequiredElement } from './State';
export { TransitionTo } from './TransitionTo';
export type { TransitionToProps } from './TransitionTo';
