/**
 * DOM Capture Module
 *
 * Utilities for capturing DOM snapshots and tracking changes.
 */

import type { ElementIdentifier, ElementState } from '../core/types';
import type { Scrubbed } from '../core/redaction';
import {
  BRIDGE_REDACT_ATTR,
  scrubContent,
  scrubRecord,
  verdictFailClosed,
  verdictOf,
} from '../core/redaction';
// The ONE `ElementState` reader (plan
// `2026-11-08-ui-bridge-element-state-has-two-readers-and-no-aria-busy`, D1):
// a captured element's `state` is the same state the registry snapshot reports.
import { getElementState, withVisibilityPass } from '../core/element-state';
import { createElementIdentifier, getBestIdentifier } from '../core/element-identifier';
import { truncateCodePoints } from '../core/text';
import { pageViewportContext } from '../control/page-scroll-container';
import { withoutInspectorPanelRecords } from '../core/inspector-panel';

/**
 * Captured DOM element information
 */
export interface CapturedElement {
  /** Element identifier */
  identifier: ElementIdentifier;
  /** Best single identifier string */
  bestId: string;
  /** Tag name */
  tagName: string;
  /** Element role */
  role?: string;
  /** Accessible name. §4.6 CONTENT-bearing — `Scrubbed<string>`. */
  accessibleName?: Scrubbed<string>;
  /** Text content (truncated). §4.6 CONTENT-bearing — `Scrubbed<string>`. */
  textContent?: Scrubbed<string>;
  /** Element state */
  state: ElementState;
  /**
   * Attributes relevant for automation. §4.6: `CAPTURE_ATTRIBUTES` literally
   * enumerates `value` / `alt` / `title` / `placeholder` / `aria-label`, so
   * inside a boundary every attribute VALUE must collapse, and on a bare
   * password input the `value` attribute collapses (VALUE axis). Branded as a
   * whole via `scrubRecord` (per-field branding is impossible on a `Record`).
   */
  attributes: Scrubbed<Record<string, string>>;
  /** Child element count */
  childCount: number;
  /** Depth in the DOM tree */
  depth: number;
}

/**
 * DOM snapshot
 */
export interface DOMSnapshot {
  /** Timestamp when snapshot was taken */
  timestamp: number;
  /** Page URL */
  url: string;
  /** Page title */
  title: string;
  /** Viewport dimensions */
  viewport: {
    width: number;
    height: number;
    scrollX: number;
    scrollY: number;
  };
  /** Captured elements */
  elements: CapturedElement[];
  /** Total DOM node count */
  totalNodeCount: number;
  /** Capture duration in milliseconds */
  captureDurationMs: number;
}

/**
 * Options for DOM capture
 */
export interface CaptureOptions {
  /** Root element to capture from (defaults to document.body) */
  root?: HTMLElement;
  /** Maximum depth to traverse */
  maxDepth?: number;
  /** Maximum number of elements to capture */
  maxElements?: number;
  /** Only capture interactive elements */
  interactiveOnly?: boolean;
  /** Include hidden elements */
  includeHidden?: boolean;
  /** Selectors to include (whitelist) */
  includeSelectors?: string[];
  /** Selectors to exclude (blacklist) */
  excludeSelectors?: string[];
  /** Custom filter function */
  filter?: (element: HTMLElement) => boolean;
  /** Truncate text content to this length */
  maxTextLength?: number;
}

/**
 * Attributes to capture for automation
 */
const CAPTURE_ATTRIBUTES = [
  'data-testid',
  'data-awas-element',
  'id',
  'name',
  'type',
  'href',
  'src',
  'alt',
  'title',
  'placeholder',
  'value',
  'aria-label',
  'aria-labelledby',
  'aria-describedby',
  'aria-expanded',
  'aria-selected',
  'aria-checked',
  'aria-disabled',
  'aria-hidden',
  'role',
  'tabindex',
  'disabled',
  'readonly',
  'required',
  'checked',
];

/**
 * Interactive element selectors
 */
const INTERACTIVE_SELECTORS = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  '[onclick]',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="menuitem"]',
  '[role="tab"]',
  '[role="switch"]',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
  '[data-ui-element]',
  '[data-testid]',
];

/**
 * Check if an element is interactive
 */
function isInteractive(element: HTMLElement): boolean {
  return INTERACTIVE_SELECTORS.some((selector) => {
    try {
      return element.matches(selector);
    } catch {
      return false;
    }
  });
}

/**
 * Capture attributes from an element
 */
function captureAttributes(element: HTMLElement): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const attr of CAPTURE_ATTRIBUTES) {
    const value = element.getAttribute(attr);
    if (value !== null) {
      attrs[attr] = value;
    }
  }
  return attrs;
}

