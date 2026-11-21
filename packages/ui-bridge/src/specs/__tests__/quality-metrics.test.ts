/**
 * Quality Metrics Tests — UX Category
 *
 * Tests for the 5 UX metrics: contentOverflow, aboveFoldRatio,
 * informationDensity, containerEfficiency, viewportUtilization.
 * Plus the evaluator report's shape (per-metric values, no aggregate), and
 * oklch colours reaching the colour metrics through the one colour parser.
 */

import { describe, it, expect } from 'vitest';
import {
  contentOverflow,
  aboveFoldRatio,
  informationDensity,
  containerEfficiency,
  viewportUtilization,
  wcagContrastCompliance,
  uniqueColorCount,
  cardConsistency,
  customPropertyConsistency,
  METRIC_FUNCTIONS,
} from '../quality-metrics';
import { parseColor } from '../color-utils';
import { evaluateQuality, qualityContextProblem } from '../quality-evaluator';
import { BUILT_IN_CONTEXTS } from '../quality-contexts';
import type { ElementDesignData, ExtendedComputedStyles } from '../../core/types';
import type { ViewportDimensions } from '../quality-types';

// ============================================================================
// Test Helpers
// ============================================================================

const DEFAULT_VIEWPORT: ViewportDimensions = { width: 1280, height: 800 };

function makeStyles(overrides: Partial<ExtendedComputedStyles> = {}): ExtendedComputedStyles {
  return {
    display: 'block',
    visibility: 'visible',
    opacity: '1',
    pointerEvents: 'auto',
    color: '#000000',
    backgroundColor: '',
    fontSize: '16px',
    fontFamily: 'Inter',
    fontWeight: '400',
    lineHeight: '24px',
    letterSpacing: '0px',
    textAlign: 'left',
    textDecoration: 'none',
    textTransform: 'none',
    borderStyle: 'none',
    borderWidth: '0px',
    borderColor: '',
    borderRadius: '0px',
    paddingTop: '0px',
    paddingRight: '0px',
    paddingBottom: '0px',
    paddingLeft: '0px',
    marginTop: '0px',
    marginRight: '0px',
    marginBottom: '0px',
    marginLeft: '0px',
    width: 'auto',
    height: 'auto',
    minWidth: '',
    maxWidth: '',
    minHeight: '',
    maxHeight: '',
    position: 'static',
    overflow: 'visible',
    zIndex: 'auto',
    boxShadow: 'none',
    cursor: 'default',
    ...overrides,
  };
}

function makeElement(
  id: string,
  type: string,
  rect: { x: number; y: number; width: number; height: number },
  styleOverrides: Partial<ExtendedComputedStyles> = {}
): ElementDesignData {
  return {
    elementId: id,
    type,
    rect,
    styles: makeStyles(styleOverrides),
  };
}

function makeContainer(
  id: string,
  rect: { x: number; y: number; width: number; height: number }
): ElementDesignData {
  return makeElement(id, 'generic', rect, {
    backgroundColor: '#f5f5f5',
    borderRadius: '8px',
    paddingTop: '16px',
    paddingLeft: '16px',
  });
}

function makeContentElement(
  id: string,
  type: string,
  rect: { x: number; y: number; width: number; height: number }
): ElementDesignData {
  return makeElement(id, type, rect);
}

// ============================================================================
// contentOverflow
// ============================================================================

