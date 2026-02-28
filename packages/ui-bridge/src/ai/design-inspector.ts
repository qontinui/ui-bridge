/**
 * Design Inspector Module
 *
 * Browser-side functions for extracting design-relevant computed styles,
 * capturing interaction state variations, and responsive snapshots.
 *
 * These functions run in the browser context and use window.getComputedStyle().
 */

import type {
  ExtendedComputedStyles,
  InteractionStateName,
  StateStyles,
  StyleDiff,
  PseudoElementStyles,
  ElementDesignData,
  ResponsiveSnapshot,
} from '../core/types';

// ============================================================================
// Constants
// ============================================================================

/**
 * CSS properties extracted for design review
 */
const DESIGN_PROPERTIES: (keyof ExtendedComputedStyles)[] = [
  // Layout
  'display',
  'position',
  'boxSizing',
  'width',
  'height',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
  'margin',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'padding',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'overflow',
  'overflowX',
  'overflowY',

  // Flex/Grid
  'flexDirection',
  'flexWrap',
  'justifyContent',
  'alignItems',
  'alignSelf',
  'gap',
  'gridTemplateColumns',
  'gridTemplateRows',

  // Typography
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'textAlign',
  'textTransform',
  'textDecoration',
  'color',

  // Visual
  'backgroundColor',
  'backgroundImage',
  'border',
  'borderRadius',
  'boxShadow',
  'opacity',
  'outline',

  // Effects
  'transform',
  'transition',
  'cursor',
  'zIndex',
  'visibility',
  'pointerEvents',
];

/**
 * Interaction states to cycle through for state variation capture
 */
const INTERACTION_STATES: InteractionStateName[] = ['hover', 'focus', 'active', 'disabled'];

/**
 * Default viewport breakpoints
 */
export const DEFAULT_VIEWPORTS: Record<string, number> = {
  mobile: 375,
  tablet: 768,
  desktop: 1280,
  wide: 1920,
};

// ============================================================================
// Core Style Extraction
// ============================================================================

/**
 * Extract extended computed styles from an element.
 * Uses window.getComputedStyle() to read ~40 design-relevant CSS properties.
 */
export function getExtendedComputedStyles(el: HTMLElement): ExtendedComputedStyles {
  const computed = window.getComputedStyle(el);
  const styles = {} as ExtendedComputedStyles;

  for (const prop of DESIGN_PROPERTIES) {
    // CSSStyleDeclaration uses camelCase property access
    styles[prop] = computed.getPropertyValue(camelToKebab(prop)) || computed[prop as any] || '';
  }

  return styles;
}

/**
 * Get full design data for an element, including optional pseudo-elements.
 */
export function getElementDesignData(
  el: HTMLElement,
  opts?: { includePseudoElements?: boolean; elementId?: string; label?: string; type?: string }
): ElementDesignData {
  const rect = el.getBoundingClientRect();
  const styles = getExtendedComputedStyles(el);
  const pseudoElements: PseudoElementStyles[] = [];

  if (opts?.includePseudoElements) {
    for (const selector of ['::before', '::after'] as const) {
      const pseudo = getPseudoElementStyles(el, selector);
      if (pseudo) {
        pseudoElements.push(pseudo);
      }
    }
  }

  return {
    elementId: opts?.elementId || el.id || el.getAttribute('data-ui-id') || '',
    label: opts?.label,
    type: opts?.type || el.tagName.toLowerCase(),
    styles,
    pseudoElements: pseudoElements.length > 0 ? pseudoElements : undefined,
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    },
  };
}

// ============================================================================
// State Variation Capture
// ============================================================================

/**
 * Capture style variations across interaction states (hover, focus, active, disabled).
 *
 * Dispatches synthetic events to trigger state changes, reads computed styles,
 * then restores the element to its default state. All wrapped in try/finally.
 *
 * Note: This modifies element state temporarily. Should not be called during
 * user interaction.
 */
