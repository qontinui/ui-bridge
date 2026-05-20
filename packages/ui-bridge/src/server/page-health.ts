/**
 * Page Health Diagnostics
 *
 * Analyzes discovered elements to produce a structured health report that
 * mirrors the runner's `/control/page-health` analyzer
 * (qontinui-runner/src-tauri/src/mcp/ui_bridge/screenshots.rs::
 * ui_bridge_page_health_handler).
 *
 * The analysis is pure data-over-snapshot: spatial coverage, layout regions,
 * element diversity, text signal scanning, interactive readiness, visual
 * anomalies. No Tauri-specific calls — safe to run server-side over a
 * snapshot relayed from the browser.
 *
 * Output shape matches the runner's report exactly so MCP / agent tooling
 * (e.g. the page-health skill at .claude/skills/page-health/SKILL.md) gets
 * byte-equivalent payloads regardless of which transport answers.
 */

import type { DiscoveredElement } from '../control';

// ============================================================================
// Types
// ============================================================================

export type PageHealthSeverity = 'OK' | 'WARNING' | 'CRITICAL';

export interface PageHealthFinding {
  /** Check name (e.g. "spatial_coverage", "layout_regions") */
  check: string;
  /** Severity rolled up from this check's heuristics */
  severity: PageHealthSeverity;
  /** Human-readable summary of what was observed */
  detail: string;
  /** Supporting data (per-check shape) */
  data: Record<string, unknown>;
}

export interface PageHealthReport {
  /** Worst severity across all findings */
  summary: PageHealthSeverity;
  /** Per-check findings (one entry per heuristic family) */
  findings: PageHealthFinding[];
  /** 20-row × 20-col ASCII heatmap ('#' = covered, '.' = empty) */
  heatmap: string[];
  /** Total discovered elements (visible + hidden) */
  element_count: number;
  /** Visible elements with a normalized rect */
  visible_count: number;
}

// ============================================================================
// Constants (mirrors runner's analyzer)
// ============================================================================

const GRID_SIZE = 20;

const NAV_TYPES = new Set(['button', 'heading', 'badge', 'status-message']);

const SKIP_TEXT_TYPES = new Set(['button', 'link', 'tab', 'menuitem']);

const ERROR_PHRASES = [
  'error occurred',
  'failed to',
  'exception',
  'crash',
  'unavailable',
  'something went wrong',
  'could not',
];

const LOADING_PHRASES = [
  'loading',
  'starting',
  'connecting',
  'please wait',
  'initializing',
  'fetching',
];

const EMPTY_PHRASES = [
  'no data',
  'no results',
  'nothing here',
  'empty',
  'no items',
  'get started',
];

const CSS_SIGNALS = ['spin', 'pulse', 'skeleton', 'loading', 'shimmer'];

// ============================================================================
// Helpers
// ============================================================================

function severityRank(s: PageHealthSeverity): number {
  if (s === 'CRITICAL') return 3;
  if (s === 'WARNING') return 2;
  return 1;
}

function worstSeverity(findings: PageHealthFinding[]): PageHealthSeverity {
  let worst: PageHealthSeverity = 'OK';
  for (const f of findings) {
    if (severityRank(f.severity) > severityRank(worst)) {
      worst = f.severity;
    }
  }
  return worst;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  // Use [...s] to chunk by code points, matching the runner's `chars().take(120)`.
  return [...s].slice(0, n).join('');
}

// ============================================================================
// Analyzer
// ============================================================================

/**
 * Run the page-health analyzer over a list of discovered elements.
 *
 * Mirrors `ui_bridge_page_health_handler` in screenshots.rs step-for-step:
 *
 *  1. Visible filter (state.visible && state.normalizedRect)
 *  2. Spatial coverage on a 20x20 grid + left/right halves
 *  3. Layout regions (sidebar/header/content) by center-point
 *  4. Element diversity (nav-only flag)
 *  5. Text + CSS class signal scanning
 *  6. Interactive readiness (disabled ratio among `category === 'interactive'`)
 *  7. Visual anomalies (zero-size, outside-viewport)
 *  8. ASCII heatmap
 *  9. Overall summary = worst severity
 */
