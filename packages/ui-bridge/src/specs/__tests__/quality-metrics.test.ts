/**
 * Quality Metrics Tests — UX Category
 *
 * Tests for the 5 UX metrics: contentOverflow, aboveFoldRatio,
 * informationDensity, containerEfficiency, viewportUtilization.
 * Plus integration test for UX sub-score in the evaluator.
 */

import { describe, it, expect } from 'vitest';
import {
  contentOverflow,
  aboveFoldRatio,
  informationDensity,
  containerEfficiency,
  viewportUtilization,
  METRIC_FUNCTIONS,
} from '../quality-metrics';
import { evaluateQuality } from '../quality-evaluator';
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
// UX Sub-Score in Evaluator
// ============================================================================

describe('evaluateQuality UX sub-score', () => {
  it('computes uxScore and uxGrade in the report', () => {
    const elements = [
      makeContentElement('h', 'heading', { x: 0, y: 0, width: 400, height: 50 }),
      makeContentElement('p', 'paragraph', { x: 0, y: 60, width: 400, height: 200 }),
    ];
    const report = evaluateQuality(elements, DEFAULT_VIEWPORT, 'general');
    expect(report.uxScore).toBeGreaterThanOrEqual(0);
    expect(report.uxScore).toBeLessThanOrEqual(100);
    expect(['A', 'B', 'C', 'D', 'F']).toContain(report.uxGrade);
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
  it('contains all 27 metrics (5 UX + 22 existing)', () => {
    const keys = Object.keys(METRIC_FUNCTIONS);
    expect(keys).toHaveLength(27);
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
