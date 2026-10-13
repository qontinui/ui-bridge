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
 */

import type { ElementDesignData } from '../core/types';
import { getElementDesignData } from '../ai/design-inspector';
import { evaluateQuality } from './quality-evaluator';
import { createBaseline, diffSnapshots } from './quality-diff';
import type {
  EvaluateRequest,
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
 * Read live design data for the selected elements (all of them when
 * `elementIds` is absent).
 */
export function collectDesignData(
  elements: readonly QualityElementSource[],
  elementIds?: readonly string[]
): ElementDesignData[] {
  const selected = elementIds ? elements.filter((el) => elementIds.includes(el.id)) : elements;
  const designData: ElementDesignData[] = [];
  for (const el of selected) {
    if (el.element instanceof HTMLElement) {
      designData.push(
        getElementDesignData(el.element, { elementId: el.id, label: el.label, type: el.type })
      );
    }
  }
  return designData;
}

function windowViewport(): ViewportDimensions {
  return { width: window.innerWidth, height: window.innerHeight };
}

/**
 * Answer `/design/evaluate`: the 28 metrics as values, under the requested
 * context. Context precedence: a custom context object, then a context the
 * loaded style guide declares under the requested name, then the built-in of
 * that name. Throws on an unknown context name.
 */
export function evaluateRegisteredQuality(
  elements: readonly QualityElementSource[],
  request: EvaluateRequest | undefined,
  styleGuide: Pick<StyleGuideConfig, 'qualityContexts'> | null | undefined
): QualityEvaluationReport {
  const designData = collectDesignData(elements, request?.elementIds);
  const viewport = request?.viewport ?? windowViewport();
  let context: QualityContext | string = request?.customContext ?? request?.context ?? 'general';
  if (typeof context === 'string' && styleGuide?.qualityContexts?.[context]) {
    context = styleGuide.qualityContexts[context];
  }
  return evaluateQuality(designData, viewport, context);
}

/** Answer `/design/evaluate/baseline`: capture the baseline the diff reads. */
export function captureQualityBaseline(
  elements: readonly QualityElementSource[],
  request: QualityBaselineRequest | undefined
): SnapshotBaseline {
  return createBaseline(
    collectDesignData(elements, request?.elementIds),
    windowViewport(),
    request?.label
  );
}

/** Answer `/design/evaluate/diff`: style and layout changes since the baseline. */
export function diffQualityBaseline(
  baseline: SnapshotBaseline,
  elements: readonly QualityElementSource[],
  request: QualityDiffRequest | undefined
): SnapshotDiffReport {
  return diffSnapshots(baseline, collectDesignData(elements, request?.elementIds));
}