describe('contentOverflow', () => {
  it('returns 100 when all content fits in viewport', () => {
    const elements = [
      makeElement('a', 'heading', { x: 0, y: 0, width: 400, height: 50 }),
      makeElement('b', 'paragraph', { x: 0, y: 60, width: 400, height: 200 }),
    ];
    const result = contentOverflow(elements, DEFAULT_VIEWPORT);
    expect(result.score).toBe(100);
    expect(result.findings).toHaveLength(0);
  });

  it('returns 100 for empty elements', () => {
    const result = contentOverflow([], DEFAULT_VIEWPORT);
    expect(result.score).toBe(100);
  });

  it('degrades score when content overflows by 50%', () => {
    const elements = [
      makeElement('a', 'heading', { x: 0, y: 0, width: 400, height: 50 }),
      makeElement('b', 'paragraph', { x: 0, y: 800, width: 400, height: 400 }), // extends to y=1200
    ];
    const result = contentOverflow(elements, DEFAULT_VIEWPORT);
    expect(result.score).toBe(50);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe('warning');
  });

  it('returns 0 when content overflows by full viewport height', () => {
    const elements = [
      makeElement('a', 'paragraph', { x: 0, y: 800, width: 400, height: 800 }), // extends to y=1600
    ];
    const result = contentOverflow(elements, DEFAULT_VIEWPORT);
    expect(result.score).toBe(0);
    expect(result.findings[0].severity).toBe('error');
  });

  it('has category "ux"', () => {
    const result = contentOverflow([], DEFAULT_VIEWPORT);
    expect(result.category).toBe('ux');
  });
});

// ============================================================================
// aboveFoldRatio
// ============================================================================

describe('aboveFoldRatio', () => {
  it('returns 100 when all content elements are above the fold', () => {
    const elements = [
      makeContentElement('a', 'heading', { x: 0, y: 0, width: 400, height: 50 }),
      makeContentElement('b', 'paragraph', { x: 0, y: 60, width: 400, height: 200 }),
      makeContentElement('c', 'label', { x: 0, y: 270, width: 200, height: 30 }),
    ];
    const result = aboveFoldRatio(elements, DEFAULT_VIEWPORT);
    expect(result.score).toBe(100);
  });

  it('returns 100 for empty elements', () => {
    const result = aboveFoldRatio([], DEFAULT_VIEWPORT);
    expect(result.score).toBe(100);
  });

  it('returns ~50 when half the content is below the fold', () => {
    const elements = [
      makeContentElement('a', 'heading', { x: 0, y: 0, width: 400, height: 50 }),
      makeContentElement('b', 'paragraph', { x: 0, y: 60, width: 400, height: 200 }),
      makeContentElement('c', 'label', { x: 0, y: 850, width: 200, height: 30 }),
      makeContentElement('d', 'metric-value', { x: 0, y: 900, width: 100, height: 40 }),
    ];
    const result = aboveFoldRatio(elements, DEFAULT_VIEWPORT);
    expect(result.score).toBe(50);
    expect(result.findings).toHaveLength(1);
  });

  it('ignores non-content elements (buttons, generic)', () => {
    const elements = [
      makeContentElement('a', 'heading', { x: 0, y: 0, width: 400, height: 50 }),
      makeElement('b', 'button', { x: 0, y: 900, width: 100, height: 40 }), // below fold, but not content-bearing
      makeElement('c', 'generic', { x: 0, y: 1000, width: 200, height: 100 }),
    ];
    const result = aboveFoldRatio(elements, DEFAULT_VIEWPORT);
    expect(result.score).toBe(100); // only the heading is content-bearing, and it's above the fold
  });
});

// ============================================================================
// informationDensity
// ============================================================================

describe('informationDensity', () => {
  it('returns 100 when content elements dominate', () => {
    const elements = [
      makeContentElement('a', 'heading', { x: 0, y: 0, width: 400, height: 50 }), // 20000
      makeContentElement('b', 'paragraph', { x: 0, y: 60, width: 400, height: 200 }), // 80000
      makeElement('c', 'generic', { x: 0, y: 270, width: 400, height: 30 }), // 12000 (chrome)
    ];
    const result = informationDensity(elements, DEFAULT_VIEWPORT);
    expect(result.score).toBe(100); // 100000/112000 > 0.3
  });

  it('returns low score when mostly chrome', () => {
    const elements = [
      makeContentElement('a', 'label', { x: 10, y: 10, width: 100, height: 20 }), // 2000
      makeElement('b', 'generic', { x: 0, y: 0, width: 800, height: 600 }), // 480000 (chrome)
      makeElement('c', 'generic', { x: 0, y: 600, width: 800, height: 200 }), // 160000 (chrome)
    ];
    const result = informationDensity(elements, DEFAULT_VIEWPORT);
    // ratio = 2000 / 642000 ≈ 0.003
    expect(result.score).toBeLessThan(10);
    expect(result.findings[0].severity).toBe('error');
  });

  it('returns 100 for empty elements', () => {
    const result = informationDensity([], DEFAULT_VIEWPORT);
    expect(result.score).toBe(100);
  });
});

