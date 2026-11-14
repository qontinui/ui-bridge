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
 *   characters. A custom property set INLINE (often from script, so possibly
 *   from user data) keeps its value only when it is a colour, a length, or a
 *   short number (`scrubScriptValue`); anything else is redacted.
 * - **Scopes** (`scopes`, per element `tokenScopes`): an ancestor below the
 *   root that re-declares tokens to a value different from its parent's (a
 *   theme wrapper) is reported once, with those values; each element names the
 *   scopes it sits in. A blanket declaration that changes nothing (Tailwind's
 *   `*, ::before, ::after { --tw-…: … }`) makes no scope.
 * - **Attribution** (`tokenMatchesOf` → `tokenMatches`), per design property
 *   in `TOKEN_ATTRIBUTED_PROPERTIES`. Every declaration that applies to the
 *   element (its inline style, every matching rule) and writes the property
 *   with `var()` is a candidate. Each is resolved the way the browser would:
 *   its `var()`s are substituted with the tokens' values on the element and
 *   the declaration is computed on a hidden probe in the element's font and
 *   colour context (`TokenProbe`), then compared with the element's computed
 *   longhands.
 *   - `derived` — a candidate computes to the element's value: the token is in
 *     effect. Shorthands are expanded per side and logical properties map to
 *     physical ones (horizontal LTR writing mode assumed). `expression: true`
 *     marks a reference inside `calc()` or another function; `via:
 *     'inherited'` marks an inherited property (colour, font, line height,
 *     letter spacing) whose value came unchanged from the nearest ancestor
 *     declaring it, which declared it with `var()`.
 *   - `overridden` — candidates exist, none computes to the element's value,
 *     and they are comparable (same kind of value): they lost the cascade, or
 *     a `var()` fallback applied.
 *   - `unverified` — a candidate exists but could not be compared (a
 *     percentage on a box without layout, a token that does not resolve).
 *   - `matches` — no candidate; the computed value equals the root value of a
 *     token of a compatible family. Equality can be coincidence. At most
 *     `MAX_MATCHES` names; `matchCount` counts them all.
 *   - `inherited: true` — an inherited property whose value equals the
 *     parent's and that no ancestor derives from a token: not a choice made on
 *     this element.
 *   Trivial values (`0px`, `none`, `normal`, `auto`, transparent) are never
 *   matched. A property with nothing to report is absent.
 *
 * A token batch holds a probe in the document while it runs: call
 * `disposeTokenIndex` when the batch is read.
 */

import type { ExtendedComputedStyles, TokenAttribution, TokenMatches } from '../core/types';
import { REDACTED_VALUE, scrubContentRequired, verdictOf } from '../core/redaction';
import { normalizeColor } from './css-color';
import { emptyCoverage, type StylesheetCoverage } from './stylesheet-walk';
import { TokenProbe, type ProbeContext } from './token-probe';

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
/** The most overrides one scope lists; its `overrideCount` counts them all. */
export const MAX_SCOPE_OVERRIDES = 500;
/** The most bytes (of JSON text, about) all scopes together may take; `scopeBudgetExceeded` says when hit. */
export const MAX_SCOPE_BYTES = 256 * 1024;
/** The most `matches` names per property; `matchCount` counts them all. */
export const MAX_MATCHES = 8;
/** How far up an inherited property's derivation is followed. */
export const MAX_INHERITANCE_DEPTH = 32;

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
  /** The scope element, described (`div#app.theme-dark[data-theme="dark"]`; the tag alone when redacted). */
  element: string;
  /** The tokens it sets to a value different from its parent's, with their values in it. */
  overrides: Record<string, string>;
  /** How many tokens it changes (more than `overrides` holds when it was cut). */
  overrideCount: number;
}

/** The token data a design response carries once (see the module doc). */
export interface ReportedTokens {
  tokens: Record<string, ReportedToken>;
  /** How many tokens the page declares (more than `tokens` holds when it was cut). */
  tokenCount: number;
  /** How many reported values (tokens and scope overrides) were cut at `MAX_TOKEN_VALUE_LENGTH`. */
  truncatedValues: number;
  /** Scopes the batch's elements sit in, by id (`tokenScopes` on each element). */
  scopes: Record<string, TokenScope>;
  /** How many scopes the batch's elements sit in (more than `scopes` holds when it was cut). */
  scopeCount: number;
  /** `true` when scopes were left out because they reached `MAX_SCOPE_BYTES`. */
  scopeBudgetExceeded: boolean;
  /** What the stylesheet walk read and skipped: a missing `derived` may be a skipped rule. */
  tokenCoverage: StylesheetCoverage;
}

