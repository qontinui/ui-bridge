/**
 * Design-inspection requests over registered elements — `/design/element/:id/styles`,
 * `/design/snapshot`, `/design/responsive` and `/design/audit` — plus
 * `/control/viewport-constraints`, the other root-width mutation.
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
  CONSTRAINED_ROOT_PROPERTIES,
  DEFAULT_VIEWPORTS,
  RESPONSIVE_SNAPSHOT_METHOD,
  captureResponsiveSnapshots,
  getElementDesignData,
} from '../ai/design-inspector';
import { RootWidthLockError, withRootWidthLock } from '../core/root-width-lock';
import {
  collectDesignBatch,
  collectDesignData,
  type DesignCollectOptions,
  type QualityElementSource,
} from './quality-request';
import { indexCustomProperties } from '../ai/design-inspector';
import { disposeTokenIndex, reportedTokensOf, type ReportedTokens } from '../ai/design-tokens';
import { measureRootFontSizePx } from './style-inference-request';
import type { StyleGuideConfig } from './style-types';
import {
  auditDesign,
  bodyOf,
  booleanOf,
  bounded,
  DesignRequestError,
  elementIdsOf,
  isGiven,
  isObject,
  isPositiveNumber,
  limitOf,
  selectElements,
  type DesignAuditAdapter,
  type DesignAuditResponse,
  type DesignSelectionReport,
  type HeuristicInput,
  type RequestBody,
} from './design-audit-core';

export {
  DEFAULT_AUDIT_ELEMENT_LIMIT,
  DEFAULT_AUDIT_MAX_RESULTS,
  DesignRequestError,
  MAX_ECHOED_ELEMENT_IDS,
} from './design-audit-core';
export type {
  AuditResultBounds,
  DesignAuditBounds,
  DesignAuditRequest,
  DesignAuditResponse,
  DesignSelectionReport,
  HeuristicDesignAuditIssue,
  HeuristicDesignAuditReport,
  StyleGuideDesignAuditReport,
} from './design-audit-core';

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
 * viewport, so it divides the budget by the viewport count (at most
 * `MAX_RESPONSIVE_VIEWPORTS`). A caller who knows its transport has room
 * passes a larger `limit`.
 */
export const DEFAULT_DESIGN_RECORD_BUDGET = 250;

/** The most viewports one `/design/responsive` request may name. */
export const MAX_RESPONSIVE_VIEWPORTS = 16;

/** How much of the selection a design-data response carries. */
export interface DesignSelectionBounds extends DesignSelectionReport {
  /** Elements whose design data this response carries. */
  returned: number;
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
  /**
   * How long the capture may take, waiting for the root-width lock included;
   * default `DEFAULT_ROOT_WIDTH_BUDGET_MS`. The relay lowers it to fit its own
   * command timeout.
   */
  budgetMs?: number;
}

// ============================================================================
// Response models
// ============================================================================

/**
 * `/design/element/:id/styles` answer: the element's design data plus the
 * page's root tokens (`tokens`), which its `customProperties` and
 * `tokenMatches` are read against.
 */
export type ElementStylesResponse = ElementDesignData & ReportedTokens;

/**
 * `/design/snapshot` answer. The page's root design tokens (`tokens`) and the
 * ancestor scopes that re-declare them (`scopes`) are reported once; each
 * element carries only the custom properties it declares itself, the ids of
 * its scopes (`tokenScopes`) and its `tokenMatches`. Token data therefore
 * grows with tokens + elements, not tokens x elements (see
 * `ai/design-tokens.ts`).
 */
