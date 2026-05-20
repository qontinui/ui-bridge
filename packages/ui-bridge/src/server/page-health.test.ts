/**
 * Page Health Analyzer Tests
 *
 * Verifies that `diagnosePageHealth` produces the same shape and severity
 * rollups as the runner's `ui_bridge_page_health_handler` (in
 * `qontinui-runner/src-tauri/src/mcp/ui_bridge/screenshots.rs`).
 *
 * Pure-data unit tests — no registry / DOM / relay; the analyzer takes a
 * plain DiscoveredElement[] and returns a structured report. The runner
 * computes the same heuristics on the same shape from the result of an
 * internal `discover` call.
 */

import { describe, it, expect } from 'vitest';
import { diagnosePageHealth } from './page-health';
import type { DiscoveredElement } from '../control';

// ----------------------------------------------------------------------------
// Test helpers — element fixtures
// ----------------------------------------------------------------------------

interface Overrides {
  id?: string;
  type?: string;
  category?: 'interactive' | 'content' | 'media';
  classes?: string[];
  text?: string;
  visible?: boolean;
  enabled?: boolean;
  rect?: { x: number; y: number; width: number; height: number };
}

function el(overrides: Overrides = {}): DiscoveredElement {
  const {
    id = `el-${Math.random().toString(36).slice(2, 8)}`,
    type = 'button',
    category = 'interactive',
    classes = [],
    text = '',
    visible = true,
    enabled = true,
    rect = { x: 0.1, y: 0.3, width: 0.2, height: 0.1 },
  } = overrides;

  return {
    id,
    type,
    tagName: type,
    actions: ['click'],
    registered: true,
    category,
    classes,
    state: {
      visible,
      enabled,
      focused: false,
      normalizedRect: rect,
      textContent: text,
    } as DiscoveredElement['state'],
  };
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('diagnosePageHealth', () => {
  it('returns OK summary on a healthy mix of elements across regions', () => {
    // Mix of regions + types + coverage to clear every check at OK.
    // Coverage threshold is < 30% → push the content area > 30% via two
    // wide content panels that span enough of both halves to keep the
    // left/right-imbalance check happy.
    const elements: DiscoveredElement[] = [
      // Header
      el({ id: 'h1', rect: { x: 0.25, y: 0.0, width: 0.5, height: 0.07 } }),
      // Sidebar
      el({ id: 's1', rect: { x: 0.0, y: 0.2, width: 0.15, height: 0.3 } }),
      el({ id: 's2', rect: { x: 0.0, y: 0.55, width: 0.15, height: 0.3 } }),
      // Content (need >= 3 for layout OK and varied types for diversity OK)
      el({
        id: 'c1',
        type: 'input',
        rect: { x: 0.25, y: 0.15, width: 0.6, height: 0.15 },
      }),
      el({
        id: 'c2',
        type: 'paragraph',
        category: 'content',
        rect: { x: 0.25, y: 0.35, width: 0.6, height: 0.2 },
      }),
      el({
        id: 'c3',
        type: 'image',
        category: 'media',
        rect: { x: 0.25, y: 0.6, width: 0.6, height: 0.2 },
      }),
      el({
        id: 'c4',
        type: 'link',
        rect: { x: 0.25, y: 0.85, width: 0.6, height: 0.1 },
      }),
    ];

    const r = diagnosePageHealth(elements);
    expect(r.summary).toBe('OK');
    expect(r.element_count).toBe(7);
    expect(r.visible_count).toBe(7);
    expect(r.findings.length).toBe(6);
    expect(r.heatmap).toHaveLength(20);
    expect(r.heatmap[0]).toHaveLength(20);
  });

  it('flags CRITICAL spatial coverage when nearly empty', () => {
    const elements: DiscoveredElement[] = [
      el({
        rect: { x: 0.4, y: 0.4, width: 0.02, height: 0.02 },
      }),
    ];
    const r = diagnosePageHealth(elements);
    const spatial = r.findings.find((f) => f.check === 'spatial_coverage')!;
    expect(spatial.severity).toBe('CRITICAL');
    expect(r.summary).toBe('CRITICAL');
  });

  it('flags CRITICAL when right half empty but left has content (sidebar-only layout)', () => {
    // Coverage above the 15% / 30% thresholds but lopsided left-only —
    // the analyzer is supposed to override severity to CRITICAL on this
    // signal even when total coverage is fine (matches runner step 2).
    const elements: DiscoveredElement[] = [
      el({ rect: { x: 0.0, y: 0.1, width: 0.3, height: 0.4 } }),
      el({ rect: { x: 0.05, y: 0.55, width: 0.25, height: 0.4 } }),
    ];
    const r = diagnosePageHealth(elements);
    const spatial = r.findings.find((f) => f.check === 'spatial_coverage')!;
    expect(spatial.severity).toBe('CRITICAL');
  });

  it('flags CRITICAL layout_regions when content region is empty', () => {
    // All elements in sidebar (cx < 0.2)
    const elements: DiscoveredElement[] = [
      el({ rect: { x: 0.05, y: 0.2, width: 0.1, height: 0.1 } }),
      el({ rect: { x: 0.05, y: 0.4, width: 0.1, height: 0.1 } }),
    ];
    const r = diagnosePageHealth(elements);
    const layout = r.findings.find((f) => f.check === 'layout_regions')!;
    expect(layout.severity).toBe('CRITICAL');
    expect(layout.data.sidebar).toBe(2);
    expect(layout.data.content).toBe(0);
  });

  it('flags CRITICAL on error text signals and ignores skip-text types', () => {
    const elements: DiscoveredElement[] = [
      el({
        id: 'err',
        type: 'paragraph',
        category: 'content',
        text: 'An error occurred while loading data',
        rect: { x: 0.3, y: 0.3, width: 0.3, height: 0.1 },
      }),
      // A button with error-phrase text — must be SKIPPED by the scanner
      // (buttons/links/tabs/menuitem don't count as error signals).
      el({
        id: 'btn',
        type: 'button',
        text: 'Retry — failed to load',
        rect: { x: 0.3, y: 0.5, width: 0.2, height: 0.05 },
      }),
    ];
    const r = diagnosePageHealth(elements);
    const text = r.findings.find((f) => f.check === 'text_signals')!;
    expect(text.severity).toBe('CRITICAL');
    expect((text.data.errors as string[]).length).toBe(1);
    expect((text.data.errors as string[])[0]).toContain('error occurred');
  });

  it('flags WARNING on CSS class loading signals (scanned on all types)', () => {
    // CSS-class signals scanned on ALL elements including buttons — so a
    // button.spinner-icon counts even though button text is skipped.
    const elements: DiscoveredElement[] = [
      el({ id: 'spinner-btn', classes: ['spinner', 'animate-pulse'] }),
      el({
        id: 'c1',
        type: 'paragraph',
        category: 'content',
        rect: { x: 0.3, y: 0.3, width: 0.3, height: 0.1 },
      }),
      el({
        id: 'c2',
        type: 'paragraph',
        category: 'content',
        rect: { x: 0.3, y: 0.5, width: 0.3, height: 0.1 },
      }),
      el({
        id: 'c3',
        type: 'paragraph',
        category: 'content',
        rect: { x: 0.3, y: 0.7, width: 0.3, height: 0.1 },
      }),
    ];
    const r = diagnosePageHealth(elements);
    const text = r.findings.find((f) => f.check === 'text_signals')!;
    expect(text.severity).toBe('WARNING');
    expect((text.data.css_signals as string[]).length).toBeGreaterThan(0);
  });

  it('flags WARNING on > 50% disabled interactive elements', () => {
    const elements: DiscoveredElement[] = [
      el({ id: 'b1', enabled: false }),
      el({ id: 'b2', enabled: false }),
      el({ id: 'b3', enabled: true }),
    ];
    const r = diagnosePageHealth(elements);
    const inter = r.findings.find((f) => f.check === 'interactive_readiness')!;
    expect(inter.severity).toBe('WARNING');
    expect(inter.data.total).toBe(3);
    expect(inter.data.disabled).toBe(2);
  });

  it('flags WARNING on zero-size visible elements', () => {
    const elements: DiscoveredElement[] = [
      el({
        id: 'zero',
        rect: { x: 0.5, y: 0.5, width: 0, height: 0 },
      }),
      el({
        id: 'normal',
        rect: { x: 0.3, y: 0.3, width: 0.3, height: 0.4 },
      }),
      el({
        id: 'normal2',
        rect: { x: 0.3, y: 0.5, width: 0.3, height: 0.2 },
      }),
      el({
        id: 'normal3',
        rect: { x: 0.3, y: 0.7, width: 0.3, height: 0.2 },
      }),
    ];
    const r = diagnosePageHealth(elements);
    const anomalies = r.findings.find((f) => f.check === 'visual_anomalies')!;
    expect(anomalies.severity).toBe('WARNING');
    expect(anomalies.data.zero_size).toBe(1);
  });

  it('flags WARNING when > 5 elements are all navigation types', () => {
    // 6 buttons — all navigation types, no other variety
    const elements: DiscoveredElement[] = Array.from({ length: 6 }, (_, i) =>
      el({
        id: `b${i}`,
        type: 'button',
        rect: { x: 0.3 + i * 0.02, y: 0.3 + i * 0.05, width: 0.1, height: 0.05 },
      })
    );
    const r = diagnosePageHealth(elements);
    const diversity = r.findings.find((f) => f.check === 'element_diversity')!;
    expect(diversity.severity).toBe('WARNING');
    expect(diversity.detail).toContain('navigation-only');
  });

  it('excludes hidden elements (state.visible=false) from spatial + visible_count', () => {
    const elements: DiscoveredElement[] = [
      el({ id: 'visible-1', rect: { x: 0.3, y: 0.3, width: 0.3, height: 0.3 } }),
      el({ id: 'hidden-1', visible: false, rect: { x: 0.5, y: 0.5, width: 0.5, height: 0.5 } }),
    ];
    const r = diagnosePageHealth(elements);
    expect(r.element_count).toBe(2);
    expect(r.visible_count).toBe(1);
  });

  it('always returns exactly the six expected check categories', () => {
    const r = diagnosePageHealth([]);
    const checks = r.findings.map((f) => f.check);
    expect(checks).toEqual([
      'spatial_coverage',
      'layout_regions',
      'element_diversity',
      'text_signals',
      'interactive_readiness',
      'visual_anomalies',
    ]);
  });

  it('handles empty element list with sensible defaults', () => {
    const r = diagnosePageHealth([]);
    expect(r.element_count).toBe(0);
    expect(r.visible_count).toBe(0);
    expect(r.summary).toBe('CRITICAL'); // layout_regions content==0
    expect(r.heatmap.every((row) => row === '.'.repeat(20))).toBe(true);
  });
});
