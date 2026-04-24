/**
 * SVG-safe helpers for reading an element's class string.
 *
 * Background: `Element.className` is typed as `string` on HTMLElement but as
 * `SVGAnimatedString` on SVGElement / MathMLElement. Calling `.split`,
 * `.toLowerCase`, `.trim`, etc. directly on `el.className` throws when the
 * element is an SVG/MathML node. Always route class-string reads through
 * these helpers.
 *
 * Writes (`el.className = '...'`) are fine via the native DOM API and do not
 * need this helper.
 */

/**
 * Safely extract the class string from an element, handling both HTML
 * (string className) and SVG/MathML (SVGAnimatedString).
 *
 * Returns `''` for null/undefined elements or when className is unset.
 */
export function classString(el: Element | null | undefined): string {
  if (!el) return '';
  const cn = (el as HTMLElement).className;
  if (typeof cn === 'string') return cn;
  const baseVal = (cn as SVGAnimatedString | undefined)?.baseVal;
  return typeof baseVal === 'string' ? baseVal : '';
}

/**
 * Convenience: `classString(el)` split on whitespace, empty strings filtered.
 * Prefer `el.classList` when available — only use this when you need the
 * raw token array for string matching (e.g., `.some(c => c.startsWith('btn-'))`).
 */
export function classList(el: Element | null | undefined): string[] {
  const s = classString(el).trim();
  return s ? s.split(/\s+/) : [];
}
