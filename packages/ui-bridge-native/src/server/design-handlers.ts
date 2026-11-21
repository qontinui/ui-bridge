/**
 * UI Bridge Native Design Review Handlers
 *
 * HTTP handlers for the 8 design review endpoints.
 * Maps registered element styles to the web SDK's design data format.
 */

import type { NativeUIBridgeRegistry } from '../core/registry';
import type { APIResponse, HandlerContext } from './types';
import type { ElementDesignData, StateStyles, ResponsiveSnapshot } from '../design/design-types';
import {
  mapNativeStyleToExtended,
  getNativeElementDesignData,
  captureNativeStateVariations,
  captureNativeResponsiveSnapshot,
} from '../design/design-inspector-native';

// Style guide and baseline stored in closure (same pattern as web SDK)
let loadedStyleGuide: unknown = null;
let savedBaseline: unknown = null;

/** The web SDK's style validator (`@qontinui/ui-bridge/specs`). */
export interface StyleValidatorModule {
  runStyleAudit: (
    elements: Array<{ elementId: string; styles: Record<string, string> }>,
    guide: unknown,
    options?: { rootFontSizePx?: number }
  ) => unknown;
}

// Try to load the style validator from the web SDK (optional peer dep)
let styleValidator: StyleValidatorModule | null = null;

// Try to load quality evaluator from the web SDK (optional peer dep)
/** The quality-evaluator functions native calls (from `@qontinui/ui-bridge/specs`). */
export type QualityEvaluatorModule = {
  evaluateQuality: (
    elements: ElementDesignData[],
    viewport: { width: number; height: number },
    context?: unknown
  ) => unknown;
  listContexts: () => Array<{ name: string; description: string }>;
  /**
   * The SDK's one quality-context shape rule (0.56.0 and later). Absent on an
   * older SDK, whose `evaluateQuality` checks no context shape; native then
   * applies its own copy of the web request model's check.
   */
  qualityContextProblem?: (value: unknown) => string | null;
  createBaseline: (
    elements: ElementDesignData[],
    viewport: { width: number; height: number },
    label?: string
  ) => unknown;
  diffSnapshots: (baseline: unknown, current: ElementDesignData[]) => unknown;
};
let qualityEvaluator: QualityEvaluatorModule | null = null;

/**
 * The web SDK's pure style-inference functions (`@qontinui/ui-bridge/specs`,
 * 0.56.0 or later). The peer range admits older versions that load but lack them, so
 * availability is decided by the functions' presence, not by the `require`.
 */
export interface StyleInferenceModule {
  buildStyleInventory: (
    samples: Array<{ elementId: string; styles: Record<string, string> }>,
    options?: { rootFontSizePx?: number; customProperties?: Record<string, string> }
  ) => unknown;
  inferStyleGuideFromInventory: (
    inventory: unknown,
    options?: { maxPerCategory?: number; limits?: Record<string, number>; name?: string }
  ) => Record<string, unknown>;
  computeTokenDrift: (
    inventory: unknown,
    declared: { tokens?: unknown; customProperties?: Record<string, string | number> },
    options?: { colorDeltaE?: number; px?: number; maxListed?: number; rootFontSizePx?: number }
  ) => Record<string, unknown>;
  /** The web transports' body validation: throws an error whose `code` is `INVALID_REQUEST`. */
  parseInferBody: (request: unknown) => InferBodyLike;
  parseDriftBody: (request: unknown) => InferBodyLike & {
    tolerance: { colorDeltaE?: number; px?: number };
    maxListed?: number;
    source:
      | { kind: 'tokens'; tokens: unknown }
      | { kind: 'customProperties'; customProperties: Record<string, string | number> }
      | { kind: 'pageCustomProperties'; prefix: string }
      | { kind: 'loadedStyleGuide' };
  };
  loadedGuideTokens: (loadedGuide: { tokens?: unknown } | null | undefined) => unknown;
}

/** The sampling fields a parsed body carries (plus the infer-only options). */
interface InferBodyLike {
  scope: 'registered' | 'document';
  elementIds?: string[];
  maxElements: number;
  rootFontSizePx?: number;
  maxPerCategory?: number;
  limits?: Record<string, number>;
  name?: string;
}

let styleInference: StyleInferenceModule | null = null;

