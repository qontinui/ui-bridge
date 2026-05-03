/**
 * Shared element selector matching logic used by every endpoint that
 * filters the registry by a query object (`getElements`, `waitForElementByCondition`,
 * relay-handlers `getElements`, etc.).
 *
 * Historical context: three separate copies of this logic existed and drifted.
 * `getElements` filtered strictly on the `title` field; `waitForElementByCondition`
 * used an accessible-name fallback chain; the relay only had the `label` field.
 * The result was that `GET /control/elements?title=X` and
 * `POST /ai/wait-for-element-condition {selector:{title:X}}` could return
 * different results for the same X. This module is the single source of truth.
 */

/**
 * Narrow shape the matcher needs. Covers both the live-DOM `materialized`
 * element (has `title`/`ariaLabel`/`label`/`id`/`type`) and the relay cache
 * element (only has `label`/`id`/`type`).
 */
export interface MatchableElement {
  id: string;
  type?: string;
  label?: string;
  /** Live DOM `aria-label` attribute, populated by materializeElements. Absent in relay. */
  ariaLabel?: string;
  /** Live DOM `title` attribute, populated by materializeElements. Absent in relay. */
  title?: string;
  /** Phase 3.2: ids/globs this control unhides. See RegisteredElement.reveals. */
  reveals?: string[];
  [key: string]: unknown;
}

export interface ElementSelector {
  /** Exact-match on element id. */
  id?: string;
  /** Case-insensitive substring match. Checks title → ariaLabel → label (accessible name chain). */
  title?: string;
  /** Case-insensitive substring match. Checks ariaLabel → label. */
  aria_label?: string;
  /** Case-insensitive substring match. Checks label → id. */
  text?: string;
  /** Exact-match on element type (e.g. "button", "input"). */
  type?: string;
  /**
   * Phase 3.2 (plan 2026-05-03) — match elements whose `reveals` array
   * intersects this query value.
   *
   * Match semantics (bi-directional glob):
   *  - exact: query equals an entry exactly
   *  - query-as-glob: query contains `*`, regex-matches any entry
   *  - entry-as-glob: an entry contains `*`, regex-matches the query
   *
   * Glob support: `*` matches `.*`. Other regex metachars are escaped.
   */
  revealsAny?: string;
}

/**
 * Convert a simple `*`-wildcard glob into a regular expression. Escapes
 * regex metachars in the rest of the string so callers can pass values
 * containing `.` or `+` without surprise. If the pattern contains no `*`
 * the returned regex is `^<escaped>$` (anchored exact match), so callers
 * can blindly use this helper without first checking for the wildcard.
 */
function globToRegExp(pattern: string): RegExp {
  // Escape regex special chars except `*`, then turn `*` into `.*`. The
  // anchors (^…$) make the match strict so `session-card` does not match
  // `term-session-card-1`.
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

/**
 * Bi-directional glob match between a query value and a single `reveals`
 * entry. Supports both directions: query-as-glob vs entry, and entry-as-
 * glob vs query. Exact equality short-circuits both regex paths.
 */
export function revealsEntryMatches(query: string, entry: string): boolean {
  if (query === entry) return true;
  if (query.includes('*')) {
    if (globToRegExp(query).test(entry)) return true;
  }
  if (entry.includes('*')) {
    if (globToRegExp(entry).test(query)) return true;
  }
  return false;
}

/**
 * Return true if `el` matches every non-empty field of `selector`.
 *
 * An empty or undefined selector matches everything — callers must check that
 * at least one field is set if they want to require a match.
 *
 * Accessible-name fallbacks matter: the live DOM `title` attribute is often
 * empty even when the element clearly has a title from aria-label or label
 * text, so `selector.title` checks all three in order.
 */
export function matchesElementSelector(el: MatchableElement, selector: ElementSelector): boolean {
  if (selector.id && el.id !== selector.id) return false;

  if (selector.type && el.type !== selector.type) return false;

  if (selector.title) {
    const needle = selector.title.toLowerCase();
    const t = (el.title ?? '').toLowerCase();
    const a = (el.ariaLabel ?? '').toLowerCase();
    const l = (el.label ?? '').toLowerCase();
    if (!t.includes(needle) && !a.includes(needle) && !l.includes(needle)) return false;
  }

  if (selector.aria_label) {
    const needle = selector.aria_label.toLowerCase();
    const a = (el.ariaLabel ?? '').toLowerCase();
    const l = (el.label ?? '').toLowerCase();
    if (!a.includes(needle) && !l.includes(needle)) return false;
  }

  if (selector.text) {
    const needle = selector.text.toLowerCase();
    const l = (el.label ?? '').toLowerCase();
    const i = el.id.toLowerCase();
    if (!l.includes(needle) && !i.includes(needle)) return false;
  }

  if (selector.revealsAny) {
    const reveals = el.reveals;
    if (!Array.isArray(reveals) || reveals.length === 0) return false;
    const query = selector.revealsAny;
    let any = false;
    for (const entry of reveals) {
      if (typeof entry !== 'string') continue;
      if (revealsEntryMatches(query, entry)) {
        any = true;
        break;
      }
    }
    if (!any) return false;
  }

  return true;
}
