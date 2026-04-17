/**
 * Stable Element References
 *
 * Provides stable references to UI elements that survive React re-renders,
 * unmount/remount cycles, and DOM mutations. A StableElementRef captures
 * multiple identification strategies so the element can be resolved even
 * after its DOM node has been replaced.
 *
 * Resolution order:
 *   1. primaryId lookup in the registry
 *   2. data-ui-bridge-id DOM attribute query
 *   3. fingerprint match via findNearestRegisteredElement
 *   4. semanticPath traversal (CSS selector)
 */

import type { RegisteredElement } from './types';
import { getGlobalRegistry } from './registry';
import { computeElementFingerprint, findNearestRegisteredElement } from './element-fingerprint';

// ============================================================================
// Types
// ============================================================================

/**
 * A stable reference to a UI element that can survive React re-renders.
 *
 * Contains multiple identification strategies so the element can be
 * resolved even after its DOM node has been replaced.
 */
export interface StableElementRef {
  /** Current transient ID (changes on re-render) */
  id: string;
  /** Strategy used to generate the primaryId (e.g. 'prefer-existing', 'semantic') */
  idStrategy: string;
  /** The element's registered ID at time of creation */
  primaryId: string;
  /** Content-based fingerprint hash (survives re-renders) */
  fingerprint: string;
  /** Semantic path through the component tree (e.g., "App>Sidebar>NavItem[2]") */
  semanticPath: string;
  /** data-ui-bridge-id from DOM if present (highest priority for resolution) */
  stableId?: string;
  /** Timestamp (ms) when this ref was last confirmed to resolve */
  lastSeenAt: number;
}

// ============================================================================
// Creation
// ============================================================================

/**
 * Build a semantic CSS selector path for an element by walking up the DOM.
 * Produces something like "main > div.container > button.submit".
 * Used as a last-resort resolution strategy.
 */
function buildSemanticPath(element: HTMLElement): string | undefined {
  const parts: string[] = [];
  let current: HTMLElement | null = element;
  let depth = 0;

  while (current && current.tagName !== 'BODY' && current.tagName !== 'HTML' && depth < 8) {
    let selector = current.tagName.toLowerCase();

    // Prefer data-testid or id for precise targeting
    const testId = current.getAttribute('data-testid');
    if (testId) {
      parts.unshift(`[data-testid="${testId}"]`);
      break; // Anchored — no need to go higher
    }

    const htmlId = current.id;
    if (htmlId && !/^:r[0-9a-z]+:$/.test(htmlId)) {
      parts.unshift(`#${CSS.escape(htmlId)}`);
      break; // Anchored
    }

    // Add role or landmark info
    const role = current.getAttribute('role');
    if (role) {
      selector += `[role="${role}"]`;
    }

    // Add first meaningful class (skip utility classes)
    const classes = Array.from(current.classList).filter(
      (c) => c.length > 2 && !c.startsWith('css-') && !c.startsWith('_')
    );
    if (classes.length > 0) {
      selector += `.${CSS.escape(classes[0])}`;
    }

    parts.unshift(selector);
    current = current.parentElement;
    depth++;
  }

  return parts.length > 0 ? parts.join(' > ') : undefined;
}

/**
 * Create a StableElementRef for a registered element.
 *
 * Captures the element's ID, fingerprint hash, and semantic path
 * so it can be resolved later even after DOM replacement.
 */
export function createStableRef(element: RegisteredElement): StableElementRef {
  const fingerprint = computeElementFingerprint(element.element);
  const semanticPath = buildSemanticPath(element.element) ?? element.element.tagName.toLowerCase();

  // Infer the ID strategy from the element's attributes
  const idStrategy = element.element.getAttribute('data-testid')
    ? 'data-testid'
    : element.element.id && !/^:r[0-9a-z]+:$/.test(element.element.id)
      ? 'html-id'
      : 'prefer-existing';

  // Capture data-ui-bridge-id if present (written by useAutoRegister)
  const stableId = element.element.getAttribute('data-ui-bridge-id') || undefined;

  return {
    id: element.id,
    idStrategy,
    primaryId: element.id,
    fingerprint: fingerprint.hash,
    semanticPath,
    stableId,
    lastSeenAt: Date.now(),
  };
}

// ============================================================================
// Resolution
// ============================================================================

/**
 * Resolve a StableElementRef back to a live RegisteredElement.
 *
 * Tries resolution strategies in order:
 *   1. Direct ID lookup in the registry
 *   2. DOM query for data-ui-bridge-id attribute
 *   3. Fingerprint match across all registered elements
 *   4. Semantic path CSS selector traversal
 *
 * Returns null if no strategy finds a match.
 */
export function resolveStableRef(ref: StableElementRef): RegisteredElement | null {
  const registry = getGlobalRegistry();

  // Strategy 1: Direct ID lookup
  const byId = registry.getElement(ref.primaryId);
  if (byId && byId.mounted && byId.element.isConnected) {
    return byId;
  }

  // Strategy 2: data-ui-bridge-id attribute lookup
  if (typeof document !== 'undefined') {
    const byAttr = document.querySelector(
      `[data-ui-bridge-id="${CSS.escape(ref.primaryId)}"]`
    ) as HTMLElement | null;
    if (byAttr) {
      const registered = registry.findByDOMElement(byAttr);
      if (registered && registered.mounted) {
        return registered;
      }
      // The DOM node exists but isn't registered — try ancestor walk
      const nearest = findNearestRegisteredElement(byAttr, registry);
      if (nearest && nearest.mounted) {
        return nearest;
      }
    }
  }

  // Strategy 3: Fingerprint match across all registered elements
  const allElements = registry.getAllElements();
  for (const el of allElements) {
    if (!el.mounted || !el.element.isConnected) continue;
    const fp = computeElementFingerprint(el.element);
    if (fp.hash === ref.fingerprint) {
      return el;
    }
  }

  // Strategy 4: Semantic path CSS selector traversal
  if (ref.semanticPath && typeof document !== 'undefined') {
    try {
      const byPath = document.querySelector(ref.semanticPath) as HTMLElement | null;
      if (byPath) {
        const registered = registry.findByDOMElement(byPath);
        if (registered && registered.mounted) {
          return registered;
        }
        // Walk up from the CSS-matched node to find a registered ancestor
        const nearest = findNearestRegisteredElement(byPath, registry);
        if (nearest && nearest.mounted) {
          return nearest;
        }
      }
    } catch {
      // Invalid CSS selector — skip
    }
  }

  return null;
}
