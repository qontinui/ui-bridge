/**
 * Style inference — regressions from the second review of PR #373. Each test
 * here gave a wrong answer (or threw) before its fix.
 *
 * Plan: 2026-11-13-ui-bridge-infers-a-draft-style-guide-and-token-drift-from-computed-styles.
 */

import { describe, expect, it } from 'vitest';
import {
  buildStyleInventory,
  canonicalColorsMatch,
  computeTokenDrift,
  lengthCategoryOfName,
  normalizeShadow,
  styleValuesEquivalent,
  type StyleSample,
} from '../style-inference';
import { canonicalColor } from '../style-color';
import { runStyleAudit } from '../style-validator';
import { STYLE_GUIDE_VERSION, type StyleGuideConfig } from '../style-types';
import type { ElementDesignData } from '../../core/types';

function el(id: string, styles: Record<string, unknown>): StyleSample {
  return { elementId: id, styles: styles as Record<string, string> };
}

function guideWith(
  tokens: Partial<StyleGuideConfig['tokens']>,
  rules: StyleGuideConfig['rules']
): StyleGuideConfig {
  return {
    version: STYLE_GUIDE_VERSION,
    name: 'g',
    tokens: {
      colors: {},
      typography: {
        fontFamilies: {},
        fontSizes: {},
        fontWeights: {},
        lineHeights: {},
        letterSpacings: {},
      },
      spacing: {},
      borderRadius: {},
      shadows: {},
      breakpoints: {},
      ...tokens,
    },
    rules,
  };
}

function designData(styles: Record<string, string>): ElementDesignData {
  return {
    elementId: 'a',
    type: 'div',
    styles,
    pseudoElements: [],
    rect: { x: 0, y: 0, width: 0, height: 0 },
  } as unknown as ElementDesignData;
}

// A1 / A7 — rem resolves against the measured root font size everywhere.
describe('rem resolves against the root font size the caller measured', () => {
  it('styleValuesEquivalent resolves rem at the given root, not a fixed 16px', () => {
    expect(styleValuesEquivalent('20px', '1rem', 'paddingTop', undefined, 20)).toBe(true);
    expect(styleValuesEquivalent('16px', '1rem', 'paddingTop', undefined, 20)).toBe(false);
    expect(styleValuesEquivalent('16px', '1rem', 'paddingTop')).toBe(true);
    expect(
      styleValuesEquivalent(
        'rgba(0, 0, 0, 0.1) 0px 2px 4px 0px',
        '0 0.1rem 0.2rem #0000001a',
        'boxShadow',
        undefined,
        20
      )
    ).toBe(true);
  });

  it('the validator passes a rem token at a 20px root, and fails it at the default', () => {
    const guide = guideWith({ spacing: { md: '1rem' } }, [
      {
        id: 'pad',
        constraints: [{ type: 'tokenRef', property: 'paddingTop', tokenPath: 'spacing.md' }],
      },
    ]);
    const data = [designData({ paddingTop: '20px' })];
    expect(runStyleAudit(data, guide, { rootFontSizePx: 20 }).failedCount).toBe(0);
    expect(runStyleAudit(data, guide).failedCount).toBe(1);
  });

  it('shadow and border lengths in rem resolve at the inventory root', () => {
    const inv = buildStyleInventory(
      [el('a', { boxShadow: '0 0.1rem 0.2rem #000', border: '0.05rem solid #000' })],
      { rootFontSizePx: 20 }
    );
    expect(inv.entries.shadows[0].value).toBe('0px 2px 4px 0px #000000');
    expect(inv.entries.borders[0].value).toBe('1px solid #000000');
  });
});

// A2 — a non-string style value is counted, never thrown on.
describe('non-string style values', () => {
  it('a numeric font weight and a PlatformColor object are counted unnormalised', () => {
    const inv = buildStyleInventory([
      el('a', {
        fontWeight: 700,
        color: { semantic: ['labelColor'] },
        backgroundColor: '#ffffff',
      }),
    ]);
    expect(inv.unnormalized.fontWeights).toBe(1);
    expect(inv.unnormalized.colors).toBe(1);
    expect(inv.entries.colors.map((e) => e.value)).toEqual(['#ffffff']);
  });

  it('the validator compares a numeric actual value instead of throwing', () => {
    const guide = guideWith({}, [
      { id: 'w', constraints: [{ type: 'exact', property: 'fontWeight', value: '700' }] },
    ]);
    const data = [designData({ fontWeight: 700 as unknown as string })];
    expect(runStyleAudit(data, guide).failedCount).toBe(0);
  });
});

