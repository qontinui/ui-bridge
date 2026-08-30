/**
 * useAutoRegister Hook
 *
 * Enables automatic registration of interactive DOM elements with the UI Bridge.
 * This eliminates the need for manual useUIElement() calls on every component.
 *
 * Features:
 * - Auto-discovers interactive elements (buttons, inputs, links, etc.)
 * - Uses MutationObserver to detect new elements
 * - Generates stable, deterministic semantic IDs from element content/attributes
 * - Registers elements via the internal bridge registry (no DOM attributes set)
 * - Debounced updates for performance
 * - Respects existing manually registered elements
 */

import { useEffect, useRef, useCallback } from 'react';
import { useUIBridgeOptional } from './UIBridgeProvider';
import { trackElementBbox } from './bbox-tracker';
import { classString } from '../core/class-name';
import { isBridgeInvisible } from '../core/registry';
import { isContentRedacted } from '../core/redaction';
import { truncateCodePoints } from '../core/text';
import {
  readAriaLabelAttr,
  readAriaLabelledbyAttr,
  readTitleAttr,
  readInnerText,
} from '../core/a11y';
import type { ElementType, StandardAction, ElementLogLevel } from '../core/types';
import type { ContentDiscoveryOptions } from './content-discovery';
import {
  CONTENT_SELECTORS,
  shouldRegisterContent,
  inferContentType,
  inferContentMetadata,
  generateContentId,
} from './content-discovery';
import type { MediaDiscoveryOptions } from './media-discovery';
import {
  MEDIA_SELECTORS,
  shouldRegisterMedia,
  captureMediaMetadata,
  generateMediaId,
  findBackgroundImageElements,
  captureBackgroundImageMetadata,
  generateBackgroundImageId,
} from './media-discovery';

/**
 * ID generation strategy
 */
export type IdStrategy =
  | 'data-testid' // Use data-testid attribute if present
  | 'semantic' // Generate stable semantic ID based on element content
  | 'auto' // Auto-generate unique ID (unstable across renders)
  | 'prefer-existing'; // Use existing attributes (data-testid, id), fall back to semantic

/**
 * Options for auto-registration
 */
export interface AutoRegisterOptions {
  /** Enable auto-registration (default: true in dev mode) */
  enabled?: boolean;
  /** Root element to observe (default: document.body) */
  root?: HTMLElement | null;
  /** ID generation strategy (default: 'prefer-existing') */
  idStrategy?: IdStrategy;
  /** Debounce time for mutation handling (ms, default: 100) */
  debounceMs?: number;
  /** Include hidden elements (default: false) */
  includeHidden?: boolean;
  /** Only register elements matching these selectors */
  includeSelectors?: string[];
  /** Exclude elements matching these selectors */
  excludeSelectors?: string[];
  /** Custom ID generator function */
  generateId?: (element: HTMLElement) => string;
  /** Callback when element is registered */
  onRegister?: (id: string, element: HTMLElement) => void;
  /** Callback when element is unregistered */
  onUnregister?: (id: string) => void;
  /** Content discovery options (enabled by default) */
  contentDiscovery?: ContentDiscoveryOptions;
  /** Media discovery options (enabled by default) */
  mediaDiscovery?: MediaDiscoveryOptions;
  /** Log level for auto-registered elements (uses global default if not set) */
  logLevel?: ElementLogLevel;
  /** Write data-ui-bridge-id attribute on registered elements (default: true) */
  writeStableAttribute?: boolean;
  /**
   * If true, elements stay registered in the UI Bridge registry for the
   * entire lifetime of their mount, even when the visibility gate would
   * normally reject them (e.g. `opacity: 0`, `max-height: 0` during a
   * collapse animation, zero bounding box because an ancestor is animating
   * out). The element's layout metadata (bbox) may become stale in those
   * states, but clients can still discover it by id/label and drive it via
   * control actions. Individual elements can also opt in via the
   * `data-ui-bridge-persist="true"` attribute without flipping this global
   * flag.
   *
   * Use for logically-persistent elements like sidebar navigation items
   * that live inside a collapsible group or scroll container but shouldn't
   * disappear from the registry when their visibility flickers.
   *
   * Default: false (legacy behavior — skip registration while invisible).
   */
  persistWhileMounted?: boolean;
}

/**
 * Attribute callers can stamp on individual DOM elements to mark them
 * persistently-registerable, regardless of the global `persistWhileMounted`
 * option. Used by `useUIElement({ persistWhileMounted: true })` and available
 * directly on any host element authors want to keep in the registry across
 * visibility flickers.
 */
export const UI_BRIDGE_PERSIST_ATTR = 'data-ui-bridge-persist';

/**
 * Interactive element selectors
 *
 * Any DOM element matching one of these gets `data-ui-bridge-id` stamped and
 * registered as `origin: 'auto'`. Kept deliberately comprehensive so bbox
 * tracking works for elements the developer never wrapped with `useUIElement`.
 * Hidden inputs are excluded — they have no visual representation and only
 * pollute the snapshot.
 */
const INTERACTIVE_SELECTORS = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'details', // Disclosure widget — registered with a `toggle` action (Item 2)
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="menuitem"]',
  '[role="tab"]',
  '[role="tablist"]',
  '[role="switch"]',
  '[role="slider"]',
  '[role="spinbutton"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="option"]',
  '[role="textbox"]',
  '[role="status"]',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
  '[data-ui-element]', // Explicitly marked for registration
  '[data-testid]', // Testing library convention
  '[data-ui-bridge-id]', // Author-tagged element — registers regardless of
  // role/tag/interactivity. Lets containers like
  // <section role="region" data-ui-bridge-id="..."> appear in snapshot
  // and resolve via /control/element/:id, not just via raw DOM
  // querySelector. The scanner already preserves the existing stamp
  // verbatim (see registerElement: `existingStamp` branch), so the
  // attribute value becomes the registry key as-is.
];

/**
 * Selector for semantic plain-content elements tagged with
 * `data-ui-bridge-content`. These are non-interactive cards/badges/pills
 * a tester would assert text on but that carry no `useUIElement` wrapper.
 *
 * The attribute's value becomes the element's snapshot id verbatim
 * (e.g. `"registered-app:qontinui-supervisor-dashboard"`), letting authors
 * pick a semantic, stable id without maintaining a React hook.
 *
 * See Item 1 of the UI Bridge testability plan.
 */
const SEMANTIC_CONTENT_SELECTOR = '[data-ui-bridge-content]';

/** HTML attribute name for opt-in semantic content registration (Item 1). */
export const UI_BRIDGE_CONTENT_ATTR = 'data-ui-bridge-content';

/** HTML attribute name for the optional role hint on content elements (Item 1). */
export const UI_BRIDGE_ROLE_ATTR = 'data-ui-bridge-role';

/** HTML attribute name for the stable-id alias on auto-discovered elements (Item 10). */
export const UI_BRIDGE_TEST_ID_ATTR = 'data-ui-bridge-test-id';

const EMPTY_SELECTORS: string[] = [];

/**
 * Infer element type from DOM element
 */
function inferElementType(element: HTMLElement): ElementType {
  const role = element.getAttribute('role');
  if (role) {
    const roleMap: Record<string, ElementType> = {
      button: 'button',
      link: 'link',
      checkbox: 'checkbox',
      radio: 'radio',
      menuitem: 'menuitem',
      tab: 'tab',
      switch: 'switch',
      slider: 'slider',
      combobox: 'combobox',
      listbox: 'listbox',
      option: 'option',
      textbox: 'textbox',
    };
    if (role in roleMap) {
      return roleMap[role];
    }
  }

  const tagName = element.tagName.toLowerCase();
  switch (tagName) {
    case 'a':
      return 'link';
    case 'button':
      return 'button';
    case 'input': {
      const type = (element as HTMLInputElement).type?.toLowerCase() || 'text';
      switch (type) {
        case 'checkbox':
          return 'checkbox';
        case 'radio':
          return 'radio';
        case 'range':
          return 'slider';
        case 'submit':
        case 'button':
          return 'button';
        default:
          return 'input';
      }
    }
    case 'select':
      return 'select';
    case 'textarea':
      return 'textarea';
    case 'option':
      return 'option';
    case 'details':
    case 'summary':
      return 'disclosure';
    default:
      return 'generic';
  }
}

