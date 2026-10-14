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
 * ONE implementation for both web SDK transports: the in-page handler
 * (`server/handlers.ts`) and the relay handler (`server/relay-handlers.ts`)
 * both call {@link diagnosePageHealth}. `@qontinui/ui-bridge-server` does
 * NOT use it: it carries its own, different analyzer (triggered-only
 * findings keyed `low-spatial-coverage` etc., a `healthy/degraded/unhealthy`
 * roll-up) answering in the same envelope under producer
 * `sdk-server/page-health`. The two were deliberately not collapsed. The
 * React Native variant is also separate because its geometry input is
 * different (pixel `state.layout`, not `normalizedRect`).
 *
 * The answer is an {@link Observation}: the report rides in `value` only when
 * the analyzer could actually look. "Could not look" is `unknown` with a typed
 * code, never a CRITICAL report over zero elements:
 *
 *   - no `elements` array at all            → `unknown{input_missing}`
 *   - zero elements AND zero components     → `unknown{producer_not_run}`
 *   - visible elements, none with geometry  → `unknown{input_missing}`
 *   - elements, but EVERY one reports
 *     `visible: false` (occluded / hidden /
 *     off-screen / no-layout)               → `unknown{input_missing}` —
 *     what is on screen is not a registered element, so the producer could
 *     not see the page; it is not a blank page
 *   - the analyzer threw                    → `unknown{producer_failed}`
 *
 * Visible elements without a `normalizedRect` are no longer skipped silently:
 * they are counted into `provenance.coverage.unmeasured` as
 * `{ dimension: "geometry", code: "input_missing" }`, so a page whose
 * elements carry no geometry reads as UNMEASURED, not as spatially empty.
 * Elements whose snapshot carries no boolean `state.visible` are counted the
 * same way under `dimension: "visibility"` — never assumed hidden.
 *
 * Fold semantics (see Step 7: Visual anomalies):
 *
 *   The `outside_viewport` count tracks only *horizontal* overflow — elements
 *   whose normalized x is left of the viewport (`x + width < 0`) or right of
 *   it (`x > 1`). Vertical offsets (`y > 1`, `y + height < 0`) are NOT an
 *   anomaly: scrollable page content legitimately extends above or below the
 *   visible fold, and the user reaches it by scrolling. Flagging those would
 *   WARNING every long-scroll page. Only horizontal overflow is meaningfully
 *   unreachable on typical layouts (no horizontal scroll), so that's the
 *   anomaly we surface. Kept aligned with the mobile clone in
 *   `packages/ui-bridge-native/src/server/page-health.ts`.
 */

import type { DiscoveredElement } from '../control';
import { truncateCodePoints } from '../core/text';
import {
  Observation,
  type ObservationProducer,
  type ObservationProvenanceInit,
  type ObservationTime,
  type UnmeasuredDimension,
} from '../observation/observation';

declare const __SDK_VERSION__: string;

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

/**
 * The page-health report — the `value` of a `measured` page-health
 * observation. Coverage (how many visible elements carried geometry) lives in
 * the observation's `provenance.coverage`, not here.
 */
