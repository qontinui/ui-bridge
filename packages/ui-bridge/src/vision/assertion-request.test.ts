/**
 * `/vision/assert` body validation: the same acceptance set as vision-core's
 * serde deserializer, so the runner and the SDK refuse the same bodies, and
 * every accepted assertion is normalized to the echo vision-core serializes.
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_VISION_ASSERTIONS,
  MAX_VISION_LIST,
  MAX_VISION_STRING,
  VISION_ASSERTION_KINDS,
  VisionAssertRequestError,
  parseVisionAssertRequest,
  parseVisionAssertion,
} from './assertion-request';

/** A minimal valid body for each of the 23 kinds, and its normalized echo. */
const MINIMAL: Array<[Record<string, unknown>, Record<string, unknown>]> = [
  [
    { type: 'no_overlap', elements: ['a', 'b'] },
    { type: 'no_overlap', elements: ['a', 'b'], tolerance_px: null },
  ],
  [
    { type: 'element_above', elements: ['a', 'b'] },
    { type: 'element_above', elements: ['a', 'b'], require_overlap: true },
  ],
  [
    { type: 'contains_text', target: { element: 'a' }, text: 'Hi' },
    { type: 'contains_text', target: { element: 'a' }, text: 'Hi', kind: 'contains' },
  ],
  [
    { type: 'text_fits_container', element: 'a' },
    { type: 'text_fits_container', element: 'a' },
  ],
  [
    { type: 'aligned_horizontally', elements: ['a'] },
    { type: 'aligned_horizontally', elements: ['a'], axis_tolerance_px: null },
  ],
  [
    { type: 'aligned_vertically', elements: [] },
    { type: 'aligned_vertically', elements: [], axis_tolerance_px: null },
  ],
  [
    { type: 'color_within', element: 'a', expected: { r: 1, g: 2, b: 3 } },
    { type: 'color_within', element: 'a', expected: { r: 1, g: 2, b: 3 }, delta_e_max: null },
  ],
  [
    { type: 'typography_consistent', elements: ['a', 'b'] },
    { type: 'typography_consistent', elements: ['a', 'b'], dimensions: [] },
  ],
  [
    { type: 'no_layout_shift_since', baseline: 'base' },
    { type: 'no_layout_shift_since', baseline: 'base', tolerance_px: null },
  ],
  [{ type: 'no_clipping' }, { type: 'no_clipping', region: null }],
  [{ type: 'animation_settled' }, { type: 'animation_settled', region: null }],
  [
    { type: 'settled_within', ms: 250 },
    { type: 'settled_within', ms: 250 },
  ],
  [
    { type: 'state_entered_within', state: 'open', ms: 0 },
    { type: 'state_entered_within', state: 'open', ms: 0 },
  ],
  [
    { type: 'contrast_meets_wcag', element: 'a' },
    { type: 'contrast_meets_wcag', element: 'a', level: 'aa' },
  ],
  [
    { type: 'image_palette_within', element: 'a', palette: [] },
    {
      type: 'image_palette_within',
      element: 'a',
      palette: [],
      max_delta_e: null,
      min_coverage: null,
    },
  ],
  [{ type: 'no_near_duplicate_images' }, { type: 'no_near_duplicate_images', max_hamming: null }],
  [{ type: 'no_placeholder_images' }, { type: 'no_placeholder_images', element: null }],
  [
    { type: 'image_focal_visible', element: 'a', focal: { x: 0, y: 0, width: 1, height: 1 } },
    { type: 'image_focal_visible', element: 'a', focal: { x: 0, y: 0, width: 1, height: 1 } },
  ],
  [
    { type: 'transparent_image_legible', element: 'a' },
    { type: 'transparent_image_legible', element: 'a', min_ratio: null },
  ],
  [
    { type: 'salience_order', cta_id: 'cta' },
    { type: 'salience_order', cta_id: 'cta' },
  ],
  [
    { type: 'image_sharpness_at_least', element: 'a' },
    { type: 'image_sharpness_at_least', element: 'a', min_sharpness: null },
  ],
  [
    { type: 'image_blockiness_within', element: 'a' },
    { type: 'image_blockiness_within', element: 'a', max_blockiness: null },
  ],
  [
    { type: 'text_over_image_contrast' },
    { type: 'text_over_image_contrast', min_ratio: null, percentile: null },
  ],
];