/**
 * Infer actions for element type
 */
function inferActions(type: ElementType): StandardAction[] {
  const baseActions: StandardAction[] = ['focus', 'blur'];

  const typeActions: Record<ElementType, StandardAction[]> = {
    button: [...baseActions, 'click', 'hover', 'middleClick'],
    link: [...baseActions, 'click', 'hover'],
    input: [...baseActions, 'type', 'clear', 'click'],
    textarea: [...baseActions, 'type', 'clear', 'click'],
    textbox: [...baseActions, 'type', 'clear', 'click'],
    checkbox: [...baseActions, 'check', 'uncheck', 'toggle', 'click'],
    radio: [...baseActions, 'click', 'select'],
    select: [...baseActions, 'select', 'click'],
    combobox: [...baseActions, 'select', 'type', 'click'],
    listbox: [...baseActions, 'select', 'click'],
    option: [...baseActions, 'select', 'click'],
    switch: [...baseActions, 'toggle', 'click'],
    slider: [...baseActions, 'setValue', 'click', 'drag'],
    tab: [...baseActions, 'click', 'select', 'middleClick'],
    menuitem: [...baseActions, 'click'],
    dialog: [...baseActions],
    disclosure: [...baseActions, 'click', 'toggle'],
    menu: [...baseActions],
    form: [...baseActions, 'submit', 'reset'],
    custom: [...baseActions, 'click'],
    generic: [...baseActions, 'click'],
    image: [],
    video: [],
    canvas: [],
    svg: [],
    picture: [],
  };

  return typeActions[type] || baseActions;
}

/**
 * Get accessible label for element
 */
function getAccessibleLabel(element: HTMLElement): string | undefined {
  // §4.6 F7 — SOURCE defense-in-depth: never SCRAPE a label out of a
  // `data-bridge-redact` boundary. This function reads `aria-label` / `title` /
  // `<label>` text / `innerText` / `placeholder` with no boundary check; every
  // caller (semantic-id generation, the interactive-registration `label`)
  // therefore short-circuits to `undefined` inside a boundary, so the secret is
  // never scraped into `RegisteredElement.label` at all. Content axis only — a
  // bare `<input type="password">` is NOT content-redacted, so it keeps its
  // "Password" label (the addressability win). The emission-site scrub in
  // `serializeRegisteredElement` is the primary closure; this is the second layer.
  if (isContentRedacted(element)) return undefined;

  // aria-label
  const ariaLabel = readAriaLabelAttr(element);
  if (ariaLabel) return ariaLabel;

  // aria-labelledby
  const labelledBy = readAriaLabelledbyAttr(element);
  if (labelledBy) {
    const labelEl = document.getElementById(labelledBy);
    if (labelEl) return labelEl.textContent?.trim();
  }

  // Associated label (for inputs)
  if (element.id) {
    const label = document.querySelector(`label[for="${element.id}"]`);
    if (label) return label.textContent?.trim();
  }

  // Title attribute
  const title = readTitleAttr(element);
  if (title) return title;

  // Inner text — use innerText which respects visual formatting (adds spaces
  // between block elements and hidden content is excluded), falling back to
  // textContent for elements not in the DOM or where innerText is unavailable.
  // Collapse runs of whitespace so adjacent inline spans get proper separation.
  const rawText = (readInnerText(element) ?? element.textContent)?.trim();
  const text = rawText ? rawText.replace(/\s+/g, ' ') : undefined;
  if (text) {
    // For short labels, return as-is
    if (text.length <= 50) return text;
    // For longer text, truncate to first meaningful segment (up to 80 chars)
    // This handles list items, cards, etc. that have rich content
    const truncated = truncateCodePoints(text, 80).replace(/\s+\S*$/, '');
    if (truncated.length >= 8) return truncated;
  }

  // Placeholder for inputs
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const placeholder = element.placeholder;
    if (placeholder) return placeholder;
  }

  return undefined;
}

/**
 * Check if element is truly visible — not hidden by CSS, not zero-sized.
 *
 * Deliberately does NOT check whether the element is within the viewport
 * or clipped by ancestor overflow. Navigation elements (sidebar items,
 * settings sub-tabs) commonly live inside scrollable containers and may
 * be off-screen. Excluding them from auto-registration meant the UI
 * Bridge snapshot returned only ~29 elements for a runner page with 100+
 * interactive elements — making agent-driven testing impossible for
 * off-screen features like Settings → World State Verifier.
 *
 * The previous viewport + hit-test checks were overly aggressive: they
 * filtered out anything not visible at the moment of discovery, including
 * all scrollable sidebar items below the fold. The MutationObserver
 * re-scan on DOM changes already handles dynamically-added elements, so
 * the visibility gate was only preventing legitimate elements from being
 * discoverable.
 *
 * What we still check:
 * - `display: none` — element is not rendered at all
 * - `visibility: hidden` — element is invisible
 * - `opacity: 0` — element is fully transparent
 * - zero width or height — element has no layout box
 */
function isElementVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') {
    return false;
  }
  if (parseFloat(style.opacity) === 0) return false;

  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;

  return true;
}

/**
 * Sanitize a string into a kebab-case slug suitable for an ID.
 * Strips parenthetical hints like "(Ctrl+Shift+T)" and special chars.
 */
function slugify(text: string, maxLen = 30): string {
  return text
    .replace(/\s*\(.*?\)\s*/g, '') // strip parenthetical hints
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen);
}

/**
 * Get a short, stable ancestor context slug for disambiguation.
 * Walks up the DOM looking for the nearest ancestor with an id, data-testid,
 * aria-label, or semantic landmark tag to provide positional context.
 */
function getAncestorContext(element: HTMLElement): string | undefined {
  let current = element.parentElement;
  let depth = 0;
  while (current && depth < 5) {
    // Check for explicit identifiers
    const testId = current.getAttribute('data-testid');
    if (testId) return slugify(testId, 20);

    const id = current.id;
    if (id && !/^:r[0-9a-z]+:$/.test(id)) return slugify(id, 20); // skip React auto-ids

    // Check for semantic landmarks
    const role = current.getAttribute('role');
    if (
      role &&
      ['navigation', 'main', 'banner', 'dialog', 'tabpanel', 'toolbar', 'form'].includes(role)
    ) {
      const label = readAriaLabelAttr(current);
      return label ? slugify(`${role}-${label}`, 20) : role;
    }

    // Check for landmark tags
    const tag = current.tagName.toLowerCase();
    if (['nav', 'main', 'header', 'footer', 'aside', 'form', 'dialog', 'section'].includes(tag)) {
      const label = readAriaLabelAttr(current);
      return label ? slugify(`${tag}-${label}`, 20) : tag;
    }

    current = current.parentElement;
    depth++;
  }
  return undefined;
}

/**
 * Get a sibling index among same-type elements in the same parent.
 * Returns undefined if the element is the only one of its type.
 */
function getSiblingIndex(element: HTMLElement): number | undefined {
  const parent = element.parentElement;
  if (!parent) return undefined;

  const tag = element.tagName;
  const role = element.getAttribute('role');

  // Count same-type siblings
  const siblings = Array.from(parent.children).filter((child) => {
    if (child.tagName !== tag) return false;
    if (role && child.getAttribute('role') !== role) return false;
    return true;
  });

  if (siblings.length <= 1) return undefined;
  return siblings.indexOf(element);
}

/**
 * Selector for interactive elements used to detect nesting.
 * Matches the same elements as INTERACTIVE_SELECTORS but consolidated
 * for use with Element.closest().
 */
const INTERACTIVE_CLOSEST_SELECTOR = [
  'a[href]',
  'button',
  '[role="button"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="link"]',
  '[role="option"]',
  '[role="switch"]',
].join(', ');

/**
 * Find the nearest ancestor that is itself an interactive element.
 * Returns null if the element is not nested inside another interactive element.
 */
