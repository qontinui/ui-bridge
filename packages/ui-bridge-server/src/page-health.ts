/**
 * Page Health Diagnostics — `@qontinui/ui-bridge-server`'s producer
 * (`sdk-server/page-health`).
 *
 * Analyzes discovered elements to produce a health report identifying
 * spatial coverage gaps, layout issues, loading/error signals, and more.
 *
 * NOTE: this is a different analyzer from the core SDK's
 * (`@qontinui/ui-bridge/observation` `diagnosePageHealth`, which mirrors the
 * runner): triggered-only findings keyed `low-spatial-coverage` etc., and a
 * `healthy | degraded | unhealthy` status. Both answer in the same
 * {@link Observation} envelope; `provenance.producer.id` says which one
 * answered.
 *
 * "Could not look" is an answer, never a CRITICAL report over nothing:
 *
 *   - no `elements` array at all            → `unknown{input_missing}`
 *   - zero elements AND zero components     → `unknown{producer_not_run}`
 *   - visible elements, none with geometry  → `unknown{input_missing}`
 *   - the analyzer threw                    → `unknown{producer_failed}`
 *
 * Visible elements without a `normalizedRect` are COUNTED into
 * `provenance.coverage.unmeasured` (`dimension: "geometry"`), not skipped.
 * `status` lives only inside a `measured` value.
 */

import type { DiscoveredElement } from '@qontinui/ui-bridge/control';
import {
  Observation,
  type ObservationProducer,
  type ObservationProvenanceInit,
  type ObservationTime,
  type UnmeasuredDimension,
} from '@qontinui/ui-bridge/observation';

declare const __SDK_VERSION__: string;

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

/**
 * The report — the `value` of a `measured` page-health observation. How many
 * visible elements carried geometry lives in `provenance.coverage`; when the
 * report was computed lives in `provenance.evaluatedAt`.
 */
export interface PageHealthValue {
  /** Overall roll-up: 'healthy' | 'degraded' | 'unhealthy'. Only ever inside a `measured` observation. */
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
}

/** What this producer answers with. */
export type PageHealthObservation = Observation<PageHealthValue>;

/** Producer id of `@qontinui/ui-bridge-server`'s page-health. */
export const SERVER_PAGE_HEALTH_PRODUCER_ID = 'sdk-server/page-health';

/** Inputs, handed over AS RECEIVED — a missing `elements` must reach here as missing, not `[]`. */
export interface PageHealthInput {
  /** The discover reply's / registry's `elements`, as received. */
  elements: unknown;
  /** Components the registry reports, or `null` when it keeps no such count. */
  registeredComponents: number | null;
  /** When the elements were sampled. */
  observedAt: ObservationTime | null;
}

/** Options for {@link diagnosePageHealth}. */
export interface PageHealthOptions {
  /** Defaults to `sdk-server/page-health` at this package's version. */
  producer?: ObservationProducer;
  /** When the producer ran. Defaults to now. */
  evaluatedAt?: ObservationTime;
}

function defaultProducer(): ObservationProducer {
  return {
    id: SERVER_PAGE_HEALTH_PRODUCER_ID,
    version: typeof __SDK_VERSION__ === 'string' ? __SDK_VERSION__ : 'unknown',
  };
}

/** An `unknown` page-health observation for a failure hit before inputs existed. */
export function pageHealthUnknown(
  code: 'producer_failed' | 'input_missing' | 'producer_not_run' | 'app_unreachable',
  detail: string,
  options: PageHealthOptions = {}
): PageHealthObservation {
  return Observation.unknown(
    code,
    detail,
    Observation.provenance({
      producer: options.producer ?? defaultProducer(),
      evaluatedAt: options.evaluatedAt,
    })
  );
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
 * Diagnose page health from discovered elements. Never throws: an exception
 * is itself an answer (`unknown{producer_failed}`).
 */
export function diagnosePageHealth(
  input: PageHealthInput,
  options: PageHealthOptions = {}
): PageHealthObservation {
  const producer = options.producer ?? defaultProducer();
  try {
    return observe(input, producer, options.evaluatedAt);
  } catch (err) {
    return Observation.unknown(
      'producer_failed',
      `page-health producer threw: ${err instanceof Error ? err.message : String(err)}`,
      Observation.provenance({ producer })
    );
  }
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
  };

  if (!Array.isArray(input.elements)) {
    return Observation.unknown(
      'input_missing',
      'the discover reply carried no `elements` array, so there was nothing to analyze; ' +
        'this says nothing about the page itself',
      Observation.provenance({ ...base, observedAt: null })
    );
  }
  const elements = input.elements as DiscoveredElement[];

  if (elements.length === 0 && (input.registeredComponents ?? 0) === 0) {
    return Observation.unknown(
      'producer_not_run',
      'the registry reports zero elements and zero components — nothing has registered ' +
        'yet, so there was nothing to look at',
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

  const visibleElements = elements.filter((el) => el.state?.visible === true);
  // Visible elements that carry geometry; the rest are COUNTED as unmeasured.
  const measuredElements = visibleElements.flatMap((el) => {
    const nr = el.state.normalizedRect;
    return nr ? [{ el, nr }] : [];
  });
  const withoutGeometry = visibleElements.length - measuredElements.length;
  const unmeasured: UnmeasuredDimension[] =
    withoutGeometry > 0
      ? [{ dimension: 'geometry', count: withoutGeometry, code: 'input_missing' }]
      : [];
  const coverage = {
    considered: visibleElements.length,
    measured: measuredElements.length,
    unmeasured,
  };

  if (visibleElements.length > 0 && measuredElements.length === 0) {
    return Observation.unknown(
      'input_missing',
      `all ${visibleElements.length} visible element(s) carry no normalizedRect, so spatial ` +
        'coverage, layout regions and visual anomalies cannot be measured',
      Observation.provenance({ ...base, coverage })
    );
  }

  // ---- Spatial Coverage (20x20 grid) ----
  const grid: boolean[][] = Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => false)
  );

  for (const { nr } of measuredElements) {
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

  for (const { nr } of measuredElements) {
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
  for (const { el, nr } of measuredElements) {
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

  return Observation.measured(
    {
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
    },
    // A deduction over the discovered elements, not an estimate.
    Observation.provenance({ ...base, coverage })
  );
}
