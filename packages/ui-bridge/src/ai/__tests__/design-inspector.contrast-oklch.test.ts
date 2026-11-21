// @vitest-environment node
/**
 * computeContrastRatio reads the package's one colour grammar.
 *
 * Chromium computes an `oklch()` colour to `oklch(...)`, never to `rgb()`, so
 * the value this helper reads off a probe element is an oklch string. Run with
 * no DOM, the helper reads the value as written, which exercises the same
 * parse the probe's computed value goes through.
 */

import { describe, it, expect } from 'vitest';
import { computeContrastRatio } from '../design-inspector';

describe('computeContrastRatio with no DOM', () => {
  it('reads oklch colours (black on white is 21:1)', () => {
    expect(computeContrastRatio('oklch(0 0 0)', 'oklch(1 0 0)')).toBeCloseTo(21, 0);
  });

  it('reads hex and named colours', () => {
    expect(computeContrastRatio('#000', 'white')).toBeCloseTo(21, 0);
  });

  it('answers UNKNOWN for a colour that paints nothing, or is unreadable', () => {
    // These reach the shared parser.
    expect(computeContrastRatio('rgba(0, 0, 0, 0)', '#fff')).toBeNull();
    expect(computeContrastRatio('rgb(0 0 0 / none)', '#fff')).toBeNull();
    expect(computeContrastRatio('display-p3-ish', '#fff')).toBeNull();
    expect(computeContrastRatio('color(display-p3 1 0 0)', '#fff')).toBeNull();
  });

  it('measures faint and partial alpha as rendered', () => {
    // Very faint text measures close to 1:1 (reported, not hidden).
    expect(computeContrastRatio('rgb(0 0 0 / 0.001)', '#fff')!).toBeLessThan(1.01);
    expect(computeContrastRatio('oklch(0 0 0 / 0.05)', '#fff')!).toBeLessThan(1.15);
    // 50% black on white is ~3.98:1.
    expect(computeContrastRatio('rgb(0 0 0 / 0.5)', '#fff')).toBeCloseTo(3.98, 1);
  });

  it('refuses transparent and var() references', () => {
    expect(computeContrastRatio('transparent', '#fff')).toBeNull();
    expect(computeContrastRatio('var(--fg)', '#fff')).toBeNull();
  });

  it('answers UNKNOWN for a non-string value instead of throwing', () => {
    expect(computeContrastRatio(undefined as unknown as string, '#fff')).toBeNull();
    expect(computeContrastRatio('#000', 42 as unknown as string)).toBeNull();
  });
});
