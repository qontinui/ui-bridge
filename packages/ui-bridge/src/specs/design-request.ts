/**
 * Design-inspection requests over registered elements — `/design/element/:id/styles`,
 * `/design/snapshot`, `/design/responsive` and `/design/audit`.
 *
 * Two transports answer these routes: the direct server handlers
 * (`server/handlers.ts`) and the browser relay / in-page dispatcher
 * (`react/commandHandlers.ts`). The browser side used to be a separate,
 * cut-down reimplementation: ~22 computed properties with no design tokens,
 * no pseudo-elements and no `letterSpacing`; a snapshot silently cut at 50
 * elements; responsive snapshots refused outright; and an audit that ignored
 * the style guide — even one loaded through the browser's own `loadStyleGuide`
 * — in favour of four heuristics over the first 100 elements. Which transport
 * reached the page decided which model the caller got.
 *
 * Both transports call these functions, so one model answers whichever path a
 * request takes — the pattern `./quality-request` set for `/design/evaluate`.
 *
 * Bounds are explicit and reported, never silent. A response that carries
 * per-element design data reports `totalElements`, `returned`, `limit` and
 * `truncated`, and the caller raises the bound with `limit`. See
 * `DEFAULT_DESIGN_RECORD_BUDGET` for why there is a default at all.
 */

import type { ElementDesignData, ResponsiveSnapshot } from '../core/types';
import {
  DEFAULT_VIEWPORTS,
  RESPONSIVE_SNAPSHOT_METHOD,
  captureResponsiveSnapshots,
  getElementDesignData,
} from '../ai/design-inspector';
import { collectDesignData, type QualityElementSource } from './quality-request';
import { runStyleAudit } from './style-validator';
import type { StyleAuditReport, StyleGuideConfig } from './style-types';

/** The fields of a registered element these requests read (see `QualityElementSource`). */
export type DesignElementSource = QualityElementSource;

// ============================================================================
// Bounds
// ============================================================================

/**
 * The default number of per-element design records one response carries.
 *
 * A browser answer travels back as ONE JSON body (`relay-client.ts` POSTs it to
 * `{basePath}/commands`). Two receivers bound that body: this package's
 * Next.js relay route reads it through `readJsonBody`, capped at
 * `MAX_BODY_BYTES` (10 MiB), and the qontinui-runner's
 * `POST /ui-bridge/commands` (`ui_bridge_relay_command_result_handler`) takes
 * it through axum 0.8's `Json` extractor, whose `DefaultBodyLimit` is 2 MiB —
 * the route mounts no larger limit. One `ElementDesignData` is about 2-4 KB of
 * JSON (55 computed properties, plus custom properties: a Tailwind page
 * declares dozens on `*`), so a few hundred records already approach the
 * runner's limit, and a body over it is lost rather than truncated.
 *
 * 250 records keeps a response near 1 MB. `/design/snapshot` returns up to
 * this many elements; `/design/responsive` repeats every element once per
 * viewport, so it divides the budget by the viewport count. A caller who
 * knows its transport has room passes a larger `limit`.
 */
export const DEFAULT_DESIGN_RECORD_BUDGET = 250;

/** How much of the selection a design-data response carries. */
export interface DesignSelectionBounds {
  /** Registered elements the request selected that have a live DOM node. */
  totalElements: number;
  /** Elements whose design data this response carries. */
  returned: number;
  /** The element bound applied: the request's `limit`, else the default. */
  limit: number;
  /** `true` when `returned < totalElements` — the bound cut the selection. */
  truncated: boolean;
}

// ============================================================================
// Request bodies
// ============================================================================

/** `/design/snapshot` request body. */
export interface DesignSnapshotRequest {
  elementIds?: string[];
  includePseudoElements?: boolean;
  /** Most elements to return; default `DEFAULT_DESIGN_RECORD_BUDGET`. */
  limit?: number;
}

