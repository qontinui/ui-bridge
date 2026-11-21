/**
 * The exported request parsers behind `/design/evaluate`, `/design/snapshot`
 * and `/design/responsive`: `parseEvaluateRequest`,
 * `parseDesignSnapshotRequest` and `parseResponsiveSnapshotsRequest`.
 *
 * Both web transports run them (through `evaluateRegisteredQuality`,
 * `designSnapshotOf` and `responsiveSnapshotsOf`), and the React Native
 * server holds its own refusals to them in a parity test. Each row below is
 * route × field × invalid shape and asserts the literal message, so a dropped
 * or reworded check fails here. Plan:
 * 2026-11-21-native-design-evaluate-snapshot-responsive-validate-through-the-shared-parsers.
 */

import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_CONTEXTS,
  DesignRequestError,
  MAX_RESPONSIVE_VIEWPORTS,
  QualityRequestError,
  parseDesignSnapshotRequest,
  parseEvaluateRequest,
  parseResponsiveSnapshotsRequest,
} from '../index';

/** The error `fn` throws; fails the test when it throws nothing. */
function thrown(fn: () => unknown): Error {
  try {
    fn();
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected the parser to throw');
}

const EVALUATE = '/design/evaluate';
const VIEWPORT_MSG = `${EVALUATE}: viewport must be { width, height }, each a finite number greater than 0`;
const CONTEXT_SHAPE_MSG = `${EVALUATE}: customContext must be an object with a string name and a metrics object`;

describe('parseEvaluateRequest', () => {
  const invalid: Array<[string, unknown, string]> = [
    ['body: string', 'x', `${EVALUATE}: the request body must be a JSON object`],
    ['body: array', [], `${EVALUATE}: the request body must be a JSON object`],
    [
      'elementIds: string',
      { elementIds: 'a' },
      `${EVALUATE}: elementIds must be an array of strings`,
    ],
    [
      'elementIds: number[]',
      { elementIds: [1] },
      `${EVALUATE}: elementIds must be an array of strings`,
    ],
    ['viewport: width only', { viewport: { width: 0 } }, VIEWPORT_MSG],
    ['viewport: zero height', { viewport: { width: 10, height: 0 } }, VIEWPORT_MSG],
    ['viewport: string', { viewport: '800x600' }, VIEWPORT_MSG],
    ['customContext: string', { customContext: 'mobile' }, CONTEXT_SHAPE_MSG],
    ['customContext: no metrics', { customContext: { name: 'c' } }, CONTEXT_SHAPE_MSG],
    [
      'customContext: unknown metric',
      { customContext: { name: 'c', metrics: { nope: {} } } },
      `${EVALUATE}: customContext.metrics.nope is not a quality metric (known: `,
    ],
    ['context: number', { context: 5 }, `${EVALUATE}: context must be a string`],
    [
      'context: unknown name',
      { context: 'nope' },
      `Unknown quality context: "nope". Available: ${Object.keys(BUILT_IN_CONTEXTS).join(', ')}`,
    ],
  ];

  it.each(invalid)('refuses %s with its literal message', (_name, body, message) => {
    const err = thrown(() => parseEvaluateRequest(body, null));
    expect(err).toBeInstanceOf(QualityRequestError);
    expect((err as QualityRequestError).code).toBe('INVALID_REQUEST');
    if (message.endsWith('(known: ')) expect(err.message.startsWith(message)).toBe(true);
    else expect(err.message).toBe(message);
  });

  it('refuses a body wrong in two fields for the first (elementIds before viewport)', () => {
    const err = thrown(() => parseEvaluateRequest({ elementIds: 'a', viewport: {} }, null));
    expect(err.message).toBe(`${EVALUATE}: elementIds must be an array of strings`);
  });

  it('refuses a body wrong in two fields for the first (viewport before context)', () => {
    const err = thrown(() => parseEvaluateRequest({ viewport: {}, context: 'nope' }, null));
    expect(err.message).toBe(VIEWPORT_MSG);
  });

  it('refuses an unusable context the style guide declares', () => {
    const err = thrown(() =>
      parseEvaluateRequest({ context: 'brand' }, { qualityContexts: { brand: {} as never } })
    );
    expect(err.message).toBe(
      `${EVALUATE}: quality context "brand" must be an object with a string name and a metrics object`
    );
  });

  it('leaves viewport and elementIds absent when not given, and defaults the context to general', () => {
    const parsed = parseEvaluateRequest(undefined, null);
    expect(parsed).toEqual({ context: BUILT_IN_CONTEXTS.general });
    expect('viewport' in parsed).toBe(false);
    expect(parseEvaluateRequest(null, null)).toEqual({ context: BUILT_IN_CONTEXTS.general });
  });

  it('returns what a valid body names', () => {
    const parsed = parseEvaluateRequest(
      { elementIds: ['a'], viewport: { width: 375, height: 812 }, context: 'mobile', tabId: 3 },
      null
    );
    expect(parsed).toEqual({
      elementIds: ['a'],
      viewport: { width: 375, height: 812 },
      context: BUILT_IN_CONTEXTS.mobile,
    });
  });

  it('prefers a declared style-guide context over the built-in of that name', () => {
    const brand = { name: 'mobile', description: 'mine', metrics: {} };
    const parsed = parseEvaluateRequest(
      { context: 'mobile' },
      { qualityContexts: { mobile: brand as never } }
    );
    expect(parsed.context).toBe(brand);
  });
});

const SNAPSHOT = '/design/snapshot';
const RESPONSIVE = '/design/responsive';
const VIEWPORTS_MSG =
  `${RESPONSIVE}: viewports must be a non-empty { label: width } object or width array, ` +
  'each width a finite number greater than 0';

describe('parseDesignSnapshotRequest', () => {
  const invalid: Array<[string, unknown, string]> = [
    ['body: string', 'x', `${SNAPSHOT}: the request body must be a JSON object`],
    [
      'elementIds: string',
      { elementIds: 'a' },
      `${SNAPSHOT}: elementIds must be an array of strings`,
    ],
    [
      'includePseudoElements: string',
      { includePseudoElements: 'yes' },
      `${SNAPSHOT}: includePseudoElements must be a boolean`,
    ],
    ['limit: 0', { limit: 0 }, `${SNAPSHOT}: limit must be an integer >= 1`],
    ['limit: 1.5', { limit: 1.5 }, `${SNAPSHOT}: limit must be an integer >= 1`],
    ['limit: string', { limit: '5' }, `${SNAPSHOT}: limit must be an integer >= 1`],
  ];

  it.each(invalid)('refuses %s with its literal message', (_name, body, message) => {
    const err = thrown(() => parseDesignSnapshotRequest(body));
    expect(err).toBeInstanceOf(DesignRequestError);
    expect((err as DesignRequestError).code).toBe('INVALID_REQUEST');
    expect(err.message).toBe(message);
  });

  it('refuses a body wrong in two fields for the first (includePseudoElements before limit)', () => {
    const err = thrown(() => parseDesignSnapshotRequest({ includePseudoElements: 1, limit: 0 }));
    expect(err.message).toBe(`${SNAPSHOT}: includePseudoElements must be a boolean`);
  });

  it('returns limit as given and omits what is not given', () => {
    expect(parseDesignSnapshotRequest(undefined)).toEqual({});
    expect(
      parseDesignSnapshotRequest({ elementIds: ['a'], includePseudoElements: false, limit: 3 })
    ).toEqual({ elementIds: ['a'], includePseudoElements: false, limit: 3 });
  });
});

describe('parseResponsiveSnapshotsRequest', () => {
  const tooMany = Array.from({ length: MAX_RESPONSIVE_VIEWPORTS + 1 }, (_, i) => 100 + i);
  const invalid: Array<[string, unknown, string]> = [
    ['body: array', [1], `${RESPONSIVE}: the request body must be a JSON object`],
    [
      'elementIds: object',
      { elementIds: {} },
      `${RESPONSIVE}: elementIds must be an array of strings`,
    ],
    ['viewports: empty array', { viewports: [] }, VIEWPORTS_MSG],
    ['viewports: empty object', { viewports: {} }, VIEWPORTS_MSG],
    ['viewports: zero width', { viewports: [0] }, VIEWPORTS_MSG],
    ['viewports: string width', { viewports: { phone: '375' } }, VIEWPORTS_MSG],
    [
      'viewports: too many',
      { viewports: tooMany },
      `${RESPONSIVE}: at most ${MAX_RESPONSIVE_VIEWPORTS} viewports per request (got ${tooMany.length})`,
    ],
    [
      'budgetMs: 0',
      { budgetMs: 0 },
      `${RESPONSIVE}: budgetMs must be a finite number greater than 0`,
    ],
    [
      'budgetMs: string',
      { budgetMs: '5' },
      `${RESPONSIVE}: budgetMs must be a finite number greater than 0`,
    ],
    ['limit: -1', { limit: -1 }, `${RESPONSIVE}: limit must be an integer >= 1`],
  ];

  it.each(invalid)('refuses %s with its literal message', (_name, body, message) => {
    const err = thrown(() => parseResponsiveSnapshotsRequest(body));
    expect(err).toBeInstanceOf(DesignRequestError);
    expect((err as DesignRequestError).code).toBe('INVALID_REQUEST');
    expect(err.message).toBe(message);
  });

  it('refuses a body wrong in two fields for the first (viewports before budgetMs before limit)', () => {
    expect(
      thrown(() => parseResponsiveSnapshotsRequest({ viewports: [], budgetMs: 0 })).message
    ).toBe(VIEWPORTS_MSG);
    expect(thrown(() => parseResponsiveSnapshotsRequest({ budgetMs: 0, limit: 0 })).message).toBe(
      `${RESPONSIVE}: budgetMs must be a finite number greater than 0`
    );
  });

  it('defaults viewports and returns the rest as given', () => {
    const parsed = parseResponsiveSnapshotsRequest({});
    expect(Object.keys(parsed)).toEqual(['viewports']);
    expect(Object.keys(parsed.viewports).length).toBeGreaterThan(0);
    expect(
      parseResponsiveSnapshotsRequest({ viewports: [320, 1024], budgetMs: 500, limit: 2 })
    ).toEqual({ viewports: [320, 1024], budgetMs: 500, limit: 2 });
  });
});
