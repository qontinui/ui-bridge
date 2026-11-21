/**
 * Design Inspector Tests
 *
 * Tests for the design inspector module which extracts computed styles,
 * captures state variations, responsive snapshots, and WCAG contrast checks.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getExtendedComputedStyles,
  getElementDesignData,
  captureStateVariations,
  captureResponsiveSnapshots,
  computeContrastRatio,
  checkContrastCompliance,
  DEFAULT_VIEWPORTS,
  readFocusVisible,
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

  it('should use data-testid for elementId when no id', () => {
    el.setAttribute('data-testid', 'bridge-element');
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

  it('should capture all five default interaction states plus default', async () => {
    const results = await captureStateVariations(el);
    const stateNames = results.map((r) => r.state);
    expect(stateNames).toEqual([
      'default',
      'hover',
      'focus',
      'focus-visible',
      'active',
      'disabled',
    ]);
  });

  it('reports focusVisible on the focus entry and focused on the focus-visible entry only', async () => {
    const results = await captureStateVariations(el, ['hover', 'focus', 'focus-visible']);
    const byState = Object.fromEntries(results.map((r) => [r.state, r]));
    // A <button> takes focus. jsdom has no input-modality heuristic, so a
    // focused element never matches :focus-visible there.
    expect(byState.focus.focusVisible).toBe(false);
    expect(byState['focus-visible'].forced).toBe(true);
    expect(byState['focus-visible'].focusCaveat).toBeUndefined();
    expect(byState.focus.forced).toBeUndefined();
    expect(byState['focus-visible'].focused).toBe(true);
    expect(byState.default.focusVisible).toBeUndefined();
    expect(byState.hover.focusVisible).toBeUndefined();
    expect(byState['focus-visible'].focusVisible).toBeUndefined();
    expect(byState.default.focused).toBeUndefined();
    expect(byState.focus.focused).toBeUndefined();
  });

  it("reports focusVisible 'unknown', never false, when the match cannot be read", async () => {
    const native = Element.prototype.matches;
    const spy = vi.spyOn(Element.prototype, 'matches').mockImplementation(function (
      this: Element,
      selector: string
    ) {
      if (selector.includes(':focus-visible')) throw new SyntaxError('unsupported selector');
      return native.call(this, selector);
    });
    try {
      el.focus();
      expect(readFocusVisible(el)).toBe('unknown');
      el.blur();
      const results = await captureStateVariations(el, ['focus']);
      expect(results.find((r) => r.state === 'focus')?.focusVisible).toBe('unknown');
    } finally {
      spy.mockRestore();
    }
  });

  it("an element the focus does not land on reports 'not_focused' and focused=false, and nothing is forced", async () => {
    const div = document.createElement('div');
    div.textContent = 'not focusable';
    document.body.appendChild(div);
    // Records every attribute write on the div, so a forced hold that was
    // taken and released again still shows up.
    const written: Array<string | null> = [];
    const observer = new MutationObserver((records) => {
      for (const r of records) written.push(r.attributeName);
    });
    observer.observe(div, { attributes: true });
    try {
      expect(readFocusVisible(div)).toBe('not_focused');
      const results = await captureStateVariations(div, ['focus', 'focus-visible']);
      const byState = Object.fromEntries(results.map((r) => [r.state, r]));
      expect(byState.focus.focusVisible).toBe('not_focused');
      expect(byState['focus-visible'].focused).toBe(false);
      expect(byState['focus-visible'].forced).toBe(false);
      expect(byState['focus-visible'].notForcedReason).toBe('not_focused');
      for (const r of observer.takeRecords()) written.push(r.attributeName);
      expect(written).not.toContain('data-ui-bridge-pseudo-focus-visible');
    } finally {
      observer.disconnect();
      div.remove();
    }
  });

  it('an element inside an open shadow root holds focus, and focus returns to the previous element after', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const inner = document.createElement('button');
    inner.textContent = 'inner';
    shadow.appendChild(inner);
    const before = document.createElement('input');
    document.body.appendChild(before);
    try {
      before.focus();
      const results = await captureStateVariations(inner, ['focus', 'focus-visible']);
      const byState = Object.fromEntries(results.map((r) => [r.state, r]));
      expect(byState.focus.focusVisible).toBe(false);
      expect(byState['focus-visible'].forced).toBe(true);
      expect(byState['focus-visible'].focused).toBe(true);
      expect(document.activeElement).toBe(before);
      expect(shadow.activeElement).toBeNull();
    } finally {
      host.remove();
      before.remove();
    }
  });

  it('a non-focusable shadow host whose inner input has focus does not hold focus, and the input keeps it', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const input = document.createElement('input');
    shadow.appendChild(input);
    const written: Array<string | null> = [];
    const observer = new MutationObserver((records) => {
      for (const r of records) written.push(r.attributeName);
    });
    observer.observe(host, { attributes: true });
    try {
      input.focus();
      // The document's activeElement is retargeted to the host.
      expect(document.activeElement).toBe(host);
      expect(readFocusVisible(host)).toBe('not_focused');
      const results = await captureStateVariations(host, ['focus', 'focus-visible']);
      for (const r of observer.takeRecords()) written.push(r.attributeName);
      const byState = Object.fromEntries(results.map((r) => [r.state, r]));
      expect(byState.focus.focusVisible).toBe('not_focused');
      expect(byState['focus-visible'].focused).toBe(false);
      expect(byState['focus-visible'].forced).toBe(false);
      expect(byState['focus-visible'].notForcedReason).toBe('not_focused');
      expect(written).not.toContain('data-ui-bridge-pseudo-focus-visible');
      expect(shadow.activeElement).toBe(input);
    } finally {
      observer.disconnect();
      host.remove();
    }
  });

  it('an element in a same-origin iframe holds focus, and focus returns to its previous element there', async () => {
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    const doc = frame.contentDocument!;
    const target = doc.createElement('button');
    target.textContent = 'target';
    const previous = doc.createElement('input');
    doc.body.append(target, previous);
    try {
      previous.focus();
      expect(doc.activeElement).toBe(previous);
      const results = await captureStateVariations(target, ['focus', 'focus-visible']);
      const byState = Object.fromEntries(results.map((r) => [r.state, r]));
      expect(byState.focus.focusVisible).toBe(false);
      expect(byState['focus-visible'].forced).toBe(true);
      expect(byState['focus-visible'].focused).toBe(true);
      expect(doc.activeElement).toBe(previous);
    } finally {
      frame.remove();
    }
  });

  it('an element inside a CLOSED shadow root holds focus, and focus returns to the previous element after', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const closed = host.attachShadow({ mode: 'closed' });
    const inner = document.createElement('button');
    inner.textContent = 'inner';
    closed.appendChild(inner);
    const before = document.createElement('input');
    document.body.appendChild(before);
    try {
      before.focus();
      expect(readFocusVisible(inner)).toBe('not_focused');
      const results = await captureStateVariations(inner, ['focus', 'focus-visible']);
      const byState = Object.fromEntries(results.map((r) => [r.state, r]));
      expect(byState.focus.focusVisible).toBe(false);
      expect(byState['focus-visible'].forced).toBe(true);
      expect(byState['focus-visible'].focused).toBe(true);
      expect(document.activeElement).toBe(before);
      expect(closed.activeElement).toBeNull();
    } finally {
      host.remove();
      before.remove();
    }
  });

  it('a delegatesFocus host holds focus while its inner element does (holdsFocus only; the blur decision is guarded in Chromium)', async () => {
    // jsdom implements neither the `delegatesFocus` flag nor the delegation:
    // the flag is stubbed and the delegated focus is placed by hand. This case
    // pins the delegatesFocus arm of holdsFocus. It does NOT guard the
    // restore's blur decision: jsdom's blur() on a host whose focus is inside
    // its shadow tree is a no-op, so a restore that wrongly blurs passes here.
    // The Chromium twin in focus-visible.smoke.test.ts ("a previous focus
    // inside a delegatesFocus host is kept by the restore") guards that.
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    Object.defineProperty(shadow, 'delegatesFocus', { value: true });
    const inner = document.createElement('button');
    inner.textContent = 'inner';
    shadow.appendChild(inner);
    try {
      inner.focus();
      expect(readFocusVisible(host)).toBe(false);
      const results = await captureStateVariations(host, ['focus', 'focus-visible']);
      const byState = Object.fromEntries(results.map((r) => [r.state, r]));
      expect(byState.focus.focusVisible).toBe(false);
      expect(byState['focus-visible'].forced).toBe(true);
      expect(byState['focus-visible'].focused).toBe(true);
      expect(shadow.activeElement).toBe(inner);
      expect(document.activeElement).toBe(host);
    } finally {
      host.remove();
    }
  });

  it('an element already focused before the read is still focused after it', async () => {
    try {
      el.focus();
      const results = await captureStateVariations(el, ['focus', 'focus-visible']);
      const byState = Object.fromEntries(results.map((r) => [r.state, r]));
      expect(byState.focus.focusVisible).toBe(false);
      expect(byState['focus-visible'].forced).toBe(true);
      expect(document.activeElement).toBe(el);
    } finally {
      el.blur();
    }
  });

  it('inside one CLOSED shadow root, the previous focus in that root comes back and the inspected element is left unfocused', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const closed = host.attachShadow({ mode: 'closed' });
    const previous = document.createElement('input');
    const target = document.createElement('button');
    target.textContent = 'target';
    closed.append(previous, target);
    try {
      previous.focus();
      const results = await captureStateVariations(target, ['focus', 'focus-visible']);
      const byState = Object.fromEntries(results.map((r) => [r.state, r]));
      expect(byState['focus-visible'].forced).toBe(true);
      expect(closed.activeElement).toBe(previous);
      expect(readFocusVisible(target)).toBe('not_focused');
    } finally {
      host.remove();
    }
  });

  it('a frame whose ancestor focus cannot be read stops the ancestor walk instead of failing the read', async () => {
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    const doc = frame.contentDocument!;
    const target = doc.createElement('button');
    target.textContent = 'target';
    doc.body.appendChild(target);
    // Reading the parent document's focus from this frame throws, as a
    // document that became unreadable mid-read would.
    Object.defineProperty(frame, 'getRootNode', {
      value: () => {
        throw new Error('unreadable');
      },
    });
    try {
      const results = await captureStateVariations(target, ['focus', 'focus-visible']);
      const byState = Object.fromEntries(results.map((r) => [r.state, r]));
      expect(byState['focus-visible'].forced).toBe(true);
      expect(byState['focus-visible'].focused).toBe(true);
    } finally {
      frame.remove();
    }
  });

  it('nested frames: an unreadable outer parent keeps the inner record, and the middle document gets its focus back', async () => {
    const outer = document.createElement('iframe');
    document.body.appendChild(outer);
    const middle = outer.contentDocument!;
    const inner = middle.createElement('iframe');
    const middleInput = middle.createElement('input');
    middle.body.append(middleInput, inner);
    const target = inner.contentDocument!.createElement('button');
    target.textContent = 'target';
    inner.contentDocument!.body.appendChild(target);
    // The top document's focus cannot be read from the outer frame, so the
    // walk records the middle document and stops there.
    Object.defineProperty(outer, 'getRootNode', {
      value: () => {
        throw new Error('unreadable');
      },
    });
    try {
      middleInput.focus();
      const results = await captureStateVariations(target, ['focus', 'focus-visible']);
      const byState = Object.fromEntries(results.map((r) => [r.state, r]));
      expect(byState['focus-visible'].forced).toBe(true);
      expect(middle.activeElement).toBe(middleInput);
    } finally {
      outer.remove();
    }
  });

  it("a document without focus: the focus entry reads 'document_unfocused', and the ring is still forced with a caveat", async () => {
    const spy = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    try {
      const results = await captureStateVariations(el, ['focus', 'focus-visible']);
      const byState = Object.fromEntries(results.map((r) => [r.state, r]));
      expect(byState.focus.focusVisible).toBe('document_unfocused');
      expect(byState['focus-visible'].forced).toBe(true);
      expect(byState['focus-visible'].focusCaveat).toBe('document_unfocused');
      expect(byState['focus-visible'].notForcedReason).toBeUndefined();
      expect(byState['focus-visible'].focused).toBe(false);
      expect(el.hasAttribute('data-ui-bridge-pseudo-focus-visible')).toBe(false);
      // Nothing had focus before, so the restore must blur `el` even though
      // the document has no focus (where `el` is still its activeElement).
      expect(document.activeElement).toBe(document.body);
    } finally {
      spy.mockRestore();
    }
  });

  it("a delegatesFocus host in a document without focus reads 'document_unfocused', and its ring is forced with a caveat", async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    Object.defineProperty(shadow, 'delegatesFocus', { value: true });
    const inner = document.createElement('button');
    inner.textContent = 'inner';
    shadow.appendChild(inner);
    const spy = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    try {
      inner.focus();
      expect(readFocusVisible(host)).toBe('document_unfocused');
      const results = await captureStateVariations(host, ['focus-visible']);
      const fv = results.find((r) => r.state === 'focus-visible')!;
      expect(fv.forced).toBe(true);
      expect(fv.focusCaveat).toBe('document_unfocused');
      expect(fv.notForcedReason).toBeUndefined();
      expect(fv.focused).toBe(false);
      // The previous focus (inner) is restored and kept.
      expect(shadow.activeElement).toBe(inner);
      expect(document.activeElement).toBe(host);
    } finally {
      spy.mockRestore();
      host.remove();
    }
  });

  it('a focus in a CLOSED tree enclosing the element, outside its own root, comes back and the element is left unfocused', async () => {
    // C (closed) holds input X and host H; H's closed root holds the target.
    const outerHost = document.createElement('div');
    document.body.appendChild(outerHost);
    const outer = outerHost.attachShadow({ mode: 'closed' });
    const x = document.createElement('input');
    const innerHost = document.createElement('div');
    outer.append(x, innerHost);
    const inner = innerHost.attachShadow({ mode: 'closed' });
    const target = document.createElement('button');
    target.textContent = 'target';
    inner.appendChild(target);
    try {
      x.focus();
      expect(document.activeElement).toBe(outerHost);
      const results = await captureStateVariations(target, ['focus', 'focus-visible']);
      const fv = results.find((r) => r.state === 'focus-visible')!;
      expect(fv.forced).toBe(true);
      expect(outer.activeElement).toBe(x);
      expect(inner.activeElement).toBeNull();
      expect(readFocusVisible(target)).toBe('not_focused');
    } finally {
      outerHost.remove();
    }
  });

  it('a document without focus, whose previous focus is removed during the read: the focus ends on the body', async () => {
    const before = document.createElement('input');
    document.body.appendChild(before);
    before.focus();
    el.addEventListener('focus', () => before.remove(), { once: true });
    const spy = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    try {
      await captureStateVariations(el, ['focus']);
      expect(document.activeElement).toBe(document.body);
    } finally {
      spy.mockRestore();
    }
  });

  it("an element focused in a frame whose frame element is not its parent's active element reads 'document_unfocused'", async () => {
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    const doc = frame.contentDocument!;
    const target = doc.createElement('button');
    target.textContent = 'in frame';
    doc.body.appendChild(target);
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    try {
      target.focus();
      expect(readFocusVisible(target)).toBe(false);
      // The parent's focus moves away; the frame keeps its own activeElement.
      outside.focus();
      expect(doc.activeElement).toBe(target);
      expect(document.activeElement).toBe(outside);
      expect(doc.hasFocus()).toBe(true);
      expect(readFocusVisible(target)).toBe('document_unfocused');
    } finally {
      frame.remove();
      outside.remove();
    }
  });

  it("inspecting inside a frame while the parent holds the focus: the parent's focus comes back, and the frame keeps its own", async () => {
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    const doc = frame.contentDocument!;
    const remembered = doc.createElement('input');
    const target = doc.createElement('button');
    target.textContent = 'in frame';
    doc.body.append(remembered, target);
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    try {
      remembered.focus();
      // The parent's focus moves away; the frame keeps `remembered` as its
      // activeElement, but it is not holding focus.
      outside.focus();
      expect(doc.activeElement).toBe(remembered);
      expect(readFocusVisible(remembered)).toBe('document_unfocused');
      await captureStateVariations(target, ['focus', 'focus-visible']);
      // The page's focus is back on the parent's input, and the frame
      // remembers its own previous focus again; the target is not focused.
      // jsdom does not move the parent's focus when a frame element is
      // refocused, so this case does NOT guard the ancestor restore; the
      // Chromium twin in focus-visible.smoke.test.ts does.
      expect(document.activeElement).toBe(outside);
      expect(doc.activeElement).toBe(remembered);
      expect(readFocusVisible(target)).toBe('not_focused');
    } finally {
      frame.remove();
      outside.remove();
    }
  });

  it('inspecting inside a frame when nothing had focus: the frame is blurred out of the parent again', async () => {
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    const doc = frame.contentDocument!;
    const target = doc.createElement('button');
    target.textContent = 'in frame';
    doc.body.appendChild(target);
    try {
      (document.activeElement as HTMLElement | null)?.blur();
      expect(document.activeElement).toBe(document.body);
      await captureStateVariations(target, ['focus', 'focus-visible']);
      expect(document.activeElement).toBe(document.body);
      expect(readFocusVisible(target)).toBe('not_focused');
    } finally {
      frame.remove();
    }
  });

  it('forced=true with focused=false: a focus listener moves the focus away before the styles are read', async () => {
    const elsewhere = document.createElement('input');
    document.body.appendChild(elsewhere);
    el.addEventListener('focus', () => setTimeout(() => elsewhere.focus(), 0), { once: true });
    try {
      const results = await captureStateVariations(el, ['focus-visible']);
      const fv = results.find((r) => r.state === 'focus-visible')!;
      expect(fv.forced).toBe(true);
      expect(fv.focused).toBe(false);
      expect(document.activeElement).toBe(elsewhere);
    } finally {
      elsewhere.remove();
    }
  });

  it('a previous focus removed by a focus handler: the focus ends on the body, and the element is not focused', async () => {
    const before = document.createElement('input');
    document.body.appendChild(before);
    before.focus();
    el.addEventListener('focus', () => before.remove(), { once: true });
    await captureStateVariations(el, ['focus']);
    expect(document.activeElement).toBe(document.body);
    expect(readFocusVisible(el)).toBe('not_focused');
  });

  it('a previous focus disabled by a focus handler: the focus ends on the body, and the element is not focused', async () => {
    const before = document.createElement('input');
    document.body.appendChild(before);
    try {
      before.focus();
      el.addEventListener('focus', () => (before.disabled = true), { once: true });
      await captureStateVariations(el, ['focus']);
      expect(document.activeElement).toBe(document.body);
      expect(readFocusVisible(el)).toBe('not_focused');
    } finally {
      before.remove();
    }
  });

  it('a disabled control reports focused=false on focus-visible', async () => {
    el.disabled = true;
    const results = await captureStateVariations(el, ['focus', 'focus-visible']);
    const byState = Object.fromEntries(results.map((r) => [r.state, r]));
    expect(byState.focus.focusVisible).toBe('not_focused');
    expect(byState['focus-visible'].focused).toBe(false);
    expect(byState['focus-visible'].forced).toBe(false);
    expect(byState['focus-visible'].notForcedReason).toBe('not_focused');
  });

  it('restores focus after the focus-visible state, and leaves nothing forced', async () => {
    el.blur();
    await captureStateVariations(el, ['focus-visible']);
    expect(document.activeElement).not.toBe(el);
    expect(el.hasAttribute('data-ui-bridge-pseudo-focus-visible')).toBe(false);
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

    const { snapshots } = await captureResponsiveSnapshots(registry, {
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

    const { snapshots } = await captureResponsiveSnapshots(registry, [375, 768, 1280]);

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

    const { snapshots } = await captureResponsiveSnapshots(registry, { mobile: 375 });

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
    const { snapshots } = await captureResponsiveSnapshots(registry, { mobile: 375 });
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
    const { snapshots } = await captureResponsiveSnapshots(registry, { mobile: 375 });

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].elements).toHaveLength(0);
  });

  it('should include rect data for elements', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);

    const registry = createMockRegistry([{ id: 'el-1', element: el, type: 'box' }]);

    const { snapshots } = await captureResponsiveSnapshots(registry, { mobile: 375 });
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
    it('is unknown (null), not a fabricated black, for an unparseable color string', () => {
      expect(computeContrastRatio('not-a-color', 'rgb(255, 255, 255)')).toBeNull();
      expect(computeContrastRatio('rgb(255, 255, 255)', 'not-a-color')).toBeNull();
    });

    it('is unknown (null) for an empty string color', () => {
      expect(computeContrastRatio('', 'rgb(255, 255, 255)')).toBeNull();
    });

    it('still parses real black', () => {
      expect(computeContrastRatio('black', 'rgb(255, 255, 255)')).toBeCloseTo(21, 0);
    });

    it.each([
      'transparent',
      'currentcolor',
      'inherit',
      'initial',
      'unset',
      'rgba(0, 0, 0, 0)',
      'rgb(0 0 0 / none)',
      'var(--undefined-colour)',
    ])('is unknown (null) for %s, which names no colour of its own', (value) => {
      expect(computeContrastRatio(value, 'rgb(255, 255, 255)')).toBeNull();
      expect(computeContrastRatio('rgb(255, 255, 255)', value)).toBeNull();
    });

    it('still reads a partly transparent colour by its rgb (alpha ignored)', () => {
      expect(computeContrastRatio('rgba(0, 0, 0, 0.5)', 'rgb(255, 255, 255)')).toBeCloseTo(21, 0);
    });

    it('checkContrastCompliance reports unknown, not pass or fail', () => {
      expect(checkContrastCompliance('not-a-color', '#fff', '16px', '400')).toEqual({
        ratio: null,
        passesAA: null,
        passesAAA: null,
      });
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