export interface PageHealthValue {
  /** Worst severity across all findings. Only ever present inside a `measured` observation. */
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

/** What the page-health producer answers with. */
export type PageHealthObservation = Observation<PageHealthValue>;

/** Producer id of the core SDK's page-health (in-page and relay handlers). */
export const SDK_PAGE_HEALTH_PRODUCER_ID = 'sdk/page-health';

/**
 * The inputs the page-health producer reads.
 *
 * `elements` is typed `unknown` ON PURPOSE: the caller hands over whatever the
 * snapshot / discover reply carried, and "there was no `elements` array" is
 * one of the answers this producer must be able to give. Coercing it to `[]`
 * at the call site (`snapshot.elements ?? []`) is exactly how "could not see"
 * used to render as "the page is blank".
 */
export interface PageHealthInput {
  /** The snapshot's / discover reply's `elements`, as received. */
  elements: unknown;
  /**
   * Components the bridge reports as registered, or `null` when the surface
   * keeps no such count. Zero elements plus zero components means nothing has
   * registered yet — the producer has nothing to look at.
   */
  registeredComponents: number | null;
  /** When the underlying snapshot was sampled. */
  observedAt: ObservationTime | null;
  /** Source attribution to carry in `provenance.source` (e.g. a snapshot id). */
  source?: Record<string, unknown> | null;
}

/** Options for {@link diagnosePageHealth}. */
export interface PageHealthOptions {
  /** Which producer is answering. Defaults to `sdk/page-health` at this package's version. */
  producer?: ObservationProducer;
  /** When the producer ran. Defaults to now. */
  evaluatedAt?: ObservationTime;
}

function defaultProducer(): ObservationProducer {
  return {
    id: SDK_PAGE_HEALTH_PRODUCER_ID,
    version: typeof __SDK_VERSION__ === 'string' ? __SDK_VERSION__ : 'unknown',
  };
}

type NormalizedRect = { x: number; y: number; width: number; height: number };

function rectOf(el: DiscoveredElement): NormalizedRect | null {
  const nr = (el.state as { normalizedRect?: NormalizedRect | null } | undefined)?.normalizedRect;
  return nr && typeof nr === 'object' ? nr : null;
}

function isVisible(el: DiscoveredElement): boolean {
  return (el.state as { visible?: boolean } | undefined)?.visible === true;
}

/** Did the snapshot say, one way or the other, whether this element is visible? */
function visibilityStated(el: DiscoveredElement): boolean {
  return typeof (el.state as { visible?: unknown } | undefined)?.visible === 'boolean';
}

/**
 * Why a snapshot that HAS elements left the producer nothing to place on
 * screen. Two causes, one answer (`unknown{input_missing}`):
 *
 *  - (a) some elements never said whether they are visible, or the visible
 *    ones carry no geometry — the inputs were missing (and are counted in
 *    `coverage.unmeasured`);
 *  - (b) every element reports `visible: false`. Visibility WAS measured, but
 *    then whatever IS on screen is not a registered element (an unregistered
 *    overlay occluding them, another route, content scrolled away) — and
 *    page-health measures only registered elements. A page the producer
 *    cannot see is not a blank page, so this is never a CRITICAL report.
 */
function nothingOnScreenDetail(
  elements: DiscoveredElement[],
  visibleCount: number,
  visibilityUnstated: number
): string {
  if (visibilityUnstated === 0 && visibleCount > 0) {
    return (
      `all ${visibleCount} visible element(s) carry no normalizedRect, so spatial ` +
      'coverage, layout regions and visual anomalies cannot be measured'
    );
  }
  if (visibilityUnstated > 0) {
    const geometry =
      visibleCount > 0
        ? ` and none of the ${visibleCount} visible one(s) carries a normalizedRect`
        : '';
    return (
      `${visibilityUnstated} of ${elements.length} element(s) carry no boolean ` +
      `\`state.visible\`${geometry}, so no element can be placed on screen; spatial ` +
      'coverage, layout regions and visual anomalies cannot be measured'
    );
  }
  const reasons = new Map<string, number>();
  for (const el of elements) {
    const r = (el.state as { visibilityReason?: unknown } | undefined)?.visibilityReason;
    const key = typeof r === 'string' && r.length > 0 ? r : 'unstated';
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }
  const tally = [...reasons].map(([reason, n]) => `${reason}=${n}`).join(', ');
  return (
    `all ${elements.length} registered element(s) report visible: false (${tally}), so ` +
    'whatever is on screen is not a registered element and there is nothing on screen to ' +
    'measure; this says nothing about whether the page is blank'
  );
}

/**
 * Build an `unknown` page-health observation for a failure the CALLER hit
 * before it could hand inputs over (e.g. creating the snapshot threw).
 */
export function pageHealthUnknown(
  code:
    | 'producer_failed'
    | 'input_missing'
    | 'producer_not_run'
    | 'app_unreachable'
    | 'stale_input',
  detail: string,
  options: PageHealthOptions & { observedAt?: ObservationTime | null } = {}
): PageHealthObservation {
  return Observation.unknown(
    code,
    detail,
    Observation.provenance({
      producer: options.producer ?? defaultProducer(),
      observedAt: options.observedAt ?? null,
      evaluatedAt: options.evaluatedAt,
    })
  );
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

const EMPTY_PHRASES = ['no data', 'no results', 'nothing here', 'empty', 'no items', 'get started'];

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

// ============================================================================
// Analyzer
// ============================================================================

/**
 * Run the page-health producer over a snapshot's elements and answer with an
 * {@link Observation}. Never throws: an exception is itself an answer
 * (`unknown{producer_failed}`).
 *
 * Mirrors `ui_bridge_page_health_handler` in screenshots.rs step-for-step:
 *
 *  1. Visible filter (state.visible && state.normalizedRect); visible elements
 *     WITHOUT a rect, and elements with no boolean `state.visible`, are
 *     counted into `coverage.unmeasured`; none left to place → `unknown`
 *  2. Spatial coverage on a 20x20 grid + left/right halves
 *  3. Layout regions (sidebar/header/content) by center-point
 *  4. Element diversity (nav-only flag)
 *  5. Text + CSS class signal scanning
 *  6. Interactive readiness (disabled ratio among `category === 'interactive'`)
 *  7. Visual anomalies (zero-size, outside-viewport)
 *  8. ASCII heatmap
 *  9. Overall summary = worst severity
 */
export function diagnosePageHealth(
  input: PageHealthInput,
  options: PageHealthOptions = {}
): PageHealthObservation {
  const producer = options.producer ?? defaultProducer();
  try {
    return observe(input, producer, options.evaluatedAt);
  } catch (err) {
    // Anything that threw — the analyzer, or an unparseable timestamp in the
    // inputs — is a producer failure, reported as one. Timestamps are left
    // out of this provenance because they may be what failed.
    return Observation.unknown(
      'producer_failed',
      `page-health producer threw: ${err instanceof Error ? err.message : String(err)}`,
      Observation.provenance({ producer })
    );
  }
}

/**
 * Build a {@link PageHealthInput} from a registry snapshot, AS RECEIVED.
 *
 * The one input-building step every `@qontinui/ui-bridge` transport shares —
 * the in-page server handler, the relay handler, and the in-app `pageHealth`
 * command (`react/commandHandlers.ts`). Exported from the package root and
 * `@qontinui/ui-bridge/observation` so a host answering page health over its
 * own transport (the qontinui-runner webview's `pageHealth` IPC) calls this
 * step instead of restating it. (`ui-bridge-server` and
 * `ui-bridge-native` carry their own analyzers.) A missing `elements` key reaches the producer
 * as missing, never as `[]` (`?? []` is how "could not see" turns into "saw
 * nothing"), and a missing `components` array is a `null` count, not zero.
 */
export function pageHealthInputFromSnapshot(snapshot: unknown): PageHealthInput {
  const raw = (typeof snapshot === 'object' && snapshot !== null ? snapshot : {}) as {
    elements?: unknown;
    components?: unknown;
    timestamp?: unknown;
    snapshotId?: unknown;
  };
  return {
    elements: raw.elements,
    registeredComponents: Array.isArray(raw.components) ? raw.components.length : null,
    observedAt: typeof raw.timestamp === 'number' ? raw.timestamp : null,
    // Attribute the answer to the snapshot it analyzed when the registry
    // stamped one.
    source: typeof raw.snapshotId === 'string' ? { snapshotId: raw.snapshotId } : null,
  };
}

/**
 * Take a registry snapshot and run the page-health producer over it. Never
 * throws: a snapshot that could not be taken is `unknown{producer_failed}`,
 * an answer rather than a transport error.
 */
export function diagnoseSnapshotPageHealth(
  takeSnapshot: () => unknown,
  options: PageHealthOptions = {}
): PageHealthObservation {
  let snapshot: unknown;
  try {
    snapshot = takeSnapshot();
  } catch (err) {
    return pageHealthUnknown(
      'producer_failed',
      `could not take the registry snapshot: ${err instanceof Error ? err.message : String(err)}`,
      options
    );
  }
  return diagnosePageHealth(pageHealthInputFromSnapshot(snapshot), options);
}

function observe(
  input: PageHealthInput,
  producer: ObservationProducer,
  evaluatedAt: ObservationTime | undefined
): PageHealthObservation {
  const base: ObservationProvenanceInit = {
    producer,
    observedAt: input.observedAt,
    evaluatedAt,
    source: input.source ?? null,
  };

  if (!Array.isArray(input.elements)) {
    return Observation.unknown(
      'input_missing',
      'the snapshot carried no `elements` array, so there was nothing to analyze; ' +
        'this says nothing about the page itself',
      // No elements were sampled — `observedAt: null` states that.
      Observation.provenance({ ...base, observedAt: null })
    );
  }
  const elements = input.elements as DiscoveredElement[];

  if (elements.length === 0 && (input.registeredComponents ?? 0) === 0) {
    return Observation.unknown(
      'producer_not_run',
      'the bridge reports zero registered elements and zero registered components — ' +
        'nothing has registered yet (not hydrated, not mounted, or an empty registry), ' +
        'so there was nothing to look at',
      Observation.provenance(base)
    );
  }

  return analyze(elements, base);
}

function analyze(
  elements: DiscoveredElement[],
  base: ObservationProvenanceInit
): PageHealthObservation {
  const findings: PageHealthFinding[] = [];

  // Considered = every element that is, or may be, on screen: the visible
  // ones plus those whose snapshot never said whether they are visible.
  // Measured = the visible ones carrying a normalized rect. Each considered
  // element that is not measured is COUNTED under the one dimension that
  // stopped it, never silently dropped.
  const visibilityUnstated = elements.filter((el) => !visibilityStated(el)).length;
  const onScreen = elements.filter(isVisible);
  const visible = onScreen.filter((el) => rectOf(el) !== null);
  const withoutGeometry = onScreen.length - visible.length;
  const unmeasured: UnmeasuredDimension[] = [];
  if (withoutGeometry > 0) {
    unmeasured.push({ dimension: 'geometry', count: withoutGeometry, code: 'input_missing' });
  }
  if (visibilityUnstated > 0) {
    unmeasured.push({ dimension: 'visibility', count: visibilityUnstated, code: 'input_missing' });
  }
  const coverage = {
    considered: onScreen.length + visibilityUnstated,
    measured: visible.length,
    unmeasured,
  };

  if (elements.length > 0 && visible.length === 0) {
    // Elements exist but none can be placed on screen. The spatial checks
    // would run over nothing and report a CRITICAL blank page that no
    // evidence supports — the producer did not look at the page, so it says
    // why it could not.
    return Observation.unknown(
      'input_missing',
      nothingOnScreenDetail(elements, onScreen.length, visibilityUnstated),
      Observation.provenance({ ...base, coverage })
    );
  }

  // --- Step 2: Spatial coverage ----------------------------------------------
  const grid: boolean[][] = Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => false)
  );

