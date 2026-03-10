/**
 * Relationship Tracker
 *
 * Manages element relationships from three sources:
 * 1. Developer-declared (via hooks): stored in an internal map
 * 2. ARIA auto-detected: scanned from DOM on demand
 * 3. HTML auto-detected: scanned from DOM on demand
 *
 * The tracker merges all sources and deduplicates when producing snapshots.
 */

import type { RelationshipType, ElementRelationship, SnapshotRelationshipContext } from './types';

/**
 * ARIA attribute to relationship type mapping.
 *
 * Some ARIA attributes express a "reverse" relationship where the target
 * is the actor (e.g., aria-labelledby means "target labels source"), so
 * we swap source and target for those.
 */
const ARIA_RELATIONSHIP_MAP: Array<{
  attribute: string;
  type: RelationshipType;
  /** If true, the relationship is reversed: target acts on source */
  reverse: boolean;
}> = [
  { attribute: 'aria-controls', type: 'controls', reverse: false },
  { attribute: 'aria-owns', type: 'owns', reverse: false },
  { attribute: 'aria-describedby', type: 'describes', reverse: true },
  { attribute: 'aria-labelledby', type: 'labels', reverse: true },
  { attribute: 'aria-activedescendant', type: 'activates', reverse: false },
  { attribute: 'aria-flowto', type: 'navigatesTo', reverse: false },
  { attribute: 'aria-errormessage', type: 'validates', reverse: true },
  { attribute: 'aria-details', type: 'describes', reverse: true },
];

/** Priority order for deduplication: lower index = higher priority */
const ORIGIN_PRIORITY: Record<string, number> = {
  declared: 0,
  aria: 1,
  html: 2,
};

export class RelationshipTracker {
  /**
   * Developer-declared relationships, keyed by `${source}|${target}|${type}`.
   */
  private declared = new Map<string, ElementRelationship>();

  /**
   * Cached auto-detected relationships from the last `refreshAutoDetected()` call.
   * Used by AutoRegisterProvider so ARIA/HTML scanning happens once per batch
   * rather than on every snapshot request.
   */
  private cachedAutoDetected: ElementRelationship[] = [];

  // ---------------------------------------------------------------------------
  // Developer-declared relationship management
  // ---------------------------------------------------------------------------

  /**
   * Declare a relationship between two elements.
   *
   * If a relationship with the same source, target, and type already exists it
   * is overwritten.
   */
  declare(
    source: string,
    target: string,
    type: RelationshipType,
    options?: { bidirectional?: boolean; metadata?: Record<string, unknown> }
  ): void {
    const key = `${source}|${target}|${type}`;
    const relationship: ElementRelationship = {
      source,
      target,
      type,
      origin: 'declared',
      ...(options?.bidirectional != null && { bidirectional: options.bidirectional }),
      ...(options?.metadata != null && { metadata: options.metadata }),
    };
    this.declared.set(key, relationship);
  }

  /**
   * Remove a declared relationship.
   *
   * If `type` is provided, removes only that specific relationship.
   * Otherwise removes ALL relationships between source and target.
   */
  undeclare(source: string, target: string, type?: RelationshipType): void {
    if (type != null) {
      this.declared.delete(`${source}|${target}|${type}`);
    } else {
      for (const key of [...this.declared.keys()]) {
        if (key.startsWith(`${source}|${target}|`)) {
          this.declared.delete(key);
        }
      }
    }
  }

  /**
   * Remove ALL relationships where `elementId` appears as source OR target.
   *
   * Useful for cleanup when an element unmounts.
   */
  undeclareAll(elementId: string): void {
    for (const [key, rel] of [...this.declared.entries()]) {
      if (rel.source === elementId || rel.target === elementId) {
        this.declared.delete(key);
      }
    }
  }

  /**
   * Return all developer-declared relationships.
   */
  getDeclared(): ElementRelationship[] {
    return [...this.declared.values()];
  }

  // ---------------------------------------------------------------------------
  // ARIA auto-detection
  // ---------------------------------------------------------------------------

