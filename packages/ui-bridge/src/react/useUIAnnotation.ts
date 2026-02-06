/**
 * useUIAnnotation Hook
 *
 * Registers a semantic annotation for a UI element in the global annotation store.
 */

import { useEffect, useRef } from 'react';
import type { ElementAnnotation } from '../annotations';
import { getGlobalAnnotationStore } from '../annotations';

/**
 * Register a semantic annotation for a UI element.
 *
 * The annotation is set in the global annotation store and persists
 * across renders. It is NOT cleaned up on unmount because annotations
 * represent persistent developer knowledge about elements.
 *
 * @param elementId - The UI Bridge element ID to annotate
 * @param annotation - The annotation data
 *
 * @example Basic annotation for a button
 * ```tsx
 * function LoginButton() {
 *   useUIAnnotation('login-btn', {
 *     description: 'Primary login button',
 *     purpose: 'Submits the login form',
 *     tags: ['auth', 'primary-action'],
 *   });
 *
 *   return <button data-ui-id="login-btn">Log In</button>;
 * }
 * ```
 *
 * @example Annotations enrich the semantic snapshot
 * ```tsx
 * // When an element has an annotation, the semantic snapshot includes it.
 * // Without annotation, the snapshot only has DOM-derived information.
 * // With annotation, the snapshot gains human-authored context.
 *
 * function SearchBar() {
 *   useUIAnnotation('search-input', {
 *     description: 'Global search input',
 *     purpose: 'Searches across all projects and workflows',
 *     notes: 'Debounces input by 300ms. Supports advanced query syntax.',
 *     tags: ['search', 'global'],
 *     relatedElements: ['search-results-panel', 'search-clear-btn'],
 *   });
 *
 *   return <input data-ui-id="search-input" placeholder="Search..." />;
 * }
 *
 * // The annotation data is then available via:
 * //   GET /annotations/search-input
 * //   GET /annotations/export (in the full config)
 * //   store.get('search-input')
 * ```
 */
export function useUIAnnotation(elementId: string, annotation: ElementAnnotation): void {
  const serializedRef = useRef<string>('');

  useEffect(() => {
    const serialized = JSON.stringify(annotation);
    if (serialized !== serializedRef.current) {
      serializedRef.current = serialized;
      getGlobalAnnotationStore().set(elementId, annotation);
    }
  }, [elementId, annotation]);
}
