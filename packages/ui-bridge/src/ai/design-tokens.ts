/**
 * Design tokens — CSS custom properties — as a page uses them.
 *
 * A design system declares its tokens once, usually on `:root`
 * (`:root { --brand: #1f4e8c }`), and components consume them with `var()`
 * (`.btn { background: var(--brand) }`). The custom properties declared ON an
 * element are therefore not a measure of token use. This module measures it:
 *
 * - **Root tokens** (`reportedTokensOf` → `tokens`): every custom property the
 *   stylesheets declare, with its value on the document root, its family
 *   (`TokenFamily`) and where the value came from. Reported once per response,
 *   never per element. Each value is capped at `MAX_TOKEN_VALUE_LENGTH`
 *   characters. A custom property set INLINE on the root (often from
 *   script, so possibly from user data) is reported by name with its value
 *   kept only when it is a colour or a plain number/length, else redacted.
 * - **Scopes** (`scopes`, per element `tokenScopes`): an ancestor below the
 *   root that re-declares tokens (a theme wrapper) is reported once, with its
 *   values; each element names the scopes it sits in instead of repeating
 *   their values.
 * - **Attribution** (`tokenMatchesOf` → `tokenMatches`), per design property
 *   in `TOKEN_ATTRIBUTED_PROPERTIES`:
 *   - `derived` — a declaration that applies to the element (a matching rule,
 *     or its inline style) writes the property with `var(--name)`, and the
 *     computed value equals the token's resolved value, so the declaration won
 *     the cascade. Shorthands are expanded per side (`padding: var(--a)
 *     var(--b)` gives the vertical sides `--a`, the horizontal `--b`) and
 *     logical properties map to physical ones assuming a horizontal LTR
 *     writing mode. `expression: true` marks a reference inside `calc()` or
 *     another function, whose result cannot be compared with the token;
 *     `via: 'inherited'` marks an inherited property (colour, font, line
 *     height, letter spacing) whose value came unchanged from the nearest
 *     ancestor declaring it, which declared it with `var()`.
 *   - `overridden` — such a declaration exists but the computed value differs:
 *     it lost the cascade (or a `var()` fallback applied).
 *   - `matches` — the computed value equals the root value of a token of a
 *     compatible family (after normalising colours, `rem`, and a unitless line
 *     height against the element's font size). Equality can be coincidence.
 *     At most `MAX_MATCHES` names; `matchCount` counts them all.
 *   - `inherited: true` — an inherited property whose value equals the
 *     parent's and that no ancestor derives from a token: it is not a choice
 *     made on this element.
 *   Trivial values (`0px`, `none`, `normal`, `auto`, transparent) are never
 *   matched. A property with nothing to report is absent.
 */

import type { ExtendedComputedStyles, TokenAttribution, TokenMatches } from '../core/types';
import { REDACTED_VALUE, scrubContentRequired, verdictOf } from '../core/redaction';
import { normalizeColor } from './css-color';
import { emptyCoverage, type StylesheetCoverage } from './stylesheet-walk';

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

/** What a token is for. A token only `matches` properties of its own family. */
export type TokenFamily =
  | 'color'
  | 'space'
  | 'font-size'
  | 'font-weight'
  | 'font-family'
  | 'line-height'
  | 'letter-spacing'
  | 'radius'
  | 'border'
  | 'shadow'
  | 'size';

const PROPERTY_FAMILY: Record<TokenAttributedProperty, TokenFamily> = {
  color: 'color',
  backgroundColor: 'color',
  fontFamily: 'font-family',
  fontSize: 'font-size',
  fontWeight: 'font-weight',
  lineHeight: 'line-height',
  letterSpacing: 'letter-spacing',
  paddingTop: 'space',
  paddingRight: 'space',
  paddingBottom: 'space',
  paddingLeft: 'space',
  marginTop: 'space',
  marginRight: 'space',
  marginBottom: 'space',
  marginLeft: 'space',
  gap: 'space',
  borderRadius: 'radius',
  boxShadow: 'shadow',
  border: 'border',
  outline: 'border',
};

/** Inherited properties: an element without its own declaration takes its parent's value. */
const INHERITED_PROPERTIES: ReadonlySet<TokenAttributedProperty> = new Set([
  'color',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
]);

