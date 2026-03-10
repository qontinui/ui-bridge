/**
 * Drag-and-Drop Detector
 *
 * Detects drag sources and drop zones from three sources:
 * 1. Developer-declared (via hooks): stored in internal maps
 * 2. ARIA auto-detected: aria-grabbed, aria-dropeffect
 * 3. DOM auto-detected: draggable attribute, cursor-grab CSS, structural heuristics
 *
 * Follows the same pattern as RelationshipTracker: developer declarations are
 * stored persistently, while auto-detected results are cached after batch
 * registration via refreshAutoDetected().
 */

import type {
  DragDropOrigin,
  DragSourceInfo,
  DropZoneInfo,
  SnapshotDragDropContext,
} from './types';

/** Priority order for deduplication: lower index = higher priority */
const ORIGIN_PRIORITY: Record<DragDropOrigin, number> = {
  declared: 0,
  aria: 1,
  dom: 2,
};

/**
 * CSS classes that indicate a drag handle or draggable element.
 * Covers Tailwind utility classes and common CSS conventions.
 */
const GRAB_CURSOR_CLASSES = ['cursor-grab', 'cursor-grabbing', 'cursor-move'];

/**
 * CSS computed cursor values that indicate draggability.
 */
const GRAB_CURSOR_VALUES = ['grab', 'grabbing', 'move'];

/**
 * ARIA dropeffect values and their mapped DragEffect types.
 */
const ARIA_DROP_EFFECT_MAP: Record<string, string> = {
  copy: 'copy',
  move: 'move',
  link: 'link',
  execute: 'move',
  popup: 'move',
};

export class DragDropDetector {
  /**
   * Developer-declared drag sources, keyed by element ID.
   */
  private declaredSources = new Map<string, DragSourceInfo>();

  /**
   * Developer-declared drop zones, keyed by element ID.
   */
  private declaredZones = new Map<string, DropZoneInfo>();

  /**
   * Cached auto-detected drag sources from the last refreshAutoDetected() call.
   */
  private cachedAutoSources: DragSourceInfo[] = [];

  /**
   * Cached auto-detected drop zones from the last refreshAutoDetected() call.
   */
  private cachedAutoZones: DropZoneInfo[] = [];

  // ---------------------------------------------------------------------------
  // Developer-declared drag source management
  // ---------------------------------------------------------------------------

  /**
   * Declare an element as a drag source.
   */
  declareDragSource(
    id: string,
    options?: {
      dataType?: string;
      label?: string;
      metadata?: Record<string, unknown>;
    }
  ): void {
    this.declaredSources.set(id, {
      id,
      label: options?.label,
      dataType: options?.dataType,
      origin: 'declared',
      nativeDraggable: false,
      hasGrabCursor: false,
      ...(options?.metadata != null && { metadata: options.metadata }),
    });
  }

  /**
   * Remove a declared drag source.
   */
  undeclareDragSource(id: string): void {
    this.declaredSources.delete(id);
  }

  /**
   * Declare an element as a drop zone.
   */
  declareDropZone(
    id: string,
    options?: {
      accepts?: string[];
      effect?: string;
      label?: string;
      metadata?: Record<string, unknown>;
    }
  ): void {
    this.declaredZones.set(id, {
      id,
      label: options?.label,
      accepts: options?.accepts,
      effect: options?.effect,
      origin: 'declared',
      isSortable: false,
      ...(options?.metadata != null && { metadata: options.metadata }),
    });
  }

  /**
   * Remove a declared drop zone.
   */
  undeclareDropZone(id: string): void {
    this.declaredZones.delete(id);
  }

  /**
   * Remove ALL declarations where `elementId` appears.
   * Useful for cleanup when an element unmounts.
   */
  undeclareAll(elementId: string): void {
    this.declaredSources.delete(elementId);
    this.declaredZones.delete(elementId);
  }

  // ---------------------------------------------------------------------------
  // Auto-detection: ARIA
  // ---------------------------------------------------------------------------

