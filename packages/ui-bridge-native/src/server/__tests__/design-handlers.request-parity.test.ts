import { describe, it, expect } from 'vitest';
import * as specs from '@qontinui/ui-bridge/specs';
import { NativeUIBridgeRegistry } from '../../core/registry';
import { createDesignHandlers, type QualityEvaluatorModule } from '../design-handlers';
import type { HandlerContext } from '../types';

/**
 * Native's request refusals equal the shared parsers' (plan
 * 2026-11-21-native-design-evaluate-snapshot-responsive-validate-through-the-shared-parsers, D3).
 *
 * `/design/snapshot` and `/design/responsive` must answer on a host with no
 * `@qontinui/ui-bridge` installed, so native carries its own copy of their
 * checks. The real `parseDesignSnapshotRequest` / `parseResponsiveSnapshotsRequest`
 * are the oracle: for every malformed body below, native's `INVALID_REQUEST`
 * message must equal the message the shared parser throws, so a drift on
 * either side fails here instead of shipping. `/design/evaluate` is held to
 * `parseEvaluateRequest` both with the SDK injected and, for the structural
 * fields native checks itself, with no SDK at all.
 */

function ctx(body: unknown): HandlerContext {
  return { params: {}, query: {}, body } as unknown as HandlerContext;
}

/** The message `parse` throws for `body`; fails when it accepts the body. */
function sharedRefusal(parse: (body: unknown) => unknown, body: unknown): string {
  try {
    parse(body);
  } catch (err) {
    expect((err as { code?: unknown }).code).toBe('INVALID_REQUEST');
    return (err as Error).message;
  }
  throw new Error(`the shared parser accepted ${JSON.stringify(body)}`);
}

const seventeen = Array.from({ length: 17 }, (_, i) => 300 + i);

/** Malformed bodies common to every route: body and elementIds. */
const COMMON: Array<[string, unknown]> = [
  ['body: string', 'x'],
  ['body: number', 3],
  ['body: array', [1]],
  ['body: boolean', true],
  ['elementIds: string', { elementIds: 'a' }],
  ['elementIds: object', { elementIds: { a: true } }],
  ['elementIds: number[]', { elementIds: [1] }],
  ['elementIds: mixed', { elementIds: ['a', 2] }],
];

const SNAPSHOT_ROWS: Array<[string, unknown]> = [
  ...COMMON,
  ['includePseudoElements: string', { includePseudoElements: 'yes' }],
  ['includePseudoElements: number', { includePseudoElements: 1 }],
  ['limit: 0', { limit: 0 }],
  ['limit: negative', { limit: -3 }],
  ['limit: fraction', { limit: 1.5 }],
  ['limit: string', { limit: '5' }],
  ['limit: boolean', { limit: true }],
  ['order: elementIds before includePseudoElements', { elementIds: 'a', includePseudoElements: 1 }],
  ['order: includePseudoElements before limit', { includePseudoElements: 'x', limit: 0 }],
];

const RESPONSIVE_ROWS: Array<[string, unknown]> = [
  ...COMMON,
  ['viewports: empty array', { viewports: [] }],
  ['viewports: empty object', { viewports: {} }],
  ['viewports: zero width', { viewports: [0] }],
  ['viewports: negative width', { viewports: [320, -1] }],
  ['viewports: string width', { viewports: { phone: '375' } }],
  ['viewports: string', { viewports: 'phone' }],
  ['viewports: number', { viewports: 375 }],
  ['viewports: too many', { viewports: seventeen }],
  ['budgetMs: 0', { budgetMs: 0 }],
  ['budgetMs: negative', { budgetMs: -5 }],
  ['budgetMs: string', { budgetMs: '100' }],
  ['budgetMs: infinite', { budgetMs: Number.POSITIVE_INFINITY }],
  ['limit: 0', { limit: 0 }],
  ['limit: fraction', { limit: 2.5 }],
  ['order: elementIds before viewports', { elementIds: 'a', viewports: [] }],
  ['order: viewports before budgetMs', { viewports: [], budgetMs: 0 }],
  ['order: budgetMs before limit', { budgetMs: 0, limit: 0 }],
];

