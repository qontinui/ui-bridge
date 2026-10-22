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
import { classString } from '../core/class-name';
import {
  forcePseudoState,
  getForcedPseudoState,
  releaseForcedPseudoStateIfOwner,
  snapshotForcedPseudoState,
} from '../control/forced-hover';

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
export const INTERACTION_STATES: readonly InteractionStateName[] = [
  'hover',
  'focus',
  'active',
  'disabled',
];

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
    styles[prop] =
      computed.getPropertyValue(camelToKebab(prop)) ||
      (computed as unknown as Record<string, string>)[prop] ||
      '';
  }

  return styles;
}

/**
 * Get full design data for an element, including optional pseudo-elements.
 *
 * `customProperties` says how to read the element's CSS custom properties: an
 * index built once for a batch of elements (`indexCustomProperties`), or
 * `false` to skip them because nothing downstream reads them. Absent, they are
 * read for this element alone.
 */
export function getElementDesignData(
  el: HTMLElement,
  opts?: {
    includePseudoElements?: boolean;
    elementId?: string;
    label?: string;
    type?: string;
    customProperties?: CustomPropertyIndex | false;
  }
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

  const customProperties =
    opts?.customProperties === false ? {} : getCSSCustomProperties(el, opts?.customProperties);

  return {
    elementId: opts?.elementId || el.id || el.getAttribute('data-testid') || '',
    label: opts?.label,
    type: opts?.type || el.tagName.toLowerCase(),
    styles,
    pseudoElements: pseudoElements.length > 0 ? pseudoElements : undefined,
    customProperties: Object.keys(customProperties).length > 0 ? customProperties : undefined,
    className: classString(el) || undefined,
    classes: el.classList.length > 0 ? Array.from(el.classList) : undefined,
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
  states?: readonly InteractionStateName[]
): Promise<StateStyles[]> {
  const targetStates = states || INTERACTION_STATES;

  // The page has ONE forced pseudo-state (one pointer). If an agent is holding
  // a `hover` right now, inspection borrows the pointer: the agent's hold is
  // suspended (so `default` is read at rest, not hovered), and re-applied with
  // the TTL it had left once inspection is done. Inspection only ever releases
  // the holds it created itself (by hold id).
  const agentHold = snapshotForcedPseudoState();
  if (agentHold) await releaseForcedPseudoStateIfOwner(agentHold.holdId, 'replaced');
  try {
    return await captureEachState(el, targetStates);
  } finally {
    if (agentHold && agentHold.target.isConnected && getForcedPseudoState() === null) {
      await forcePseudoState(agentHold.target, agentHold.state, {
        holdMs: Math.max(1, agentHold.remainingMs),
        registry: agentHold.registry,
      });
    }
  }
}

async function captureEachState(
  el: HTMLElement,
  targetStates: readonly InteractionStateName[]
): Promise<StateStyles[]> {
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

    let restore: (() => Promise<void>) | null = null;
    try {
      // Apply the state. `hover`/`active` force the real CSS pseudo-class and
      // wait for the transitions it started, so the read below is the settled
      // state appearance rather than a frame of a fade.
      restore = await applyInteractionState(el, stateName);
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
      if (restore) await restore();
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
// CSS Custom Properties
// ============================================================================

/**
 * The custom properties a document's stylesheets declare, read rule-first for a
 * batch of elements.
 *
 * Reading one element at a time calls `el.matches()` on every top-level style
 * rule, so a batch costs elements × rules. Measured on qontinui.io's production
 * stylesheets with 1,120 registered elements (plan
 * 2026-10-13-image-generation-and-visual-judgment, Phase 6), that was 184,800
 * `matches()` calls, about 43 ms of every `/design/evaluate`. Only 6 of the 165
 * top-level style rules declared a custom property. The index reads the rules
 * once, keeps those that declare one, and queries each of them once with
 * `querySelectorAll`. The same batch then cost about 1 ms.
 *
 * Its scope is the per-element walk's: top-level `CSSStyleRule`s of readable
 * stylesheets. Grouping rules (`@media`, `@layer`, `@supports`) are not
 * entered.
 */
export interface CustomPropertyIndex {
  /** The document whose stylesheets and elements were indexed. */
  readonly document: Document;
  /**
   * The elements `declared` answers for (all of the document's when `null`).
   * Any other element is matched rule by rule.
   */
  readonly scope: ReadonlySet<Element> | null;
  /** The custom properties declared by the rules each element matches, in rule order. */
  readonly declared: ReadonlyMap<Element, readonly string[]>;
}

/** The top-level style rules of a document's readable stylesheets, in cascade-source order. */
function* topLevelStyleRules(doc: Document): Generator<CSSStyleRule> {
  try {
    for (const sheet of doc.styleSheets) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        // Cross-origin stylesheet — skip
        continue;
      }
      for (const rule of rules) {
        if (rule instanceof CSSStyleRule) yield rule;
      }
    }
  } catch {
    // Stylesheet access failed — yield what was read
  }
}

/** The custom properties (`--*`) a rule declares. */
function declaredCustomProperties(rule: CSSStyleRule): string[] {
  const names: string[] = [];
  for (let i = 0; i < rule.style.length; i++) {
    const prop = rule.style[i];
    if (prop.startsWith('--')) names.push(prop);
  }
  return names;
}

/**
 * Index the custom properties the document's stylesheets declare, for the
 * `candidates` (every element of the document when omitted). Read once, then
 * pass the index to `getCSSCustomProperties` / `getElementDesignData` for each
 * element of the batch.
 */
export function indexCustomProperties(
  doc: Document = document,
  candidates?: Iterable<Element>
): CustomPropertyIndex {
  const scope = candidates ? new Set(candidates) : null;
  const declared = new Map<Element, string[]>();
  for (const rule of topLevelStyleRules(doc)) {
    const names = declaredCustomProperties(rule);
    if (names.length === 0) continue;
    let matched: NodeListOf<Element>;
    try {
      matched = doc.querySelectorAll(rule.selectorText);
    } catch {
      // Invalid selector — skip
      continue;
    }
    for (const el of matched) {
      if (scope && !scope.has(el)) continue;
      const list = declared.get(el);
      if (list) list.push(...names);
      else declared.set(el, [...names]);
    }
  }
  return { document: doc, scope, declared };
}

/**
 * Extract CSS custom properties (--var-name) applied to an element.
 *
 * Reads inline style custom properties and the custom properties declared by
 * stylesheet rules matching the element. Returns resolved values.
 *
 * With an `index` (`indexCustomProperties`), the rules are not walked again:
 * the index answers for the elements of its document in its scope. Any other
 * element — detached, in a shadow tree, or outside the scope — is matched
 * against every top-level style rule, as without an index.
 */
export function getCSSCustomProperties(
  el: HTMLElement,
  index?: CustomPropertyIndex
): Record<string, string> {
  const result: Record<string, string> = {};
  const computed = window.getComputedStyle(el);

  // 1. Inline style custom properties
  for (let i = 0; i < el.style.length; i++) {
    const prop = el.style[i];
    if (prop.startsWith('--')) {
      result[prop] = computed.getPropertyValue(prop).trim();
    }
  }

  // 2. Custom properties declared by the stylesheet rules matching this element
  const declared =
    index !== undefined && indexCovers(index, el)
      ? (index.declared.get(el) ?? [])
      : matchedCustomProperties(el);
  for (const prop of declared) {
    // Use getComputedStyle for resolved value
    result[prop] = computed.getPropertyValue(prop).trim();
  }

  return result;
}

/**
 * Whether the index answers for `el`: an element of the indexed document
 * (`querySelectorAll` reaches no detached node and no shadow tree) in its scope.
 */
function indexCovers(index: CustomPropertyIndex, el: Element): boolean {
  return el.getRootNode() === index.document && (index.scope === null || index.scope.has(el));
}

/** The custom properties declared by the top-level style rules `el` matches, one rule at a time. */
function matchedCustomProperties(el: HTMLElement): string[] {
  const names: string[] = [];
  for (const rule of topLevelStyleRules(document)) {
    try {
      if (!el.matches(rule.selectorText)) continue;
    } catch {
      // Invalid selector — skip
      continue;
    }
    names.push(...declaredCustomProperties(rule));
  }
  return names;
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
    const val =
      computed.getPropertyValue(camelToKebab(prop)) ||
      (computed as unknown as Record<string, string>)[prop] ||
      '';
    if (val) {
      styles[prop] = val;
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
 * Apply an interaction state to an element and return the function that
 * restores it.
 *
 * `hover` and `active` are user-action pseudo-classes no synthetic event can
 * set (`mouseenter` never sets `:hover`, `mousedown` never sets `:active`), so
 * they are FORCED through the in-place selector rewrite of `control/forced-hover.ts` —
 * the same primitive the `hover` action uses — and released (verified) by the
 * restore. `focus` uses the real `el.focus()` and restores the previously
 * focused element. `disabled` restores the element's own prior value.
 */
async function applyInteractionState(
  el: HTMLElement,
  state: InteractionStateName
): Promise<() => Promise<void>> {
  switch (state) {
    case 'hover':
    case 'active': {
      const { holdId } = await forcePseudoState(el, state);
      return async () => {
        await releaseForcedPseudoStateIfOwner(holdId, 'explicit');
      };
    }
    case 'focus': {
      const previous = document.activeElement;
      el.focus();
      return async () => {
        if (previous instanceof HTMLElement && previous !== el && previous !== document.body) {
          previous.focus();
        }
        if (document.activeElement === el) el.blur();
      };
    }
    case 'disabled': {
      const control = el as HTMLButtonElement | HTMLInputElement;
      const wasDisabled = control.disabled;
      control.disabled = true;
      return async () => {
        control.disabled = wasDisabled;
      };
    }
    default:
      return async () => undefined;
  }
}

/**
 * Wait for the next animation frame
 */
function waitFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
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