function asStyleInference(specs: unknown): StyleInferenceModule | null {
  const s = specs as Partial<StyleInferenceModule> | null;
  return s &&
    typeof s.buildStyleInventory === 'function' &&
    typeof s.inferStyleGuideFromInventory === 'function' &&
    typeof s.computeTokenDrift === 'function' &&
    typeof s.parseInferBody === 'function' &&
    typeof s.parseDriftBody === 'function' &&
    typeof s.loadedGuideTokens === 'function'
    ? (s as StyleInferenceModule)
    : null;
}

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const specs = require('@qontinui/ui-bridge/specs');
  styleValidator = specs;
  qualityEvaluator = specs;
  styleInference = asStyleInference(specs);
} catch {
  // Optional dependency not installed — audit/evaluate endpoints will return an error
}

/** Absent and JSON `null` both mean "not given", as in the web transports' `design-request.ts`. */
function isGiven(value: unknown): boolean {
  return value !== undefined && value !== null;
}

/** A JSON object (not an array), as the web transports' `isObject`. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ============================================================================
// Request validation — the web transports' rules, messages and order
// ============================================================================
//
// The web transports validate every design body at one shared boundary
// (`design-request.ts` for snapshot/audit, `quality-request.ts` for the
// evaluate family). These are native's copies of the checks for the fields
// native reads, with the same messages, so a malformed body is refused for
// the same field on either transport rather than read loosely here. A field
// native does not read (`limit`, `includePseudoElements`, ...) is not checked.

/** A malformed request body; answered `INVALID_REQUEST` with its message. */
class NativeRequestError extends Error {}

function invalidRequest<T = unknown>(err: unknown): APIResponse<T> {
  if (err instanceof NativeRequestError) return error(err.message, 'INVALID_REQUEST');
  throw err;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

/** The body as an object; absent or `null` is `{}`, anything else not an object is refused. */
function bodyOf(request: unknown, route: string): Record<string, unknown> {
  if (!isGiven(request)) return {};
  if (!isObject(request)) {
    throw new NativeRequestError(`${route}: the request body must be a JSON object`);
  }
  return request;
}

/**
 * The requested ids, or `undefined` (every element) when absent or `null`.
 * A given list selects exactly its ids — an empty one selects nothing, as the
 * web transports' selection does.
 */
function elementIdsOf(body: Record<string, unknown>, route: string): string[] | undefined {
  const ids = body.elementIds;
  if (!isGiven(ids)) return undefined;
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) {
    throw new NativeRequestError(`${route}: elementIds must be an array of strings`);
  }
  return ids;
}

function stringOf(body: Record<string, unknown>, key: string, route: string): string | undefined {
  const value = body[key];
  if (!isGiven(value)) return undefined;
  if (typeof value !== 'string') {
    throw new NativeRequestError(`${route}: ${key} must be a string`);
  }
  return value;
}

function viewportOf(
  body: Record<string, unknown>,
  route: string
): { width: number; height: number } | undefined {
  const viewport = body.viewport;
  if (!isGiven(viewport)) return undefined;
  if (
    !isObject(viewport) ||
    !isPositiveNumber(viewport.width) ||
    !isPositiveNumber(viewport.height)
  ) {
    throw new NativeRequestError(
      `${route}: viewport must be { width, height }, each a finite number greater than 0`
    );
  }
  return { width: viewport.width, height: viewport.height };
}

/** A metric's configuration in a custom context, as `quality-request.ts`'s `isMetricConfig`. */
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

/**
 * What is wrong with a quality context, or `null` — native's copy of the web
 * request model's check, for an SDK older than 0.56.0 that carries no
 * `qualityContextProblem`. The SDK's rule, when present, is stricter (known
 * metric ids, thresholds in 0-100 with good >= warning) and is used instead.
 */
function localContextProblem(context: unknown): string | null {
  if (!isObject(context) || typeof context.name !== 'string' || !isObject(context.metrics)) {
    return ' must be an object with a string name and a metrics object';
  }
  for (const [metricId, config] of Object.entries(context.metrics)) {
    if (!isMetricConfig(config)) {
      return (
        `.metrics.${metricId} must be an object whose enabled is a ` +
        'boolean, weight a finite number >= 0, and thresholds { good, warning } finite numbers'
      );
    }
  }
  return null;
}

function customContextOf(
  body: Record<string, unknown>,
  route: string,
  problemOf: (value: unknown) => string | null
): Record<string, unknown> | undefined {
  const context = body.customContext;
  if (!isGiven(context)) return undefined;
  const problem = problemOf(context);
  if (problem !== null) throw new NativeRequestError(`${route}: customContext${problem}`);
  return context as Record<string, unknown>;
}

