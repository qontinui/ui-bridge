/**
 * Chainable Query DSL for UI Bridge
 *
 * Inspired by AirtestProject/Poco's fluent query API.
 * Provides a builder pattern for composing element queries with
 * parent/child/sibling traversal and attribute filtering.
 *
 * Usage:
 *   const q = UIQuery.from(registry);
 *   const btn = q.withRole('button').withText('Submit').first();
 *   const items = q.select('[data-testid="list"]').children().withRole('listitem').all();
 */

import type { UIBridgeRegistry } from './registry';
import type { RegisteredElement, ElementState, ElementType } from './types';

/**
 * Result of a query — a registered element with its current state.
 */
export interface QueryResult {
  /** The registered element */
  element: RegisteredElement;
  /** Current element state (snapshot at query time) */
  state: ElementState;
  /** The underlying DOM element */
  domElement: HTMLElement;
}

/**
 * Chainable query builder for traversing and filtering UI Bridge elements.
 *
 * All filter methods (withText, withRole, etc.) return a new UIQuery instance,
 * keeping the original immutable. Terminal methods (first, all, count) execute
 * the query and return results.
 */
export class UIQuery {
  private readonly registry: UIBridgeRegistry;
  private readonly resolveElements: () => HTMLElement[];

  private constructor(registry: UIBridgeRegistry, resolveElements: () => HTMLElement[]) {
    this.registry = registry;
    this.resolveElements = resolveElements;
  }

  // ---------------------------------------------------------------------------
  // Factory
  // ---------------------------------------------------------------------------

  /**
   * Create a query starting from all mounted elements in the registry.
   */
  static from(registry: UIBridgeRegistry): UIQuery {
    return new UIQuery(registry, () =>
      registry
        .getAllElements()
        .filter((el) => el.mounted)
        .map((el) => el.element)
    );
  }

  // ---------------------------------------------------------------------------
  // Selectors — narrow the starting set
  // ---------------------------------------------------------------------------

  /**
   * Start from elements matching a CSS selector.
   */
  select(selector: string): UIQuery {
    const parent = this.resolveElements;
    return new UIQuery(this.registry, () => {
      const scope = parent();
      const matched = new Set<HTMLElement>();
      for (const el of scope) {
        try {
          if (el.matches(selector)) matched.add(el);
        } catch {
          // invalid selector — skip
        }
      }
      return Array.from(matched);
    });
  }

  // ---------------------------------------------------------------------------
  // Traversal — move through the DOM tree
  // ---------------------------------------------------------------------------

  /**
   * Get direct children of each element in the current set.
   */
  children(): UIQuery {
    const parent = this.resolveElements;
    return new UIQuery(this.registry, () => {
      const result: HTMLElement[] = [];
      for (const el of parent()) {
        for (const child of el.children) {
          if (child instanceof HTMLElement) {
            result.push(child);
          }
        }
      }
      return result;
    });
  }

  /**
   * Get the direct parent of each element in the current set.
   */
  parent(): UIQuery {
    const parent = this.resolveElements;
    return new UIQuery(this.registry, () => {
      const seen = new Set<HTMLElement>();
      for (const el of parent()) {
        const p = el.parentElement;
        if (p && !seen.has(p)) {
          seen.add(p);
        }
      }
      return Array.from(seen);
    });
  }

  /**
   * Get all descendants matching an optional CSS selector.
   * Without a selector, returns all descendant HTMLElements.
   */
  descendants(selector?: string): UIQuery {
    const parent = this.resolveElements;
    return new UIQuery(this.registry, () => {
      const result = new Set<HTMLElement>();
      for (const el of parent()) {
        const matches = selector
          ? el.querySelectorAll<HTMLElement>(selector)
          : el.querySelectorAll<HTMLElement>('*');
        matches.forEach((m) => result.add(m));
      }
      return Array.from(result);
    });
  }

  /**
   * Get direct siblings (previous + next) of each element in the current set.
   */
  siblings(): UIQuery {
    const parent = this.resolveElements;
    return new UIQuery(this.registry, () => {
      const result = new Set<HTMLElement>();
      for (const el of parent()) {
        const p = el.parentElement;
        if (!p) continue;
        for (const child of p.children) {
          if (child instanceof HTMLElement && child !== el) {
            result.add(child);
          }
        }
      }
      return Array.from(result);
    });
  }

  /**
   * Find descendants matching a CSS selector (alias for descendants with required selector).
   */
  find(selector: string): UIQuery {
    return this.descendants(selector);
  }

  /**
   * Walk up the DOM tree to find the closest ancestor matching a selector.
   */
  closest(selector: string): UIQuery {
    const parent = this.resolveElements;
    return new UIQuery(this.registry, () => {
      const result = new Set<HTMLElement>();
      for (const el of parent()) {
        const match = el.closest<HTMLElement>(selector);
        if (match) result.add(match);
      }
      return Array.from(result);
    });
  }

  // ---------------------------------------------------------------------------
  // Filters — narrow by attributes / state
  // ---------------------------------------------------------------------------