/** One declaration that writes an attributed property with `var()`. */
export interface TokenReference {
  /** The tokens it references. */
  names: string[];
  /** The property declared (`padding`, `border-top-color`, …). */
  source: string;
  /** Its declared text. */
  text: string;
  /** The computed longhands it is compared on (`padding-left`, …). */
  compare: readonly string[];
  /** The declared text is more than one bare `var()` (`calc(var(--x) * 4)`, `var(--a) var(--b)`). */
  expression: boolean;
  /** A shorthand that may not have written this property (`font`, `background`). */
  ambiguous: boolean;
}

/** Per attributed property, the candidate references a declaration block makes. */
export type ReferenceMap = Map<TokenAttributedProperty, TokenReference[]>;

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
  /** Line-height tokens whose value is a bare number, with that number. */
  readonly unitlessLineHeights: ReadonlyArray<readonly [string, number]>;
  /**
   * Whether this engine inherits custom properties (every browser does). When
   * it does not, a token's value on an element falls back to the root's.
   */
  readonly inheritsCustomProperties: boolean;
  /** Non-root elements whose matching rules declare custom properties. */
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
  scopeBytes: number;
  scopeBudgetExceeded: boolean;
  truncatedScopeValues: number;
  probe: TokenProbe;
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

type Side = 'Top' | 'Right' | 'Bottom' | 'Left';
const SIDES: readonly Side[] = ['Top', 'Right', 'Bottom', 'Left'];

/**
 * For one side of a box property, the declaration in effect in this block:
 * the most specific non-empty source of the physical longhand, the logical
 * longhand, the logical shorthand and the box shorthand. A browser leaves a
 * longhand empty when its shorthand was written with `var()`.
 */
function boxSideSource(
  style: CSSStyleDeclaration,
  box: 'padding' | 'margin',
  side: Side
): { source: string; text: string; part: string } | null {
  const longhand = `${box}-${side.toLowerCase()}`;
  const axis = side === 'Top' || side === 'Bottom' ? 'block' : 'inline';
  const end = side === 'Top' || side === 'Left' ? 'start' : 'end';
  for (const source of [longhand, `${box}-${axis}-${end}`]) {
    const text = style.getPropertyValue(source);
    if (text) return { source, text, part: text };
  }
  const pairText = style.getPropertyValue(`${box}-${axis}`);
  if (pairText) {
    const p = splitTopLevel(pairText);
    const part = end === 'start' ? p[0] : (p[1] ?? p[0]);
    return { source: `${box}-${axis}`, text: pairText, part: part ?? '' };
  }
  const boxText = style.getPropertyValue(box);
  const sides = boxText ? boxSides(boxText) : null;
  return sides ? { source: box, text: boxText, part: sides[SIDES.indexOf(side)] } : null;
}

const CORNERS = [
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-right-radius',
  'border-bottom-left-radius',
];
const SIDE_BORDER = (side: string): string[] => [
  `border-${side}-width`,
  `border-${side}-style`,
  `border-${side}-color`,
];

/**
 * The declarations that write a whole-valued attributed property, each with
 * the computed longhands it is compared on.
 */