function findParentInteractive(element: HTMLElement): HTMLElement | null {
  const parent = element.parentElement;
  if (!parent) return null;
  const match = parent.closest(INTERACTIVE_CLOSEST_SELECTOR);
  return match ? (match as HTMLElement) : null;
}

/**
 * Try to infer a purpose label for an icon-only element (no text content).
 * Checks for common close/action patterns: aria-label on the element,
 * title attribute, small size heuristic, or SVG-only children.
 */
function inferIconAction(element: HTMLElement): string | undefined {
  // aria-label or title would have been caught by getAccessibleLabel,
  // but check for common class-name hints
  const lower = classString(element).toLowerCase();
  if (lower) {
    if (lower.includes('close')) return 'close';
    if (lower.includes('delete') || lower.includes('remove')) return 'remove';
    if (lower.includes('expand')) return 'expand';
    if (lower.includes('collapse')) return 'collapse';
    if (lower.includes('minimize')) return 'minimize';
    if (lower.includes('maximize')) return 'maximize';
  }

  // Check if the element contains only SVG (icon-only button)
  const children = element.children;
  if (children.length === 1 && children[0].tagName.toLowerCase() === 'svg') {
    // Check SVG for class hints
    const svgLower = classString(children[0]).toLowerCase();
    if (svgLower.includes('close') || svgLower.includes('x-icon')) return 'close';
    if (svgLower.includes('delete') || svgLower.includes('trash')) return 'remove';
    if (svgLower.includes('chevron')) return 'toggle';
    if (svgLower.includes('plus') || svgLower.includes('add')) return 'add';
  }

  // Small element heuristic: if the element is small (~24px or less)
  // and nested, it's likely a close/dismiss/action button
  const rect = element.getBoundingClientRect();
  if (rect.width > 0 && rect.width <= 28 && rect.height > 0 && rect.height <= 28) {
    return 'action';
  }

  return undefined;
}

/**
 * Generate a stable, deterministic semantic ID based on element content,
 * attributes, and position in the DOM hierarchy.
 *
 * ID format: {type}-{label}[-{context}][-{index}]
 *
 * For nested interactive elements (e.g., close button inside a tab):
 *   {type}-{iconAction}-{parentLabel}  or  {type}-{parentLabel}-{index}
 *
 * Examples:
 *   button with title "New terminal (Ctrl+Shift+T)" → "button-new-terminal"
 *   button with text "Sessions" in toolbar           → "button-sessions"
 *   input with placeholder "Search..."               → "input-search"
 *   button with no label, 3rd in toolbar              → "button-toolbar-2"
 *   close icon inside "Terminal 1" tab                → "button-close-terminal-1"
 *   icon-only button inside "File" menu item          → "button-action-file"
 */
/**
 * Stable, text-independent id for an element inside a `UIBridgeComponentScope`
 * (marked with `data-ui-bridge-component=<componentId>`). Derives the id from
 * the owning component id + element type + a component-scoped same-type index,
 * so a control whose visible text is dynamic (e.g. a live count) never bakes
 * that mutable text into its id (the "button-5-sessions froze while the text
 * said 6" defect). The index is computed over same-type descendants of the
 * scope root — collision-free within the component, unlike the per-parent
 * `getSiblingIndex`. Returns undefined when the element is not component-owned,
 * so un-scoped elements keep the readable text-derived id below.
 */
function getComponentScopeId(element: HTMLElement): string | undefined {
  let scope: HTMLElement | null = element.parentElement;
  let componentId: string | null = null;
  let depth = 0;
  while (scope && depth < 12) {
    const cid = scope.getAttribute('data-ui-bridge-component');
    if (cid) {
      componentId = cid;
      break;
    }
    scope = scope.parentElement;
    depth++;
  }
  if (!componentId || !scope) return undefined;

  const type = inferElementType(element);
  const sameType = Array.from(scope.querySelectorAll<HTMLElement>('*')).filter(
    (el) => inferElementType(el) === type
  );
  const idx = sameType.indexOf(element);
  return idx > 0 ? `${componentId}-${type}-${idx}` : `${componentId}-${type}`;
}

function generateSemanticId(element: HTMLElement): string {
  const type = inferElementType(element);

  // Component-owned elements get a stable structural key (component id + type)
  // instead of a text-derived one — the plan's "ids should derive from stable
  // keys (component id + role), with text only in accessibleName". Text still
  // flows to `accessibleName`/`text` in the snapshot; only the *id* stops
  // tracking mutable text.
  const scopeId = getComponentScopeId(element);
  if (scopeId) return scopeId;

  const label = getAccessibleLabel(element);

  if (label) {
    const slug = slugify(label);
    if (slug) {
      const siblingIdx = getSiblingIndex(element);
      if (siblingIdx !== undefined) {
        // Multiple elements with same label in same parent — disambiguate
        return `${type}-${slug}-${siblingIdx}`;
      }
      return `${type}-${slug}`;
    }
  }

  // Check if this element is nested inside another interactive element.
  // This handles cases like a close button (icon-only) inside a tab —
  // the parent tab's label provides the missing context.
  const parentInteractive = findParentInteractive(element);
  if (parentInteractive) {
    const parentLabel = getAccessibleLabel(parentInteractive);
    if (parentLabel) {
      const parentSlug = slugify(parentLabel, 20);
      if (parentSlug) {
        // Try to infer what this nested element does (close, remove, etc.)
        const iconAction = inferIconAction(element);
        if (iconAction) {
          return `${type}-${iconAction}-${parentSlug}`;
        }
        // Fallback: use parent label + sibling index among nested interactive elements
        const siblingIdx = getSiblingIndex(element);
        if (siblingIdx !== undefined) {
          return `${type}-${parentSlug}-${siblingIdx}`;
        }
        return `${type}-${parentSlug}-nested`;
      }
    }
  }

  // No label available — use ancestor context + sibling index
  const context = getAncestorContext(element);
  const siblingIdx = getSiblingIndex(element);

  if (context && siblingIdx !== undefined) {
    return `${type}-${context}-${siblingIdx}`;
  }
  if (context) {
    return `${type}-${context}`;
  }
  if (siblingIdx !== undefined) {
    return `${element.tagName.toLowerCase()}-${siblingIdx}`;
  }

  // Last resort: tag + DOM path position (still deterministic, no randomness)
  const parent = element.parentElement;
  if (parent) {
    const allChildren = Array.from(parent.children);
    const idx = allChildren.indexOf(element);
    return `${type}-child-${idx}`;
  }

  return `${type}-root`;
}

/**
 * Generate unique auto ID
 */