/** Evaluate bodies native refuses even with no SDK (the structural fields). */
const EVALUATE_STRUCTURAL_ROWS: Array<[string, unknown]> = [
  ...COMMON,
  ['viewport: width only', { viewport: { width: 0 } }],
  ['viewport: zero height', { viewport: { width: 10, height: 0 } }],
  ['viewport: string', { viewport: '800x600' }],
  ['viewport: string width', { viewport: { width: 'a', height: 10 } }],
  ['order: elementIds before viewport', { elementIds: 'a', viewport: 'x' }],
];

const EVALUATE_ROWS: Array<[string, unknown]> = [
  ...EVALUATE_STRUCTURAL_ROWS,
  ['customContext: string', { customContext: 'mobile' }],
  ['customContext: no metrics', { customContext: { name: 'c' } }],
  ['customContext: unknown metric', { customContext: { name: 'c', metrics: { nope: {} } } }],
  [
    'customContext: bad weight',
    { customContext: { name: 'c', metrics: { contentOverflow: { weight: 'heavy' } } } },
  ],
  ['context: number', { context: 5 }],
  ['context: unknown name', { context: 'nope' }],
  ['context: inherited name', { context: 'toString' }],
  ['order: viewport before customContext', { viewport: 'x', customContext: 3 }],
  ['order: customContext before context', { customContext: 'x', context: 3 }],
];

describe('native request refusals equal the shared parsers', () => {
  const handlers = createDesignHandlers(new NativeUIBridgeRegistry(), () => ({
    width: 400,
    height: 800,
  }));

  it.each(SNAPSHOT_ROWS)(
    '/design/snapshot %s matches parseDesignSnapshotRequest',
    async (_name, body) => {
      const expected = sharedRefusal(specs.parseDesignSnapshotRequest, body);
      const res = await handlers.getDesignSnapshot(ctx(body));
      expect(res).toMatchObject({ success: false, code: 'INVALID_REQUEST', error: expected });
    }
  );

  it.each(RESPONSIVE_ROWS)(
    '/design/responsive %s matches parseResponsiveSnapshotsRequest',
    async (_name, body) => {
      const expected = sharedRefusal(specs.parseResponsiveSnapshotsRequest, body);
      const res = await handlers.getResponsiveSnapshots(ctx(body));
      expect(res).toMatchObject({ success: false, code: 'INVALID_REQUEST', error: expected });
    }
  );

  it.each(EVALUATE_ROWS)(
    '/design/evaluate %s matches parseEvaluateRequest (SDK injected)',
    async (_name, body) => {
      const withSdk = createDesignHandlers(new NativeUIBridgeRegistry(), undefined, {
        qualityEvaluator: specs as unknown as QualityEvaluatorModule,
      });
      const expected = sharedRefusal((b) => specs.parseEvaluateRequest(b, null), body);
      const res = await withSdk.evaluateQuality(ctx(body));
      expect(res).toMatchObject({ success: false, code: 'INVALID_REQUEST', error: expected });
    }
  );

  it.each(EVALUATE_STRUCTURAL_ROWS)(
    '/design/evaluate %s matches parseEvaluateRequest (no SDK)',
    async (_name, body) => {
      const noSdk = createDesignHandlers(new NativeUIBridgeRegistry(), undefined, {
        qualityEvaluator: null,
      });
      const expected = sharedRefusal((b) => specs.parseEvaluateRequest(b, null), body);
      const res = await noSdk.evaluateQuality(ctx(body));
      expect(res).toMatchObject({ success: false, code: 'INVALID_REQUEST', error: expected });
    }
  );

  it('native accepts what the shared parsers accept', async () => {
    const snapshot = { elementIds: [], includePseudoElements: true, limit: 5 };
    expect(() => specs.parseDesignSnapshotRequest(snapshot)).not.toThrow();
    expect((await handlers.getDesignSnapshot(ctx(snapshot))).success).toBe(true);
    const responsive = { viewports: { phone: 375 }, budgetMs: 1000, limit: 5 };
    expect(() => specs.parseResponsiveSnapshotsRequest(responsive)).not.toThrow();
    expect((await handlers.getResponsiveSnapshots(ctx(responsive))).success).toBe(true);
  });
});
