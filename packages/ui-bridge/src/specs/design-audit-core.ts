/**
 * The pure core of `/design/audit`, shared by every transport that answers it.
 *
 * The web transports (`server/handlers.ts`, `react/commandHandlers.ts`) reach
 * it through `designAuditOf` (`./design-request`), which is a DOM adapter over
 * this module. The React Native server reaches it through the `./specs` entry
 * (`auditDesign`) with its own adapter over registered native elements. One
 * implementation parses the body, selects and bounds the elements, picks the
 * mode and builds both reports, so the transports cannot drift apart — the
 * pattern `./style-inference-body` set for the inference routes.
 *
 * This module touches no `window`, `document` or DOM type, so it loads under
 * Node and Hermes. Everything that reads a page lives in an adapter.
 *
 * It also holds the request-body helpers the other design routes
 * (`./design-request`) validate with, so every design body is refused with
 * one set of rules and messages.
 */

import type { ElementDesignData } from '../core/types';
import { contrastOfColors, parseColor, relativeLuminance } from './color-utils';
import { runStyleAudit } from './style-validator';
import type { StyleAuditReport, StyleGuideConfig } from './style-types';

// ============================================================================
// Bounds
// ============================================================================

/**
 * The default number of elements `/design/audit` checks. Its report carries
 * findings, not per-element design data — failures only, capped by
 * `maxResults` — so its size does not follow the element count the way a
 * snapshot's does, and a whole page fits.
 */
export const DEFAULT_AUDIT_ELEMENT_LIMIT = 2_000;

/** The most ids `missingElementIds` / `unreadableElementIds` echo; the counts cover the rest. */
export const MAX_ECHOED_ELEMENT_IDS = 50;

/**
 * The most findings an audit lists: rule results in style-guide mode,
 * issues in heuristic mode. A rule result echoes its constraints with expected
 * and actual values, a few hundred bytes, so 1,000 keeps the report under
 * about 1 MB — the same order as the record budget. This bound, not the
 * element limit, is what keeps an audit's size independent of the page.
 */
export const DEFAULT_AUDIT_MAX_RESULTS = 1_000;

/** Why a heuristic audit ran instead of a style-guide one (`HeuristicDesignAuditReport.reason`). */
export const NO_STYLE_GUIDE_REASON =
  'No style guide was provided in the request or loaded with loadStyleGuide';

/** What the request selected, and what of it could not be read. */
export interface DesignSelectionReport {
  /** Registered elements the request selected that have a live DOM node. */
  totalElements: number;
  /** The element bound applied: the request's `limit`, else the default. */
  limit: number;
  /** `true` when the bound cut the selection. */
  truncated: boolean;
  /**
   * Requested `elementIds` that name no registered element (empty without
   * `elementIds`), at most `MAX_ECHOED_ELEMENT_IDS` of them.
   */
  missingElementIds: string[];
  /** How many requested ids name no registered element. */
  missingElementCount: number;
  /**
   * Selected registered elements whose node is not an `HTMLElement` (an SVG
   * element, or none at all), so no design data was read for them, at most
   * `MAX_ECHOED_ELEMENT_IDS` of them. They are not counted in `totalElements`.
   */
  unreadableElementIds: string[];
  /** How many selected registered elements had no `HTMLElement` node. */
  unreadableElementCount: number;
}

/** How much of the selection an audit checked. */
export interface DesignAuditBounds extends DesignSelectionReport {
  /** Elements the audit checked. */
  checkedElements: number;
}

// ============================================================================
// Request body
// ============================================================================

/** `/design/audit` request body. */
export interface DesignAuditRequest {
  /** Audit against this guide; else the loaded one; else run the heuristics. */
  guide?: StyleGuideConfig;
  elementIds?: string[];
  /** Most elements to audit; default `DEFAULT_AUDIT_ELEMENT_LIMIT`. */
  limit?: number;
  /** List passing rule results too (style-guide mode); default `false`. */
  includePassed?: boolean;
  /** Most rule results to list (style-guide mode); default `DEFAULT_AUDIT_MAX_RESULTS`. */
  maxResults?: number;
  /**
   * Root font size `rem` resolves against (style-guide mode); default: the
   * transport's own figure — measured from `documentElement` on the web (the
   * figure style inference and drift use), 16 on React Native.
   */
  rootFontSizePx?: number;
}

// ============================================================================
// Response models
// ============================================================================

