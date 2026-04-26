import { useEffect } from 'react';
import { useUIBridgeNative } from './UIBridgeNativeProvider';
import type { NativeModalInfo } from '../core/types';

export interface UseUIBridgeModalOptions {
  id: string;
  title?: string;
  type?: NativeModalInfo['type'];
  blocking?: boolean;
  dismissible?: boolean;
}

/**
 * Declarative hook: while mounted, registers a modal entry on the active
 * stack so UI Bridge snapshots reflect that a modal is open.
 */
export function useUIBridgeModal(opts: UseUIBridgeModalOptions): void {
  const { modalDetector } = useUIBridgeNative();
  const { id, title, type, blocking, dismissible } = opts;

  useEffect(() => {
    modalDetector.pushModal({ id, title, type, blocking, dismissible });
    return () => {
      modalDetector.dismissModal(id);
    };
  }, [modalDetector, id, title, type, blocking, dismissible]);
}