/** `/design/responsive` request body. */
export interface ResponsiveSnapshotsRequest {
  /** `{ label: width }` or a width list; default `DEFAULT_VIEWPORTS`. */
  viewports?: Record<string, number> | number[];
  elementIds?: string[];
  /** Most elements per snapshot; default the record budget / viewport count. */
  limit?: number;
}

/** `/design/audit` request body. */
export interface DesignAuditRequest {
  /** Audit against this guide; else the loaded one; else run the heuristics. */
  guide?: StyleGuideConfig;
  elementIds?: string[];
}

// ============================================================================
// Response models
// ============================================================================

/** `/design/snapshot` answer. */
export interface DesignSnapshotResponse extends DesignSelectionBounds {
  elements: ElementDesignData[];
  timestamp: number;
}

/**
 * `/design/responsive` answer: one snapshot per requested width.
 *
 * `method` and `mediaQueriesReevaluated` are always present so no consumer
 * mistakes a root-width constraint for a real narrow viewport (see
 * `RESPONSIVE_SNAPSHOT_METHOD`). `windowInnerWidth` is the real viewport width
 * the page's `@media` queries kept evaluating against throughout.
 */
export interface ResponsiveSnapshotsResponse extends DesignSelectionBounds {
  snapshots: ResponsiveSnapshot[];
  method: typeof RESPONSIVE_SNAPSHOT_METHOD;
  mediaQueriesReevaluated: false;
  windowInnerWidth: number;
  timestamp: number;
}

