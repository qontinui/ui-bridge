export { ToastCapture } from './toast-capture';
export type {
  ToastLevel,
  CapturedToast,
  ToastSnapshot,
  SnapshotToastContext,
  ToastCaptureConfig,
  ToastEventData,
} from './types';

// Explicit ring buffer for emitted toasts (queried via
// GET /ui-bridge/control/toasts).
export { ToastRingBuffer, toastBuffer, emitToast } from './ring-buffer';
export type {
  ToastKind,
  ToastEntry,
  EmitToastInput,
  ToastRingBufferOptions,
  ToastSubscriber,
} from './ring-buffer';

// React hook
export { useUIBridgeToasts } from './use-ui-bridge-toasts';
