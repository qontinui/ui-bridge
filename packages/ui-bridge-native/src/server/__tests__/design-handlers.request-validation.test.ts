import { describe, it, expect, vi } from 'vitest';
import { NativeUIBridgeRegistry } from '../../core/registry';
import { createDesignHandlers } from '../design-handlers';
import type { HandlerContext } from '../types';
import type { NativeElementRef } from '../../core/types';

/**
 * Native `/design/snapshot`, `/design/responsive`, `/design/evaluate`,
 * `/design/evaluate/baseline` and `/design/evaluate/diff` validate their body
 * fields with the web transports' rules and messages (`design-request.ts`, `quality-request.ts`),
 * and select by `elementIds` the way web does: absent or `null` is every
 * element, a given list exactly its ids, `[]` none. `/design/audit` has its
 * own tests in `design-handlers.audit.test.ts`.
 */

function makeRef(): React.RefObject<NativeElementRef> {
  return { current: {} as NativeElementRef };
}

function ctx(body: unknown): HandlerContext {
  return { params: {}, query: {}, body } as unknown as HandlerContext;
}

function registry(): NativeUIBridgeRegistry {
  const r = new NativeUIBridgeRegistry();
  for (const id of ['b', 'o', 'x', 'box']) {
    r.registerElement(id, makeRef(), { type: 'view' });
    r.updateElementStyle(id, { padding: 8 });
  }
  return r;
}

const NOT_AN_OBJECT = ['box', 3, [1], true];
const BAD_IDS = ['box', 3, { box: true }, [1], ['box', 2]];

function refusal(message: string) {
  return { success: false, code: 'INVALID_REQUEST', error: message };
}