  /**
   * Scan elements for ARIA drag-drop attributes.
   *
   * Detects:
   * - `aria-grabbed="true"` → drag source
   * - `aria-dropeffect` → drop zone
   */
  scanARIA(elements: Array<{ id: string; element: Element }>): {
    sources: DragSourceInfo[];
    zones: DropZoneInfo[];
  } {
    const sources: DragSourceInfo[] = [];
    const zones: DropZoneInfo[] = [];

    for (const { id, element } of elements) {
      // aria-grabbed indicates a drag source
      const ariaGrabbed = element.getAttribute('aria-grabbed');
      if (ariaGrabbed === 'true' || ariaGrabbed === 'false') {
        sources.push({
          id,
          label: this.extractLabel(element),
          origin: 'aria',
          nativeDraggable: element.getAttribute('draggable') === 'true',
          hasGrabCursor: false,
        });
      }

      // aria-dropeffect indicates a drop zone
      const ariaDropEffect = element.getAttribute('aria-dropeffect');
      if (ariaDropEffect && ariaDropEffect !== 'none') {
        const effects = ariaDropEffect.trim().split(/\s+/);
        const mappedEffect = ARIA_DROP_EFFECT_MAP[effects[0]] || effects[0];

        zones.push({
          id,
          label: this.extractLabel(element),
          effect: mappedEffect,
          origin: 'aria',
          ariaDropEffect,
          isSortable: false,
        });
      }
    }

    return { sources, zones };
  }

  // ---------------------------------------------------------------------------
  // Auto-detection: DOM / CSS heuristics
  // ---------------------------------------------------------------------------

  /**
   * Scan elements for DOM-based drag-drop indicators.
   *
   * Detects:
   * - `draggable="true"` attribute
   * - CSS grab/move cursor classes or computed styles
   * - Structural heuristic: containers with multiple draggable children → sortable drop zone
   */
  scanDOM(elements: Array<{ id: string; element: Element }>): {
    sources: DragSourceInfo[];
    zones: DropZoneInfo[];
  } {
    const sources: DragSourceInfo[] = [];
    const zones: DropZoneInfo[] = [];

    // Track which elements are drag sources for the structural heuristic
    const dragSourceElements = new Set<Element>();
    const elementIdMap = new Map<Element, string>();

    for (const { id, element } of elements) {
      elementIdMap.set(element, id);
    }

    // Pass 1: Identify drag sources
    for (const { id, element } of elements) {
      const isDraggable = this.isDragSource(element);
      if (isDraggable.isDragSource) {
        sources.push({
          id,
          label: this.extractLabel(element),
          origin: 'dom',
          nativeDraggable: isDraggable.nativeDraggable,
          hasGrabCursor: isDraggable.hasGrabCursor,
        });
        dragSourceElements.add(element);
      }
    }

    // Pass 2: Identify drop zones via structural heuristic
    // A container is a drop zone if it has 2+ draggable children among the registered elements
    for (const { id, element } of elements) {
      // Skip elements that are themselves drag sources
      if (dragSourceElements.has(element)) continue;

      const containedSourceIds: string[] = [];
      for (const sourceEl of dragSourceElements) {
        if (element.contains(sourceEl) && sourceEl !== element) {
          const sourceId = elementIdMap.get(sourceEl);
          if (sourceId) {
            containedSourceIds.push(sourceId);
          }
        }
      }

      if (containedSourceIds.length >= 2) {
        // Check if this is the most specific container
        // (skip if there's a closer registered ancestor that also contains these sources)
        const isDirectContainer = !this.hasCloserRegisteredContainer(
          element,
          containedSourceIds,
          elementIdMap,
          dragSourceElements
        );

        if (isDirectContainer) {
          const isList = this.looksLikeList(element);
          zones.push({
            id,
            label: this.extractLabel(element),
            origin: 'dom',
            isSortable: true,
            containedDragSources: containedSourceIds,
            ...(isList && { effect: 'reorder' }),
          });
        }
      }
    }

    return { sources, zones };
  }

  /**
   * Check if an element is a drag source based on DOM/CSS indicators.
   */
  private isDragSource(element: Element): {
    isDragSource: boolean;
    nativeDraggable: boolean;
    hasGrabCursor: boolean;
  } {
    const nativeDraggable = element.getAttribute('draggable') === 'true';

    // Check CSS classes for grab cursor
    const hasGrabClass = GRAB_CURSOR_CLASSES.some((cls) => element.classList.contains(cls));

    // Check computed style for grab cursor (more expensive, only if no class match)
    let hasGrabComputed = false;
    if (!hasGrabClass && element instanceof HTMLElement) {
      try {
        const computed = window.getComputedStyle(element);
        hasGrabComputed = GRAB_CURSOR_VALUES.includes(computed.cursor);
      } catch {
        // getComputedStyle can fail in some edge cases
      }
    }

    const hasGrabCursor = hasGrabClass || hasGrabComputed;

    const isDragSource = nativeDraggable || hasGrabCursor;

    return { isDragSource, nativeDraggable, hasGrabCursor };
  }

