/**
 * useDragSource / useDropZone Hooks
 *
 * Declare drag sources and drop zones for AI-driven drag-and-drop discovery.
 * Declarations are registered on mount and removed on unmount.
 *
 * @example
 * ```tsx
 * // Mark a sortable item as a drag source
 * useDragSource('step-3', { dataType: 'workflow-step' });
 *
 * // Mark a list as a drop zone that accepts workflow steps
 * useDropZone('step-list', {
 *   accepts: ['workflow-step'],
 *   effect: 'reorder',
 * });
 * ```
 */

import { useEffect } from 'react';
import { useUIBridgeOptional } from './UIBridgeProvider';
import type { UseDragSourceOptions, UseDropZoneOptions } from '../drag-drop/types';

/**
 * Declare an element as a drag source.
 *
 * The declaration is registered when the component mounts and
 * removed when it unmounts. If parameters change, the old
 * declaration is replaced.
 */
export function useDragSource(elementId: string, options?: UseDragSourceOptions): void {
  const context = useUIBridgeOptional();

  useEffect(() => {
    if (!context?.dragDropDetector) return;

    context.dragDropDetector.declareDragSource(elementId, {
      dataType: options?.dataType,
      label: options?.label,
      metadata: options?.metadata,
    });

    return () => {
      context.dragDropDetector.undeclareDragSource(elementId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    context,
    elementId,
    options?.dataType,
    options?.label,
    options?.metadata ? JSON.stringify(options.metadata) : '',
  ]);
}

/**
 * Declare an element as a drop zone.
 *
 * The declaration is registered when the component mounts and
 * removed when it unmounts. If parameters change, the old
 * declaration is replaced.
 */
export function useDropZone(elementId: string, options?: UseDropZoneOptions): void {
  const context = useUIBridgeOptional();

  useEffect(() => {
    if (!context?.dragDropDetector) return;

    context.dragDropDetector.declareDropZone(elementId, {
      accepts: options?.accepts,
      effect: options?.effect,
      label: options?.label,
      metadata: options?.metadata,
    });

    return () => {
      context.dragDropDetector.undeclareDropZone(elementId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    context,
    elementId,
    options?.accepts ? JSON.stringify(options.accepts) : '',
    options?.effect,
    options?.label,
    options?.metadata ? JSON.stringify(options.metadata) : '',
  ]);
}