/**
 * `/design/audit` answer when a style guide was provided or loaded.
 *
 * `results` lists failures only unless `includePassed`, and at most
 * `maxResults` of them (`resultsTruncated`, `listableResults`).
 * `passedCount` / `failedCount` and the `summary` counts cover every result.
 * `summary` carries counts, not lists: the failures are already in `results`,
 * and listing them twice doubled the report.
 */
export interface StyleGuideDesignAuditReport
  extends
    Omit<StyleAuditReport, 'totalElements' | 'summary'>,
    DesignAuditBounds,
    AuditResultBounds {
  mode: 'style-guide';
  /** Failed results by severity. */
  summary: { errors: number; warnings: number; info: number };
  /** Whether passing results are listed. */
  includePassed: boolean;
}

/** How much of an audit's findings its report lists (both modes). */
export interface AuditResultBounds {
  /** The bound applied to the listed findings (`results`, or `issues`). */
  maxResults: number;
  /** Findings eligible for listing (all failures; with `includePassed`, passes too). */
  listableResults: number;
  /** `true` when `maxResults` cut the list. */
  resultsTruncated: boolean;
}

/** One finding of the heuristic audit. */
export interface HeuristicDesignAuditIssue {
  element: string;
  issue: string;
  severity: 'error' | 'warning' | 'info';
  fix?: string;
}

/**
 * `/design/audit` answer when NO style guide was provided or loaded: built-in
 * heuristics (contrast, dark-mode `<select>`, font size, touch target), never a
 * style-guide verdict. `mode` says which one the caller got.
 */
export interface HeuristicDesignAuditReport extends DesignAuditBounds, AuditResultBounds {
  mode: 'heuristic';
  /** Why the heuristic ran instead of a style-guide audit. */
  reason: string;
  issues: HeuristicDesignAuditIssue[];
  timestamp: number;
}

/** `/design/audit` answer: self-describing by `mode`. */
export type DesignAuditResponse = StyleGuideDesignAuditReport | HeuristicDesignAuditReport;

// ============================================================================
// Request validation
// ============================================================================

/**
 * A design request that cannot be answered: a malformed body
 * (`INVALID_REQUEST`), an unknown element (`ELEMENT_NOT_FOUND`), or one with no
 * DOM node (`NO_DOM_REFERENCE`). Each transport maps `code` onto its own
 * vocabulary the same way.
 */
export class DesignRequestError extends Error {
  constructor(
    message: string,
    readonly code: 'INVALID_REQUEST' | 'ELEMENT_NOT_FOUND' | 'NO_DOM_REFERENCE' = 'INVALID_REQUEST'
  ) {
    super(message);
    this.name = 'DesignRequestError';
  }
}

export type RequestBody = Record<string, unknown>;

export function isObject(value: unknown): value is RequestBody {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Absent and JSON `null` both mean "not given". */
export function isGiven(value: unknown): boolean {
  return value !== undefined && value !== null;
}

export function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function bodyOf(request: unknown, route: string): RequestBody {
  if (!isGiven(request)) return {};
  if (!isObject(request)) {
    throw new DesignRequestError(`${route}: the request body must be a JSON object`);
  }
  return request;
}

export function elementIdsOf(body: RequestBody, route: string): string[] | undefined {
  const ids = body.elementIds;
  if (!isGiven(ids)) return undefined;
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) {
    throw new DesignRequestError(`${route}: elementIds must be an array of strings`);
  }
  return ids;
}

export function booleanOf(body: RequestBody, key: string, route: string): boolean | undefined {
  const value = body[key];
  if (!isGiven(value)) return undefined;
  if (typeof value !== 'boolean') {
    throw new DesignRequestError(`${route}: ${key} must be a boolean`);
  }
  return value;
}

export function positiveIntegerOf(
  body: RequestBody,
  key: string,
  route: string
): number | undefined {
  const value = body[key];
  if (!isGiven(value)) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new DesignRequestError(`${route}: ${key} must be an integer >= 1`);
  }
  return value;
}

export function limitOf(body: RequestBody, route: string): number | undefined {
  return positiveIntegerOf(body, 'limit', route);
}

export function guideOf(body: RequestBody, route: string): StyleGuideConfig | undefined {
  const guide = body.guide;
  if (!isGiven(guide)) return undefined;
  if (!isObject(guide) || !Array.isArray(guide.rules)) {
    throw new DesignRequestError(`${route}: guide must be a style guide object with a rules array`);
  }
  return guide as unknown as StyleGuideConfig;
}

/** A validated `/design/audit` body, defaults applied. */
interface ParsedDesignAuditBody {
  rootFontSizePx?: number;
  elementIds?: string[];
  guide?: StyleGuideConfig;
  limit: number;
  includePassed: boolean;
  maxResults: number;
}

