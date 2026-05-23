import { describe, it, expect } from 'vitest';
import { NativeUIBridgeRegistry } from '../../core/registry';
import { DefaultNativeActionExecutor } from '../../control/action-executor';
import { NativeUIBridgeServer } from '../http-server';
import { diagnosePageHealth, type PageHealthElement } from '../page-health';
import type { NativeElementRef } from '../../core/types';

/**
 * Coverage for `POST /ui-bridge/control/page-health` (mobile analog of the
 * runner/web `control/page-health` route). The analyzer is platform-neutral
 * in output shape (`summary`/`findings`/`heatmap`/`element_count`/
 * `visible_count`) but adapts to mobile's pixel-layout +
 * no-CSS-classes reality.
 *
 * Tests cover:
 *   1. Healthy populated page → summary='OK'
 *   2. Sidebar-only / right-half-empty → summary='CRITICAL' via spatial check
 *   3. Empty content area → summary='CRITICAL' via layout_regions check
 *   4. Error text in a content element → summary='CRITICAL' via text_signals
 *   5. End-to-end HTTP via NativeUIBridgeServer.handleRequest
 *   6. body.viewport override path
 */

function makeRef(): React.RefObject<NativeElementRef> {
  return { current: {} as NativeElementRef };
}

const VIEWPORT = { width: 400, height: 800 };

function el(
  type: string,
  partial: Partial<PageHealthElement['state']> = {}
): PageHealthElement {
  return {
    type,
    state: {
      mounted: true,
      visible: true,
      enabled: true,
      focused: false,
      layout: null,
      ...partial,
    },
  };
}

function laidOut(
  type: string,
  pageX: number,
  pageY: number,
  width: number,
  height: number,
  extra: Partial<PageHealthElement['state']> = {}
): PageHealthElement {
  return el(type, {
    layout: { x: pageX, y: pageY, width, height, pageX, pageY },
    ...extra,
  });
}

