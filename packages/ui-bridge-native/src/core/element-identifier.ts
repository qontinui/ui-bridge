/**
 * Native Element Identifier
 *
 * Utilities for identifying and finding native elements.
 * In React Native, we use testID, accessibilityLabel, and tree paths
 * instead of XPath/CSS selectors.
 */

import type { NativeElementIdentifier, RegisteredNativeElement } from './types';
import { getGlobalRegistry } from './registry';

/**
 * Create an element identifier for a native element
 */
export function createNativeElementIdentifier(
  id: string,
  options: {
    testId?: string;
    accessibilityLabel?: string;
    accessibilityHint?: string;
    treePath?: string;
  } = {}
): NativeElementIdentifier {
  return {
    uiId: id,
    testId: options.testId || id,
    accessibilityLabel: options.accessibilityLabel,
    accessibilityHint: options.accessibilityHint,
    treePath: options.treePath || id,
  };
}

/**
 * Find an element by its identifier in the global registry
 */
export function findElementByIdentifier(
  identifier: string | NativeElementIdentifier
): RegisteredNativeElement | null {
  const registry = getGlobalRegistry();
  if (!registry) return null;

  // If string, try different lookup strategies
  if (typeof identifier === 'string') {
    // Try direct ID lookup
    const byId = registry.getElement(identifier);
    if (byId) return byId;

    // Try testID lookup
    const byTestId = registry.findByTestId(identifier);
    if (byTestId) return byTestId;

    // Try pattern matching
    return findByPattern(registry, identifier);
  }

  // If identifier object, try each strategy
  if (identifier.uiId) {
    const byId = registry.getElement(identifier.uiId);
    if (byId) return byId;
  }

  if (identifier.testId) {
    const byTestId = registry.findByTestId(identifier.testId);
    if (byTestId) return byTestId;
  }

  return null;
}

/**
 * Find element by pattern (supports wildcards)
 */
function findByPattern(
  registry: ReturnType<typeof getGlobalRegistry>,
  pattern: string
): RegisteredNativeElement | null {
  if (!registry) return null;

  // Convert pattern to regex
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special chars
    .replace(/\*/g, '.*') // Convert * to .*
    .replace(/\?/g, '.'); // Convert ? to .

  const regex = new RegExp(`^${regexPattern}$`, 'i');

  for (const element of registry.getAllElements()) {
    const identifier = element.getIdentifier();

    // Match against testId
    if (identifier.testId && regex.test(identifier.testId)) {
      return element;
    }

    // Match against uiId
    if (identifier.uiId && regex.test(identifier.uiId)) {
      return element;
    }

    // Match against treePath
    if (identifier.treePath && regex.test(identifier.treePath)) {
      return element;
    }

    // Match against accessibilityLabel
    if (identifier.accessibilityLabel && regex.test(identifier.accessibilityLabel)) {
      return element;
    }
  }

  return null;
}

/**
 * Find all elements matching a pattern
 */
export function findAllByPattern(pattern: string): RegisteredNativeElement[] {
  const registry = getGlobalRegistry();
  if (!registry) return [];

  // Convert pattern to regex
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');

  const regex = new RegExp(`^${regexPattern}$`, 'i');
  const results: RegisteredNativeElement[] = [];

  for (const element of registry.getAllElements()) {
    const identifier = element.getIdentifier();

    if (
      (identifier.testId && regex.test(identifier.testId)) ||
      (identifier.uiId && regex.test(identifier.uiId)) ||
      (identifier.treePath && regex.test(identifier.treePath)) ||
      (identifier.accessibilityLabel && regex.test(identifier.accessibilityLabel))
    ) {
      results.push(element);
    }
  }

  return results;
}

/**
 * Build a tree path for an element based on its position in the component tree
 */
export function buildTreePath(componentPath: string[], elementIndex?: number): string {
  let path = componentPath.join('/');
  if (elementIndex !== undefined) {
    path += `[${elementIndex}]`;
  }
  return path;
}

/**
 * Parse a tree path into its components
 */
export function parseTreePath(treePath: string): { components: string[]; index?: number } {
  const indexMatch = treePath.match(/\[(\d+)\]$/);
  const index = indexMatch ? parseInt(indexMatch[1], 10) : undefined;
  const pathWithoutIndex = treePath.replace(/\[\d+\]$/, '');
  const components = pathWithoutIndex.split('/').filter(Boolean);

  return { components, index };
}

/**
 * Check if an identifier matches criteria
 */
export function matchesIdentifier(
  identifier: NativeElementIdentifier,
  criteria: Partial<NativeElementIdentifier>
): boolean {
  if (criteria.uiId && identifier.uiId !== criteria.uiId) {
    return false;
  }
  if (criteria.testId && identifier.testId !== criteria.testId) {
    return false;
  }
  if (criteria.accessibilityLabel && identifier.accessibilityLabel !== criteria.accessibilityLabel) {
    return false;
  }
  if (criteria.treePath && identifier.treePath !== criteria.treePath) {
    return false;
  }
  return true;
}