/**
 * Validate a `/design/audit` body. Fields are checked in one fixed order —
 * body, `rootFontSizePx`, `elementIds`, `guide`, `limit`, `includePassed`,
 * `maxResults` — so a body wrong in several ways is refused for the same
 * field on every transport. Throws `DesignRequestError`.
 */
function parseDesignAuditBody(request: unknown): ParsedDesignAuditBody {
  const route = '/design/audit';
  const body = bodyOf(request, route);
  const requestedRoot = body.rootFontSizePx;
  if (isGiven(requestedRoot) && !isPositiveNumber(requestedRoot)) {
    throw new DesignRequestError(`${route}: rootFontSizePx must be a finite number greater than 0`);
  }
  const elementIds = elementIdsOf(body, route);
  const guide = guideOf(body, route);
  const limit = limitOf(body, route) ?? DEFAULT_AUDIT_ELEMENT_LIMIT;
  const includePassed = booleanOf(body, 'includePassed', route) ?? false;
  const maxResults = positiveIntegerOf(body, 'maxResults', route) ?? DEFAULT_AUDIT_MAX_RESULTS;
  return {
    rootFontSizePx: isGiven(requestedRoot) ? (requestedRoot as number) : undefined,
    elementIds,
    guide,
    limit,
    includePassed,
    maxResults,
  };
}

// ============================================================================
// Selection
// ============================================================================

/** The selected elements a transport can read, and what it could not select or read. */
export interface Selection<R> {
  /** Selected elements the transport can read, in registry order. */
  live: R[];
  missingElementIds: string[];
  unreadableElementIds: string[];
}

/**
 * The selected registered elements (all of them when `elementIds` is absent;
 * none for an empty list), split by `isReadable` into those the transport can
 * read and those it cannot, plus the requested ids that name no registered
 * element.
 */
export function selectElements<T extends { id: string }, R extends T>(
  elements: readonly T[],
  elementIds: readonly string[] | undefined,
  isReadable: (el: T) => el is R
): Selection<R> {
  const wanted = elementIds ? new Set(elementIds) : null;
  const live: R[] = [];
  const unreadableElementIds: string[] = [];
  const seen = new Set<string>();
  for (const el of elements) {
    if (wanted !== null && !wanted.has(el.id)) continue;
    seen.add(el.id);
    if (isReadable(el)) live.push(el);
    else unreadableElementIds.push(el.id);
  }
  const missingElementIds = wanted ? [...wanted].filter((id) => !seen.has(id)) : [];
  return { live, missingElementIds, unreadableElementIds };
}

/** The first `limit` readable elements of a selection, and the report of the cut. */
export function bounded<R>(
  selection: Selection<R>,
  limit: number
): { kept: R[]; report: DesignSelectionReport } {
  const { live, missingElementIds, unreadableElementIds } = selection;
  const kept = live.slice(0, limit);
  return {
    kept,
    report: {
      totalElements: live.length,
      limit,
      truncated: kept.length < live.length,
      missingElementIds: missingElementIds.slice(0, MAX_ECHOED_ELEMENT_IDS),
      missingElementCount: missingElementIds.length,
      unreadableElementIds: unreadableElementIds.slice(0, MAX_ECHOED_ELEMENT_IDS),
      unreadableElementCount: unreadableElementIds.length,
    },
  };
}

// ============================================================================
// Style-guide mode
// ============================================================================

/**
 * The style-guide report: every record audited against `guide`, failures
 * listed unless `includePassed`, at most `maxResults` listed, the summary as
 * counts over every result.
 */
function styleGuideAuditReport(
  records: ElementDesignData[],
  guide: StyleGuideConfig,
  options: { rootFontSizePx: number; includePassed: boolean; maxResults: number },
  bounds: DesignAuditBounds
): StyleGuideDesignAuditReport {
  const { includePassed, maxResults } = options;
  const {
    totalElements: _audited,
    summary,
    ...audit
  } = runStyleAudit(records, guide, { rootFontSizePx: options.rootFontSizePx });
  const listable = includePassed ? audit.results : audit.results.filter((r) => !r.passed);
  return {
    mode: 'style-guide',
    ...audit,
    results: listable.slice(0, maxResults),
    summary: {
      errors: summary.errors.length,
      warnings: summary.warnings.length,
      info: summary.info.length,
    },
    includePassed,
    maxResults,
    listableResults: listable.length,
    resultsTruncated: listable.length > maxResults,
    ...bounds,
  };
}

