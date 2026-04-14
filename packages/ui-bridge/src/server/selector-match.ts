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

  return true;
}
