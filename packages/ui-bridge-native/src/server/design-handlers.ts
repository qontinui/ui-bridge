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

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const specs = require('@qontinui/ui-bridge/specs');
  styleValidator = specs;
  qualityEvaluator = specs;
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
}

/**
 * Create design review handlers.
 */
export function createDesignHandlers(registry: NativeUIBridgeRegistry): NativeDesignHandlers {
  // Helper to get screen dimensions (React Native's Dimensions API must be
  // called at handler time, not import time, so we use a lazy getter).
  function getScreenDimensions(): { width: number; height: number } {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const { Dimensions } = require('react-native');
      const screen = Dimensions.get('screen');
      return { width: screen.width, height: screen.height };
    } catch {
      return { width: 0, height: 0 };
    }
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
  };
}