// ============================================================================
// Heuristic mode
// ============================================================================

/**
 * What the heuristics read of one element, gathered by the transport's
 * adapter: the web one from computed styles and the laid-out box, the React
 * Native one from the element's flattened style and its layout.
 */
export interface HeuristicInput {
  /** The registered element's id. */
  id: string;
  /** Whether the element is something a person taps, so it must be 44x44 or larger. */
  touchTarget: boolean;
  /** Text colour, a CSS colour value (`''` when the transport has none). */
  color: string;
  /** Background colour, a CSS colour value (`''` when the transport has none). */
  backgroundColor: string;
  /** Font size in px, or `null` when it is not known. */
  fontSizePx: number | null;
  /** The laid-out size, or `null` when the element has no layout yet. */
  rect: { width: number; height: number } | null;
  /** Present for a `<select>`: its `color-scheme` and its first `<option>`'s colours. */
  select?: { colorScheme: string; option?: { color: string; backgroundColor: string } };
}

/**
 * Contrast ratio below this means foreground and background are nearly identical,
 * making text effectively invisible (WCAG contrast ratio scale starts at 1:1).
 */
const NEARLY_INVISIBLE_CONTRAST_THRESHOLD = 1.15;

/** The smallest touch target, in px on each side. */
const MIN_TOUCH_TARGET_PX = 44;

/**
 * Relative luminance of an opaque colour value, or `null` when it does not
 * parse or is not opaque (a partly transparent colour's look depends on what
 * is behind it — the same rule `contrastOfColors` applies to a background).
 * One colour grammar with the quality metrics (`./color-utils`), so an
 * `oklch()` computed colour is read.
 */
function luminanceOf(color: string): number | null {
  const c = parseColor(color);
  return c !== null && c.a === 1 ? relativeLuminance(c) : null;
}

function isLikelyDarkColor(color: string): boolean {
  const l = luminanceOf(color);
  return l !== null && l < 0.4;
}

function isLikelyLightColor(color: string): boolean {
  const l = luminanceOf(color);
  return l !== null && l > 0.6;
}

/** The heuristic findings for one element. */
function heuristicIssuesOf(input: HeuristicInput): HeuristicDesignAuditIssue[] {
  const issues: HeuristicDesignAuditIssue[] = [];
  const { id, color: textColor, backgroundColor: bgColor, fontSizePx } = input;
  const large = fontSizePx !== null && fontSizePx >= 18;

  // Contrast, WCAG 2.1: only where both colours can be read and the
  // background is opaque (what shows through a transparent one is not known).
  const ratio = contrastOfColors(textColor, bgColor);
  if (ratio !== null) {
    if (ratio < NEARLY_INVISIBLE_CONTRAST_THRESHOLD) {
      issues.push({
        element: id,
        issue: `Text nearly invisible: contrast ratio ${ratio.toFixed(2)}:1 (${textColor} on ${bgColor})`,
        severity: 'error',
        fix: `Add explicit text color with sufficient contrast against ${bgColor}`,
      });
    } else if (ratio < 3.0) {
      issues.push({
        element: id,
        issue: `Low contrast: ${ratio.toFixed(2)}:1 (${textColor} on ${bgColor}) — fails WCAG AA${large ? ' for large text (3:1)' : ' (4.5:1)'}`,
        severity: 'warning',
        fix: `Increase contrast to at least ${large ? '3:1' : '4.5:1'} for WCAG AA compliance`,
      });
    } else if (ratio < 4.5 && fontSizePx !== null && fontSizePx < 18) {
      issues.push({
        element: id,
        issue: `Insufficient contrast for normal text: ${ratio.toFixed(2)}:1 (${textColor} on ${bgColor}) — WCAG AA requires 4.5:1`,
        severity: 'info',
        fix: `Increase contrast to 4.5:1, or increase font size to 18px+`,
      });
    }
  }

  // <select> in dark mode: native <option> dropdowns may be invisible
  if (input.select) {
    const { colorScheme, option } = input.select;
    if (
      isLikelyDarkColor(bgColor) &&
      isLikelyLightColor(textColor) &&
      !colorScheme.includes('dark')
    ) {
      issues.push({
        element: id,
        issue: `Select has light text (${textColor}) on dark bg (${bgColor}) without color-scheme:dark — native <option> dropdowns may be invisible`,
        severity: 'warning',
        fix: `Add style={{ colorScheme: "dark" }} to the <select> element and set option colors explicitly: [&>option]:text-black [&>option]:bg-white`,
      });
    }
    if (option) {
      const optRatio = contrastOfColors(option.color, option.backgroundColor);
      if (optRatio !== null && optRatio < 3.0) {
        issues.push({
          element: id,
          issue: `Select option text has low contrast: ${optRatio.toFixed(2)}:1 (${option.color} on ${option.backgroundColor})`,
          severity: 'error',
          fix: `Add explicit option colors: select option { color: #000; background-color: #fff; } or use [&>option]:text-black [&>option]:bg-white`,
        });
      }
    }
  }

  if (fontSizePx !== null && fontSizePx < 12) {
    issues.push({ element: id, issue: `Font size too small: ${fontSizePx}px`, severity: 'info' });
  }

  if (input.touchTarget && input.rect !== null) {
    const { width, height } = input.rect;
    if (width < MIN_TOUCH_TARGET_PX || height < MIN_TOUCH_TARGET_PX) {
      issues.push({
        element: id,
        issue: `Touch target too small: ${Math.round(width)}x${Math.round(height)}px (min 44x44)`,
        severity: 'warning',
      });
    }
  }

  return issues;
}