  /**
   * Check if there's a closer registered container between `container` and
   * its draggable children. Walks up from each drag source toward `container`
   * looking for intermediate registered non-drag-source elements.
   *
   * O(depth × sources) instead of O(n³).
   */
  private hasCloserRegisteredContainer(
    container: Element,
    _containedSourceIds: string[],
    elementIdMap: Map<Element, string>,
    dragSourceElements: Set<Element>
  ): boolean {
    // Count how many drag sources each intermediate container has
    const intermediateCounts = new Map<Element, number>();

    for (const sourceEl of dragSourceElements) {
      if (!container.contains(sourceEl)) continue;

      // Walk up from drag source toward container
      let current = sourceEl.parentElement;
      while (current && current !== container) {
        // If this ancestor is a registered element and not itself a drag source,
        // it's an intermediate container
        if (elementIdMap.has(current) && !dragSourceElements.has(current)) {
          const count = (intermediateCounts.get(current) ?? 0) + 1;
          if (count >= 2) return true;
          intermediateCounts.set(current, count);
        }
        current = current.parentElement;
      }
    }

    return false;
  }

  /**
   * Heuristic: does this element look like a list/sortable container?
   */
  private looksLikeList(element: Element): boolean {
    const role = element.getAttribute('role');
    if (role === 'list' || role === 'listbox' || role === 'group') {
      return true;
    }
    const tag = element.tagName.toLowerCase();
    if (tag === 'ul' || tag === 'ol') {
      return true;
    }
    return false;
  }

  /**
   * Extract a human-readable label from an element.
   */
  private extractLabel(element: Element): string | undefined {
    // Priority: aria-label > aria-labelledby text > data-testid > text content
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel;

    const testId = element.getAttribute('data-testid');
    if (testId) return testId;

    // Short text content (skip if too long — likely a container)
    if (element instanceof HTMLElement) {
      const text = element.textContent?.trim();
      if (text && text.length <= 60 && text.length > 0) {
        return text;
      }
    }

    return undefined;
  }

  // ---------------------------------------------------------------------------
  // Auto-detection cache (used by AutoRegisterProvider)
  // ---------------------------------------------------------------------------

  /**
   * Re-scan ARIA and DOM drag-drop indicators for the given elements and
   * cache the results. Called automatically by useAutoRegister after each
   * batch of element registrations.
   */
  refreshAutoDetected(elements: Array<{ id: string; element: Element }>): void {
    const aria = this.scanARIA(elements);
    const dom = this.scanDOM(elements);
    this.cachedAutoSources = [...aria.sources, ...dom.sources];
    this.cachedAutoZones = [...aria.zones, ...dom.zones];
  }

  /**
   * Clear the auto-detected cache.
   */
  clearAutoDetected(): void {
    this.cachedAutoSources = [];
    this.cachedAutoZones = [];
  }

  // ---------------------------------------------------------------------------
  // Merged output
  // ---------------------------------------------------------------------------

  /**
   * Return all drag sources (declared + auto-detected), deduplicated.
   * Declared sources take priority over auto-detected ones.
   */
  getDragSources(elements?: Array<{ id: string; element: Element }>): DragSourceInfo[] {
    const declared = [...this.declaredSources.values()];

    let auto: DragSourceInfo[];
    if (elements) {
      const aria = this.scanARIA(elements);
      const dom = this.scanDOM(elements);
      auto = [...aria.sources, ...dom.sources];
    } else {
      auto = this.cachedAutoSources;
    }

    return this.deduplicateSources([...declared, ...auto]);
  }