/** Name patterns for a token the page never references with `var()`, in priority order. */
const NAME_FAMILIES: ReadonlyArray<[RegExp, TokenFamily]> = [
  [
    /colou?r|(^|-)(bg|fg|background|foreground|accent|primary|secondary|muted|destructive|ring)(-|$)/,
    'color',
  ],
  [/font-size|(^--|-)text-(2?xs|sm|base|md|lg|\d*xl|\d+)$/, 'font-size'],
  [/font-weight|(^--|-)weight(-|$)/, 'font-weight'],
  [/line-height|leading/, 'line-height'],
  [/letter-spacing|tracking/, 'letter-spacing'],
  [/radius|rounded/, 'radius'],
  [/border-width|stroke/, 'border'],
  [/shadow/, 'shadow'],
  [/font-family|(^--|-)font-(sans|serif|mono|body|heading|display)$|(^--|-)font$/, 'font-family'],
  [/space|spacing|gap|gutter|padding|margin|inset/, 'space'],
  [/size|width|height/, 'size'],
];

/** The most root tokens one response lists; `tokenCount` counts them all. */
export const MAX_REPORTED_TOKENS = 2_000;
/** The longest token value reported; longer ones are cut and counted in `truncatedValues`. */
export const MAX_TOKEN_VALUE_LENGTH = 256;
/** The most scopes one response lists; `scopeCount` counts them all. */
export const MAX_REPORTED_SCOPES = 100;
/** The most overrides one scope lists. */
export const MAX_SCOPE_OVERRIDES = 500;
/** The most `matches` names per property; `matchCount` counts them all. */
export const MAX_MATCHES = 8;
/** How far up an inherited property's derivation is followed. */
const MAX_INHERITANCE_DEPTH = 32;

const TRUNCATION_MARKER = '…[truncated]';

/** One reported root token. */
export interface ReportedToken {
  /** Its value on the document root (capped; see `MAX_TOKEN_VALUE_LENGTH`). */
  value: string;
  /** What it is for; empty when nothing tells. */
  families: TokenFamily[];
  /** How `families` was decided: the properties the page uses it in, its name, or its value. */
  familyFrom: 'usage' | 'name' | 'value' | 'none';
  /** `stylesheet`, or `inline` for a custom property set on the root's `style`. */
  from: 'stylesheet' | 'inline';
}

/** An ancestor that re-declares tokens for its subtree. */
export interface TokenScope {
  /** The scope element, described (`div#app.theme-dark[data-theme="dark"]`). */
  element: string;
  /** The tokens it re-declares, with their values in it. */
  overrides: Record<string, string>;
}

/** The token data a design response carries once (see the module doc). */
export interface ReportedTokens {
  tokens: Record<string, ReportedToken>;
  /** How many tokens the page declares (more than `tokens` holds when it was cut). */
  tokenCount: number;
  /** How many reported values were cut at `MAX_TOKEN_VALUE_LENGTH`. */
  truncatedValues: number;
  /** Scopes the batch's elements sit in, by id (`tokenScopes` on each element). */
  scopes: Record<string, TokenScope>;
  /** How many scopes the batch's elements sit in (more than `scopes` holds when it was cut). */
  scopeCount: number;
  /** What the stylesheet walk read and skipped: a missing `derived` may be a skipped rule. */
  tokenCoverage: StylesheetCoverage;
}

/** A `var()` reference one declaration makes for one attributed property. */
export interface TokenReference {
  names: string[];
  /** The declared value is exactly `var(--x[, fallback])`, so it can be compared with the token. */
  bare: boolean;
  /** Read from a shorthand that writes several properties (`font`, `background`). */
  ambiguous: boolean;
}

/** Per attributed property, the reference a declaration block makes. */
export type ReferenceMap = Map<TokenAttributedProperty, TokenReference>;

