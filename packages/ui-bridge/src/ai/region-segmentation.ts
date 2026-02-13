/**
 * Region Segmentation
 *
 * Segments a page into semantic regions (header, nav, sidebar, main, footer, etc.)
 * based on element positions, roles, and spatial clustering.
 */

import type { AIDiscoveredElement, RegionType, PageRegion, PageRegionMap } from './types';

export interface RegionSegmentationConfig {
  /** Minimum elements for a region to be valid */
  minRegionElements: number;
  /** Top portion of viewport considered "header" (fraction 0-1) */
  headerFraction: number;
  /** Bottom portion considered "footer" (fraction 0-1) */
  footerFraction: number;
  /** Left portion considered "sidebar" (fraction 0-1) */
  sidebarFraction: number;
}

export const DEFAULT_REGION_SEGMENTATION_CONFIG: RegionSegmentationConfig = {
  minRegionElements: 1,
  headerFraction: 0.12,
  footerFraction: 0.9,
  sidebarFraction: 0.2,
};

interface BoundedElement {
  element: AIDiscoveredElement;
  x: number;
  y: number;
  width: number;
  height: number;
}

function toBounded(el: AIDiscoveredElement): BoundedElement | null {
  const rect = el.state?.rect;
  if (!rect) return null;
  return {
    element: el,
    x: rect.x ?? 0,
    y: rect.y ?? 0,
    width: rect.width ?? 0,
    height: rect.height ?? 0,
  };
}

/**
 * Classify the region type of an element based on its role, position, and context.
 */
export function classifyRegionType(
  el: AIDiscoveredElement,
  relativeY: number,
  relativeX: number,
  config: RegionSegmentationConfig = DEFAULT_REGION_SEGMENTATION_CONFIG
): { type: RegionType; confidence: number } {
  const role = (el.role || '').toLowerCase();
  const semanticType = (el.semanticType || '').toLowerCase();
  const tag = (el.tagName || '').toLowerCase();

  // Role-based classification (highest confidence)
  if (role === 'navigation' || role === 'nav' || tag === 'nav') {
    return { type: 'navigation', confidence: 0.95 };
  }
  if (role === 'banner' || tag === 'header') {
    return { type: 'header', confidence: 0.95 };
  }
  if (role === 'contentinfo' || tag === 'footer') {
    return { type: 'footer', confidence: 0.95 };
  }
  if (role === 'main' || tag === 'main') {
    return { type: 'main-content', confidence: 0.95 };
  }
  if (role === 'complementary' || tag === 'aside') {
    return { type: 'sidebar', confidence: 0.9 };
  }
  if (role === 'form' || tag === 'form') {
    return { type: 'form', confidence: 0.9 };
  }
  if (role === 'table' || tag === 'table') {
    return { type: 'table', confidence: 0.9 };
  }
  if (role === 'dialog' || role === 'alertdialog') {
    return { type: 'modal', confidence: 0.95 };
  }
  if (role === 'toolbar') {
    return { type: 'toolbar', confidence: 0.9 };
  }
  if (semanticType.includes('card')) {
    return { type: 'card', confidence: 0.8 };
  }

  // Position-based fallback
  if (relativeY < config.headerFraction) {
    return { type: 'header', confidence: 0.6 };
  }
  if (relativeY > config.footerFraction) {
    return { type: 'footer', confidence: 0.6 };
  }
  if (relativeX < config.sidebarFraction) {
    return { type: 'sidebar', confidence: 0.5 };
  }

  return { type: 'main-content', confidence: 0.3 };
}

/**
 * Segment all page elements into semantic regions.
 */
export function segmentPageRegions(
  elements: AIDiscoveredElement[],
  config: RegionSegmentationConfig = DEFAULT_REGION_SEGMENTATION_CONFIG
): PageRegionMap {
  const bounded = elements.map(toBounded).filter((b): b is BoundedElement => b !== null);
  if (bounded.length === 0) {
    return { regions: [], assignedCount: 0, unassignedIds: elements.map((e) => e.id) };
  }

  // Compute page bounds
  let maxX = 0;
  let maxY = 0;
  for (const b of bounded) {
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  if (maxX === 0) maxX = 1;
  if (maxY === 0) maxY = 1;

  // Classify each element
  const regionGroups = new Map<RegionType, { elements: BoundedElement[]; confidences: number[] }>();
  const unassignedIds: string[] = [];

  for (const b of bounded) {
    const relativeX = b.x / maxX;
    const relativeY = b.y / maxY;
    const { type, confidence } = classifyRegionType(b.element, relativeY, relativeX, config);

    if (!regionGroups.has(type)) {
      regionGroups.set(type, { elements: [], confidences: [] });
    }
    regionGroups.get(type)!.elements.push(b);
    regionGroups.get(type)!.confidences.push(confidence);
  }

  // Build regions
  const regions: PageRegion[] = [];
  let assignedCount = 0;

  for (const [type, group] of regionGroups) {
    if (group.elements.length < config.minRegionElements) {
      for (const b of group.elements) unassignedIds.push(b.element.id);
      continue;
    }

    // Compute bounding box of the group
    let minX = Infinity,
      minY = Infinity,
      maxRX = 0,
      maxRY = 0;
    const elementIds: string[] = [];

    for (const b of group.elements) {
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxRX = Math.max(maxRX, b.x + b.width);
      maxRY = Math.max(maxRY, b.y + b.height);
      elementIds.push(b.element.id);
    }

    const avgConfidence = group.confidences.reduce((a, b) => a + b, 0) / group.confidences.length;

    regions.push({
      type,
      bounds: { x: minX, y: minY, width: maxRX - minX, height: maxRY - minY },
      elementIds,
      label: type.replace('-', ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      confidence: Math.round(avgConfidence * 100) / 100,
    });

    assignedCount += elementIds.length;
  }

  return { regions, assignedCount, unassignedIds };
}
