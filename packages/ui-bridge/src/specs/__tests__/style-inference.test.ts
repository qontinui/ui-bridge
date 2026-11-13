/**
 * Style inference — the pure core (`../style-inference`, `../style-color`).
 *
 * Fixtures use the serializations Chrome's getComputedStyle actually returns
 * (colour-first outline, `0px none rgb(…)` border, transparent Tailwind shadow
 * placeholder layers, `oklab(… / a)` from color-mix, `normal` gap), because
 * jsdom returns declared values and cannot exercise normalisation.
 *
 * Plan: 2026-11-13-ui-bridge-infers-a-draft-style-guide-and-token-drift-from-computed-styles.
 */

import { describe, expect, it } from 'vitest';
import {
  buildStyleInventory,
  computeTokenDrift,
  inferStyleGuideFromInventory,
  normalizeShadow,
  styleValuesEquivalent,
  type StyleSample,
} from '../style-inference';
import { canonicalColor, colorDistance, deltaE2000, parseColor } from '../style-color';
import { evaluateConstraint } from '../style-validator';
import type { DesignTokens } from '../style-types';
import type { ExtendedComputedStyles } from '../../core/types';

function sample(
  elementId: string,
  styles: Record<string, string>,
  customProperties?: Record<string, string>
): StyleSample {
  return { elementId, styles, customProperties };
}

/** A Chrome-shaped element at rest: every default an element computes to. */
function chromeDefaults(): Record<string, string> {
  return {
    color: 'rgb(0, 0, 0)',
    backgroundColor: 'rgba(0, 0, 0, 0)',
    border: '0px none rgb(0, 0, 0)',
    outline: 'rgb(0, 0, 0) none 0px',
    boxShadow: 'none',
    fontFamily: '"Times New Roman"',
    fontSize: '16px',
    fontWeight: '400',
    lineHeight: 'normal',
    letterSpacing: 'normal',
    marginTop: '0px',
    marginRight: '0px',
    marginBottom: '0px',
    marginLeft: '0px',
    paddingTop: '0px',
    paddingRight: '0px',
    paddingBottom: '0px',
    paddingLeft: '0px',
    gap: 'normal',
    borderRadius: '0px',
  };
}

function el(
  id: string,
  overrides: Record<string, string>,
  custom?: Record<string, string>
): StyleSample {
  return sample(id, { ...chromeDefaults(), ...overrides }, custom);
}

// ============================================================================
// Colour
// ============================================================================