export async function captureStateVariations(
  el: HTMLElement,
  states?: InteractionStateName[]
): Promise<StateStyles[]> {
  const targetStates = states || INTERACTION_STATES;
  const defaultStyles = getExtendedComputedStyles(el);
  const results: StateStyles[] = [];

  // Add default state
  results.push({
    state: 'default',
    styles: defaultStyles,
    diffFromDefault: [],
  });

  for (const stateName of targetStates) {
    if (stateName === 'default') continue;

    try {
      // Apply the state
      applyInteractionState(el, stateName);

      // Wait one frame for styles to apply
      await waitFrame();

      // Read styles in the new state
      const stateStyles = getExtendedComputedStyles(el);
      const diff = computeStyleDiff(defaultStyles, stateStyles);

      results.push({
        state: stateName,
        styles: stateStyles,
        diffFromDefault: diff,
      });
    } finally {
      // Always restore to default state
      restoreInteractionState(el, stateName);
      await waitFrame();
    }
  }

  return results;
}

// ============================================================================
// Responsive Snapshot
// ============================================================================

/**
 * Registry-like interface for accessing registered elements
 */
export interface DesignRegistryLike {
  getAllElements(): Array<{
    id: string;
    element: HTMLElement;
    type: string;
    label?: string;
  }>;
}

/**
 * Capture design snapshots at multiple viewport widths.
 *
 * Constrains `document.documentElement.style.width` per viewport to trigger
 * CSS media queries using max-width. Forces reflow, captures all elements,
 * then restores.
 *
 * Limitation: JS-based responsive logic reading window.innerWidth won't trigger.
 */
export async function captureResponsiveSnapshots(
  registry: DesignRegistryLike,
  viewports: Record<string, number> | number[]
): Promise<ResponsiveSnapshot[]> {
  const viewportEntries: Array<[string, number]> = Array.isArray(viewports)
    ? viewports.map((w) => [`${w}px`, w])
    : Object.entries(viewports);

  const docEl = document.documentElement;
  const originalWidth = docEl.style.width;
  const originalMinWidth = docEl.style.minWidth;
  const originalMaxWidth = docEl.style.maxWidth;
  const originalOverflow = docEl.style.overflow;
  const snapshots: ResponsiveSnapshot[] = [];

  try {
    for (const [label, width] of viewportEntries) {
      // Constrain the document width
      docEl.style.width = `${width}px`;
      docEl.style.minWidth = `${width}px`;
      docEl.style.maxWidth = `${width}px`;
      docEl.style.overflow = 'hidden';

      // Force reflow
      void docEl.offsetHeight;
      await waitFrame();

      // Capture all elements at this viewport
      const elements = registry.getAllElements();
      const elementData: ElementDesignData[] = elements.map((regEl) =>
        getElementDesignData(regEl.element, {
          elementId: regEl.id,
          label: regEl.label,
          type: regEl.type,
        })
      );

      snapshots.push({
        viewportWidth: width,
        viewportLabel: label,
        elements: elementData,
        timestamp: Date.now(),
      });
    }
  } finally {
    // Always restore original styles
    docEl.style.width = originalWidth;
    docEl.style.minWidth = originalMinWidth;
    docEl.style.maxWidth = originalMaxWidth;
    docEl.style.overflow = originalOverflow;
  }

  return snapshots;
}

// ============================================================================
// Accessibility Helpers
// ============================================================================

/**
 * Compute WCAG 2.1 contrast ratio between foreground and background colors.
 * Returns a ratio like 4.5 (for 4.5:1 contrast).
 *
 * Colors should be in CSS color format (rgb, rgba, hex, or named).
 */