function generateAutoId(element: HTMLElement): string {
  const type = inferElementType(element);
  return `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Generate ID based on strategy
 *
 * `data-ui-bridge-test-id` (Item 10) is always checked first regardless of
 * strategy — it's the stable-id escape hatch that lets tests pin an id that
 * would otherwise drift when a placeholder/label text changes. When absent,
 * the existing strategy-based derivation runs as before.
 */
function generateIdForElement(
  element: HTMLElement,
  strategy: IdStrategy,
  customGenerator?: (element: HTMLElement) => string
): string {
  // Item 10: `data-ui-bridge-test-id` wins over everything else so authors
  // can pin a stable id onto an auto-discovered element. Trimmed to tolerate
  // whitespace in attribute values; empty → falls through to normal derivation.
  const stableTestId = element.getAttribute(UI_BRIDGE_TEST_ID_ATTR)?.trim();
  if (stableTestId) return stableTestId;

  if (customGenerator) {
    return customGenerator(element);
  }

  switch (strategy) {
    case 'data-testid': {
      const testId = element.getAttribute('data-testid');
      return testId || generateSemanticId(element);
    }
    case 'semantic':
      return generateSemanticId(element);
    case 'auto':
      return generateAutoId(element);
    case 'prefer-existing':
    default: {
      // Priority: data-testid > id > semantic
      // Note: data-ui-id is not used — elements are identified via the bridge registry
      const testId = element.getAttribute('data-testid');
      if (testId) return testId;

      const htmlId = element.id;
      // Skip React auto-generated IDs (e.g., ":r1a:")
      if (htmlId && !/^:r[0-9a-z]+:$/.test(htmlId)) return htmlId;

      return generateSemanticId(element);
    }
  }
}

/**
 * Slugify helper used specifically for `<details>` auto-registration (Item 2).
 * Collapses whitespace, strips non-alphanumerics, lowercases. Distinct from
 * the interactive-element `slugify` above only in its stricter default
 * maxLen — we want identifiable but short slugs for disclosure widgets.
 */
function slugifyForDetails(text: string, maxLen = 40): string {
  return text
    .replace(/\s*\(.*?\)\s*/g, '') // strip parenthetical hints
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen)
    .replace(/-+$/g, '');
}

/**
 * Derive a stable id for a `<details>` element.
 *
 * Preference order:
 *   1. An explicit `data-ui-bridge-test-id` (handled by the caller before
 *      this runs — defense in depth here).
 *   2. The nearest `<summary>` child's textContent → `details-<slug>`.
 *   3. The nearest ancestor heading (h1–h6) text → `details-<slug>`.
 *   4. Fallback `details-unnamed`.
 *
 * Collisions are resolved by the caller (registerElement loop) via `-1`,
 * `-2`, ... suffixes the same way generic interactive elements disambiguate.
 */
function generateDetailsId(element: HTMLElement): string {
  // Summary child first — it's the canonical "label" for a <details>.
  const summary = element.querySelector(':scope > summary');
  const summaryText = summary?.textContent?.trim();
  if (summaryText) {
    const slug = slugifyForDetails(summaryText);
    if (slug) return `details-${slug}`;
  }

  // Fall back to the nearest ancestor heading in the same document order —
  // useful when the <details> has no summary text but sits under a labelled
  // section (e.g. "Advanced" card's per-stage disclosures).
  let cursor: HTMLElement | null = element.parentElement;
  let depth = 0;
  while (cursor && depth < 4) {
    const heading = cursor.querySelector<HTMLElement>('h1, h2, h3, h4, h5, h6');
    // Only consider headings that actually precede the <details> element in
    // the tree — a later sibling heading labels a different section.
    if (heading && heading.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) {
      const text = heading.textContent?.trim();
      if (text) {
        const slug = slugifyForDetails(text);
        if (slug) return `details-${slug}`;
      }
    }
    cursor = cursor.parentElement;
    depth++;
  }

  return 'details-unnamed';
}

/**
 * Hook for automatic element registration
 *
 * @example
 * ```tsx
 * function App() {
 *   // Enable auto-registration for all interactive elements
 *   useAutoRegister({ enabled: true });
 *
 *   return (
 *     <div>
 *       <button data-testid="submit-btn">Submit</button>
 *       <input data-testid="email-input" />
 *     </div>
 *   );
 * }
 * ```
 */
export function useAutoRegister(options: AutoRegisterOptions = {}): void {
  const {
    enabled = true,
    root = null,
    idStrategy = 'prefer-existing',
    debounceMs = 100,
    includeHidden = false,
    includeSelectors = EMPTY_SELECTORS,
    excludeSelectors = EMPTY_SELECTORS,
    generateId: customGenerateId,
    onRegister,
    onUnregister,
    contentDiscovery,
    mediaDiscovery,
    logLevel,
    writeStableAttribute,
    persistWhileMounted = false,
  } = options;

  const contentEnabled = contentDiscovery?.enabled !== false;
  const mediaEnabled = mediaDiscovery?.enabled !== false;

  const bridge = useUIBridgeOptional();
  const registeredElementsRef = useRef(new Map<HTMLElement, string>());
  const registeredContentElementsRef = useRef(new Map<HTMLElement, string>());
  const registeredMediaElementsRef = useRef(new Map<HTMLElement, string>());
  // Per-registered-id untrackers for the lazy bbox tracker. Keyed by id
  // (not element) so mid-mount node swaps that re-run track() under the
  // same id correctly teardown the prior observer.
  const bboxUntrackersRef = useRef(new Map<string, () => void>());
  const pendingRegistrationsRef = useRef(new Set<HTMLElement>());
  const pendingContentRegistrationsRef = useRef(new Set<HTMLElement>());
  const pendingMediaRegistrationsRef = useRef(new Set<HTMLElement>());
  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentDebounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mediaDebounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Check if element should be registered
   */
  const shouldRegister = useCallback(
    (element: HTMLElement): boolean => {
      // Persist-while-mounted opt-in: either the hook-wide option or a
      // per-element `data-ui-bridge-persist="true"` attribute bypasses the
      // visibility gate. The element is still subject to exclude selectors
      // and the interactive-selector match below — only the "looks
      // invisible right now" heuristic is relaxed. Used for sidebar nav
      // items hidden behind a collapse animation (opacity:0 / max-height:0)
      // that must stay discoverable for UI Bridge clients regardless of
      // the group's expanded/collapsed visual state.
      const isPersistent =
        persistWhileMounted || element.getAttribute(UI_BRIDGE_PERSIST_ATTR) === 'true';

      // Check visibility
      if (!includeHidden && !isPersistent && !isElementVisible(element)) {
        return false;
      }

      // Check exclude selectors
      for (const selector of excludeSelectors) {
        if (element.matches(selector)) {
          return false;
        }
      }

      // §4.5: `data-bridge-invisible="true"` (on the element itself or any
      // ancestor) hard-excludes the subtree from the registry. The bridge
      // cannot see or drive these elements — used for the "AI in control"
      // banner so the bridge can't dismiss its own indicator.
      if (isBridgeInvisible(element)) {
        return false;
      }

      // Check if already registered
      if (registeredElementsRef.current.has(element)) {
        return false;
      }

      // Check if matches interactive selectors
      const allSelectors = [...INTERACTIVE_SELECTORS, ...includeSelectors];
      for (const selector of allSelectors) {
        if (element.matches(selector)) {
          return true;
        }
      }

      return false;
    },
    [includeHidden, includeSelectors, excludeSelectors, persistWhileMounted]
  );

  /**
   * Register a single element with the bridge registry.
   * Elements are identified through the internal registry, not DOM attributes.
   */
  const registerElement = useCallback(
    (element: HTMLElement): void => {
      if (!bridge?.registry || registeredElementsRef.current.has(element)) {
        return;
      }

      // Item 2 — `<details>` gets a stable `details-<summary-slug>` id and
      // a `toggle` action up front, so disclosure widgets become drivable
      // without `useUIElement`. `data-ui-bridge-test-id` still wins (Item 10).
      const isDetails = element.tagName.toLowerCase() === 'details';

      // If the element already carries a `data-ui-bridge-id` — e.g. a
      // `useUIElement` hook stamped it via bbox-tracker, or a prior
      // auto-instrumentation pass already registered it — prefer that id
      // verbatim so hook-driven and scanner-driven paths stay coherent.
      // This prevents the scanner from clobbering a developer-assigned id
      // and keeps runner bbox tracking pointed at the right registry key.
      const existingStamp = element.getAttribute('data-ui-bridge-id');
      // `data-ui-bridge-test-id` is the Item-10 alias — consulted first
      // inside `generateIdForElement`. For <details> we also run the
      // details-specific derivation so the generated id is `details-<slug>`
      // rather than a generic `button`/`generic`-prefixed slug.
      let id: string;
      if (existingStamp) {
        id = existingStamp;
      } else {
        const stableTestId = element.getAttribute(UI_BRIDGE_TEST_ID_ATTR)?.trim();
        if (stableTestId) {
          id = stableTestId;
        } else if (isDetails) {
          id = generateDetailsId(element);
        } else {
          id = generateIdForElement(element, idStrategy, customGenerateId);
        }
      }

      // Check if ID already exists in registry — disambiguate with sibling index
      // (skip this when the id came from an existing stamp; collisions there
      // likely mean the element is already registered under that id).
      if (!existingStamp) {
        const existing = bridge.registry.getElement(id);
        if (existing) {
          // Find a unique suffix by counting collisions
          let suffix = 1;
          while (bridge.registry.getElement(`${id}-${suffix}`)) {
            suffix++;
          }
          id = `${id}-${suffix}`;
        }
      } else if (bridge.registry.getElement(id)) {
        // The element is already registered under its stamped id — nothing
        // for the scanner to do. Record the mapping so future mutations
        // don't re-scan it and return early.
        registeredElementsRef.current.set(element, id);
        return;
      }

      const type = inferElementType(element);
      // `<details>` gets the dedicated `toggle` action only — interactive-hover
      // and focus are still useful to expose so existing workflows keep working.
      const actions: StandardAction[] = isDetails
        ? ['toggle', 'focus', 'blur']
        : inferActions(type);
      const label = getAccessibleLabel(element);

      const registered = bridge.registry.registerElement(id, element, {
        type,
        actions,
        label,
        // `label` is scraped from the DOM once, here. This callback never runs
        // again for `element` (the `registeredElementsRef` guard at the top of
        // this function), so without a re-derivation closure an `aria-label`
        // that changes later leaves the registry serving the FIRST value
        // forever. Same algorithm, so a refresh can only remove staleness.
        labelSource: () => getAccessibleLabel(element),
        origin: 'auto',
      });

      const finalId = registered.id;
      if (writeStableAttribute !== false && !existingStamp) {
        element.setAttribute('data-ui-bridge-id', finalId);
      }
      registeredElementsRef.current.set(element, finalId);

      // Start lazy bbox tracking. The scanner may tag hundreds of elements
      // on a typical page (every row of a long table, every item in a
      // sidebar); eager ResizeObserver-per-element tracking does not scale
      // there. Lazy mode keeps active ResizeObservers bounded by the
      // visible element count via a shared IntersectionObserver.
      const untrack = trackElementBbox(bridge.registry, finalId, element, { lazy: true });
      bboxUntrackersRef.current.set(finalId, untrack);

      if (logLevel) {
        bridge.registry.setElementLogLevel(finalId, logLevel);
      }

      onRegister?.(finalId, element);
    },
    [bridge, idStrategy, customGenerateId, onRegister, logLevel, writeStableAttribute]
  );

  /**
   * Unregister a single element from the bridge registry.
   */
  const unregisterElement = useCallback(
    (element: HTMLElement): void => {
      const id = registeredElementsRef.current.get(element);
      if (!id || !bridge?.registry) return;

      const untrack = bboxUntrackersRef.current.get(id);
      untrack?.();
      bboxUntrackersRef.current.delete(id);

      // Ownership guard: derived ids are not instance-unique, so another node
      // may have taken this id since we registered. Only remove the entry if it
      // still points at OUR node — see `unregisterElement` in core/registry.ts.
      bridge.registry.unregisterElement(id, undefined, element);
      registeredElementsRef.current.delete(element);

      onUnregister?.(id);
    },
    [bridge, onUnregister]
  );

  /**
   * Register a single content element
   */
  const registerContentElement = useCallback(
    (element: HTMLElement): void => {
      if (!bridge?.registry || registeredContentElementsRef.current.has(element)) {
        return;
      }

      const maxElements = contentDiscovery?.maxContentElements ?? 500;
      if (registeredContentElementsRef.current.size >= maxElements) {
        return;
      }

      const id = generateContentId(element);

      // Check if ID already exists in registry
      const existing = bridge.registry.getElement(id);
      if (existing) {
        return; // Content IDs are deterministic — skip duplicates
      }

      const contentType = inferContentType(element);
      const metadata = inferContentMetadata(element);
      // Normalize text once and reuse for `label` (truncated 50 chars for the
      // human-readable slot) and `content` (full normalized text for callers
      // that need the unabridged string). Mirrors `registerSemanticContentElement`'s
      // shape so heading/paragraph/table-cell snapshots carry the same fields
      // as `data-ui-bridge-content` elements (B1 — manual-test remediation
      // 2026-05-10). Without `content`, consumers couldn't distinguish e.g.
      // `heading-2-recommendations-queue` from its sibling by text alone
      // because the 50-char label can truncate long headings.
      // §4.6 F7 — SOURCE gate: inside a `data-bridge-redact` boundary do not
      // scrape `textContent` into `content`/`label` at all (defense-in-depth
      // beside the emission scrub). `data-content-label` is developer-authored,
      // so it survives outside the CONTENT boundary but is dropped inside one
      // (a dev who wraps a subtree intends it hidden).
      // Single definition of the content label derivation so the initial
      // scrape and the `refreshLabels()` re-derivation cannot drift.
      const deriveContentLabel = (el: HTMLElement): string | undefined => {
        if (isContentRedacted(el)) return undefined;
        const raw = el.textContent?.trim();
        const normalized = raw ? raw.replace(/\s+/g, ' ') : undefined;
        return (
          el.getAttribute('data-content-label') ||
          (normalized ? truncateCodePoints(normalized, 50) : undefined) ||
          undefined
        );
      };
      const redacted = isContentRedacted(element);
      const rawText = redacted ? undefined : element.textContent?.trim();
      const normalizedText = rawText ? rawText.replace(/\s+/g, ' ') : undefined;
      const label = deriveContentLabel(element);

      bridge.registry.registerContentElement(id, element, {
        contentType,
        contentMetadata: metadata,
        label,
        // Content ids are deterministic and this function returns early for an
        // already-registered id, so the scrape below never repeats for this
        // node — see `registerElement`'s `labelSource`.
        labelSource: () => deriveContentLabel(element),
        content: normalizedText,
      });

      registeredContentElementsRef.current.set(element, id);
    },
    [bridge, contentDiscovery?.maxContentElements]
  );

  /**
   * Unregister a single content element
   */
  const unregisterContentElement = useCallback(
    (element: HTMLElement): void => {
      const id = registeredContentElementsRef.current.get(element);
      if (!id || !bridge?.registry) return;

      bridge.registry.unregisterElement(id, undefined, element);
      registeredContentElementsRef.current.delete(element);
    },
    [bridge]
  );

  /**
   * Register a `data-ui-bridge-content` semantic content element (Item 1).
   *
   * These are non-interactive cards/badges/pills a tester would assert text
   * on but that carry no `useUIElement` wrapper. The attribute's value is
   * used as the element's snapshot id verbatim — authors pick the semantic
   * id (e.g. `"registered-app:qontinui-supervisor-dashboard"`), and the
   * scanner populates `content` (normalized text), `role` (from
   * `data-ui-bridge-role` or the DOM `role` attribute), and bbox tracking.
   *
   * Separate from `registerContentElement` above, which handles the
   * heading/paragraph/table-cell content-discovery path and emits derived
   * ids with `content-` / `heading-` prefixes.
   */
  const registerSemanticContentElement = useCallback(
    (element: HTMLElement): void => {
      if (!bridge?.registry || registeredContentElementsRef.current.has(element)) {
        return;
      }

      const rawId = element.getAttribute(UI_BRIDGE_CONTENT_ATTR);
      if (!rawId) return; // scanner checked this already, defense in depth
      const id = rawId.trim();
      if (!id) return;

      // Authors chose the id — if it's already taken (e.g. identical card
      // rendered twice in the same tree), skip the duplicate rather than
      // silently appending a suffix that would confuse assertions.
      const existing = bridge.registry.getElement(id);
      if (existing) return;

      // §4.6 F7 — SOURCE gate: inside a `data-bridge-redact` boundary do not
      // scrape `innerText`/`textContent` into `content`/`label` at all
      // (defense-in-depth beside the emission scrub).
      const redacted = isContentRedacted(element);
      // Normalized text: collapse runs of whitespace (including newlines
      // introduced by JSX formatting) so assertions don't need to know
      // exactly how the template wrapped its spans.
      const rawText = redacted ? '' : (readInnerText(element) ?? element.textContent ?? '').trim();
      const content = rawText.replace(/\s+/g, ' ');

      // Role hint — `data-ui-bridge-role` wins, DOM `role` is the fallback.
      const roleAttr =
        element.getAttribute(UI_BRIDGE_ROLE_ATTR) || element.getAttribute('role') || undefined;

      // Label defaults to the first 50 chars of the normalized text so the
      // snapshot has something human-readable in the `label` slot for tools
      // that don't render `content` yet.
      const deriveSemanticLabel = (el: HTMLElement): string | undefined => {
        if (isContentRedacted(el)) return undefined;
        const text = (readInnerText(el) ?? el.textContent ?? '').trim().replace(/\s+/g, ' ');
        return text ? truncateCodePoints(text, 50) : undefined;
      };
      const label = content ? truncateCodePoints(content, 50) : undefined;

      bridge.registry.registerElement(id, element, {
        // `generic` is the closest ElementType we have for a semantic card.
        // The category='content' flag is the load-bearing signal — callers
        // filter on it (or on `kind: 'content'` in the snapshot).
        type: 'generic',
        actions: [],
        label,
        // This function returns early both on `registeredContentElementsRef`
        // and on an already-taken id, so the scrape above never repeats for
        // this node — see `registerElement`'s `labelSource`.
        labelSource: () => deriveSemanticLabel(element),
        category: 'content',
        content,
        role: roleAttr,
        origin: 'auto',
      });

      registeredContentElementsRef.current.set(element, id);

      // Track bbox so the snapshot can expose layout info alongside the
      // text — same as interactive elements. Lazy tracking since a page
      // may host dozens of semantic cards.
      const untrack = trackElementBbox(bridge.registry, id, element, { lazy: true });
      bboxUntrackersRef.current.set(id, untrack);
    },
    [bridge]
  );

  /**
   * Register a single media element (standard or background-image)
   */
  const registerMediaElement = useCallback(
    (element: HTMLElement): void => {
      if (!bridge?.registry || registeredMediaElementsRef.current.has(element)) {
        return;
      }

      const maxElements = mediaDiscovery?.maxMediaElements ?? 200;
      if (registeredMediaElementsRef.current.size >= maxElements) {
        return;
      }

      // Detect whether this is a background-image element or standard media
      const isStandardMedia = element.matches(MEDIA_SELECTORS.join(', '));
      const id = isStandardMedia ? generateMediaId(element) : generateBackgroundImageId(element);

      // Check if ID already exists in registry
      const existing = bridge.registry.getElement(id);
      if (existing) {
        return; // Media IDs are deterministic — skip duplicates
      }

      const metadata = isStandardMedia
        ? captureMediaMetadata(element)
        : captureBackgroundImageMetadata(element);
      if (!metadata) return; // background image capture can return null

      const label = metadata.altText || metadata.src?.split('/').pop() || undefined;
      const refreshFn = isStandardMedia
        ? captureMediaMetadata
        : (el: HTMLElement) => captureBackgroundImageMetadata(el) || metadata;

      bridge.registry.registerMediaElement(id, element, {
        mediaType: metadata.mediaType,
        mediaMetadata: metadata,
        label,
        refreshMetadata: refreshFn,
      });

      registeredMediaElementsRef.current.set(element, id);
    },
    [bridge, mediaDiscovery?.maxMediaElements]
  );

  /**
   * Unregister a single media element
   */
  const unregisterMediaElement = useCallback(
    (element: HTMLElement): void => {
      const id = registeredMediaElementsRef.current.get(element);
      if (!id || !bridge?.registry) return;

      bridge.registry.unregisterElement(id, undefined, element);
      registeredMediaElementsRef.current.delete(element);
    },
    [bridge]
  );

  /**
   * Scan ARIA/HTML relationships for all currently registered elements.
   * Called after each batch of element registrations so relationship data
   * is always up-to-date for snapshot queries.
   */
  const refreshRelationships = useCallback(() => {
    if (!bridge?.relationshipTracker) return;
    const elements = Array.from(registeredElementsRef.current.entries()).map(([element, id]) => ({
      id,
      element: element as Element,
    }));
    if (elements.length === 0) return;
    bridge.relationshipTracker.refreshAutoDetected(elements);
  }, [bridge]);

  /**
   * Scan DOM/ARIA for drag sources and drop zones.
   * Called after each batch of element registrations so drag-drop data
   * is always up-to-date for snapshot queries.
   */
  const refreshDragDrop = useCallback(() => {
    if (!bridge?.dragDropDetector) return;
    const elements = Array.from(registeredElementsRef.current.entries()).map(([element, id]) => ({
      id,
      element: element as Element,
    }));
    if (elements.length === 0) return;
    bridge.dragDropDetector.refreshAutoDetected(elements);
  }, [bridge]);

  /**
   * Process pending registrations (debounced)
   */
  const processPendingRegistrations = useCallback(() => {
    pendingRegistrationsRef.current.forEach((element) => {
      if (shouldRegister(element)) {
        registerElement(element);
      }
    });
    pendingRegistrationsRef.current.clear();
    // After registering a batch of elements, refresh ARIA/HTML relationships and drag-drop
    refreshRelationships();
    refreshDragDrop();
  }, [shouldRegister, registerElement, refreshRelationships, refreshDragDrop]);

  /**
   * Process pending content registrations (debounced, separate timer).
   *
   * Handles two paths:
   *   - Semantic content (`data-ui-bridge-content`, Item 1): always processed
   *     regardless of `contentDiscovery.enabled` because it's an explicit
   *     author opt-in. These elements get the attribute value as the
   *     snapshot id verbatim.
   *   - Heading/paragraph/table-cell discovery: subject to the
   *     `shouldRegisterContent` gate (text length, visibility, etc.) as
   *     before.
   */
  const processPendingContentRegistrations = useCallback(() => {
    const registeredIds = new Set(registeredContentElementsRef.current.values());
    pendingContentRegistrationsRef.current.forEach((element) => {
      if (registeredContentElementsRef.current.has(element)) return;
      // Semantic content takes the fast path — no shouldRegisterContent()
      // gate, because the author explicitly opted in via the attribute.
      if (element.hasAttribute(UI_BRIDGE_CONTENT_ATTR)) {
        registerSemanticContentElement(element);
        return;
      }
      if (shouldRegisterContent(element, contentDiscovery, registeredIds)) {
        registerContentElement(element);
      }
    });
    pendingContentRegistrationsRef.current.clear();
  }, [contentDiscovery, registerContentElement, registerSemanticContentElement]);

  /**
   * Process pending media registrations (debounced, separate timer)
   */
  const processPendingMediaRegistrations = useCallback(() => {
    const registeredIds = new Set(registeredMediaElementsRef.current.values());
    pendingMediaRegistrationsRef.current.forEach((element) => {
      if (shouldRegisterMedia(element, mediaDiscovery, registeredIds)) {
        registerMediaElement(element);
      }
    });
    pendingMediaRegistrationsRef.current.clear();
  }, [mediaDiscovery, registerMediaElement]);

  /**
   * Queue element for registration (with debounce)
   */
  const queueRegistration = useCallback(
    (element: HTMLElement): void => {
      pendingRegistrationsRef.current.add(element);

      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }

      debounceTimeoutRef.current = setTimeout(processPendingRegistrations, debounceMs);
    },
    [debounceMs, processPendingRegistrations]
  );

  /**
   * Queue content element for registration (separate debounce timer)
   */
  const queueContentRegistration = useCallback(
    (element: HTMLElement): void => {
      pendingContentRegistrationsRef.current.add(element);

      if (contentDebounceTimeoutRef.current) {
        clearTimeout(contentDebounceTimeoutRef.current);
      }

      const contentDebounceMs = contentDiscovery?.contentDebounceMs ?? 250;
      contentDebounceTimeoutRef.current = setTimeout(
        processPendingContentRegistrations,
        contentDebounceMs
      );
    },
    [contentDiscovery?.contentDebounceMs, processPendingContentRegistrations]
  );

  /**
   * Queue media element for registration (separate debounce timer)
   */
  const queueMediaRegistration = useCallback(
    (element: HTMLElement): void => {
      pendingMediaRegistrationsRef.current.add(element);

      if (mediaDebounceTimeoutRef.current) {
        clearTimeout(mediaDebounceTimeoutRef.current);
      }

      const mediaDebounceMs = mediaDiscovery?.mediaDebounceMs ?? 200;
      mediaDebounceTimeoutRef.current = setTimeout(
        processPendingMediaRegistrations,
        mediaDebounceMs
      );
    },
    [mediaDiscovery?.mediaDebounceMs, processPendingMediaRegistrations]
  );

  /**
   * Scan and register all existing interactive elements
   */
  const scanAndRegister = useCallback(
    (rootElement: HTMLElement): void => {
      // Prune any leaked entries from prior effect re-runs where the
      // DOM node has since been removed. This keeps the registry bounded
      // when the outer useEffect re-runs repeatedly because a caller
      // passes inline discovery option objects. Cheap — one pass over
      // whatever's currently registered.
      const pruneDisconnected = (ref: typeof registeredElementsRef) => {
        const keep = new Map<HTMLElement, string>();
        ref.current.forEach((id, element) => {
          if (element.isConnected) {
            keep.set(element, id);
          } else if (bridge?.registry) {
            const untrack = bboxUntrackersRef.current.get(id);
            untrack?.();
            bboxUntrackersRef.current.delete(id);
            bridge.registry.unregisterElement(id, undefined, element);
          }
        });
        ref.current = keep;
      };
      pruneDisconnected(registeredElementsRef);
      pruneDisconnected(registeredContentElementsRef);
      pruneDisconnected(registeredMediaElementsRef);

      // Scan interactive elements
      const allSelectors = [...INTERACTIVE_SELECTORS, ...includeSelectors].join(', ');
      const elements = rootElement.querySelectorAll<HTMLElement>(allSelectors);

      elements.forEach((element) => {
        if (shouldRegister(element)) {
          queueRegistration(element);
        }
      });

      // Scan content elements
      if (contentEnabled) {
        const contentSelectors = [
          ...CONTENT_SELECTORS,
          ...(contentDiscovery?.includeContentSelectors || []),
        ].join(', ');
        const contentElements = rootElement.querySelectorAll<HTMLElement>(contentSelectors);
        const registeredIds = new Set(registeredContentElementsRef.current.values());

        contentElements.forEach((element) => {
          if (shouldRegisterContent(element, contentDiscovery, registeredIds)) {
            queueContentRegistration(element);
          }
        });
      }

      // Item 1: semantic plain-content elements (`data-ui-bridge-content`).
      // Always scanned — the attribute is an explicit author opt-in, so it
      // runs independently of the contentDiscovery flag that gates the
      // heading/paragraph auto-discovery pass. The attribute value becomes
      // the snapshot id verbatim inside registerSemanticContentElement.
      const semanticContentElements =
        rootElement.querySelectorAll<HTMLElement>(SEMANTIC_CONTENT_SELECTOR);
      semanticContentElements.forEach((element) => {
        if (!registeredContentElementsRef.current.has(element)) {
          queueContentRegistration(element);
        }
      });

      // Scan media elements
      if (mediaEnabled) {
        const mediaSelectors = MEDIA_SELECTORS.join(', ');
        const mediaElements = rootElement.querySelectorAll<HTMLElement>(mediaSelectors);
        const registeredMediaIds = new Set(registeredMediaElementsRef.current.values());

        mediaElements.forEach((element) => {
          if (shouldRegisterMedia(element, mediaDiscovery, registeredMediaIds)) {
            queueMediaRegistration(element);
          }
        });

        // Scan CSS background images when enabled
        if (mediaDiscovery?.includeBackgroundImages) {
          const maxBg = Math.max(
            0,
            (mediaDiscovery.maxMediaElements ?? 200) - registeredMediaElementsRef.current.size
          );
          const bgElements = findBackgroundImageElements(rootElement, Math.min(maxBg, 50));
          for (const el of bgElements) {
            const bgId = generateBackgroundImageId(el);
            if (!registeredMediaIds.has(bgId) && !registeredMediaElementsRef.current.has(el)) {
              queueMediaRegistration(el);
            }
          }
        }
      }
    },
    [
      bridge,
      includeSelectors,
      shouldRegister,
      queueRegistration,
      contentEnabled,
      contentDiscovery,
      queueContentRegistration,
      mediaEnabled,
      mediaDiscovery,
      queueMediaRegistration,
    ]
  );

  /**
   * Handle mutations
   */
  const handleMutations = useCallback(
    (mutations: MutationRecord[]): void => {
      mutations.forEach((mutation) => {
        // Handle attribute changes that may reveal hidden elements
        if (mutation.type === 'attributes' && mutation.target.nodeType === Node.ELEMENT_NODE) {
          const target = mutation.target as HTMLElement;
          // Rescan the target and its descendants for newly-visible interactive elements
          const allSelectors = [...INTERACTIVE_SELECTORS, ...includeSelectors].join(', ');
          if (shouldRegister(target)) {
            queueRegistration(target);
          }
          const descendants = target.querySelectorAll<HTMLElement>(allSelectors);
          descendants.forEach((descendant) => {
            if (shouldRegister(descendant)) {
              queueRegistration(descendant);
            }
          });

          // Content discovery for newly-visible elements
          if (contentEnabled) {
            const contentSelectors = [
              ...CONTENT_SELECTORS,
              ...(contentDiscovery?.includeContentSelectors || []),
            ].join(', ');
            const registeredIds = new Set(registeredContentElementsRef.current.values());
            if (shouldRegisterContent(target, contentDiscovery, registeredIds)) {
              queueContentRegistration(target);
            }
            const contentDescendants = target.querySelectorAll<HTMLElement>(contentSelectors);
            contentDescendants.forEach((descendant) => {
              if (shouldRegisterContent(descendant, contentDiscovery, registeredIds)) {
                queueContentRegistration(descendant);
              }
            });
          }

          // Item 1 — semantic content (`data-ui-bridge-content`). Always
          // scanned, independent of the contentDiscovery flag.
          if (target.hasAttribute(UI_BRIDGE_CONTENT_ATTR)) {
            if (!registeredContentElementsRef.current.has(target)) {
              queueContentRegistration(target);
            }
          }
          const semanticDescendants =
            target.querySelectorAll<HTMLElement>(SEMANTIC_CONTENT_SELECTOR);
          semanticDescendants.forEach((descendant) => {
            if (!registeredContentElementsRef.current.has(descendant)) {
              queueContentRegistration(descendant);
            }
          });

          // Media discovery for newly-visible elements
          if (mediaEnabled) {
            const mediaSelectors = MEDIA_SELECTORS.join(', ');
            const registeredMediaIds = new Set(registeredMediaElementsRef.current.values());
            if (shouldRegisterMedia(target, mediaDiscovery, registeredMediaIds)) {
              queueMediaRegistration(target);
            }
            const mediaDescendants = target.querySelectorAll<HTMLElement>(mediaSelectors);
            mediaDescendants.forEach((descendant) => {
              if (shouldRegisterMedia(descendant, mediaDiscovery, registeredMediaIds)) {
                queueMediaRegistration(descendant);
              }
            });
          }
        }

        // Handle added nodes
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as HTMLElement;

            // Check the element itself for interactive registration
            if (shouldRegister(element)) {
              queueRegistration(element);
            }

            // Check descendants for interactive registration
            const allSelectors = [...INTERACTIVE_SELECTORS, ...includeSelectors].join(', ');
            const descendants = element.querySelectorAll<HTMLElement>(allSelectors);
            descendants.forEach((descendant) => {
              if (shouldRegister(descendant)) {
                queueRegistration(descendant);
              }
            });

            // Deferred re-scan for lazy-loaded subtrees: elements inside
            // React.lazy/Suspense may not be visible during the initial mutation
            // callback because layout hasn't been computed yet. Schedule re-scans
            // after animation frames and a delayed scan to catch Suspense resolutions.
            if (descendants.length > 0 || element.childElementCount > 3) {
              const doRescan = () => {
                const retryDescendants = element.querySelectorAll<HTMLElement>(allSelectors);
                retryDescendants.forEach((descendant) => {
                  if (shouldRegister(descendant)) {
                    queueRegistration(descendant);
                  }
                });
              };
              // Immediate rAF for fast mounts
              requestAnimationFrame(doRescan);
              // Delayed re-scan for Suspense boundaries that resolve after fallback
              setTimeout(doRescan, 500);
            }

            // Content discovery for added nodes
            if (contentEnabled) {
              const contentSelectors = [
                ...CONTENT_SELECTORS,
                ...(contentDiscovery?.includeContentSelectors || []),
              ].join(', ');
              const registeredIds = new Set(registeredContentElementsRef.current.values());

              // Check the element itself
              if (shouldRegisterContent(element, contentDiscovery, registeredIds)) {
                queueContentRegistration(element);
              }

              // Check descendants
              const contentDescendants = element.querySelectorAll<HTMLElement>(contentSelectors);
              contentDescendants.forEach((descendant) => {
                if (shouldRegisterContent(descendant, contentDiscovery, registeredIds)) {
                  queueContentRegistration(descendant);
                }
              });
            }

            // Item 1 — semantic content registration for added nodes.
            // Always runs, independent of contentDiscovery.enabled.
            if (element.hasAttribute(UI_BRIDGE_CONTENT_ATTR)) {
              if (!registeredContentElementsRef.current.has(element)) {
                queueContentRegistration(element);
              }
            }
            const semanticContentDescendants =
              element.querySelectorAll<HTMLElement>(SEMANTIC_CONTENT_SELECTOR);
            semanticContentDescendants.forEach((descendant) => {
              if (!registeredContentElementsRef.current.has(descendant)) {
                queueContentRegistration(descendant);
              }
            });

            // Media discovery for added nodes
            if (mediaEnabled) {
              const mediaSelectors = MEDIA_SELECTORS.join(', ');
              const registeredMediaIds = new Set(registeredMediaElementsRef.current.values());

              // Check the element itself
              if (shouldRegisterMedia(element, mediaDiscovery, registeredMediaIds)) {
                queueMediaRegistration(element);
              }

              // Check descendants
              const mediaDescendants = element.querySelectorAll<HTMLElement>(mediaSelectors);
              mediaDescendants.forEach((descendant) => {
                if (shouldRegisterMedia(descendant, mediaDiscovery, registeredMediaIds)) {
                  queueMediaRegistration(descendant);
                }
              });
            }
          }
        });

        // Handle removed nodes
        mutation.removedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as HTMLElement;

            // Unregister the element itself (interactive)
            if (registeredElementsRef.current.has(element)) {
              unregisterElement(element);
            }

            // Unregister the element itself (content)
            if (registeredContentElementsRef.current.has(element)) {
              unregisterContentElement(element);
            }

            // Unregister the element itself (media)
            if (registeredMediaElementsRef.current.has(element)) {
              unregisterMediaElement(element);
            }

            // Unregister descendants
            const descendants = element.querySelectorAll<HTMLElement>('*');
            descendants.forEach((descendant) => {
              if (registeredElementsRef.current.has(descendant)) {
                unregisterElement(descendant);
              }
              if (registeredContentElementsRef.current.has(descendant)) {
                unregisterContentElement(descendant);
              }
              if (registeredMediaElementsRef.current.has(descendant)) {
                unregisterMediaElement(descendant);
              }
            });
          }
        });
      });
    },
    [
      shouldRegister,
      queueRegistration,
      unregisterElement,
      includeSelectors,
      contentEnabled,
      contentDiscovery,
      queueContentRegistration,
      unregisterContentElement,
      mediaEnabled,
      mediaDiscovery,
      queueMediaRegistration,
      unregisterMediaElement,
    ]
  );

  /**
   * Setup observer and initial scan
   */
  useEffect(() => {
    if (!enabled || !bridge?.registry) return;

    const rootElement = root || document.body;

    // Capture the bbox-untracker map identity up front so the cleanup
    // function uses a stable reference rather than re-reading the ref's
    // `.current` at teardown time (react-hooks/exhaustive-deps). The map
    // is mutated in place (set/delete/clear) and never reassigned, so
    // this local always points at the same Map the effect body uses.
    const bboxUntrackers = bboxUntrackersRef.current;

    // Initial scan
    scanAndRegister(rootElement);

    // Setup mutation observer
    const observer = new MutationObserver(handleMutations);
    observer.observe(rootElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden'],
    });

    // Listen for auth-complete events from AuthProvider. When a temp
    // runner auto-authenticates, the DOM transitions from login page →
    // authenticated page, but the MutationObserver may not catch all
    // the changes (React reconciliation can be non-incremental). A
    // full re-scan ensures the snapshot reflects the post-auth page.
    const handleAuthComplete = () => {
      // Clear existing registrations — the login-page elements are
      // stale after auth redirect.
      if (bridge?.registry) {
        bridge.registry.clear();
      }
      // Re-scan the entire DOM tree.
      scanAndRegister(rootElement);
    };
    window.addEventListener('ui-bridge-auth-complete', handleAuthComplete);

    const handleRouteChange = () => {
      if (bridge?.registry) {
        bridge.registry.clear();
      }
      bboxUntrackersRef.current.forEach((untrack) => {
        try {
          untrack();
        } catch {
          void 0;
        }
      });
      bboxUntrackersRef.current.clear();
      registeredElementsRef.current = new Map();
      registeredContentElementsRef.current = new Map();
      registeredMediaElementsRef.current = new Map();
      scanAndRegister(rootElement);
    };
    window.addEventListener('ui-bridge-route-change', handleRouteChange);

    // Expose diagnostic flags on window.__UI_BRIDGE__
    if (typeof window !== 'undefined') {
      const w = window as unknown as Record<string, unknown>;
      if (!w.__UI_BRIDGE__) w.__UI_BRIDGE__ = {};
      (w.__UI_BRIDGE__ as Record<string, unknown>).autoRegisterActive = true;
      (w.__UI_BRIDGE__ as Record<string, unknown>).mutationObserverActive = true;
    }

    return () => {
      observer.disconnect();
      window.removeEventListener('ui-bridge-auth-complete', handleAuthComplete);
      window.removeEventListener('ui-bridge-route-change', handleRouteChange);

      // Clear diagnostic flags
      if (typeof window !== 'undefined') {
        const w = window as unknown as Record<string, unknown>;
        if (w.__UI_BRIDGE__) {
          (w.__UI_BRIDGE__ as Record<string, unknown>).autoRegisterActive = false;
          (w.__UI_BRIDGE__ as Record<string, unknown>).mutationObserverActive = false;
        }
      }

      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      if (contentDebounceTimeoutRef.current) {
        clearTimeout(contentDebounceTimeoutRef.current);
      }
      if (mediaDebounceTimeoutRef.current) {
        clearTimeout(mediaDebounceTimeoutRef.current);
      }

      // Unregister only elements whose DOM node has actually been
      // disconnected. The cleanup fires on every effect re-run — not
      // just true unmount — so unconditionally wiping the registry
      // was the root cause of a bug where
      // `GET /ui-bridge/control/elements` intermittently returned an
      // empty element set right after `POST /discover`: the outer
      // effect re-ran (because a caller passed an inline
      // contentDiscovery/mediaDiscovery object, changing the
      // scanAndRegister identity on every parent render), cleanup
      // wiped everything, and the re-scan's debounced queueRegistration
      // hadn't yet committed when the HTTP call arrived.
      //
      // By keeping still-connected entries, we let `shouldRegister`
      // (line 626) skip them on the next scan and the registry stays
      // stable across effect re-runs. Any entries that are genuinely
      // gone (their DOM node was removed) are cleaned up as before.
      //
      // On true unmount the DOM is still connected at cleanup time, so
      // entries would leak here. `scanAndRegister` (called on the next
      // effect run) calls `pruneDisconnectedEntries` up front to catch
      // that leak the moment a new consumer attaches; and the scan
      // path naturally drops disconnected entries on subsequent walks.
      const unregisterIfDisconnected = (ref: React.MutableRefObject<Map<HTMLElement, string>>) => {
        const stillAlive = new Map<HTMLElement, string>();
        ref.current.forEach((id, element) => {
          if (element.isConnected) {
            stillAlive.set(element, id);
          } else {
            const untrack = bboxUntrackers.get(id);
            untrack?.();
            bboxUntrackers.delete(id);
            bridge.registry.unregisterElement(id, undefined, element);
          }
        });
        ref.current = stillAlive;
      };

      unregisterIfDisconnected(registeredElementsRef);
      unregisterIfDisconnected(registeredContentElementsRef);
      unregisterIfDisconnected(registeredMediaElementsRef);
    };
  }, [enabled, bridge, root, scanAndRegister, handleMutations]);
}

export default useAutoRegister;
