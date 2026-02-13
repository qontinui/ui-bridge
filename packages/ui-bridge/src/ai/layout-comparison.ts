/**
 * Layout Comparison
 *
 * Compares the spatial layout between two pages: grid structure,
 * hierarchy depth, and information density.
 */

import type {
  AIDiscoveredElement,
  GridStructure,
  GridDiff,
  HierarchyDiff,
  DensityComparison,
  LayoutComparison,
  PageRegionMap,
} from './types';

export interface LayoutComparisonConfig {
  /** Tolerance for column/row alignment detection (px) */
  gridTolerance: number;
}

export const DEFAULT_LAYOUT_COMPARISON_CONFIG: LayoutComparisonConfig = {
  gridTolerance: 20,
};

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function getRect(el: AIDiscoveredElement): Bounds | null {
  const rect = el.state?.rect;
  if (!rect || !rect.width) return null;
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

/**
 * Cluster numeric values with a given tolerance.
 */
function clusterValues(values: number[], tolerance: number): number[] {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const clusters: number[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - clusters[clusters.length - 1] > tolerance) {
      clusters.push(sorted[i]);
    }
  }
  return clusters;
}

/**
 * Detect the implicit grid structure from element positions.
 */
export function detectGridStructure(
  elements: AIDiscoveredElement[],
  config: LayoutComparisonConfig = DEFAULT_LAYOUT_COMPARISON_CONFIG
): GridStructure {
  const rects = elements.map(getRect).filter((r): r is Bounds => r !== null);

  const xPositions = rects.map((r) => r.x);
  const yPositions = rects.map((r) => r.y);

  const columns = clusterValues(xPositions, config.gridTolerance);
  const rows = clusterValues(yPositions, config.gridTolerance);

  return {
    columns,
    rows,
    columnCount: columns.length,
    rowCount: rows.length,
  };
}

/**
 * Compute the maximum nesting depth from parent context chains.
 */
function computeMaxDepth(elements: AIDiscoveredElement[]): number {
  let maxDepth = 0;
  for (const el of elements) {
    // Use parentContext chain as a proxy for depth
    const context = el.parentContext || '';
    const depth = context ? context.split('>').length : 1;
    maxDepth = Math.max(maxDepth, depth);
  }
  return maxDepth;
}

/**
 * Compute a prominence score for an element (0-1) based on size and position.
 * Larger elements nearer the top are more prominent.
 */
export function computeProminence(
  element: AIDiscoveredElement,
  pageWidth: number,
  pageHeight: number
): number {
  const rect = getRect(element);
  if (!rect || pageWidth === 0 || pageHeight === 0) return 0;

  const sizeScore = (rect.width * rect.height) / (pageWidth * pageHeight);
  const positionScore = 1 - rect.y / pageHeight;

  return Math.min(1, sizeScore * 0.6 + positionScore * 0.4);
}

/**
 * Compare layouts between source and target element sets.
 */
export function compareLayouts(
  sourceElements: AIDiscoveredElement[],
  targetElements: AIDiscoveredElement[],
  sourceRegions?: PageRegionMap,
  targetRegions?: PageRegionMap,
  config: LayoutComparisonConfig = DEFAULT_LAYOUT_COMPARISON_CONFIG
): LayoutComparison {
  const sourceGrid = detectGridStructure(sourceElements, config);
  const targetGrid = detectGridStructure(targetElements, config);

  const gridDiff: GridDiff = {
    sourceGrid,
    targetGrid,
    columnDiff: sourceGrid.columnCount - targetGrid.columnCount,
    rowDiff: sourceGrid.rowCount - targetGrid.rowCount,
  };

  const sourceDepth = computeMaxDepth(sourceElements);
  const targetDepth = computeMaxDepth(targetElements);
  const hierarchyDiff: HierarchyDiff = {
    sourceDepth,
    targetDepth,
    depthDiff: sourceDepth - targetDepth,
  };

  // Density: elements per region (or elements per page if no regions)
  const sourceRegionCount = sourceRegions?.regions.length || 1;
  const targetRegionCount = targetRegions?.regions.length || 1;
  const sourceDensity = sourceElements.length / sourceRegionCount;
  const targetDensity = targetElements.length / targetRegionCount;

  const density: DensityComparison = {
    sourceDensity: Math.round(sourceDensity * 100) / 100,
    targetDensity: Math.round(targetDensity * 100) / 100,
    ratio: targetDensity > 0 ? Math.round((sourceDensity / targetDensity) * 100) / 100 : 0,
  };

  // Overall similarity: combine grid, hierarchy, and density similarity
  const gridSimilarity =
    sourceGrid.columnCount === 0 && targetGrid.columnCount === 0
      ? 1
      : 1 -
        Math.abs(gridDiff.columnDiff) / Math.max(sourceGrid.columnCount, targetGrid.columnCount, 1);

  const hierarchySimilarity =
    sourceDepth === 0 && targetDepth === 0
      ? 1
      : 1 - Math.abs(hierarchyDiff.depthDiff) / Math.max(sourceDepth, targetDepth, 1);

  const densitySimilarity = density.ratio > 0 ? Math.min(density.ratio, 1 / density.ratio) : 0;

  const similarity =
    Math.round((gridSimilarity * 0.4 + hierarchySimilarity * 0.3 + densitySimilarity * 0.3) * 100) /
    100;

  return {
    gridDiff,
    hierarchyDiff,
    density,
    similarity,
  };
}
