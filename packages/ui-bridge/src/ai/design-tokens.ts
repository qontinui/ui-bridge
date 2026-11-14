/**
 * Design tokens — CSS custom properties — as a page uses them.
 *
 * A design system declares its tokens once, usually on `:root`
 * (`:root { --brand: #1f4e8c }`), and components consume them with `var()`
 * (`.btn { background: var(--brand) }`). Reading only the custom properties
 * declared ON an element therefore finds nothing on almost every element of a
 * tokenised page: a live audit of a real shop page found none on all 279
 * registered elements, and the quality metric then scored every colour as
 * hardcoded although the source used `var()` throughout (bridge caveat
 * db2c8942). This module makes token use measurable:
 *
 * - **Root tokens** (`rootTokensOf`): every custom property the readable
 *   stylesheets declare — grouping rules (`@media` that applies, `@layer`,
 *   `@supports`) included — plus the root's inline ones, with its value on the
 *   document root. Reported ONCE per response (`tokens`), never per element:
 *   ~150 tokens on ~300 elements would otherwise repeat ~45,000 name/value
 *   pairs, about 1.6 MB of JSON, against the runner relay's 2 MiB body limit.
 * - **Element overrides** (`inheritedOverridesOf`): the custom properties in
 *   effect on an element whose value differs from the root's, because the
 *   element or an ancestor (below the root) re-declares them, by rule or
 *   inline. A token inherited unchanged from the root is not repeated; read it
 *   from the response's `tokens`.
 * - **Attribution** (`tokenMatchesOf`): for each design property in
 *   `TOKEN_ATTRIBUTED_PROPERTIES`, which tokens it relates to:
 *   - `derived` — a declaration that applies to the element (a matching style
 *     rule, or its inline style) writes that property with `var(--name)`.
 *     It says the source references the token, not that the declaration won
 *     the cascade: a more specific rule can still override it, which `matches`
 *     then tells apart. Inherited `var()` use (a parent's `color: var(--x)`)
 *     is not `derived`; it shows up as `matches`.
 *   - `matches` — the element's computed value equals the token's root value
 *     (after normalising hex/`rgb()` colours and `rem` lengths). Equality can
 *     be coincidence: a hardcoded `16px` matches a `--space-4: 16px` token.
 *   Trivial values (`0px`, `none`, `normal`, `auto`, transparent) are never
 *   matched; every token system "matches" them. A property with neither list
 *   is absent from `tokenMatches`: no token relation was found.
 */

import type { ExtendedComputedStyles, TokenMatches } from '../core/types';
import { scrubContentRequired, verdictOf } from '../core/redaction';

/** The design properties `tokenMatches` attributes: the ones tokens are made for. */
export const TOKEN_ATTRIBUTED_PROPERTIES = [
  'color',
  'backgroundColor',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'gap',
  'borderRadius',
  'boxShadow',
  'border',
  'outline',
] as const satisfies readonly (keyof ExtendedComputedStyles)[];

export type TokenAttributedProperty = (typeof TOKEN_ATTRIBUTED_PROPERTIES)[number];

/** The most root tokens one response lists; `tokenCount` counts them all. */
export const MAX_REPORTED_TOKENS = 2_000;

/** The root token map a response carries, bounded. */
export interface ReportedTokens {
  /** Custom property → its value on the document root, at most `MAX_REPORTED_TOKENS`. */
  tokens: Record<string, string>;
  /** How many tokens the page declares (more than `tokens` holds when it was cut). */
  tokenCount: number;
}

/** The token half of a `CustomPropertyIndex`, built in the same stylesheet walk. */
export interface DesignTokenIndex {
  /** Every custom property name the readable stylesheets and the root's inline style declare. */
  readonly names: ReadonlySet<string>;
  /** Each token's non-empty value on the document root. */
  readonly rootValues: Readonly<Record<string, string>>;
  /** Normalised root value → the tokens holding it. */
  readonly byValue: ReadonlyMap<string, readonly string[]>;
  /** Non-root elements whose matching rules re-declare custom properties. */
  readonly overrides: ReadonlyMap<Element, readonly string[]>;
  /** Elements in scope → design property → tokens an applying rule references with `var()`. */
  readonly varReferences: ReadonlyMap<Element, ReadonlyMap<TokenAttributedProperty, string[]>>;
}

