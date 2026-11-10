/**
 * `parseColor` reads the CSS Color 4 forms a browser's computed style keeps a
 * colour in — `color(srgb …)`, `oklch()` (Tailwind v4's palette), `oklab()`,
 * `lab()`, `lch()`, `hwb()`, `color(display-p3 …)` — and answers null, never a
 * default colour, for anything else. The in-tab `contrast_meets_wcag` reads
 * every colour through it.
 */

import { describe, expect, it } from 'vitest';
import { parseColor, type RGBA } from '../color-utils';

function expectColor(value: string, want: RGBA, tolerance = 1): void {
  const got = parseColor(value);
  expect(got, value).not.toBeNull();
  for (const k of ['r', 'g', 'b'] as const) {
    expect(Math.abs(got![k] - want[k]), `${value} ${k}=${got![k]}`).toBeLessThanOrEqual(tolerance);
  }
  expect(got!.a).toBeCloseTo(want.a, 6);
}

describe('parseColor — CSS Color 4', () => {
  it('reads color(srgb …), with numbers, percentages and an alpha', () => {
    expectColor('color(srgb 1 0 0)', { r: 255, g: 0, b: 0, a: 1 }, 0);
    expectColor('color(srgb 0.5 0.5 0.5 / 0.5)', { r: 127.5, g: 127.5, b: 127.5, a: 0.5 }, 0.001);
    expectColor('color(srgb 100% 0% 50% / 25%)', { r: 255, g: 0, b: 127.5, a: 0.25 }, 0.001);
    expectColor('color(srgb-linear 1 1 1)', { r: 255, g: 255, b: 255, a: 1 }, 0.001);
  });

  it('reads oklch() and oklab() — sRGB red, white and black', () => {
    expectColor('oklch(0.62796 0.25768 29.2339)', { r: 255, g: 0, b: 0, a: 1 });
    expectColor('oklch(62.796% 0.25768 29.2339deg)', { r: 255, g: 0, b: 0, a: 1 });
    expectColor('oklab(0.62796 0.22486 0.12585)', { r: 255, g: 0, b: 0, a: 1 });
    expectColor('oklch(1 0 0)', { r: 255, g: 255, b: 255, a: 1 });
    expectColor('oklab(0 0 0 / 0.4)', { r: 0, g: 0, b: 0, a: 0.4 });
  });

  it('reads lab() and lch() in D50, as CSS defines them', () => {
    expectColor('lab(54.29 80.82 69.91)', { r: 255, g: 0, b: 0, a: 1 }, 1.5);
    expectColor('lch(54.29 106.84 40.86)', { r: 255, g: 0, b: 0, a: 1 }, 1.5);
    expectColor('lab(100 0 0)', { r: 255, g: 255, b: 255, a: 1 }, 1);
  });

  it('reads hwb(), including whiteness + blackness ≥ 100% as a grey', () => {
    expectColor('hwb(0 0% 0%)', { r: 255, g: 0, b: 0, a: 1 }, 0.001);
    expectColor('hwb(120 20% 30%)', { r: 51, g: 178.5, b: 51, a: 1 }, 0.001);
    expectColor('hwb(0 60% 60%)', { r: 127.5, g: 127.5, b: 127.5, a: 1 }, 0.001);
    expectColor('hwb(0.5turn 0% 0% / 0.5)', { r: 0, g: 255, b: 255, a: 0.5 }, 0.001);
  });

  it('converts display-p3 into sRGB, clipping what lies outside the sRGB gamut', () => {
    expectColor('color(display-p3 1 1 1)', { r: 255, g: 255, b: 255, a: 1 });
    // P3 red is redder than sRGB can show: clipped to sRGB red.
    expectColor('color(display-p3 1 0 0)', { r: 255, g: 0, b: 0, a: 1 });
  });

  it('reads `none` as a missing (zero) component', () => {
    expectColor('oklch(none none none)', { r: 0, g: 0, b: 0, a: 1 }, 0);
  });

  it.each([
    'oklch(0.5 0.1)',
    'oklch(0.5 0.1 200 300)',
    'oklch(0.5 0.1 200 / )',
    'oklch(0.5 0.1 200 / 0.5 / 1)',
    'lab(50, 20, 30)',
    'color(rec2020 1 0 0)',
    'color(srgb 1 0)',
    'oklch(0.5 0.1 200px)',
    'hwb(0 abc 10%)',
    'device-cmyk(0 0 0 1)',
    'foo(1 2 3)',
    'canvas',
  ])('answers null for %s — never a default colour', (value) => {
    expect(parseColor(value)).toBeNull();
  });

  it('leaves the legacy forms as they were', () => {
    expect(parseColor('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(parseColor('rgba(10, 20, 30, 0.5)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(parseColor('')).toBeNull();
  });
});