/**
 * Capture a single element
 */
function captureElement(
  element: HTMLElement,
  state: ElementState,
  depth: number,
  maxTextLength: number
): CapturedElement {
  const identifier = createElementIdentifier(element);
  // The canonical state already read (and CONTENT-scrubbed) the subtree text;
  // reuse it rather than walk the subtree a second time. It includes the
  // reader's icon-only fallback (aria-label / title, scrubbed on the same
  // axis), so a captured element's `textContent` and its `state.textContent`
  // agree.
  let textContent: string | undefined = state.textContent;
  if (textContent && textContent.length > maxTextLength) {
    textContent = truncateCodePoints(textContent, maxTextLength) + '...';
  }

  // §4.6: route the content fields + attribute record through the choke point
  // (`CAPTURE_ATTRIBUTES` literally lists value/alt/title/placeholder/aria-label).
  const verdict = verdictOf(element);
  const scrubbedText = scrubContent(textContent, element);
  // The capture is bounded: the canonical state's `textContent` is the whole
  // subtree's text (`<body>` carries the page), and the render log retains up
  // to 1000 entries in memory — so the projected state carries the SAME
  // truncated text as the top-level field, not the untruncated read.
  const capturedState: ElementState =
    textContent !== state.textContent ? { ...state, textContent: scrubbedText } : state;
  return {
    identifier,
    bestId: getBestIdentifier(element),
    tagName: element.tagName.toLowerCase(),
    role: element.getAttribute('role') || undefined,
    // The canonical reader's name (`core/a11y` `resolveAccessibleName`, already
    // redaction-minted), so the top-level field and `state.accessibleName` are
    // one value. An empty name leaves the field absent rather than `""`.
    accessibleName: state.accessibleName || undefined,
    textContent: scrubbedText,
    state: capturedState,
    attributes: scrubRecord(captureAttributes(element), verdict),
    childCount: element.children.length,
    depth,
  };
}

/**
 * Capture DOM snapshot
 */
export function captureDOMSnapshot(options: CaptureOptions = {}): DOMSnapshot {
  const startTime = performance.now();
  const {
    root = document.body,
    maxDepth = 50,
    maxElements = 5000,
    interactiveOnly = false,
    includeHidden = false,
    includeSelectors,
    excludeSelectors,
    filter,
    maxTextLength = 200,
  } = options;

  const elements: CapturedElement[] = [];
  let totalNodeCount = 0;

  function shouldCapture(element: HTMLElement): boolean {
    // Check custom filter
    if (filter && !filter(element)) return false;

    // Check exclude selectors
    if (excludeSelectors) {
      for (const selector of excludeSelectors) {
        try {
          if (element.matches(selector)) return false;
        } catch {
          // Invalid selector
        }
      }
    }

    // Check include selectors (whitelist)
    if (includeSelectors && includeSelectors.length > 0) {
      let matches = false;
      for (const selector of includeSelectors) {
        try {
          if (element.matches(selector)) {
            matches = true;
            break;
          }
        } catch {
          // Invalid selector
        }
      }
      if (!matches) return false;
    }

    // Check interactive only
    if (interactiveOnly && !isInteractive(element)) return false;

    return true;
  }

  function traverse(element: HTMLElement, depth: number): void {
    if (depth > maxDepth || elements.length >= maxElements) return;

    totalNodeCount++;

    if (shouldCapture(element)) {
      // The state is read ONCE per element, by the canonical reader, and the
      // visibility filter reads its `visible` — so a captured element's
      // `state.visible` and the reason it was captured cannot disagree, and
      // both match the registry snapshot (occlusion-aware, `opacity: 0` is
      // hidden; `aria-hidden` is an a11y-tree fact, not a visibility one).
      const state = getElementState(element);
      if (includeHidden || state.visible) {
        elements.push(captureElement(element, state, depth, maxTextLength));
      }
    }

    // Traverse children
    for (const child of element.children) {
      if (child instanceof HTMLElement) {
        traverse(child, depth + 1);
      }
    }
  }

  withVisibilityPass(() => traverse(root, 0));

  const endTime = performance.now();

  // Scroll offsets come from the page's real scroll container: where `<body>`
  // scrolls itself (the SPA / Tauri layout) the window never moves, so
  // `window.scrollY` would record 0 on a scrolled page.
  const pageViewport = pageViewportContext();

  return {
    timestamp: Date.now(),
    url: window.location.href,
    title: document.title,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: pageViewport.scrollX,
      scrollY: pageViewport.scrollY,
    },
    elements,
    totalNodeCount,
    captureDurationMs: endTime - startTime,
  };
}