describe('style-color', () => {
  it('canonicalises every spelling of one colour to the same hex', () => {
    const spellings = [
      'rgb(59, 130, 246)',
      'rgb(59 130 246)',
      'rgba(59, 130, 246, 1)',
      'rgb(59 130 246 / 100%)',
      '#3B82F6',
      'color(srgb 0.231373 0.509804 0.964706)',
      'hsl(217.22 91.22% 59.8%)',
    ];
    for (const s of spellings) expect(canonicalColor(s), s).toBe('#3b82f6');
  });

  it('keeps alpha below 1 as an 8-digit hex and reads 3/4-digit hex', () => {
    expect(canonicalColor('rgba(0, 0, 0, 0.5)')).toBe('#00000080');
    expect(canonicalColor('#fff')).toBe('#ffffff');
    expect(canonicalColor('#0008')).toBe('#00000088');
    expect(canonicalColor('oklab(0.5 0.1 -0.1 / 0.15)')).toMatch(/^#[0-9a-f]{6}26$/);
  });

  it('converts oklch to sRGB and flags a clamped wide-gamut colour', () => {
    const red = parseColor('oklch(0.6279 0.2577 29.23)');
    expect(red).not.toBeNull();
    expect(colorDistance(canonicalColor('oklch(0.6279 0.2577 29.23)')!, '#ff0000')!).toBeLessThan(
      1
    );
    expect(parseColor('oklch(0.7 0.4 150)')?.outOfGamut).toBe(true);
    expect(parseColor('rgb(1, 2, 3)')?.outOfGamut).toBeUndefined();
  });

  it('reads the full CSS named-colour table and refuses what it does not know', () => {
    expect(canonicalColor('rebeccapurple')).toBe('#663399');
    expect(canonicalColor('cornflowerblue')).toBe('#6495ed');
    expect(canonicalColor('transparent')).toBe('#00000000');
    expect(canonicalColor('currentcolor')).toBeNull();
    expect(canonicalColor('constructor')).toBeNull();
    expect(canonicalColor('color(display-p3 1 0 0)')).toBeNull();
  });

  it('CIEDE2000 matches Sharma, Wu & Dalal (2005) reference pairs', () => {
    const pairs: Array<[[number, number, number], [number, number, number], number]> = [
      [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
      [[50, 0, 0], [50, -1, 2], 2.3669],
      [[50, 2.5, 0], [73, 25, -18], 27.1492],
      [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    ];
    for (const [a, b, expected] of pairs) {
      expect(deltaE2000(a, b)).toBeCloseTo(expected, 4);
      expect(deltaE2000(b, a)).toBeCloseTo(expected, 4);
    }
  });
});

// ============================================================================
// Inventory
// ============================================================================

describe('buildStyleInventory', () => {
  it('ranks by element count, then occurrences, then value, and names by ordinal', () => {
    const inv = buildStyleInventory([
      el('a', { color: 'rgb(17, 17, 17)', backgroundColor: 'rgb(255, 255, 255)' }),
      el('b', { color: 'rgb(17, 17, 17)', backgroundColor: 'rgb(255, 255, 255)' }),
      el('c', { color: 'rgb(17, 17, 17)', backgroundColor: 'rgb(59, 130, 246)' }),
      // #ffffff appears on 2 elements, #3b82f6 on 1, #111111 on 3.
    ]);
    expect(inv.entries.colors.map((e) => [e.name, e.value, e.elementCount])).toEqual([
      ['color-1', '#111111', 3],
      ['color-2', '#ffffff', 2],
      ['color-3', '#3b82f6', 1],
    ]);
  });

  it('breaks an element-count tie by occurrences, then by value order', () => {
    const inv = buildStyleInventory([
      // 8px: 1 element, 4 occurrences (all paddings). 4px and 12px: 1 element, 1 occurrence.
      el('a', { paddingTop: '8px', paddingRight: '8px', paddingBottom: '8px', paddingLeft: '8px' }),
      el('b', { marginTop: '4px' }),
      el('c', { marginTop: '12px' }),
    ]);
    expect(inv.entries.spacing.map((e) => e.value)).toEqual(['8px', '12px', '4px']);
    expect(inv.entries.spacing.map((e) => e.name)).toEqual(['space-1', 'space-2', 'space-3']);
    expect(inv.entries.spacing[0]).toMatchObject({
      occurrences: 4,
      elementCount: 1,
      properties: ['padding'],
    });
  });

  it('is deterministic: sample order does not change the result', () => {
    const samples = [
      el('a', { color: 'rgb(1, 1, 1)' }),
      el('b', { color: 'rgb(2, 2, 2)' }),
      el('c', { color: 'rgb(3, 3, 3)' }),
    ];
    const forward = buildStyleInventory(samples);
    const reverse = buildStyleInventory([...samples].reverse());
    expect(reverse.entries).toEqual(forward.entries);
  });

  it('excludes and counts defaults: transparent, zero spacing, normal, none, currentcolor borders', () => {
    const inv = buildStyleInventory([el('a', {})]);
    expect(inv.entries.colors.map((e) => e.value)).toEqual(['#000000']);
    expect(inv.entries.colors[0].properties).toEqual(['color']); // not border/outline
    expect(inv.entries.spacing).toEqual([]);
    expect(inv.entries.borders).toEqual([]);
    expect(inv.entries.shadows).toEqual([]);
    expect(inv.entries.lineHeights).toEqual([]);
    expect(inv.excludedDefaults).toMatchObject({
      colors: 1,
      spacing: 9, // 8 sides + `normal` gap
      borders: 1,
      shadows: 1,
      lineHeights: 1,
      letterSpacings: 1,
      borderRadius: 1,
    });
  });

  it('parses a visible border order-agnostically and counts its colour under border', () => {
    const inv = buildStyleInventory([
      el('a', { border: '1px solid rgb(229, 231, 235)', outline: 'rgb(59, 130, 246) solid 2px' }),
    ]);
    expect(inv.entries.borders.map((e) => e.value)).toEqual(['1px solid #e5e7eb']);
    const byValue = Object.fromEntries(inv.entries.colors.map((e) => [e.value, e.properties]));
    expect(byValue['#e5e7eb']).toEqual(['border']);
    expect(byValue['#3b82f6']).toEqual(['outline']);
  });

  it('drops transparent shadow placeholder layers and canonicalises the rest', () => {
    const tailwind =
      'rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0.1) 0px 1px 3px 0px, rgba(0, 0, 0, 0.1) 0px 1px 2px -1px';
    expect(normalizeShadow(tailwind)).toBe('0px 1px 3px 0px #0000001a, 0px 1px 2px -1px #0000001a');
    expect(normalizeShadow('rgba(0, 0, 0, 0) 0px 0px 0px 0px')).toBe('none');
    const inv = buildStyleInventory([
      el('a', { boxShadow: tailwind }),
      el('b', { boxShadow: 'rgba(0, 0, 0, 0) 0px 0px 0px 0px' }),
    ]);
    expect(inv.entries.shadows).toHaveLength(1);
    expect(inv.excludedDefaults.shadows).toBe(1);
    expect(inv.entries.colors.find((e) => e.value === '#0000001a')?.occurrences).toBe(2);
  });

  it('reads line height and letter spacing as font-relative ratios, keeping the px spellings', () => {
    const inv = buildStyleInventory([
      el('a', { fontSize: '16px', lineHeight: '24px', letterSpacing: '0.4px' }),
      el('b', { fontSize: '20px', lineHeight: '30px', letterSpacing: '0.5px' }),
    ]);
    expect(inv.entries.lineHeights).toHaveLength(1);
    expect(inv.entries.lineHeights[0]).toMatchObject({
      value: '1.5',
      elementCount: 2,
      px: ['24px', '30px'],
    });
    expect(inv.entries.letterSpacings[0]).toMatchObject({
      value: '0.025em',
      px: ['0.4px', '0.5px'],
    });
  });

  it('resolves rem against the root font size and rounds sub-pixel values', () => {
    const inv = buildStyleInventory([el('a', { marginTop: '1.5rem', paddingTop: '13.3333px' })], {
      rootFontSizePx: 10,
    });
    expect(inv.entries.spacing.map((e) => e.value).sort()).toEqual(['13.33px', '15px']);
  });

  it('splits gap and radius, counting a corner value once per element', () => {
    const inv = buildStyleInventory([
      el('a', { gap: '8px 16px', borderRadius: '8px 8px 0px 0px' }),
      el('b', { gap: '12px 12px', borderRadius: '50%' }),
    ]);
    expect(inv.entries.spacing.map((e) => e.value).sort()).toEqual(['12px', '16px', '8px']);
    expect(inv.entries.spacing.find((e) => e.value === '12px')?.occurrences).toBe(1);
    expect(inv.entries.borderRadius.map((e) => [e.value, e.occurrences])).toEqual([
      ['50%', 1],
      ['8px', 1],
    ]);
  });

  it('falls back to box shorthands when per-side values are absent (native samples)', () => {
    const inv = buildStyleInventory([sample('n', { margin: '4px 8px', padding: '12px' })]);
    const spacing = Object.fromEntries(inv.entries.spacing.map((e) => [e.value, e.occurrences]));
    expect(spacing).toEqual({ '12px': 4, '4px': 2, '8px': 2 });
  });

  it('notes the custom properties whose value matches an entry', () => {
    const inv = buildStyleInventory(
      [el('a', { color: 'rgb(74, 144, 217)', paddingTop: '16px' }, { '--brand': '#4A90D9' })],
      { customProperties: { '--space-4': '1rem', '--other': '#000' } }
    );
    expect(inv.entries.colors.find((e) => e.value === '#4a90d9')?.matchingCustomProperties).toEqual(
      ['--brand']
    );
    expect(inv.entries.spacing[0].matchingCustomProperties).toEqual(['--space-4']);
    expect(inv.customPropertiesSeen).toBe(3);
  });

  it('keeps an unparseable value verbatim and flags it rather than dropping it', () => {
    const inv = buildStyleInventory([el('a', { color: 'color(display-p3 1 0 0)' })]);
    expect(inv.entries.colors[0]).toMatchObject({
      value: 'color(display-p3 1 0 0)',
      normalized: false,
    });
    expect(inv.unnormalized.colors).toBe(1);
  });
});

// ============================================================================
// Inferred guide
// ============================================================================

describe('inferStyleGuideFromInventory', () => {
  const many = Array.from({ length: 30 }, (_, i) =>
    el(`e${i}`, { color: `rgb(${i}, ${i}, ${i})`, paddingTop: i < 5 ? '4px' : '8px' })
  );

  it('caps each category and reports what the cap dropped, dropped: 0 included', () => {
    const inferred = inferStyleGuideFromInventory(buildStyleInventory(many), {
      maxPerCategory: 10,
      limits: { spacing: 1 },
    });
    expect(inferred.truncation.colors).toEqual({
      distinct: 30,
      kept: 10,
      dropped: 20,
      droppedOccurrences: 20,
    });
    expect(inferred.truncation.spacing).toEqual({
      distinct: 2,
      kept: 1,
      dropped: 1,
      droppedOccurrences: 5,
    });
    expect(inferred.truncation.shadows).toEqual({
      distinct: 0,
      kept: 0,
      dropped: 0,
      droppedOccurrences: 0,
    });
    expect(Object.keys(inferred.guide!.tokens.colors)).toHaveLength(10);
    expect(inferred.guide!.tokens.spacing).toEqual({ 'space-1': '8px' });
  });

  it('emits a full DesignTokens with ordinal names, no rules and empty breakpoints', () => {
    const inferred = inferStyleGuideFromInventory(buildStyleInventory(many), { name: 'acme' });
    const g = inferred.guide!;
    expect(inferred.status).toBe('ok');
    expect(g.name).toBe('acme');
    expect(g.rules).toEqual([]);
    expect(g.tokens.breakpoints).toEqual({});
    expect(Object.keys(g.tokens.typography).sort()).toEqual(
      ['fontFamilies', 'fontSizes', 'fontWeights', 'letterSpacings', 'lineHeights'].sort()
    );
    for (const name of Object.keys(g.tokens.colors)) expect(name).toMatch(/^color-\d+$/);
    expect(inferred.notInGuide).toEqual(['borders']);
    expect(inferred.notInferable).toEqual(['breakpoints']);
  });

  it('answers empty with a reason and no guide when nothing was sampled', () => {
    const inferred = inferStyleGuideFromInventory(buildStyleInventory([]));
    expect(inferred).toMatchObject({
      status: 'empty',
      reason: 'no elements were sampled',
      guide: null,
    });
  });

  it('answers empty when every sampled value was a default', () => {
    const inferred = inferStyleGuideFromInventory(
      buildStyleInventory([sample('a', { backgroundColor: 'rgba(0, 0, 0, 0)', marginTop: '0px' })])
    );
    expect(inferred.status).toBe('empty');
    expect(inferred.reason).toMatch(/none carried a non-default style value/);
    expect(inferred.guide).toBeNull();
  });
});

// ============================================================================
// Drift
// ============================================================================

/** A declared set shaped like qontinui-design-tokens (hex colours, unitless line heights). */
const declaredTokens: Partial<DesignTokens> & { typography: Partial<DesignTokens['typography']> } =
  {
    colors: { primary: '#4A90D9', canvas: '#111115', text: '#FFFFFF' },
    typography: {
      fontSizes: { body: 'calc(22 * var(--qontinui-type-unit))', sm: '14px' },
      lineHeights: { normal: '1.25', loose: '1.5' },
      fontWeights: { regular: '400', bold: '700' },
    },
    spacing: { sm: '8px', md: '16px', lg: '24px' },
    breakpoints: { md: '768px' },
  };

describe('computeTokenDrift', () => {
  const inUse = [
    el('a', {
      color: 'rgb(255, 255, 255)',
      backgroundColor: 'rgb(17, 17, 21)',
      paddingTop: '16px',
      lineHeight: '24px',
      fontSize: '16px',
    }),
    el('b', {
      color: 'rgb(78, 148, 217)',
      paddingTop: '15px',
      fontWeight: '600',
      fontSize: '14px',
      lineHeight: '17.5px',
    }),
    el('c', { color: 'rgb(200, 30, 30)', marginTop: '40px', fontSize: '14px' }),
  ];

  it('lists undeclared values with the nearest token and a near-miss flag', () => {
    const report = computeTokenDrift(buildStyleInventory(inUse), { tokens: declaredTokens });
    expect(report.verdict).toBe('drift');
    const undeclared = Object.fromEntries(
      report.undeclared.map((u) => [`${u.category}:${u.value}`, u])
    );

    // #4e94d9 vs #4a90d9: four steps off — a near miss, not a match.
    expect(undeclared['colors:#4e94d9'].nearest).toMatchObject({
      token: 'colors.primary',
      unit: 'deltaE2000',
    });
    expect(undeclared['colors:#4e94d9'].nearMiss).toBe(true);
    // A red nowhere near the palette.
    expect(undeclared['colors:#c81e1e'].nearMiss).toBe(false);
    // 15px is 1px from spacing.md; 40px is 16px from spacing.lg.
    expect(undeclared['spacing:15px'].nearest).toMatchObject({
      token: 'spacing.md',
      distance: 1,
      unit: 'px',
    });
    expect(undeclared['spacing:15px'].nearMiss).toBe(true);
    expect(undeclared['spacing:40px'].nearest).toMatchObject({ token: 'spacing.lg', distance: 16 });
    expect(undeclared['spacing:40px'].nearMiss).toBe(false);
    // 600 is 100 from both 400 and 700 — nearest is the first declared at that distance.
    expect(undeclared['fontWeights:600'].nearest?.unit).toBe('weight');
    // Matched values are not listed.
    expect(undeclared['colors:#ffffff']).toBeUndefined();
    expect(undeclared['spacing:16px']).toBeUndefined();
    expect(undeclared['lineHeights:1.5']).toBeUndefined();
    expect(undeclared['lineHeights:1.25']).toBeUndefined();
  });

  it('reports unused tokens, unresolved tokens and non-comparable keys separately', () => {
    const report = computeTokenDrift(buildStyleInventory(inUse), { tokens: declaredTokens });
    expect(report.unused.map((u) => u.token).sort()).toEqual(
      ['colors.primary', 'spacing.lg', 'spacing.sm', 'typography.fontWeights.bold'].sort()
    );
    // calc(22 * var(--x)) inside a DesignTokens object has nothing to substitute from.
    expect(report.unresolved.map((u) => u.token)).toEqual(['typography.fontSizes.body']);
    expect(report.unused.map((u) => u.token)).not.toContain('typography.fontSizes.body');
    expect(report.notComparable).toEqual(['breakpoints']);
  });

  it('compares only the categories the declared set covers, and says so', () => {
    const report = computeTokenDrift(buildStyleInventory(inUse), {
      tokens: { colors: { text: '#ffffff' } },
    });
    expect(report.categories.spacing.status).toBe('no-declared-tokens');
    expect(report.undeclared.every((u) => u.category === 'colors')).toBe(true);
    expect(report.summary).toContain(
      '3 distinct spacing values in use — no tokens declared for this category, not compared'
    );
    expect(report.summary[0]).toBe(
      '4 distinct colors in use vs 1 declared: 1 matched, 3 undeclared, 0 declared but unused'
    );
  });

  it('matches colours within ΔE 0.5 (one-step rounding) and not beyond', () => {
    const inv = buildStyleInventory([
      el('a', { color: 'rgb(74, 144, 218)' }),
      el('b', { color: 'rgb(84, 144, 217)' }),
    ]);
    const report = computeTokenDrift(inv, { tokens: { colors: { primary: '#4a90d9' } } });
    expect(report.categories.colors.matched).toBe(1);
    expect(report.undeclared.map((u) => u.value)).toEqual(['#5490d9']);
  });

  it('resolves a flat custom-property map shaped like qontinui-design-tokens tokens.css', () => {
    const tokensCss = {
      '--qontinui-brand-primary': '#4a90d9',
      '--qontinui-type-unit': '1px',
      '--qontinui-font-size-label': 'calc(14 * var(--qontinui-type-unit))',
      '--qontinui-font-weight-semibold': '600',
      '--qontinui-line-height-normal': '1.25',
      '--qontinui-letter-spacing-wide': '0.025em',
      '--qontinui-letter-spacing-none': '0em',
      '--qontinui-duration-fast': '150ms',
      '--qontinui-ease-out': 'cubic-bezier(0.16, 1, 0.3, 1)',
      '--qontinui-missing': 'var(--nope)',
    };
    const inv = buildStyleInventory([
      el('a', {
        color: 'rgb(74, 144, 217)',
        fontSize: '14px',
        fontWeight: '600',
        lineHeight: '17.5px',
        letterSpacing: '0.35px',
      }),
    ]);
    const report = computeTokenDrift(inv, { customProperties: tokensCss });
    expect(report.verdict).toBe('no-drift');
    expect(report.categories.fontSizes).toMatchObject({ status: 'compared', matched: 1 });
    expect(report.categories.fontWeights.matched).toBe(1);
    expect(report.categories.lineHeights.matched).toBe(1);
    expect(report.categories.letterSpacings.matched).toBe(1);
    expect(report.ignoredDeclared).toBe(2);
    expect(Object.fromEntries(report.unresolved.map((u) => [u.token, u.reason]))).toEqual({
      '--qontinui-letter-spacing-none': expect.stringMatching(/default/),
      '--qontinui-missing': expect.stringMatching(/does not declare/),
    });
    // The 1px unit itself is a length token that nothing uses.
    expect(report.unused.map((u) => u.token)).toEqual(['--qontinui-type-unit']);
  });

  it('runs on the uncapped inventory: a cap never turns a value undeclared or a token unused', () => {
    const samples = Array.from({ length: 30 }, (_, i) =>
      el(`e${i}`, { color: `rgb(${i}, ${i}, ${i})` })
    );
    samples.push(el('rare', { color: 'rgb(74, 144, 217)' }));
    const inv = buildStyleInventory(samples);
    expect(
      inferStyleGuideFromInventory(inv, { maxPerCategory: 5 }).truncation.colors.dropped
    ).toBeGreaterThan(0);
    const report = computeTokenDrift(inv, { tokens: { colors: { primary: '#4a90d9' } } });
    expect(report.unused).toEqual([]);
    expect(report.categories.colors.matched).toBe(1);
  });

  it('caps the listed values and reports the cut', () => {
    const samples = Array.from({ length: 12 }, (_, i) =>
      el(`e${i}`, { color: `rgb(${i * 10}, 0, 0)` })
    );
    const report = computeTokenDrift(
      buildStyleInventory(samples),
      { tokens: { colors: { white: '#fff' } } },
      { maxListed: 5 }
    );
    expect(report.undeclared).toHaveLength(5);
    expect(report.truncation.undeclared.colors).toEqual({ total: 12, listed: 5, dropped: 7 });
    expect(report.categories.colors.undeclaredInUse).toBe(12);
  });

  it('an empty capture is unknown, never no-drift', () => {
    const report = computeTokenDrift(buildStyleInventory([]), { tokens: declaredTokens });
    expect(report.verdict).toBe('unknown');
    expect(report.reason).toBe('no elements were sampled');
    expect(report.undeclared).toEqual([]);
  });

  it('a declared set with nothing comparable is unknown', () => {
    const inv = buildStyleInventory(inUse);
    expect(computeTokenDrift(inv, { tokens: {} })).toMatchObject({
      verdict: 'unknown',
      reason: 'the declared token set is empty',
    });
    expect(
      computeTokenDrift(inv, { tokens: { typography: { fontSizes: { x: 'calc(2 * var(--u))' } } } })
    ).toMatchObject({ verdict: 'unknown', reason: expect.stringMatching(/could be resolved/) });
    // Tokens declared only for a category nothing uses.
    expect(
      computeTokenDrift(inv, { tokens: { shadows: { sm: '0 1px 2px #0003' } } })
    ).toMatchObject({
      verdict: 'unknown',
      reason: expect.stringMatching(/no category has both/),
    });
  });
});

// ============================================================================
// Canonical equivalence and the validator
// ============================================================================

describe('styleValuesEquivalent and the style validator', () => {
  it('equates canonical forms', () => {
    expect(styleValuesEquivalent('rgb(59, 130, 246)', '#3b82f6', 'color')).toBe(true);
    expect(styleValuesEquivalent('16px', '1rem', 'paddingTop')).toBe(true);
    expect(styleValuesEquivalent('24px', '1.5', 'lineHeight', { fontSize: '16px' })).toBe(true);
    expect(styleValuesEquivalent('0.4px', '0.025em', 'letterSpacing', { fontSize: '16px' })).toBe(
      true
    );
    expect(styleValuesEquivalent('"Inter", sans-serif', 'Inter, sans-serif', 'fontFamily')).toBe(
      true
    );
    expect(styleValuesEquivalent('rgb(59, 130, 246)', '#3b82f7', 'color')).toBe(false);
    expect(styleValuesEquivalent('24px', '1.25', 'lineHeight', { fontSize: '16px' })).toBe(false);
  });

  it('a tokenRef to a hex token passes against Chrome rgb(), and still fails a different colour', () => {
    const tokens = {
      colors: { primary: '#3b82f6' },
      typography: {
        fontFamilies: {},
        fontSizes: {},
        fontWeights: {},
        lineHeights: { body: '1.5' },
        letterSpacings: {},
      },
      spacing: {},
      borderRadius: {},
      shadows: {},
      breakpoints: {},
    };
    const styles = {
      color: 'rgb(59, 130, 246)',
      fontSize: '16px',
      lineHeight: '24px',
    } as unknown as ExtendedComputedStyles;
    expect(
      evaluateConstraint(
        { type: 'tokenRef', property: 'color', tokenPath: 'colors.primary' },
        styles,
        tokens
      ).passed
    ).toBe(true);
    expect(
      evaluateConstraint(
        { type: 'tokenRef', property: 'lineHeight', tokenPath: 'typography.lineHeights.body' },
        styles,
        tokens
      ).passed
    ).toBe(true);
    const other = { ...styles, color: 'rgb(60, 130, 246)' } as ExtendedComputedStyles;
    expect(
      evaluateConstraint(
        { type: 'tokenRef', property: 'color', tokenPath: 'colors.primary' },
        other,
        tokens
      ).passed
    ).toBe(false);
  });
});

// ============================================================================
// Review regressions (each was a wrong answer before its fix)
// ============================================================================

describe('review regressions', () => {
  it('a colour of another opacity is neither a match nor a nearest candidate', () => {
    const inv = buildStyleInventory([el('a', { color: 'rgba(59, 130, 246, 0.5)' })]);
    const report = computeTokenDrift(inv, { tokens: { colors: { primary: '#3b82f6' } } });
    expect(report.verdict).toBe('drift');
    expect(report.undeclared[0]).toMatchObject({
      value: '#3b82f680',
      nearest: null,
      nearMiss: false,
    });
  });

  it('a colour-last authored shadow token matches Chrome colour-first serialization', () => {
    const inv = buildStyleInventory([el('a', { boxShadow: 'rgba(0, 0, 0, 0.1) 0px 1px 3px 0px' })]);
    const report = computeTokenDrift(inv, {
      tokens: { shadows: { sm: '0 1px 3px rgb(0 0 0 / 0.1)' } },
    });
    expect(report.verdict).toBe('no-drift');
    expect(report.unused).toEqual([]);
    expect(normalizeShadow('inset 0 1px 2px #000')).toBe('inset 0px 1px 2px 0px #000000');
  });

  it('a px line-height token matches beyond the 10 px spellings a guide lists', () => {
    const samples = Array.from({ length: 12 }, (_, i) => {
      const fs = 10 + i * 2;
      return el(`e${i}`, { fontSize: `${fs}px`, lineHeight: `${fs * 1.5}px` });
    });
    const inv = buildStyleInventory(samples);
    expect(inv.entries.lineHeights[0].px).toHaveLength(12);
    expect(inferStyleGuideFromInventory(inv).inventory.lineHeights[0].px).toHaveLength(10);
    const report = computeTokenDrift(inv, {
      tokens: { typography: { lineHeights: { big: '48px' } } },
    });
    expect(report.unused).toEqual([]);
    expect(report.verdict).toBe('no-drift');
  });

  it('the validator never passes two wide-gamut colours that clamp to one hex', () => {
    expect(canonicalColor('oklch(0.95 0.4 150)')).toBe(canonicalColor('oklch(0.95 0.37 140)'));
    expect(styleValuesEquivalent('oklch(0.95 0.4 150)', 'oklch(0.95 0.37 140)', 'color')).toBe(
      false
    );
  });

  it('parses CSS lab() and lch() (D50)', () => {
    expect(colorDistance(canonicalColor('lab(54.29 80.82 69.91)')!, '#ff0000')!).toBeLessThan(1);
    expect(colorDistance(canonicalColor('lch(54.29 106.84 40.85)')!, '#ff0000')!).toBeLessThan(1);
  });

  it('a unitless line height is never compared as px without a font size', () => {
    expect(styleValuesEquivalent('24px', '24', 'lineHeight', {})).toBe(false);
  });

  it('substitutes a var() whose fallback holds parentheses', () => {
    const inv = buildStyleInventory([el('a', { color: 'rgb(59, 130, 246)' })]);
    const report = computeTokenDrift(inv, {
      customProperties: { '--primary': 'var(--brand, rgb(59 130 246))' },
    });
    expect(report.verdict).toBe('no-drift');
  });

  it('a structured token holding var() is unresolved for that reason, and counted per category', () => {
    const inv = buildStyleInventory([el('a', { color: 'rgb(59, 130, 246)' })]);
    const report = computeTokenDrift(inv, {
      tokens: { colors: { primary: '#3b82f6', alias: 'var(--blue)' } },
    });
    expect(report.unresolved).toEqual([
      expect.objectContaining({
        token: 'colors.alias',
        category: 'colors',
        reason: expect.stringMatching(/unsubstituted var/),
      }),
    ]);
    expect(report.categories.colors.unresolvedDeclared).toBe(1);
  });

  it('rem letter spacing without a font size is not recorded as em', () => {
    const inv = buildStyleInventory([sample('a', { letterSpacing: '0.05rem' })]);
    expect(inv.entries.letterSpacings.map((e) => e.value)).not.toContain('0.05em');
  });

  it('an inventory whose only values are borders (no guide slot) is empty for the guide', () => {
    const borders = buildStyleInventory([sample('b', { border: '1px solid rgb(1, 2, 3)' })]);
    const empty = buildStyleInventory([]);
    const bordersOnly = inferStyleGuideFromInventory({
      ...empty,
      sampleCount: 1,
      entries: { ...empty.entries, borders: borders.entries.borders },
    });
    expect(bordersOnly.status).toBe('empty');
    expect(bordersOnly.guide).toBeNull();
    // With the border's colour present the guide has a colour token: not empty.
    expect(inferStyleGuideFromInventory(borders).status).toBe('ok');
  });

  it('matchingCustomProperties resolves rem against the given root font size', () => {
    const inv = buildStyleInventory([el('a', { paddingTop: '20px' }, { '--space': '2rem' })], {
      rootFontSizePx: 10,
    });
    expect(inv.entries.spacing[0].matchingCustomProperties).toEqual(['--space']);
  });

  it('a flat-map length token is counted unused once, where it is listed', () => {
    const inv = buildStyleInventory([
      el('a', { paddingTop: '8px', fontSize: '16px', borderRadius: '4px' }),
    ]);
    const report = computeTokenDrift(inv, { customProperties: { '--x': '99px', '--y': '8px' } });
    const counted = Object.values(report.categories).reduce((n, c) => n + c.unusedDeclared, 0);
    expect(counted).toBe(report.unused.length);
  });

  it('a border custom property still matches a border entry', () => {
    const inv = buildStyleInventory([
      el('a', { border: '1px solid rgb(229, 231, 235)' }, { '--border': '1px solid #e5e7eb' }),
    ]);
    expect(inv.entries.borders[0].matchingCustomProperties).toEqual(['--border']);
  });

  it('per-category unresolved counts plus the uncategorised count sum to the list', () => {
    const inv = buildStyleInventory([el('a', { color: 'rgb(1, 2, 3)' })]);
    const report = computeTokenDrift(inv, {
      customProperties: { '--a': '#010203', '--b': 'weird(1)' },
    });
    const perCategory = Object.values(report.categories).reduce(
      (n, c) => n + c.unresolvedDeclared,
      0
    );
    expect(report.unresolvedUncategorised).toBe(1);
    expect(perCategory + report.unresolvedUncategorised).toBe(report.unresolved.length);
  });
});
