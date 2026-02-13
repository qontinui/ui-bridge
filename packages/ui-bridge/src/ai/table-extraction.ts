/**
 * Table & List Extraction
 *
 * Detects and extracts structured data (tables and lists) from page elements
 * based on spatial layout and semantic roles.
 */

import type {
  AIDiscoveredElement,
  TableSchema,
  TableColumn,
  ListSchema,
  ListItemField,
  StructuredDataExtraction,
  DataType,
} from './types';
import { classifyDataType } from './data-extraction';

export interface TableExtractionConfig {
  /** Minimum columns to consider a group a table */
  minTableColumns: number;
  /** Minimum rows to consider a group a table */
  minTableRows: number;
  /** Minimum items to consider a group a list */
  minListItems: number;
  /** Position tolerance for column alignment (px) */
  columnTolerance: number;
  /** Position tolerance for row alignment (px) */
  rowTolerance: number;
}

export const DEFAULT_TABLE_EXTRACTION_CONFIG: TableExtractionConfig = {
  minTableColumns: 2,
  minTableRows: 2,
  minListItems: 2,
  columnTolerance: 20,
  rowTolerance: 10,
};

interface ElementWithBounds {
  element: AIDiscoveredElement;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}

function getElementBounds(el: AIDiscoveredElement): ElementWithBounds | null {
  const rect = el.state?.rect;
  if (!rect || rect.width === 0) return null;

  const text = el.state?.textContent ?? el.state?.value ?? '';
  if (!text) return null;

  return {
    element: el,
    x: rect.x ?? 0,
    y: rect.y ?? 0,
    width: rect.width ?? 0,
    height: rect.height ?? 0,
    text: text.trim(),
  };
}

/**
 * Cluster numeric values with a given tolerance.
 * Returns sorted unique cluster centers.
 */