// A3 — comments are stripped; a unitless non-zero token is not a length.
describe('shadow comments and unitless tokens', () => {
  it('a comment is stripped, not read as a fourth length', () => {
    expect(normalizeShadow('0px 2px 4px #000 /* opacity: 0.25 */')).toBe('0px 2px 4px 0px #000000');
  });

  it('a unitless non-zero number is kept as an unread token, not a length', () => {
    expect(normalizeShadow('0 2px 4px 0.25 #000')).toBe('0px 2px 4px 0px #000000 0.25');
  });
});

// A9 — invisible layers are dropped.
describe('invisible shadow layers', () => {
  it("drops Tailwind's 0 0 0 0px ring-offset layer", () => {
    expect(normalizeShadow('0 0 0 0px #fff, rgba(0, 0, 0, 0.1) 0px 1px 3px 0px')).toBe(
      '0px 1px 3px 0px #0000001a'
    );
    expect(normalizeShadow('rgb(255, 255, 255) 0px 0px 0px 0px')).toBe('none');
  });

  it('keeps a zero-offset layer that has a spread', () => {
    expect(normalizeShadow('0 0 0 2px #3b82f6')).toBe('0px 0px 0px 2px #3b82f6');
  });
});

// A5 — an unresolved declared category makes a clean result unknown.
describe('a declared category none of whose tokens resolved', () => {
  it('is unknown with a reason, not no-drift', () => {
    const inv = buildStyleInventory([el('a', { color: 'rgb(1, 2, 3)', paddingTop: '8px' })]);
    const report = computeTokenDrift(inv, {
      tokens: { colors: { ink: '#010203' }, spacing: { md: 'var(--nope)' } },
    });
    expect(report.categories.colors.status).toBe('compared');
    expect(report.categories.spacing).toMatchObject({
      status: 'no-declared-tokens',
      unresolvedDeclared: 1,
    });
    expect(report.verdict).toBe('unknown');
    expect(report.reason).toMatch(/spacing values/);
  });

  it('a real undeclared value still reports drift', () => {
    const inv = buildStyleInventory([el('a', { color: 'rgb(9, 9, 9)', paddingTop: '8px' })]);
    const report = computeTokenDrift(inv, {
      tokens: { colors: { ink: '#010203' }, spacing: { md: 'var(--nope)' } },
    });
    expect(report.verdict).toBe('drift');
  });
});

// A6 — one colour rule for drift and the validator.
describe('one colour-matching rule', () => {
  it('drift and the validator agree on a one-step 8-bit rounding', () => {
    expect(styleValuesEquivalent('rgb(59, 130, 246)', '#3b82f7', 'color')).toBe(true);
    const inv = buildStyleInventory([el('a', { color: 'rgb(59, 130, 246)' })]);
    expect(computeTokenDrift(inv, { tokens: { colors: { p: '#3b82f7' } } }).verdict).toBe(
      'no-drift'
    );
  });

  it('drift refuses an out-of-gamut colour even when its clamped hex equals a token', () => {
    const wide = 'oklch(0.95 0.4 150)';
    const inv = buildStyleInventory([el('a', { color: wide })]);
    const report = computeTokenDrift(inv, { tokens: { colors: { p: canonicalColor(wide)! } } });
    expect(report.verdict).toBe('drift');
    expect(report.undeclared[0]).toMatchObject({ value: canonicalColor(wide), outOfGamut: true });
    expect(styleValuesEquivalent(wide, canonicalColor(wide)!, 'color')).toBe(false);
  });

  it('canonicalColorsMatch compares wide-gamut identities, never a clamped hex', () => {
    const key = 'color(srgb-linear 1.1 0.5 -0.02 / 1)';
    expect(canonicalColorsMatch('#3b82f6', null, '#3b82f6', key)).toBe(false);
    expect(canonicalColorsMatch('#ffbb00', key, '#ffbb00', key)).toBe(true);
    expect(
      canonicalColorsMatch('#ffbb00', key, '#ffbb00', 'color(srgb-linear 1.2 0.5 -0.02 / 1)')
    ).toBe(false);
    expect(canonicalColorsMatch('#3b82f680', null, '#3b82f6', null)).toBe(false);
    expect(canonicalColorsMatch('#3b82f6', null, '#3b82f6', null)).toBe(true);
  });

  it('a wide-gamut token used verbatim matches its own use, in drift and the validator', () => {
    const inv = buildStyleInventory([el('a', { color: 'oklch(0.723 0.219 149.579)' })]);
    expect(inv.entries.colors[0].outOfGamut).toBe(true);
    const report = computeTokenDrift(inv, {
      customProperties: { '--color-green-500': 'oklch(72.3% 0.219 149.579)' },
    });
    expect(report.verdict).toBe('no-drift');
    expect(report.categories.colors.matched).toBe(1);
    expect(report.unused).toEqual([]);
    expect(
      styleValuesEquivalent('oklch(0.723 0.219 149.579)', 'oklch(72.3% 0.219 149.579)', 'color')
    ).toBe(true);
  });

  it('an entry merging two distinct wide-gamut colours matches neither', () => {
    const a = 'oklch(0.95 0.4 150)';
    const b = 'oklch(0.95 0.37 140)';
    const inv = buildStyleInventory([el('x', { color: a }), el('y', { color: b })]);
    expect(inv.entries.colors).toHaveLength(1);
    expect(inv.entries.colors[0].wideGamutSources).toHaveLength(2);
    expect(computeTokenDrift(inv, { tokens: { colors: { a } } }).verdict).toBe('drift');
  });
});

