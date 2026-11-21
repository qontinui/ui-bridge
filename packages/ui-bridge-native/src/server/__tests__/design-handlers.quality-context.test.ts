import { describe, it, expect, afterEach } from 'vitest';
import * as specs from '@qontinui/ui-bridge/specs';
import { NativeUIBridgeRegistry } from '../../core/registry';
import { createDesignHandlers, type QualityEvaluatorModule } from '../design-handlers';
import type { HandlerContext } from '../types';

/**
 * Native `/design/evaluate` runs the SDK's request parser
 * (`parseEvaluateRequest`), and with it the one quality-context shape rule
 * (`qualityContextProblem`), and refuses a malformed context as a request error
 * (INVALID_REQUEST), as the web transports refuse it as UB-VALIDATION-ERROR —
 * never as an evaluation failure. The real specs functions are injected
 * because `vi.mock` does not intercept this file's CJS `require`.
 */

const evaluator = specs as unknown as QualityEvaluatorModule;

function ctx(body: unknown): HandlerContext {
  return { params: {}, query: {}, body } as unknown as HandlerContext;
}

function handlers() {
  return createDesignHandlers(new NativeUIBridgeRegistry(), () => ({ width: 400, height: 800 }), {
    qualityEvaluator: evaluator,
  });
}

describe('native /design/evaluate quality context', () => {
  // The loaded style guide is module state shared by every handler instance.
  afterEach(async () => {
    await handlers().clearStyleGuide(ctx(undefined));
  });

  it('the published specs entry carries the request parser native calls', () => {
    expect(typeof (specs as Record<string, unknown>).parseEvaluateRequest).toBe('function');
  });

  it('refuses a malformed customContext as INVALID_REQUEST', async () => {
    for (const customContext of [
      { name: 'x' },
      false,
      { name: 'x', metrics: { contentOverflow: { enabled: 'false' } } },
      { name: 'x', metrics: { contentOverlow: {} } },
      { name: 'x', metrics: { contentOverflow: { thresholds: { good: 40, warning: 80 } } } },
    ]) {
      const res = await handlers().evaluateQuality(ctx({ customContext }));
      expect(res.success, JSON.stringify(customContext)).toBe(false);
      expect(res.code).toBe('INVALID_REQUEST');
      expect(res.error).toMatch(/^\/design\/evaluate: customContext/);
    }
  });

  it('reads a null customContext as not given', async () => {
    const res = await handlers().evaluateQuality(ctx({ customContext: null }));
    expect(res.success).toBe(true);
  });

  it('refuses a declared context that is null as INVALID_REQUEST, and ignores inherited names', async () => {
    const h = handlers();
    await h.loadStyleGuide(
      ctx({ guide: { version: '1', name: 'g', rules: [], qualityContexts: { nothing: null } } })
    );
    const declared = await h.evaluateQuality(ctx({ context: 'nothing' }));
    expect(declared.success).toBe(false);
    expect(declared.code).toBe('INVALID_REQUEST');
    expect(declared.error).toContain('quality context "nothing" must be an object');
    // "constructor" is not declared: it falls to the built-in lookup.
    const inherited = await h.evaluateQuality(ctx({ context: 'constructor' }));
    expect(inherited.success).toBe(false);
    expect(inherited.code).toBe('INVALID_REQUEST');
    expect(inherited.error).toMatch(/Unknown quality context/);
  });

  it('refuses a non-string context and an unknown name as INVALID_REQUEST', async () => {
    for (const context of [{ name: 'x', metrics: {} }, 42]) {
      const res = await handlers().evaluateQuality(ctx({ context }));
      expect(res.success).toBe(false);
      expect(res.code).toBe('INVALID_REQUEST');
      expect(res.error).toBe('/design/evaluate: context must be a string');
    }
    const unknown = await handlers().evaluateQuality(ctx({ context: 'nope' }));
    expect(unknown.code).toBe('INVALID_REQUEST');
    expect(unknown.error).toMatch(/Unknown quality context: "nope"/);
    const builtIn = await handlers().evaluateQuality(ctx({ context: 'general' }));
    expect(builtIn.success).toBe(true);
  });

  it('evaluates with a valid declared context (the declared object, not its name)', async () => {
    const h = handlers();
    const brand = {
      name: 'brand',
      description: 'declared',
      metrics: { contentOverflow: { enabled: false } },
    };
    await h.loadStyleGuide(
      ctx({ guide: { version: '1', name: 'g', rules: [], qualityContexts: { brand } } })
    );
    const res = await h.evaluateQuality(ctx({ context: 'brand' }));
    expect(res.success).toBe(true);
    const report = res.data as {
      contextName: string;
      metrics: Array<{ metricId: string; enabled: boolean }>;
    };
    expect(report.contextName).toBe('brand');
    expect(report.metrics.find((m) => m.metricId === 'contentOverflow')?.enabled).toBe(false);
  });

  it('refuses a malformed body, elementIds or viewport as INVALID_REQUEST, as the web model does', async () => {
    const cases: Array<[unknown, RegExp]> = [
      [[1, 2], /the request body must be a JSON object/],
      [{ elementIds: 'save' }, /elementIds must be an array of strings/],
      [{ viewport: { width: 'x', height: 800 } }, /viewport must be \{ width, height \}/],
    ];
    for (const [body, message] of cases) {
      const res = await handlers().evaluateQuality(ctx(body));
      expect(res.success, JSON.stringify(body)).toBe(false);
      expect(res.code).toBe('INVALID_REQUEST');
      expect(res.error).toMatch(message);
    }
  });

  it('on an SDK without parseEvaluateRequest, refuses a malformed body and answers EVALUATOR_NOT_AVAILABLE for a well-formed one', async () => {
    // An older SDK (0.57.0 and earlier) loads but carries no request parser:
    // native never evaluates under a looser copy of the rules.
    const { parseEvaluateRequest: _omit, ...older } = evaluator;
    const reached: unknown[] = [];
    const h = createDesignHandlers(
      new NativeUIBridgeRegistry(),
      () => ({ width: 400, height: 800 }),
      {
        qualityEvaluator: {
          ...(older as QualityEvaluatorModule),
          evaluateQuality: (_e, _v, context) => {
            reached.push(context);
            return {};
          },
        },
      }
    );
    const malformed = await h.evaluateQuality(ctx({ viewport: { width: 0 } }));
    expect(malformed).toMatchObject({
      success: false,
      code: 'INVALID_REQUEST',
      error:
        '/design/evaluate: viewport must be { width, height }, each a finite number greater than 0',
    });
    for (const body of [{}, { customContext: { name: 'x', metrics: { contentOverlow: {} } } }]) {
      const res = await h.evaluateQuality(ctx(body));
      expect(res, JSON.stringify(body)).toMatchObject({
        success: false,
        code: 'EVALUATOR_NOT_AVAILABLE',
        error:
          'Install a @qontinui/ui-bridge release containing parseEvaluateRequest (0.58.0 or later).',
      });
    }
    expect(reached).toEqual([]);
  });

  it('an empty elementIds selects no element, as on the web transports', async () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('a', { current: {} } as never, { type: 'view' });
    const h = createDesignHandlers(registry, () => ({ width: 400, height: 800 }), {
      qualityEvaluator: evaluator,
    });
    const none = await h.evaluateQuality(ctx({ elementIds: [] }));
    expect((none.data as { totalElements: number }).totalElements).toBe(0);
    const all = await h.evaluateQuality(ctx({}));
    expect((all.data as { totalElements: number }).totalElements).toBe(1);
    // The baseline route reads an empty list the same way.
    const baseline = await h.saveBaseline(ctx({ elementIds: [] }));
    expect((baseline.data as { elementCount: number }).elementCount).toBe(0);
  });

  it('every design route selects exactly the given elementIds and refuses malformed ones', async () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('a', { current: {} } as never, { type: 'view' });
    registry.registerElement('b', { current: {} } as never, { type: 'view' });
    const audits: number[] = [];
    const diffed: number[] = [];
    const h = createDesignHandlers(registry, () => ({ width: 400, height: 800 }), {
      qualityEvaluator: {
        ...evaluator,
        diffSnapshots: (baseline: unknown, current: unknown[]) => {
          diffed.push(current.length);
          return evaluator.diffSnapshots(baseline, current as never);
        },
      },
      styleValidator: {
        runStyleAudit: (elements: unknown[]) => {
          audits.push(elements.length);
          return { results: [] };
        },
      } as never,
    });
    const guide = { version: '1', name: 'g', rules: [] };

    const snapshot = await h.getDesignSnapshot(ctx({ elementIds: ['a'] }));
    expect((snapshot.data as { elements: unknown[] }).elements).toHaveLength(1);
    const emptySnapshot = await h.getDesignSnapshot(ctx({ elementIds: [] }));
    expect((emptySnapshot.data as { elements: unknown[] }).elements).toHaveLength(0);

    const responsive = await h.getResponsiveSnapshots(ctx({ elementIds: [] }));
    expect((responsive.data as Array<{ elements: unknown[] }>)[0].elements).toHaveLength(0);
    const allResponsive = await h.getResponsiveSnapshots(ctx(undefined));
    expect((allResponsive.data as Array<{ elements: unknown[] }>)[0].elements).toHaveLength(2);

    await h.runDesignAudit(ctx({ guide, elementIds: [] }));
    await h.runDesignAudit(ctx({ guide }));
    expect(audits).toEqual([0, 2]);

    await h.saveBaseline(ctx({}));
    const diff = await h.diffBaseline(ctx({ elementIds: [] }));
    expect(diff.success).toBe(true);
    await h.diffBaseline(ctx(undefined));
    expect(diffed).toEqual([0, 2]);

    for (const call of [
      () => h.getDesignSnapshot(ctx({ elementIds: 'a' })),
      () => h.getResponsiveSnapshots(ctx({ elementIds: { a: 1 } })),
      () => h.runDesignAudit(ctx({ guide, elementIds: 'a' })),
      () => h.saveBaseline(ctx({ elementIds: [1] })),
      () => h.diffBaseline(ctx({ elementIds: 'a' })),
      // checked before the guide: no guide is loaded here
      () => h.runDesignAudit(ctx({ elementIds: 'a' })),
    ]) {
      const res = await call();
      expect(res.success).toBe(false);
      expect(res.code).toBe('INVALID_REQUEST');
      expect(res.error).toMatch(/elementIds must be an array of strings/);
    }
  });

  it('the baseline route refuses a non-string label as INVALID_REQUEST', async () => {
    const res = await handlers().saveBaseline(ctx({ label: 3 }));
    expect(res.success).toBe(false);
    expect(res.code).toBe('INVALID_REQUEST');
    expect(res.error).toBe('/design/evaluate/baseline: label must be a string');
    const ok = await handlers().saveBaseline(ctx({ label: 'before' }));
    expect(ok.success).toBe(true);
  });

  it('/design/audit refuses a malformed body guide as INVALID_REQUEST, with no guide loaded', async () => {
    for (const guide of ['x', false, { rules: 'nope' }, []]) {
      const res = await handlers().runDesignAudit(ctx({ guide }));
      expect(res.success, JSON.stringify(guide)).toBe(false);
      expect(res.code).toBe('INVALID_REQUEST');
      expect(res.error).toBe(
        '/design/audit: guide must be a style guide object with a rules array'
      );
    }
    // No guide given and none loaded is a state, not a request error.
    const none = await handlers().runDesignAudit(ctx({}));
    expect(none.code).toBe('NO_STYLE_GUIDE');
  });
});