/** The token half of a `CustomPropertyIndex`, built in the same stylesheet walk. */
export interface DesignTokenIndex {
  readonly document: Document;
  /** Every custom property name the stylesheets and the root's inline style declare. */
  readonly names: ReadonlySet<string>;
  /** Names set inline on the root. */
  readonly inlineRootNames: ReadonlySet<string>;
  /** Each token's non-empty value on the document root. */
  readonly rootValues: Readonly<Record<string, string>>;
  /** Each token's family and how it was decided. */
  readonly families: ReadonlyMap<string, Pick<ReportedToken, 'families' | 'familyFrom'>>;
  /** The root font size, for `rem`. */
  readonly rootFontPx: number;
  /** Normalised root value → tokens holding it. */
  readonly byValue: ReadonlyMap<string, readonly string[]>;
  /** Non-root elements whose matching rules re-declare custom properties. */
  readonly overrides: ReadonlyMap<Element, readonly string[]>;
  /** Elements (in scope, and their ancestors) → the references their matching rules make. */
  readonly references: ReadonlyMap<Element, ReferenceMap>;
  /** What the walk read and skipped. */
  readonly coverage: StylesheetCoverage;
  /** Per-batch caches, filled as elements are read. */
  readonly batch: TokenBatchState;
}

/** State one batch accumulates while its elements are read. */
export interface TokenBatchState {
  computed: Map<Element, CSSStyleDeclaration>;
  inherited: Map<Element, Map<TokenAttributedProperty, InheritedDerivation | null>>;
  scopeIds: Map<Element, string | null>;
  scopes: Record<string, TokenScope>;
  scopeCount: number;
}

interface InheritedDerivation {
  names: string[];
  expression: boolean;
}

// ============================================================================
// Declarations → references
// ============================================================================

const VAR_PATTERN = /var\(\s*--/;

/** The custom property names a value references (`var(--a, var(--b))` → both). */
export function varNames(value: string): string[] {
  const names: string[] = [];
  for (const m of value.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) names.push(m[1]);
  return names;
}

/** Whether a value is exactly one `var()` (with an optional fallback). */
function isBareVar(value: string): boolean {
  const v = value.trim();
  if (!/^var\(/i.test(v)) return false;
  let depth = 0;
  for (let i = 0; i < v.length; i++) {
    if (v[i] === '(') depth++;
    else if (v[i] === ')') {
      depth--;
      if (depth === 0) return i === v.length - 1;
    }
  }
  return false;
}

/** Split a value on its top-level whitespace (`calc(1px + 2px) var(--a)` → two parts). */
export function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of value.trim()) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (current) parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts;
}

/** The 1–4 value box shorthand, per physical side (top, right, bottom, left). */
function boxSides(value: string): [string, string, string, string] | null {
  const p = splitTopLevel(value);
  if (p.length === 1) return [p[0], p[0], p[0], p[0]];
  if (p.length === 2) return [p[0], p[1], p[0], p[1]];
  if (p.length === 3) return [p[0], p[1], p[2], p[1]];
  if (p.length === 4) return [p[0], p[1], p[2], p[3]];
  return null;
}

/** A 1–2 value logical pair (start, end). */
function pair(value: string): [string, string] | null {
  const p = splitTopLevel(value);
  if (p.length === 1) return [p[0], p[0]];
  if (p.length === 2) return [p[0], p[1]];
  return null;
}

type Side = 'Top' | 'Right' | 'Bottom' | 'Left';
const SIDES: readonly Side[] = ['Top', 'Right', 'Bottom', 'Left'];

/**
 * For one box property (`padding` / `margin`), the declared text of each side,
 * most specific source first: the physical longhand, the logical longhand,
 * the logical shorthand, then the box shorthand. A browser leaves a longhand
 * empty when its shorthand was written with `var()`, so the first non-empty
 * source is the one in effect in this block.
 */
function boxSideText(style: CSSStyleDeclaration, box: 'padding' | 'margin', side: Side): string {
  const longhand = style.getPropertyValue(`${box}-${side.toLowerCase()}`);
  if (longhand) return longhand;
  const axis = side === 'Top' || side === 'Bottom' ? 'block' : 'inline';
  const end = side === 'Top' || side === 'Left' ? 'start' : 'end';
  const logical = style.getPropertyValue(`${box}-${axis}-${end}`);
  if (logical) return logical;
  const logicalPair = pair(style.getPropertyValue(`${box}-${axis}`));
  if (logicalPair && logicalPair[0]) return end === 'start' ? logicalPair[0] : logicalPair[1];
  const sides = boxSides(style.getPropertyValue(box));
  return sides ? sides[SIDES.indexOf(side)] : '';
}

