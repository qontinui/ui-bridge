/**
 * DOM Fallback Discovery
 *
 * When the SDK's component-level registry returns zero elements, this module
 * provides a querySelectorAll-based fallback that finds interactive elements
 * directly from the DOM. This ensures discovery always returns something useful
 * regardless of how the app integrates the SDK.
 */

import {
  isContentRedacted,
  readScrubbedOwnValue,
  truncateKeepingSentinel,
  REDACTED_VALUE,
  verdictOf,
  withBoundaryIndex,
  type RedactionVerdict,
} from '../core/redaction';
import { truncateCodePoints } from '../core/text';
import type { ElementState, ElementType, StandardAction } from '../core/types';
import { inferActions, inferElementType } from '../core/element-kind';
import { getElementState } from '../core/element-state';
import {
  computeVisibleText,
  readAriaLabelAttr,
  readAriaLabelledbyAttr,
  readTitleAttr,
  resolveAccessibleName,
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

/**
 * The frozen ADDRESSING-KEY input for {@link generateId}'s text-slug rung.
 *
 * This is NOT a name and must never be displayed or reported as one. It is
 * the label chain the DOM fallback used before its `label` moved to the
 * canonical accessible name (`core/a11y` `resolveAccessibleName`), kept
 * byte-for-byte because fallback ids (`dom-button-save`) are addressing keys
 * that agents, workflows and the runner hold across releases. The canonical
 * name differs from this chain (multi-id `aria-labelledby`, a wrapping
 * `<label>`, `alt`, `placeholder`, the `derived` rung), so building ids from
 * it would move them. Frozen: do not "fix" it to match accname — that is the
 * id change `dom-fallback.id-stability.test.ts` exists to catch (plan
 * `2026-11-24-ui-bridge-find-visibility-and-fallback-label-read-the-canonical-verdicts`, D4).
 */
function fallbackIdText(el: HTMLElement): string {
  // aria-label takes precedence
  const ariaLabel = readAriaLabelAttr(el);
  if (ariaLabel) return ariaLabel;

  // aria-labelledby (a single id only — frozen, see above)
  const labelledBy = readAriaLabelledbyAttr(el);
  if (labelledBy) {
    const labelEl = document.getElementById(labelledBy);
    if (labelEl) return computeVisibleText(labelEl) ?? '';
  }

  // Associated <label for> for form inputs
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

/** The fallback label's cap: 200 code points, then `…` (the cap the old chain applied). */
const LABEL_MAX_CODE_POINTS = 200;

function capLabel(name: string): string {
  const cut = truncateCodePoints(name, LABEL_MAX_CODE_POINTS);
  return cut === name ? name : cut + '…';
}

/**
 * The DOM-fallback `label`: the element's CANONICAL accessible name
 * (`core/a11y` `resolveAccessibleName`, the one name algorithm the package
 * has, and so the same value as `state.accessibleName`) capped at 200 code
 * points, **with** the §4.6 CONTENT scrub applied — exactly what the scan
 * below writes into `DOMFallbackElement.label`. It includes the `derived`
 * rung (a `data-testid` or icon token) because `state.accessibleName` does;
 * `state.nameSource` says which rung produced it.
 *
 * Exported so the injected registry seeder can hand the registry a
 * re-derivation closure (`registerElement({ labelSource })`). Without that,
 * `RegisteredElement.label` stays frozen at the value scraped on the FIRST
 * discovery pass while the same snapshot's `ariaLabel`/`accessibleName` fields
 * are re-derived live — the stale-label defect. One definition here so the
 * refresh can never drift from the initial scrape.
 */
export function computeDomFallbackLabel(
  el: HTMLElement,
  verdict: RedactionVerdict = verdictOf(el)
): string {
  return verdict.content ? REDACTED_VALUE : capLabel(resolveAccessibleName(el).name ?? '');
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
  const type = inferElementType(el);
  const text = fallbackIdText(el)
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
  /** The ONE inferrer's kind (`core/element-kind`), as every other path reports it. */
  type: ElementType;
  label: string;
  /** The kind's verbs plus the node's own (`core/element-kind` `inferActions`). */
  actions: StandardAction[];
  /** The canonical verdict — always equal to `state.visible` (one value per row). */
  visible: boolean;
  tagName: string;
  /**
   * The DOM-scan projection of `ElementState` (`core/types.ts`). The disabled family
   * (`visible`/`enabled`/`disabled`/`ariaDisabled`/`focused`) is declared with
   * exactly the canonical requiredness so this serializer and the registry's
   * cannot disagree about which keys exist — the divergence R8 was filed for
   * (this path emitted `disabled`, which the canonical type did not even
   * declare, while never emitting `ariaDisabled`).
   *
   * Those fields, `ariaBusy` and the visibility family are COPIED from one
   * `getElementState` call (`core/element-state`, the one reader), so a
   * fallback row's `visible` is the occlusion- and viewport-aware verdict every
   * other path reports, and `checked` is the canonical one too (a checkbox or
   * radio's own state, or `aria-checked` on a checkbox, radio, switch or menu-item-checkbox/radio role;
   * absent otherwise). `textContent` is the canonical text capped at 500 code
   * points (the canonical one is the whole subtree), so an element with no text
   * reads its scrubbed `aria-label` or `title`, as every other path does. Only
   * the rounding of `rect` and `value` (the element's OWN value) are this
   * path's own.
   */
  state: {
    textContent: string;
    value?: string;
    checked?: boolean;
    visible: boolean;
    visibilityReason?: ElementState['visibilityReason'];
    occludedBy?: ElementState['occludedBy'];
    occludedPct?: ElementState['occludedPct'];
    enabled: boolean;
    disabled: boolean;
    ariaDisabled: boolean;
    /** `ElementState.ariaBusy`, copied from the canonical read. */
    ariaBusy: boolean;
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
 * The default scan root: the page's `<body>`, or `null` in a server runtime
 * (Node, a Next.js route handler) where there is no `document` to scan, so
 * every scan answers "no elements" instead of throwing a ReferenceError.
 */
function defaultRoot(): HTMLElement | null {
  return typeof document === 'undefined' ? null : document.body;
}

/**
 * The selector walk and id derivation every scan shares: each interactive
 * element under `container`, in document order, with its collision-free id.
 * The single source of truth for ids, so the full scan and the ref-only scan
 * cannot disagree on one.
 */
function walkInteractive(
  container: HTMLElement,
  visit: (el: HTMLElement, id: string) => void
): void {
  const nodeList = container.querySelectorAll<HTMLElement>(COMBINED_SELECTOR);
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
    visit(el, id);
  });
}

/** One interactive element's identity: what {@link scanDOMForInteractiveElementRefs} returns. */
export interface DOMFallbackElementRef {
  id: string;
  /** Exactly the full scan's `label` (§4.6 CONTENT-scrubbed). */
  label: string;
  element: HTMLElement;
}

/**
 * The ref-only scan: the same walk, ids and labels as
 * {@link scanDOMForInteractiveElementsWithRefs}, without building any element
 * state. For a caller that needs only identity — the injected registry seeder,
 * which re-runs this on every debounced re-seed and lets the registry read the
 * state live through the ONE reader. It builds no `visible` at all, so it is
 * not a second visibility algorithm.
 */
export function scanDOMForInteractiveElementRefs(root?: HTMLElement): DOMFallbackElementRef[] {
  const container = root ?? defaultRoot();
  if (!container) return [];
  const refs: DOMFallbackElementRef[] = [];
  walkInteractive(container, (el, id) => {
    refs.push({ id, label: computeDomFallbackLabel(el), element: el });
  });
  return refs;
}

/**
 * Core DOM scan: returns each interactive element's structured data **and**
 * its live `HTMLElement` ref. Its ids come from the same walk as
 * {@link scanDOMForInteractiveElementRefs}.
 *
 * Use this when you need to operate on the elements (register them, act on
 * them). Use {@link scanDOMForInteractiveElements} when you only need the
 * serializable data (the wire / diagnostics path).
 */
export function scanDOMForInteractiveElementsWithRefs(
  root?: HTMLElement
): DOMFallbackElementWithRef[] {
  const container = root ?? defaultRoot();
  if (!container) return [];

  const elements: DOMFallbackElementWithRef[] = [];

  walkInteractive(container, (el, id) => {
    const type = inferElementType(el);
    // ONE canonical read per element (plan
    // `2026-11-23-ui-bridge-element-state-collapse-follow-ups`, D1). This path
    // used to build its own `offsetParent` + size `visible`, with no viewport or
    // occlusion arm — a second algorithm behind the same field name.
    const state = getElementState(el);
    const rect = state.rect;

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
      label: computeDomFallbackLabel(el, verdict),
      actions: inferActions(type, el),
      // The snapshot path drops the live ref and `materializeElements` reads
      // THIS field, so it must carry the same verdict as `state.visible`.
      visible: state.visible,
      tagName: el.tagName.toLowerCase(),
      state: {
        // The canonical (already §4.6-scrubbed) text, capped at 500 code points
        // with the sentinel-safe cut, the same value render-log/dom-capture.ts
        // converges on. For an element with text it equals the old capped
        // scrubbed read. For an element with none it is the canonical fallback,
        // the scrubbed `aria-label` or `title` (the sentinel inside a redaction
        // boundary), where the old read gave "".
        textContent: truncateKeepingSentinel(state.textContent ?? '', 500),
        value: readScrubbedOwnValue(el, verdict),
        checked: state.checked,
        visible: state.visible,
        visibilityReason: state.visibilityReason,
        occludedBy: state.occludedBy,
        occludedPct: state.occludedPct,
        enabled: state.enabled,
        disabled: state.disabled,
        ariaDisabled: state.ariaDisabled,
        ariaBusy: state.ariaBusy,
        focused: state.focused,
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
  const container = root ?? defaultRoot();
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
  const container = options?.root ?? defaultRoot();
  if (!container) return [];

  // Validate tag is a simple tag name (no selectors/combinators) to prevent injection
  const tag = options?.tag;
  const selector = tag ? CSS.escape(tag) : '*';
  const candidates = container.querySelectorAll<HTMLElement>(selector);
  const results: HTMLElement[] = [];
  const searchText = text.toLowerCase();

  // The boundaries under the container are indexed once for the whole scan, so
  // each candidate's boundary-excluded text costs its own children, not a
  // search and a walk of its entire subtree (candidates x ancestor-subtree).
  withBoundaryIndex(container, () => {
    candidates.forEach((el) => {
      // §4.6: an element inside a redaction boundary is never a text match, and
      // `computeVisibleText` replaces a boundary BELOW a candidate with the
      // sentinel. Together they keep the match (and so the hit count, and a
      // click-by-text's found/not-found answer) from confirming redacted text.
      if (isContentRedacted(el)) return;
      const elText = computeVisibleText(el)?.toLowerCase() ?? '';
      if (options?.exact ? elText === searchText : elText.includes(searchText)) {
        results.push(el);
      }
    });
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
  const container = root ?? defaultRoot();
  if (!container) return null;

  if (index !== undefined && index > 0) {
    const all = container.querySelectorAll<HTMLElement>(selector);
    return all[index] ?? null;
  }

  return container.querySelector<HTMLElement>(selector);
}

/**
 * Find EVERY DOM element matching a CSS selector, in document order.
 *
 * The plural twin of `findElementBySelector`, sharing its `document.body`
 * container default so `readValue({ all: true })` sees exactly the same match
 * set the singular read indexes into.
 */
export function findAllElementsBySelector(selector: string, root?: HTMLElement): HTMLElement[] {
  const container = root ?? defaultRoot();
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(selector));
}

/**
 * Find a form element by its associated label text.
 */
export function findElementByLabel(labelText: string, root?: HTMLElement): HTMLElement | null {
  const container = root ?? defaultRoot();
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
