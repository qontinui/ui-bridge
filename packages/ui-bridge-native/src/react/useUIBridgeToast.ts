import { useCallback, useEffect } from 'react';
import { useUIBridgeNative } from './UIBridgeNativeProvider';
import type { NativeCapturedToast } from '../core/types';

export interface UseUIBridgeToastOptions {
  id: string;
  message: string;
  level?: NativeCapturedToast['level'];
}

/**
 * Declarative hook: while mounted, surfaces a toast via the snapshot enricher.
 * Best for explicit-lifecycle toast components.
 */
export function useUIBridgeToast(opts: UseUIBridgeToastOptions): void {
  const { toastCapture } = useUIBridgeNative();
  const { id, message, level } = opts;

  useEffect(() => {
    toastCapture.recordToast({ id, message, level });
    return () => {
      toastCapture.dismissToast(id);
    };
  }, [toastCapture, id, message, level]);
}

export interface ToastRecorderInput {
  id: string;
  message: string;
  level?: NativeCapturedToast['level'];
}

/**
 * Imperative hook: returns a `recordToast` callback for code that fires
 * toasts outside React (catch blocks, library callbacks, etc.).
 */
export function useToastRecorder(): {
  recordToast: (toast: ToastRecorderInput) => void;
  dismissToast: (id: string) => void;
} {
  const { toastCapture } = useUIBridgeNative();
  const recordToast = useCallback(
    (toast: ToastRecorderInput) => {
      toastCapture.recordToast(toast);
    },
    [toastCapture]
  );
  const dismissToast = useCallback((id: string) => toastCapture.dismissToast(id), [toastCapture]);
  return { recordToast, dismissToast };
}