function refusal(body: unknown): string {
  try {
    parseVisionAssertRequest(body);
  } catch (err) {
    expect(err).toBeInstanceOf(VisionAssertRequestError);
    expect((err as VisionAssertRequestError).code).toBe('INVALID_REQUEST');
    return (err as Error).message;
  }
  throw new Error(`accepted: ${JSON.stringify(body)}`);
}

describe('parseVisionAssertRequest', () => {
  it('accepts all 23 vision-core kinds, and only those', () => {
    expect(VISION_ASSERTION_KINDS).toHaveLength(23);
    expect(MINIMAL.map(([body]) => body.type)).toEqual([...VISION_ASSERTION_KINDS]);
  });

  it.each(MINIMAL)('normalizes %j to the echo vision-core serializes', (body, echo) => {
    expect(parseVisionAssertion(body)).toEqual(echo);
  });

  it('keeps every given optional value', () => {
    expect(
      parseVisionAssertion({
        type: 'element_above',
        elements: ['a', 'b'],
        require_overlap: false,
      })
    ).toEqual({ type: 'element_above', elements: ['a', 'b'], require_overlap: false });
    expect(
      parseVisionAssertion({
        type: 'no_clipping',
        region: { x: -4, y: 0, w: 10, h: 20 },
      })
    ).toEqual({ type: 'no_clipping', region: { x: -4, y: 0, w: 10, h: 20 } });
    expect(
      parseVisionAssertion({ type: 'contrast_meets_wcag', element: 'a', level: 'aaa' })
    ).toEqual({ type: 'contrast_meets_wcag', element: 'a', level: 'aaa' });
  });

  it('ignores keys vision-core does not read — settle_frames among them, as serde does', () => {
    expect(
      parseVisionAssertion({ type: 'animation_settled', settle_frames: 3, extra: true })
    ).toEqual({ type: 'animation_settled', region: null });
    expect(
      parseVisionAssertRequest({
        assertions: [],
        tabId: 'tab-1',
        target: 'device-1',
        ocr_blocks: [],
        timelineRef: 'edge-1',
      })
    ).toEqual({ assertions: [] });
  });

  it('reads contains_text targets the way the untagged TextTarget does: element first', () => {
    expect(
      parseVisionAssertion({
        type: 'contains_text',
        target: { element: 'a', region: { x: 0, y: 0, w: 1, h: 1 } },
        text: 'x',
      })
    ).toMatchObject({ target: { element: 'a' } });
    expect(
      parseVisionAssertion({
        type: 'contains_text',
        target: { region: { x: 0, y: 0, w: 1, h: 1 } },
        text: 'x',
        kind: 'exact',
      })
    ).toMatchObject({ target: { region: { x: 0, y: 0, w: 1, h: 1 } }, kind: 'exact' });
  });

  it('accepts an empty list: it answers unknown(no_results), it is not malformed', () => {
    expect(parseVisionAssertRequest({ assertions: [] })).toEqual({ assertions: [] });
  });

  it.each([
    [undefined, 'request body must be a JSON object'],
    ['assert', 'request body must be a JSON object'],
    [[], 'request body must be a JSON object'],
    [{}, '`assertions` is required and must be an array'],
    [{ assertions: null }, '`assertions` is required and must be an array'],
    [{ assertions: { type: 'no_clipping' } }, '`assertions` is required and must be an array'],
    [{ assertions: [null] }, 'assertions[0] must be an object with a `type`'],
    [{ assertions: [{ type: 'no_overlapping' }] }, 'assertions[0].type must be one of'],
    [{ assertions: [{ elements: ['a', 'b'] }] }, 'assertions[0].type must be one of'],
    [
      { assertions: [{ type: 'no_overlap', elements: ['a'] }] },
      'assertions[0].elements must be an array of exactly 2 strings',
    ],
    [
      { assertions: [{ type: 'no_overlap', elements: ['a', 'b', 'c'] }] },
      'assertions[0].elements must be an array of exactly 2 strings',
    ],
    [
      { assertions: [{ type: 'element_above', elements: ['a', 2] }] },
      'assertions[0].elements must be an array of exactly 2 strings',
    ],
    [
      { assertions: [{ type: 'no_overlap', elements: ['a', 'b'], tolerance_px: -1 }] },
      'assertions[0].tolerance_px must be an integer from 0 to 4294967295',
    ],
    [
      { assertions: [{ type: 'no_overlap', elements: ['a', 'b'], tolerance_px: 1.5 }] },
      'assertions[0].tolerance_px must be an integer',
    ],
    [
      { assertions: [{ type: 'element_above', elements: ['a', 'b'], require_overlap: null }] },
      'assertions[0].require_overlap must be a boolean',
    ],
    [
      { assertions: [{ type: 'contrast_meets_wcag', element: 'a', level: 'AA' }] },
      'assertions[0].level must be one of aa, aaa',
    ],
    [
      { assertions: [{ type: 'contrast_meets_wcag', element: 'a', level: null }] },
      'assertions[0].level must be one of aa, aaa',
    ],
    [{ assertions: [{ type: 'contrast_meets_wcag' }] }, 'assertions[0].element must be a string'],
    [
      { assertions: [{ type: 'text_fits_container', element: 7 }] },
      'assertions[0].element must be a string',
    ],
    [
      { assertions: [{ type: 'no_clipping', region: { x: 0.5, y: 0, w: 1, h: 1 } }] },
      'assertions[0].region must be a region',
    ],
    [
      { assertions: [{ type: 'no_clipping', region: { x: 0, y: 0, w: -1, h: 1 } }] },
      'assertions[0].region must be a region',
    ],
    [
      { assertions: [{ type: 'color_within', element: 'a', expected: { r: 256, g: 0, b: 0 } }] },
      'assertions[0].expected must be a colour',
    ],
    [
      { assertions: [{ type: 'contains_text', target: {}, text: 'x' }] },
      'assertions[0].target must be { element } or { region }',
    ],
    [
      { assertions: [{ type: 'typography_consistent', elements: [], dimensions: ['weight'] }] },
      'assertions[0].dimensions must be an array of font_family, font_size, line_height',
    ],
    [{ assertions: [{ type: 'settled_within', ms: -5 }] }, 'assertions[0].ms must be an integer'],
    [
      { assertions: [{ type: 'image_palette_within', element: 'a', palette: [{ r: 1 }] }] },
      'assertions[0].palette[0] must be a colour',
    ],
  ])('refuses %j: %s', (body, message) => {
    expect(refusal(body)).toContain(message);
  });

  it('names the failing assertion by its index', () => {
    expect(
      refusal({
        assertions: [
          { type: 'no_clipping' },
          { type: 'no_overlap', elements: ['a', 'b'] },
          { type: 'text_fits_container' },
        ],
      })
    ).toContain('/vision/assert: assertions[2].element must be a string');
  });

  it('refuses a caller snapshot: the in-tab evaluator measures the page, not a snapshot', () => {
    const message = refusal({ assertions: [], snapshot: { elements: [] } });
    expect(message).toContain('`snapshot` is a runner input');
    expect(message).toContain('POST /ui-bridge/vision/assert');
    // JSON null is "not given".
    expect(parseVisionAssertRequest({ assertions: [], snapshot: null })).toEqual({
      assertions: [],
    });
  });

  it(`refuses more than ${MAX_VISION_ASSERTIONS} assertions in one request`, () => {
    const assertions = Array.from({ length: MAX_VISION_ASSERTIONS + 1 }, () => ({
      type: 'no_clipping',
    }));
    expect(refusal({ assertions })).toContain('exceed the in-tab limit');
    expect(parseVisionAssertRequest({ assertions: assertions.slice(1) }).assertions).toHaveLength(
      MAX_VISION_ASSERTIONS
    );
  });
});