/**
 * Capture only interactive elements
 */
export function captureInteractiveElements(
  options: Omit<CaptureOptions, 'interactiveOnly'> = {}
): DOMSnapshot {
  return captureDOMSnapshot({ ...options, interactiveOnly: true });
}

/**
 * Mutation record for tracked changes
 */
export interface DOMChange {
  timestamp: number;
  type: 'added' | 'removed' | 'modified' | 'attribute';
  elementId?: string;
  tagName: string;
  details?: {
    attributeName?: string;
    oldValue?: string;
    newValue?: string;
    addedNodes?: number;
    removedNodes?: number;
  };
}

/**
 * DOM change observer
 */
export class DOMChangeObserver {
  private observer: MutationObserver | null = null;
  private changes: DOMChange[] = [];
  private maxChanges: number;
  private callback?: (change: DOMChange) => void;

  constructor(options: { maxChanges?: number; callback?: (change: DOMChange) => void } = {}) {
    this.maxChanges = options.maxChanges ?? 1000;
    this.callback = options.callback;
  }

  start(root: HTMLElement = document.body): void {
    if (this.observer) return;

    this.observer = new MutationObserver((records) => {
      // The debug inspector panel's own DOM (its root's `pointer-events`
      // toggle, its re-renders) is not a page change, so it is never logged.
      const mutations = withoutInspectorPanelRecords(records);
      if (mutations.length === 0) return;
      // Records are delivered after the fact, so a target's boundary status is
      // read as of NOW, not as of its mutation. A batch that un-marks or moves
      // a boundary (a `data-bridge-redact` change, or any removed node)
      // therefore cannot say whether an earlier value in that batch was written
      // inside one: its attribute records fail closed. The same holds for a
      // `type` change, which can take an input out of the password verdict
      // after a value was written to it.
      const boundaryMayHaveMoved = mutations.some(
        (m) =>
          (m.type === 'attributes' &&
            (m.attributeName === BRIDGE_REDACT_ATTR || m.attributeName === 'type')) ||
          (m.type === 'childList' && m.removedNodes.length > 0)
      );
      for (const mutation of mutations) {
        const change = this.processMutation(mutation, boundaryMayHaveMoved);
        if (change) {
          this.addChange(change);
        }
      }
    });

    this.observer.observe(root, {
      childList: true,
      attributes: true,
      characterData: true,
      subtree: true,
      attributeOldValue: true,
    });
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  private processMutation(
    mutation: MutationRecord,
    boundaryMayHaveMoved: boolean
  ): DOMChange | null {
    const target = mutation.target;
    if (!(target instanceof HTMLElement)) return null;

    const elementId = getBestIdentifier(target);

    if (mutation.type === 'attributes') {
      const attributeName = mutation.attributeName;
      // §4.6: an attribute change ships both the old and the new value, so each
      // goes through the same record scrub the snapshot's `attributes` do —
      // inside a boundary every value collapses, and a `value` attribute
      // collapses under a value-only verdict (a password input).
      const verdict = boundaryMayHaveMoved ? verdictFailClosed() : verdictOf(target);
      const scrubbed = (raw: string | null): string | undefined =>
        attributeName && raw
          ? scrubRecord({ [attributeName]: raw }, verdict)[attributeName]
          : undefined;
      return {
        timestamp: Date.now(),
        type: 'attribute',
        elementId,
        tagName: target.tagName.toLowerCase(),
        details: {
          attributeName: attributeName || undefined,
          oldValue: scrubbed(mutation.oldValue),
          newValue: attributeName ? scrubbed(target.getAttribute(attributeName)) : undefined,
        },
      };
    }

    if (mutation.type === 'childList') {
      if (mutation.addedNodes.length > 0) {
        return {
          timestamp: Date.now(),
          type: 'added',
          elementId,
          tagName: target.tagName.toLowerCase(),
          details: {
            addedNodes: mutation.addedNodes.length,
          },
        };
      }
      if (mutation.removedNodes.length > 0) {
        return {
          timestamp: Date.now(),
          type: 'removed',
          elementId,
          tagName: target.tagName.toLowerCase(),
          details: {
            removedNodes: mutation.removedNodes.length,
          },
        };
      }
    }

    return null;
  }

  private addChange(change: DOMChange): void {
    this.changes.push(change);
    if (this.changes.length > this.maxChanges) {
      this.changes.shift();
    }
    this.callback?.(change);
  }

  getChanges(): DOMChange[] {
    return [...this.changes];
  }

  clearChanges(): void {
    this.changes = [];
  }
}