  /**
   * Filter to elements whose visible text contains the given string (case-insensitive).
   */
  withText(text: string): UIQuery {
    const parent = this.resolveElements;
    const lowerText = text.toLowerCase();
    return new UIQuery(this.registry, () =>
      parent().filter((el) => {
        const content = el.textContent?.trim().toLowerCase() ?? '';
        return content.includes(lowerText);
      })
    );
  }

  /**
   * Filter to elements whose visible text matches exactly (case-insensitive).
   */
  withExactText(text: string): UIQuery {
    const parent = this.resolveElements;
    const lowerText = text.toLowerCase();
    return new UIQuery(this.registry, () =>
      parent().filter((el) => {
        const content = el.textContent?.trim().toLowerCase() ?? '';
        return content === lowerText;
      })
    );
  }

  /**
   * Filter to elements with a specific ARIA or HTML role.
   */
  withRole(role: string): UIQuery {
    const parent = this.resolveElements;
    const lowerRole = role.toLowerCase();
    return new UIQuery(this.registry, () =>
      parent().filter((el) => {
        const elRole = el.getAttribute('role')?.toLowerCase() ?? el.tagName.toLowerCase();
        return elRole === lowerRole;
      })
    );
  }

  /**
   * Filter to elements with a specific ElementType in the registry.
   */
  withType(type: ElementType): UIQuery {
    const parent = this.resolveElements;
    return new UIQuery(this.registry, () => {
      const registered = new Map<HTMLElement, RegisteredElement>();
      for (const reg of this.registry.getAllElements()) {
        if (reg.mounted) registered.set(reg.element, reg);
      }
      return parent().filter((el) => registered.get(el)?.type === type);
    });
  }

  /**
   * Filter to elements having a specific attribute, optionally with a specific value.
   */
  withAttr(name: string, value?: string): UIQuery {
    const parent = this.resolveElements;
    return new UIQuery(this.registry, () =>
      parent().filter((el) => {
        if (value !== undefined) {
          return el.getAttribute(name) === value;
        }
        return el.hasAttribute(name);
      })
    );
  }

  /**
   * Filter to elements with a specific data-testid.
   */
  withTestId(testId: string): UIQuery {
    return this.withAttr('data-testid', testId);
  }

  /**
   * Filter to elements that are currently visible in the viewport.
   */
  visible(): UIQuery {
    const parent = this.resolveElements;
    return new UIQuery(this.registry, () =>
      parent().filter((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          parseFloat(style.opacity) > 0
        );
      })
    );
  }

  /**
   * Filter to elements that are enabled (not disabled).
   */
  enabled(): UIQuery {
    const parent = this.resolveElements;
    return new UIQuery(this.registry, () =>
      parent().filter((el) => {
        if ('disabled' in el && (el as HTMLInputElement).disabled) return false;
        if (el.getAttribute('aria-disabled') === 'true') return false;
        return true;
      })
    );
  }

  /**
   * Filter with a custom predicate on the DOM element.
   */
  filter(predicate: (el: HTMLElement) => boolean): UIQuery {
    const parent = this.resolveElements;
    return new UIQuery(this.registry, () => parent().filter(predicate));
  }

  /**
   * Limit the result set to the first N elements.
   */
  limit(n: number): UIQuery {
    const parent = this.resolveElements;
    return new UIQuery(this.registry, () => parent().slice(0, n));
  }

  /**
   * Get the element at a specific index (0-based). Returns a single-element query.
   */
  at(index: number): UIQuery {
    const parent = this.resolveElements;
    return new UIQuery(this.registry, () => {
      const els = parent();
      const el = els[index];
      return el ? [el] : [];
    });
  }

  // ---------------------------------------------------------------------------
  // Terminals — execute the query and return results
  // ---------------------------------------------------------------------------

  /**
   * Execute the query and return the first matching registered element, or undefined.
   */
  first(): QueryResult | undefined {
    const results = this.all();
    return results[0];
  }

  /**
   * Execute the query and return all matching elements that are registered in the registry.
   * Unregistered DOM elements are excluded.
   */
  all(): QueryResult[] {
    const domElements = this.resolveElements();
    const registered = new Map<HTMLElement, RegisteredElement>();
    for (const reg of this.registry.getAllElements()) {
      if (reg.mounted) registered.set(reg.element, reg);
    }

    const results: QueryResult[] = [];
    for (const el of domElements) {
      const reg = registered.get(el);
      if (reg) {
        results.push({
          element: reg,
          state: reg.getState(),
          domElement: el,
        });
      }
    }
    return results;
  }

  /**
   * Execute the query and return all matching DOM elements, including unregistered ones.
   * Use this when you need to traverse DOM structure beyond registered elements.
   */
  allDom(): HTMLElement[] {
    return this.resolveElements();
  }

  /**
   * Return the count of matching registered elements.
   */
  count(): number {
    return this.all().length;
  }

  /**
   * Return the count of matching DOM elements (including unregistered).
   */
  countDom(): number {
    return this.resolveElements().length;
  }

  /**
   * Check if any matching registered element exists.
   */
  exists(): boolean {
    return this.count() > 0;
  }
}
