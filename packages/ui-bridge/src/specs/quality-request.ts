/**
 * Quality requests over registered elements — the `/design/evaluate` family.
 *
 * Two transports answer `/design/evaluate`, `/design/evaluate/contexts`,
 * `/design/evaluate/baseline` and `/design/evaluate/diff`: the direct server
 * handlers (`server/handlers.ts`) and the browser relay
 * (`react/commandHandlers.ts`). They used to answer with two different models.
 * The relay returned a label/action coverage score with no metrics, listed
 * context names the evaluator rejects, and "diffed" a baseline by counting
 * elements, so every diff through it read as "no changes". Which transport
 * reached the page decided which model the caller got — the divergence
 * `domain_spec/ui-bridge` behaviour (7) forbids.
 *
 * Both transports call these functions, so one model answers whichever path a
 * request takes. The context list is `listContexts()` (`./quality-contexts`).
 *
 * The request body is validated here too, at the boundary both transports
 * share. The routes declare `bodyRequired`, so the caller's JSON arrives
 * as sent, and nothing else checks it. Unchecked, a string `elementIds`
 * selected elements by substring (`String.includes`), and a partial `viewport`
 * scored every viewport metric on NaN. A malformed body throws
 * `QualityRequestError`, which both transports answer with
 * `UB-VALIDATION-ERROR`. That is `domain_spec/ui-bridge` behaviour (8),
 * "degrade loudly". A field that is absent or JSON `null` is not given; a key
 * this module does not read (the adapters add `tabId`) is ignored.
 */

import type { ElementDesignData } from '../core/types';
import { getElementDesignData, indexCustomProperties } from '../ai/design-inspector';
import { evaluateQuality, isMetricEnabled } from './quality-evaluator';
import { BUILT_IN_CONTEXTS, getContext } from './quality-contexts';
import { CUSTOM_PROPERTY_METRICS } from './quality-metrics';
import { createBaseline, diffSnapshots } from './quality-diff';
import type {
  QualityContext,
  QualityEvaluationReport,
  SnapshotBaseline,
  SnapshotDiffReport,
  ViewportDimensions,
} from './quality-types';
import type { StyleGuideConfig } from './style-types';

/**
 * The fields of a registered element these requests read. A
 * `RegisteredElement` satisfies it structurally; an element whose `element` is
 * not an `HTMLElement` is skipped, because design data is read off the live DOM.
 */
export interface QualityElementSource {
  id: string;
  label?: string;
  type?: string;
  element?: unknown;
}

/** `/design/evaluate/baseline` request body. */
export interface QualityBaselineRequest {
  label?: string;
  elementIds?: string[];
}

/** `/design/evaluate/diff` request body. */
export interface QualityDiffRequest {
  elementIds?: string[];
}

/**
 * A `/design/evaluate*` request whose body does not have the route's shape, or
 * names a quality context that does not exist. Both transports answer it with
 * `UB-VALIDATION-ERROR`, never with a report computed on what the body
 * happened to hold.
 */
export class QualityRequestError extends Error {
  /** The internal code both transports map onto `UB-VALIDATION-ERROR`. */
  readonly code = 'INVALID_REQUEST';

  constructor(message: string) {
    super(message);
    this.name = 'QualityRequestError';
  }
}

/**
 * The internal failure code a `/design/evaluate*` handler answers `err` with:
 * `INVALID_REQUEST` for a malformed request, otherwise the route's own code.
 */
export function qualityFailureCode(err: unknown, routeCode: string): string {
  return err instanceof QualityRequestError ? err.code : routeCode;
}

// ============================================================================
// Request validation
// ============================================================================

type RequestBody = Record<string, unknown>;

