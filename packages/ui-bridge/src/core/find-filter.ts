/**
 * Canonical find/discover filter — THE single implementation of the
 * `FindRequest` filter surface.
 *
 * History: `POST /control/find` (and its deprecated `/control/discover`
 * alias) was filtered by FOUR divergent copies of this logic — the React
 * commandHandlers, the direct server handlers (`applyFindFilters`), the
 * relay handlers (`filterCachedElements`), and the discover re-implementation
 * — each with its own interactive type-set and visibility semantics. That
 * drift produced a real incident: `discover {interactive_only: false}`
 * returned 194 elements while `/control/snapshot` returned 211, silently
 * omitting 9 registered elements via a default-on visibility filter plus
 * type-set drift. All four call sites now delegate here; do NOT re-implement
 * any of these predicates at a call site.
 *
 * Hard invariant this module restores:
 *   `find/discover {interactive_only: false}` (no other filters) returns a
 *   SUPERSET of the registry elements the snapshot returns — no filter is
 *   applied unless the caller explicitly asked for one.
 *
 * Visibility semantics (DELIBERATE BREAKING CHANGE, 0.22.0):
 *   `include_hidden` now defaults to TRUE — hidden elements are INCLUDED
 *   unless the caller explicitly passes `include_hidden: false` (or camelCase
 *   `includeHidden: false`). Previously the React command path silently
 *   filtered hidden elements by default, which broke the superset invariant.
 *   When `include_hidden === false`, the live DOM check
 *   (`offsetParent !== null || position === 'fixed'`) is used when a DOM node
 *   is available; otherwise the serialized `state.visible !== false`
 *   (falling back to the top-level `visible` field) decides.
 */

/**
 * Unified interactive type-set — the superset of every type-set the four
 * divergent copies used. An element passes the `interactive_only` predicate
 * when its `kind`/`category` is not `'content'` AND (its type is in this set
 * OR it has at least one action).
 */
export const INTERACTIVE_ELEMENT_TYPES: ReadonlySet<string> = new Set([
  'button',
  'input',
  'select',
  'textarea',
  'link',
  'checkbox',
  'radio',
  'switch',
  'tab',
  'slider',
  'menuitem',
]);

/**
 * Structural shape the canonical filter reads. Deliberately loose — it covers
 * all three element shapes that flow through find/discover:
 *
 *  - registry `RegisteredElement` (live DOM node on `.element`),
 *  - serialized snapshot elements (`state`, `kind`, top-level `visible`),
 *  - DOM-fallback `DiscoveredElement` entries.
 *
 * All fields optional so every shape flows through without per-call casts.
 */
export interface FindFilterableElement {
  id?: string;
  type?: string;
  kind?: string;
  category?: string;
  role?: string;
  label?: string;
  accessibleName?: string;
  textContent?: string;
  testId?: string;
  actions?: readonly string[];
  visible?: boolean;
  state?: { textContent?: string; visible?: boolean };
  identifiers?: { testId?: string };
  /** Live DOM node when available (RegisteredElement / DiscoveredElement). */
  element?: unknown;
}

/**
 * The filter criteria surface. Accepts BOTH the camelCase (`FindRequest`)
 * and snake_case (wire payload) spellings of each flag.
 */
export interface CanonicalFindCriteria {
  /** Only keep interactive elements (see {@link INTERACTIVE_ELEMENT_TYPES}). */
  interactiveOnly?: boolean;
  /** snake_case alias for {@link CanonicalFindCriteria.interactiveOnly}. */
  interactive_only?: boolean;
  /**
   * Defaults to TRUE: hidden elements are included unless the caller
   * explicitly passes `false`. See the module doc for the breaking-change
   * rationale (superset invariant vs. snapshot).
   */
  includeHidden?: boolean;
  /** snake_case alias for {@link CanonicalFindCriteria.includeHidden}. */
  include_hidden?: boolean;
  /** Legacy single-type filter (alias for `element_type`). */
  type?: string;
  /** Filter by element type (single type). Takes precedence over `type`. */
  element_type?: string;
  /** Filter by element types (any-of). */
  types?: readonly string[];
  /** Substring match (case-insensitive) on label/text/accessibleName/id. */
  text?: string;
  /** Exact match (case-insensitive, trimmed) on label/text/accessibleName. */
  exact_text?: string;
  /** ARIA role (or inferred type) equality, case-insensitive. */
  role?: string;
  /** Label substring match, case-insensitive. */
  label?: string;
  /** Exact `data-testid` match. */
  testId?: string;
}

