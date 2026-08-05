/**
 * DOM Fallback Discovery
 *
 * When the SDK's component-level registry returns zero elements, this module
 * provides a querySelectorAll-based fallback that finds interactive elements
 * directly from the DOM. This ensures discovery always returns something useful
 * regardless of how the app integrates the SDK.
 */

import { readScrubbedText, readScrubbedValue, REDACTED_VALUE, verdictOf } from '../core/redaction';
import { truncateCodePoints } from '../core/text';
import {
  computeVisibleText,
  readAriaLabelAttr,
  readAriaLabelledbyAttr,
  readTitleAttr,
  readDisabledSignals,
} from '../core/a11y';

/** Selectors for standard interactive DOM elements. */
const INTERACTIVE_SELECTORS = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="menuitem"]',
  '[role="tab"]',
  '[role="switch"]',
  '[role="slider"]',
  '[role="spinbutton"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="option"]',
  '[role="textbox"]',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
  '[onclick]',
  '[data-ui-element]',
  '[data-testid]',
  'details > summary',
];

const COMBINED_SELECTOR = INTERACTIVE_SELECTORS.join(', ');

/** Infer element type from a raw DOM element. */
function inferType(el: HTMLElement): string {
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute('role');
  if (role) return role;
  if (tag === 'a') return 'link';
  if (tag === 'button') return 'button';
  if (tag === 'select') return 'select';
  if (tag === 'textarea') return 'textarea';
  if (tag === 'details' || tag === 'summary') return 'disclosure';
  if (tag === 'input') {
    const inputType = (el as HTMLInputElement).type?.toLowerCase() ?? 'text';
    if (inputType === 'checkbox') return 'checkbox';
    if (inputType === 'radio') return 'radio';
    if (inputType === 'submit' || inputType === 'button' || inputType === 'reset') return 'button';
    return 'input';
  }
  if (el.hasAttribute('contenteditable')) return 'textbox';
  return 'interactive';
}

/** Infer supported actions from element type. */
function inferActions(type: string): string[] {
  switch (type) {
    case 'button':
      return ['click'];
    case 'link':
      return ['click'];
    case 'input':
    case 'textbox':
    case 'textarea':
      return ['click', 'type', 'clear', 'focus'];
    case 'checkbox':
    case 'radio':
    case 'switch':
    case 'disclosure':
      return ['click', 'toggle'];
    case 'select':
    case 'combobox':
    case 'listbox':
      return ['click', 'select'];
    case 'tab':
    case 'menuitem':
    case 'option':
      return ['click'];
    case 'slider':
    case 'spinbutton':
      return ['click', 'setValue'];
    default:
      return ['click'];
  }
}

/** Get the accessible label for an element. */
function getLabel(el: HTMLElement): string {
  // aria-label takes precedence
  const ariaLabel = readAriaLabelAttr(el);
  if (ariaLabel) return ariaLabel;

  // aria-labelledby
  const labelledBy = readAriaLabelledbyAttr(el);
  if (labelledBy) {
    const labelEl = document.getElementById(labelledBy);
    if (labelEl) return computeVisibleText(labelEl) ?? '';
  }

  // Associated <label> for form inputs
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement
  ) {
    if (el.id) {
      const label = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(el.id)}"]`);
      if (label) return computeVisibleText(label) ?? '';
    }
  }

  // title attribute
  const title = readTitleAttr(el);
  if (title) return title;

  // placeholder for inputs
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    if (el.placeholder) return el.placeholder;
  }

  // Direct text content (capped for perf)
  const text = computeVisibleText(el) ?? '';
  return text.length > 200 ? truncateCodePoints(text, 200) + '…' : text;
}