  /**
   * Scan the DOM for ARIA relationship attributes among the provided elements.
   *
   * Only relationships where both source and target are in the provided element
   * list are included.
   *
   * @param elements - Registered elements with their DOM nodes
   * @returns Detected ARIA relationships
   */
  scanARIARelationships(elements: Array<{ id: string; element: Element }>): ElementRelationship[] {
    if (typeof document === 'undefined') {
      return [];
    }

    // Build a reverse lookup: DOM element -> bridge element ID
    const domToBridgeId = new WeakMap<Element, string>();
    for (const entry of elements) {
      domToBridgeId.set(entry.element, entry.id);
    }

    // Also index by HTML id attribute for resolving ARIA references
    const htmlIdToBridgeId = new Map<string, string>();
    for (const entry of elements) {
      const htmlId = entry.element.id;
      if (htmlId) {
        htmlIdToBridgeId.set(htmlId, entry.id);
      }
    }

    const results: ElementRelationship[] = [];

    for (const entry of elements) {
      const sourceBridgeId = entry.id;
      const el = entry.element;

      for (const mapping of ARIA_RELATIONSHIP_MAP) {
        const attrValue = el.getAttribute(mapping.attribute);
        if (!attrValue) continue;

        // ARIA attributes can reference space-separated ID lists
        const referencedIds = attrValue.trim().split(/\s+/);

        for (const refId of referencedIds) {
          // Resolve the ARIA DOM id reference to a bridge element ID
          let targetBridgeId = htmlIdToBridgeId.get(refId);

          if (!targetBridgeId) {
            // Try finding the DOM element directly and checking the WeakMap
            const targetEl = document.getElementById(refId);
            if (targetEl) {
              targetBridgeId = domToBridgeId.get(targetEl);
            }
          }

          if (!targetBridgeId) continue;

          if (mapping.reverse) {
            // Target acts on source (e.g., "target labels source")
            results.push({
              source: targetBridgeId,
              target: sourceBridgeId,
              type: mapping.type,
              origin: 'aria',
            });
          } else {
            results.push({
              source: sourceBridgeId,
              target: targetBridgeId,
              type: mapping.type,
              origin: 'aria',
            });
          }
        }
      }
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // HTML auto-detection
  // ---------------------------------------------------------------------------

  /**
   * Scan the DOM for HTML structural relationships among the provided elements.
   *
   * Detects:
   * - `<label for="id">` explicit label associations
   * - `<label>` wrapping an input (implicit label association)
   *
   * @param elements - Registered elements with their DOM nodes
   * @returns Detected HTML relationships
   */
  scanHTMLRelationships(elements: Array<{ id: string; element: Element }>): ElementRelationship[] {
    if (typeof document === 'undefined') {
      return [];
    }

    // Build reverse lookups
    const domToBridgeId = new WeakMap<Element, string>();
    for (const entry of elements) {
      domToBridgeId.set(entry.element, entry.id);
    }

    const htmlIdToBridgeId = new Map<string, string>();
    for (const entry of elements) {
      const htmlId = entry.element.id;
      if (htmlId) {
        htmlIdToBridgeId.set(htmlId, entry.id);
      }
    }

    const results: ElementRelationship[] = [];

    for (const entry of elements) {
      const el = entry.element;

      // Only process <label> elements
      if (el.tagName !== 'LABEL') continue;

      const labelBridgeId = entry.id;
      const labelEl = el as HTMLLabelElement;

      // Explicit: <label for="targetId">
      const forAttr = labelEl.getAttribute('for');
      if (forAttr) {
        let targetBridgeId = htmlIdToBridgeId.get(forAttr);

        if (!targetBridgeId) {
          const targetEl = document.getElementById(forAttr);
          if (targetEl) {
            targetBridgeId = domToBridgeId.get(targetEl);
          }
        }

        if (targetBridgeId) {
          results.push({
            source: labelBridgeId,
            target: targetBridgeId,
            type: 'labels',
            origin: 'html',
          });
        }
      } else {
        // Implicit: <label> wrapping an input
        const wrappedInput = labelEl.querySelector('input, select, textarea, [contenteditable]');
        if (wrappedInput) {
          const inputBridgeId = domToBridgeId.get(wrappedInput);
          if (inputBridgeId) {
            results.push({
              source: labelBridgeId,
              target: inputBridgeId,
              type: 'labels',
              origin: 'html',
            });
          }
        }
      }
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Auto-detection cache (used by AutoRegisterProvider)
  // ---------------------------------------------------------------------------

  /**
   * Re-scan ARIA and HTML relationships for the given elements and cache the
   * results. Subsequent calls to `getRelationships()` without an `elements`
   * argument will include these cached auto-detected relationships.
   *
   * This is called automatically by `useAutoRegister` after each batch of
   * element registrations, making ARIA/HTML relationship data "free" for
   * AutoRegisterProvider users without per-snapshot DOM scanning.
   */
  refreshAutoDetected(elements: Array<{ id: string; element: Element }>): void {
    const aria = this.scanARIARelationships(elements);
    const html = this.scanHTMLRelationships(elements);
    this.cachedAutoDetected = [...aria, ...html];
  }

  /**
   * Clear the auto-detected relationship cache.
   */
  clearAutoDetected(): void {
    this.cachedAutoDetected = [];
  }

  // ---------------------------------------------------------------------------
  // Merged output
  // ---------------------------------------------------------------------------

  /**
   * Return all relationships (declared + ARIA + HTML), deduplicated.
   *
   * When the same source+target+type exists from multiple origins, the one
   * with the highest priority is kept: declared > aria > html.
   *
   * @param elements - Optional registered elements for on-demand auto-detection
   *   scanning. If omitted, uses cached auto-detected relationships (from
   *   `refreshAutoDetected()`) plus declared relationships.
   */
  getRelationships(elements?: Array<{ id: string; element: Element }>): ElementRelationship[] {
    const declared = this.getDeclared();

    let aria: ElementRelationship[];
    let html: ElementRelationship[];

    if (elements) {
      // On-demand scanning (explicit element list provided)
      aria = this.scanARIARelationships(elements);
      html = this.scanHTMLRelationships(elements);
    } else {
      // Use cached auto-detected results
      aria = this.cachedAutoDetected;
      html = [];
    }

    const all = [...declared, ...aria, ...html];

    // Deduplicate: keep highest priority per source|target|type key
    const best = new Map<string, ElementRelationship>();

    for (const rel of all) {
      const key = `${rel.source}|${rel.target}|${rel.type}`;
      const existing = best.get(key);

      if (!existing || ORIGIN_PRIORITY[rel.origin] < ORIGIN_PRIORITY[existing.origin]) {
        best.set(key, rel);
      }
    }

    return [...best.values()];
  }

  /**
   * Return the snapshot relationship context for ControlSnapshot integration.
   */
  getSnapshotRelationshipContext(
    elements?: Array<{ id: string; element: Element }>
  ): SnapshotRelationshipContext {
    const relationships = this.getRelationships(elements);

    const byOrigin = { declared: 0, aria: 0, html: 0 };
    for (const rel of relationships) {
      if (rel.origin in byOrigin) {
        byOrigin[rel.origin as keyof typeof byOrigin]++;
      }
    }

    return {
      relationships,
      count: relationships.length,
      byOrigin,
    };
  }

  // ---------------------------------------------------------------------------
  // Query helpers
  // ---------------------------------------------------------------------------

  /**
   * Return all relationships where `elementId` is source OR target.
   */
  getRelationshipsFor(
    elementId: string,
    elements?: Array<{ id: string; element: Element }>
  ): ElementRelationship[] {
    return this.getRelationships(elements).filter(
      (rel) => rel.source === elementId || rel.target === elementId
    );
  }

  /**
   * Return IDs of elements related to `elementId`, optionally filtered by type.
   *
   * If `elementId` is the source, returns the target IDs (and vice versa).
   */
  getRelatedElements(
    elementId: string,
    type?: RelationshipType,
    elements?: Array<{ id: string; element: Element }>
  ): string[] {
    const rels = this.getRelationshipsFor(elementId, elements);
    const filtered = type != null ? rels.filter((r) => r.type === type) : rels;

    const ids = new Set<string>();
    for (const rel of filtered) {
      if (rel.source === elementId) {
        ids.add(rel.target);
      } else {
        ids.add(rel.source);
      }
    }

    return [...ids];
  }
}