function clusterPositions(values: number[], tolerance: number): number[] {
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
 * Assign a value to the nearest cluster center.
 */
function assignToCluster(value: number, clusters: number[], tolerance: number): number {
  let best = 0;
  let bestDist = Math.abs(value - clusters[0]);
  for (let i = 1; i < clusters.length; i++) {
    const dist = Math.abs(value - clusters[i]);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return bestDist <= tolerance ? best : -1;
}

/**
 * Detect a table structure from elements with grid-like spatial arrangement.
 */
export function detectTable(
  elements: AIDiscoveredElement[],
  config: TableExtractionConfig = DEFAULT_TABLE_EXTRACTION_CONFIG
): TableSchema | null {
  const withBounds = elements
    .map(getElementBounds)
    .filter((b): b is ElementWithBounds => b !== null);
  if (withBounds.length < config.minTableColumns * config.minTableRows) return null;

  // Cluster x-positions for columns, y-positions for rows
  const xPositions = withBounds.map((b) => b.x);
  const yPositions = withBounds.map((b) => b.y);

  const columnClusters = clusterPositions(xPositions, config.columnTolerance);
  const rowClusters = clusterPositions(yPositions, config.rowTolerance);

  if (columnClusters.length < config.minTableColumns || rowClusters.length < config.minTableRows) {
    return null;
  }

  // Build a grid: grid[row][col] = text
  const grid: (string | null)[][] = Array.from({ length: rowClusters.length }, () =>
    Array(columnClusters.length).fill(null)
  );

  for (const b of withBounds) {
    const col = assignToCluster(b.x, columnClusters, config.columnTolerance);
    const row = assignToCluster(b.y, rowClusters, config.rowTolerance);
    if (col >= 0 && row >= 0 && grid[row][col] === null) {
      grid[row][col] = b.text;
    }
  }

  // First row = headers
  const headers = grid[0].map((h) => h ?? '');
  const columns: TableColumn[] = headers.map((header, index) => {
    // Determine column data type from body cells
    const bodyCells = grid
      .slice(1)
      .map((r) => r[index])
      .filter((c): c is string => c !== null);
    const types = bodyCells.map((c) => classifyDataType(c).type);
    const mostCommon = mode(types) ?? ('text' as DataType);

    return { header, index, dataType: mostCommon };
  });

  const rows = grid.slice(1).map((row) => row.map((cell) => cell ?? ''));

  return {
    label: headers[0] || 'Table',
    columns,
    rows,
  };
}

/**
 * Detect a list structure from repeating element patterns.
 */
export function detectList(
  elements: AIDiscoveredElement[],
  config: TableExtractionConfig = DEFAULT_TABLE_EXTRACTION_CONFIG
): ListSchema | null {
  // Group elements by similar roles/types that repeat vertically
  const withBounds = elements
    .map(getElementBounds)
    .filter((b): b is ElementWithBounds => b !== null);
  if (withBounds.length < config.minListItems) return null;

  // Sort by y-position
  const sorted = [...withBounds].sort((a, b) => a.y - b.y);

  // Cluster y-positions to find item rows
  const yPositions = sorted.map((b) => b.y);
  const rowClusters = clusterPositions(yPositions, config.rowTolerance);

  if (rowClusters.length < config.minListItems) return null;

  // Group elements by their row cluster
  const rowGroups: Map<number, ElementWithBounds[]> = new Map();
  for (const b of sorted) {
    const row = assignToCluster(b.y, rowClusters, config.rowTolerance);
    if (row >= 0) {
      if (!rowGroups.has(row)) rowGroups.set(row, []);
      rowGroups.get(row)!.push(b);
    }
  }

  // Each row becomes a list item
  // Use x-position ordering within each row to determine fields
  const items: Record<string, string>[] = [];
  const fieldLabels: string[] = [];
  let fieldLabelsInitialized = false;

  for (const [, rowElements] of [...rowGroups.entries()].sort(([a], [b]) => a - b)) {
    const sortedRow = [...rowElements].sort((a, b) => a.x - b.x);
    const item: Record<string, string> = {};

    for (let i = 0; i < sortedRow.length; i++) {
      const label = `field_${i}`;
      if (!fieldLabelsInitialized) fieldLabels.push(label);
      item[label] = sortedRow[i].text;
    }
    fieldLabelsInitialized = true;
    items.push(item);
  }

  if (items.length < config.minListItems) return null;

  // Determine field data types
  const fields: ListItemField[] = fieldLabels.map((label) => {
    const values = items.map((item) => item[label]).filter(Boolean);
    const types = values.map((v) => classifyDataType(v).type);
    return { label, dataType: mode(types) ?? 'text' };
  });

  return {
    label: 'List',
    fields,
    items,
  };
}

/**
 * Extract all structured data (tables and lists) from page elements.
 */
export function extractStructuredData(
  elements: AIDiscoveredElement[],
  config: TableExtractionConfig = DEFAULT_TABLE_EXTRACTION_CONFIG
): StructuredDataExtraction {
  const tables: TableSchema[] = [];
  const lists: ListSchema[] = [];

  // Try to detect table from all elements
  const table = detectTable(elements, config);
  if (table) {
    tables.push(table);
  }

  // Try to detect list from elements that have repeating patterns
  // Filter to elements with specific roles that commonly form lists
  const listCandidates = elements.filter((el) => {
    const role = el.role || el.type;
    return ['listitem', 'row', 'option', 'link', 'button'].includes(role);
  });

  if (listCandidates.length >= config.minListItems) {
    const list = detectList(listCandidates, config);
    if (list) {
      lists.push(list);
    }
  }

  return { tables, lists };
}

/** Find the most common value in an array. */
function mode<T>(arr: T[]): T | undefined {
  if (arr.length === 0) return undefined;
  const counts = new Map<T, number>();
  let best: T = arr[0];
  let bestCount = 0;
  for (const v of arr) {
    const c = (counts.get(v) ?? 0) + 1;
    counts.set(v, c);
    if (c > bestCount) {
      bestCount = c;
      best = v;
    }
  }
  return best;
}
