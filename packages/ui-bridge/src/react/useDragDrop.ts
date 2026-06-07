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

import { useEffect, useRef } from 'react';
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
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Serialize metadata so the effect re-runs on deep changes without
  // re-running on every render (object identity churn). The primitive
  // fields and this key are the re-fire triggers; the latest option
  // values are read from optionsRef inside the effect.
  const dataType = options?.dataType;
  const label = options?.label;
  const metadataKey = options?.metadata ? JSON.stringify(options.metadata) : '';

  useEffect(() => {
    if (!context?.dragDropDetector) return;

    const opts = optionsRef.current;
    context.dragDropDetector.declareDragSource(elementId, {
      dataType: opts?.dataType,
      label: opts?.label,
      metadata: opts?.metadata,
    });

    return () => {
      context.dragDropDetector.undeclareDragSource(elementId);
    };
  }, [context, elementId, dataType, label, metadataKey]);
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
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Serialize accepts/metadata so the effect re-runs on deep changes
  // without re-running on every render. These keys plus the primitive
  // fields are the re-fire triggers; latest values are read from
  // optionsRef inside the effect.
  const acceptsKey = options?.accepts ? JSON.stringify(options.accepts) : '';
  const effect = options?.effect;
  const label = options?.label;
  const metadataKey = options?.metadata ? JSON.stringify(options.metadata) : '';

  useEffect(() => {
    if (!context?.dragDropDetector) return;

    const opts = optionsRef.current;
    context.dragDropDetector.declareDropZone(elementId, {
      accepts: opts?.accepts,
      effect: opts?.effect,
      label: opts?.label,
      metadata: opts?.metadata,
    });

    return () => {
      context.dragDropDetector.undeclareDropZone(elementId);
    };
  }, [context, elementId, acceptsKey, effect, label, metadataKey]);
}