/** The heuristic report over the checked elements' inputs, at most `maxResults` issues listed. */
function heuristicAuditReport(
  inputs: HeuristicInput[],
  maxResults: number,
  bounds: DesignAuditBounds
): HeuristicDesignAuditReport {
  const issues = inputs.flatMap(heuristicIssuesOf);
  return {
    mode: 'heuristic',
    reason: NO_STYLE_GUIDE_REASON,
    ...bounds,
    issues: issues.slice(0, maxResults),
    maxResults,
    listableResults: issues.length,
    resultsTruncated: issues.length > maxResults,
    timestamp: Date.now(),
  };
}

// ============================================================================
// The audit
// ============================================================================

/**
 * What a transport supplies to `auditDesign`: how to tell a readable element
 * (`R`) from the registered ones (`T`), and how to read one.
 */
export interface DesignAuditAdapter<T extends { id: string }, R extends T = T> {
  /** Whether the transport can read the element's design data. */
  isReadable(el: T): el is R;
  /** The design data the style-guide audit reads, for the checked elements. */
  records(kept: R[], guide: StyleGuideConfig): ElementDesignData[];
  /** What the heuristics read of one checked element. */
  heuristicInput(el: R): HeuristicInput;
  /** The root font size `rem` resolves against when the request names none. */
  defaultRootFontSizePx(): number;
}

/**
 * Answer `/design/audit` over a transport's registered elements. With a
 * guide — the request's `guide`, else `loadedGuide` — the checked elements'
 * design data is audited against it (`runStyleAudit`), `mode: 'style-guide'`.
 * With none, the built-in heuristics run, `mode: 'heuristic'`.
 *
 * `runStyleAudit` yields one result per matched element x rule, passes
 * included, so an unbounded report grows with the page. Both modes therefore
 * check at most `limit` elements (default `DEFAULT_AUDIT_ELEMENT_LIMIT`) and
 * report the cut. The style-guide mode also lists only failed results unless
 * `includePassed` is set, and summarises by count rather than repeating the
 * failures (its counts always cover every result). Both modes list at most
 * `maxResults` findings (default `DEFAULT_AUDIT_MAX_RESULTS`) and report
 * `listableResults` / `resultsTruncated`.
 *
 * Throws `DesignRequestError` (`INVALID_REQUEST`) for a malformed body.
 */
export function auditDesign<T extends { id: string }, R extends T = T>(
  elements: readonly T[],
  request: unknown,
  loadedGuide: StyleGuideConfig | null | undefined,
  adapter: DesignAuditAdapter<T, R>
): DesignAuditResponse {
  const parsed = parseDesignAuditBody(request);
  const guide = parsed.guide ?? loadedGuide ?? undefined;
  const { kept, report } = bounded(
    selectElements(elements, parsed.elementIds, (el): el is R => adapter.isReadable(el)),
    parsed.limit
  );
  const bounds: DesignAuditBounds = { ...report, checkedElements: kept.length };
  if (guide) {
    return styleGuideAuditReport(
      adapter.records(kept, guide),
      guide,
      {
        rootFontSizePx: parsed.rootFontSizePx ?? adapter.defaultRootFontSizePx(),
        includePassed: parsed.includePassed,
        maxResults: parsed.maxResults,
      },
      bounds
    );
  }
  return heuristicAuditReport(
    kept.map((el) => adapter.heuristicInput(el)),
    parsed.maxResults,
    bounds
  );
}
