/**
 * The `data-dense` quality context runs no area-density metric.
 *
 * `elementDensity` and `whitespaceRatio` score how much of the viewport the
 * registered elements cover. On a dashboard, the page `data-dense` exists for,
 * they recommended the opposite of the intent: "reduce content density" and
 * "increase padding". Under `data-dense` both are disabled, the form the
 * `accessibility` context already uses; the other contexts still run them.
 *
 * Fixtures are synthetic: two blocks that together cover 90 % of a
 * 1280 x 800 viewport, which both metrics flag.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { evaluateQuality } from '../quality-evaluator';
import { BUILT_IN_CONTEXTS } from '../quality-contexts';
import type { ElementDesignData, ExtendedComputedStyles } from '../../core/types';
import type { MetricResult, QualityEvaluationReport, ViewportDimensions } from '../quality-types';
import { executeCommand, type BridgeAccess } from '../../react/commandHandlers';
import { getGlobalRegistry, resetGlobalRegistry } from '../../core/registry';
import { createHandlers, type RegistryLike } from '../../server/handlers';
import { DefaultActionExecutor } from '../../control/action-executor';

const VIEWPORT: ViewportDimensions = { width: 1280, height: 800 };

/** Two full-width blocks, 360 px tall each: 90 % of the viewport covered. */
const BLOCK_RECTS = [
  { x: 0, y: 0, width: 1280, height: 360 },
  { x: 0, y: 380, width: 1280, height: 360 },
];

/** The recommendation each area metric gives when coverage is that high. */
const REDUCE_DENSITY = 'Consider reducing content density or increasing spacing.';
const ADD_PADDING = 'Increase padding and margins between elements.';

const AREA_METRICS = ['elementDensity', 'whitespaceRatio'] as const;

function makeStyles(): ExtendedComputedStyles {
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
  };
}

function denseFixture(): ElementDesignData[] {
  return BLOCK_RECTS.map((rect, i) => ({
    elementId: `block-${i}`,
    type: 'generic',
    rect,
    styles: makeStyles(),
  }));
}

function metric(report: QualityEvaluationReport, id: string): MetricResult {
  const found = report.metrics.find((m) => m.metricId === id);
  if (!found) throw new Error(`metric ${id} missing from the report`);
  return found;
}

/** Both area metrics are disabled, carry no finding, and add nothing to topIssues. */
function expectAreaMetricsDisabled(report: QualityEvaluationReport): void {
  for (const id of AREA_METRICS) {
    const result = metric(report, id);
    expect(result.enabled, id).toBe(false);
    expect(result.weight, id).toBe(0);
    expect(result.findings, id).toEqual([]);
  }
  const recommendations = report.topIssues.map((f) => f.recommendation);
  expect(recommendations).not.toContain(REDUCE_DENSITY);
  expect(recommendations).not.toContain(ADD_PADDING);
}

/** Both area metrics run and give their recommendation on the fixture. */
function expectAreaMetricsRun(report: QualityEvaluationReport): void {
  const density = metric(report, 'elementDensity');
  const whitespace = metric(report, 'whitespaceRatio');
  expect(density.enabled).toBe(true);
  expect(whitespace.enabled).toBe(true);
  expect(density.findings.map((f) => f.recommendation)).toContain(REDUCE_DENSITY);
  expect(whitespace.findings.map((f) => f.recommendation)).toContain(ADD_PADDING);
}

describe('data-dense quality context', () => {
  it('data-dense does not run elementDensity or whitespaceRatio', () => {
    const fixture = denseFixture();

    // The fixture is one the two metrics flag: under `general` both recommend.
    expectAreaMetricsRun(evaluateQuality(fixture, VIEWPORT, 'general'));

    const report = evaluateQuality(fixture, VIEWPORT, 'data-dense');
    expect(report.contextName).toBe('data-dense');
    expectAreaMetricsDisabled(report);
  });

  it('general, minimal and mobile still run both area metrics, with their own configuration', () => {
    const fixture = denseFixture();
    for (const name of ['general', 'minimal', 'mobile']) {
      expectAreaMetricsRun(evaluateQuality(fixture, VIEWPORT, name));
    }

    // The configuration of the two metrics in those contexts, as before this change.
    const config = (name: string) => ({
      elementDensity: BUILT_IN_CONTEXTS[name].metrics.elementDensity,
      whitespaceRatio: BUILT_IN_CONTEXTS[name].metrics.whitespaceRatio,
    });
    const defaults = { enabled: true, thresholds: { good: 80, warning: 50 } };
    expect(config('general')).toEqual({
      elementDensity: { ...defaults, weight: 0.03 },
      whitespaceRatio: { ...defaults, weight: 0.03 },
    });
    expect(config('minimal')).toEqual({
      elementDensity: { enabled: true, weight: 0.025, thresholds: { good: 85, warning: 60 } },
      whitespaceRatio: { enabled: true, weight: 0.09, thresholds: { good: 85, warning: 60 } },
    });
    expect(config('mobile')).toEqual({
      elementDensity: { ...defaults, weight: 0.03 },
      whitespaceRatio: { ...defaults, weight: 0.04 },
    });
  });

  it('the description no longer claims data-dense is lenient on density', () => {
    const { description } = BUILT_IN_CONTEXTS['data-dense'];
    expect(description).not.toMatch(/lenient on density/i);
    expect(description).toMatch(/no area-density metric/);
  });
});

describe('POST /design/evaluate with context data-dense, on both transports', () => {
  const emptyBridge: BridgeAccess = {
    elements: [],
    getElement: () => undefined,
    components: [],
    workflows: [],
  };
  let container: HTMLDivElement;

  beforeEach(() => {
    resetGlobalRegistry();
    container = document.createElement('div');
    document.body.appendChild(container);
    BLOCK_RECTS.forEach((rect, i) => {
      const el = document.createElement('div');
      el.textContent = `Block ${i}`;
      el.getBoundingClientRect = () =>
        ({
          ...rect,
          top: rect.y,
          left: rect.x,
          right: rect.x + rect.width,
          bottom: rect.y + rect.height,
          toJSON: () => rect,
        }) as DOMRect;
      container.appendChild(el);
      getGlobalRegistry().registerElement(`block-${i}`, el, { type: 'generic' });
    });
  });

  afterEach(() => {
    container.remove();
    resetGlobalRegistry();
  });

  function serverHandlers(): ReturnType<typeof createHandlers> {
    const registry = getGlobalRegistry();
    return createHandlers(
      registry as unknown as RegistryLike,
      new DefaultActionExecutor(registry) as never,
      { idleDetection: false }
    );
  }

  async function viaServer(context: string): Promise<QualityEvaluationReport> {
    const response = await serverHandlers().evaluateQuality({ context, viewport: VIEWPORT });
    expect(response.success).toBe(true);
    return response.data!;
  }

  async function viaCommand(context: string): Promise<QualityEvaluationReport> {
    return (await executeCommand(
      'evaluateQuality',
      { context, viewport: VIEWPORT },
      emptyBridge
    )) as QualityEvaluationReport;
  }

  it('createHandlers and executeCommand report both area metrics disabled with no finding', async () => {
    for (const evaluate of [viaServer, viaCommand]) {
      // Where `general` reports a score and both recommendations ...
      expectAreaMetricsRun(await evaluate('general'));
      // ... `data-dense` runs neither.
      expectAreaMetricsDisabled(await evaluate('data-dense'));
    }
  });
});
