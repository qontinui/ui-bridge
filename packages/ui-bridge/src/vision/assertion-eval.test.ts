/**
 * The pure evaluator's tab-only branches, which a vision-core snapshot cannot
 * reach and the conformance fixture therefore does not cover: the hit-test
 * paint-order evidence, the measured fit box and clip, the measured reasons
 * an unknown names, the kinds the tab does not implement, and the roll-up.
 * vision-core's own semantics are pinned by `assertion-eval.conformance.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import {
  echoText,
  evalInputFromVisionCoreSnapshot,
  evaluateVisionAssertion,
  foldVisionOutcomes,
  isLargeText,
  paintOrderKey,
  snapshotCoverageOf,
  VisionCoreSnapshotError,
  wcagMinimumRatio,
  type MeasuredElement,
  type PaintOrderEvidence,
  type VisionEvalInput,
} from './assertion-eval';
import { parseVisionAssertion } from './assertion-request';
import type { VisionAssertionResult } from './wire';

function evaluate(
  raw: Record<string, unknown>,
  input: VisionEvalInput | null
): VisionAssertionResult {
  return evaluateVisionAssertion(parseVisionAssertion(raw), input);
}

const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

describe('element_above — the tab hit test', () => {
  const pair: MeasuredElement[] = [
    { id: 'menu', bbox: box(0, 0, 100, 100) },
    { id: 'panel', bbox: box(50, 50, 100, 100) },
  ];
  const withEvidence = (evidence: PaintOrderEvidence): VisionEvalInput => ({
    elements: pair,
    paintOrder: new Map([[paintOrderKey('menu', 'panel'), evidence]]),
  });
  const assertion = { type: 'element_above', elements: ['menu', 'panel'] };

  it('passes when the hit test put the first element above at every sample', () => {
    const r = evaluate(assertion, withEvidence({ kind: 'above', samples: 9 }));
    expect(r).toMatchObject({ outcome: 'passed', passed: true, confidence: null });
    expect(r.detail).toContain('all 9 sample point(s)');
  });

  it('fails, naming the point, when the second element painted above at any sample', () => {
    const r = evaluate(
      assertion,
      withEvidence({ kind: 'below', at: { x: 75.5, y: 60 }, samples: 4 })
    );
    expect(r.outcome).toBe('failed');
    expect(r.code).toBeUndefined();
    expect(r.detail).toContain("at (75.5, 60) the tab's hit test");
  });

  it('fails when both operands are one element', () => {
    expect(evaluate(assertion, withEvidence({ kind: 'equal' })).outcome).toBe('failed');
  });

  it('is unknown{hit_test_unmeasurable} when no sample showed both', () => {
    const r = evaluate(
      assertion,
      withEvidence({ kind: 'unmeasurable', detail: 'their shared area lies outside the viewport' })
    );
    expect(r).toMatchObject({ outcome: 'unknown', code: 'hit_test_unmeasurable', passed: false });
    expect(r.detail).toContain('outside the viewport');
  });

  it('still fails a disjoint pair before any evidence is read, as vision-core orders it', () => {
    const disjoint: VisionEvalInput = {
      elements: [
        { id: 'menu', bbox: box(0, 0, 10, 10) },
        { id: 'panel', bbox: box(20, 20, 10, 10) },
      ],
      paintOrder: new Map([[paintOrderKey('menu', 'panel'), { kind: 'above', samples: 1 }]]),
    };
    expect(evaluate(assertion, disjoint).outcome).toBe('failed');
  });

  it('is unknown{hit_test_unmeasurable} with no paint-order evidence at all, as vision-core answers it', () => {
    // No hit test, no attribution about the pair (one names a third element),
    // and a paint rank on one operand only.
    const r = evaluate(assertion, {
      elements: [
        { ...pair[0], occludedBy: 'toast' },
        { ...pair[1], zIndex: 4 },
      ],
    });
    expect(r).toMatchObject({ outcome: 'unknown', code: 'hit_test_unmeasurable', passed: false });
    expect(r.detail).toContain(
      'No `occluded_by` attribution names either element as painting over the other, and ' +
        "`z_index` is missing on 'menu'."
    );
    // Without geometry either, when the overlap is not required.
    const bare = evaluate(
      { ...assertion, require_overlap: false },
      { elements: [{ id: 'menu' }, { id: 'panel' }] }
    );
    expect(bare).toMatchObject({ outcome: 'unknown', code: 'hit_test_unmeasurable' });
    expect(bare.detail).toContain("`z_index` is missing on both 'menu' and 'panel'");
    // A missing operand stays input_missing.
    expect(evaluate(assertion, { elements: [pair[0]] })).toMatchObject({
      outcome: 'unknown',
      code: 'input_missing',
    });
  });

  it('a producer attribution outranks the hit test, as it outranks z_index', () => {
    const attributed: VisionEvalInput = {
      elements: [pair[0], { ...pair[1], occludedBy: 'menu' }],
      paintOrder: new Map([
        [paintOrderKey('menu', 'panel'), { kind: 'below', at: { x: 1, y: 1 }, samples: 1 }],
      ]),
    };
    expect(evaluate(assertion, attributed).outcome).toBe('passed');
  });
});

describe('text_fits_container — the measured fit box', () => {
  it('compares the scroll extents with the fit box, not the bbox, when the tab measured one', () => {
    const el: MeasuredElement = {
      id: 'label',
      text: 'A long product name',
      bbox: box(0, 0, 120, 20),
      fitBox: { w: 100, h: 20 },
      scrollWidthPx: 110,
      scrollHeightPx: 20,
      textOverflow: 'ellipsis',
    };
    const r = evaluate({ type: 'text_fits_container', element: 'label' }, { elements: [el] });
    expect(r.outcome).toBe('failed');
    expect(r.detail).toContain(
      'text is ellipsised: content is 110px wide but the box is only 100px'
    );
    expect(r.detail).toContain('Text: "A long product name"');
  });

  it("computes the vertical estimate's needed height in f32, as vision-core does", () => {
    // 10.666667 * 1.5 is 16.0000005 in f64 (ceil 17) but rounds to 16 in f32
    // (ceil 16): a 16px-tall box fits by vision-core's arithmetic.
    expect(Math.ceil(10.666667 * 1.5)).toBe(17);
    const el: MeasuredElement = {
      id: 'label',
      text: 'x',
      bbox: box(0, 0, 40, 16),
      scrollWidthPx: 40,
      fontSizePx: 10.666667,
    };
    const r = evaluate({ type: 'text_fits_container', element: 'label' }, { elements: [el] });
    expect(r.outcome).toBe('passed');
    expect(r.detail).toContain('vertical fit ESTIMATED');
    expect(
      evaluate(
        { type: 'text_fits_container', element: 'label' },
        { elements: [{ ...el, bbox: box(0, 0, 40, 15) }] }
      ).outcome
    ).toBe('failed');
  });

  it('an element with no text is unknown — nothing was there to fit', () => {
    const r = evaluate(
      { type: 'text_fits_container', element: 'icon' },
      { elements: [{ id: 'icon', bbox: box(0, 0, 10, 10), scrollWidthPx: 10, scrollHeightPx: 10 }] }
    );
    expect(r).toMatchObject({ outcome: 'unknown', code: 'input_missing' });
    expect(r.detail).toContain('carries no text');
  });

  it('names what the tab could not measure', () => {
    const el: MeasuredElement = {
      id: 'label',
      text: 'x',
      bbox: box(0, 0, 10, 10),
      unmeasured: { textFit: { code: 'input_missing', detail: 'no block-level box' } },
    };
    expect(
      evaluate({ type: 'text_fits_container', element: 'label' }, { elements: [el] })
    ).toMatchObject({
      outcome: 'unknown',
      code: 'input_missing',
      detail: 'no block-level box',
    });
  });
});

describe('no_clipping — the measured clip', () => {
  it('checks each axis against its own clip and names the ancestor that clips it', () => {
    const el: MeasuredElement = {
      id: 'row',
      bbox: box(0, 90, 50, 20),
      clip: {
        left: -Infinity,
        right: Infinity,
        top: 0,
        bottom: 100,
        byX: '',
        byY: "the vertical clip of 'list'",
      },
    };
    const r = evaluate({ type: 'no_clipping' }, { elements: [el] });
    expect(r.outcome).toBe('failed');
    expect(r.detail).toBe("element 'row' extends past the vertical clip of 'list'");
  });

  it('an element nothing clips is no compared pair: zero pairs is unknown, never a vacuous pass', () => {
    const r = evaluate(
      { type: 'no_clipping' },
      { elements: [{ id: 'a', bbox: box(-50, -50, 10, 10), clip: null }] }
    );
    expect(r).toMatchObject({ outcome: 'unknown', code: 'input_missing' });
    expect(r.detail).toContain('no child/parent pair was compared');
  });

  it('a region scopes which pairs are compared; it does not clip them', () => {
    const clipped: MeasuredElement = {
      id: 'far',
      bbox: box(500, 500, 50, 50),
      clip: { left: 500, top: 500, right: 520, bottom: 520, byX: 'p', byY: 'p' },
    };
    const fitting: MeasuredElement = {
      id: 'near',
      bbox: box(10, 10, 20, 20),
      clip: { left: 0, top: 0, right: 100, bottom: 100, byX: 'q', byY: 'q' },
    };
    const input = { elements: [clipped, fitting] };
    // Only the fitting pair is in scope: compared, and it fits.
    expect(
      evaluate({ type: 'no_clipping', region: { x: 0, y: 0, w: 100, h: 100 } }, input).outcome
    ).toBe('passed');
    expect(
      evaluate({ type: 'no_clipping', region: { x: 510, y: 510, w: 5, h: 5 } }, input).outcome
    ).toBe('failed');
    // No pair in scope at all: nothing was compared.
    expect(
      evaluate({ type: 'no_clipping', region: { x: 300, y: 0, w: 10, h: 10 } }, input)
    ).toMatchObject({ outcome: 'unknown', code: 'input_missing' });
  });
});

describe('the rounding contract — unrounded boxes, each kind rounding its own way', () => {
  const fits = (el: MeasuredElement) =>
    evaluate({ type: 'text_fits_container', element: el.id }, { elements: [el] });

  it('text_fits_container rounds its comparison box UP, here and not in the producer', () => {
    const label = (w: number, sw: number): MeasuredElement => ({
      id: 'label',
      text: 'Name',
      bbox: box(0, 0, w, 20),
      fitBox: { w, h: 20 },
      scrollWidthPx: sw,
      scrollHeightPx: 20,
    });
    // A 100.2px box is 101px to the fit: 101px of content fits, 102px does not.
    expect(fits(label(100.2, 101)).outcome).toBe('passed');
    const r = fits(label(100.2, 102));
    expect(r.outcome).toBe('failed');
    expect(r.detail).toContain('content is 102px wide but the box is only 101px (1px hidden)');
    // A snapshot's bbox is read the same way when no fit box was measured.
    const { fitBox: _omit, ...fromBbox } = label(100.2, 101);
    expect(fits(fromBbox).outcome).toBe('passed');
  });

  it('the geometry kinds round every box to the nearest pixel, never up', () => {
    const overlap = (a: MeasuredElement, b: MeasuredElement) =>
      evaluate({ type: 'no_overlap', elements: [a.id, b.id] }, { elements: [a, b] }).outcome;
    // Three 33.333px flex items: rounded up, each would overlap the next.
    const third = (i: number): MeasuredElement => ({
      id: `t${i}`,
      bbox: box((100 / 3) * i, 0, 100 / 3, 20),
    });
    expect(overlap(third(0), third(1))).toBe('passed');
    expect(overlap(third(1), third(2))).toBe('passed');
    // 0.1px of overlap is not a pixel: the boxes round to [0, 10) and [10, 20).
    expect(
      overlap({ id: 'a', bbox: box(0, 0, 10.3, 10) }, { id: 'b', bbox: box(10.2, 0, 10, 10) })
    ).toBe('passed');
    // 10.6px wide rounds to 11, 10.4px across to 10: a pixel of overlap.
    expect(
      overlap({ id: 'a', bbox: box(0, 0, 10.6, 10) }, { id: 'b', bbox: box(10.4, 0, 10, 10) })
    ).toBe('failed');
  });

  it('each EDGE is rounded, never the size on its own, so a shared edge stays shared', () => {
    // a ends where b starts, at 11.2. Edge by edge: a is [1, 11) and b is
    // [11, 16), touching. Field by field, a would be x 1 + w 11 = [1, 12) and
    // overlap b by a phantom pixel.
    const a: MeasuredElement = { id: 'a', bbox: box(0.6, 0, 10.6, 10) };
    const b: MeasuredElement = { id: 'b', bbox: box(11.2, 0, 5, 10) };
    expect(
      evaluate({ type: 'no_overlap', elements: ['a', 'b'] }, { elements: [a, b] }).outcome
    ).toBe('passed');
    // The same rule for a clip: the box's right edge 109.9 and the clip's
    // 109.6 both land on 110.
    const row: MeasuredElement = {
      id: 'row',
      bbox: box(10.4, 0, 99.5, 50),
      clip: { left: 10.2, top: 0, right: 109.6, bottom: 50, byX: 'p', byY: 'p' },
    };
    expect(evaluate({ type: 'no_clipping' }, { elements: [row] }).outcome).toBe('passed');
  });

  it('a half rounds toward +∞, as Math.round and vision-core round it', () => {
    // a's left edge, -10.5, snaps to -10 and only touches b's [-20, -10).
    // Away from zero (Rust's f64::round) it would be -11, a pixel into b.
    const a: MeasuredElement = { id: 'a', bbox: box(-10.5, 0, 5, 10) };
    const b: MeasuredElement = { id: 'b', bbox: box(-20, 0, 9.6, 10) };
    expect(
      evaluate({ type: 'no_overlap', elements: ['a', 'b'] }, { elements: [a, b] }).outcome
    ).toBe('passed');
  });

  it('element_above requires the overlap of the rounded boxes', () => {
    const pair: MeasuredElement[] = [
      { id: 'menu', bbox: box(0, 0, 10.3, 10) },
      { id: 'panel', bbox: box(10.2, 0, 10, 10) },
    ];
    const r = evaluate(
      { type: 'element_above', elements: ['menu', 'panel'] },
      {
        elements: pair,
        paintOrder: new Map([[paintOrderKey('menu', 'panel'), { kind: 'above', samples: 1 }]]),
      }
    );
    expect(r.outcome).toBe('failed');
    expect(r.detail).toContain('do not overlap');
  });

  it('no_clipping rounds the box and its clip alike', () => {
    // Exactly, the box pokes 0.1px left of the clip and 0.3px past its right
    // edge; to the nearest pixel both are [10, 110).
    const el: MeasuredElement = {
      id: 'row',
      bbox: box(9.7, 0, 100.2, 50),
      clip: { left: 9.6, top: 0, right: 109.6, bottom: 50, byX: 'p', byY: 'p' },
    };
    expect(evaluate({ type: 'no_clipping' }, { elements: [el] }).outcome).toBe('passed');
    const over: MeasuredElement = { ...el, bbox: box(9.7, 0, 101.2, 50) };
    expect(evaluate({ type: 'no_clipping' }, { elements: [over] }).outcome).toBe('failed');
  });

  it("a vision-core snapshot's bbox reaches the evaluator unrounded, and a negative size is refused", () => {
    const snapshot = (bbox: Record<string, number>) => ({
      elements: [{ id: 'label', bbox, scroll_width_px: 120, scroll_height_px: 20, text: 'Name' }],
    });
    // 119.4 wide holds 120px of content only if nothing rounded the box to
    // the nearest pixel before text_fits_container rounded it up.
    const input = evalInputFromVisionCoreSnapshot(snapshot({ x: 0.5, y: 0, w: 119.4, h: 20 }));
    expect(input?.elements[0].bbox).toEqual({ x: 0.5, y: 0, w: 119.4, h: 20 });
    expect(evaluate({ type: 'text_fits_container', element: 'label' }, input).outcome).toBe(
      'passed'
    );
    for (const bad of [
      { x: 0, y: 0, w: -5, h: 10 },
      { x: 0, y: 0, w: 5, h: -0.5 },
    ]) {
      expect(() => evalInputFromVisionCoreSnapshot(snapshot(bad))).toThrow(VisionCoreSnapshotError);
    }
  });
});

describe('contrast_meets_wcag — the measured reasons', () => {
  it('an unmeasured colour answers with the reason the tab measured', () => {
    const el: MeasuredElement = {
      id: 'hero',
      unmeasured: {
        color: {
          code: 'input_missing',
          detail: 'the background-image of <div.hero> lies beneath the text',
        },
      },
    };
    expect(
      evaluate({ type: 'contrast_meets_wcag', element: 'hero' }, { elements: [el] })
    ).toMatchObject({
      outcome: 'unknown',
      code: 'input_missing',
      detail: 'the background-image of <div.hero> lies beneath the text',
    });
  });

  it('applies the large-text thresholds the measured size and weight call for', () => {
    // #949494 on white is 3.03:1: large text passes AA, normal text does not.
    const el = (fontSizePx: number, fontWeight?: number): VisionEvalInput => ({
      elements: [
        {
          id: 't',
          fgColor: { r: 148, g: 148, b: 148 },
          bgColor: { r: 255, g: 255, b: 255 },
          fontSizePx,
          fontWeight,
        },
      ],
    });
    const aa = { type: 'contrast_meets_wcag', element: 't' };
    expect(evaluate(aa, el(24)).outcome).toBe('passed');
    expect(evaluate(aa, el(16, 700)).outcome).toBe('failed');
    expect(evaluate(aa, el(18.67, 700)).outcome).toBe('passed');
    expect(evaluate(aa, el(18.67, 400)).outcome).toBe('failed');
    expect(evaluate({ ...aa, level: 'aaa' }, el(24)).outcome).toBe('failed');
  });

  it('compares the thresholds in f32, as vision-core does', () => {
    // 18.6599999 is a different f64 from 18.66 but the same f32: vision-core
    // reads it as large, and so must the port.
    expect(18.6599999 < 18.66).toBe(true);
    expect(isLargeText(18.6599999, 700)).toBe(true);
    expect(isLargeText(18.65, 700)).toBe(false);
    // Within half an f32 ulp of 24 (≈9.5e-7) is 24 in f32; just past it is not.
    expect(isLargeText(23.9999995, undefined)).toBe(true);
    expect(isLargeText(23.999999, undefined)).toBe(false);
    expect(isLargeText(undefined, 900)).toBe(false);
    expect(wcagMinimumRatio('aa', false)).toBe(4.5);
    expect(wcagMinimumRatio('aa', true)).toBe(3);
    expect(wcagMinimumRatio('aaa', false)).toBe(7);
    expect(wcagMinimumRatio('aaa', true)).toBe(4.5);
  });
});

describe('kinds the tab does not implement', () => {
  it.each([
    { type: 'contains_text', target: { element: 'a' }, text: 'x' },
    { type: 'color_within', element: 'a', expected: { r: 0, g: 0, b: 0 } },
    { type: 'animation_settled' },
    { type: 'image_palette_within', element: 'a', palette: [] },
    { type: 'text_over_image_contrast' },
  ])(
    '$type is unknown{capability_unavailable_in_build}, naming the runner and vision-audit',
    (raw) => {
      const r = evaluate(raw, { elements: [] });
      expect(r).toMatchObject({
        outcome: 'unknown',
        passed: false,
        code: 'capability_unavailable_in_build',
        confidence: null,
      });
      expect(r.detail).toContain('POST /ui-bridge/vision/assert');
      expect(r.detail).toContain('vision-audit assert');
    }
  );

  it('a snapshot-reading kind with no snapshot at all is unknown{input_missing}', () => {
    expect(evaluate({ type: 'no_clipping' }, null)).toMatchObject({
      outcome: 'unknown',
      code: 'input_missing',
    });
  });
});

describe('foldVisionOutcomes', () => {
  const r = (outcome: VisionAssertionResult['outcome'], code?: VisionAssertionResult['code']) => ({
    outcome,
    code,
  });

  it('an empty list is unknown with no_results — nothing was judged, so never a pass', () => {
    expect(foldVisionOutcomes([])).toEqual({
      outcome: 'unknown',
      outcomeCounts: { passed: 0, failed: 0, unknown: 0 },
      unknownCodes: ['no_results'],
    });
  });

  it('rolls up failed > unknown > passed, with the distinct unknown codes in first-seen order', () => {
    expect(foldVisionOutcomes([r('passed'), r('passed')])).toEqual({
      outcome: 'passed',
      outcomeCounts: { passed: 2, failed: 0, unknown: 0 },
      unknownCodes: [],
    });
    expect(
      foldVisionOutcomes([
        r('passed'),
        r('unknown', 'hit_test_unmeasurable'),
        r('unknown', 'input_missing'),
        r('unknown', 'hit_test_unmeasurable'),
      ])
    ).toEqual({
      outcome: 'unknown',
      outcomeCounts: { passed: 1, failed: 0, unknown: 3 },
      unknownCodes: ['hit_test_unmeasurable', 'input_missing'],
    });
    expect(foldVisionOutcomes([r('unknown', 'input_missing'), r('failed'), r('passed')])).toEqual({
      outcome: 'failed',
      outcomeCounts: { passed: 1, failed: 1, unknown: 1 },
      unknownCodes: ['input_missing'],
    });
  });
});

describe('snapshotCoverageOf', () => {
  it('counts presence over the measured elements', () => {
    expect(
      snapshotCoverageOf([
        { id: 'a', bbox: box(0, 0, 1, 1), text: 'x', interactable: true },
        { id: 'b', bbox: box(0, 0, 1, 1), zIndex: 3 },
        { id: 'c' },
      ])
    ).toEqual({ elements: 3, withGeometry: 2, withStacking: 1, withText: 1, interactable: 1 });
  });
});

describe('echoText', () => {
  it('cuts element text at 200 code points and says so, counting an astral character as one', () => {
    const text = '😀' + 'x'.repeat(299);
    const echoed = echoText(text);
    expect(echoed).toBe(`${JSON.stringify('😀' + 'x'.repeat(199))} (cut at 200 of 300 characters)`);
    expect(echoText('  short  ')).toBe('"short"');
  });
});