/** `/design/audit` answer when a style guide was provided or loaded. */
export interface StyleGuideDesignAuditReport extends StyleAuditReport {
  mode: 'style-guide';
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
export interface HeuristicDesignAuditReport {
  mode: 'heuristic';
  /** Why the heuristic ran instead of a style-guide audit. */
  reason: string;
  /** Selected registered elements with a live DOM node; all of them are checked. */
  totalElements: number;
  checkedElements: number;
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
 * DOM node (`NO_DOM_REFERENCE`). Each transport maps `code` onto the canonical
 * `UB-*` vocabulary the same way.
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

/**
 * The internal failure code a design handler answers `err` with: the request
 * error's own code, otherwise the route's.
 */
export function designFailureCode(err: unknown, routeCode: string): string {
  return err instanceof DesignRequestError ? err.code : routeCode;
}

type RequestBody = Record<string, unknown>;

function isObject(value: unknown): value is RequestBody {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Absent and JSON `null` both mean "not given". */
function isGiven(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function bodyOf(request: unknown, route: string): RequestBody {
  if (!isGiven(request)) return {};
  if (!isObject(request)) {
    throw new DesignRequestError(`${route}: the request body must be a JSON object`);
  }
  return request;
}

function elementIdsOf(body: RequestBody, route: string): string[] | undefined {
  const ids = body.elementIds;
  if (!isGiven(ids)) return undefined;
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) {
    throw new DesignRequestError(`${route}: elementIds must be an array of strings`);
  }
  return ids;
}

function booleanOf(body: RequestBody, key: string, route: string): boolean | undefined {
  const value = body[key];
  if (!isGiven(value)) return undefined;
  if (typeof value !== 'boolean') {
    throw new DesignRequestError(`${route}: ${key} must be a boolean`);
  }
  return value;
}

function limitOf(body: RequestBody, route: string): number | undefined {
  const limit = body.limit;
  if (!isGiven(limit)) return undefined;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1) {
    throw new DesignRequestError(`${route}: limit must be an integer >= 1`);
  }
  return limit;
}

function viewportsOf(body: RequestBody, route: string): Record<string, number> | number[] {
  const viewports = body.viewports;
  if (!isGiven(viewports)) return DEFAULT_VIEWPORTS;
  const valid = Array.isArray(viewports)
    ? viewports.length > 0 && viewports.every(isPositiveNumber)
    : isObject(viewports) &&
      Object.keys(viewports).length > 0 &&
      Object.values(viewports).every(isPositiveNumber);
  if (!valid) {
    throw new DesignRequestError(
      `${route}: viewports must be a non-empty { label: width } object or width array, ` +
        'each width a finite number greater than 0'
    );
  }
  return viewports as Record<string, number> | number[];
}

function guideOf(body: RequestBody, route: string): StyleGuideConfig | undefined {
  const guide = body.guide;
  if (!isGiven(guide)) return undefined;
  if (!isObject(guide) || !Array.isArray(guide.rules)) {
    throw new DesignRequestError(`${route}: guide must be a style guide object with a rules array`);
  }
  return guide as unknown as StyleGuideConfig;
}

// ============================================================================
// Selection
// ============================================================================

type LiveSource = DesignElementSource & { element: HTMLElement };

/**
 * The selected registered elements that have a live DOM node, in registry
 * order (all of them when `elementIds` is absent).
 */
function liveSelection(
  elements: readonly DesignElementSource[],
  elementIds: readonly string[] | undefined
): LiveSource[] {
  const wanted = elementIds ? new Set(elementIds) : null;
  return elements.filter(
    (el): el is LiveSource =>
      (wanted === null || wanted.has(el.id)) && el.element instanceof HTMLElement
  );
}

function bounded(
  live: LiveSource[],
  limit: number
): { kept: LiveSource[]; bounds: DesignSelectionBounds } {
  const kept = live.slice(0, limit);
  return {
    kept,
    bounds: {
      totalElements: live.length,
      returned: kept.length,
      limit,
      truncated: kept.length < live.length,
    },
  };
}

// ============================================================================
// The routes
// ============================================================================

/**
 * Answer `/design/element/:id/styles`: the full design data of one element,
 * pseudo-elements and custom properties (design tokens) included. `source` is
 * the element the transport resolved for `id`, or `undefined`.
 */
export function elementStylesOf(
  id: string,
  source: DesignElementSource | undefined
): ElementDesignData {
  if (!source) throw new DesignRequestError(`Element not found: ${id}`, 'ELEMENT_NOT_FOUND');
  if (!(source.element instanceof HTMLElement)) {
    throw new DesignRequestError('Element does not have a DOM reference', 'NO_DOM_REFERENCE');
  }
  return getElementDesignData(source.element, {
    elementId: source.id,
    label: source.label,
    type: source.type,
    includePseudoElements: true,
  });
}

/**
 * Answer `/design/snapshot`: design data for the selected elements, up to
 * `limit` (default `DEFAULT_DESIGN_RECORD_BUDGET`), with the cut reported.
 */
export function designSnapshotOf(
  elements: readonly DesignElementSource[],
  request: unknown
): DesignSnapshotResponse {
  const route = '/design/snapshot';
  const body = bodyOf(request, route);
  const elementIds = elementIdsOf(body, route);
  const includePseudoElements = booleanOf(body, 'includePseudoElements', route);
  const limit = limitOf(body, route) ?? DEFAULT_DESIGN_RECORD_BUDGET;
  const { kept, bounds } = bounded(liveSelection(elements, elementIds), limit);
  return {
    elements: collectDesignData(kept, undefined, { includePseudoElements }),
    ...bounds,
    timestamp: Date.now(),
  };
}

/**
 * Answer `/design/responsive`: one snapshot per requested width, taken by
 * constraining the root element's width (`RESPONSIVE_SNAPSHOT_METHOD`) — which
 * the response says, because `@media` queries do not re-evaluate. The default
 * element bound is the record budget divided by the viewport count.
 */
export async function responsiveSnapshotsOf(
  elements: readonly DesignElementSource[],
  request: unknown
): Promise<ResponsiveSnapshotsResponse> {
  const route = '/design/responsive';
  const body = bodyOf(request, route);
  const elementIds = elementIdsOf(body, route);
  const viewports = viewportsOf(body, route);
  const viewportCount = Array.isArray(viewports) ? viewports.length : Object.keys(viewports).length;
  const limit =
    limitOf(body, route) ?? Math.max(1, Math.floor(DEFAULT_DESIGN_RECORD_BUDGET / viewportCount));
  const { kept, bounds } = bounded(liveSelection(elements, elementIds), limit);
  const snapshots = await captureResponsiveSnapshots(
    {
      getAllElements: () =>
        kept.map((el) => ({
          id: el.id,
          element: el.element,
          type: el.type ?? el.element.tagName.toLowerCase(),
          label: el.label,
        })),
    },
    viewports
  );
  return {
    snapshots,
    method: RESPONSIVE_SNAPSHOT_METHOD,
    mediaQueriesReevaluated: false,
    windowInnerWidth: window.innerWidth,
    ...bounds,
    timestamp: Date.now(),
  };
}

/**
 * Answer `/design/audit`. With a guide — the request's `guide`, else the one
 * the transport has loaded — every selected element's full design data is
 * audited against it (`runStyleAudit`), `mode: 'style-guide'`. With none, the
 * built-in heuristics run over every selected element, `mode: 'heuristic'`.
 * No element is skipped in either mode: the report is per finding, not per
 * element, so its size follows the violations rather than the page.
 */
export function designAuditOf(
  elements: readonly DesignElementSource[],
  request: unknown,
  loadedGuide: StyleGuideConfig | null | undefined
): DesignAuditResponse {
  const route = '/design/audit';
  const body = bodyOf(request, route);
  const elementIds = elementIdsOf(body, route);
  const guide = guideOf(body, route) ?? loadedGuide ?? undefined;
  const live = liveSelection(elements, elementIds);
  if (guide) {
    return { mode: 'style-guide', ...runStyleAudit(collectDesignData(live), guide) };
  }
  return {
    mode: 'heuristic',
    reason: 'No style guide was provided in the request or loaded with loadStyleGuide',
    totalElements: live.length,
    checkedElements: live.length,
    issues: live.flatMap((el) => heuristicIssues(el.id, el.type, el.element)),
    timestamp: Date.now(),
  };
}

// ============================================================================
// Heuristic audit
// ============================================================================

/**
 * Contrast ratio below this means foreground and background are nearly identical,
 * making text effectively invisible (WCAG contrast ratio scale starts at 1:1).
 */
const NEARLY_INVISIBLE_CONTRAST_THRESHOLD = 1.15;

/** Linearize a single sRGB channel value (0–1) per WCAG 2.1 spec. */
function srgbToLinear(c: number): number {
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Parse an rgb/rgba or hex color string and return WCAG 2.1 relative luminance (0–1).
 * Supports: rgb(r,g,b), rgba(r,g,b,a), #rgb, #rgba, #rrggbb, #rrggbbaa.
 * Returns -1 if unparseable.
 */
function parseLuminance(color: string): number {
  let r: number, g: number, b: number;

  const rgbMatch = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    r = parseInt(rgbMatch[1]) / 255;
    g = parseInt(rgbMatch[2]) / 255;
    b = parseInt(rgbMatch[3]) / 255;
  } else {
    const hexMatch = color.match(/^#([0-9a-fA-F]{3,8})$/);
    if (!hexMatch) return -1;
    const hex = hexMatch[1];
    if (hex.length === 3 || hex.length === 4) {
      r = parseInt(hex[0] + hex[0], 16) / 255;
      g = parseInt(hex[1] + hex[1], 16) / 255;
      b = parseInt(hex[2] + hex[2], 16) / 255;
    } else if (hex.length === 6 || hex.length === 8) {
      r = parseInt(hex.slice(0, 2), 16) / 255;
      g = parseInt(hex.slice(2, 4), 16) / 255;
      b = parseInt(hex.slice(4, 6), 16) / 255;
    } else {
      return -1;
    }
  }

  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrastRatio(fgLum: number, bgLum: number): number {
  const lighter = Math.max(fgLum, bgLum);
  const darker = Math.min(fgLum, bgLum);
  return (lighter + 0.05) / (darker + 0.05);
}

function isLikelyDarkColor(color: string): boolean {
  const l = parseLuminance(color);
  return l >= 0 && l < 0.4;
}

function isLikelyLightColor(color: string): boolean {
  const l = parseLuminance(color);
  return l >= 0 && l > 0.6;
}

/** The heuristic findings for one element. */
function heuristicIssues(
  id: string,
  type: string | undefined,
  dom: HTMLElement
): HeuristicDesignAuditIssue[] {
  const issues: HeuristicDesignAuditIssue[] = [];
  const cs = getComputedStyle(dom);
  const textColor = cs.color;
  const bgColor = cs.backgroundColor;
  const fontSize = parseFloat(cs.fontSize);

  // Contrast, WCAG 2.1
  if (textColor && bgColor && textColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'rgba(0, 0, 0, 0)') {
    const fgLum = parseLuminance(textColor);
    const bgLum = parseLuminance(bgColor);
    if (fgLum >= 0 && bgLum >= 0) {
      const ratio = contrastRatio(fgLum, bgLum);
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
          issue: `Low contrast: ${ratio.toFixed(2)}:1 (${textColor} on ${bgColor}) — fails WCAG AA${fontSize >= 18 ? ' for large text (3:1)' : ' (4.5:1)'}`,
          severity: 'warning',
          fix: `Increase contrast to at least ${fontSize >= 18 ? '3:1' : '4.5:1'} for WCAG AA compliance`,
        });
      } else if (ratio < 4.5 && fontSize < 18) {
        issues.push({
          element: id,
          issue: `Insufficient contrast for normal text: ${ratio.toFixed(2)}:1 (${textColor} on ${bgColor}) — WCAG AA requires 4.5:1`,
          severity: 'info',
          fix: `Increase contrast to 4.5:1, or increase font size to 18px+`,
        });
      }
    }
  }