/** The shorthands whose declaration also writes each attributed property. */
const SHORTHANDS: Partial<Record<TokenAttributedProperty, readonly string[]>> = {
  backgroundColor: ['background'],
  fontFamily: ['font'],
  fontSize: ['font'],
  fontWeight: ['font'],
  lineHeight: ['font'],
  paddingTop: ['padding'],
  paddingRight: ['padding'],
  paddingBottom: ['padding'],
  paddingLeft: ['padding'],
  marginTop: ['margin'],
  marginRight: ['margin'],
  marginBottom: ['margin'],
  marginLeft: ['margin'],
};

const KEBAB: Record<TokenAttributedProperty, string> = Object.fromEntries(
  TOKEN_ATTRIBUTED_PROPERTIES.map((p) => [p, p.replace(/([A-Z])/g, '-$1').toLowerCase()])
) as Record<TokenAttributedProperty, string>;

/** Values every token system "matches"; never attributed by equality. */
const TRIVIAL_VALUES = new Set([
  '',
  '0',
  '0px',
  'none',
  'normal',
  'auto',
  'transparent',
  'rgba(0, 0, 0, 0)',
  'inherit',
  'initial',
  'unset',
]);

/** The custom property names a declared value references (`var(--a, var(--b))` → both). */
export function varNames(value: string): string[] {
  const names: string[] = [];
  for (const m of value.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) names.push(m[1]);
  return names;
}

/**
 * The `var()` references an attributed property's declarations make in one
 * style declaration block (a rule's, or an element's inline style), or `null`
 * when it references none.
 */
export function varReferencesOf(
  style: CSSStyleDeclaration
): Map<TokenAttributedProperty, string[]> | null {
  if (!style.cssText.includes('var(--')) return null;
  let refs: Map<TokenAttributedProperty, string[]> | null = null;
  for (const prop of TOKEN_ATTRIBUTED_PROPERTIES) {
    // A shorthand written with var() leaves its longhands empty (pending
    // substitution), so the shorthand's own text is read too.
    const declared = [KEBAB[prop], ...(SHORTHANDS[prop] ?? [])]
      .map((name) => style.getPropertyValue(name))
      .find((value) => value.includes('var(--'));
    if (!declared) continue;
    refs ??= new Map();
    refs.set(prop, varNames(declared));
  }
  return refs;
}

/**
 * The forms a value takes after normalisation: as written, hex and `rgb()`
 * colours as the `rgb(r, g, b)` / `rgba(r, g, b, a)` a computed colour reads,
 * and `rem` lengths in px against the root font size. Named and `hsl()`
 * colours are not converted.
 */