describe('diagnosePageHealth (mobile)', () => {
  it('reports OK on a healthy populated page', () => {
    // A typical mobile screen: header strip + several content cards spread
    // across the full viewport width. Enough coverage to clear the
    // spatial / layout_regions / element_diversity heuristics.
    const elements: PageHealthElement[] = [
      laidOut('text', 0, 0, VIEWPORT.width, 60), // header
      laidOut('button', 16, 100, VIEWPORT.width - 32, 60, { textContent: 'Continue' }),
      laidOut('text', 16, 180, VIEWPORT.width - 32, 80, {
        textContent: 'Welcome to the app',
      }),
      laidOut('list', 0, 280, VIEWPORT.width, 300),
      laidOut('listItem', 16, 300, VIEWPORT.width - 32, 80, { textContent: 'Row A' }),
      laidOut('listItem', 16, 400, VIEWPORT.width - 32, 80, { textContent: 'Row B' }),
      laidOut('listItem', 16, 500, VIEWPORT.width - 32, 80, { textContent: 'Row C' }),
    ];

    const report = diagnosePageHealth(elements, VIEWPORT);

    expect(report.summary).toBe('OK');
    expect(report.element_count).toBe(7);
    expect(report.visible_count).toBe(7);
    expect(report.heatmap).toHaveLength(20);
    expect(report.heatmap[0]).toHaveLength(20);
    // Layout regions check — content elements should dominate.
    const layoutFinding = report.findings.find((f) => f.check === 'layout_regions');
    expect(layoutFinding?.severity).toBe('OK');
    expect((layoutFinding?.data as { content: number }).content).toBeGreaterThan(0);
  });

  it('flags sidebar-only / empty-right-half as CRITICAL', () => {
    // All elements clustered in the left 15% of the viewport — a broken
    // desktop-style layout escaping into mobile. The spatial_coverage
    // heuristic should fire CRITICAL via the right_half_pct<5 + left>20 rule.
    const sidebarW = Math.floor(VIEWPORT.width * 0.15);
    const elements: PageHealthElement[] = [];
    for (let i = 0; i < 10; i++) {
      elements.push(laidOut('button', 0, i * 60, sidebarW, 50));
    }

    const report = diagnosePageHealth(elements, VIEWPORT);

    const spatial = report.findings.find((f) => f.check === 'spatial_coverage');
    expect(spatial?.severity).toBe('CRITICAL');
    const data = spatial?.data as { left_half_pct: number; right_half_pct: number };
    expect(data.left_half_pct).toBeGreaterThan(20);
    expect(data.right_half_pct).toBeLessThan(5);
    expect(report.summary).toBe('CRITICAL');
  });

  it('flags zero-content layout_regions as CRITICAL', () => {
    // Only a header strip — no content elements. layout_regions.content=0
    // should escalate to CRITICAL.
    const elements: PageHealthElement[] = [
      // Two header-strip elements (cy < 0.08, so y center < 64px on an 800px tall viewport).
      laidOut('text', 0, 0, VIEWPORT.width, 40),
      laidOut('text', 0, 40, VIEWPORT.width, 20),
    ];

    const report = diagnosePageHealth(elements, VIEWPORT);

    const layout = report.findings.find((f) => f.check === 'layout_regions');
    expect(layout?.severity).toBe('CRITICAL');
    expect((layout?.data as { content: number }).content).toBe(0);
    expect(report.summary).toBe('CRITICAL');
  });

  it('flags error-phrase text content as CRITICAL', () => {
    // The text_signals heuristic skips button/link/tab/menuitem text (to
    // avoid false positives on a "Retry" or "Error logs" button label),
    // so the error phrase has to live on a non-skipped type — e.g. a text
    // element. We also need a couple of normal content elements to clear
    // the layout_regions check, so the only CRITICAL is from text_signals.
    const elements: PageHealthElement[] = [
      laidOut('text', 16, 100, 368, 40, { textContent: 'Welcome' }),
      laidOut('text', 16, 200, 368, 40, { textContent: 'Connection Error occurred' }),
      laidOut('button', 16, 300, 368, 50, { textContent: 'Retry' }),
      laidOut('list', 0, 400, VIEWPORT.width, 200),
      laidOut('listItem', 16, 420, 368, 60, { textContent: 'Item one' }),
    ];

    const report = diagnosePageHealth(elements, VIEWPORT);

    const text = report.findings.find((f) => f.check === 'text_signals');
    expect(text?.severity).toBe('CRITICAL');
    const data = text?.data as { errors: string[]; css_signals: string[] };
    expect(data.errors).toContain('Connection Error occurred');
    // CSS-class scanning isn't applicable on RN; field should be present + empty.
    expect(data.css_signals).toEqual([]);
    expect(report.summary).toBe('CRITICAL');
  });

  it('respects state.visible (skips hidden elements from spatial + visual checks)', () => {
    // One on-screen card + several hidden elements. The hidden ones should
    // count toward `element_count` but NOT `visible_count`, and shouldn't
    // contribute to the spatial heatmap.
    const elements: PageHealthElement[] = [
      laidOut('text', 0, 0, VIEWPORT.width, VIEWPORT.height), // fills the viewport
      el('button', { visible: false }),
      el('text', { visible: false }),
    ];

    const report = diagnosePageHealth(elements, VIEWPORT);

    expect(report.element_count).toBe(3);
    expect(report.visible_count).toBe(1);
    const spatial = report.findings.find((f) => f.check === 'spatial_coverage');
    expect((spatial?.data as { coverage_pct: number }).coverage_pct).toBe(100);
  });

  describe('visual_anomalies outside_viewport: horizontal-overflow only (fold semantics)', () => {
    // Regression for the 0.6.6 false-positive on /settings, where every
    // scrollable settings row whose `pageY > window.height` was flagged.
    // ScrollView/FlatList content below or above the fold is legitimate;
    // only horizontal overflow (no horizontal scroll on mobile) is an
    // anomaly the user can't reach.

    function anomaliesFinding(elements: PageHealthElement[]) {
      const report = diagnosePageHealth(elements, VIEWPORT);
      return {
        report,
        anomalies: report.findings.find((f) => f.check === 'visual_anomalies'),
      };
    }

    // We need some on-screen content to clear the layout_regions /
    // spatial_coverage checks so the report's summary reflects ONLY the
    // visual_anomalies finding for these assertions.
    function withContentBacklog(extra: PageHealthElement[]): PageHealthElement[] {
      return [
        laidOut('text', 0, 0, VIEWPORT.width, 60),
        laidOut('text', 16, 100, VIEWPORT.width - 32, 80, {
          textContent: 'Welcome',
        }),
        laidOut('list', 0, 200, VIEWPORT.width, 400),
        laidOut('listItem', 16, 220, VIEWPORT.width - 32, 60, {
          textContent: 'Row A',
        }),
        laidOut('listItem', 16, 290, VIEWPORT.width - 32, 60, {
          textContent: 'Row B',
        }),
        laidOut('listItem', 16, 360, VIEWPORT.width - 32, 60, {
          textContent: 'Row C',
        }),
        ...extra,
      ];
    }

    it('does NOT flag a below-fold element (y=1.5, scrollable content)', () => {
      // pageY=1200 on an 800px-tall viewport → normalized y=1.5, well below the
      // fold but reachable by scrolling. Must NOT count toward outside_viewport.
      const belowFold = laidOut('text', 16, 1200, VIEWPORT.width - 32, 80, {
        textContent: 'Below the fold',
      });
      const { report, anomalies } = anomaliesFinding(withContentBacklog([belowFold]));

      expect((anomalies?.data as { outside_viewport: number }).outside_viewport).toBe(0);
      expect(anomalies?.severity).toBe('OK');
      expect(report.summary).toBe('OK');
    });

    it('does NOT flag an above-fold element (y=-0.5, scrolled past)', () => {
      // pageY=-400 on an 800px-tall viewport → normalized y=-0.5, above the
      // visible area (user scrolled past it). Reachable by scrolling back, so
      // not an anomaly.
      const aboveFold = laidOut('text', 16, -400, VIEWPORT.width - 32, 80, {
        textContent: 'Above the fold',
      });
      const { report, anomalies } = anomaliesFinding(withContentBacklog([aboveFold]));

      expect((anomalies?.data as { outside_viewport: number }).outside_viewport).toBe(0);
      expect(anomalies?.severity).toBe('OK');
      expect(report.summary).toBe('OK');
    });

    it('flags an off-screen-RIGHT element (x=1.5) as outside_viewport', () => {
      // pageX=600 on a 400px-wide viewport → normalized x=1.5, past the right
      // edge. There's no horizontal scroll on a typical mobile screen so the
      // user can't reach this — meaningful anomaly.
      const offRight = laidOut('button', 600, 200, 40, 40, {
        textContent: 'Hidden right',
      });
      const { anomalies } = anomaliesFinding(withContentBacklog([offRight]));

      expect((anomalies?.data as { outside_viewport: number }).outside_viewport).toBe(1);
      expect(anomalies?.severity).toBe('WARNING');
    });

    it('flags an off-screen-LEFT element (x=-0.5) as outside_viewport', () => {
      // pageX=-200 on a 400px-wide viewport → normalized x+width = -0.4 (still
      // < 0). Off the left edge, unreachable on mobile.
      const offLeft = laidOut('button', -200, 200, 40, 40, {
        textContent: 'Hidden left',
      });
      const { anomalies } = anomaliesFinding(withContentBacklog([offLeft]));

      expect((anomalies?.data as { outside_viewport: number }).outside_viewport).toBe(1);
      expect(anomalies?.severity).toBe('WARNING');
    });

    it('regression: long scrollable settings page reports OK (all rows below fold)', () => {
      // The exact failure shape from iter-4 manual test: 11 settings rows
      // stacked beyond the visible 800px fold. None should count as
      // outside_viewport. There also needs to be at least one above-fold
      // content element so layout_regions clears OK.
      const elements: PageHealthElement[] = [
        laidOut('text', 0, 0, VIEWPORT.width, 60), // header
        laidOut('text', 16, 100, VIEWPORT.width - 32, 40, {
          textContent: 'Settings',
        }),
      ];
      // 11 settings rows starting at y=200 with 80px each = bottom at 1080,
      // i.e. y=200..1080 (some on-screen, most below fold).
      for (let i = 0; i < 11; i++) {
        elements.push(
          laidOut('listItem', 16, 200 + i * 80, VIEWPORT.width - 32, 70, {
            textContent: `Setting ${i + 1}`,
          })
        );
      }

      const report = diagnosePageHealth(elements, VIEWPORT);
      const anomalies = report.findings.find((f) => f.check === 'visual_anomalies');

      expect((anomalies?.data as { outside_viewport: number }).outside_viewport).toBe(0);
      expect(anomalies?.severity).toBe('OK');
      expect(report.summary).toBe('OK');
    });
  });

  it('counts disabled interactive elements via type-based detection (no `category` field)', () => {
    // Mobile elements have `type` instead of `category`. The analyzer's
    // INTERACTIVE_TYPES set must catch them so the disabled-ratio check
    // still fires.
    const elements: PageHealthElement[] = [
      laidOut('button', 16, 100, 368, 50, { enabled: false }),
      laidOut('button', 16, 160, 368, 50, { enabled: false }),
      laidOut('button', 16, 220, 368, 50, { enabled: false }),
      laidOut('button', 16, 280, 368, 50, { enabled: true }),
      laidOut('text', 16, 340, 368, 50, { textContent: 'caption' }),
    ];

    const report = diagnosePageHealth(elements, VIEWPORT);

    const interactive = report.findings.find((f) => f.check === 'interactive_readiness');
    expect(interactive?.severity).toBe('WARNING');
    expect(interactive?.data).toEqual({ total: 4, disabled: 3 });
  });
});

