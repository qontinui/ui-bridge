/**
 * Element Identification Module
 *
 * Provides utilities for identifying DOM elements using multiple strategies:
 * 1. data-ui-id (explicit UI Bridge identifier - preferred)
 * 2. data-testid (testing library convention)
 * 3. data-awas-element (legacy support)
 * 4. id (HTML id attribute)
 * 5. Generated XPath/CSS selector (fallback)
 */

import type { ElementIdentifier } from './types';

/**
 * Data attributes used for element identification (in priority order)
 */
export const ID_ATTRIBUTES = ['data-ui-id', 'data-testid', 'data-awas-element', 'id'] as const;

/**
 * Generate a unique XPath for an element
 */
export function generateXPath(element: HTMLElement): string {
  if (element.id) {
    return `//*[@id="${element.id}"]`;
  }

  const parts: string[] = [];
  let current: HTMLElement | null = element;

  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let selector = current.nodeName.toLowerCase();

    // Check for identifying attributes
    const uiId = current.getAttribute('data-ui-id');
    if (uiId) {
      selector += `[@data-ui-id="${uiId}"]`;
      parts.unshift(selector);
      break;
    }

    const testId = current.getAttribute('data-testid');
    if (testId) {
      selector += `[@data-testid="${testId}"]`;
      parts.unshift(selector);
      break;
    }

    const id = current.id;
    if (id) {
      selector += `[@id="${id}"]`;
      parts.unshift(selector);
      break;
    }

    // Calculate position among siblings with same tag
    const parentEl: HTMLElement | null = current.parentElement;
    if (parentEl) {
      const currentEl = current;
      const siblings = Array.from(parentEl.children).filter(
        (child): child is Element => child.nodeName === currentEl.nodeName
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(currentEl) + 1;
        selector += `[${index}]`;
      }
    }

    parts.unshift(selector);
    current = parentEl;
  }

  return '/' + parts.join('/');
}

/**
 * Generate a unique CSS selector for an element
 */
export function generateCSSSelector(element: HTMLElement): string {
  // Check for identifying attributes first
  const uiId = element.getAttribute('data-ui-id');
  if (uiId) {
    return `[data-ui-id="${uiId}"]`;
  }

  const testId = element.getAttribute('data-testid');
  if (testId) {
    return `[data-testid="${testId}"]`;
  }

  const awasId = element.getAttribute('data-awas-element');
  if (awasId) {
    return `[data-awas-element="${awasId}"]`;
  }

  if (element.id) {
    return `#${CSS.escape(element.id)}`;
  }

  // Build a path selector
  const path: string[] = [];
  let current: HTMLElement | null = element;

  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let selector = current.nodeName.toLowerCase();

    // Check for unique identifiers on ancestors
    const parentUiId = current.getAttribute('data-ui-id');
    if (parentUiId && current !== element) {
      path.unshift(`[data-ui-id="${parentUiId}"]`);
      break;
    }

    const parentTestId = current.getAttribute('data-testid');
    if (parentTestId && current !== element) {
      path.unshift(`[data-testid="${parentTestId}"]`);
      break;
    }

    if (current.id) {
      path.unshift(`#${CSS.escape(current.id)}`);
      break;
    }

    // Add nth-child if needed for uniqueness
    const parentEl: HTMLElement | null = current.parentElement;
    if (parentEl) {
      const currentEl = current;
      const siblings = Array.from(parentEl.children);
      const sameTagSiblings = siblings.filter(
        (s): s is Element => s.nodeName === currentEl.nodeName
      );

      if (sameTagSiblings.length > 1) {
        const index = siblings.indexOf(currentEl) + 1;
        selector += `:nth-child(${index})`;
      }
    }

    path.unshift(selector);
    current = current.parentElement;
  }

  return path.join(' > ');
}

/**
 * Get the best identifier for an element based on available attributes
 */
export function getBestIdentifier(element: HTMLElement): string {
  // Priority order
  const uiId = element.getAttribute('data-ui-id');
  if (uiId) return uiId;

  const testId = element.getAttribute('data-testid');
  if (testId) return testId;

  const awasId = element.getAttribute('data-awas-element');
  if (awasId) return awasId;

  if (element.id) return element.id;

  // Fallback to generated CSS selector
  return generateCSSSelector(element);
}

/**
 * Create a full ElementIdentifier object for an element
 */
export function createElementIdentifier(element: HTMLElement): ElementIdentifier {
  return {
    uiId: element.getAttribute('data-ui-id') || undefined,
    testId: element.getAttribute('data-testid') || undefined,
    awasId: element.getAttribute('data-awas-element') || undefined,
    htmlId: element.id || undefined,
    xpath: generateXPath(element),
    selector: generateCSSSelector(element),
  };
}

