/**
 * Design Inspector Tests
 *
 * Tests for the design inspector module which extracts computed styles,
 * captures state variations, responsive snapshots, and WCAG contrast checks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getExtendedComputedStyles,
  getElementDesignData,
  captureStateVariations,
  captureResponsiveSnapshots,
  computeContrastRatio,
  checkContrastCompliance,
  DEFAULT_VIEWPORTS,
  type DesignRegistryLike,
} from '../design-inspector';

// ============================================================================
// computeContrastRatio - Pure Math Tests
// ============================================================================

describe('computeContrastRatio', () => {
  it('should return 21:1 for black on white', () => {
    const ratio = computeContrastRatio('rgb(0, 0, 0)', 'rgb(255, 255, 255)');
    expect(ratio).toBeCloseTo(21, 0);
  });

  it('should return 21:1 for white on black', () => {
    const ratio = computeContrastRatio('rgb(255, 255, 255)', 'rgb(0, 0, 0)');
    expect(ratio).toBeCloseTo(21, 0);
  });

  it('should return 1:1 for same colors', () => {
    const ratio = computeContrastRatio('rgb(128, 128, 128)', 'rgb(128, 128, 128)');
    expect(ratio).toBeCloseTo(1, 1);
  });

  it('should return 1:1 for black on black', () => {
    const ratio = computeContrastRatio('rgb(0, 0, 0)', 'rgb(0, 0, 0)');
    expect(ratio).toBeCloseTo(1, 1);
  });

  it('should return 1:1 for white on white', () => {
    const ratio = computeContrastRatio('rgb(255, 255, 255)', 'rgb(255, 255, 255)');
    expect(ratio).toBeCloseTo(1, 1);
  });

  it('should handle rgba format (ignoring alpha)', () => {
    const ratio = computeContrastRatio('rgba(0, 0, 0, 0.5)', 'rgba(255, 255, 255, 1)');
    // parseColor extracts the RGB values, ignoring alpha
    expect(ratio).toBeCloseTo(21, 0);
  });

  it('should calculate contrast for mid-range colors', () => {
    // Pure red (#FF0000) vs white (#FFFFFF)
    // Red luminance = 0.2126 * 0.2126 + 0.7152 * 0 + 0.0722 * 0 ~= 0.2126
    // Actually red sRGB: (1+0.055)/1.055)^2.4 * 0.2126
    const ratio = computeContrastRatio('rgb(255, 0, 0)', 'rgb(255, 255, 255)');
    // Red on white is approximately 4:1
    expect(ratio).toBeGreaterThan(3.5);
    expect(ratio).toBeLessThan(4.5);
  });

  it('should always return a value >= 1', () => {
    const ratio = computeContrastRatio('rgb(100, 100, 100)', 'rgb(200, 200, 200)');
    expect(ratio).toBeGreaterThanOrEqual(1);
  });

  it('should be symmetric (order of fg/bg should not matter)', () => {
    const ratio1 = computeContrastRatio('rgb(50, 100, 150)', 'rgb(200, 220, 240)');
    const ratio2 = computeContrastRatio('rgb(200, 220, 240)', 'rgb(50, 100, 150)');
    expect(ratio1).toBeCloseTo(ratio2, 5);
  });

  it('should handle named colors via DOM parsing', () => {
    // jsdom should be able to parse "black" and "white" through the DOM temp element
    const ratio = computeContrastRatio('black', 'white');
    expect(ratio).toBeCloseTo(21, 0);
  });

  it('should handle hex colors via DOM parsing', () => {
    const ratio = computeContrastRatio('#000000', '#ffffff');
    expect(ratio).toBeCloseTo(21, 0);
  });
});

// ============================================================================
// checkContrastCompliance - WCAG Threshold Tests
// ============================================================================

describe('checkContrastCompliance', () => {
  describe('normal text (< 18pt)', () => {
    const fontSize = '16px';
    const fontWeight = '400';

    it('should pass AA and AAA for black on white (21:1)', () => {
      const result = checkContrastCompliance(
        'rgb(0, 0, 0)',
        'rgb(255, 255, 255)',
        fontSize,
        fontWeight
      );
      expect(result.ratio).toBeCloseTo(21, 0);
      expect(result.passesAA).toBe(true);
      expect(result.passesAAA).toBe(true);
    });

    it('should fail both AA and AAA for very low contrast', () => {
      // Light gray on white - very low contrast
      const result = checkContrastCompliance(
        'rgb(200, 200, 200)',
        'rgb(255, 255, 255)',
        fontSize,
        fontWeight
      );
      expect(result.ratio).toBeLessThan(3);
      expect(result.passesAA).toBe(false);
      expect(result.passesAAA).toBe(false);
    });

    it('should pass AA but fail AAA for medium contrast (~4.5:1)', () => {
      // We need a color pair with contrast between 4.5 and 7
      // rgb(100, 100, 100) on white gives roughly 5.3:1
      const result = checkContrastCompliance(
        'rgb(100, 100, 100)',
        'rgb(255, 255, 255)',
        fontSize,
        fontWeight
      );
      expect(result.ratio).toBeGreaterThanOrEqual(4.5);
      expect(result.ratio).toBeLessThan(7);
      expect(result.passesAA).toBe(true);
      expect(result.passesAAA).toBe(false);
    });

    it('should require 4.5:1 for AA on normal text', () => {
      // Exactly at threshold boundary
      // rgb(118, 118, 118) on white ~ 4.5:1
      const result = checkContrastCompliance(
        'rgb(118, 118, 118)',
        'rgb(255, 255, 255)',
        fontSize,
        fontWeight
      );
      // Should be very close to 4.5
      if (result.ratio >= 4.5) {
        expect(result.passesAA).toBe(true);
      } else {
        expect(result.passesAA).toBe(false);
      }
    });

    it('should require 7:1 for AAA on normal text', () => {
      const result = checkContrastCompliance(
        'rgb(0, 0, 0)',
        'rgb(255, 255, 255)',
        fontSize,
        fontWeight
      );
      expect(result.ratio).toBeGreaterThanOrEqual(7);
      expect(result.passesAAA).toBe(true);
    });
  });

  describe('large text (>= 24px)', () => {
    const fontSize = '24px';
    const fontWeight = '400';

    it('should use relaxed thresholds: 3:1 for AA', () => {
      // A color pair with contrast between 3 and 4.5
      // rgb(148, 148, 148) on white ~ 3.0:1
      const result = checkContrastCompliance(
        'rgb(137, 137, 137)',
        'rgb(255, 255, 255)',
        fontSize,
        fontWeight
      );
      // Should be around 3+ but less than 4.5
      if (result.ratio >= 3) {
        expect(result.passesAA).toBe(true);
      }
    });

    it('should use 4.5:1 for AAA on large text', () => {
      const result = checkContrastCompliance(
        'rgb(89, 89, 89)',
        'rgb(255, 255, 255)',
        fontSize,
        fontWeight
      );
      // ~5.9:1 should pass AAA for large text (threshold 4.5)
      expect(result.ratio).toBeGreaterThanOrEqual(4.5);
      expect(result.passesAAA).toBe(true);
    });

    it('should pass AA for black on white', () => {
      const result = checkContrastCompliance(
        'rgb(0, 0, 0)',
        'rgb(255, 255, 255)',
        fontSize,
        fontWeight
      );
      expect(result.passesAA).toBe(true);
      expect(result.passesAAA).toBe(true);
    });
  });

  describe('large bold text (>= 18.66px and bold)', () => {
    const fontSize = '18.66px';
    const fontWeight = '700';

    it('should be treated as large text', () => {
      // Should use relaxed thresholds (3:1 for AA, 4.5:1 for AAA)
      const result = checkContrastCompliance(
        'rgb(0, 0, 0)',
        'rgb(255, 255, 255)',
        fontSize,
        fontWeight
      );
      expect(result.passesAA).toBe(true);
      expect(result.passesAAA).toBe(true);
    });

    it('should use 3:1 AA threshold for bold text >= 18.66px', () => {
      // Find a color with contrast ~3.5:1 which passes AA for large text but not normal
      const result = checkContrastCompliance(
        'rgb(130, 130, 130)',
        'rgb(255, 255, 255)',
        fontSize,
        fontWeight
      );
      if (result.ratio >= 3 && result.ratio < 4.5) {
        expect(result.passesAA).toBe(true);
        // passesAAA requires 4.5:1 for large text
        expect(result.passesAAA).toBe(false);
      }
    });
  });

  describe('bold text below 18.66px threshold', () => {
    it('should NOT be treated as large text', () => {
      const fontSize = '14px';
      const fontWeight = '700';
      // rgb(137, 137, 137) on white ~ 3.3:1 — passes for large text AA, not normal
      const result = checkContrastCompliance(
        'rgb(137, 137, 137)',
        'rgb(255, 255, 255)',
        fontSize,
        fontWeight
      );
      // 14px bold is NOT large text (need >= 18.66px for bold threshold)
      // So AA requires 4.5:1, and this should fail
      if (result.ratio < 4.5) {
        expect(result.passesAA).toBe(false);
      }
    });
  });

  describe('font weight parsing', () => {
    it('should treat "bold" as 700', () => {
      const result1 = checkContrastCompliance('rgb(0, 0, 0)', 'rgb(255, 255, 255)', '19px', 'bold');
      const result2 = checkContrastCompliance('rgb(0, 0, 0)', 'rgb(255, 255, 255)', '19px', '700');
      expect(result1.passesAA).toBe(result2.passesAA);
      expect(result1.passesAAA).toBe(result2.passesAAA);
    });

    it('should treat non-numeric non-bold weight as 400', () => {
      const result = checkContrastCompliance(
        'rgb(0, 0, 0)',
        'rgb(255, 255, 255)',
        '19px',
        'normal'
      );
      // 19px with weight 400 is NOT large text (need >= 24px for non-bold)
      // Actually 19px >= 18.66px but weight 400 < 700, so NOT large.
      // Wait: 19px is < 24px and weight 400 < 700, so it's normal text
      // Still passes because black/white is 21:1
      expect(result.passesAA).toBe(true);
    });
  });

  describe('return value structure', () => {
    it('should always return ratio, passesAA, and passesAAA', () => {
      const result = checkContrastCompliance('rgb(0, 0, 0)', 'rgb(255, 255, 255)', '16px', '400');
      expect(result).toHaveProperty('ratio');
      expect(result).toHaveProperty('passesAA');
      expect(result).toHaveProperty('passesAAA');
      expect(typeof result.ratio).toBe('number');
      expect(typeof result.passesAA).toBe('boolean');
      expect(typeof result.passesAAA).toBe('boolean');
    });
  });
});

// ============================================================================
// DEFAULT_VIEWPORTS constant
// ============================================================================

describe('DEFAULT_VIEWPORTS', () => {
  it('should have mobile, tablet, desktop, and wide breakpoints', () => {
    expect(DEFAULT_VIEWPORTS).toHaveProperty('mobile');
    expect(DEFAULT_VIEWPORTS).toHaveProperty('tablet');
    expect(DEFAULT_VIEWPORTS).toHaveProperty('desktop');
    expect(DEFAULT_VIEWPORTS).toHaveProperty('wide');
  });

  it('should have ascending widths', () => {
    expect(DEFAULT_VIEWPORTS.mobile).toBeLessThan(DEFAULT_VIEWPORTS.tablet);
    expect(DEFAULT_VIEWPORTS.tablet).toBeLessThan(DEFAULT_VIEWPORTS.desktop);
    expect(DEFAULT_VIEWPORTS.desktop).toBeLessThan(DEFAULT_VIEWPORTS.wide);
  });

  it('should have expected values', () => {
    expect(DEFAULT_VIEWPORTS.mobile).toBe(375);
    expect(DEFAULT_VIEWPORTS.tablet).toBe(768);
    expect(DEFAULT_VIEWPORTS.desktop).toBe(1280);
    expect(DEFAULT_VIEWPORTS.wide).toBe(1920);
  });
});

// ============================================================================
// getExtendedComputedStyles - jsdom DOM Tests
// ============================================================================

describe('getExtendedComputedStyles', () => {
  let el: HTMLDivElement;

  beforeEach(() => {
    el = document.createElement('div');
    document.body.appendChild(el);
  });

  afterEach(() => {
    document.body.removeChild(el);
  });

  it('should return an object with all design properties', () => {
    const styles = getExtendedComputedStyles(el);
    expect(styles).toBeDefined();
    expect(typeof styles).toBe('object');
  });

  it('should include layout properties', () => {
    const styles = getExtendedComputedStyles(el);
    expect(styles).toHaveProperty('display');
    expect(styles).toHaveProperty('position');
    expect(styles).toHaveProperty('boxSizing');
    expect(styles).toHaveProperty('width');
    expect(styles).toHaveProperty('height');
    expect(styles).toHaveProperty('margin');
    expect(styles).toHaveProperty('padding');
    expect(styles).toHaveProperty('overflow');
  });

  it('should include flex/grid properties', () => {
    const styles = getExtendedComputedStyles(el);
    expect(styles).toHaveProperty('flexDirection');
    expect(styles).toHaveProperty('flexWrap');
    expect(styles).toHaveProperty('justifyContent');
    expect(styles).toHaveProperty('alignItems');
    expect(styles).toHaveProperty('gap');
    expect(styles).toHaveProperty('gridTemplateColumns');
    expect(styles).toHaveProperty('gridTemplateRows');
  });

  it('should include typography properties', () => {
    const styles = getExtendedComputedStyles(el);
    expect(styles).toHaveProperty('fontFamily');
    expect(styles).toHaveProperty('fontSize');
    expect(styles).toHaveProperty('fontWeight');
    expect(styles).toHaveProperty('lineHeight');
    expect(styles).toHaveProperty('color');
    expect(styles).toHaveProperty('textAlign');
  });

  it('should include visual properties', () => {
    const styles = getExtendedComputedStyles(el);
    expect(styles).toHaveProperty('backgroundColor');
    expect(styles).toHaveProperty('border');
    expect(styles).toHaveProperty('borderRadius');
    expect(styles).toHaveProperty('boxShadow');
    expect(styles).toHaveProperty('opacity');
  });

  it('should include effect properties', () => {
    const styles = getExtendedComputedStyles(el);
    expect(styles).toHaveProperty('transform');
    expect(styles).toHaveProperty('transition');
    expect(styles).toHaveProperty('cursor');
    expect(styles).toHaveProperty('zIndex');
    expect(styles).toHaveProperty('visibility');
    expect(styles).toHaveProperty('pointerEvents');
  });

  it('should read inline styles from the element', () => {
    el.style.display = 'flex';
    el.style.position = 'relative';
    const styles = getExtendedComputedStyles(el);
    // jsdom may or may not fully compute these, but the function should not throw
    expect(styles.display).toBeDefined();
    expect(styles.position).toBeDefined();
  });

  it('should return string values for all properties', () => {
    const styles = getExtendedComputedStyles(el);
    for (const [_key, value] of Object.entries(styles)) {
      expect(typeof value).toBe('string');
    }
  });
});

// ============================================================================
// getElementDesignData - jsdom DOM Tests
// ============================================================================

describe('getElementDesignData', () => {
  let el: HTMLDivElement;

  beforeEach(() => {
    el = document.createElement('div');
    document.body.appendChild(el);
  });

  afterEach(() => {
    document.body.removeChild(el);
  });

  it('should return element design data with styles and rect', () => {
    const data = getElementDesignData(el);
    expect(data).toHaveProperty('elementId');
    expect(data).toHaveProperty('type');
    expect(data).toHaveProperty('styles');
    expect(data).toHaveProperty('rect');
    expect(data.rect).toHaveProperty('x');
    expect(data.rect).toHaveProperty('y');
    expect(data.rect).toHaveProperty('width');
    expect(data.rect).toHaveProperty('height');
  });

  it('should use the element tag name as type by default', () => {
    const data = getElementDesignData(el);
    expect(data.type).toBe('div');
  });

  it('should use provided type option', () => {
    const data = getElementDesignData(el, { type: 'card' });
    expect(data.type).toBe('card');
  });

  it('should use element id for elementId', () => {
    el.id = 'my-element';
    const data = getElementDesignData(el);
    expect(data.elementId).toBe('my-element');
  });

  it('should use data-ui-id for elementId when no id', () => {
    el.setAttribute('data-ui-id', 'bridge-element');
    const data = getElementDesignData(el);
    expect(data.elementId).toBe('bridge-element');
  });

  it('should use provided elementId option over element id', () => {
    el.id = 'original-id';
    const data = getElementDesignData(el, { elementId: 'override-id' });
    expect(data.elementId).toBe('override-id');
  });

  it('should include label when provided', () => {
    const data = getElementDesignData(el, { label: 'My Card' });
    expect(data.label).toBe('My Card');
  });

  it('should not include label when not provided', () => {
    const data = getElementDesignData(el);
    expect(data.label).toBeUndefined();
  });

  it('should not include pseudoElements when not requested', () => {
    const data = getElementDesignData(el);
    expect(data.pseudoElements).toBeUndefined();
  });

  it('should not include pseudoElements when none exist', () => {
    const data = getElementDesignData(el, { includePseudoElements: true });
    // ::before and ::after have content: none by default, so they should be filtered
    expect(data.pseudoElements).toBeUndefined();
  });

  it('should work with different HTML element types', () => {
    const button = document.createElement('button');
    document.body.appendChild(button);
    const data = getElementDesignData(button);
    expect(data.type).toBe('button');
    document.body.removeChild(button);
  });

  it('should return empty string elementId for elements without any id', () => {
    const data = getElementDesignData(el);
    expect(data.elementId).toBe('');
  });
});

// ============================================================================
// captureStateVariations - jsdom DOM Tests
// ============================================================================

describe('captureStateVariations', () => {
  let el: HTMLButtonElement;

  beforeEach(() => {
    el = document.createElement('button');
    el.textContent = 'Click Me';
    document.body.appendChild(el);

    // jsdom does not have requestAnimationFrame by default in all versions.
    // Ensure it exists (vitest jsdom usually provides it, but let's be safe).
    if (!globalThis.requestAnimationFrame) {
      globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
        return setTimeout(() => cb(Date.now()), 0) as unknown as number;
      };
    }
  });

  afterEach(() => {
    if (el.parentNode) {
      document.body.removeChild(el);
    }
  });

  it('should always include the default state as the first entry', async () => {
    const results = await captureStateVariations(el);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].state).toBe('default');
    expect(results[0].diffFromDefault).toEqual([]);
  });

  it('should capture all four default interaction states plus default', async () => {
    const results = await captureStateVariations(el);
    const stateNames = results.map((r) => r.state);
    expect(stateNames).toContain('default');
    expect(stateNames).toContain('hover');
    expect(stateNames).toContain('focus');
    expect(stateNames).toContain('active');
    expect(stateNames).toContain('disabled');
    expect(results.length).toBe(5);
  });

  it('should accept a custom subset of states', async () => {
    const results = await captureStateVariations(el, ['hover', 'focus']);
    const stateNames = results.map((r) => r.state);
    expect(stateNames).toContain('default');
    expect(stateNames).toContain('hover');
    expect(stateNames).toContain('focus');
    expect(stateNames).not.toContain('active');
    expect(stateNames).not.toContain('disabled');
    expect(results.length).toBe(3); // default + hover + focus
  });

  it('should skip default if explicitly passed as a state', async () => {
    // 'default' is skipped inside the loop (if stateName === 'default' continue)
    const results = await captureStateVariations(el, ['default', 'hover']);
    const stateNames = results.map((r) => r.state);
    // The initial default is always pushed, and the loop skips 'default'
    expect(stateNames.filter((s) => s === 'default').length).toBe(1);
    expect(stateNames).toContain('hover');
  });

  it('should have styles property on each state result', async () => {
    const results = await captureStateVariations(el, ['hover']);
    for (const result of results) {
      expect(result.styles).toBeDefined();
      expect(result.styles).toHaveProperty('display');
      expect(result.styles).toHaveProperty('color');
    }
  });

  it('should have diffFromDefault as an array on each state result', async () => {
    const results = await captureStateVariations(el, ['hover']);
    for (const result of results) {
      expect(Array.isArray(result.diffFromDefault)).toBe(true);
    }
  });

  it('should restore the disabled state after capture', async () => {
    expect(el.disabled).toBe(false);
    await captureStateVariations(el, ['disabled']);
    expect(el.disabled).toBe(false);
  });

  it('should restore focus state after capture', async () => {
    el.blur();
    await captureStateVariations(el, ['focus']);
    // After restoring, element should not be focused
    expect(document.activeElement).not.toBe(el);
  });
});

// ============================================================================
// captureResponsiveSnapshots - jsdom DOM Tests
// ============================================================================

describe('captureResponsiveSnapshots', () => {
  let originalWidth: string;
  let originalMinWidth: string;
  let originalMaxWidth: string;
  let originalOverflow: string;

  beforeEach(() => {
    originalWidth = document.documentElement.style.width;
    originalMinWidth = document.documentElement.style.minWidth;
    originalMaxWidth = document.documentElement.style.maxWidth;
    originalOverflow = document.documentElement.style.overflow;

    if (!globalThis.requestAnimationFrame) {
      globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
        return setTimeout(() => cb(Date.now()), 0) as unknown as number;
      };
    }
  });

  afterEach(() => {
    document.documentElement.style.width = originalWidth;
    document.documentElement.style.minWidth = originalMinWidth;
    document.documentElement.style.maxWidth = originalMaxWidth;
    document.documentElement.style.overflow = originalOverflow;
  });

  function createMockRegistry(
    elements: Array<{
      id: string;
      element: HTMLElement;
      type: string;
      label?: string;
    }>
  ): DesignRegistryLike {
    return {
      getAllElements: () => elements,
    };
  }

  it('should capture snapshots for each viewport with Record format', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);

    const registry = createMockRegistry([{ id: 'el-1', element: el, type: 'container' }]);

    const snapshots = await captureResponsiveSnapshots(registry, {
      mobile: 375,
      desktop: 1280,
    });

    expect(snapshots).toHaveLength(2);
    expect(snapshots[0].viewportWidth).toBe(375);
    expect(snapshots[0].viewportLabel).toBe('mobile');
    expect(snapshots[1].viewportWidth).toBe(1280);
    expect(snapshots[1].viewportLabel).toBe('desktop');

    document.body.removeChild(el);
  });

  it('should capture snapshots for each viewport with array format', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);

    const registry = createMockRegistry([{ id: 'el-1', element: el, type: 'container' }]);

    const snapshots = await captureResponsiveSnapshots(registry, [375, 768, 1280]);

    expect(snapshots).toHaveLength(3);
    expect(snapshots[0].viewportWidth).toBe(375);
    expect(snapshots[0].viewportLabel).toBe('375px');
    expect(snapshots[1].viewportWidth).toBe(768);
    expect(snapshots[1].viewportLabel).toBe('768px');
    expect(snapshots[2].viewportWidth).toBe(1280);
    expect(snapshots[2].viewportLabel).toBe('1280px');

    document.body.removeChild(el);
  });

  it('should include element design data for each element at each viewport', async () => {
    const el1 = document.createElement('div');
    const el2 = document.createElement('span');
    document.body.appendChild(el1);
    document.body.appendChild(el2);

    const registry = createMockRegistry([
      { id: 'card', element: el1, type: 'card', label: 'Main Card' },
      { id: 'text', element: el2, type: 'text' },
    ]);

    const snapshots = await captureResponsiveSnapshots(registry, { mobile: 375 });

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].elements).toHaveLength(2);
    expect(snapshots[0].elements[0].elementId).toBe('card');
    expect(snapshots[0].elements[0].label).toBe('Main Card');
    expect(snapshots[0].elements[0].type).toBe('card');
    expect(snapshots[0].elements[1].elementId).toBe('text');

    document.body.removeChild(el1);
    document.body.removeChild(el2);
  });

  it('should include a timestamp in each snapshot', async () => {
    const registry = createMockRegistry([]);
    const before = Date.now();
    const snapshots = await captureResponsiveSnapshots(registry, { mobile: 375 });
    const after = Date.now();

    expect(snapshots[0].timestamp).toBeGreaterThanOrEqual(before);
    expect(snapshots[0].timestamp).toBeLessThanOrEqual(after);
  });

  it('should restore document width after capture', async () => {
    document.documentElement.style.width = '100%';
    const registry = createMockRegistry([]);

    await captureResponsiveSnapshots(registry, { mobile: 375, desktop: 1280 });

    expect(document.documentElement.style.width).toBe('100%');
  });

  it('should restore all document styles after capture even if registry throws', async () => {
    document.documentElement.style.width = 'auto';
    document.documentElement.style.overflow = 'visible';

    const badRegistry: DesignRegistryLike = {
      getAllElements: () => {
        throw new Error('Registry error');
      },
    };

    await expect(captureResponsiveSnapshots(badRegistry, { mobile: 375 })).rejects.toThrow(
      'Registry error'
    );

    // Styles should be restored by the finally block
    expect(document.documentElement.style.width).toBe('auto');
    expect(document.documentElement.style.overflow).toBe('visible');
  });

  it('should handle empty registry', async () => {
    const registry = createMockRegistry([]);
    const snapshots = await captureResponsiveSnapshots(registry, { mobile: 375 });

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].elements).toHaveLength(0);
  });

  it('should include rect data for elements', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);

    const registry = createMockRegistry([{ id: 'el-1', element: el, type: 'box' }]);

    const snapshots = await captureResponsiveSnapshots(registry, { mobile: 375 });
    const elementData = snapshots[0].elements[0];

    expect(elementData.rect).toBeDefined();
    expect(typeof elementData.rect.x).toBe('number');
    expect(typeof elementData.rect.y).toBe('number');
    expect(typeof elementData.rect.width).toBe('number');
    expect(typeof elementData.rect.height).toBe('number');

    document.body.removeChild(el);
  });
});

// ============================================================================
// Edge Cases and Integration
// ============================================================================

describe('edge cases', () => {
  describe('computeContrastRatio with unparseable colors', () => {
    it('should fall back to black (0,0,0) for unparseable color strings', () => {
      // "not-a-color" won't parse as rgb and jsdom may not resolve it either
      // The function defaults to [0,0,0] when parsing fails
      const ratio = computeContrastRatio('not-a-color', 'rgb(255, 255, 255)');
      // Fallback is black, so should be close to 21:1
      expect(ratio).toBeCloseTo(21, 0);
    });

    it('should handle empty string colors by defaulting to black', () => {
      const ratio = computeContrastRatio('', 'rgb(255, 255, 255)');
      expect(ratio).toBeCloseTo(21, 0);
    });
  });

  describe('getExtendedComputedStyles with detached elements', () => {
    it('should still work on elements not in the DOM', () => {
      const detached = document.createElement('div');
      // Not appended to document.body
      // getComputedStyle on detached elements returns empty/default values but should not throw
      const styles = getExtendedComputedStyles(detached);
      expect(styles).toBeDefined();
      expect(typeof styles.display).toBe('string');
    });
  });

  describe('getElementDesignData with various element types', () => {
    it('should handle input elements', () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.id = 'name-input';
      document.body.appendChild(input);

      const data = getElementDesignData(input);
      expect(data.type).toBe('input');
      expect(data.elementId).toBe('name-input');

      document.body.removeChild(input);
    });

    it('should handle elements with no attributes', () => {
      const span = document.createElement('span');
      document.body.appendChild(span);

      const data = getElementDesignData(span);
      expect(data.elementId).toBe('');
      expect(data.type).toBe('span');

      document.body.removeChild(span);
    });
  });

  describe('captureStateVariations with empty states array', () => {
    it('should only return default state when given empty array', async () => {
      const el = document.createElement('button');
      document.body.appendChild(el);

      if (!globalThis.requestAnimationFrame) {
        globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
          return setTimeout(() => cb(Date.now()), 0) as unknown as number;
        };
      }

      const results = await captureStateVariations(el, []);
      expect(results).toHaveLength(1);
      expect(results[0].state).toBe('default');

      document.body.removeChild(el);
    });
  });
});
