/**
 * Quality Diff
 *
 * Snapshot baseline creation and diffing for regression detection.
 * Compares element design data across two points in time.
 */

import type { ElementDesignData, ExtendedComputedStyles } from '../core/types';
import type {
  ViewportDimensions,
  SnapshotBaseline,
  SnapshotDiffReport,
  ElementDiff,
  StyleChange,
  LayoutShift,
} from './quality-types';

// ============================================================================
// Baseline
// ============================================================================

/**
 * Create a snapshot baseline from current element data.
 */
export function createBaseline(
  elements: ElementDesignData[],
  viewport: ViewportDimensions,
  label?: string
): SnapshotBaseline {
  return {
    elements: structuredClone(elements),
    viewport: { ...viewport },
    timestamp: Date.now(),
    label,
  };
}

// ============================================================================
// Diff
// ============================================================================

const STYLE_PROPERTIES = [
  'display',
  'position',
  'width',
  'height',
  'margin',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'padding',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'textAlign',
  'textTransform',
  'textDecoration',
  'color',
  'backgroundColor',
  'border',
  'borderRadius',
  'boxShadow',
  'opacity',
  'gap',
  'flexDirection',
  'justifyContent',
  'alignItems',
] as const;

interface DiffOptions {
  /** Layout shift threshold in px to consider "significant". Default: 2 */
  layoutThreshold?: number;
  /** CLS threshold to flag hasSignificantChanges. Default: 0.1 */
  clsThreshold?: number;
}

/**
 * Diff current elements against a baseline snapshot.
 */
export function diffSnapshots(
  baseline: SnapshotBaseline,
  current: ElementDesignData[],
  options?: DiffOptions
): SnapshotDiffReport {
  const layoutThreshold = options?.layoutThreshold ?? 2;
  const clsThreshold = options?.clsThreshold ?? 0.1;

  const baseMap = new Map<string, ElementDesignData>();
  for (const el of baseline.elements) {
    baseMap.set(el.elementId, el);
  }

  const currentMap = new Map<string, ElementDesignData>();
  for (const el of current) {
    currentMap.set(el.elementId, el);
  }

  const added: ElementDiff[] = [];
  const removed: ElementDiff[] = [];
  const modified: ElementDiff[] = [];
  let totalLayoutShift = 0;
  const viewportArea = baseline.viewport.width * baseline.viewport.height || 1;

  // Find added elements
  for (const el of current) {
    if (!baseMap.has(el.elementId)) {
      added.push({ elementId: el.elementId, changeType: 'added' });
    }
  }

  // Find removed elements
  for (const el of baseline.elements) {
    if (!currentMap.has(el.elementId)) {
      removed.push({ elementId: el.elementId, changeType: 'removed' });
    }
  }

  // Find modified elements
  for (const el of current) {
    const baseEl = baseMap.get(el.elementId);
    if (!baseEl) continue;

    const styleChanges = diffStyles(baseEl.styles, el.styles);
    const layoutShift = diffLayout(baseEl, el, layoutThreshold);

    if (styleChanges.length > 0 || layoutShift) {
      modified.push({
        elementId: el.elementId,
        changeType: 'modified',
        styleChanges: styleChanges.length > 0 ? styleChanges : undefined,
        layoutShift: layoutShift ?? undefined,
      });

      // Accumulate CLS: area-weighted position change
      if (layoutShift) {
        const area = el.rect.width * el.rect.height;
        const distance = Math.sqrt(layoutShift.dx ** 2 + layoutShift.dy ** 2);
        const impactFraction = area / viewportArea;
        const distanceFraction =
          distance / Math.max(baseline.viewport.width, baseline.viewport.height);
        totalLayoutShift += impactFraction * distanceFraction;
      }
    }
  }

  const hasSignificantChanges =
    added.length > 0 ||
    removed.length > 0 ||
    totalLayoutShift > clsThreshold ||
    modified.some((m) => (m.styleChanges?.length ?? 0) > 3);

  return {
    added,
    removed,
    modified,
    cumulativeLayoutShift: Math.round(totalLayoutShift * 10000) / 10000,
    hasSignificantChanges,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function diffStyles(
  oldStyles: ExtendedComputedStyles,
  newStyles: ExtendedComputedStyles
): StyleChange[] {
  const changes: StyleChange[] = [];

  for (const prop of STYLE_PROPERTIES) {
    const oldVal = oldStyles[prop] ?? '';
    const newVal = newStyles[prop] ?? '';
    if (oldVal !== newVal) {
      changes.push({ property: prop, oldValue: oldVal, newValue: newVal });
    }
  }

  return changes;
}

function diffLayout(
  oldEl: ElementDesignData,
  newEl: ElementDesignData,
  threshold: number
): LayoutShift | null {
  const dx = newEl.rect.x - oldEl.rect.x;
  const dy = newEl.rect.y - oldEl.rect.y;
  const dWidth = newEl.rect.width - oldEl.rect.width;
  const dHeight = newEl.rect.height - oldEl.rect.height;

  if (
    Math.abs(dx) > threshold ||
    Math.abs(dy) > threshold ||
    Math.abs(dWidth) > threshold ||
    Math.abs(dHeight) > threshold
  ) {
    return { dx, dy, dWidth, dHeight };
  }

  return null;
}