export function diagnosePageHealth(elements: DiscoveredElement[]): PageHealthReport {
  const findings: PageHealthFinding[] = [];

  const visible = elements.filter((el) => {
    const state = el.state as { visible?: boolean; normalizedRect?: unknown } | undefined;
    return state?.visible === true && state?.normalizedRect !== undefined;
  });

  // --- Step 2: Spatial coverage ----------------------------------------------
  const grid: boolean[][] = Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => false)
  );

  for (const el of visible) {
    const rect = (el.state as { normalizedRect?: { x: number; y: number; width: number; height: number } })
      .normalizedRect;
    if (!rect) continue;
    const colStart = Math.max(0, Math.floor(rect.x * GRID_SIZE));
    const colEnd = Math.min(GRID_SIZE, Math.ceil((rect.x + rect.width) * GRID_SIZE));
    const rowStart = Math.max(0, Math.floor(rect.y * GRID_SIZE));
    const rowEnd = Math.min(GRID_SIZE, Math.ceil((rect.y + rect.height) * GRID_SIZE));
    for (let r = rowStart; r < rowEnd; r++) {
      for (let c = colStart; c < colEnd; c++) {
        grid[r][c] = true;
      }
    }
  }

  const totalCells = GRID_SIZE * GRID_SIZE;
  const halfCells = totalCells / 2;
  let filled = 0;
  let leftFilled = 0;
  let rightFilled = 0;
  const half = GRID_SIZE / 2;
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (grid[r][c]) {
        filled++;
        if (c < half) leftFilled++;
        else rightFilled++;
      }
    }
  }
  const coveragePct = Math.round((filled / totalCells) * 100);
  const leftHalfPct = Math.round((leftFilled / halfCells) * 100);
  const rightHalfPct = Math.round((rightFilled / halfCells) * 100);

  let spatialSeverity: PageHealthSeverity = 'OK';
  if (coveragePct < 15) spatialSeverity = 'CRITICAL';
  else if (coveragePct < 30) spatialSeverity = 'WARNING';
  if (rightHalfPct < 5 && leftHalfPct > 20) spatialSeverity = 'CRITICAL';

  findings.push({
    check: 'spatial_coverage',
    severity: spatialSeverity,
    detail: `Elements cover ${coveragePct}% of viewport. Left=${leftHalfPct}%, Right=${rightHalfPct}%`,
    data: {
      coverage_pct: coveragePct,
      left_half_pct: leftHalfPct,
      right_half_pct: rightHalfPct,
    },
  });

  // --- Step 3: Layout regions ------------------------------------------------
  let sidebar = 0;
  let header = 0;
  let content = 0;
  for (const el of visible) {
    const rect = (el.state as { normalizedRect?: { x: number; y: number; width: number; height: number } })
      .normalizedRect;
    if (!rect) continue;
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    if (cx < 0.2) sidebar++;
    else if (cy < 0.08) header++;
    else content++;
  }

  let layoutSeverity: PageHealthSeverity = 'OK';
  if (content === 0) layoutSeverity = 'CRITICAL';
  else if (content < 3) layoutSeverity = 'WARNING';

  findings.push({
    check: 'layout_regions',
    severity: layoutSeverity,
    detail: `sidebar=${sidebar}, header=${header}, content=${content}`,
    data: { sidebar, header, content },
  });

  // --- Step 4: Element diversity --------------------------------------------
  const typeCounts: Record<string, number> = {};
  for (const el of elements) {
    const t = el.type || 'unknown';
    typeCounts[t] = (typeCounts[t] ?? 0) + 1;
  }
  const allNav =
    elements.length > 5 && Object.keys(typeCounts).every((k) => NAV_TYPES.has(k));
  const diversitySeverity: PageHealthSeverity = allNav ? 'WARNING' : 'OK';

  findings.push({
    check: 'element_diversity',
    severity: diversitySeverity,
    detail: `${Object.keys(typeCounts).length} type(s) across ${elements.length} elements${
      allNav ? ' (navigation-only)' : ''
    }`,
    data: { types: typeCounts },
  });

  // --- Step 5: Text + CSS class signal scanning ------------------------------
  const detectedErrors: string[] = [];
  const detectedLoading: string[] = [];
  const detectedEmpty: string[] = [];
  const detectedCss: string[] = [];

  for (const el of elements) {
    const elType = el.type ?? '';
    const text = ((el.state as { textContent?: string } | undefined)?.textContent ?? '').toString();
    const classes = (el.classes ?? []) as string[];
    const classesStr = classes.join(' ').toLowerCase();

    // CSS-class signals scanned on ALL elements (matches runner)
    for (const sig of CSS_SIGNALS) {
      if (classesStr.includes(sig)) {
        detectedCss.push(`class contains '${sig}' on ${elType}`);
        break;
      }
    }

    if (SKIP_TEXT_TYPES.has(elType)) continue;

    const textLower = text.toLowerCase();
    for (const p of ERROR_PHRASES) {
      if (textLower.includes(p)) {
        detectedErrors.push(truncate(text, 120));
        break;
      }
    }
    for (const p of LOADING_PHRASES) {
      if (textLower.includes(p)) {
        detectedLoading.push(truncate(text, 120));
        break;
      }
    }
    for (const p of EMPTY_PHRASES) {
      if (textLower.includes(p)) {
        detectedEmpty.push(truncate(text, 120));
        break;
      }
    }
  }

  let textSeverity: PageHealthSeverity = 'OK';
  if (detectedErrors.length > 0) textSeverity = 'CRITICAL';
  else if (
    detectedLoading.length > 0 ||
    detectedCss.length > 0 ||
    detectedEmpty.length > 0
  )
    textSeverity = 'WARNING';

  findings.push({
    check: 'text_signals',
    severity: textSeverity,
    detail: `errors=${detectedErrors.length}, loading=${detectedLoading.length}, empty=${detectedEmpty.length}, css_signals=${detectedCss.length}`,
    data: {
      errors: detectedErrors,
      loading: detectedLoading,
      empty: detectedEmpty,
      css_signals: detectedCss,
    },
  });

  // --- Step 6: Interactive readiness ----------------------------------------
  let interactiveTotal = 0;
  let interactiveDisabled = 0;
  for (const el of elements) {
    if (el.category === 'interactive') {
      interactiveTotal++;
      const enabled = (el.state as { enabled?: boolean } | undefined)?.enabled ?? true;
      if (!enabled) interactiveDisabled++;
    }
  }
  const interactiveSeverity: PageHealthSeverity =
    interactiveTotal > 0 && interactiveDisabled / interactiveTotal > 0.5 ? 'WARNING' : 'OK';

  findings.push({
    check: 'interactive_readiness',
    severity: interactiveSeverity,
    detail: `${interactiveTotal} interactive elements, ${interactiveDisabled} disabled`,
    data: { total: interactiveTotal, disabled: interactiveDisabled },
  });

  // --- Step 7: Visual anomalies ---------------------------------------------
  let zeroSize = 0;
  let outsideViewport = 0;
  for (const el of visible) {
    const rect = (el.state as { normalizedRect?: { x: number; y: number; width: number; height: number } })
      .normalizedRect;
    if (!rect) continue;
    if (rect.width === 0 || rect.height === 0) zeroSize++;
    if (
      rect.x + rect.width < 0 ||
      rect.y + rect.height < 0 ||
      rect.x > 1 ||
      rect.y > 1
    ) {
      outsideViewport++;
    }
  }
  const anomalySeverity: PageHealthSeverity =
    zeroSize > 0 || outsideViewport > 0 ? 'WARNING' : 'OK';

  findings.push({
    check: 'visual_anomalies',
    severity: anomalySeverity,
    detail: `zero_size=${zeroSize}, outside_viewport=${outsideViewport}`,
    data: { zero_size: zeroSize, outside_viewport: outsideViewport },
  });

  // --- Step 8: ASCII heatmap ------------------------------------------------
  const heatmap: string[] = grid.map((row) =>
    row.map((filled) => (filled ? '#' : '.')).join('')
  );

  // --- Step 9: Worst severity rollup ----------------------------------------
  const summary = worstSeverity(findings);

  return {
    summary,
    findings,
    heatmap,
    element_count: elements.length,
    visible_count: visible.length,
  };
}