describe('what the relay forwards into a tab is bounded', () => {
  const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `id-${i}`);
  const colours = (n: number) => Array.from({ length: n }, () => ({ r: 0, g: 0, b: 0 }));

  /** Every list field, built with `n` entries, and the key a refusal names. */
  const LISTS: Array<[string, (n: number) => Record<string, unknown>, string]> = [
    [
      'aligned_horizontally.elements',
      (n) => ({ type: 'aligned_horizontally', elements: ids(n) }),
      'elements',
    ],
    [
      'aligned_vertically.elements',
      (n) => ({ type: 'aligned_vertically', elements: ids(n) }),
      'elements',
    ],
    [
      'typography_consistent.elements',
      (n) => ({ type: 'typography_consistent', elements: ids(n) }),
      'elements',
    ],
    [
      'typography_consistent.dimensions',
      (n) => ({
        type: 'typography_consistent',
        elements: [],
        dimensions: Array.from({ length: n }, () => 'font_size'),
      }),
      'dimensions',
    ],
    [
      'image_palette_within.palette',
      (n) => ({ type: 'image_palette_within', element: 'a', palette: colours(n) }),
      'palette',
    ],
  ];

  it.each(LISTS)(`%s holds at most ${MAX_VISION_LIST} entries`, (_name, build, key) => {
    expect(parseVisionAssertion(build(MAX_VISION_LIST))).toMatchObject({
      [key]: expect.any(Array),
    });
    expect(refusal({ assertions: [build(MAX_VISION_LIST + 1)] })).toContain(
      `assertions[0].${key} must hold at most ${MAX_VISION_LIST} entries ` +
        `(got ${MAX_VISION_LIST + 1})`
    );
  });

  /** Every string field, built holding `s`, and the refusal it draws. */
  const STRINGS: Array<[string, (s: string) => Record<string, unknown>, string]> = [
    [
      'an element id',
      (s) => ({ type: 'text_fits_container', element: s }),
      'element must be at most',
    ],
    [
      'an optional element id',
      (s) => ({ type: 'no_placeholder_images', element: s }),
      'element must be at most',
    ],
    [
      'a contains_text target',
      (s) => ({ type: 'contains_text', target: { element: s }, text: 'x' }),
      'target.element must be at most',
    ],
    [
      'a contains_text text',
      (s) => ({ type: 'contains_text', target: { element: 'a' }, text: s }),
      'text must be at most',
    ],
    [
      'a state name',
      (s) => ({ type: 'state_entered_within', state: s, ms: 0 }),
      'state must be at most',
    ],
    [
      'a baseline name',
      (s) => ({ type: 'no_layout_shift_since', baseline: s }),
      'baseline must be at most',
    ],
    ['a CTA id', (s) => ({ type: 'salience_order', cta_id: s }), 'cta_id must be at most'],
    [
      'one id of a pair',
      (s) => ({ type: 'no_overlap', elements: ['a', s] }),
      'elements must hold strings of at most',
    ],
    [
      'one id of a list',
      (s) => ({ type: 'aligned_horizontally', elements: ['a', s] }),
      'elements must hold strings of at most',
    ],
  ];

  it.each(STRINGS)(`%s is at most ${MAX_VISION_STRING} characters`, (_name, build, message) => {
    expect(() => parseVisionAssertion(build('a'.repeat(MAX_VISION_STRING)))).not.toThrow();
    const refused = refusal({ assertions: [build('q'.repeat(MAX_VISION_STRING + 1))] });
    expect(refused).toContain(`assertions[0].${message} ${MAX_VISION_STRING} characters`);
    // The refusal names the bound, not the value it refused.
    expect(refused).not.toContain('qqqq');
  });

  it('a refusal echoes at most 64 characters of what the caller sent', () => {
    const long = refusal({ assertions: [{ type: 'z'.repeat(100_000) }] });
    expect(long).toContain(`(got "${'z'.repeat(64)}…")`);
    expect(long).not.toContain('z'.repeat(65));
    expect(long.length).toBeLessThan(1_000);

    const secret = refusal({ assertions: [{ type: { token: 'hunter2' } }] });
    expect(secret).toContain('(got an object)');
    expect(secret).not.toContain('hunter2');
    expect(refusal({ assertions: [{ type: ['no_overlap'] }] })).toContain('(got an array)');
    expect(refusal({ assertions: [{ type: 7 }] })).toContain('(got a number)');
    expect(refusal({ assertions: [{ type: null }] })).toContain('(got null)');
    expect(refusal({ assertions: [{ elements: ['a', 'b'] }] })).toContain('(got nothing)');
    expect(refusal({ assertions: [{ type: 'no_overlapping' }] })).toContain(
      '(got "no_overlapping")'
    );
  });

  it.each(MINIMAL)(
    'the normalized %j parses to itself: the tab re-validates what the relay forwards',
    (body) => {
      const once = parseVisionAssertion(body);
      expect(parseVisionAssertion(once)).toEqual(once);
    }
  );
});