  // <select> in dark mode: native <option> dropdowns may be invisible
  if (dom.tagName === 'SELECT') {
    const scheme = cs.colorScheme || '';
    if (isLikelyDarkColor(bgColor) && isLikelyLightColor(textColor) && !scheme.includes('dark')) {
      issues.push({
        element: id,
        issue: `Select has light text (${textColor}) on dark bg (${bgColor}) without color-scheme:dark — native <option> dropdowns may be invisible`,
        severity: 'warning',
        fix: `Add style={{ colorScheme: "dark" }} to the <select> element and set option colors explicitly: [&>option]:text-black [&>option]:bg-white`,
      });
    }
    const firstOption = dom.querySelector('option');
    if (firstOption) {
      const optCs = getComputedStyle(firstOption);
      const optFgLum = parseLuminance(optCs.color || '');
      const optBgLum = parseLuminance(optCs.backgroundColor || '');
      if (optFgLum >= 0 && optBgLum >= 0) {
        const optRatio = contrastRatio(optFgLum, optBgLum);
        if (optRatio < 3.0) {
          issues.push({
            element: id,
            issue: `Select option text has low contrast: ${optRatio.toFixed(2)}:1 (${optCs.color} on ${optCs.backgroundColor})`,
            severity: 'error',
            fix: `Add explicit option colors: select option { color: #000; background-color: #fff; } or use [&>option]:text-black [&>option]:bg-white`,
          });
        }
      }
    }
  }

  if (fontSize < 12) {
    issues.push({ element: id, issue: `Font size too small: ${cs.fontSize}`, severity: 'info' });
  }

  if (type === 'button' || type === 'link') {
    const rect = dom.getBoundingClientRect();
    if (rect.width < 44 || rect.height < 44) {
      issues.push({
        element: id,
        issue: `Touch target too small: ${Math.round(rect.width)}x${Math.round(rect.height)}px (min 44x44)`,
        severity: 'warning',
      });
    }
  }

  return issues;
}