describe('native design request validation', () => {
  describe('/design/snapshot', () => {
    const ids = async (body: unknown) => {
      const r = await createDesignHandlers(registry()).getDesignSnapshot(ctx(body));
      expect(r.success, JSON.stringify(r)).toBe(true);
      return (r.data as { elements: Array<{ elementId: string }> }).elements.map(
        (e) => e.elementId
      );
    };

    it('refuses a non-object body and elementIds that are not an array of strings', async () => {
      const h = createDesignHandlers(registry());
      for (const body of NOT_AN_OBJECT) {
        expect(await h.getDesignSnapshot(ctx(body))).toMatchObject(
          refusal('/design/snapshot: the request body must be a JSON object')
        );
      }
      for (const elementIds of BAD_IDS) {
        expect(await h.getDesignSnapshot(ctx({ elementIds }))).toMatchObject(
          refusal('/design/snapshot: elementIds must be an array of strings')
        );
      }
    });

    it('refuses includePseudoElements and limit as web does, in web order', async () => {
      const h = createDesignHandlers(registry());
      for (const includePseudoElements of ['yes', 1, {}]) {
        // includePseudoElements is checked before limit.
        expect(await h.getDesignSnapshot(ctx({ includePseudoElements, limit: 0 }))).toMatchObject(
          refusal('/design/snapshot: includePseudoElements must be a boolean')
        );
      }
      for (const limit of [0, -1, 1.5, '3', true]) {
        expect(await h.getDesignSnapshot(ctx({ limit }))).toMatchObject(
          refusal('/design/snapshot: limit must be an integer >= 1')
        );
      }
      // elementIds is checked before includePseudoElements.
      expect(
        await h.getDesignSnapshot(ctx({ elementIds: 'x', includePseudoElements: 'x' }))
      ).toMatchObject(refusal('/design/snapshot: elementIds must be an array of strings'));
    });

    it('applies a given limit and reports the cut as web does; none leaves it unbounded', async () => {
      const h = createDesignHandlers(registry());
      const cut = await h.getDesignSnapshot(ctx({ limit: 2, includePseudoElements: true }));
      expect(cut.success).toBe(true);
      expect(cut.data?.elements.map((e) => e.elementId)).toEqual(['b', 'o']);
      expect(cut.data).toMatchObject({ totalElements: 4, returned: 2, limit: 2, truncated: true });
      const uncut = await h.getDesignSnapshot(ctx({ limit: 10 }));
      expect(uncut.data?.elements).toHaveLength(4);
      expect(uncut.data).toMatchObject({
        totalElements: 4,
        returned: 4,
        limit: 10,
        truncated: false,
      });
      const unbounded = await h.getDesignSnapshot(ctx({ elementIds: ['box', 'x'] }));
      expect(unbounded.data?.elements.map((e) => e.elementId)).toEqual(['x', 'box']);
      expect(unbounded.data).not.toHaveProperty('limit');
      expect(unbounded.data).not.toHaveProperty('truncated');
    });

    it('selects as web does: absent/null all, a list exactly its ids, [] none', async () => {
      expect(await ids(undefined)).toEqual(['b', 'o', 'x', 'box']);
      expect(await ids(null)).toEqual(['b', 'o', 'x', 'box']);
      expect(await ids({ elementIds: null })).toEqual(['b', 'o', 'x', 'box']);
      expect(await ids({ elementIds: ['box'] })).toEqual(['box']);
      expect(await ids({ elementIds: [] })).toEqual([]);
    });
  });

  describe('/design/responsive', () => {
    const route = '/design/responsive';
    const VIEWPORTS =
      `${route}: viewports must be a non-empty { label: width } object or width array, ` +
      'each width a finite number greater than 0';

    it('refuses each malformed field with the web message, in the web order', async () => {
      const h = createDesignHandlers(registry());
      for (const body of NOT_AN_OBJECT) {
        expect(await h.getResponsiveSnapshots(ctx(body))).toMatchObject(
          refusal(`${route}: the request body must be a JSON object`)
        );
      }
      for (const elementIds of BAD_IDS) {
        expect(await h.getResponsiveSnapshots(ctx({ elementIds, viewports: [] }))).toMatchObject(
          refusal(`${route}: elementIds must be an array of strings`)
        );
      }
      for (const viewports of [[], {}, [0], [320, -1], { phone: '375' }, 'phone', 375]) {
        // viewports is checked before budgetMs.
        expect(await h.getResponsiveSnapshots(ctx({ viewports, budgetMs: 0 }))).toMatchObject(
          refusal(VIEWPORTS)
        );
      }
      const seventeen = Array.from({ length: 17 }, (_, i) => 300 + i);
      expect(await h.getResponsiveSnapshots(ctx({ viewports: seventeen }))).toMatchObject(
        refusal(`${route}: at most 16 viewports per request (got 17)`)
      );
      for (const budgetMs of [0, -5, '100', Number.POSITIVE_INFINITY]) {
        // budgetMs is checked before limit.
        expect(await h.getResponsiveSnapshots(ctx({ budgetMs, limit: 0 }))).toMatchObject(
          refusal(`${route}: budgetMs must be a finite number greater than 0`)
        );
      }
      for (const limit of [0, 2.5, 'all']) {
        expect(await h.getResponsiveSnapshots(ctx({ limit }))).toMatchObject(
          refusal(`${route}: limit must be an integer >= 1`)
        );
      }
    });

    it('accepts valid viewports and budgetMs, applies a given limit and reports the cut', async () => {
      const h = createDesignHandlers(registry(), () => ({ width: 390, height: 844 }));
      const all = await h.getResponsiveSnapshots(
        ctx({ viewports: { phone: 375, desktop: 1280 }, budgetMs: 500 })
      );
      expect(all.success, JSON.stringify(all)).toBe(true);
      expect(all.data).toHaveLength(1);
      expect(all.data?.[0].viewportWidth).toBe(390);
      expect(all.data?.[0].elements).toHaveLength(4);
      expect(all.data?.[0]).not.toHaveProperty('truncated');
      const cut = await h.getResponsiveSnapshots(ctx({ viewports: [375], limit: 3 }));
      const snapshot = cut.data?.[0];
      expect(snapshot?.elements.map((e) => e.elementId)).toEqual(['b', 'o', 'x']);
      expect(snapshot).toMatchObject({ totalElements: 4, returned: 3, limit: 3, truncated: true });
    });
  });

  describe('/design/evaluate', () => {
    const route = '/design/evaluate';

    it('refuses each malformed field with the web message, in the web order', async () => {
      const h = createDesignHandlers(registry());
      for (const body of NOT_AN_OBJECT) {
        expect(await h.evaluateQuality(ctx(body))).toMatchObject(
          refusal(`${route}: the request body must be a JSON object`)
        );
      }
      for (const elementIds of BAD_IDS) {
        // elementIds is checked before viewport.
        expect(await h.evaluateQuality(ctx({ elementIds, viewport: 'x' }))).toMatchObject(
          refusal(`${route}: elementIds must be an array of strings`)
        );
      }
      for (const viewport of ['x', { width: 100 }, { width: 0, height: 10 }, { width: 'a' }]) {
        expect(await h.evaluateQuality(ctx({ viewport, customContext: 3 }))).toMatchObject(
          refusal(
            `${route}: viewport must be { width, height }, each a finite number greater than 0`
          )
        );
      }
      for (const customContext of ['x', { name: 'c' }, { name: 1, metrics: {} }]) {
        expect(await h.evaluateQuality(ctx({ customContext, context: 3 }))).toMatchObject(
          refusal(
            `${route}: customContext must be an object with a string name and a metrics object`
          )
        );
      }
      const badMetric = { name: 'c', metrics: { wcagContrastCompliance: { weight: 'heavy' } } };
      expect(await h.evaluateQuality(ctx({ customContext: badMetric }))).toMatchObject({
        success: false,
        code: 'INVALID_REQUEST',
        error: expect.stringContaining(
          `${route}: customContext.metrics.wcagContrastCompliance must be`
        ),
      });
      expect(await h.evaluateQuality(ctx({ context: 3 }))).toMatchObject(
        refusal(`${route}: context must be a string`)
      );
    });

    it('refuses an unknown or empty context name with the web message', async () => {
      const h = createDesignHandlers(registry());
      for (const context of ['bogus', '', 'toString', 'constructor']) {
        expect(await h.evaluateQuality(ctx({ context }))).toMatchObject({
          success: false,
          code: 'INVALID_REQUEST',
          error: expect.stringMatching(
            new RegExp(`^Unknown quality context: "${context}"\\. Available: general, minimal, `)
          ),
        });
      }
    });

    it('resolves a guide-declared context by own key, and names it when refusing', async () => {
      vi.resetModules();
      const fresh = await import('../design-handlers');
      const h = fresh.createDesignHandlers(registry(), () => ({ width: 400, height: 800 }));
      const declared = {
        name: 'brand',
        description: 'brand',
        metrics: {
          wcagContrastCompliance: { enabled: true, weight: 1, thresholds: { good: 1, warning: 0 } },
        },
      };
      const guide = {
        version: '1.0',
        name: 'g',
        tokens: {},
        rules: [],
        qualityContexts: { brand: declared },
      };
      expect((await h.loadStyleGuide(ctx({ guide }))).success).toBe(true);
      const r = await h.evaluateQuality(ctx({ context: 'brand' }));
      expect(r.success, JSON.stringify(r)).toBe(true);
      expect((r.data as { contextName: string }).contextName).toBe('brand');
      expect(await h.evaluateQuality(ctx({ context: 'toString' }))).toMatchObject({
        success: false,
        code: 'INVALID_REQUEST',
        error: expect.stringMatching(/Available: .*accessibility, brand$/),
      });
    });

    it('evaluates exactly the selected elements', async () => {
      const h = createDesignHandlers(registry(), () => ({ width: 400, height: 800 }));
      const count = async (body: unknown) => {
        const r = await h.evaluateQuality(ctx(body));
        expect(r.success, JSON.stringify(r)).toBe(true);
        return (r.data as { totalElements: number }).totalElements;
      };
      expect(await count({ elementIds: ['box'], context: 'general' })).toBe(1);
      expect(await count({ elementIds: [] })).toBe(0);
      expect(await count({ elementIds: null })).toBe(4);
    });
  });

  describe('request errors come before EVALUATOR_NOT_AVAILABLE on a host with no SDK', () => {
    const noSdk = () => createDesignHandlers(registry(), undefined, { qualityEvaluator: null });

    it('/design/evaluate refuses a malformed body, and answers a well-formed one with the release it needs', async () => {
      const h = noSdk();
      expect(await h.evaluateQuality(ctx({ viewport: { width: 0 } }))).toMatchObject(
        refusal(
          '/design/evaluate: viewport must be { width, height }, each a finite number greater than 0'
        )
      );
      expect(await h.evaluateQuality(ctx('x'))).toMatchObject(
        refusal('/design/evaluate: the request body must be a JSON object')
      );
      expect(await h.evaluateQuality(ctx({ elementIds: [1] }))).toMatchObject(
        refusal('/design/evaluate: elementIds must be an array of strings')
      );
      expect(await h.evaluateQuality(ctx({ viewport: { width: 10, height: 10 } }))).toMatchObject({
        success: false,
        code: 'EVALUATOR_NOT_AVAILABLE',
        error:
          'Install a @qontinui/ui-bridge release containing parseEvaluateRequest (0.58.0 or later).',
      });
    });

    it('/design/evaluate/baseline refuses a malformed body before EVALUATOR_NOT_AVAILABLE', async () => {
      const h = noSdk();
      expect(await h.saveBaseline(ctx({ label: 3 }))).toMatchObject(
        refusal('/design/evaluate/baseline: label must be a string')
      );
      expect(await h.saveBaseline(ctx({ elementIds: 'box' }))).toMatchObject(
        refusal('/design/evaluate/baseline: elementIds must be an array of strings')
      );
      expect(await h.saveBaseline(ctx({ label: 'before' }))).toMatchObject({
        success: false,
        code: 'EVALUATOR_NOT_AVAILABLE',
      });
    });

    it('/design/evaluate/diff refuses a malformed body, then answers EVALUATOR_NOT_AVAILABLE — never NO_BASELINE', async () => {
      vi.resetModules();
      const fresh = await import('../design-handlers');
      const h = fresh.createDesignHandlers(registry(), undefined, { qualityEvaluator: null });
      expect(await h.diffBaseline(ctx({ elementIds: 'box' }))).toMatchObject(
        refusal('/design/evaluate/diff: elementIds must be an array of strings')
      );
      expect(await h.diffBaseline(ctx(7))).toMatchObject(
        refusal('/design/evaluate/diff: the request body must be a JSON object')
      );
      expect(await h.diffBaseline(ctx({}))).toMatchObject({
        success: false,
        code: 'EVALUATOR_NOT_AVAILABLE',
      });
    });
  });

  describe('/design/evaluate/baseline and /design/evaluate/diff', () => {
    it('baseline refuses a malformed body, elementIds or label', async () => {
      const h = createDesignHandlers(registry());
      const route = '/design/evaluate/baseline';
      for (const body of NOT_AN_OBJECT) {
        expect(await h.saveBaseline(ctx(body))).toMatchObject(
          refusal(`${route}: the request body must be a JSON object`)
        );
      }
      for (const elementIds of BAD_IDS) {
        expect(await h.saveBaseline(ctx({ elementIds, label: 3 }))).toMatchObject(
          refusal(`${route}: elementIds must be an array of strings`)
        );
      }
      expect(await h.saveBaseline(ctx({ label: 3 }))).toMatchObject(
        refusal(`${route}: label must be a string`)
      );
    });

    it('baseline selects as web does: [] none, a list exactly its ids, absent all', async () => {
      const h = createDesignHandlers(registry());
      const count = async (body: unknown) =>
        ((await h.saveBaseline(ctx(body))).data as { elementCount: number }).elementCount;
      expect(await count({ elementIds: [] })).toBe(0);
      expect(await count({ elementIds: ['box'] })).toBe(1);
      expect(await count({ elementIds: null, label: null })).toBe(4);
      expect(await count(undefined)).toBe(4);
    });

    it('baseline answers a capture failure instead of throwing', async () => {
      const h = createDesignHandlers(registry(), () => {
        throw new Error('no screen');
      });
      expect(await h.saveBaseline(ctx(undefined))).toMatchObject({
        success: false,
        code: 'SAVE_BASELINE_ERROR',
        error: 'no screen',
      });
    });

    it('diff checks the baseline first, then refuses a malformed body or elementIds', async () => {
      // The saved baseline is module state, so start from a fresh module.
      vi.resetModules();
      const fresh = await import('../design-handlers');
      const h = fresh.createDesignHandlers(registry());
      const route = '/design/evaluate/diff';
      expect(await h.diffBaseline(ctx('box'))).toMatchObject({
        success: false,
        code: 'NO_BASELINE',
      });
      expect((await h.saveBaseline(ctx(undefined))).success).toBe(true);
      for (const body of NOT_AN_OBJECT) {
        expect(await h.diffBaseline(ctx(body))).toMatchObject(
          refusal(`${route}: the request body must be a JSON object`)
        );
      }
      for (const elementIds of BAD_IDS) {
        expect(await h.diffBaseline(ctx({ elementIds }))).toMatchObject(
          refusal(`${route}: elementIds must be an array of strings`)
        );
      }
      // Against a baseline of all four, a diff selects as web does.
      const removed = async (body: unknown) => {
        const r = await h.diffBaseline(ctx(body));
        expect(r.success, JSON.stringify(r)).toBe(true);
        return (r.data as { removed: unknown[] }).removed.length;
      };
      expect(await removed({ elementIds: ['box'] })).toBe(3);
      expect(await removed({ elementIds: [] })).toBe(4);
      expect(await removed(null)).toBe(0);
    });
  });

  describe('/design/element/:id/state-styles', () => {
    const route = '/design/element/:id/state-styles';
    const accepted = 'default, pressed, focused, disabled';

    function stateCtx(body: unknown, id = 'btn'): HandlerContext {
      return { params: { id }, query: {}, body } as unknown as HandlerContext;
    }

    function stateRegistry(): NativeUIBridgeRegistry {
      const r = new NativeUIBridgeRegistry();
      r.registerElement('btn', makeRef(), { type: 'button' });
      r.updateElementStyle(
        'btn',
        { backgroundColor: '#000000', opacity: 1 },
        {
          pressed: { backgroundColor: '#111111' },
          focused: { backgroundColor: '#222222' },
          disabled: { opacity: 0.5 },
        }
      );
      return r;
    }

    const states = async (body: unknown) => {
      const r = await createDesignHandlers(stateRegistry()).getElementStateStyles(stateCtx(body));
      expect(r.success, JSON.stringify(r)).toBe(true);
      return (r.data as { stateStyles: Array<{ state: string }> }).stateStyles.map((s) => s.state);
    };

    it('refuses a non-object body, a non-array states and an unknown state name', async () => {
      const h = createDesignHandlers(stateRegistry());
      for (const body of NOT_AN_OBJECT) {
        expect(await h.getElementStateStyles(stateCtx(body))).toMatchObject(
          refusal(`${route}: the request body must be a JSON object`)
        );
      }
      for (const bad of ['pressed', 3, { pressed: true }]) {
        expect(await h.getElementStateStyles(stateCtx({ states: bad }))).toMatchObject(
          refusal(`${route}: 'states' must be an array of: ${accepted}`)
        );
      }
      // A typo, a web-only state and a non-string are each named in the refusal.
      expect(
        await h.getElementStateStyles(stateCtx({ states: ['pressed', 'focus_ed', 'hover', 7] }))
      ).toMatchObject(
        refusal(`${route}: Unknown interaction state(s): focus_ed, hover, 7. Accepted: ${accepted}`)
      );
    });

    it('checks the body before the element lookup, as web does', async () => {
      const h = createDesignHandlers(stateRegistry());
      expect(
        await h.getElementStateStyles(stateCtx({ states: ['hover'] }, 'missing'))
      ).toMatchObject({ success: false, code: 'INVALID_REQUEST' });
      expect(await h.getElementStateStyles(stateCtx({}, 'missing'))).toMatchObject({
        success: false,
        code: 'ELEMENT_NOT_FOUND',
      });
    });

    // Selection is web's (absent/null every state, `[]` only `default`), but
    // the order is native's capture order, a repeated name is returned once,
    // and a named state with no differing style is omitted.
    it('selects: absent/null every state, a list default plus its states in capture order, [] default', async () => {
      const every = ['default', 'pressed', 'focused', 'disabled'];
      expect(await states(undefined)).toEqual(every);
      expect(await states(null)).toEqual(every);
      expect(await states({ states: null })).toEqual(every);
      expect(await states({ states: ['disabled', 'pressed'] })).toEqual([
        'default',
        'pressed',
        'disabled',
      ]);
      expect(await states({ states: ['default'] })).toEqual(['default']);
      expect(await states({ states: [] })).toEqual(['default']);
      expect(await states({ states: ['pressed', 'pressed'] })).toEqual(['default', 'pressed']);
    });

    it('omits a named state the element declares no differing style for', async () => {
      const r = new NativeUIBridgeRegistry();
      r.registerElement('plain', makeRef(), { type: 'view' });
      r.updateElementStyle('plain', { opacity: 1 }, { focused: { opacity: 1 } });
      const res = await createDesignHandlers(r).getElementStateStyles(
        stateCtx({ states: ['pressed', 'focused'] }, 'plain')
      );
      expect(res.success, JSON.stringify(res)).toBe(true);
      expect(
        (res.data as { stateStyles: Array<{ state: string }> }).stateStyles.map((s) => s.state)
      ).toEqual(['default']);
    });
  });
});
