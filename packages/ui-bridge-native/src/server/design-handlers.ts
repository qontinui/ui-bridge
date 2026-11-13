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

// Try to load the style validator from the web SDK (optional peer dep)
let styleValidator: {
  runStyleAudit: (
    elements: Array<{ elementId: string; styles: Record<string, string> }>,
    guide: unknown
  ) => unknown;
} | null = null;

// Try to load quality evaluator from the web SDK (optional peer dep)
let qualityEvaluator: {
  evaluateQuality: (
    elements: ElementDesignData[],
    viewport: { width: number; height: number },
    context?: unknown
  ) => unknown;
  listContexts: () => Array<{ name: string; description: string }>;
  createBaseline: (
    elements: ElementDesignData[],
    viewport: { width: number; height: number },
    label?: string
  ) => unknown;
  diffSnapshots: (baseline: unknown, current: ElementDesignData[]) => unknown;
} | null = null;

/**
 * The web SDK's pure style-inference functions (`@qontinui/ui-bridge/specs`,
 * releases after 0.47.0). The peer range admits older versions that load but lack them, so
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

  /**
   * Style samples for the inference routes: the flattened StyleSheet of each
   * registered element, mapped to the web SDK's computed-style shape. React
   * Native has no CSS custom properties and no document, so the capture says so.
   */
  function inferenceSamples(body: InferBodyLike): {
    samples: Array<{ elementId: string; styles: Record<string, string> }>;
    capture: Record<string, unknown>;
  } {
    let elements = registry.getAllElements();
    if (body.elementIds) {
      const idSet = new Set(body.elementIds);
      elements = elements.filter((e) => idSet.has(e.id));
    }
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
      'Install a @qontinui/ui-bridge release later than 0.47.0 for style inference support.',
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
      const body = ctx.body as
        | {
            elementIds?: string[];
            includePseudoElements?: boolean;
          }
        | undefined;

      let elements = registry.getAllElements();

      // Filter to requested IDs if specified
      if (body?.elementIds && body.elementIds.length > 0) {
        const idSet = new Set(body.elementIds);
        elements = elements.filter((e) => idSet.has(e.id));
      }

      const designData: ElementDesignData[] = elements.map((el) => {
        const state = el.getState();
        return getNativeElementDesignData(el.id, el.label, el.type, el.flatStyle, state.layout);
      });

      return success({ elements: designData, timestamp: Date.now() });
    },

    // 4. POST /design/responsive
    getResponsiveSnapshots: async () => {
      // Platform limitation: RN cannot constrain screen width at runtime.
      // Returns a single snapshot at current device dimensions.
      const elements = registry.getAllElements();
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
      const body = ctx.body as
        | {
            guide?: unknown;
            elementIds?: string[];
          }
        | undefined;

      const guide = body?.guide ?? loadedStyleGuide;

      if (!guide) {
        return error('No style guide loaded or provided', 'NO_STYLE_GUIDE');
      }

      if (!styleValidator) {
        return error(
          'Install @qontinui/ui-bridge for style audit support. ' +
            'Add it as a dependency: npm install @qontinui/ui-bridge',
          'VALIDATOR_NOT_AVAILABLE'
        );
      }

      let elements = registry.getAllElements();
      if (body?.elementIds && body.elementIds.length > 0) {
        const idSet = new Set(body.elementIds);
        elements = elements.filter((e) => idSet.has(e.id));
      }

      // Map elements to the format expected by the validator
      const auditElements = elements.map((el) => ({
        elementId: el.id,
        styles: mapNativeStyleToExtended(el.flatStyle) as unknown as Record<string, string>,
      }));

      try {
        const report = styleValidator.runStyleAudit(auditElements, guide);
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
      if (!qualityEvaluator) {
        return error(
          'Install @qontinui/ui-bridge for quality evaluation support. ' +
            'Add it as a dependency: npm install @qontinui/ui-bridge',
          'EVALUATOR_NOT_AVAILABLE'
        );
      }

      const body = ctx.body as
        | {
            context?: string;
            customContext?: unknown;
            elementIds?: string[];
            viewport?: { width: number; height: number };
          }
        | undefined;

      let elements = registry.getAllElements();
      if (body?.elementIds && body.elementIds.length > 0) {
        const idSet = new Set(body.elementIds);
        elements = elements.filter((e) => idSet.has(e.id));
      }

      const designData: ElementDesignData[] = elements.map((el) => {
        const state = el.getState();
        return getNativeElementDesignData(el.id, el.label, el.type, el.flatStyle, state.layout);
      });

      const viewport = body?.viewport ?? getScreenDimensions();

      // Resolve context: custom object > style guide context > built-in name
      let context: unknown = body?.customContext ?? body?.context ?? 'general';
      if (typeof context === 'string' && loadedStyleGuide) {
        const guide = loadedStyleGuide as { qualityContexts?: Record<string, unknown> };
        if (guide.qualityContexts?.[context]) {
          context = guide.qualityContexts[context];
        }
      }

      try {
        const report = qualityEvaluator.evaluateQuality(designData, viewport, context);
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
      if (!qualityEvaluator) {
        return error(
          'Install @qontinui/ui-bridge for quality evaluation support.',
          'EVALUATOR_NOT_AVAILABLE'
        );
      }
      return success(qualityEvaluator.listContexts());
    },

    // 11. POST /design/evaluate/baseline
    saveBaseline: async (ctx) => {
      if (!qualityEvaluator) {
        return error(
          'Install @qontinui/ui-bridge for quality evaluation support.',
          'EVALUATOR_NOT_AVAILABLE'
        );
      }

      const body = ctx.body as
        | {
            label?: string;
            elementIds?: string[];
          }
        | undefined;

      let elements = registry.getAllElements();
      if (body?.elementIds && body.elementIds.length > 0) {
        const idSet = new Set(body.elementIds);
        elements = elements.filter((e) => idSet.has(e.id));
      }

      const designData: ElementDesignData[] = elements.map((el) => {
        const state = el.getState();
        return getNativeElementDesignData(el.id, el.label, el.type, el.flatStyle, state.layout);
      });

      const viewport = getScreenDimensions();
      savedBaseline = qualityEvaluator.createBaseline(designData, viewport, body?.label);
      return success({ saved: true, elementCount: designData.length });
    },

    // 12. POST /design/evaluate/diff
    diffBaseline: async (ctx) => {
      if (!qualityEvaluator) {
        return error(
          'Install @qontinui/ui-bridge for quality evaluation support.',
          'EVALUATOR_NOT_AVAILABLE'
        );
      }

      if (!savedBaseline) {
        return error('No baseline saved. Call saveBaseline first.', 'NO_BASELINE');
      }

      const body = ctx.body as { elementIds?: string[] } | undefined;

      let elements = registry.getAllElements();
      if (body?.elementIds && body.elementIds.length > 0) {
        const idSet = new Set(body.elementIds);
        elements = elements.filter((e) => idSet.has(e.id));
      }

      const designData: ElementDesignData[] = elements.map((el) => {
        const state = el.getState();
        return getNativeElementDesignData(el.id, el.label, el.type, el.flatStyle, state.layout);
      });

      try {
        const report = qualityEvaluator.diffSnapshots(savedBaseline, designData);
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