// ============================================================================
// containerEfficiency
// ============================================================================

describe('containerEfficiency', () => {
  it('returns 100 when no containers exist', () => {
    const elements = [makeContentElement('a', 'heading', { x: 0, y: 0, width: 400, height: 50 })];
    const result = containerEfficiency(elements, DEFAULT_VIEWPORT);
    expect(result.score).toBe(100);
  });

  it('returns high score for well-filled containers', () => {
    const elements = [
      makeContainer('card', { x: 0, y: 0, width: 300, height: 200 }),
      makeContentElement('title', 'heading', { x: 10, y: 10, width: 280, height: 40 }),
      makeContentElement('body', 'paragraph', { x: 10, y: 60, width: 280, height: 120 }),
    ];
    const result = containerEfficiency(elements, DEFAULT_VIEWPORT);
    // child area = 11200 + 33600 = 44800, container area = 60000, efficiency = 0.747
    expect(result.score).toBe(100);
  });

  it('returns low score for oversized card with single number (admin dashboard scenario)', () => {
    const elements = [
      makeContainer('big-card', { x: 0, y: 0, width: 345, height: 120 }),
      makeContentElement('value', 'metric-value', { x: 20, y: 40, width: 60, height: 30 }),
    ];
    const result = containerEfficiency(elements, DEFAULT_VIEWPORT);
    // child area = 1800, container area = 41400, efficiency ≈ 0.043
    expect(result.score).toBeLessThan(50);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].elementIds).toContain('big-card');
  });

  it('handles multiple containers averaging their efficiency', () => {
    const elements = [
      // Bad container 1 — oversized for content
      makeContainer('bad-card-1', { x: 0, y: 0, width: 300, height: 200 }),
      makeContentElement('t1', 'label', { x: 10, y: 80, width: 40, height: 20 }),
      // Bad container 2 — also oversized
      makeContainer('bad-card-2', { x: 400, y: 0, width: 300, height: 200 }),
      makeContentElement('t2', 'label', { x: 420, y: 80, width: 40, height: 20 }),
    ];
    const result = containerEfficiency(elements, DEFAULT_VIEWPORT);
    // Both are inefficient, avg efficiency very low
    expect(result.score).toBeLessThan(50);
    expect(result.rawData?.containerCount).toBe(2);
  });
});

// ============================================================================
// viewportUtilization
// ============================================================================

describe('viewportUtilization', () => {
  it('returns 100 when elements fill the viewport', () => {
    const elements = [makeElement('a', 'generic', { x: 0, y: 0, width: 1280, height: 800 })];
    const result = viewportUtilization(elements, DEFAULT_VIEWPORT);
    expect(result.score).toBe(100);
  });

  it('returns 100 for empty elements', () => {
    const result = viewportUtilization([], DEFAULT_VIEWPORT);
    expect(result.score).toBe(100);
  });

  it('penalizes when content is clustered in a small region', () => {
    const elements = [makeElement('a', 'generic', { x: 100, y: 100, width: 200, height: 150 })];
    const result = viewportUtilization(elements, DEFAULT_VIEWPORT);
    // widthRatio = 200/1280 ≈ 0.156, heightRatio = 150/800 ≈ 0.188
    // utilization ≈ 0.172, score = 0.172/0.7 * 100 ≈ 24.6
    expect(result.score).toBeLessThan(30);
    expect(result.findings).toHaveLength(1);
  });

  it('returns moderate score for half-width content', () => {
    const elements = [makeElement('a', 'generic', { x: 0, y: 0, width: 640, height: 800 })];
    const result = viewportUtilization(elements, DEFAULT_VIEWPORT);
    // widthRatio = 0.5, heightRatio = 1.0, utilization = 0.75 → 100
    expect(result.score).toBe(100);
  });
});