  /**
   * Return all drop zones (declared + auto-detected), deduplicated.
   * Declared zones take priority over auto-detected ones.
   */
  getDropZones(elements?: Array<{ id: string; element: Element }>): DropZoneInfo[] {
    const declared = [...this.declaredZones.values()];

    let auto: DropZoneInfo[];
    if (elements) {
      const aria = this.scanARIA(elements);
      const dom = this.scanDOM(elements);
      auto = [...aria.zones, ...dom.zones];
    } else {
      auto = this.cachedAutoZones;
    }

    return this.deduplicateZones([...declared, ...auto]);
  }

  /**
   * Return the snapshot context for ControlSnapshot integration.
   */
  getSnapshotDragDropContext(
    elements?: Array<{ id: string; element: Element }>
  ): SnapshotDragDropContext {
    const dragSources = this.getDragSources(elements);
    const dropZones = this.getDropZones(elements);

    const byOrigin = { declared: 0, aria: 0, dom: 0 };
    for (const source of dragSources) {
      if (source.origin in byOrigin) {
        byOrigin[source.origin as keyof typeof byOrigin]++;
      }
    }
    for (const zone of dropZones) {
      if (zone.origin in byOrigin) {
        byOrigin[zone.origin as keyof typeof byOrigin]++;
      }
    }

    return {
      dragSources,
      dropZones,
      count: {
        dragSources: dragSources.length,
        dropZones: dropZones.length,
      },
      byOrigin,
    };
  }

  // ---------------------------------------------------------------------------
  // Query helpers
  // ---------------------------------------------------------------------------

  /**
   * Get drop zones that accept a given data type.
   */
  getDropZonesForType(
    dataType: string,
    elements?: Array<{ id: string; element: Element }>
  ): DropZoneInfo[] {
    return this.getDropZones(elements).filter((zone) => {
      // If no accepts constraint, it potentially accepts anything
      if (!zone.accepts || zone.accepts.length === 0) return true;
      return zone.accepts.includes(dataType);
    });
  }

  /**
   * Get drag sources contained within a specific drop zone.
   */
  getDragSourcesInZone(
    zoneId: string,
    elements?: Array<{ id: string; element: Element }>
  ): DragSourceInfo[] {
    const zone = this.getDropZones(elements).find((z) => z.id === zoneId);
    if (!zone?.containedDragSources) return [];

    const contained = new Set(zone.containedDragSources);
    return this.getDragSources(elements).filter((s) => contained.has(s.id));
  }

  // ---------------------------------------------------------------------------
  // Deduplication
  // ---------------------------------------------------------------------------

  private deduplicateSources(sources: DragSourceInfo[]): DragSourceInfo[] {
    const best = new Map<string, DragSourceInfo>();
    for (const source of sources) {
      const existing = best.get(source.id);
      if (!existing) {
        best.set(source.id, source);
      } else if (ORIGIN_PRIORITY[source.origin] < ORIGIN_PRIORITY[existing.origin]) {
        // New source has higher priority — use it as base, merge flags from existing
        best.set(source.id, {
          ...existing,
          ...source,
          nativeDraggable: source.nativeDraggable || existing.nativeDraggable,
          hasGrabCursor: source.hasGrabCursor || existing.hasGrabCursor,
        });
      } else {
        // Existing has higher priority — keep it as base, merge flags from new
        best.set(source.id, {
          ...existing,
          nativeDraggable: existing.nativeDraggable || source.nativeDraggable,
          hasGrabCursor: existing.hasGrabCursor || source.hasGrabCursor,
        });
      }
    }
    return [...best.values()];
  }

  private deduplicateZones(zones: DropZoneInfo[]): DropZoneInfo[] {
    const best = new Map<string, DropZoneInfo>();
    for (const zone of zones) {
      const existing = best.get(zone.id);
      if (!existing) {
        best.set(zone.id, zone);
      } else if (ORIGIN_PRIORITY[zone.origin] < ORIGIN_PRIORITY[existing.origin]) {
        // New zone has higher priority — use it as base, merge flags from existing
        best.set(zone.id, {
          ...existing,
          ...zone,
          isSortable: zone.isSortable || existing.isSortable,
          containedDragSources: zone.containedDragSources || existing.containedDragSources,
        });
      } else {
        // Existing has higher priority — keep it as base, merge flags from new
        best.set(zone.id, {
          ...existing,
          isSortable: existing.isSortable || zone.isSortable,
          containedDragSources: existing.containedDragSources || zone.containedDragSources,
        });
      }
    }
    return [...best.values()];
  }
}