function success<T>(data: T): APIResponse<T> {
  return { success: true, data, timestamp: Date.now() };
}

function error<T = unknown>(message: string, code?: string): APIResponse<T> {
  return { success: false, error: message, code, timestamp: Date.now() };
}

/**
 * Design handler interface (subset of NativeServerHandlers)
 */
export interface NativeDesignHandlers {
  getElementStyles: (ctx: HandlerContext) => Promise<APIResponse<ElementDesignData>>;
  getElementStateStyles: (
    ctx: HandlerContext
  ) => Promise<APIResponse<{ elementId: string; stateStyles: StateStyles[] }>>;
  getDesignSnapshot: (
    ctx: HandlerContext
  ) => Promise<APIResponse<{ elements: ElementDesignData[]; timestamp: number }>>;
  getResponsiveSnapshots: (ctx: HandlerContext) => Promise<APIResponse<ResponsiveSnapshot[]>>;
  runDesignAudit: (ctx: HandlerContext) => Promise<APIResponse<unknown>>;
  loadStyleGuide: (ctx: HandlerContext) => Promise<APIResponse<{ loaded: boolean }>>;
  getStyleGuide: (ctx: HandlerContext) => Promise<APIResponse<unknown>>;
  clearStyleGuide: (ctx: HandlerContext) => Promise<APIResponse<{ cleared: boolean }>>;
  evaluateQuality: (ctx: HandlerContext) => Promise<APIResponse<unknown>>;
  getQualityContexts: (
    ctx: HandlerContext
  ) => Promise<APIResponse<Array<{ name: string; description: string }>>>;
  saveBaseline: (
    ctx: HandlerContext
  ) => Promise<APIResponse<{ saved: boolean; elementCount: number }>>;
  diffBaseline: (ctx: HandlerContext) => Promise<APIResponse<unknown>>;
  inferStyleGuide: (ctx: HandlerContext) => Promise<APIResponse<unknown>>;
  diffDesignTokens: (ctx: HandlerContext) => Promise<APIResponse<unknown>>;
}

/** Options for `createDesignHandlers`. */
export interface DesignHandlerOptions {
  /**
   * The style-inference functions to use. Absent: the optional
   * `@qontinui/ui-bridge/specs` peer, when it carries them. `null`: none
   * (the routes answer `INFERENCE_NOT_AVAILABLE`). Tests inject the module
   * because `vi.mock` does not intercept this file's CJS `require`.
   */
  styleInference?: StyleInferenceModule | null;
  /**
   * The style validator `/design/audit` runs. Absent: the optional peer's.
   * `null`: none (`VALIDATOR_NOT_AVAILABLE`). Injectable for the same reason.
   */
  styleValidator?: StyleValidatorModule | null;
  /**
   * The quality evaluator the `/design/evaluate` family runs. Absent: the
   * optional peer's. `null`: none (`EVALUATOR_NOT_AVAILABLE`). Injectable for
   * the same reason.
   */
  qualityEvaluator?: QualityEvaluatorModule | null;
}

/** A request-validation error from the shared parser (its `code` is `INVALID_REQUEST`). */
function isInvalidRequest(err: unknown): err is Error {
  return err instanceof Error && (err as { code?: unknown }).code === 'INVALID_REQUEST';
}

/**
 * Create design review handlers.
 *
 * @param registry - the registered native element registry
 * @param viewportProvider - optional injected viewport getter. Same shape as
 *   the `viewportProvider` consumed by `handlers.ts`/`getPageHealth`. This is
 *   injected by `createServerHandlers` from the `NativeServerConfig` the host
 *   passes to `UIBridgeNativeProvider`/`NativeUIBridgeServer`, which in turn
 *   reads `Dimensions.get('screen')` (or `'window'`). The indirection exists
 *   because `require('react-native')` from this file crashes the host RN
 *   app the moment any design endpoint is invoked: Metro/Hermes raise
 *   `unknownModuleError` past every try/catch and tear down the JS thread.
 *   This was the same latent crash that took out 0.6.3/0.6.4 page-health
 *   handler — the design handlers had it too, just hiding on unused
 *   endpoints until `POST /design/responsive` was first called.
 *
 *   When the injected provider is absent (tests, custom hosts) the design
 *   handlers fall back to `{width:0, height:0}` — the responsive snapshot
 *   degenerates to "zero-dimension viewport" rather than crashing.
 */