// ============================================================================
// Evaluator report: values, not aggregates
// ============================================================================

describe('evaluateQuality report', () => {
  it('reports per-metric values and no aggregate score or grade', () => {
    const elements = [
      makeContentElement('h', 'heading', { x: 0, y: 0, width: 400, height: 50 }),
      makeContentElement('p', 'paragraph', { x: 0, y: 60, width: 400, height: 200 }),
    ];
    const report = evaluateQuality(elements, DEFAULT_VIEWPORT, 'general');
    // Values, not verdicts: no weighted total, no UX sub-score, no letter grade.
    // Combining scores, and the standard a score is judged against, belong to
    // the caller (domain_spec/ui-bridge behaviour (3)).
    expect(report).not.toHaveProperty('overallScore');
    expect(report).not.toHaveProperty('uxScore');
    expect(report).not.toHaveProperty('grade');
    expect(report).not.toHaveProperty('uxGrade');
    const enabled = report.metrics.filter((m) => m.enabled);
    expect(enabled.length).toBeGreaterThan(0);
    for (const m of enabled) {
      expect(typeof m.score).toBe('number');
      expect(m.weight).toBeGreaterThan(0);
      expect(Array.isArray(m.findings)).toBe(true);
    }
  });

  it('UX metrics appear with category "ux" in results', () => {
    const elements = [makeContentElement('h', 'heading', { x: 0, y: 0, width: 400, height: 50 })];
    const report = evaluateQuality(elements, DEFAULT_VIEWPORT, 'general');
    const uxMetrics = report.metrics.filter((m) => m.category === 'ux');
    expect(uxMetrics).toHaveLength(5);
    const ids = uxMetrics.map((m) => m.metricId);
    expect(ids).toContain('contentOverflow');
    expect(ids).toContain('aboveFoldRatio');
    expect(ids).toContain('informationDensity');
    expect(ids).toContain('containerEfficiency');
    expect(ids).toContain('viewportUtilization');
  });

  it('all UX metrics are always enabled (no gating)', () => {
    const elements = [makeContentElement('h', 'heading', { x: 0, y: 0, width: 400, height: 50 })];
    const report = evaluateQuality(elements, DEFAULT_VIEWPORT, 'general');
    const uxMetrics = report.metrics.filter((m) => m.category === 'ux');
    for (const m of uxMetrics) {
      expect(m.enabled).toBe(true);
    }
  });
});

// ============================================================================
// Admin Dashboard Scenario
// ============================================================================

describe('admin dashboard scenario', () => {
  it('detects oversized cards and below-fold content', () => {
    const viewport: ViewportDimensions = { width: 1280, height: 800 };

    const elements: ElementDesignData[] = [
      // Navigation bar
      makeElement('nav', 'generic', { x: 0, y: 0, width: 1280, height: 60 }),
      // Row of oversized stat cards
      makeContainer('card-1', { x: 20, y: 80, width: 345, height: 120 }),
      makeContentElement('val-1', 'metric-value', { x: 40, y: 110, width: 60, height: 30 }),
      makeContainer('card-2', { x: 385, y: 80, width: 345, height: 120 }),
      makeContentElement('val-2', 'metric-value', { x: 405, y: 110, width: 60, height: 30 }),
      makeContainer('card-3', { x: 750, y: 80, width: 345, height: 120 }),
      makeContentElement('val-3', 'metric-value', { x: 770, y: 110, width: 60, height: 30 }),
      // Large table below the fold
      makeContentElement('table-header', 'table-header', {
        x: 20,
        y: 850,
        width: 1200,
        height: 40,
      }),
      makeContentElement('row-1', 'table-cell', { x: 20, y: 900, width: 1200, height: 40 }),
      makeContentElement('row-2', 'table-cell', { x: 20, y: 950, width: 1200, height: 40 }),
      makeContentElement('row-3', 'table-cell', { x: 20, y: 1000, width: 1200, height: 40 }),
    ];

    // Container efficiency should be low — big cards with tiny numbers
    const ceResult = containerEfficiency(elements, viewport);
    expect(ceResult.score).toBeLessThan(50);

    // Content overflow should detect below-fold content
    const coResult = contentOverflow(elements, viewport);
    expect(coResult.score).toBeLessThan(100);

    // Above-fold ratio should be partial
    const afResult = aboveFoldRatio(elements, viewport);
    expect(afResult.score).toBeLessThan(100);
    // 3 metric-values are above fold, 3 table rows + header are below
    expect(afResult.rawData?.visibleCount).toBe(3);
    expect(afResult.rawData?.totalCount).toBe(7);
  });
});