/** The declared texts that write a property as a whole, most specific first. */
const WHOLE_SOURCES: Partial<Record<TokenAttributedProperty, readonly string[]>> = {
  color: ['color'],
  fontFamily: ['font-family'],
  fontSize: ['font-size'],
  fontWeight: ['font-weight'],
  lineHeight: ['line-height'],
  letterSpacing: ['letter-spacing'],
  gap: ['gap', 'row-gap', 'column-gap'],
  borderRadius: [
    'border-radius',
    'border-top-left-radius',
    'border-top-right-radius',
    'border-bottom-right-radius',
    'border-bottom-left-radius',
    'border-start-start-radius',
    'border-start-end-radius',
    'border-end-start-radius',
    'border-end-end-radius',
  ],
  boxShadow: ['box-shadow'],
  border: [
    'border',
    'border-color',
    'border-width',
    'border-top',
    'border-right',
    'border-bottom',
    'border-left',
    'border-top-color',
    'border-right-color',
    'border-bottom-color',
    'border-left-color',
    'border-top-width',
    'border-right-width',
    'border-bottom-width',
    'border-left-width',
    'border-inline',
    'border-block',
    'border-inline-color',
    'border-block-color',
  ],
  outline: ['outline', 'outline-color', 'outline-width'],
};

/** Functions whose `var()` arguments are not the background colour. */
const NON_COLOR_FUNCTIONS =
  /(?:linear|radial|conic|repeating-linear|repeating-radial|repeating-conic)-gradient\(|url\(|image-set\(|image\(/i;

/** The `var()` names in a `background` value that can be its colour layer. */
function backgroundColorNames(value: string): string[] {
  return splitTopLevel(value.replace(/,/g, ' , '))
    .filter((part) => !NON_COLOR_FUNCTIONS.test(part))
    .flatMap(varNames);
}

/**
 * The `var()` references one declaration block (a rule's, or an element's
 * inline style) makes, per attributed property; `null` when it makes none.
 */
export function referencesOf(style: CSSStyleDeclaration): ReferenceMap | null {
  if (!VAR_PATTERN.test(style.cssText)) return null;
  const refs: ReferenceMap = new Map();
  const add = (prop: TokenAttributedProperty, text: string, ambiguous = false): void => {
    if (!VAR_PATTERN.test(text)) return;
    refs.set(prop, { names: varNames(text), bare: isBareVar(text), ambiguous });
  };
  for (const box of ['padding', 'margin'] as const) {
    for (const side of SIDES)
      add(`${box}${side}` as TokenAttributedProperty, boxSideText(style, box, side));
  }
  for (const [prop, sources] of Object.entries(WHOLE_SOURCES) as Array<
    [TokenAttributedProperty, readonly string[]]
  >) {
    const text = sources.map((name) => style.getPropertyValue(name)).find((v) => v !== '');
    if (text) add(prop, text);
  }
  const bgColor = style.getPropertyValue('background-color');
  if (bgColor) {
    add('backgroundColor', bgColor);
  } else {
    const background = style.getPropertyValue('background');
    const names = backgroundColorNames(background);
    if (names.length > 0) {
      refs.set('backgroundColor', { names, bare: isBareVar(background), ambiguous: true });
    }
  }
  const font = style.getPropertyValue('font');
  if (VAR_PATTERN.test(font)) {
    for (const prop of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight'] as const) {
      if (!refs.has(prop)) refs.set(prop, { names: varNames(font), bare: true, ambiguous: true });
    }
  }
  return refs.size > 0 ? refs : null;
}

// ============================================================================
// Normalisation and families
// ============================================================================

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

function px(n: number): string {
  return `${Number(n.toFixed(3))}px`;
}

/**
 * The forms a value takes after normalisation: as written; a colour as a
 * browser serialises it (`css-color.ts`); `rem` in px against the root font
 * size; px with float noise removed; and, for a line height, a unitless
 * number in px against the element's font size.
 */
export function normalizedForms(
  value: string,
  context: { rootFontPx: number; fontPx?: number; lineHeight?: boolean }
): string[] {
  const raw = value.trim();
  const forms = new Set<string>([raw]);
  const color = normalizeColor(raw);
  if (color) forms.add(color);
  const lower = raw.toLowerCase();
  const length = /^(-?[\d.]+)(px|rem)$/.exec(lower);
  if (length) {
    const n = Number(length[1]);
    forms.add(px(length[2] === 'rem' ? n * context.rootFontPx : n));
  }
  if (context.lineHeight && context.fontPx && /^[\d.]+$/.test(lower)) {
    forms.add(px(Number(lower) * context.fontPx));
  }
  return [...forms];
}

function familyFromName(name: string): TokenFamily | null {
  for (const [pattern, family] of NAME_FAMILIES) if (pattern.test(name)) return family;
  return null;
}

function decideFamilies(
  names: ReadonlySet<string>,
  usage: ReadonlyMap<string, Set<TokenFamily>>,
  rootValues: Readonly<Record<string, string>>
): Map<string, Pick<ReportedToken, 'families' | 'familyFrom'>> {
  const result = new Map<string, Pick<ReportedToken, 'families' | 'familyFrom'>>();
  for (const name of names) {
    const used = usage.get(name);
    if (used && used.size > 0) {
      result.set(name, { families: [...used], familyFrom: 'usage' });
      continue;
    }
    const byName = familyFromName(name);
    if (byName) {
      result.set(name, { families: [byName], familyFrom: 'name' });
      continue;
    }
    const value = rootValues[name];
    if (value && normalizeColor(value)) {
      result.set(name, { families: ['color'], familyFrom: 'value' });
      continue;
    }
    result.set(name, { families: [], familyFrom: 'none' });
  }
  return result;
}

// ============================================================================
// Building the index
// ============================================================================

/** Collects the token index during the stylesheet walk (`indexCustomProperties`). */
export class TokenIndexBuilder {
  readonly names = new Set<string>();
  readonly overrides = new Map<Element, string[]>();
  readonly references = new Map<Element, ReferenceMap>();
  readonly coverage = emptyCoverage();
  private readonly usage = new Map<string, Set<TokenFamily>>();

  constructor(private readonly doc: Document) {}

  /** A rule matched `elements`; it declares `declared` custom properties and makes `refs`. */
  addRule(
    declared: readonly string[],
    refs: ReferenceMap | null,
    elements: Iterable<Element>
  ): void {
    for (const name of declared) this.names.add(name);
    if (refs) {
      for (const [prop, ref] of refs) {
        if (ref.ambiguous) continue;
        for (const name of ref.names) {
          let set = this.usage.get(name);
          if (!set) this.usage.set(name, (set = new Set()));
          set.add(PROPERTY_FAMILY[prop]);
        }
      }
    }
    const root = this.doc.documentElement;
    for (const el of elements) {
      if (declared.length > 0 && el !== root) {
        const list = this.overrides.get(el);
        if (list) list.push(...declared);
        else this.overrides.set(el, [...declared]);
      }
      if (refs) {
        let map = this.references.get(el);
        if (!map) this.references.set(el, (map = new Map()));
        // Later rules win in source order; specificity is not modelled, the
        // computed-value check (`derived` vs `overridden`) settles it.
        for (const [prop, ref] of refs) map.set(prop, ref);
      }
    }
  }

  build(): DesignTokenIndex {
    const doc = this.doc;
    const root = doc.documentElement;
    const inlineRootNames = new Set<string>();
    const rootValues: Record<string, string> = {};
    const byValue = new Map<string, string[]>();
    let rootFontPx = 16;
    if (root) {
      for (let i = 0; i < root.style.length; i++) {
        if (root.style[i].startsWith('--')) {
          inlineRootNames.add(root.style[i]);
          this.names.add(root.style[i]);
        }
      }
      // An inline root reference (`html { style="color: var(--x)" }`) counts as usage.
      const inlineRefs = referencesOf(root.style);
      if (inlineRefs) this.addRule([], inlineRefs, [root]);
      const computed = (doc.defaultView ?? window).getComputedStyle(root);
      rootFontPx = parseFloat(computed.fontSize) || 16;
      for (const name of this.names) {
        const value = computed.getPropertyValue(name).trim();
        if (value) rootValues[name] = value;
      }
    }
    const families = decideFamilies(this.names, this.usage, rootValues);
    for (const [name, value] of Object.entries(rootValues)) {
      for (const form of normalizedForms(value, { rootFontPx })) {
        const list = byValue.get(form);
        if (list) list.push(name);
        else byValue.set(form, [name]);
      }
    }
    return {
      document: doc,
      names: this.names,
      inlineRootNames,
      rootValues,
      families,
      rootFontPx,
      byValue,
      overrides: this.overrides,
      references: this.references,
      coverage: this.coverage,
      batch: {
        computed: new Map(),
        inherited: new Map(),
        scopeIds: new Map(),
        scopes: {},
        scopeCount: 0,
      },
    };
  }
}

// ============================================================================
// Reporting
// ============================================================================

function capValue(value: string): { value: string; truncated: boolean } {
  if (value.length <= MAX_TOKEN_VALUE_LENGTH) return { value, truncated: false };
  return { value: value.slice(0, MAX_TOKEN_VALUE_LENGTH) + TRUNCATION_MARKER, truncated: true };
}

/**
 * A custom property value set from script may carry user data (an avatar URL,
 * a display name). Only a colour or a plain number/length survives; anything
 * else is redacted.
 */
function scrubScriptValue(value: string): string {
  if (normalizeColor(value)) return value;
  if (/^-?\d*\.?\d+(px|rem|em|%|vh|vw|vmin|vmax|ch|ex|ms|s|deg|fr)?$/i.test(value.trim())) {
    return value;
  }
  return REDACTED_VALUE;
}

/** The token data a response reports once (see the module doc). */
export function reportedTokensOf(index: DesignTokenIndex): ReportedTokens {
  const verdict = verdictOf(index.document.documentElement);
  const entries = Object.entries(index.rootValues);
  const tokens: Record<string, ReportedToken> = {};
  let truncatedValues = 0;
  for (const [name, raw] of entries.slice(0, MAX_REPORTED_TOKENS)) {
    const from = index.inlineRootNames.has(name) ? 'inline' : 'stylesheet';
    const scrubbed = scrubContentRequired(from === 'inline' ? scrubScriptValue(raw) : raw, verdict);
    const capped = capValue(scrubbed);
    if (capped.truncated) truncatedValues++;
    tokens[name] = {
      value: capped.value,
      ...(index.families.get(name) ?? { families: [], familyFrom: 'none' }),
      from,
    };
  }
  const { scopes, scopeCount } = index.batch;
  return {
    tokens,
    tokenCount: entries.length,
    truncatedValues,
    scopes,
    scopeCount,
    tokenCoverage: index.coverage,
  };
}

/** No token data (custom properties not read, or no document). */
export function noReportedTokens(): ReportedTokens {
  return {
    tokens: {},
    tokenCount: 0,
    truncatedValues: 0,
    scopes: {},
    scopeCount: 0,
    tokenCoverage: emptyCoverage(),
  };
}

// ============================================================================
// Per element
// ============================================================================

function computedOf(index: DesignTokenIndex, el: Element): CSSStyleDeclaration {
  let computed = index.batch.computed.get(el);
  if (!computed) {
    computed = window.getComputedStyle(el);
    index.batch.computed.set(el, computed);
  }
  return computed;
}

const KEBAB = Object.fromEntries(
  TOKEN_ATTRIBUTED_PROPERTIES.map((p) => [p, p.replace(/([A-Z])/g, '-$1').toLowerCase()])
) as Record<TokenAttributedProperty, string>;

function describe(el: Element): string {
  let text = el.tagName.toLowerCase();
  if (el.id) text += `#${el.id}`;
  for (const cls of Array.from(el.classList).slice(0, 3)) text += `.${cls}`;
  for (const attr of ['data-theme', 'data-mode', 'data-color-scheme']) {
    const value = el.getAttribute(attr);
    if (value !== null) text += `[${attr}="${value.slice(0, 40)}"]`;
  }
  return text;
}

/** The custom properties `el` itself re-declares (by rule or inline). */
function declaredOn(index: DesignTokenIndex, el: Element): string[] {
  const names = new Set(index.overrides.get(el) ?? []);
  const inline = (el as HTMLElement).style;
  if (inline) {
    for (let i = 0; i < inline.length; i++) if (inline[i].startsWith('--')) names.add(inline[i]);
  }
  return [...names];
}

/** The scope id of an ancestor that re-declares tokens, registering it on first sight. */
function scopeIdOf(index: DesignTokenIndex, el: Element): string | null {
  const state = index.batch;
  if (state.scopeIds.has(el)) return state.scopeIds.get(el) ?? null;
  const names = declaredOn(index, el);
  if (names.length === 0) {
    state.scopeIds.set(el, null);
    return null;
  }
  state.scopeCount++;
  if (Object.keys(state.scopes).length >= MAX_REPORTED_SCOPES) {
    state.scopeIds.set(el, null);
    return null;
  }
  const id = `scope-${state.scopeCount}`;
  const computed = computedOf(index, el);
  const verdict = verdictOf(el as HTMLElement);
  const inline = new Set<string>();
  const style = (el as HTMLElement).style;
  if (style) for (let i = 0; i < style.length; i++) inline.add(style[i]);
  const overrides: Record<string, string> = {};
  for (const name of names.slice(0, MAX_SCOPE_OVERRIDES)) {
    const raw = computed.getPropertyValue(name).trim();
    const value = inline.has(name) ? scrubScriptValue(raw) : raw;
    overrides[name] = capValue(scrubContentRequired(value, verdict)).value;
  }
  state.scopes[id] = { element: describe(el), overrides };
  state.scopeIds.set(el, id);
  return id;
}

/** The scopes `el` sits in, outermost first (ancestors below the root that re-declare tokens). */
export function tokenScopesOf(el: HTMLElement, index: DesignTokenIndex): string[] {
  const root = index.document.documentElement;
  const ids: string[] = [];
  for (let node = el.parentElement; node && node !== root; node = node.parentElement) {
    const id = scopeIdOf(index, node);
    if (id) ids.unshift(id);
  }
  return ids;
}

/** The value a token resolves to on `el` (its root value where the engine does not inherit). */
function resolvedToken(index: DesignTokenIndex, el: Element, name: string): string {
  return computedOf(index, el).getPropertyValue(name).trim() || index.rootValues[name] || '';
}

function sameValue(
  index: DesignTokenIndex,
  el: Element,
  prop: TokenAttributedProperty,
  computedValue: string,
  tokenValue: string
): boolean {
  if (!tokenValue) return false;
  const context = {
    rootFontPx: index.rootFontPx,
    fontPx: parseFloat(computedOf(index, el).fontSize) || undefined,
    lineHeight: prop === 'lineHeight',
  };
  const a = new Set(normalizedForms(computedValue, context));
  return normalizedForms(tokenValue, context).some((form) => a.has(form));
}

/** How `el`'s own reference for `prop` holds up against its computed value. */
function verify(
  index: DesignTokenIndex,
  el: Element,
  prop: TokenAttributedProperty,
  ref: TokenReference,
  value: string
): 'derived' | 'expression' | 'overridden' | 'dropped' {
  // An engine that does not substitute var() leaves it in the computed value.
  if (VAR_PATTERN.test(value)) return 'derived';
  if (ref.ambiguous && prop === 'backgroundColor') {
    // A gradient or image token written in `background` is not the colour,
    // however the shorthand around it is written.
    const tokenValue = index.rootValues[ref.names[0]] ?? '';
    if (NON_COLOR_FUNCTIONS.test(tokenValue)) return 'dropped';
  }
  if (!ref.bare) return 'expression';
  if (sameValue(index, el, prop, value, resolvedToken(index, el, ref.names[0]))) return 'derived';
  // A shorthand (`font`, `background`) may not have written this property at all.
  return ref.ambiguous ? 'dropped' : 'overridden';
}

/**
 * The derivation an inherited property's value takes from `el`'s ancestors:
 * the nearest ancestor (or `el`) that declares it with a reference that holds
 * up, provided the value is unchanged down the chain. Cached per batch.
 */
function inheritedDerivation(
  index: DesignTokenIndex,
  el: Element,
  prop: TokenAttributedProperty,
  depth: number
): InheritedDerivation | null {
  let perElement = index.batch.inherited.get(el);
  if (!perElement) index.batch.inherited.set(el, (perElement = new Map()));
  if (perElement.has(prop)) return perElement.get(prop) ?? null;
  let result: InheritedDerivation | null = null;
  const value = computedOf(index, el).getPropertyValue(KEBAB[prop]);
  const ref = index.references.get(el)?.get(prop);
  if (ref) {
    const verdict = verify(index, el, prop, ref, value);
    if (verdict === 'derived' || verdict === 'expression') {
      result = { names: ref.names, expression: verdict === 'expression' };
    }
  } else if (depth < MAX_INHERITANCE_DEPTH && el.parentElement) {
    const parent = el.parentElement;
    if (computedOf(index, parent).getPropertyValue(KEBAB[prop]) === value) {
      result = inheritedDerivation(index, parent, prop, depth + 1);
    }
  }
  perElement.set(prop, result);
  return result;
}

/** `el`'s token attribution for its computed `styles` (see the module doc). */
export function tokenMatchesOf(
  el: HTMLElement,
  styles: ExtendedComputedStyles,
  index: DesignTokenIndex
): TokenMatches {
  const result: TokenMatches = {};
  const ruleRefs = index.references.get(el);
  const inlineRefs = referencesOf(el.style);
  const parent = el.parentElement;
  const fontPx = parseFloat(styles.fontSize) || undefined;
  for (const prop of TOKEN_ATTRIBUTED_PROPERTIES) {
    const value = styles[prop] ?? '';
    const ref = inlineRefs?.get(prop) ?? ruleRefs?.get(prop);
    const entry: TokenAttribution = {};
    let inheritedUnchanged = false;
    if (ref) {
      const verdict = verify(index, el, prop, ref, value);
      if (verdict === 'derived') entry.derived = ref.names;
      else if (verdict === 'expression') {
        entry.derived = ref.names;
        entry.expression = true;
      } else if (verdict === 'overridden') entry.overridden = ref.names;
    } else if (INHERITED_PROPERTIES.has(prop) && parent) {
      inheritedUnchanged = computedOf(index, parent).getPropertyValue(KEBAB[prop]) === value;
      if (inheritedUnchanged) {
        const derivation = inheritedDerivation(index, parent, prop, 1);
        if (derivation) {
          entry.derived = derivation.names;
          entry.via = 'inherited';
          if (derivation.expression) entry.expression = true;
        } else {
          entry.inherited = true;
        }
      }
    }
    // A value inherited unchanged is not a choice made here: no value matches.
    if (
      !entry.derived &&
      !inheritedUnchanged &&
      !TRIVIAL_VALUES.has(value.trim()) &&
      !VAR_PATTERN.test(value)
    ) {
      const family = PROPERTY_FAMILY[prop];
      const matches = new Set<string>();
      const context = { rootFontPx: index.rootFontPx, fontPx, lineHeight: prop === 'lineHeight' };
      for (const form of normalizedForms(value, context)) {
        for (const name of index.byValue.get(form) ?? []) {
          if (index.families.get(name)?.families.includes(family)) matches.add(name);
        }
      }
      if (prop === 'lineHeight' && fontPx) {
        // A unitless line-height token compares through the element's font size.
        for (const [name, tokenValue] of Object.entries(index.rootValues)) {
          if (
            /^[\d.]+$/.test(tokenValue) &&
            index.families.get(name)?.families.includes('line-height') &&
            normalizedForms(tokenValue, context).includes(value.trim())
          ) {
            matches.add(name);
          }
        }
      }
      if (matches.size > 0) {
        const all = [...matches];
        entry.matches = all.slice(0, MAX_MATCHES);
        if (all.length > MAX_MATCHES) entry.matchCount = all.length;
      }
    }
    if (Object.keys(entry).length > 0) result[prop] = entry;
  }
  return result;
}
