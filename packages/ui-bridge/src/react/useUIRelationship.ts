/**
 * useUIRelationship Hook
 *
 * Declares a semantic relationship between two UI elements.
 * The relationship is registered on mount and removed on unmount.
 *
 * @example
 * ```tsx
 * // Search input filters the results list
 * useUIRelationship('search-input', 'results-list', 'filters');
 *
 * // Tab activates a panel (bidirectional)
 * useUIRelationship('tab-settings', 'settings-panel', 'activates', {
 *   bidirectional: true,
 * });
 *
 * // With metadata
 * useUIRelationship('sort-dropdown', 'data-table', 'controls', {
 *   metadata: { field: 'sortOrder' },
 * });
 * ```
 */

import { useEffect, useRef } from 'react';
import { useUIBridgeOptional } from './UIBridgeProvider';
import type {
  RelationshipType,
  UseUIRelationshipOptions,
  InlineRelationship,
} from '../relationships/types';

/**
 * Declare a semantic relationship between two UI elements.
 *
 * The relationship is registered when the component mounts and
 * removed when it unmounts. If any parameter changes, the old
 * relationship is undeclared and the new one is declared.
 */
export function useUIRelationship(
  sourceId: string,
  targetId: string,
  type: RelationshipType,
  options?: UseUIRelationshipOptions
): void {
  const context = useUIBridgeOptional();

  useEffect(() => {
    if (!context?.relationshipTracker) return;

    context.relationshipTracker.declare(sourceId, targetId, type, options);

    return () => {
      context.relationshipTracker.undeclare(sourceId, targetId, type);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    context,
    sourceId,
    targetId,
    type,
    options?.bidirectional,
    // Serialize metadata to detect deep changes without re-running on every render
    options?.metadata ? JSON.stringify(options.metadata) : '',
  ]);
}

/**
 * useUIRelationships Hook
 *
 * Declares multiple relationships at once. Useful when an element has
 * many relationships.
 *
 * @example
 * ```tsx
 * useUIRelationships('save-button', [
 *   { target: 'name-input', type: 'submits' },
 *   { target: 'email-input', type: 'submits' },
 *   { target: 'form-status', type: 'populates' },
 * ]);
 * ```
 */
export function useUIRelationships(
  sourceId: string,
  relationships: Array<InlineRelationship>
): void {
  const context = useUIBridgeOptional();
  const prevRef = useRef<Array<InlineRelationship>>([]);

  // Serialize for dependency comparison
  const serialized = JSON.stringify(relationships);

  useEffect(() => {
    if (!context?.relationshipTracker) return;

    // Undeclare any previously declared relationships
    for (const rel of prevRef.current) {
      context.relationshipTracker.undeclare(sourceId, rel.target, rel.type);
    }

    // Declare all new relationships
    for (const rel of relationships) {
      const options: UseUIRelationshipOptions | undefined =
        rel.bidirectional !== undefined || rel.metadata !== undefined
          ? { bidirectional: rel.bidirectional, metadata: rel.metadata }
          : undefined;
      context.relationshipTracker.declare(sourceId, rel.target, rel.type, options);
    }

    // Track what we declared for cleanup
    prevRef.current = relationships;

    return () => {
      for (const rel of prevRef.current) {
        context.relationshipTracker.undeclare(sourceId, rel.target, rel.type);
      }
      prevRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, sourceId, serialized]);
}
