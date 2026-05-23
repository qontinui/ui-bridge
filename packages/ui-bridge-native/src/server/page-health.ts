/**
 * Page Health Diagnostics — Mobile (React Native) variant.
 *
 * Mirrors the runner / web analyzer in
 *   `ui-bridge/packages/ui-bridge/src/server/page-health.ts`
 * and the canonical Rust implementation in
 *   `qontinui-runner/src-tauri/src/mcp/ui_bridge/screenshots.rs::ui_bridge_page_health_handler`
 *
 * Output shape (`summary`/`findings`/`heatmap`/`element_count`/`visible_count`)
 * matches those byte-for-byte so the same `page-health` skill works on web,
 * runner, and mobile without branching per platform.
 *
 * Mobile-specific differences from the web/runner analyzer:
 *
 *   • Layout source: React Native elements expose `state.layout` in *pixels*
 *     (`{x, y, width, height, pageX, pageY}` relative to the device viewport).
 *     We normalize via `Dimensions.get('window')` into the 0-1 space the
 *     analyzer expects. The web/runner analyzer reads pre-normalized
 *     `state.normalizedRect` directly.
 *
 *   • Interactivity detection: mobile elements don't carry a `category` field.
 *     We treat `type ∈ {button, input, switch, checkbox, radio, touchable,
 *     listItem}` as interactive instead.
 *
 *   • CSS class signals: React Native has no class names, so the
 *     `class contains spin|pulse|skeleton|...` heuristic is always empty.
 *     We still emit the `css_signals` field (as `[]`) so the response shape
 *     stays platform-neutral.
 *
 * Fold semantics (see Step 7: Visual anomalies):
 *
 *   The `outside_viewport` count tracks only *horizontal* overflow — elements
 *   whose normalized x is left of the viewport (`x + width < 0`) or right of
 *   it (`x > 1`). Vertical offsets (`y > 1`, `y + height < 0`) are NOT an
 *   anomaly on mobile: ScrollView / FlatList content legitimately extends
 *   above or below the visible fold, and the user reaches it by scrolling.
 *   Flagging those would WARNING every scrollable screen (settings, feed,
 *   list pages). Only horizontal overflow is unreachable by the user on
 *   typical mobile layouts (the viewport is ~full-width, no horizontal
 *   scroll), so that's the meaningful anomaly we surface.
 */

import type { NativeElementState } from '../core/types';

// ============================================================================
// Types (mirrors ui-bridge/src/server/page-health.ts)
// ============================================================================

export type PageHealthSeverity = 'OK' | 'WARNING' | 'CRITICAL';

export interface PageHealthFinding {
  check: string;
  severity: PageHealthSeverity;
  detail: string;
  data: Record<string, unknown>;
}

export interface PageHealthReport {
  summary: PageHealthSeverity;
  findings: PageHealthFinding[];
  heatmap: string[];
  element_count: number;
  visible_count: number;
}

/**
 * Mobile element shape consumed by the analyzer. A loosened subset of the
 * registry's full element record — only fields the analyzer actually reads.
 */
export interface PageHealthElement {
  type: string;
  state: NativeElementState;
}

// ============================================================================
// Constants (lifted verbatim from the canonical analyzer)
// ============================================================================

const GRID_SIZE = 20;

const NAV_TYPES = new Set(['button', 'heading', 'badge', 'status-message']);

const SKIP_TEXT_TYPES = new Set(['button', 'link', 'tab', 'menuitem']);

const INTERACTIVE_TYPES = new Set([
  'button',
  'input',
  'switch',
  'checkbox',
  'radio',
  'touchable',
  'listItem',
]);

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
  return [...s].slice(0, n).join('');
}

interface NormRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Project a mobile `state.layout` (pixels) into 0-1 viewport coords.
 *
 * Returns null when the element hasn't been measured yet (layout=null), the
 * viewport is degenerate (width/height ≤ 0), or pageX/pageY are absent —
 * the analyzer skips those rather than guessing.
 */
