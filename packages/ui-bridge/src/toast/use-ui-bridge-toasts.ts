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

import { useEffect, useState } from 'react';
import { toastBuffer, type ToastEntry } from './ring-buffer';

/**
 * Read the live toast buffer as a React value. Re-renders on every
 * emit / markDismissed.
 */
export function useUIBridgeToasts(): ReadonlyArray<ToastEntry> {
  const [entries, setEntries] = useState<ReadonlyArray<ToastEntry>>(() => toastBuffer.getAll());
  useEffect(() => {
    const unsubscribe = toastBuffer.subscribe((next) => {
      setEntries(next);
    });
    // Capture any entries emitted between first render and effect attach.
    setEntries(toastBuffer.getAll());
    return unsubscribe;
  }, []);
  return entries;
}