export interface DesignSnapshotResponse extends DesignSelectionBounds, ReportedTokens {
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
export interface ResponsiveSnapshotsResponse extends DesignSelectionBounds, ReportedTokens {
  snapshots: ResponsiveSnapshot[];
  method: typeof RESPONSIVE_SNAPSHOT_METHOD;
  mediaQueriesReevaluated: false;
  windowInnerWidth: number;
  /** Viewports the request named; `snapshots` holds fewer when `timedOut`. */
  requestedViewports: number;
  /**
   * The viewport whose snapshot carries `tokenMatches` (the first captured):
   * attribution does not change under a root-width constraint, so it is not
   * repeated per viewport. `null` when nothing was captured.
   */
  tokenMatchesViewport: string | null;
  /** The capture's deadline ran out between viewports; it stopped and restored the page. */
  timedOut: boolean;
  /** The tab was hidden, so no animation frame was awaited (see `ResponsiveCapture`). */
  framesSkipped: boolean;
  timestamp: number;
}

// ============================================================================
// Request validation
// ============================================================================

/**
 * The internal failure code a design handler answers `err` with: the request
 * error's own code, otherwise the route's.
 */
export function designFailureCode(err: unknown, routeCode: string): string {
  if (err instanceof DesignRequestError || err instanceof RootWidthLockError) return err.code;
  return routeCode;
}

/**
 * The `budgetMs` a root-width request names, if any: a positive number of
 * milliseconds. Throws `DesignRequestError` otherwise.
 */
export function rootWidthBudgetOf(request: unknown, route: string): number | undefined {
  const budget = bodyOf(request, route).budgetMs;
  if (!isGiven(budget)) return undefined;
  if (!isPositiveNumber(budget)) {
    throw new DesignRequestError(`${route}: budgetMs must be a finite number greater than 0`);
  }
  return budget;
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
  const count = Array.isArray(viewports)
    ? viewports.length
    : Object.keys(viewports as RequestBody).length;
  if (count > MAX_RESPONSIVE_VIEWPORTS) {
    throw new DesignRequestError(
      `${route}: at most ${MAX_RESPONSIVE_VIEWPORTS} viewports per request (got ${count})`
    );
  }
  return viewports as Record<string, number> | number[];
}

// ============================================================================
// Selection
// ============================================================================

type LiveSource = DesignElementSource & { element: HTMLElement };

/** Whether a registered element has an `HTMLElement` node, so its design data can be read. */
function isLive(el: DesignElementSource): el is LiveSource {
  return el.element instanceof HTMLElement;
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
): ElementStylesResponse {
  if (!source) throw new DesignRequestError(`Element not found: ${id}`, 'ELEMENT_NOT_FOUND');
  if (!(source.element instanceof HTMLElement)) {
    throw new DesignRequestError('Element does not have a DOM reference', 'NO_DOM_REFERENCE');
  }
  const index = indexCustomProperties(document, [source.element]);
  try {
    const data = getElementDesignData(source.element, {
      elementId: source.id,
      label: source.label,
      type: source.type,
      includePseudoElements: true,
      customProperties: index,
    });
    return { ...data, ...reportedTokensOf(index.tokens) };
  } finally {
    disposeTokenIndex(index.tokens);
  }
}

/** A `/design/snapshot` request, validated. */
export interface ParsedDesignSnapshotRequest {
  elementIds?: string[];
  includePseudoElements?: boolean;
  /** As given; the caller applies its default. */
  limit?: number;
}

/**
 * Validate a `/design/snapshot` request body: body, `elementIds`,
 * `includePseudoElements` then `limit`, so a body wrong in two fields is
 * refused for the first. Throws `DesignRequestError` (`INVALID_REQUEST`).
 * Pure: no DOM access, so a transport with no DOM (the React Native server)
 * can hold its own refusals to these.
 */
export function parseDesignSnapshotRequest(request: unknown): ParsedDesignSnapshotRequest {
  const route = '/design/snapshot';
  const body = bodyOf(request, route);
  const elementIds = elementIdsOf(body, route);
  const includePseudoElements = booleanOf(body, 'includePseudoElements', route);
  const limit = limitOf(body, route);
  return {
    ...(elementIds !== undefined ? { elementIds } : {}),
    ...(includePseudoElements !== undefined ? { includePseudoElements } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };
}

/** A `/design/responsive` request, validated. */
export interface ParsedResponsiveSnapshotsRequest {
  elementIds?: string[];
  /** The requested widths, or `DEFAULT_VIEWPORTS` when none are given. */
  viewports: Record<string, number> | number[];
  budgetMs?: number;
  /** As given; the caller applies its default (it depends on the viewport count). */
  limit?: number;
}

/**
 * Validate a `/design/responsive` request body: body, `elementIds`,
 * `viewports` (at most `MAX_RESPONSIVE_VIEWPORTS`), `budgetMs` then `limit`.
 * Throws `DesignRequestError` (`INVALID_REQUEST`). Pure: no DOM access.
 */
export function parseResponsiveSnapshotsRequest(
  request: unknown
): ParsedResponsiveSnapshotsRequest {
  const route = '/design/responsive';
  const body = bodyOf(request, route);
  const elementIds = elementIdsOf(body, route);
  const viewports = viewportsOf(body, route);
  const budgetMs = rootWidthBudgetOf(body, route);
  const limit = limitOf(body, route);
  return {
    ...(elementIds !== undefined ? { elementIds } : {}),
    viewports,
    ...(budgetMs !== undefined ? { budgetMs } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };
}

/**
 * Answer `/design/snapshot`: design data for the selected elements, up to
 * `limit` (default `DEFAULT_DESIGN_RECORD_BUDGET`), with the cut reported.
 * The body is validated by `parseDesignSnapshotRequest`.
 */
export function designSnapshotOf(
  elements: readonly DesignElementSource[],
  request: unknown
): DesignSnapshotResponse {
  const parsed = parseDesignSnapshotRequest(request);
  const { elementIds, includePseudoElements } = parsed;
  const limit = parsed.limit ?? DEFAULT_DESIGN_RECORD_BUDGET;
  const { kept, report } = bounded(selectElements(elements, elementIds, isLive), limit);
  const batch = collectDesignBatch(kept, undefined, { includePseudoElements });
  const { elements: designData, ...reported } = batch;
  return {
    elements: designData,
    ...reported,
    ...report,
    returned: kept.length,
    timestamp: Date.now(),
  };
}

/**
 * Answer `/design/responsive`: one snapshot per requested width, taken by
 * constraining the root element's width (`RESPONSIVE_SNAPSHOT_METHOD`) — which
 * the response says, because `@media` queries do not re-evaluate. The default
 * element bound is the record budget divided by the viewport count.
 *
 * `elements` is read inside the root-width lock (pass a function to read the
 * registry then), so a capture that waited for another selects the page as it
 * is when it runs. The capture stops between viewports when its deadline
 * (`budgetMs`) runs out, restores the page, and reports `timedOut`.
 */
export async function responsiveSnapshotsOf(
  elements: readonly DesignElementSource[] | (() => readonly DesignElementSource[]),
  request: unknown
): Promise<ResponsiveSnapshotsResponse> {
  const parsed = parseResponsiveSnapshotsRequest(request);
  const { elementIds, viewports, budgetMs } = parsed;
  const viewportCount = Array.isArray(viewports) ? viewports.length : Object.keys(viewports).length;
  const limit =
    parsed.limit ?? Math.max(1, Math.floor(DEFAULT_DESIGN_RECORD_BUDGET / viewportCount));
  let selected: { kept: LiveSource[]; report: DesignSelectionReport } | undefined;
  const capture = await captureResponsiveSnapshots(
    {
      getAllElements: () => {
        const source = typeof elements === 'function' ? elements() : elements;
        selected = bounded(selectElements(source, elementIds, isLive), limit);
        return selected.kept.map((el) => ({
          id: el.id,
          element: el.element,
          type: el.type ?? el.element.tagName.toLowerCase(),
          label: el.label,
        }));
      },
    },
    viewports,
    { budgetMs }
  );
  const { kept, report } = selected ?? bounded(selectElements([], elementIds, isLive), limit);
  return {
    snapshots: capture.snapshots,
    method: RESPONSIVE_SNAPSHOT_METHOD,
    mediaQueriesReevaluated: false,
    windowInnerWidth: window.innerWidth,
    requestedViewports: viewportCount,
    timedOut: capture.timedOut,
    framesSkipped: capture.framesSkipped,
    tokens: capture.tokens,
    tokenCount: capture.tokenCount,
    truncatedValues: capture.truncatedValues,
    scopes: capture.scopes,
    scopeCount: capture.scopeCount,
    scopeBudgetExceeded: capture.scopeBudgetExceeded,
    tokenCoverage: capture.tokenCoverage,
    tokenMatchesViewport: capture.snapshots[0]?.viewportLabel ?? null,
    ...report,
    returned: kept.length,
    timestamp: Date.now(),
  };
}

/** Whether a style guide reads custom properties (a constraint on a `--*` property). */
function guideReadsCustomProperties(guide: StyleGuideConfig): boolean {
  const reads = (c: { property?: string; breakpoints?: Record<string, unknown> }): boolean =>
    Boolean(c.property?.startsWith('--')) ||
    Object.values(c.breakpoints ?? {}).some(
      (b) => typeof b === 'object' && b !== null && reads(b as never)
    );
  return guide.rules.some((rule) => (rule.constraints ?? []).some((c) => reads(c as never)));
}

/**
 * What the audit reads: never token attribution (its report carries no
 * `tokenMatches`, so the page is not probed), and custom properties only
 * when the guide constrains one.
 */
function collectOptionsFor(guide: StyleGuideConfig): DesignCollectOptions {
  return guideReadsCustomProperties(guide)
    ? { attributeTokens: false }
    : { customProperties: false };
}

/**
 * Answer `/design/audit` on the web transports: `auditDesign`
 * (`./design-audit-core`, which the React Native server shares) over the
 * registered elements, through the DOM adapter below. With a guide — the
 * request's `guide`, else the one the transport has loaded — the selected
 * elements' full design data is audited against it, `mode: 'style-guide'`.
 * With none, the built-in heuristics run, `mode: 'heuristic'`. See
 * `auditDesign` for the bounds.
 */
export function designAuditOf(
  elements: readonly DesignElementSource[],
  request: unknown,
  loadedGuide: StyleGuideConfig | null | undefined
): DesignAuditResponse {
  return auditDesign(elements, request, loadedGuide, webAuditAdapter);
}

/**
 * The web transports' audit adapter. An element is readable when it has an
 * `HTMLElement` node; the style-guide audit reads its full design data
 * (`collectDesignData`), the heuristics its computed style and laid-out box,
 * and `rem` resolves against the page's measured root font size — the figure
 * style inference and drift use.
 */
const webAuditAdapter: DesignAuditAdapter<DesignElementSource, LiveSource> = {
  isReadable: isLive,
  records: (kept, guide) => collectDesignData(kept, undefined, collectOptionsFor(guide)),
  heuristicInput: webHeuristicInput,
  defaultRootFontSizePx: measureRootFontSizePx,
  heuristicCoverage: {
    contrast: { status: 'measured' },
    'select-dark-mode': { status: 'measured' },
    'font-size': { status: 'measured' },
    'touch-target': { status: 'measured' },
  },
};

/** The element types a person taps, whose box must be 44x44 or larger. */
const TOUCH_TARGET_TYPES: ReadonlySet<string> = new Set([
  'button',
  'link',
  'checkbox',
  'radio',
  'switch',
]);

/** What the heuristics read of one live element: computed colours and font size, its box, and for a `<select>` its first `<option>`. */
function webHeuristicInput(el: LiveSource): HeuristicInput {
  const dom = el.element;
  const cs = getComputedStyle(dom);
  const fontSizePx = parseFloat(cs.fontSize);
  const rect = dom.getBoundingClientRect();
  const input: HeuristicInput = {
    id: el.id,
    touchTarget: el.type !== undefined && TOUCH_TARGET_TYPES.has(el.type),
    color: cs.color,
    backgroundColor: cs.backgroundColor,
    fontSizePx: Number.isFinite(fontSizePx) ? fontSizePx : null,
    rect: { width: rect.width, height: rect.height },
  };
  if (dom.tagName === 'SELECT') {
    const firstOption = dom.querySelector('option');
    const optCs = firstOption ? getComputedStyle(firstOption) : null;
    input.select = {
      colorScheme: cs.colorScheme || '',
      option: optCs ? { color: optCs.color, backgroundColor: optCs.backgroundColor } : undefined,
    };
  }
  return input;
}

// ============================================================================
// /control/viewport-constraints
// ============================================================================

/** The `/control/viewport-constraints` response. */
export interface ViewportConstraintsResponse {
  success: boolean;
  /** `window.innerWidth`, which a root-width constraint does not change. */
  viewportWidth: number;
  /** The root element's laid-out width after the change, measured rather than echoed. */
  constrainedWidth: number;
  /** `true` when the request cleared the constraint (`restore`). */
  restored: boolean;
  timestamp: number;
}

/**
 * Answer `/control/viewport-constraints`: constrain the root element to
 * `width` CSS pixels, or clear the constraint with `restore: true` (which wins
 * when both are given). It narrows the page exactly as `/design/responsive`
 * does (`CONSTRAINED_ROOT_PROPERTIES`, the same `RESPONSIVE_SNAPSHOT_METHOD`),
 * so a constraint set here and a responsive capture agree on what "the page at
 * 480px" is, and it runs under the same root-width lock, so a capture's restore
 * cannot undo it mid-flight. `budgetMs` bounds the wait for that lock.
 *
 * A request naming neither `width` nor `restore`, or (without `restore`) a
 * `width` that is not a positive number, is refused with `DesignRequestError`
 * rather than answered as a successful no-op. `restore: true` ignores `width`.
 */
export async function viewportConstraintsOf(
  request: unknown
): Promise<ViewportConstraintsResponse> {
  const route = '/control/viewport-constraints';
  const body = bodyOf(request, route);
  const restore = booleanOf(body, 'restore', route) === true;
  const width = body.width;
  if (!restore && isGiven(width) && !isPositiveNumber(width)) {
    throw new DesignRequestError(`${route}: width must be a finite number greater than 0`);
  }
  if (!restore && !isGiven(width)) {
    throw new DesignRequestError(`${route}: give a width, or restore: true`);
  }
  const budgetMs = rootWidthBudgetOf(body, route);
  return withRootWidthLock(
    () => {
      const docEl = document.documentElement;
      for (const property of CONSTRAINED_ROOT_PROPERTIES) {
        if (restore) docEl.style.removeProperty(property);
        else
          docEl.style.setProperty(
            property,
            property.startsWith('overflow') ? 'hidden' : `${width as number}px`
          );
      }
      // Force reflow, so the measurement below and the next read see the new layout.
      void docEl.offsetHeight;
      return {
        success: true,
        viewportWidth: window.innerWidth,
        constrainedWidth: docEl.getBoundingClientRect().width,
        restored: restore,
        timestamp: Date.now(),
      };
    },
    { budgetMs }
  );
}