/** Resolve the live DOM node for an element, when one is attached. */
function domNode(el: FindFilterableElement): HTMLElement | undefined {
  const node = el.element;
  if (typeof HTMLElement !== 'undefined' && node instanceof HTMLElement) {
    return node;
  }
  return undefined;
}

/** Best-available text content across the three element shapes. */
function elementText(el: FindFilterableElement): string {
  return el.state?.textContent ?? el.textContent ?? domNode(el)?.textContent ?? '';
}

/**
 * Visibility check used ONLY when the caller explicitly passed
 * `include_hidden: false`. Live DOM check when a node is available
 * (`offsetParent` is null for `display:none` subtrees and detached nodes,
 * but also for `position:fixed` elements — hence the second clause);
 * serialized `state.visible` / top-level `visible` otherwise. Elements with
 * no visibility signal at all are kept (unknown ≠ hidden).
 */
function isConsideredVisible(el: FindFilterableElement): boolean {
  const dom = domNode(el);
  if (dom) {
    return dom.offsetParent !== null || getComputedStyle(dom).position === 'fixed';
  }
  return (el.state?.visible ?? el.visible) !== false;
}

/**
 * Apply the canonical find/discover filter. Pure — returns a new array,
 * never mutates. `criteria` may be undefined/empty, in which case the input
 * is returned unfiltered (the superset invariant).
 */
export function applyCanonicalFindFilter<T extends FindFilterableElement>(
  elements: readonly T[],
  criteria?: CanonicalFindCriteria | null
): T[] {
  if (!criteria) return [...elements];

  const interactiveOnly = criteria.interactive_only ?? criteria.interactiveOnly ?? false;
  // BREAKING (0.22.0): default TRUE — only an explicit `false` filters.
  const includeHidden = criteria.include_hidden ?? criteria.includeHidden ?? true;
  const typeFilter = criteria.element_type ?? criteria.type;
  const roleLc = criteria.role?.toLowerCase();
  const textLc = criteria.text?.toLowerCase();
  const exactTextLc = criteria.exact_text?.toLowerCase();
  const labelLc = criteria.label?.toLowerCase();

  return elements.filter((el) => {
    if (interactiveOnly) {
      // Semantic content entries (cards/badges/pills opted in via
      // `data-ui-bridge-content`) are never interactive, even if they
      // inherited actions.
      if (el.kind === 'content' || el.category === 'content') return false;
      const isInteractive =
        (el.type !== undefined && INTERACTIVE_ELEMENT_TYPES.has(el.type)) ||
        (el.actions !== undefined && el.actions.length > 0);
      if (!isInteractive) return false;
    }

    if (includeHidden === false && !isConsideredVisible(el)) return false;

    if (typeFilter && el.type !== typeFilter) return false;
    if (criteria.types && criteria.types.length > 0) {
      if (el.type === undefined || !criteria.types.includes(el.type)) return false;
    }

    if (roleLc !== undefined) {
      const domRole = domNode(el)?.getAttribute('role')?.toLowerCase();
      const elRole = el.role?.toLowerCase();
      const typeAsRole = el.type?.toLowerCase();
      if (domRole !== roleLc && elRole !== roleLc && typeAsRole !== roleLc) return false;
    }

    if (labelLc !== undefined) {
      if (!(el.label ?? '').toLowerCase().includes(labelLc)) return false;
    }

    if (textLc !== undefined) {
      const label = (el.label ?? '').toLowerCase();
      const text = elementText(el).toLowerCase();
      const accessibleName = (el.accessibleName ?? '').toLowerCase();
      const id = (el.id ?? '').toLowerCase();
      if (
        !label.includes(textLc) &&
        !text.includes(textLc) &&
        !accessibleName.includes(textLc) &&
        !id.includes(textLc)
      ) {
        return false;
      }
    }

    if (exactTextLc !== undefined) {
      const label = (el.label ?? '').toLowerCase();
      const text = elementText(el).trim().toLowerCase();
      const accessibleName = (el.accessibleName ?? '').toLowerCase();
      if (label !== exactTextLc && text !== exactTextLc && accessibleName !== exactTextLc) {
        return false;
      }
    }

    if (criteria.testId !== undefined) {
      const elTestId =
        el.testId ??
        el.identifiers?.testId ??
        domNode(el)?.getAttribute('data-testid') ??
        undefined;
      if (elTestId !== criteria.testId) return false;
    }

    return true;
  });
}