// ============================================================================
// Regression: existing metrics still in registry
// ============================================================================

describe('METRIC_FUNCTIONS registry', () => {
  it('contains all 28 metrics (5 UX + 23 existing)', () => {
    const keys = Object.keys(METRIC_FUNCTIONS);
    expect(keys).toHaveLength(28);
  });

  it('UX metrics are first in the registry', () => {
    const keys = Object.keys(METRIC_FUNCTIONS);
    expect(keys[0]).toBe('contentOverflow');
    expect(keys[1]).toBe('aboveFoldRatio');
    expect(keys[2]).toBe('informationDensity');
    expect(keys[3]).toBe('containerEfficiency');
    expect(keys[4]).toBe('viewportUtilization');
  });

  it('existing density metrics still present', () => {
    expect(METRIC_FUNCTIONS).toHaveProperty('elementDensity');
    expect(METRIC_FUNCTIONS).toHaveProperty('whitespaceRatio');
    expect(METRIC_FUNCTIONS).toHaveProperty('localDensityBalance');
  });

  it('existing consistency metrics still present', () => {
    expect(METRIC_FUNCTIONS).toHaveProperty('buttonConsistency');
    expect(METRIC_FUNCTIONS).toHaveProperty('cardConsistency');
    expect(METRIC_FUNCTIONS).toHaveProperty('inputConsistency');
    expect(METRIC_FUNCTIONS).toHaveProperty('touchTargetCompliance');
  });
});

// ============================================================================
// oklch colours reach the colour metrics (one colour grammar)
// ============================================================================