export function normalizedForms(value: string, rootFontPx: number): string[] {
  const raw = value.trim();
  const forms = new Set<string>([raw]);
  const lower = raw.toLowerCase();
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(lower);
  if (hex) {
    const h = hex[1];
    const digits =
      h.length <= 4 ? h.split('').map((c) => c + c) : (h.match(/../g) as RegExpMatchArray);
    const [r, g, b] = digits.slice(0, 3).map((d) => parseInt(d, 16));
    if (digits.length === 4) {
      const a = Math.round((parseInt(digits[3], 16) / 255) * 1000) / 1000;
      forms.add(a === 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`);
    } else {
      forms.add(`rgb(${r}, ${g}, ${b})`);
    }
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(
    lower
  );
  if (rgb) {
    const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map((n) => Math.round(Number(n)));
    const alphaText = rgb[4];
    const a =
      alphaText === undefined
        ? 1
        : alphaText.endsWith('%')
          ? Number(alphaText.slice(0, -1)) / 100
          : Number(alphaText);
    forms.add(a === 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`);
  }
  const rem = /^(-?[\d.]+)rem$/.exec(lower);
  if (rem && rootFontPx > 0) forms.add(`${Number(rem[1]) * rootFontPx}px`);
  return [...forms];
}

/** Build the token index's value lookup and root values once the walk has collected the names. */
export function rootTokenValues(
  doc: Document,
  names: Set<string>
): { rootValues: Record<string, string>; byValue: Map<string, string[]> } {
  const root = doc.documentElement;
  const rootValues: Record<string, string> = {};
  const byValue = new Map<string, string[]>();
  if (!root) return { rootValues, byValue };
  for (let i = 0; i < root.style.length; i++) {
    if (root.style[i].startsWith('--')) names.add(root.style[i]);
  }
  const view = doc.defaultView ?? window;
  const computed = view.getComputedStyle(root);
  const rootFontPx = parseFloat(computed.fontSize) || 16;
  for (const name of names) {
    const value = computed.getPropertyValue(name).trim();
    if (!value) continue;
    rootValues[name] = value;
    for (const form of normalizedForms(value, rootFontPx)) {
      const list = byValue.get(form);
      if (list) list.push(name);
      else byValue.set(form, [name]);
    }
  }
  return { rootValues, byValue };
}

/**
 * The root tokens a response reports (see the module doc), bounded by
 * `MAX_REPORTED_TOKENS`. They are developer-authored design data, reported as
 * declared — unless the document root itself is inside a redaction boundary,
 * when every value collapses.
 */
export function rootTokensOf(index: DesignTokenIndex, doc: Document = document): ReportedTokens {
  const verdict = verdictOf(doc.documentElement);
  const entries = Object.entries(index.rootValues);
  const tokens: Record<string, string> = {};
  for (const [name, value] of entries.slice(0, MAX_REPORTED_TOKENS)) {
    tokens[name] = scrubContentRequired(value, verdict);
  }
  return { tokens, tokenCount: entries.length };
}

/**
 * The custom properties in effect on `el` whose value differs from the root's,
 * because `el` or an ancestor below the root re-declares them (by rule or
 * inline). Values are scrubbed for a content-redacted element.
 */
export function inheritedOverridesOf(
  el: HTMLElement,
  index: DesignTokenIndex
): Record<string, string> {
  const root = el.ownerDocument.documentElement;
  const names = new Set<string>();
  for (let node: Element | null = el; node && node !== root; node = node.parentElement) {
    for (const name of index.overrides.get(node) ?? []) names.add(name);
    const inline = (node as HTMLElement).style;
    if (inline) {
      for (let i = 0; i < inline.length; i++) {
        if (inline[i].startsWith('--')) names.add(inline[i]);
      }
    }
  }
  const result: Record<string, string> = {};
  if (names.size === 0) return result;
  const computed = window.getComputedStyle(el);
  const verdict = verdictOf(el);
  for (const name of names) {
    const value = computed.getPropertyValue(name).trim();
    // Empty: not in effect here (or an engine that does not inherit custom
    // properties). Equal to the root's: already in the response's `tokens`.
    if (!value || value === index.rootValues[name]) continue;
    result[name] = scrubContentRequired(value, verdict);
  }
  return result;
}

/** `el`'s token attribution for its computed `styles` (see the module doc). */
export function tokenMatchesOf(
  el: HTMLElement,
  styles: ExtendedComputedStyles,
  index: DesignTokenIndex
): TokenMatches {
  const result: TokenMatches = {};
  const ruleRefs = index.varReferences.get(el);
  const inlineRefs = varReferencesOf(el.style);
  const rootFontPx =
    parseFloat(window.getComputedStyle(el.ownerDocument.documentElement).fontSize) || 16;
  for (const prop of TOKEN_ATTRIBUTED_PROPERTIES) {
    const value = styles[prop] ?? '';
    // An engine that does not substitute var() leaves it in the computed
    // value; that is a reference too.
    const derived = new Set([
      ...(ruleRefs?.get(prop) ?? []),
      ...(inlineRefs?.get(prop) ?? []),
      ...varNames(value),
    ]);
    const matches = new Set<string>();
    if (!TRIVIAL_VALUES.has(value.trim()) && !value.includes('var(')) {
      for (const form of normalizedForms(value, rootFontPx)) {
        for (const name of index.byValue.get(form) ?? []) matches.add(name);
      }
    }
    if (derived.size === 0 && matches.size === 0) continue;
    result[prop] = {
      ...(derived.size > 0 ? { derived: [...derived] } : {}),
      ...(matches.size > 0 ? { matches: [...matches] } : {}),
    };
  }
  return result;
}