const WHOLE_SOURCES: Partial<Record<TokenAttributedProperty, ReadonlyArray<[string, string[]]>>> = {
  color: [['color', ['color']]],
  fontFamily: [['font-family', ['font-family']]],
  fontSize: [['font-size', ['font-size']]],
  fontWeight: [['font-weight', ['font-weight']]],
  lineHeight: [['line-height', ['line-height']]],
  letterSpacing: [['letter-spacing', ['letter-spacing']]],
  gap: [
    ['gap', ['row-gap', 'column-gap']],
    ['row-gap', ['row-gap']],
    ['column-gap', ['column-gap']],
  ],
  borderRadius: [
    ['border-radius', CORNERS],
    ...CORNERS.map((c): [string, string[]] => [c, [c]]),
    ['border-start-start-radius', ['border-top-left-radius']],
    ['border-start-end-radius', ['border-top-right-radius']],
    ['border-end-start-radius', ['border-bottom-left-radius']],
    ['border-end-end-radius', ['border-bottom-right-radius']],
  ],
  boxShadow: [['box-shadow', ['box-shadow']]],
  border: [
    ['border', SIDE_BORDER('top')],
    ['border-color', ['border-top-color']],
    ['border-width', ['border-top-width']],
    ...['top', 'right', 'bottom', 'left'].flatMap(
      (side): Array<[string, string[]]> => [
        [`border-${side}`, SIDE_BORDER(side)],
        [`border-${side}-color`, [`border-${side}-color`]],
        [`border-${side}-width`, [`border-${side}-width`]],
      ]
    ),
    ['border-inline', SIDE_BORDER('left')],
    ['border-block', SIDE_BORDER('top')],
    ['border-inline-color', ['border-left-color']],
    ['border-block-color', ['border-top-color']],
  ],
  outline: [
    ['outline', ['outline-width', 'outline-style', 'outline-color']],
    ['outline-color', ['outline-color']],
    ['outline-width', ['outline-width']],
  ],
};

const KEBAB = Object.fromEntries(
  TOKEN_ATTRIBUTED_PROPERTIES.map((p) => [p, p.replace(/([A-Z])/g, '-$1').toLowerCase()])
) as Record<TokenAttributedProperty, string>;

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
 * Every `var()` reference one declaration block (a rule's, or an element's
 * inline style) makes, per attributed property; `null` when it makes none.
 */