function isObject(value: unknown): value is RequestBody {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Absent and JSON `null` both mean "not given". */
function isGiven(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function bodyOf(request: unknown, route: string): RequestBody {
  if (!isGiven(request)) return {};
  if (!isObject(request)) {
    throw new QualityRequestError(`${route}: the request body must be a JSON object`);
  }
  return request;
}

function elementIdsOf(body: RequestBody, route: string): string[] | undefined {
  const ids = body.elementIds;
  if (!isGiven(ids)) return undefined;
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) {
    throw new QualityRequestError(`${route}: elementIds must be an array of strings`);
  }
  return ids;
}

function viewportOf(body: RequestBody, route: string): ViewportDimensions | undefined {
  const viewport = body.viewport;
  if (!isGiven(viewport)) return undefined;
  const isDimension = (v: unknown): v is number => isFiniteNumber(v) && v > 0;
  if (!isObject(viewport) || !isDimension(viewport.width) || !isDimension(viewport.height)) {
    throw new QualityRequestError(
      `${route}: viewport must be { width, height }, each a finite number greater than 0`
    );
  }
  return { width: viewport.width, height: viewport.height };
}

function stringOf(body: RequestBody, key: string, route: string): string | undefined {
  const value = body[key];
  if (!isGiven(value)) return undefined;
  if (typeof value !== 'string') {
    throw new QualityRequestError(`${route}: ${key} must be a string`);
  }
  return value;
}

/**
 * A metric's configuration in a custom context. Each field may be left out,
 * because the evaluator supplies the default, but a given one must be usable:
 * a non-numeric weight would turn the overall score into NaN.
 */
function isMetricConfig(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (isGiven(value.enabled) && typeof value.enabled !== 'boolean') return false;
  if (isGiven(value.weight) && !(isFiniteNumber(value.weight) && value.weight >= 0)) return false;
  if (isGiven(value.thresholds)) {
    const t = value.thresholds;
    if (!isObject(t) || !isFiniteNumber(t.good) || !isFiniteNumber(t.warning)) return false;
  }
  return true;
}

function customContextOf(body: RequestBody, route: string): QualityContext | undefined {
  const context = body.customContext;
  if (!isGiven(context)) return undefined;
  if (!isObject(context) || typeof context.name !== 'string' || !isObject(context.metrics)) {
    throw new QualityRequestError(
      `${route}: customContext must be an object with a string name and a metrics object`
    );
  }
  for (const [metricId, config] of Object.entries(context.metrics)) {
    if (!isMetricConfig(config)) {
      throw new QualityRequestError(
        `${route}: customContext.metrics.${metricId} must be an object whose enabled is a ` +
          'boolean, weight a finite number >= 0, and thresholds { good, warning } finite numbers'
      );
    }
  }
  return context as unknown as QualityContext;
}

/**
 * The context a `/design/evaluate` request names. Precedence: a custom context
 * object, then a context the loaded style guide declares under the requested
 * name, then the built-in of that name.
 */
function requestedContext(
  body: RequestBody,
  route: string,
  styleGuide: Pick<StyleGuideConfig, 'qualityContexts'> | null | undefined
): QualityContext {
  const custom = customContextOf(body, route);
  if (custom) return custom;
  const name = stringOf(body, 'context', route) ?? 'general';
  const declared = styleGuide?.qualityContexts;
  if (declared && Object.prototype.hasOwnProperty.call(declared, name)) return declared[name];
  const builtIn = getContext(name);
  if (builtIn) return builtIn;
  const available = [...Object.keys(BUILT_IN_CONTEXTS), ...Object.keys(declared ?? {})];
  throw new QualityRequestError(
    `Unknown quality context: "${name}". Available: ${available.join(', ')}`
  );
}

// ============================================================================
// The /design/evaluate family
// ============================================================================

/**
 * Read live design data for the selected elements (all of them when
 * `elementIds` is absent).
 *
 * Custom properties are read rule-first, once for the whole batch
 * (`indexCustomProperties`). Pass `customProperties: false` when nothing
 * downstream reads them, and the stylesheets are not walked at all.
 */
export function collectDesignData(
  elements: readonly QualityElementSource[],
  elementIds?: readonly string[],
  options: { customProperties?: boolean } = {}
): ElementDesignData[] {
  const wanted = elementIds ? new Set(elementIds) : null;
  const live: Array<QualityElementSource & { element: HTMLElement }> = [];
  for (const el of elements) {
    if ((wanted === null || wanted.has(el.id)) && el.element instanceof HTMLElement) {
      live.push(el as QualityElementSource & { element: HTMLElement });
    }
  }
  const customProperties =
    options.customProperties === false || live.length === 0
      ? false
      : indexCustomProperties(
          document,
          live.map((el) => el.element)
        );
  return live.map((el) =>
    getElementDesignData(el.element, {
      elementId: el.id,
      label: el.label,
      type: el.type,
      customProperties,
    })
  );
}

function windowViewport(): ViewportDimensions {
  return { width: window.innerWidth, height: window.innerHeight };
}

/**
 * Answer `/design/evaluate`: the 28 metrics as values, under the requested
 * context (see `requestedContext`). Throws `QualityRequestError` on a
 * malformed body or an unknown context name. The stylesheets are walked for
 * custom properties only when the context enables a metric that reads them.
 */
export function evaluateRegisteredQuality(
  elements: readonly QualityElementSource[],
  request: unknown,
  styleGuide: Pick<StyleGuideConfig, 'qualityContexts'> | null | undefined
): QualityEvaluationReport {
  const route = '/design/evaluate';
  const body = bodyOf(request, route);
  const elementIds = elementIdsOf(body, route);
  const viewport = viewportOf(body, route) ?? windowViewport();
  const context = requestedContext(body, route, styleGuide);
  const designData = collectDesignData(elements, elementIds, {
    customProperties: CUSTOM_PROPERTY_METRICS.some((id) => isMetricEnabled(context, id)),
  });
  return evaluateQuality(designData, viewport, context);
}

/**
 * Answer `/design/evaluate/baseline`: capture the baseline the diff reads.
 * Throws `QualityRequestError` on a malformed body.
 */
export function captureQualityBaseline(
  elements: readonly QualityElementSource[],
  request: unknown
): SnapshotBaseline {
  const route = '/design/evaluate/baseline';
  const body = bodyOf(request, route);
  const elementIds = elementIdsOf(body, route);
  const label = stringOf(body, 'label', route);
  return createBaseline(collectDesignData(elements, elementIds), windowViewport(), label);
}

/**
 * Answer `/design/evaluate/diff`: style and layout changes since the baseline.
 * Throws `QualityRequestError` on a malformed body.
 */
export function diffQualityBaseline(
  baseline: SnapshotBaseline,
  elements: readonly QualityElementSource[],
  request: unknown
): SnapshotDiffReport {
  const route = '/design/evaluate/diff';
  const elementIds = elementIdsOf(bodyOf(request, route), route);
  return diffSnapshots(baseline, collectDesignData(elements, elementIds));
}
