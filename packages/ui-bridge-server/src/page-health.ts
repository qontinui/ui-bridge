/**
 * Page Health Diagnostics
 *
 * Analyzes discovered elements to produce a health report identifying
 * spatial coverage gaps, layout issues, loading/error signals, and more.
 */

import type { DiscoveredElement } from '@qontinui/ui-bridge/control';

// ============================================================================
// Types
// ============================================================================

export type PageHealthSeverity = 'critical' | 'warning' | 'info';

export interface PageHealthFinding {
  /** Short machine-readable key */
  key: string;
  /** Severity level */
  severity: PageHealthSeverity;
  /** Human-readable description */
  message: string;
  /** Optional supporting data */
  details?: Record<string, unknown>;
}

export interface PageHealthReport {
  /** Overall health score: 'healthy' | 'degraded' | 'unhealthy' */
  status: 'healthy' | 'degraded' | 'unhealthy';
  /** Individual findings */
  findings: PageHealthFinding[];
  /** Spatial coverage heatmap (20x20 grid, '#' = filled, '.' = empty) */
  heatmap: string[];
  /** Summary statistics */
  stats: {
    totalElements: number;
    visibleElements: number;
    coveragePercent: number;
    interactiveCount: number;
    disabledCount: number;
    contentElements: number;
    regionCounts: { sidebar: number; header: number; content: number };
  };
  /** Timestamp */
  timestamp: number;
}

// ============================================================================
// Constants
// ============================================================================

const GRID_SIZE = 20;

const NAV_TYPES = new Set(['button', 'heading', 'badge', 'status-message']);

const SKIP_TEXT_SCAN_TYPES = new Set(['button', 'link', 'tab', 'menuitem']);

const ERROR_PATTERNS = [
  'error occurred',
  'failed to',
  'exception',
  'crash',
  'unavailable',
  'something went wrong',
  'could not',
];

const LOADING_PATTERNS = [
  'loading',
  'starting',
  'connecting',
  'please wait',
  'initializing',
  'fetching',
];

const EMPTY_PATTERNS = [
  'no data',
  'no results',
  'nothing here',
  'empty',
  'no items',
  'get started',
];

const LOADING_CLASS_PATTERNS = ['spin', 'pulse', 'skeleton', 'loading', 'shimmer'];

// ============================================================================
// Analysis Logic
// ============================================================================

/**
 * Diagnose page health from discovered elements.
 */
