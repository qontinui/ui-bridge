import { describe, it, expect, vi } from 'vitest';
import { NativeUIBridgeRegistry } from '../../core/registry';
import { createDesignHandlers } from '../design-handlers';
import type { HandlerContext } from '../types';
import type { NativeElementRef } from '../../core/types';

/**
 * Native `/design/snapshot`, `/design/evaluate`, `/design/evaluate/baseline`
 * and `/design/evaluate/diff` validate the body fields they read with the web
 * transports' rules and messages (`design-request.ts`, `quality-request.ts`),
 * and select by `elementIds` the way web does: absent or `null` is every
 * element, a given list exactly its ids, `[]` none. `/design/audit` has its
 * own tests in `design-handlers.style-inference.test.ts`.
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

    it('selects as web does: absent/null all, a list exactly its ids, [] none', async () => {
      expect(await ids(undefined)).toEqual(['b', 'o', 'x', 'box']);
      expect(await ids(null)).toEqual(['b', 'o', 'x', 'box']);
      expect(await ids({ elementIds: null })).toEqual(['b', 'o', 'x', 'box']);
      expect(await ids({ elementIds: ['box'] })).toEqual(['box']);
      expect(await ids({ elementIds: [] })).toEqual([]);
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
      const badMetric = { name: 'c', metrics: { contrast: { weight: 'heavy' } } };
      expect(await h.evaluateQuality(ctx({ customContext: badMetric }))).toMatchObject({
        success: false,
        code: 'INVALID_REQUEST',
        error: expect.stringContaining(`${route}: customContext.metrics.contrast must be`),
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
        metrics: { contrast: { enabled: true, weight: 1, thresholds: { good: 1, warning: 0 } } },
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