/**
 * Find an element by its identifier
 *
 * Tries each identification method in priority order
 */
export function findElementByIdentifier(
  identifier: string | ElementIdentifier,
  root: ParentNode = document
): HTMLElement | null {
  // If string, try each identification method
  if (typeof identifier === 'string') {
    // Try data-ui-id
    const byUiId = root.querySelector<HTMLElement>(`[data-ui-id="${identifier}"]`);
    if (byUiId) return byUiId;

    // Try data-testid
    const byTestId = root.querySelector<HTMLElement>(`[data-testid="${identifier}"]`);
    if (byTestId) return byTestId;

    // Try data-awas-element
    const byAwasId = root.querySelector<HTMLElement>(`[data-awas-element="${identifier}"]`);
    if (byAwasId) return byAwasId;

    // Try id
    const byId = root.querySelector<HTMLElement>(`#${CSS.escape(identifier)}`);
    if (byId) return byId;

    // Try as CSS selector
    try {
      const bySelector = root.querySelector<HTMLElement>(identifier);
      if (bySelector) return bySelector;
    } catch {
      // Invalid selector, ignore
    }

    // Try as XPath
    try {
      const result = document.evaluate(
        identifier,
        root,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      );
      if (result.singleNodeValue instanceof HTMLElement) {
        return result.singleNodeValue;
      }
    } catch {
      // Invalid XPath, ignore
    }

    return null;
  }

  // If ElementIdentifier object, try in priority order
  if (identifier.uiId) {
    const el = root.querySelector<HTMLElement>(`[data-ui-id="${identifier.uiId}"]`);
    if (el) return el;
  }

  if (identifier.testId) {
    const el = root.querySelector<HTMLElement>(`[data-testid="${identifier.testId}"]`);
    if (el) return el;
  }

  if (identifier.awasId) {
    const el = root.querySelector<HTMLElement>(`[data-awas-element="${identifier.awasId}"]`);
    if (el) return el;
  }

  if (identifier.htmlId) {
    const el = root.querySelector<HTMLElement>(`#${CSS.escape(identifier.htmlId)}`);
    if (el) return el;
  }

  // Try CSS selector
  if (identifier.selector) {
    try {
      const el = root.querySelector<HTMLElement>(identifier.selector);
      if (el) return el;
    } catch {
      // Invalid selector
    }
  }

  // Try XPath
  if (identifier.xpath) {
    try {
      const result = document.evaluate(
        identifier.xpath,
        root,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      );
      if (result.singleNodeValue instanceof HTMLElement) {
        return result.singleNodeValue;
      }
    } catch {
      // Invalid XPath
    }
  }

  return null;
}

/**
 * Find all elements matching an identifier pattern
 */
export function findAllElementsByIdentifier(
  pattern: string,
  root: ParentNode = document
): HTMLElement[] {
  const results: HTMLElement[] = [];

  // Try as CSS selector first (supports wildcards better)
  try {
    const elements = root.querySelectorAll<HTMLElement>(pattern);
    results.push(...Array.from(elements));
    if (results.length > 0) return results;
  } catch {
    // Not a valid CSS selector
  }

  // Try partial matching on data attributes
  const partials = [
    `[data-ui-id*="${pattern}"]`,
    `[data-testid*="${pattern}"]`,
    `[data-awas-element*="${pattern}"]`,
    `[id*="${pattern}"]`,
  ];

  for (const selector of partials) {
    try {
      const elements = root.querySelectorAll<HTMLElement>(selector);
      for (const el of elements) {
        if (!results.includes(el)) {
          results.push(el);
        }
      }
    } catch {
      // Invalid selector
    }
  }

  return results;
}

/**
 * Check if an element matches an identifier
 */
export function elementMatchesIdentifier(
  element: HTMLElement,
  identifier: string | ElementIdentifier
): boolean {
  if (typeof identifier === 'string') {
    return (
      element.getAttribute('data-ui-id') === identifier ||
      element.getAttribute('data-testid') === identifier ||
      element.getAttribute('data-awas-element') === identifier ||
      element.id === identifier ||
      element.matches(identifier)
    );
  }

  return (
    (identifier.uiId && element.getAttribute('data-ui-id') === identifier.uiId) ||
    (identifier.testId && element.getAttribute('data-testid') === identifier.testId) ||
    (identifier.awasId && element.getAttribute('data-awas-element') === identifier.awasId) ||
    (identifier.htmlId && element.id === identifier.htmlId) ||
    false
  );
}