export function diagnosePageHealth(elements: DiscoveredElement[]): PageHealthReport {
  const findings: PageHealthFinding[] = [];

  const visibleElements = elements.filter((el) => el.state.visible);

  // ---- Spatial Coverage (20x20 grid) ----
  const grid: boolean[][] = Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => false)
  );

  for (const el of visibleElements) {
    const nr = el.state.normalizedRect;
    if (!nr) continue;

    const minCol = Math.max(0, Math.floor(nr.x * GRID_SIZE));
    const maxCol = Math.min(GRID_SIZE - 1, Math.floor((nr.x + nr.width) * GRID_SIZE));
    const minRow = Math.max(0, Math.floor(nr.y * GRID_SIZE));
    const maxRow = Math.min(GRID_SIZE - 1, Math.floor((nr.y + nr.height) * GRID_SIZE));

    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        grid[r][c] = true;
      }
    }
  }

  let totalFilled = 0;
  let leftFilled = 0;
  let rightFilled = 0;
  const halfCol = GRID_SIZE / 2;

  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (grid[r][c]) {
        totalFilled++;
        if (c < halfCol) leftFilled++;
        else rightFilled++;
      }
    }
  }

  const totalCells = GRID_SIZE * GRID_SIZE;
  const halfCells = totalCells / 2;
  const coveragePercent = (totalFilled / totalCells) * 100;
  const leftPercent = (leftFilled / halfCells) * 100;
  const rightPercent = (rightFilled / halfCells) * 100;

  if (coveragePercent < 15) {
    findings.push({
      key: 'low-spatial-coverage',
      severity: 'critical',
      message: `Spatial coverage critically low at ${coveragePercent.toFixed(1)}%`,
      details: { coveragePercent, leftPercent, rightPercent },
    });
  } else if (coveragePercent < 30) {
    findings.push({
      key: 'low-spatial-coverage',
      severity: 'warning',
      message: `Spatial coverage low at ${coveragePercent.toFixed(1)}%`,
      details: { coveragePercent, leftPercent, rightPercent },
    });
  }

  if (rightPercent < 5 && leftPercent > 20) {
    findings.push({
      key: 'empty-content-area',
      severity: 'critical',
      message: `Right half nearly empty (${rightPercent.toFixed(1)}%) while left has content (${leftPercent.toFixed(1)}%) — content area may be blank`,
      details: { leftPercent, rightPercent },
    });
  }

  // ---- Layout Regions ----
  const regionCounts = { sidebar: 0, header: 0, content: 0 };

  for (const el of visibleElements) {
    const nr = el.state.normalizedRect;
    if (!nr) continue;
    const cx = nr.x + nr.width / 2;
    const cy = nr.y + nr.height / 2;

    if (cx < 0.2) {
      regionCounts.sidebar++;
    } else if (cy < 0.08) {
      regionCounts.header++;
    } else {
      regionCounts.content++;
    }
  }

  if (regionCounts.content === 0) {
    findings.push({
      key: 'no-content-elements',
      severity: 'critical',
      message: 'No elements found in the content region',
      details: { regionCounts },
    });
  } else if (regionCounts.content < 3) {
    findings.push({
      key: 'sparse-content',
      severity: 'warning',
      message: `Only ${regionCounts.content} element(s) in the content region`,
      details: { regionCounts },
    });
  }

  // ---- Element Diversity ----
  const typeSet = new Set<string>();
  for (const el of visibleElements) {
    typeSet.add(el.type);
  }

  if (visibleElements.length > 5) {
    const allNav = [...typeSet].every((t) => NAV_TYPES.has(t));
    if (allNav) {
      findings.push({
        key: 'low-element-diversity',
        severity: 'warning',
        message: `All ${visibleElements.length} visible elements are navigation types (${[...typeSet].join(', ')})`,
        details: { types: [...typeSet] },
      });
    }
  }

  // ---- Text Signals ----
  const textElements = visibleElements.filter((el) => !SKIP_TEXT_SCAN_TYPES.has(el.type));

  for (const el of textElements) {
    const text = (el.state.textContent || '').toLowerCase();
    if (!text) continue;

    for (const pattern of ERROR_PATTERNS) {
      if (text.includes(pattern)) {
        findings.push({
          key: 'error-text-signal',
          severity: 'critical',
          message: `Error text detected: "${pattern}" in element ${el.id}`,
          details: { elementId: el.id, pattern, text: el.state.textContent?.slice(0, 200) },
        });
        break;
      }
    }

    for (const pattern of LOADING_PATTERNS) {
      if (text.includes(pattern)) {
        findings.push({
          key: 'loading-text-signal',
          severity: 'warning',
          message: `Loading text detected: "${pattern}" in element ${el.id}`,
          details: { elementId: el.id, pattern, text: el.state.textContent?.slice(0, 200) },
        });
        break;
      }
    }

    for (const pattern of EMPTY_PATTERNS) {
      if (text.includes(pattern)) {
        findings.push({
          key: 'empty-text-signal',
          severity: 'warning',
          message: `Empty-state text detected: "${pattern}" in element ${el.id}`,
          details: { elementId: el.id, pattern, text: el.state.textContent?.slice(0, 200) },
        });
        break;
      }
    }
  }

  // Check classes for loading indicators
  for (const el of visibleElements) {
    const classes = el.classes || [];
    const classStr = classes.join(' ').toLowerCase();
    for (const pattern of LOADING_CLASS_PATTERNS) {
      if (classStr.includes(pattern)) {
        findings.push({
          key: 'loading-class-signal',
          severity: 'warning',
          message: `Loading CSS class detected: "${pattern}" on element ${el.id}`,
          details: { elementId: el.id, pattern, classes },
        });
        break;
      }
    }
  }

  // ---- Interactive Readiness ----
  const interactiveElements = elements.filter((el) => el.category === 'interactive');
  const disabledCount = interactiveElements.filter((el) => !el.state.enabled).length;

  if (interactiveElements.length > 0 && disabledCount / interactiveElements.length > 0.5) {
    findings.push({
      key: 'many-disabled-interactive',
      severity: 'warning',
      message: `${disabledCount} of ${interactiveElements.length} interactive elements are disabled (${((disabledCount / interactiveElements.length) * 100).toFixed(0)}%)`,
      details: { interactiveCount: interactiveElements.length, disabledCount },
    });
  }

  // ---- Visual Anomalies ----
  for (const el of visibleElements) {
    const nr = el.state.normalizedRect;
    if (!nr) continue;

    // Zero size
    if (nr.width === 0 || nr.height === 0) {
      findings.push({
        key: 'zero-size-element',
        severity: 'warning',
        message: `Visible element ${el.id} has zero size`,
        details: { elementId: el.id, normalizedRect: nr },
      });
    }

    // Off-screen (entirely outside 0-1 range)
    if (nr.x + nr.width < 0 || nr.x > 1 || nr.y + nr.height < 0 || nr.y > 1) {
      findings.push({
        key: 'off-screen-element',
        severity: 'warning',
        message: `Visible element ${el.id} is positioned off-screen`,
        details: { elementId: el.id, normalizedRect: nr },
      });
    }
  }

  // ---- Build Heatmap ----
  const heatmap: string[] = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    let row = '';
    for (let c = 0; c < GRID_SIZE; c++) {
      row += grid[r][c] ? '#' : '.';
    }
    heatmap.push(row);
  }

  // ---- Determine overall status ----
  const hasCritical = findings.some((f) => f.severity === 'critical');
  const hasWarning = findings.some((f) => f.severity === 'warning');
  const status = hasCritical ? 'unhealthy' : hasWarning ? 'degraded' : 'healthy';

  return {
    status,
    findings,
    heatmap,
    stats: {
      totalElements: elements.length,
      visibleElements: visibleElements.length,
      coveragePercent: Math.round(coveragePercent * 10) / 10,
      interactiveCount: interactiveElements.length,
      disabledCount,
      contentElements: elements.filter((el) => el.category === 'content').length,
      regionCounts,
    },
    timestamp: Date.now(),
  };
}