function normalizeRect(
  state: NativeElementState,
  viewport: { width: number; height: number }
): NormRect | null {
  const layout = state.layout;
  if (!layout) return null;
  if (viewport.width <= 0 || viewport.height <= 0) return null;
  // pageX/pageY are the absolute device-relative coords — what the analyzer
  // wants. Fall back to x/y (parent-relative) if the platform didn't fill
  // pageX/pageY; this loses absolute positioning but is better than dropping
  // the element entirely.
  const px = layout.pageX ?? layout.x;
  const py = layout.pageY ?? layout.y;
  return {
    x: px / viewport.width,
    y: py / viewport.height,
    width: layout.width / viewport.width,
    height: layout.height / viewport.height,
  };
}

// ============================================================================
// Analyzer
// ============================================================================

/**
 * Run the page-health analyzer over a list of mobile registry elements.
 *
 * The pipeline mirrors the canonical analyzer step-for-step:
 *
 *   1. Visible filter (state.visible + measurable layout)
 *   2. Spatial coverage on a 20x20 grid + left/right halves
 *   3. Layout regions (sidebar/header/content) by center-point
 *   4. Element diversity (nav-only flag)
 *   5. Text signal scanning (errors / loading / empty)
 *   6. Interactive readiness (disabled ratio across interactive types)
 *   7. Visual anomalies (zero-size, outside-viewport)
 *   8. ASCII heatmap
 *   9. Worst severity rollup
 */
export function diagnosePageHealth(
  elements: PageHealthElement[],
  viewport: { width: number; height: number }
): PageHealthReport {
  const findings: PageHealthFinding[] = [];

  // Project each element's layout once; the analyzer iterates the result
  // multiple times.
  const projected = elements.map((el) => ({
    el,
    rect: el.state.visible ? normalizeRect(el.state, viewport) : null,
  }));
  const visible = projected.filter((p) => p.rect !== null) as Array<{
    el: PageHealthElement;
    rect: NormRect;
  }>;

  // --- Step 2: Spatial coverage ---------------------------------------------
  const grid: boolean[][] = Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => false)
  );

  for (const { rect } of visible) {
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

  // --- Step 3: Layout regions -----------------------------------------------
  let sidebar = 0;
  let header = 0;
  let content = 0;
  for (const { rect } of visible) {
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

  // --- Step 5: Text signal scanning -----------------------------------------
  // No CSS-class scan on RN (no class names) — we still emit `css_signals:[]`
  // so callers branching on the field shape don't need a mobile special case.
  const detectedErrors: string[] = [];
  const detectedLoading: string[] = [];
  const detectedEmpty: string[] = [];
  const detectedCss: string[] = [];

  for (const el of elements) {
    const elType = el.type ?? '';
    if (SKIP_TEXT_TYPES.has(elType)) continue;

    const text = (el.state.textContent ?? '').toString();
    if (!text) continue;
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
  else if (detectedLoading.length > 0 || detectedEmpty.length > 0) textSeverity = 'WARNING';

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
    if (!INTERACTIVE_TYPES.has(el.type)) continue;
    interactiveTotal++;
    if (el.state.enabled === false) interactiveDisabled++;
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
  // `outside_viewport` counts only *horizontal* overflow. Below-fold and
  // above-fold content is normal on scrollable mobile screens and must not
  // flag — see the fold-semantics note at the top of this file.
  let zeroSize = 0;
  let outsideViewport = 0;
  for (const { rect } of visible) {
    if (rect.width === 0 || rect.height === 0) zeroSize++;
    if (rect.x + rect.width < 0 || rect.x > 1) {
      outsideViewport++;
    }
  }
  const anomalySeverity: PageHealthSeverity =
    zeroSize > 0 || outsideViewport > 0 ? 'WARNING' : 'OK';

  findings.push({
    check: 'visual_anomalies',
    severity: anomalySeverity,
    detail: `zero_size=${zeroSize}, outside_viewport=${outsideViewport} (horizontal-overflow only; below/above-fold scrollable content is not an anomaly)`,
    data: { zero_size: zeroSize, outside_viewport: outsideViewport },
  });

  // --- Step 8: ASCII heatmap ------------------------------------------------
  const heatmap: string[] = grid.map((row) =>
    row.map((cell) => (cell ? '#' : '.')).join('')
  );

  return {
    summary: worstSeverity(findings),
    findings,
    heatmap,
    element_count: elements.length,
    visible_count: visible.length,
  };
}