export function referencesOf(style: CSSStyleDeclaration): ReferenceMap | null {
  if (!VAR_PATTERN.test(style.cssText)) return null;
  const refs: ReferenceMap = new Map();
  const add = (prop: TokenAttributedProperty, ref: TokenReference): void => {
    const list = refs.get(prop);
    if (list) list.push(ref);
    else refs.set(prop, [ref]);
  };
  for (const box of ['padding', 'margin'] as const) {
    for (const side of SIDES) {
      const found = boxSideSource(style, box, side);
      if (!found || !VAR_PATTERN.test(found.part)) continue;
      add(`${box}${side}` as TokenAttributedProperty, {
        names: varNames(found.part),
        source: found.source,
        text: found.text,
        compare: [`${box}-${side.toLowerCase()}`],
        expression: !isBareVar(found.part),
        ambiguous: false,
      });
    }
  }
  for (const [prop, sources] of Object.entries(WHOLE_SOURCES) as Array<
    [TokenAttributedProperty, ReadonlyArray<[string, string[]]>]
  >) {
    for (const [source, compare] of sources) {
      const text = style.getPropertyValue(source);
      if (!VAR_PATTERN.test(text)) continue;
      add(prop, {
        names: varNames(text),
        source,
        text,
        compare,
        expression: !isBareVar(text),
        ambiguous: false,
      });
    }
  }
  const bgColor = style.getPropertyValue('background-color');
  if (VAR_PATTERN.test(bgColor)) {
    add('backgroundColor', {
      names: varNames(bgColor),
      source: 'background-color',
      text: bgColor,
      compare: ['background-color'],
      expression: !isBareVar(bgColor),
      ambiguous: false,
    });
  }
  const background = style.getPropertyValue('background');
  const bgNames = backgroundColorNames(background);
  if (bgNames.length > 0) {
    add('backgroundColor', {
      names: bgNames,
      source: 'background',
      text: background,
      compare: ['background-color'],
      expression: !isBareVar(background),
      ambiguous: true,
    });
  }
  const font = style.getPropertyValue('font');
  if (VAR_PATTERN.test(font)) {
    // Each longhand is compared on its own after the probe computes the
    // whole shorthand, so a multi-var font is attributed per longhand.
    for (const prop of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight'] as const) {
      add(prop, {
        names: varNames(font),
        source: 'font',
        text: font,
        compare: [KEBAB[prop]],
        expression: !isBareVar(font),
        ambiguous: true,
      });
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
 * size; px with float noise removed and a bare `0` as `0px`; and, for a line
 * height, a unitless number in px against the element's font size.
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
  if (lower === '0') forms.add('0px');
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

/** The kind of a computed value, for telling "differs" from "not comparable". */
function valueKind(value: string): 'length' | 'number' | 'color' | 'percent' | 'other' {
  const v = value.trim().toLowerCase();
  if (/^-?[\d.]+px$/.test(v) || v === '0') return 'length';
  if (/^-?[\d.]+$/.test(v)) return 'number';
  if (/%$/.test(v)) return 'percent';
  if (normalizeColor(v)) return 'color';
  return 'other';
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
      for (const [prop, list] of refs) {
        for (const ref of list) {
          if (ref.ambiguous) continue;
          for (const name of ref.names) {
            let set = this.usage.get(name);
            if (!set) this.usage.set(name, (set = new Set()));
            set.add(PROPERTY_FAMILY[prop]);
          }
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
        // Every candidate is kept: which one won the cascade is settled by
        // comparing each with the computed value.
        for (const [prop, list] of refs) {
          const existing = map.get(prop);
          if (existing) existing.push(...list);
          else map.set(prop, [...list]);
        }
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
    let inheritsCustomProperties = true;
    if (root) {
      for (let i = 0; i < root.style.length; i++) {
        if (root.style[i].startsWith('--')) {
          inlineRootNames.add(root.style[i]);
          this.names.add(root.style[i]);
        }
      }
      // An inline root reference (`<html style="color: var(--x)">`) counts as usage.
      const inlineRefs = referencesOf(root.style);
      if (inlineRefs) this.addRule([], inlineRefs, [root]);
      const view = doc.defaultView ?? window;
      const computed = view.getComputedStyle(root);
      rootFontPx = parseFloat(computed.fontSize) || 16;
      for (const name of this.names) {
        const value = computed.getPropertyValue(name).trim();
        if (value) rootValues[name] = value;
      }
      // Every browser inherits custom properties; an engine that does not
      // (jsdom) shows the root's tokens as empty on its first child.
      const child = root.firstElementChild;
      const sample = Object.keys(rootValues).find(
        (name) => !this.overrides.get(child as Element)?.includes(name)
      );
      if (child && sample) {
        inheritsCustomProperties =
          view.getComputedStyle(child).getPropertyValue(sample).trim() !== '';
      }
    }
    const families = decideFamilies(this.names, this.usage, rootValues);
    const unitlessLineHeights: Array<readonly [string, number]> = [];
    for (const [name, value] of Object.entries(rootValues)) {
      for (const form of normalizedForms(value, { rootFontPx })) {
        const list = byValue.get(form);
        if (list) list.push(name);
        else byValue.set(form, [name]);
      }
      if (/^[\d.]+$/.test(value) && families.get(name)?.families.includes('line-height')) {
        unitlessLineHeights.push([name, Number(value)]);
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
      unitlessLineHeights,
      inheritsCustomProperties,
      overrides: this.overrides,
      references: this.references,
      coverage: this.coverage,
      batch: {
        computed: new Map(),
        inherited: new Map(),
        scopeIds: new Map(),
        scopes: {},
        scopeCount: 0,
        scopeBytes: 0,
        scopeBudgetExceeded: false,
        truncatedScopeValues: 0,
        probe: new TokenProbe(doc),
      },
    };
  }
}

/** Release what a batch holds in the document (its probe). Safe to call more than once. */
export function disposeTokenIndex(index: DesignTokenIndex): void {
  index.batch.probe.dispose();
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
 * a display name, an id). Only a colour, a length or other dimension, or a
 * number of at most four digits (an opacity, a z-index, a ratio) survives;
 * anything else is redacted.
 */
export function scrubScriptValue(value: string): string {
  const v = value.trim();
  if (normalizeColor(v)) return value;
  if (/^-?\d*\.?\d+(px|rem|em|%|vh|vw|vmin|vmax|ch|ex|ms|s|deg|fr)$/i.test(v)) return value;
  if (/^-?\d*\.?\d+$/.test(v) && v.replace(/[^\d]/g, '').length <= 4) return value;
  return REDACTED_VALUE;
}

/** The token data a response reports once (see the module doc). */
export function reportedTokensOf(index: DesignTokenIndex): ReportedTokens {
  const verdict = verdictOf(index.document.documentElement);
  const entries = Object.entries(index.rootValues);
  const tokens: Record<string, ReportedToken> = {};
  let truncatedValues = index.batch.truncatedScopeValues;
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
  const { scopes, scopeCount, scopeBudgetExceeded } = index.batch;
  return {
    tokens,
    tokenCount: entries.length,
    truncatedValues,
    scopes,
    scopeCount,
    scopeBudgetExceeded,
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
    scopeBudgetExceeded: false,
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

function describe(el: Element): string {
  let text = el.tagName.toLowerCase();
  // A content-redacted scope is named by its tag alone.
  if (verdictOf(el as HTMLElement).content) return text;
  if (el.id) text += `#${el.id}`;
  for (const cls of Array.from(el.classList).slice(0, 3)) text += `.${cls}`;
  for (const attr of ['data-theme', 'data-mode', 'data-color-scheme']) {
    const value = el.getAttribute(attr);
    if (value !== null) text += `[${attr}="${value.slice(0, 40)}"]`;
  }
  return text;
}

/** The value a token resolves to on `el` (its root value on an engine that does not inherit them). */
function resolvedToken(index: DesignTokenIndex, el: Element, name: string): string {
  const value = computedOf(index, el).getPropertyValue(name).trim();
  if (value || index.inheritsCustomProperties) return value;
  return index.rootValues[name] ?? '';
}

/** The custom properties `el` sets (by rule or inline) to a value different from its parent's. */
function changedOn(index: DesignTokenIndex, el: Element): Array<{ name: string; inline: boolean }> {
  const declared = new Map<string, boolean>();
  for (const name of index.overrides.get(el) ?? []) declared.set(name, false);
  const inline = (el as HTMLElement).style;
  if (inline) {
    for (let i = 0; i < inline.length; i++)
      if (inline[i].startsWith('--')) declared.set(inline[i], true);
  }
  const parent = el.parentElement;
  const changed: Array<{ name: string; inline: boolean }> = [];
  for (const [name, isInline] of declared) {
    const here = resolvedToken(index, el, name);
    const above = parent ? resolvedToken(index, parent, name) : '';
    if (here !== above) changed.push({ name, inline: isInline });
  }
  return changed;
}

/** The scope id of an ancestor that changes tokens, registering it on first sight. */
function scopeIdOf(index: DesignTokenIndex, el: Element): string | null {
  const state = index.batch;
  if (state.scopeIds.has(el)) return state.scopeIds.get(el) ?? null;
  const changed = changedOn(index, el);
  if (changed.length === 0) {
    state.scopeIds.set(el, null);
    return null;
  }
  state.scopeCount++;
  if (Object.keys(state.scopes).length >= MAX_REPORTED_SCOPES || state.scopeBudgetExceeded) {
    state.scopeIds.set(el, null);
    return null;
  }
  const verdict = verdictOf(el as HTMLElement);
  const overrides: Record<string, string> = {};
  let truncated = 0;
  for (const { name, inline } of changed.slice(0, MAX_SCOPE_OVERRIDES)) {
    const raw = resolvedToken(index, el, name);
    const capped = capValue(scrubContentRequired(inline ? scrubScriptValue(raw) : raw, verdict));
    if (capped.truncated) truncated++;
    overrides[name] = capped.value;
  }
  const scope: TokenScope = { element: describe(el), overrides, overrideCount: changed.length };
  const bytes = JSON.stringify(scope).length;
  if (state.scopeBytes + bytes > MAX_SCOPE_BYTES) {
    state.scopeBudgetExceeded = true;
    state.scopeIds.set(el, null);
    return null;
  }
  state.scopeBytes += bytes;
  state.truncatedScopeValues += truncated;
  const id = `scope-${state.scopeCount}`;
  state.scopes[id] = scope;
  state.scopeIds.set(el, id);
  return id;
}

/** The scopes `el` sits in, outermost first (ancestors below the root that change tokens). */
export function tokenScopesOf(el: HTMLElement, index: DesignTokenIndex): string[] {
  const root = index.document.documentElement;
  const ids: string[] = [];
  for (let node = el.parentElement; node && node !== root; node = node.parentElement) {
    const id = scopeIdOf(index, node);
    if (id) ids.unshift(id);
  }
  return ids;
}

/** Substitute every `var()` in `text` with the token's value on `el`; `null` when one does not resolve. */
function substitute(index: DesignTokenIndex, el: Element, text: string): string | null {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf('var(', i);
    if (start < 0) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, start);
    let depth = 0;
    let end = start;
    for (; end < text.length; end++) {
      if (text[end] === '(') depth++;
      else if (text[end] === ')' && --depth === 0) break;
    }
    const body = text.slice(start + 4, end);
    const comma = body.indexOf(',');
    const name = (comma < 0 ? body : body.slice(0, comma)).trim();
    let value = resolvedToken(index, el, name);
    if (!value && comma >= 0) value = substitute(index, el, body.slice(comma + 1).trim()) ?? '';
    if (!value) return null;
    out += value;
    i = end + 1;
  }
  return out;
}

function probeContext(index: DesignTokenIndex, el: Element): ProbeContext {
  const own = computedOf(index, el);
  const parent = el.parentElement ? computedOf(index, el.parentElement) : own;
  return {
    parentFontSize: parent.getPropertyValue('font-size') || `${index.rootFontPx}px`,
    fontSize: own.getPropertyValue('font-size') || `${index.rootFontPx}px`,
    parentColor: parent.getPropertyValue('color'),
    color: own.getPropertyValue('color'),
  };
}

type Verdict = 'derived' | 'overridden' | 'unverified' | 'dropped';

function equalValues(index: DesignTokenIndex, a: string, b: string, fontPx?: number): boolean {
  if (a === b) return true;
  const context = { rootFontPx: index.rootFontPx, fontPx, lineHeight: true };
  const forms = new Set(normalizedForms(a, context));
  return normalizedForms(b, context).some((f) => forms.has(f));
}

/** How one candidate reference holds up against `el`'s computed value. */
function verify(index: DesignTokenIndex, el: Element, ref: TokenReference): Verdict {
  const computed = computedOf(index, el);
  const actual = ref.compare.map((l) => computed.getPropertyValue(l).trim());
  // An engine that does not substitute var() (jsdom) leaves it in the
  // computed value. A browser never does, so this cannot apply there.
  if (actual.some((v) => VAR_PATTERN.test(v))) return 'derived';
  if (ref.source === 'background') {
    // A gradient or image token written in `background` is not the colour.
    if (ref.names.some((n) => NON_COLOR_FUNCTIONS.test(resolvedToken(index, el, n))))
      return 'dropped';
  }
  const text = substitute(index, el, ref.text);
  if (text === null) return 'unverified';
  const probed = index.batch.probe.resolve(ref.source, text, ref.compare, probeContext(index, el));
  if (!probed || probed.some((v) => v === '' || VAR_PATTERN.test(v))) return 'unverified';
  const fontPx = parseFloat(computed.getPropertyValue('font-size')) || undefined;
  const equal = probed.every((v, i) => equalValues(index, v, actual[i], fontPx));
  if (equal) {
    // A shorthand that leaves this longhand at its initial value says nothing about it.
    if (ref.ambiguous && actual.every((v) => TRIVIAL_VALUES.has(v))) return 'dropped';
    return 'derived';
  }
  const comparable = probed.every(
    (v, i) => valueKind(v) === valueKind(actual[i]) && valueKind(v) !== 'other'
  );
  if (!comparable) return 'unverified';
  // A shorthand (`font`, `background`) may not have written this property at all.
  return ref.ambiguous ? 'dropped' : 'overridden';
}

/** The candidates for `prop` on `el`: its inline declaration first, then its matching rules'. */
function candidatesOf(
  index: DesignTokenIndex,
  el: Element,
  prop: TokenAttributedProperty,
  inline: ReferenceMap | null
): TokenReference[] {
  return [...(inline?.get(prop) ?? []), ...(index.references.get(el)?.get(prop) ?? [])];
}

interface Settled {
  verdict: Exclude<Verdict, 'dropped'> | null;
  ref?: TokenReference;
  names: string[];
}

/** Settle a property's candidates: the first `derived` one wins; else `unverified`, else `overridden`. */
/**
 * The tokens a derived multi-`var()` shorthand owes this longhand to: those
 * whose value, written as the longhand alone, computes to the element's
 * value (`font: var(--weight) var(--size)/1.5 var(--family)` gives the
 * font-size `--size`). All of its tokens when none can be singled out.
 */
function derivedNames(index: DesignTokenIndex, el: Element, ref: TokenReference): string[] {
  if (ref.names.length < 2 || ref.compare.length !== 1) return ref.names;
  const longhand = ref.compare[0];
  const actual = computedOf(index, el).getPropertyValue(longhand).trim();
  const fontPx = parseFloat(computedOf(index, el).getPropertyValue('font-size')) || undefined;
  const context = probeContext(index, el);
  const own = ref.names.filter((name) => {
    const value = resolvedToken(index, el, name);
    const probed = value ? index.batch.probe.resolve(longhand, value, [longhand], context) : null;
    return probed !== null && probed[0] !== '' && equalValues(index, probed[0], actual, fontPx);
  });
  return own.length > 0 ? own : ref.names;
}

function settle(index: DesignTokenIndex, el: Element, candidates: TokenReference[]): Settled {
  const overridden: string[] = [];
  const unverified: string[] = [];
  for (const ref of candidates) {
    const verdict = verify(index, el, ref);
    if (verdict === 'derived') return { verdict, ref, names: derivedNames(index, el, ref) };
    if (verdict === 'unverified') unverified.push(...ref.names);
    if (verdict === 'overridden') overridden.push(...ref.names);
  }
  if (unverified.length > 0) return { verdict: 'unverified', names: [...new Set(unverified)] };
  if (overridden.length > 0) return { verdict: 'overridden', names: [...new Set(overridden)] };
  return { verdict: null, names: [] };
}

/**
 * The derivation an inherited property's value takes from `el` and its
 * ancestors: the nearest one that declares it (inline or by rule) with a
 * reference that holds up, provided the value is unchanged down the chain.
 * Cached per batch; a walk cut short by `MAX_INHERITANCE_DEPTH` is not cached.
 */
function inheritedDerivation(
  index: DesignTokenIndex,
  el: Element,
  prop: TokenAttributedProperty,
  depth: number
): { derivation: InheritedDerivation | null; capped: boolean } {
  let perElement = index.batch.inherited.get(el);
  if (!perElement) index.batch.inherited.set(el, (perElement = new Map()));
  if (perElement.has(prop)) return { derivation: perElement.get(prop) ?? null, capped: false };
  let derivation: InheritedDerivation | null = null;
  let capped = false;
  const style = (el as HTMLElement).style as CSSStyleDeclaration | undefined;
  const candidates = candidatesOf(index, el, prop, style ? referencesOf(style) : null);
  if (candidates.length > 0) {
    const settled = settle(index, el, candidates);
    if (settled.verdict === 'derived' && settled.ref) {
      derivation = { names: settled.names, expression: settled.ref.expression };
    }
  } else if (el.parentElement) {
    if (depth >= MAX_INHERITANCE_DEPTH) {
      capped = true;
    } else {
      const parent = el.parentElement;
      const value = computedOf(index, el).getPropertyValue(KEBAB[prop]);
      if (computedOf(index, parent).getPropertyValue(KEBAB[prop]) === value) {
        const up = inheritedDerivation(index, parent, prop, depth + 1);
        derivation = up.derivation;
        capped = up.capped;
      }
    }
  }
  if (!capped) perElement.set(prop, derivation);
  return { derivation, capped };
}

/** `el`'s token attribution for its computed `styles` (see the module doc). */
export function tokenMatchesOf(
  el: HTMLElement,
  styles: ExtendedComputedStyles,
  index: DesignTokenIndex
): TokenMatches {
  const result: TokenMatches = {};
  const inlineRefs = referencesOf(el.style);
  const parent = el.parentElement;
  const fontPx = parseFloat(styles.fontSize) || undefined;
  for (const prop of TOKEN_ATTRIBUTED_PROPERTIES) {
    const value = styles[prop] ?? '';
    const candidates = candidatesOf(index, el, prop, inlineRefs);
    const entry: TokenAttribution = {};
    let inheritedUnchanged = false;
    if (candidates.length > 0) {
      const settled = settle(index, el, candidates);
      if (settled.verdict === 'derived') {
        entry.derived = settled.names;
        if (settled.ref?.expression) entry.expression = true;
      } else if (settled.verdict === 'overridden') {
        entry.overridden = settled.names;
      } else if (settled.verdict === 'unverified') {
        entry.unverified = settled.names;
      }
    } else if (INHERITED_PROPERTIES.has(prop) && parent) {
      inheritedUnchanged = computedOf(index, parent).getPropertyValue(KEBAB[prop]) === value;
      if (inheritedUnchanged) {
        const { derivation } = inheritedDerivation(index, parent, prop, 1);
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
    // Matches are reported for a value no declaration claims to derive.
    if (
      candidates.length === 0 &&
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
        for (const [name, n] of index.unitlessLineHeights) {
          if (px(n * fontPx) === value.trim()) matches.add(name);
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