  for (const el of visible) {
    const rect = rectOf(el) as NormalizedRect;
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
    const rect = rectOf(el) as NormalizedRect;
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
  const allNav = elements.length > 5 && Object.keys(typeCounts).every((k) => NAV_TYPES.has(k));
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
        detectedErrors.push(truncateCodePoints(text, 120));
        break;
      }
    }
    for (const p of LOADING_PHRASES) {
      if (textLower.includes(p)) {
        detectedLoading.push(truncateCodePoints(text, 120));
        break;
      }
    }
    for (const p of EMPTY_PHRASES) {
      if (textLower.includes(p)) {
        detectedEmpty.push(truncateCodePoints(text, 120));
        break;
      }
    }
  }

  let textSeverity: PageHealthSeverity = 'OK';
  if (detectedErrors.length > 0) textSeverity = 'CRITICAL';
  else if (detectedLoading.length > 0 || detectedCss.length > 0 || detectedEmpty.length > 0)
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
  // `outside_viewport` counts only *horizontal* overflow. Below-fold and
  // above-fold content is normal on scrollable pages and must not flag —
  // see the fold-semantics note at the top of this file.
  let zeroSize = 0;
  let outsideViewport = 0;
  for (const el of visible) {
    const rect = rectOf(el) as NormalizedRect;
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
  const heatmap: string[] = grid.map((row) => row.map((filled) => (filled ? '#' : '.')).join(''));

  // --- Step 9: Worst severity rollup ----------------------------------------
  const summary = worstSeverity(findings);

  return Observation.measured(
    {
      summary,
      findings,
      heatmap,
      element_count: elements.length,
      visible_count: visible.length,
    },
    // A deduction over the snapshot, not an estimate: `confidence: null`.
    Observation.provenance({ ...base, coverage })
  );
}
