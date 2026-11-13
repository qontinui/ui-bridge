import { describe, it, expect } from 'vitest';
import * as specs from '@qontinui/ui-bridge/specs';
import { NativeUIBridgeRegistry } from '../../core/registry';
import { DefaultNativeActionExecutor } from '../../control/action-executor';
import { NativeUIBridgeServer } from '../http-server';
import { createDesignHandlers, type StyleInferenceModule } from '../design-handlers';
import type { HandlerContext } from '../types';
import type { NativeElementRef } from '../../core/types';

/**
 * The native mirror of `/design/style-guide/infer` and `/design/tokens/drift`.
 *
 * The aggregation and the body validation are the web SDK's pure
 * `@qontinui/ui-bridge/specs` functions, reached at runtime through this
 * package's optional CJS `require`. `vi.mock` cannot intercept that `require`,
 * so these tests inject the same functions (imported here, as the workspace
 * build serves them) wrapped to record what native passes in. The real
 * functions run, so the assertions cover RN-shaped samples end to end. Plan:
 * 2026-11-13-ui-bridge-infers-a-draft-style-guide-and-token-drift-from-computed-styles.
 */

function makeRef(): React.RefObject<NativeElementRef> {
  return { current: {} as NativeElementRef };
}

interface Calls {
  samples: Array<Array<{ elementId: string; styles: Record<string, string> }>>;
  declared: unknown[];
  driftOptions: unknown[];
}

/** The real specs functions, recording their inputs. */
function recordingModule(): { module: StyleInferenceModule; calls: Calls } {
  const calls: Calls = { samples: [], declared: [], driftOptions: [] };
  const real = specs as unknown as StyleInferenceModule;
  const module: StyleInferenceModule = {
    ...real,
    buildStyleInventory: (samples, options) => {
      calls.samples.push(samples);
      return real.buildStyleInventory(samples, options);
    },
    computeTokenDrift: (inventory, declared, options) => {
      calls.declared.push(declared);
      calls.driftOptions.push(options);
      return real.computeTokenDrift(inventory, declared, options);
    },
  };
  return { module, calls };
}

function registryWithStyles(): NativeUIBridgeRegistry {
  const registry = new NativeUIBridgeRegistry();
  registry.registerElement('card', makeRef(), { type: 'view' });
  registry.updateElementStyle('card', { backgroundColor: '#ffffff', padding: 16, borderRadius: 8 });
  registry.registerElement('title', makeRef(), { type: 'text' });
  registry.updateElementStyle('title', { color: 'navy', fontSize: 20, fontWeight: '700' });
  return registry;
}

function ctx(body: unknown): HandlerContext {
  return { params: {}, query: {}, body } as unknown as HandlerContext;
}

type InferData = {
  status: string;
  guide: { name: string; tokens: Record<string, Record<string, unknown>> } | null;
  inventory: Record<string, Array<{ name: string; value: string }>>;
  capture: Record<string, unknown>;
};

