/**
 * Structural-accessibility helpers for the SDK populate path.
 *
 * These produce the canonical wire-fields consumed by Spec-Check's matcher
 * (`UIBridgeElement.role`, `ariaLabel`, `accessibleName`, `text`). The SDK
 * is the single source of truth — every consumer reads these directly.
 *
 * Implementation backed by `dom-accessibility-api` for:
 *   - `getRole(el)` — explicit `role=` + implicit W3C ARIA-in-HTML mapping
 *     (knows that `input[type=submit]` is `button`, `<select multiple>` is
 *     `listbox`, etc.). The reference implementation used by
 *     `@testing-library/dom`'s `getByRole`.
 *   - `computeAccessibleName(el)` — the W3C accessible-name algorithm
 *     (https://w3c.github.io/accname/), consulting `aria-label`,
 *     `aria-labelledby`, associated `<label>`, `title`, and descendant
 *     text content per the role.
 *
 * All helpers are best-effort and never throw — they return `undefined` on
 * any error so the snapshot stays serializable in degraded environments
 * (older jsdom, exotic DOM-like shims).
 */
// `dom-accessibility-api` ships type definitions at `dist/index.d.ts` but its
// `package.json` `exports` field doesn't include a `types` condition, so
// `moduleResolution: bundler` won't auto-resolve them. The ambient declaration
// for our use is in `dom-accessibility-api.d.ts` next to this file.
import { computeAccessibleName, getRole } from 'dom-accessibility-api';

/**
 * Collapse runs of whitespace to a single space and trim. Matches the
 * normalization Spec-Check's matcher will run against the matcher input,
 * so equality comparisons are exact.
 */
function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Canonical ARIA role per W3C ARIA-in-HTML mapping. Returns the explicit
 * `role=` attribute if set and valid; otherwise the implicit role for the
 * tag (e.g. `<button>` → `"button"`, `<input type="checkbox">` →
 * `"checkbox"`). Returns `undefined` if the element has no applicable role
 * (e.g. plain `<div>`).
 */
export function computeRoleSafe(node: Element): string | undefined {
  try {
    const role = getRole(node);
    return role || undefined;
  } catch {
    // `getRole` can throw on detached / synthetic DOM in jsdom variants —
    // fall back to the explicit attribute so we still emit something useful.
    const explicit = node.getAttribute?.('role');
    return explicit && explicit.trim() ? explicit.trim() : undefined;
  }
}

/**
 * Computed `aria-label` per the schema contract: explicit `aria-label`
 * attribute, with `aria-labelledby` reference resolution as fallback
 * (multiple ids joined by single spaces). Returns `undefined` if neither
 * is set.
 *
 * This is intentionally narrower than `computeAccessibleNameSafe`. The
 * accessible-name algorithm may also consult `<label for>`, `title`,
 * descendant text, etc. — this helper produces just the explicit ARIA
 * labelling for callers that need to distinguish the two.
 */
export function computeAriaLabel(node: Element): string | undefined {
  const explicit = node.getAttribute?.('aria-label');
  if (explicit && explicit.trim()) return normalizeWhitespace(explicit);

  const labelledBy = node.getAttribute?.('aria-labelledby');
  if (!labelledBy) return undefined;

  const ownerDocument = node.ownerDocument;
  if (!ownerDocument) return undefined;

  const ids = labelledBy.split(/\s+/).filter(Boolean);
  const parts: string[] = [];
  for (const id of ids) {
    const referenced = ownerDocument.getElementById(id);
    const text = referenced?.textContent?.trim();
    if (text) parts.push(text);
  }
  if (parts.length === 0) return undefined;
  return normalizeWhitespace(parts.join(' '));
}

/**
 * W3C accessible-name algorithm (https://w3c.github.io/accname/) output.
 * Wraps `computeAccessibleName` from `dom-accessibility-api` to never
 * throw and to coerce the empty string to `undefined` so the schema
 * field is omitted rather than serialized as `""`.
 */
export function computeAccessibleNameSafe(node: Element): string | undefined {
  try {
    const name = computeAccessibleName(node);
    if (!name) return undefined;
    const normalized = normalizeWhitespace(name);
    return normalized || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Visible text content with whitespace collapsed and trimmed. Uses
 * `innerText` when available (it respects CSS visibility and
 * `<br>`-to-newline mapping), falling back to `textContent` (which
 * includes all descendant text regardless of CSS).
 *
 * jsdom does not implement `innerText` — there the fallback path always
 * fires. That's fine for our use case: Spec-Check's matcher compares
 * the value after the same normalization on both sides.
 */
export function computeVisibleText(node: Element): string | undefined {
  const inner = (node as HTMLElement).innerText;
  const raw = typeof inner === 'string' && inner.length > 0 ? inner : node.textContent ?? '';
  const normalized = normalizeWhitespace(raw);
  return normalized || undefined;
}