export function createDesignHandlers(
  registry: NativeUIBridgeRegistry,
  viewportProvider?: () => { width: number; height: number },
  options: DesignHandlerOptions = {}
): NativeDesignHandlers {
  const inference = 'styleInference' in options ? (options.styleInference ?? null) : styleInference;
  const validator = 'styleValidator' in options ? (options.styleValidator ?? null) : styleValidator;
  const evaluator =
    'qualityEvaluator' in options ? (options.qualityEvaluator ?? null) : qualityEvaluator;

  /**
   * Style samples for the inference routes: the flattened StyleSheet of each
   * registered element, mapped to the web SDK's computed-style shape. React
   * Native has no CSS custom properties and no document, so the capture says so.
   */
  function inferenceSamples(body: InferBodyLike): {
    samples: Array<{ elementId: string; styles: Record<string, string> }>;
    capture: Record<string, unknown>;
  } {
    const elements = selectElements(body.elementIds);
    const available = elements.length;
    const notes = [
      "React Native: styles are each element's flattened StyleSheet; there are no CSS custom properties and no cascade",
    ];
    if (body.elementIds && available === 0) notes.push('elementIds matched no registered element');
    const capped = elements.slice(0, body.maxElements);
    const samples = capped.map((el) => {
      const state = el.getState();
      const data = getNativeElementDesignData(el.id, el.label, el.type, el.flatStyle, state.layout);
      return { elementId: el.id, styles: data.styles as unknown as Record<string, string> };
    });
    const rootFontSizePx = body.rootFontSizePx ?? 16;
    return {
      samples,
      capture: {
        scope: 'registered',
        elementsAvailable: available,
        elementsSampled: samples.length,
        elementsSkipped: 0,
        elementCapReached: capped.length < available,
        customPropertiesSeen: 0,
        rootFontSizePx,
        notes,
      },
    };
  }

  /** Native's refusal of a request the web transports accept but RN cannot answer. */
  function unsupportedOnNative(body: InferBodyLike): string | null {
    return body.scope === 'document'
      ? 'scope must be "registered" on React Native (there is no document)'
      : null;
  }

  function inferenceUnavailable<T>(): APIResponse<T> {
    return error(
      'Install a @qontinui/ui-bridge release containing style inference (0.56.0 or later).',
      'INFERENCE_NOT_AVAILABLE'
    );
  }

  // Helper to get screen dimensions via the injected provider.
  //
  // The 0.6.3/0.6.4 implementation called `require('react-native')` here
  // inside a try/catch; Metro/Hermes still surfaced `unknownModuleError`
  // up the stack and tore down the JS thread the moment any design endpoint
  // was touched. The fix is to take the viewport as an injected dependency
  // (parity with `getPageHealth`) so this file has no `react-native` dep
  // at all — see the doc comment on `createDesignHandlers` above and the
  // project memory entry `feedback_metro_require_gotcha.md`.
  function getScreenDimensions(): { width: number; height: number } {
    return viewportProvider?.() ?? { width: 0, height: 0 };
  }

  /** The context shape rule: the SDK's when it carries one, else native's copy. */
  function contextProblemOf(value: unknown): string | null {
    return (evaluator?.qualityContextProblem ?? localContextProblem)(value);
  }

  /** The registered elements a validated `elementIds` selects (all when absent). */
  function selectElements(elementIds: readonly string[] | undefined) {
    const elements = registry.getAllElements();
    if (!elementIds) return elements;
    const idSet = new Set(elementIds);
    return elements.filter((e) => idSet.has(e.id));
  }

  /**
   * The context a named `/design/evaluate` request resolves to, as the web
   * transports' `requestedContext`: a context the loaded style guide declares
   * under that name (own keys only, so `toString` names none), else the
   * built-in of that name. Any other name — `""` included — is refused with
   * web's message rather than left to the evaluator.
   */
  function requestedContextName(body: Record<string, unknown>, route: string): unknown {
    const name = stringOf(body, 'context', route) ?? 'general';
    const declared = (loadedStyleGuide as { qualityContexts?: Record<string, unknown> } | null)
      ?.qualityContexts;
    if (declared && Object.prototype.hasOwnProperty.call(declared, name)) {
      // A declared context is checked by the same shape rule as a custom one.
      const problem = contextProblemOf(declared[name]);
      if (problem !== null) {
        throw new NativeRequestError(`${route}: quality context "${name}"${problem}`);
      }
      return declared[name];
    }
    const builtIns = evaluator?.listContexts().map((c) => c.name) ?? [];
    if (builtIns.includes(name)) return name;
    const available = [...builtIns, ...Object.keys(declared ?? {})];
    throw new NativeRequestError(
      `Unknown quality context: "${name}". Available: ${available.join(', ')}`
    );
  }

  /** Native design data for the selected elements. */
  function designDataOf(elementIds: readonly string[] | undefined): ElementDesignData[] {
    return selectElements(elementIds).map((el) => {
      const state = el.getState();
      return getNativeElementDesignData(el.id, el.label, el.type, el.flatStyle, state.layout);
    });
  }

  return {
    // 1. GET /design/element/:id/styles
    getElementStyles: async (ctx) => {
      const { id } = ctx.params;
      const element = registry.getElement(id);

      if (!element) {
        return error('Element not found: ' + id, 'ELEMENT_NOT_FOUND');
      }

      const state = element.getState();
      const data = getNativeElementDesignData(
        id,
        element.label,
        element.type,
        element.flatStyle,
        state.layout
      );

      return success(data);
    },

    // 2. POST /design/element/:id/state-styles
    getElementStateStyles: async (ctx) => {
      const { id } = ctx.params;
      const element = registry.getElement(id);

      if (!element) {
        return error('Element not found: ' + id, 'ELEMENT_NOT_FOUND');
      }

      const stateStyles = captureNativeStateVariations(element.flatStyle, element.stateStyles);

      return success({ elementId: id, stateStyles });
    },

    // 3. POST /design/snapshot
    getDesignSnapshot: async (ctx) => {
      // Validated as the web transports' `designSnapshotOf` does, for the
      // fields native reads (`includePseudoElements` and `limit` are not).
      let elementIds: string[] | undefined;
      try {
        elementIds = elementIdsOf(bodyOf(ctx.body, '/design/snapshot'), '/design/snapshot');
      } catch (err) {
        return invalidRequest(err);
      }
      return success({ elements: designDataOf(elementIds), timestamp: Date.now() });
    },

    // 4. POST /design/responsive
    getResponsiveSnapshots: async (ctx) => {
      // Platform limitation: RN cannot constrain screen width at runtime.
      // Returns a single snapshot at current device dimensions.
      let elementIds: string[] | undefined;
      try {
        elementIds = elementIdsOf(bodyOf(ctx.body, '/design/responsive'), '/design/responsive');
      } catch (err) {
        return invalidRequest(err);
      }
      const elements = selectElements(elementIds);
      const elementData = elements.map((el) => {
        const state = el.getState();
        return {
          id: el.id,
          label: el.label,
          type: el.type,
          flatStyle: el.flatStyle,
          layout: state.layout,
        };
      });

      const snapshots = captureNativeResponsiveSnapshot(elementData, getScreenDimensions());
      return success(snapshots);
    },

    // 5. POST /design/audit
    runDesignAudit: async (ctx) => {
      // The fields native reads — body, rootFontSizePx, elementIds, guide —
      // are validated in the web transports' `designAuditOf` order and with
      // its messages, so a body wrong in several of them is refused for the
      // same one on either side. Native does not read `limit`,
      // `includePassed` or `maxResults`, so it does not validate them.
      const route = '/design/audit';
      let body: Record<string, unknown>;
      try {
        body = bodyOf(ctx.body, route);
      } catch (err) {
        return invalidRequest(err);
      }

      // Refused, not ignored: the web transports' `designAuditOf` validates
      // it the same way, before the guide is consulted.
      const root = body.rootFontSizePx;
      if (isGiven(root) && !isPositiveNumber(root)) {
        return error(
          `${route}: rootFontSizePx must be a finite number greater than 0`,
          'INVALID_REQUEST'
        );
      }

      let elementIds: string[] | undefined;
      try {
        elementIds = elementIdsOf(body, route);
      } catch (err) {
        return invalidRequest(err);
      }

      // A guide given in the body must have the shape the web transports'
      // `designAuditOf` requires (an object with a `rules` array); refused
      // with the same message rather than handed to the validator.
      const requestedGuide = body.guide;
      if (
        isGiven(requestedGuide) &&
        !(isObject(requestedGuide) && Array.isArray(requestedGuide.rules))
      ) {
        return error(
          `${route}: guide must be a style guide object with a rules array`,
          'INVALID_REQUEST'
        );
      }

      const guide = requestedGuide ?? loadedStyleGuide;

      if (!guide) {
        return error('No style guide loaded or provided', 'NO_STYLE_GUIDE');
      }

      if (!validator) {
        return error(
          'Install @qontinui/ui-bridge for style audit support. ' +
            'Add it as a dependency: npm install @qontinui/ui-bridge',
          'VALIDATOR_NOT_AVAILABLE'
        );
      }

      // A given list selects exactly its ids — an empty one selects nothing,
      // as web's `selectElements` does; only an absent list means all.
      const elements = selectElements(elementIds);

      // Map elements to the format expected by the validator
      const auditElements = elements.map((el) => ({
        elementId: el.id,
        styles: mapNativeStyleToExtended(el.flatStyle) as unknown as Record<string, string>,
      }));

      try {
        // React Native has no root font size; a caller auditing rem-valued
        // tokens says which one (validated above), else `rem` resolves at 16px
        // (as inference does).
        const rootFontSizePx = typeof root === 'number' ? root : undefined;
        const report = validator.runStyleAudit(
          auditElements,
          guide,
          rootFontSizePx !== undefined ? { rootFontSizePx } : undefined
        );
        return success(report);
      } catch (err) {
        return error(
          'Audit failed: ' + (err instanceof Error ? err.message : String(err)),
          'DESIGN_AUDIT_ERROR'
        );
      }
    },

    // 6. POST /design/style-guide/load
    loadStyleGuide: async (ctx) => {
      const body = ctx.body as { guide?: unknown } | undefined;

      if (!body?.guide) {
        return error('Style guide is required in request body', 'INVALID_REQUEST');
      }

      loadedStyleGuide = body.guide;
      return success({ loaded: true });
    },

    // 7. GET /design/style-guide
    getStyleGuide: async () => {
      return success(loadedStyleGuide);
    },

    // 8. DELETE /design/style-guide
    clearStyleGuide: async () => {
      loadedStyleGuide = null;
      return success({ cleared: true });
    },

    // 9. POST /design/evaluate
    evaluateQuality: async (ctx) => {
      if (!evaluator) {
        return error(
          'Install @qontinui/ui-bridge for quality evaluation support. ' +
            'Add it as a dependency: npm install @qontinui/ui-bridge',
          'EVALUATOR_NOT_AVAILABLE'
        );
      }

      // Validated in the web transports' `evaluateRegisteredQuality` order
      // and with its messages: body, elementIds, viewport, customContext,
      // context. A partial viewport would otherwise score on NaN.
      const route = '/design/evaluate';
      let elementIds: string[] | undefined;
      let viewport: { width: number; height: number };
      let context: unknown;
      try {
        const body = bodyOf(ctx.body, route);
        elementIds = elementIdsOf(body, route);
        viewport = viewportOf(body, route) ?? getScreenDimensions();
        // Resolve context: custom object > style guide context > built-in name
        context =
          customContextOf(body, route, contextProblemOf) ?? requestedContextName(body, route);
      } catch (err) {
        return invalidRequest(err);
      }

      const designData = designDataOf(elementIds);

      try {
        const report = evaluator.evaluateQuality(designData, viewport, context);
        return success(report);
      } catch (err) {
        return error(
          'Evaluation failed: ' + (err instanceof Error ? err.message : String(err)),
          'QUALITY_EVALUATION_ERROR'
        );
      }
    },

    // 10. GET /design/evaluate/contexts
    getQualityContexts: async () => {
      if (!evaluator) {
        return error(
          'Install @qontinui/ui-bridge for quality evaluation support.',
          'EVALUATOR_NOT_AVAILABLE'
        );
      }
      return success(evaluator.listContexts());
    },

    // 11. POST /design/evaluate/baseline
    saveBaseline: async (ctx) => {
      if (!evaluator) {
        return error(
          'Install @qontinui/ui-bridge for quality evaluation support.',
          'EVALUATOR_NOT_AVAILABLE'
        );
      }

      // Validated as the web transports' `captureQualityBaseline` does.
      const route = '/design/evaluate/baseline';
      let elementIds: string[] | undefined;
      let label: string | undefined;
      try {
        const body = bodyOf(ctx.body, route);
        elementIds = elementIdsOf(body, route);
        label = stringOf(body, 'label', route);
      } catch (err) {
        return invalidRequest(err);
      }

      try {
        const designData = designDataOf(elementIds);
        const viewport = getScreenDimensions();
        savedBaseline = evaluator.createBaseline(designData, viewport, label);
        return success({ saved: true, elementCount: designData.length });
      } catch (err) {
        // Answered, not thrown, as the web transports answer it.
        return error(err instanceof Error ? err.message : String(err), 'SAVE_BASELINE_ERROR');
      }
    },

    // 12. POST /design/evaluate/diff
    diffBaseline: async (ctx) => {
      if (!evaluator) {
        return error(
          'Install @qontinui/ui-bridge for quality evaluation support.',
          'EVALUATOR_NOT_AVAILABLE'
        );
      }

      if (!savedBaseline) {
        return error('No baseline saved. Call saveBaseline first.', 'NO_BASELINE');
      }

      // Validated as the web transports' `diffQualityBaseline` does, after
      // the baseline check (web's handlers check it first too).
      const route = '/design/evaluate/diff';
      let elementIds: string[] | undefined;
      try {
        elementIds = elementIdsOf(bodyOf(ctx.body, route), route);
      } catch (err) {
        return invalidRequest(err);
      }
      const designData = designDataOf(elementIds);

      try {
        const report = evaluator.diffSnapshots(savedBaseline, designData);
        return success(report);
      } catch (err) {
        return error(
          'Diff failed: ' + (err instanceof Error ? err.message : String(err)),
          'DIFF_BASELINE_ERROR'
        );
      }
    },

    // 13. POST /design/style-guide/infer
    inferStyleGuide: async (ctx) => {
      if (!inference) return inferenceUnavailable();
      const started = Date.now();
      try {
        const body = inference.parseInferBody(ctx.body);
        const refusal = unsupportedOnNative(body);
        if (refusal) return error(refusal, 'INVALID_REQUEST');
        const { samples, capture } = inferenceSamples(body);
        const inventory = inference.buildStyleInventory(samples, {
          rootFontSizePx: capture.rootFontSizePx as number,
        });
        const inferred = inference.inferStyleGuideFromInventory(inventory, {
          maxPerCategory: body.maxPerCategory,
          limits: body.limits,
          name: body.name,
        });
        return success({
          ...inferred,
          capture,
          timestamp: Date.now(),
          durationMs: Date.now() - started,
        });
      } catch (err) {
        if (isInvalidRequest(err)) return error(err.message, 'INVALID_REQUEST');
        return error(
          'Inference failed: ' + (err instanceof Error ? err.message : String(err)),
          'STYLE_INFERENCE_ERROR'
        );
      }
    },

    // 14. POST /design/tokens/drift
    diffDesignTokens: async (ctx) => {
      if (!inference) return inferenceUnavailable();
      const started = Date.now();
      try {
        const body = inference.parseDriftBody(ctx.body);
        const refusal = unsupportedOnNative(body);
        if (refusal) return error(refusal, 'INVALID_REQUEST');
        let declared: { tokens?: unknown; customProperties?: Record<string, string | number> };
        switch (body.source.kind) {
          case 'tokens':
            declared = { tokens: body.source.tokens };
            break;
          case 'customProperties':
            declared = { customProperties: body.source.customProperties };
            break;
          case 'pageCustomProperties':
            return error(
              'pageCustomPropertyPrefix is not available on React Native (no CSS custom properties)',
              'INVALID_REQUEST'
            );
          case 'loadedStyleGuide':
            declared = {
              tokens: inference.loadedGuideTokens(loadedStyleGuide as { tokens?: unknown } | null),
            };
            break;
        }
        const { samples, capture } = inferenceSamples(body);
        const rootFontSizePx = capture.rootFontSizePx as number;
        const inventory = inference.buildStyleInventory(samples, { rootFontSizePx });
        const report = inference.computeTokenDrift(inventory, declared, {
          ...body.tolerance,
          maxListed: body.maxListed,
          rootFontSizePx,
        });
        return success({
          ...report,
          declaredSource: body.source.kind,
          capture,
          timestamp: Date.now(),
          durationMs: Date.now() - started,
        });
      } catch (err) {
        if (isInvalidRequest(err)) return error(err.message, 'INVALID_REQUEST');
        return error(
          'Drift failed: ' + (err instanceof Error ? err.message : String(err)),
          'TOKEN_DRIFT_ERROR'
        );
      }
    },
  };
}
