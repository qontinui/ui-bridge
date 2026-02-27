/**
 * DOM Capture Module
 *
 * Utilities for capturing DOM snapshots and tracking changes.
 */

import type { ElementIdentifier, ElementState } from '../core/types';
import { createElementIdentifier, getBestIdentifier } from '../core/element-identifier';

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
  /** Accessible name */
  accessibleName?: string;
  /** Text content (truncated) */
  textContent?: string;
  /** Element state */
  state: ElementState;
  /** Attributes relevant for automation */
  attributes: Record<string, string>;
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
  'data-ui-id',
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
  '[data-ui-id]',
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
 * Get the accessible name of an element
 */
function getAccessibleName(element: HTMLElement): string | undefined {
  // aria-label takes precedence
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  // aria-labelledby
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labels = labelledBy
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent?.trim())
      .filter(Boolean);
    if (labels.length > 0) return labels.join(' ');
  }

  // Input associated label
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  ) {
    const id = element.id;
    if (id) {
      const label = document.querySelector<HTMLLabelElement>(`label[for="${id}"]`);
      if (label) return label.textContent?.trim();
    }
  }

  // Title attribute
  const title = element.getAttribute('title');
  if (title) return title;

  // Alt text for images
  if (element instanceof HTMLImageElement) {
    return element.alt || undefined;
  }

  // Button or link text content
  if (element.matches('button, a, [role="button"], [role="link"]')) {
    return element.textContent?.trim() || undefined;
  }

  return undefined;
}

/**
 * Get element state
 */
function getElementState(element: HTMLElement): ElementState {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);

  const state: ElementState = {
    visible: isVisible(element, rect, style),
    enabled: !isDisabled(element),
    focused: document.activeElement === element,
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
    },
    computedStyles: {
      display: style.display,
      visibility: style.visibility,
      opacity: style.opacity,
      pointerEvents: style.pointerEvents,
    },
  };

  // Input-specific state
  if (element instanceof HTMLInputElement) {
    state.value = element.value;
    if (element.type === 'checkbox' || element.type === 'radio') {
      state.checked = element.checked;
    }
  } else if (element instanceof HTMLTextAreaElement) {
    state.value = element.value;
  } else if (element instanceof HTMLSelectElement) {
    state.value = element.value;
    state.selectedOptions = Array.from(element.selectedOptions).map((opt) => opt.value);
  }

  return state;
}

function isVisible(element: HTMLElement, rect: DOMRect, style: CSSStyleDeclaration): boolean {
  if (rect.width === 0 || rect.height === 0) return false;
  if (style.display === 'none') return false;
  if (style.visibility === 'hidden') return false;
  if (parseFloat(style.opacity) === 0) return false;
  if (element.getAttribute('aria-hidden') === 'true') return false;

  return (
    rect.top < window.innerHeight &&
    rect.bottom > 0 &&
    rect.left < window.innerWidth &&
    rect.right > 0
  );
}

function isDisabled(element: HTMLElement): boolean {
  if ('disabled' in element && (element as HTMLInputElement).disabled) return true;
  if (element.getAttribute('aria-disabled') === 'true') return true;
  return false;
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
  depth: number,
  maxTextLength: number
): CapturedElement {
  const identifier = createElementIdentifier(element);
  let textContent = element.textContent?.trim();
  if (textContent && textContent.length > maxTextLength) {
    textContent = textContent.substring(0, maxTextLength) + '...';
  }

  return {
    identifier,
    bestId: getBestIdentifier(element),
    tagName: element.tagName.toLowerCase(),
    role: element.getAttribute('role') || undefined,
    accessibleName: getAccessibleName(element),
    textContent,
    state: getElementState(element),
    attributes: captureAttributes(element),
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

    // Check visibility
    if (!includeHidden) {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      if (!isVisible(element, rect, style)) return false;
    }

    return true;
  }

  function traverse(element: HTMLElement, depth: number): void {
    if (depth > maxDepth || elements.length >= maxElements) return;

    totalNodeCount++;

    if (shouldCapture(element)) {
      elements.push(captureElement(element, depth, maxTextLength));
    }

    // Traverse children
    for (const child of element.children) {
      if (child instanceof HTMLElement) {
        traverse(child, depth + 1);
      }
    }
  }

  traverse(root, 0);

  const endTime = performance.now();

  return {
    timestamp: Date.now(),
    url: window.location.href,
    title: document.title,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
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

    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        const change = this.processMutation(mutation);
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

  private processMutation(mutation: MutationRecord): DOMChange | null {
    const target = mutation.target;
    if (!(target instanceof HTMLElement)) return null;

    const elementId = getBestIdentifier(target);

    if (mutation.type === 'attributes') {
      return {
        timestamp: Date.now(),
        type: 'attribute',
        elementId,
        tagName: target.tagName.toLowerCase(),
        details: {
          attributeName: mutation.attributeName || undefined,
          oldValue: mutation.oldValue || undefined,
          newValue: mutation.attributeName
            ? target.getAttribute(mutation.attributeName) || undefined
            : undefined,
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
