/**
 * `useWrapperStatus`
 *
 * Subscribe to a transport's status transitions. Returns the current
 * status string; re-renders whenever the transport fires `onStatusChange`.
 * Uses `useSyncExternalStore` for tearing-free updates under React 18+
 * concurrent rendering.
 */

import { useSyncExternalStore } from 'react';
import type { WrapperTransport, WrapperTransportStatus } from '../types.js';

export function useWrapperStatus(transport: WrapperTransport): WrapperTransportStatus {
  return useSyncExternalStore(
    (onStoreChange) => transport.onStatusChange(() => onStoreChange()),
    () => transport.status,
    () => transport.status
  );
}