export function computeContrastRatio(fgColor: string, bgColor: string): number {
  const fgLuminance = getRelativeLuminance(parseColor(fgColor));
  const bgLuminance = getRelativeLuminance(parseColor(bgColor));

  const lighter = Math.max(fgLuminance, bgLuminance);
  const darker = Math.min(fgLuminance, bgLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Check WCAG contrast compliance.
 * Level AA: 4.5:1 for normal text, 3:1 for large text
 * Level AAA: 7:1 for normal text, 4.5:1 for large text
 */
export function checkContrastCompliance(
  fgColor: string,
  bgColor: string,
  fontSize: string,
  fontWeight: string
): { ratio: number; passesAA: boolean; passesAAA: boolean } {
  const ratio = computeContrastRatio(fgColor, bgColor);
  const isLargeText = isLargeTextForContrast(fontSize, fontWeight);

  return {
    ratio,
    passesAA: ratio >= (isLargeText ? 3 : 4.5),
    passesAAA: ratio >= (isLargeText ? 4.5 : 7),
  };
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Convert camelCase CSS property name to kebab-case
 */
function camelToKebab(str: string): string {
  return str.replace(/([A-Z])/g, '-$1').toLowerCase();
}

/**
 * Get computed styles for a pseudo-element (::before or ::after)
 */
function getPseudoElementStyles(
  el: HTMLElement,
  selector: '::before' | '::after'
): PseudoElementStyles | null {
  let computed: CSSStyleDeclaration;
  try {
    computed = window.getComputedStyle(el, selector);
  } catch {
    // jsdom and some environments don't support pseudo-element computed styles
    return null;
  }
  const content = computed.getPropertyValue('content');

  // Skip if no content (pseudo-element doesn't exist)
  if (!content || content === 'none' || content === 'normal') {
    return null;
  }

  const styles: Partial<ExtendedComputedStyles> = {};
  for (const prop of DESIGN_PROPERTIES) {
    const val = computed.getPropertyValue(camelToKebab(prop)) || (computed as any)[prop] || '';
    if (val) {
      (styles as any)[prop] = val;
    }
  }

  return { selector, content, styles };
}

/**
 * Compute the diff between default styles and state styles
 */
function computeStyleDiff(
  defaultStyles: ExtendedComputedStyles,
  stateStyles: ExtendedComputedStyles
): StyleDiff[] {
  const diffs: StyleDiff[] = [];

  for (const prop of DESIGN_PROPERTIES) {
    if (defaultStyles[prop] !== stateStyles[prop]) {
      diffs.push({
        property: prop,
        defaultValue: defaultStyles[prop],
        stateValue: stateStyles[prop],
      });
    }
  }

  return diffs;
}

/**
 * Apply an interaction state to an element using synthetic events
 */
function applyInteractionState(el: HTMLElement, state: InteractionStateName): void {
  switch (state) {
    case 'hover':
      el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      break;
    case 'focus':
      el.focus();
      el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      break;
    case 'active':
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      break;
    case 'disabled':
      (el as HTMLButtonElement | HTMLInputElement).disabled = true;
      break;
  }
}

/**
 * Restore an element from an interaction state
 */
function restoreInteractionState(el: HTMLElement, state: InteractionStateName): void {
  switch (state) {
    case 'hover':
      el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
      break;
    case 'focus':
      el.blur();
      el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
      break;
    case 'active':
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      break;
    case 'disabled':
      (el as HTMLButtonElement | HTMLInputElement).disabled = false;
      break;
  }
}

/**
 * Wait for the next animation frame
 */
function waitFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * Parse a CSS color value to [r, g, b] (0-255 range)
 */
function parseColor(color: string): [number, number, number] {
  // Try to use a temporary element for reliable parsing
  if (typeof document !== 'undefined') {
    const temp = document.createElement('div');
    temp.style.color = color;
    temp.style.display = 'none';
    document.body.appendChild(temp);
    const computed = window.getComputedStyle(temp).color;
    document.body.removeChild(temp);

    const match = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (match) {
      return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
    }
  }

  // Fallback: try to parse directly
  const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgbMatch) {
    return [parseInt(rgbMatch[1], 10), parseInt(rgbMatch[2], 10), parseInt(rgbMatch[3], 10)];
  }

  // Default to black
  return [0, 0, 0];
}

/**
 * Compute relative luminance per WCAG 2.1
 * https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 */
function getRelativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((c) => {
    const sRGB = c / 255;
    return sRGB <= 0.03928 ? sRGB / 12.92 : Math.pow((sRGB + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Determine if text is "large" for WCAG contrast purposes.
 * Large text: >= 18pt (24px) or >= 14pt (18.66px) bold
 */
function isLargeTextForContrast(fontSize: string, fontWeight: string): boolean {
  const sizeInPx = parseFloat(fontSize);
  const weight = parseInt(fontWeight, 10) || (fontWeight === 'bold' ? 700 : 400);

  if (sizeInPx >= 24) return true;
  if (sizeInPx >= 18.66 && weight >= 700) return true;
  return false;
}