// A8 — a flat-map length is placed by its name, or decides nothing.
describe('flat-map length tokens', () => {
  it('a spacing-only map decides spacing alone', () => {
    const inv = buildStyleInventory([
      el('a', { paddingTop: '8px', fontSize: '16px', borderRadius: '4px' }),
    ]);
    const report = computeTokenDrift(inv, { customProperties: { '--space-2': '8px' } });
    expect(report.categories.spacing.status).toBe('compared');
    expect(report.categories.fontSizes.status).toBe('no-declared-tokens');
    expect(report.categories.borderRadius.status).toBe('no-declared-tokens');
    expect(report.verdict).toBe('no-drift');
  });

  it('an ambiguous name makes no category compared and is labelled inferred', () => {
    const inv = buildStyleInventory([el('a', { paddingTop: '8px', fontSize: '16px' })]);
    const report = computeTokenDrift(inv, {
      customProperties: { '--size-2': '8px', '--size-9': '99px' },
    });
    expect(report.categories.spacing).toMatchObject({
      status: 'no-declared-tokens',
      declared: 0,
      ambiguousDeclared: 2,
    });
    expect(report.verdict).toBe('unknown');
    expect(report.unused).toEqual([
      expect.objectContaining({ token: '--size-9', categoriesInferred: true }),
    ]);
  });

  it('names map to one category, or to none when they name two', () => {
    expect(lengthCategoryOfName('--chakra-space-4')).toBe('spacing');
    expect(lengthCategoryOfName('--radius-md')).toBe('borderRadius');
    expect(lengthCategoryOfName('--wp--preset--font-size--lg')).toBe('fontSizes');
    expect(lengthCategoryOfName('--text-sm')).toBe('fontSizes');
    expect(lengthCategoryOfName('--text-gap')).toBeUndefined();
    expect(lengthCategoryOfName('--size-2')).toBeUndefined();
  });
});

// Second review round.
describe('uncompared categories are never no-drift', () => {
  it('an ambiguous length leaving a category uncompared makes a clean result unknown', () => {
    const inv = buildStyleInventory([el('a', { color: 'rgb(59, 130, 246)', paddingTop: '13px' })]);
    const report = computeTokenDrift(inv, {
      customProperties: { '--brand': '#3b82f6', '--size-4': '16px' },
    });
    expect(report.categories.colors.status).toBe('compared');
    expect(report.categories.spacing).toMatchObject({
      status: 'no-declared-tokens',
      ambiguousDeclared: 1,
    });
    expect(report.verdict).toBe('unknown');
    expect(report.reason).toMatch(/spacing values/);
  });

  it('a flat-map length named for a category that fails to resolve counts there', () => {
    const inv = buildStyleInventory([el('a', { color: 'rgb(59, 130, 246)', paddingTop: '13px' })]);
    const report = computeTokenDrift(inv, {
      customProperties: {
        '--brand': '#3b82f6',
        '--space-4': 'calc(1px * var(--missing))',
        '--text-primary': 'var(--missing)',
      },
    });
    expect(report.categories.spacing.unresolvedDeclared).toBe(1);
    expect(report.categories.fontSizes.unresolvedDeclared).toBe(0);
    expect(report.unresolvedUncategorised).toBe(1);
    expect(report.verdict).toBe('unknown');
  });
});

describe('a native object colour inside a shadow', () => {
  it('is one layer: commas inside native(...) do not split the list', () => {
    expect(normalizeShadow('0px 1px 2px native({"semantic":["a","b"]})')).toBe(
      '0px 1px 2px 0px native({"semantic":["a","b"]})'
    );
  });
});
