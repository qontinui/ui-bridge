/**
 * §4.6 redaction predicates — the minimal, self-contained split that the
 * structural-enforcement plan adopts wholesale.
 *
 * This module is the Phase-0 seed of the eventual `core/redaction.ts` choke
 * point (plan `2026-07-20-ui-bridge-structural-redaction-enforcement.md`). It
 * carries ONLY what the arbitrary-selector-bypass fix needs so it can land
 * standalone, ahead of the large structural refactor: two predicates plus a
 * re-export of the existing `REDACTED_VALUE` sentinel. When the structural
 * work lands, the predicates below are the ones it moves here verbatim.
 *
 * The two-predicate split is load-bearing for capability, not decoration:
 *   - `isValueRedacted`  — `<input type="password">` OR a `data-bridge-redact`
 *     boundary. The stricter gate: a password field's *value* is always
 *     hidden. Used for value/echo projections.
 *   - `isContentRedacted` — a `data-bridge-redact` boundary ONLY. Used for
 *     text/content projections. A password field is NOT content-redacted, so
 *     it stays addressable by label/role — only its value is hidden.
 *
 * Cross-link: plans/2026-05-28-production-safe-ui-bridge-design.md §4.6.
 */

// Re-export the single canonical sentinel so callers of this module never
// need a second import (and so there is exactly one definition — the one in
// `core/registry.ts` that consumers already assert on).
export { REDACTED_VALUE } from './registry';

/**
 * The attribute that marks an element (and its subtree) as sensitive. Honored
 * on the element itself OR on any ancestor, so a form can opt its whole
 * subtree in with one attribute.
 */
const BRIDGE_REDACT_ATTR = 'data-bridge-redact';

/**
 * Walk from `el` up through `parentElement` until we hit an ancestor (or `el`
 * itself) carrying `data-bridge-redact="true"`. Returns the matched element,
 * or `null` if none.
 *
 * Null-tolerant by design: a `null`/`undefined` start (or a detached node
 * whose `parentElement` chain runs out) simply returns `null` rather than
 * throwing, so every caller can pass a possibly-missing element without a
 * guard. The truthy check accepts the exact string `"true"` — NOT `""` /
 * `"false"` / `"yes"` — so a typo can't silently disable redaction.
 */
export function closestRedactionBoundary(el: HTMLElement | null | undefined): HTMLElement | null {
  let cursor: HTMLElement | null = el ?? null;
  while (cursor) {
    if (cursor.getAttribute(BRIDGE_REDACT_ATTR) === 'true') return cursor;
    cursor = cursor.parentElement;
  }
  return null;
}

/** `true` when `el` is an `<input type="password">`. Realm-safe (checks
 * `tagName` rather than `instanceof`, which fails across document realms). */
function isPasswordInput(el: HTMLElement): boolean {
  return el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'password';
}

/**
 * §4.6 VALUE verdict — the stricter gate. `true` when the element's *value*
 * must be hidden: it is a password input (unconditional, no opt-in required)
 * OR it sits inside a `data-bridge-redact` boundary. Use this for anything
 * that echoes or reads an element's value.
 */
export function isValueRedacted(el: HTMLElement | null | undefined): boolean {
  if (!el) return false;
  if (isPasswordInput(el)) return true;
  return closestRedactionBoundary(el) !== null;
}

/**
 * §4.6 CONTENT verdict — boundary only. `true` when the element sits inside a
 * `data-bridge-redact` boundary. Use this for text/content projections. A
 * password field is deliberately NOT content-redacted: its value is hidden by
 * `isValueRedacted`, but the element itself stays findable/addressable.
 */
export function isContentRedacted(el: HTMLElement | null | undefined): boolean {
  if (!el) return false;
  return closestRedactionBoundary(el) !== null;
}
