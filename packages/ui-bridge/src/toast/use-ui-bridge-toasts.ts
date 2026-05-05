/**
 * useUIBridgeToasts — React hook that mirrors the toast ring buffer into
 * React state so consumers can render lists of captured toasts, or wire the
 * buffer into their own toast library's lifecycle callbacks.
 *
 * Two integration patterns:
 *
 * 1. **Library lifecycle wiring** (sonner, react-hot-toast) — pass
 *    `{ message, kind }` into the library's `<Toaster onCreate>` /
 *    `onDismiss` hooks and also call `emitToast(...)` + `markDismissed(id)`.
 *    Typically handled once per app:
 *
 *    ```tsx
 *    <Toaster
 *      onCreate={(t) => emitToast({ id: String(t.id), message: t.message, kind: t.type })}
 *      onDismiss={(t) => toastBuffer.markDismissed(String(t.id))}
 *    />
 *    ```
 *
 * 2. **Inline status banners** — the component renders its own banner (e.g.
 *    `setStatus({kind:'success', message:'Registered'})`); call `emitToast`
 *    in the same effect that sets the status:
 *
 *    ```tsx
 *    setStatus({ kind, message });
 *    emitToast({ kind, message });
 *    ```
 */

import { useSyncExternalStore } from 'react';
import { toastBuffer, type ToastEntry } from './ring-buffer';

/**
 * Cache the most recently observed snapshot so useSyncExternalStore sees a
 * stable identity between renders unless an actual mutation has notified.
 * `getAll()` returns a fresh array each call, which would otherwise trip
 * React's "getSnapshot should be cached" warning.
 */
let cachedSnapshot: ReadonlyArray<ToastEntry> = toastBuffer.getAll();
let snapshotDirty = false;

const subscribe = (onChange: () => void): (() => void) => {
  const unsubscribe = toastBuffer.subscribe(() => {
    snapshotDirty = true;
    onChange();
  });
  return unsubscribe;
};

const getSnapshot = (): ReadonlyArray<ToastEntry> => {
  if (snapshotDirty) {
    cachedSnapshot = toastBuffer.getAll();
    snapshotDirty = false;
  }
  return cachedSnapshot;
};

const getServerSnapshot = (): ReadonlyArray<ToastEntry> => cachedSnapshot;

/**
 * Read the live toast buffer as a React value. Re-renders on every
 * emit / markDismissed.
 */
export function useUIBridgeToasts(): ReadonlyArray<ToastEntry> {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