/** Check if element is visible (not hidden/zero-size). */
function isVisible(el: HTMLElement): boolean {
  if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/** Generate a stable ID for an element. */
function generateId(el: HTMLElement, index: number): string {
  // Prefer data-testid
  const testId = el.getAttribute('data-testid');
  if (testId) return `dom-${testId}`;

  // Try id attribute
  if (el.id) return `dom-${el.id}`;

  // Semantic fallback: tag + type + text snippet
  const tag = el.tagName.toLowerCase();
  const type = inferType(el);
  const text = getLabel(el)
    .slice(0, 30)
    .replace(/[^a-zA-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  if (text) return `dom-${tag}-${text}`;

  return `dom-${type}-${index}`;
}

export interface DOMFallbackElement {
  id: string;
  type: string;
  label: string;
  actions: string[];
  visible: boolean;
  tagName: string;
  /**
   * The DOM-scan projection of `ElementState` (`core/types.ts`). The disabled family
   * (`visible`/`enabled`/`disabled`/`ariaDisabled`/`focused`) is declared with
   * exactly the canonical requiredness so this serializer and the registry's
   * cannot disagree about which keys exist — the divergence R8 was filed for
   * (this path emitted `disabled`, which the canonical type did not even
   * declare, while never emitting `ariaDisabled`).
   */
  state: {
    textContent: string;
    value?: string;
    checked?: boolean;
    visible: boolean;
    enabled: boolean;
    disabled: boolean;
    ariaDisabled: boolean;
    focused: boolean;
    rect: {
      x: number;
      y: number;
      width: number;
      height: number;
      top: number;
      right: number;
      bottom: number;
      left: number;
    };
  };
  identifiers: {
    testId?: string;
    ariaLabel?: string;
    htmlId?: string;
  };
  _domFallback: true;
}

/** A {@link DOMFallbackElement} paired with the live `HTMLElement` it describes. */
export interface DOMFallbackElementWithRef extends DOMFallbackElement {
  /**
   * The live DOM node. Carried alongside the serialized data so callers that
   * need to act on the element (e.g. the injected-mode registry seeder, which
   * registers each node into a `UIBridgeRegistry` with its live ref) don't
   * have to re-query. Never serialized over the wire — strip it via
   * {@link scanDOMForInteractiveElements} when only data is needed.
   */
  element: HTMLElement;
}

/**
 * Core DOM scan: returns each interactive element's structured data **and**
 * its live `HTMLElement` ref. The single source of truth for the selector
 * walk, id derivation, and collision disambiguation.
 *
 * Use this when you need to operate on the elements (register them, act on
 * them). Use {@link scanDOMForInteractiveElements} when you only need the
 * serializable data (the wire / diagnostics path).
 */
export function scanDOMForInteractiveElementsWithRefs(
  root?: HTMLElement
): DOMFallbackElementWithRef[] {
  const container = root ?? document.body;
  if (!container) return [];

  const nodeList = container.querySelectorAll<HTMLElement>(COMBINED_SELECTOR);
  const elements: DOMFallbackElementWithRef[] = [];
  const seenIds = new Set<string>();

  nodeList.forEach((el, index) => {
    let id = generateId(el, index);
    // Disambiguate collisions
    if (seenIds.has(id)) {
      let suffix = 2;
      while (seenIds.has(`${id}-${suffix}`)) suffix++;
      id = `${id}-${suffix}`;
    }
    seenIds.add(id);

    const type = inferType(el);
    const rect = el.getBoundingClientRect();
    // The two independent disabled signals, unfolded once (`enabled` below is
    // the derived fold). Same helper as the registry serializer — see
    // `core/a11y` — so the two paths cannot drift on either value or key set.
    const disabledSignals = readDisabledSignals(el);

    // §4.6 F5: this is the ONLY place the DOM-fallback path still holds the live
    // `element` ref — `scanDOMForInteractiveElements` drops it right after. The
    // landed `materializeElements` gate keyed on `el.element instanceof
    // HTMLElement`, which is ALWAYS false once the ref is dropped, so it
    // redacted nothing here. Scrub AT THE SOURCE instead: `materializeElements`
    // then consumes already-safe data. CONTENT axis for text/label/aria-label,
    // VALUE axis for the entered value.
    const verdict = verdictOf(el);

    elements.push({
      id,
      type,
      label: verdict.content ? REDACTED_VALUE : getLabel(el),
      actions: inferActions(type),
      visible: isVisible(el),
      tagName: el.tagName.toLowerCase(),
      state: {
        textContent: readScrubbedText(el, verdict, { maxLen: 500 }) ?? '',
        value: 'value' in el ? readScrubbedValue(el as HTMLInputElement, verdict) : undefined,
        checked: 'checked' in el ? (el as HTMLInputElement).checked : undefined,
        visible: isVisible(el),
        enabled: !(disabledSignals.disabled || disabledSignals.ariaDisabled),
        disabled: disabledSignals.disabled,
        ariaDisabled: disabledSignals.ariaDisabled,
        focused: document.activeElement === el,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          top: Math.round(rect.top),
          right: Math.round(rect.right),
          bottom: Math.round(rect.bottom),
          left: Math.round(rect.left),
        },
      },
      identifiers: {
        testId: el.getAttribute('data-testid') ?? undefined,
        ariaLabel: verdict.content ? REDACTED_VALUE : (readAriaLabelAttr(el) ?? undefined),
        htmlId: el.id || undefined,
      },
      _domFallback: true,
      element: el,
    });
  });

  return elements;
}

/**
 * Scan the DOM for interactive elements as a fallback when the SDK registry is empty.
 * Returns structured element data compatible with the standard discovery response format.
 *
 * Thin wrapper over {@link scanDOMForInteractiveElementsWithRefs} that drops
 * the live `element` ref so the result is JSON-serializable.
 */
export function scanDOMForInteractiveElements(root?: HTMLElement): DOMFallbackElement[] {
  return scanDOMForInteractiveElementsWithRefs(root).map(({ element: _element, ...data }) => data);
}

/**
 * Count interactive DOM elements without building full element objects.
 * Used by the diagnostics endpoint.
 */
export function countDOMInteractiveElements(root?: HTMLElement): number {
  const container = root ?? document.body;
  if (!container) return 0;
  return container.querySelectorAll<HTMLElement>(COMBINED_SELECTOR).length;
}

/**
 * Find a DOM element by visible text content and optional tag/selector filter.
 */
export function findElementsByText(
  text: string,
  options?: { tag?: string; exact?: boolean; root?: HTMLElement }
): HTMLElement[] {
  const container = options?.root ?? document.body;
  if (!container) return [];

  // Validate tag is a simple tag name (no selectors/combinators) to prevent injection
  const tag = options?.tag;
  const selector = tag ? CSS.escape(tag) : '*';
  const candidates = container.querySelectorAll<HTMLElement>(selector);
  const results: HTMLElement[] = [];
  const searchText = text.toLowerCase();

  candidates.forEach((el) => {
    // Use direct text, not deeply nested text for non-leaf nodes
    const elText = computeVisibleText(el)?.toLowerCase() ?? '';
    if (options?.exact ? elText === searchText : elText.includes(searchText)) {
      results.push(el);
    }
  });

  return results;
}

/**
 * Find a DOM element by CSS selector.
 */
export function findElementBySelector(
  selector: string,
  index?: number,
  root?: HTMLElement
): HTMLElement | null {
  const container = root ?? document.body;
  if (!container) return null;

  if (index !== undefined && index > 0) {
    const all = container.querySelectorAll<HTMLElement>(selector);
    return all[index] ?? null;
  }

  return container.querySelector<HTMLElement>(selector);
}

/**
 * Find a form element by its associated label text.
 */
export function findElementByLabel(labelText: string, root?: HTMLElement): HTMLElement | null {
  const container = root ?? document.body;
  if (!container) return null;

  const labels = container.querySelectorAll<HTMLLabelElement>('label');
  const searchText = labelText.toLowerCase();

  for (const label of labels) {
    const text = computeVisibleText(label)?.toLowerCase() ?? '';
    if (text.includes(searchText)) {
      // label[for]
      if (label.htmlFor) {
        const target = document.getElementById(label.htmlFor);
        if (target) return target as HTMLElement;
      }
      // Nested input
      const nested = label.querySelector<HTMLElement>('input, select, textarea');
      if (nested) return nested;
    }
  }

  // Fallback: aria-label match (escape to prevent CSS selector injection)
  const escaped = CSS.escape(labelText);
  const ariaMatch = container.querySelector<HTMLElement>(`[aria-label*="${escaped}" i]`);
  if (ariaMatch) return ariaMatch;

  // Fallback: placeholder match
  const placeholderMatch = container.querySelector<HTMLElement>(
    `input[placeholder*="${escaped}" i], textarea[placeholder*="${escaped}" i]`
  );
  return placeholderMatch;
}