describe('colour metrics read oklch', () => {
  // Tailwind v4 computes its palette to oklch(); a parser without it skipped
  // every such element, so a page full of low-contrast text scored 100.
  it('parseColor reads oklch and refuses non-strings', () => {
    const red = parseColor('oklch(0.628 0.2577 29.23)');
    expect(red).not.toBeNull();
    expect(red!.r).toBeGreaterThan(250);
    expect(red!.g).toBeLessThan(5);
    expect(red!.b).toBeLessThan(5);
    expect(red!.a).toBe(1);
    expect(parseColor(undefined)).toBeNull();
    expect(parseColor('')).toBeNull();
    expect(parseColor('none')).toBeNull();
    // An overflowing hue or lab coordinate is no colour, never NaN channels.
    expect(parseColor('hsl(1e999 50% 50%)')).toBeNull();
    expect(parseColor('hsl(1e307rad 50% 50%)')).toBeNull();
    expect(parseColor('oklch(0.5 0.1 1e308grad)')).toBeNull();
    expect(parseColor('lab(1e308 1e308 0)')).toBeNull();
    // An overflowing rgb channel or alpha clamps, as CSS does.
    expect(parseColor('rgb(1e999 0 0)')).toMatchObject({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor('rgb(0 0 0 / 1e999)')).toMatchObject({ a: 1 });
  });

  it('wcagContrastCompliance counts an oklch-coloured text element', () => {
    const elements = [
      // near-white on white: fails AA, and must be COUNTED, not skipped
      makeElement(
        'faint',
        'paragraph',
        { x: 0, y: 0, width: 200, height: 20 },
        {
          color: 'oklch(0.95 0 0)',
          backgroundColor: 'oklch(1 0 0)',
        }
      ),
      makeElement(
        'ok',
        'paragraph',
        { x: 0, y: 30, width: 200, height: 20 },
        {
          color: '#000000',
          backgroundColor: '#ffffff',
        }
      ),
    ];
    const result = wcagContrastCompliance(elements, DEFAULT_VIEWPORT);
    expect(result.score).toBe(50);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].elementIds).toEqual(['faint']);
  });

  it('uniqueColorCount clusters oklch colours with their hex twins', () => {
    const elements = [
      makeElement(
        'a',
        'generic',
        { x: 0, y: 0, width: 10, height: 10 },
        {
          color: 'oklch(0.628 0.2577 29.23)',
          backgroundColor: '#ff0000',
        }
      ),
    ];
    const result = uniqueColorCount(elements, DEFAULT_VIEWPORT);
    // Both values are red: one cluster, read from two spellings.
    expect(result.rawData).toMatchObject({ count: 1, totalSampled: 2 });
  });

  it('parseColor returns exactly the four RGBA fields, even out of gamut', () => {
    const wide = parseColor('oklch(0.7 0.4 150)');
    expect(wide).not.toBeNull();
    expect(Object.keys(wide!).sort()).toEqual(['a', 'b', 'g', 'r']);
  });

  it('wcagContrastCompliance does not score a transparent foreground', () => {
    const elements = [
      makeElement(
        'clear',
        'paragraph',
        { x: 0, y: 0, width: 200, height: 20 },
        {
          color: 'rgba(0, 0, 0, 0)',
          backgroundColor: 'rgba(0, 0, 0, 0)',
        }
      ),
      makeElement(
        'named',
        'paragraph',
        { x: 0, y: 30, width: 200, height: 20 },
        {
          color: 'transparent',
          backgroundColor: '#000000',
        }
      ),
    ];
    const result = wcagContrastCompliance(elements, DEFAULT_VIEWPORT);
    // Neither is text anyone can read: no fabricated pass, no fabricated fail,
    // and the result says nothing was measured rather than reading as a pass.
    expect(result.rawData).toMatchObject({ passing: 0, total: 0 });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe('info');
    expect(result.findings[0].message).toMatch(/no contrast was measured/i);
  });

  it('a computed transparent background does not make an element a card', () => {
    const card = (id: string, radius: string, y: number) =>
      makeElement(
        id,
        'generic',
        { x: 0, y, width: 300, height: 200 },
        {
          backgroundColor: 'rgba(0, 0, 0, 0)',
          borderRadius: radius,
          paddingTop: '16px',
          paddingLeft: '16px',
        }
      );
    const result = cardConsistency(
      [card('a', '2px', 0), card('b', '40px', 210), card('c', '8px', 420)],
      DEFAULT_VIEWPORT
    );
    expect(result.findings).toEqual([]);
    expect(result.score).toBe(100);
  });

  it('wcagContrastCompliance measures a partly transparent foreground as it renders', () => {
    // 50% black on white renders as grey (~3.98:1): it fails AA.
    const elements = [
      makeElement(
        'half',
        'paragraph',
        { x: 0, y: 0, width: 200, height: 20 },
        {
          color: 'rgba(0, 0, 0, 0.5)',
          backgroundColor: '#ffffff',
        }
      ),
    ];
    const result = wcagContrastCompliance(elements, DEFAULT_VIEWPORT);
    expect(result.score).toBe(0);
    expect(result.findings[0].elementIds).toEqual(['half']);
  });

  it('a computed transparent background does not make an element a container', () => {
    const box = makeElement(
      'box',
      'generic',
      { x: 0, y: 0, width: 600, height: 400 },
      {
        backgroundColor: 'rgba(0, 0, 0, 0)',
        borderRadius: '8px',
        paddingTop: '16px',
        paddingLeft: '16px',
      }
    );
    const solid = makeElement(
      'solid',
      'generic',
      { x: 0, y: 0, width: 600, height: 400 },
      {
        backgroundColor: '#f5f5f5',
        borderRadius: '8px',
        paddingTop: '16px',
        paddingLeft: '16px',
      }
    );
    // A tiny child in a big container is inefficient; a non-container is not
    // judged at all.
    const child = makeElement('child', 'paragraph', { x: 10, y: 10, width: 20, height: 10 });
    const transparent = containerEfficiency([box, child], DEFAULT_VIEWPORT);
    const painted = containerEfficiency([solid, child], DEFAULT_VIEWPORT);
    expect(transparent.score).toBe(100);
    expect(transparent.findings).toEqual([]);
    expect(painted.score).toBeLessThan(100);
  });

  it('wcagContrastCompliance composites a partly transparent background over its assumed white page, and counts the assumption', () => {
    const elements = [
      // A dark translucent background over white renders mid grey, and #767676
      // on that grey fails (~1.1:1). On the raw channels (#767676 on black,
      // ~4.6:1) it would pass, so the composite is what decides.
      makeElement(
        'veil',
        'paragraph',
        { x: 0, y: 0, width: 200, height: 20 },
        {
          color: '#767676',
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
        }
      ),
      makeElement(
        'own',
        'paragraph',
        { x: 0, y: 30, width: 200, height: 20 },
        {
          color: '#000000',
          backgroundColor: '#ffffff',
        }
      ),
    ];
    const result = wcagContrastCompliance(elements, DEFAULT_VIEWPORT);
    expect(result.findings[0].elementIds).toEqual(['veil']);
    expect(result.rawData).toMatchObject({ passing: 1, total: 2, assumedWhiteBackdrop: 1 });
  });

  it('customPropertyConsistency drops a parsed colour that is not shown, and keeps an unreadable one', () => {
    const el = (id: string, color: string, backgroundColor: string) =>
      makeElement(id, 'generic', { x: 0, y: 0, width: 10, height: 10 }, { color, backgroundColor });
    const result = customPropertyConsistency(
      [
        el('a', 'rgb(0 0 0 / 0)', 'rgba(255, 255, 255, 0.05)'),
        el('b', 'color(display-p3 1 0 0)', ''),
      ],
      DEFAULT_VIEWPORT
    );
    // Only the display-p3 value is a colour choice (hardcoded: no var()).
    expect(result.rawData).toMatchObject({ totalColorProps: 1, hardcodedColors: 1 });
  });

  it('wcagContrastCompliance measures very faint text (it fails) instead of skipping it', () => {
    const elements = [
      makeElement(
        'ghost',
        'paragraph',
        { x: 0, y: 0, width: 200, height: 20 },
        {
          color: 'rgba(0, 0, 0, 0.05)',
          backgroundColor: '#ffffff',
        }
      ),
    ];
    const result = wcagContrastCompliance(elements, DEFAULT_VIEWPORT);
    expect(result.rawData).toMatchObject({ passing: 0, total: 1 });
    expect(result.findings[0].elementIds).toEqual(['ghost']);
  });

  it('wcagContrastCompliance does not measure text over a present but unreadable background', () => {
    const elements = [
      makeElement(
        'p3',
        'paragraph',
        { x: 0, y: 0, width: 200, height: 20 },
        {
          color: '#ffffff',
          backgroundColor: 'color(display-p3 0.1 0.1 0.1)',
        }
      ),
      makeElement(
        'own',
        'paragraph',
        { x: 0, y: 30, width: 200, height: 20 },
        {
          color: '#000000',
          backgroundColor: '#ffffff',
        }
      ),
    ];
    const result = wcagContrastCompliance(elements, DEFAULT_VIEWPORT);
    // White text on a dark p3 panel is not scored as white-on-white.
    expect(result.findings).toEqual([]);
    expect(result.rawData).toMatchObject({ passing: 1, total: 1, unreadableBackground: 1 });
  });

  it('evaluateQuality refuses a custom context threshold outside 0-100 (every transport)', () => {
    const ctx = (thresholds: { good: number; warning: number }) => ({
      name: 'mine',
      description: '',
      metrics: { contentOverflow: { thresholds } },
    });
    // good above 100; warning below 0; good below warning (a warning above 100
    // is implied by the other two, so it has no case of its own).
    for (const t of [
      { good: 101, warning: 50 },
      { good: 90, warning: -1 },
      { good: 40, warning: 80 },
    ]) {
      expect(() => evaluateQuality([], DEFAULT_VIEWPORT, ctx(t))).toThrow(/from 0 to 100/);
    }
    expect(() =>
      evaluateQuality([], DEFAULT_VIEWPORT, ctx({ good: 90, warning: 70 }))
    ).not.toThrow();
  });

  it('evaluateQuality reads a null weight or threshold as not given, and refuses an unusable weight', () => {
    const ctx = (config: Record<string, unknown>) => ({
      name: 'mine',
      description: '',
      metrics: { contentOverflow: config },
    });
    expect(() =>
      evaluateQuality([], DEFAULT_VIEWPORT, ctx({ thresholds: null }) as never)
    ).not.toThrow();
    expect(() =>
      evaluateQuality([], DEFAULT_VIEWPORT, ctx({ weight: null }) as never)
    ).not.toThrow();
    for (const weight of [-1, Number.POSITIVE_INFINITY, Number.NaN, 'heavy']) {
      expect(() => evaluateQuality([], DEFAULT_VIEWPORT, ctx({ weight }) as never)).toThrow(
        /weight a finite number >= 0/
      );
    }
    expect(() =>
      evaluateQuality([], DEFAULT_VIEWPORT, ctx({ thresholds: 'high' }) as never)
    ).toThrow(/from 0 to 100/);
  });

  it('wcagContrastCompliance reads a CSS-wide keyword background as no background', () => {
    const elements = ['unset', 'REVERT', 'Inherit', 'none'].map((backgroundColor, i) =>
      makeElement(
        `k${i}`,
        'paragraph',
        { x: 0, y: i * 30, width: 200, height: 20 },
        {
          color: '#000000',
          backgroundColor,
        }
      )
    );
    const result = wcagContrastCompliance(elements, DEFAULT_VIEWPORT);
    expect(result.rawData).toMatchObject({
      total: 4,
      unreadableBackground: 0,
      assumedWhiteBackdrop: 4,
    });
  });

  it('wcagContrastCompliance does not measure a currentcolor background against a white page', () => {
    const elements = [
      makeElement(
        'cc',
        'paragraph',
        { x: 0, y: 0, width: 200, height: 20 },
        {
          color: '#ffffff',
          backgroundColor: 'currentcolor',
        }
      ),
    ];
    const result = wcagContrastCompliance(elements, DEFAULT_VIEWPORT);
    expect(result.rawData).toMatchObject({ total: 0, unreadableBackground: 1 });
    // The note names the real reason nothing was measured.
    expect(result.findings[0].message).toMatch(
      /1 text element\(s\) sit over a background that could not be read/
    );
  });

  it('evaluateQuality refuses a malformed custom context shape (the native path has no other check)', () => {
    const bad: unknown[] = [
      { name: 'x' },
      { name: 'x', metrics: { contentOverflow: 5 } },
      { name: 'x', metrics: { contentOverflow: null } },
      { name: 'x', metrics: { contentOverflow: { enabled: 'false' } } },
      // a typo'd metric id, and a good bar below the warning bar
      { name: 'x', metrics: { contentOverlow: { enabled: false } } },
      { name: 'x', metrics: { contentOverflow: { thresholds: { good: 40, warning: 80 } } } },
    ];
    for (const ctx of bad) {
      expect(() => evaluateQuality([], DEFAULT_VIEWPORT, ctx as never)).toThrow(/Quality context/);
    }
  });

  it('every built-in quality context passes the shape rule', () => {
    for (const context of Object.values(BUILT_IN_CONTEXTS)) {
      expect(qualityContextProblem(context), context.name).toBeNull();
    }
  });
});