describe('native style inference', () => {
  it('the published specs entry carries every function native gates on', () => {
    for (const fn of [
      'buildStyleInventory',
      'inferStyleGuideFromInventory',
      'computeTokenDrift',
      'parseInferBody',
      'parseDriftBody',
      'loadedGuideTokens',
    ]) {
      expect(typeof (specs as Record<string, unknown>)[fn], fn).toBe('function');
    }
  });

  it('infers a guide from flattened RN styles: named colours, numeric lengths', async () => {
    const { module, calls } = recordingModule();
    const handlers = createDesignHandlers(registryWithStyles(), undefined, {
      styleInference: module,
    });
    const res = await handlers.inferStyleGuide(ctx({ name: 'mobile', limits: { colors: 1 } }));

    expect(res.success).toBe(true);
    const data = res.data as InferData;
    expect(data.status).toBe('ok');
    expect(data.capture).toMatchObject({
      scope: 'registered',
      elementsAvailable: 2,
      elementsSampled: 2,
      elementCapReached: false,
    });
    const colors = data.inventory.colors.map((e) => e.value);
    expect(colors).toHaveLength(1); // capped by limits
    expect(['#ffffff', '#000080']).toContain(colors[0]);
    expect(data.guide?.name).toBe('mobile');
    expect(data.guide?.tokens.spacing).toEqual({ 'space-1': '16px' });
    expect(data.guide?.tokens.borderRadius).toEqual({ 'radius-1': '8px' });
    expect((data.guide?.tokens.typography as Record<string, unknown>).fontSizes).toEqual({
      'font-size-1': '20px',
    });
    const byId = Object.fromEntries(calls.samples[0].map((s) => [s.elementId, s.styles]));
    expect(byId.title).toMatchObject({ color: 'navy', fontSize: '20px', fontWeight: '700' });
  });

  it('honours elementIds and maxElements and reports the cap', async () => {
    const { module, calls } = recordingModule();
    const handlers = createDesignHandlers(registryWithStyles(), undefined, {
      styleInference: module,
    });
    await handlers.inferStyleGuide(ctx({ elementIds: ['title'] }));
    expect(calls.samples[0].map((s) => s.elementId)).toEqual(['title']);
    const typo = await handlers.inferStyleGuide(ctx({ elementIds: ['nope'] }));
    expect((typo.data as InferData).capture.notes).toContain(
      'elementIds matched no registered element'
    );
    const capped = await handlers.inferStyleGuide(ctx({ maxElements: 1 }));
    expect((capped.data as InferData).capture).toMatchObject({
      elementsAvailable: 2,
      elementsSampled: 1,
      elementCapReached: true,
    });
  });

  it('reports drift against each declared source, else the loaded style guide', async () => {
    const { module, calls } = recordingModule();
    const handlers = createDesignHandlers(registryWithStyles(), undefined, {
      styleInference: module,
    });

    const fromTokens = await handlers.diffDesignTokens(
      ctx({
        tokens: { colors: { paper: '#ffffff', ink: '#000088' } },
        tolerance: { colorDeltaE: 2 },
      })
    );
    expect(fromTokens.data).toMatchObject({ declaredSource: 'tokens', verdict: 'drift' });
    const undeclared = (fromTokens.data as { undeclared: Array<Record<string, unknown>> })
      .undeclared;
    expect(undeclared).toEqual([
      expect.objectContaining({
        value: '#000080',
        nearest: expect.objectContaining({ token: 'colors.ink' }),
      }),
    ]);
    expect(calls.driftOptions[0]).toMatchObject({ colorDeltaE: 2, rootFontSizePx: 16 });

    const map = { '--paper': '#ffffff', '--navy': 'navy' };
    const fromMap = await handlers.diffDesignTokens(ctx({ customProperties: map }));
    expect(fromMap.data).toMatchObject({ declaredSource: 'customProperties', verdict: 'no-drift' });

    await handlers.loadStyleGuide(ctx({ guide: { tokens: { spacing: { md: '16px' } } } }));
    const fromGuide = await handlers.diffDesignTokens(ctx({}));
    expect(fromGuide.data).toMatchObject({
      declaredSource: 'loadedStyleGuide',
      verdict: 'no-drift',
    });
    expect(calls.declared[2]).toEqual({ tokens: { spacing: { md: '16px' } } });
    await handlers.clearStyleGuide(ctx({}));

    const none = await handlers.diffDesignTokens(ctx({}));
    expect(none).toMatchObject({ success: false, code: 'INVALID_REQUEST' });
    expect(none.error).toMatch(/no declared tokens/);
  });

  it('validates the body as the web transports do, and refuses what RN cannot answer', async () => {
    const { module, calls } = recordingModule();
    const handlers = createDesignHandlers(registryWithStyles(), undefined, {
      styleInference: module,
    });
    const refusals = [
      await handlers.inferStyleGuide(ctx({ scope: 'document' })),
      await handlers.inferStyleGuide(ctx({ elementIds: 'card' })),
      await handlers.inferStyleGuide(ctx('nope')),
      await handlers.inferStyleGuide(ctx({ limits: { colors: 'x' } })),
      await handlers.inferStyleGuide(ctx({ maxElements: 0 })),
      await handlers.inferStyleGuide(ctx({ maxPerCategory: -1 })),
      await handlers.diffDesignTokens(ctx({ pageCustomPropertyPrefix: '--acme-' })),
      await handlers.diffDesignTokens(ctx({ tokens: {}, customProperties: {} })),
      await handlers.diffDesignTokens(ctx({ tokens: { colours: {} } })),
      await handlers.diffDesignTokens(ctx({ customProperties: { paper: '#fff' } })),
    ];
    for (const r of refusals) expect(r).toMatchObject({ success: false, code: 'INVALID_REQUEST' });
    expect(calls.samples).toEqual([]);
  });

  it('answers INFERENCE_NOT_AVAILABLE when the peer lacks the functions', async () => {
    const handlers = createDesignHandlers(registryWithStyles(), undefined, {
      styleInference: null,
    });
    for (const r of [
      await handlers.inferStyleGuide(ctx({})),
      await handlers.diffDesignTokens(ctx({})),
    ]) {
      expect(r).toMatchObject({ success: false, code: 'INFERENCE_NOT_AVAILABLE' });
    }
  });

  it('routes both endpoints through the server to the peer functions', async () => {
    const registry = registryWithStyles();
    const server = new NativeUIBridgeServer(registry, new DefaultNativeActionExecutor(registry));
    for (const path of ['/ui-bridge/design/style-guide/infer', '/ui-bridge/design/tokens/drift']) {
      const res = await server.handleRequest({
        method: 'POST',
        path,
        headers: { 'content-type': 'application/json' },
        query: {},
        body: { tokens: { colors: { paper: '#ffffff' } } },
      });
      expect(res.status, path).toBe(200);
      expect((JSON.parse(res.body) as { success: boolean }).success, path).toBe(true);
    }
  });
});