describe('POST /ui-bridge/control/page-health — routing + viewport handling', () => {
  function buildServer() {
    const registry = new NativeUIBridgeRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    const server = new NativeUIBridgeServer(registry, executor);
    return { registry, server };
  }

  it('returns a structured report end-to-end via handleRequest', async () => {
    const { registry, server } = buildServer();

    registry.registerElement('header', makeRef(), { type: 'text' });
    registry.updateElementState('header', {
      visible: true,
      layout: { x: 0, y: 0, width: 400, height: 60, pageX: 0, pageY: 0 },
    });
    registry.registerElement('card', makeRef(), { type: 'text' });
    registry.updateElementState('card', {
      visible: true,
      textContent: 'Hello world',
      layout: { x: 16, y: 120, width: 368, height: 200, pageX: 16, pageY: 120 },
    });

    const res = await server.handleRequest({
      method: 'POST',
      path: '/ui-bridge/control/page-health',
      headers: { 'content-type': 'application/json' },
      query: {},
      body: { viewport: { width: 400, height: 800 } },
    });

    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body) as {
      success: boolean;
      data: {
        summary: string;
        findings: Array<{ check: string; severity: string }>;
        heatmap: string[];
        element_count: number;
        visible_count: number;
      };
    };
    expect(parsed.success).toBe(true);
    expect(parsed.data.element_count).toBe(2);
    expect(parsed.data.visible_count).toBe(2);
    expect(parsed.data.findings.map((f) => f.check)).toEqual([
      'spatial_coverage',
      'layout_regions',
      'element_diversity',
      'text_signals',
      'interactive_readiness',
      'visual_anomalies',
    ]);
    expect(parsed.data.heatmap).toHaveLength(20);
  });

  it('honors body.viewport over any injected viewportProvider', async () => {
    // body.viewport is priority-1 — explicit input wins over the host's
    // injected Dimensions getter. No react-native dep needed in this code
    // path (the test server doesn't pass a viewportProvider).
    const { registry, server } = buildServer();
    registry.registerElement('x', makeRef(), { type: 'text' });
    registry.updateElementState('x', {
      visible: true,
      layout: { x: 0, y: 0, width: 50, height: 50, pageX: 0, pageY: 0 },
    });

    const tinyViewport = { width: 100, height: 100 };
    const res = await server.handleRequest({
      method: 'POST',
      path: '/ui-bridge/control/page-health',
      headers: { 'content-type': 'application/json' },
      query: {},
      body: { viewport: tinyViewport },
    });

    const parsed = JSON.parse(res.body) as {
      data: { findings: Array<{ check: string; data: { coverage_pct?: number } }> };
    };
    const spatial = parsed.data.findings.find((f) => f.check === 'spatial_coverage');
    // A 50x50 element on a 100x100 viewport covers ~25% of the grid.
    expect(spatial?.data.coverage_pct).toBe(25);
  });

  it('also serves the route on GET (skill-friendly empty-body calls)', async () => {
    const { server } = buildServer();
    const res = await server.handleRequest({
      method: 'GET',
      path: '/ui-bridge/control/page-health',
      headers: {},
      query: {},
    });
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body) as { success: boolean; data: unknown };
    expect(parsed.success).toBe(true);
    expect(parsed.data).toBeDefined();
  });

  it('regression: handlers.ts must not import or require react-native', async () => {
    // 0.6.3 and 0.6.4 both crashed the host RN app on first call to
    // `/control/page-health`. The pattern that failed:
    //   try { require('react-native') } catch { ... }
    // both inline in the async handler (0.6.3) AND extracted into a sync
    // helper called from the handler (0.6.4). Metro/Hermes raised
    // `unknownModuleError` past every try/catch and tore down the JS thread
    // — blank screen, React tree destroyed, C++ HTTP server still alive.
    //
    // The same latent failure mode existed in `design-handlers.ts` (verified
    // by hitting `POST /design/responsive` on 0.6.4 — it killed the JS host
    // identically). Both files have been moved off the require pattern;
    // viewport is now an INJECTED dependency from `UIBridgeNativeProvider`,
    // which holds the only react-native import in the runtime path.
    //
    // This test would fail at import time if `handlers.ts` re-acquired any
    // `react-native` reference (static OR require()) — vitest's rolldown
    // parser rejects react-native's Flow syntax, so the whole file would
    // fail to load.
    const { server } = buildServer();
    const res = await server.handleRequest({
      method: 'POST',
      path: '/ui-bridge/control/page-health',
      headers: { 'content-type': 'application/json' },
      query: {},
      body: {},
    });
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body) as { success: boolean; data: unknown };
    expect(parsed.success).toBe(true);
    expect(parsed.data).toBeDefined();
  });

  it('uses injected viewportProvider when body.viewport is absent', async () => {
    // The host app injects a viewportProvider via createNativeServer({
    //   viewportProvider: () => Dimensions.get('window')
    // }). The handler reads it when body.viewport is missing.
    const registry = new NativeUIBridgeRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    const server = new NativeUIBridgeServer(registry, executor, {
      viewportProvider: () => ({ width: 200, height: 400 }),
    });

    registry.registerElement('full-bleed', makeRef(), { type: 'text' });
    registry.updateElementState('full-bleed', {
      visible: true,
      layout: { x: 0, y: 0, width: 200, height: 400, pageX: 0, pageY: 0 },
    });

    const res = await server.handleRequest({
      method: 'POST',
      path: '/ui-bridge/control/page-health',
      headers: { 'content-type': 'application/json' },
      query: {},
      body: {},
    });

    const parsed = JSON.parse(res.body) as {
      data: { findings: Array<{ check: string; data: { coverage_pct?: number } }> };
    };
    const spatial = parsed.data.findings.find((f) => f.check === 'spatial_coverage');
    // Element fills the entire injected viewport → 100% coverage.
    expect(spatial?.data.coverage_pct).toBe(100);
  });
});
