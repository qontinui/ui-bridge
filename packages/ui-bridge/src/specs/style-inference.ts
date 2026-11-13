/**
 * Style inference — a draft style guide and a token-drift report derived from
 * an app's own computed styles.
 *
 * `/design/audit` checks rendered styles against a `StyleGuideConfig`; nothing
 * produced one. This module aggregates the computed styles the design routes
 * already read (`getElementDesignData`) into a per-category inventory —
 * colours, font families/sizes/weights/line heights/letter spacing, spacing,
 * radii, shadows, borders — and from it:
 *
 * - a draft `StyleGuideConfig` (`inferStyleGuideFromInventory`) loadable as-is
 *   through `/design/style-guide/load`, and
 * - a drift report against a declared token set (`computeTokenDrift`).
 *
 * Rules this module holds to (plan
 * 2026-11-13-ui-bridge-infers-a-draft-style-guide-and-token-drift-from-computed-styles):
 *
 * - **Deterministic.** Values are ranked by element count, then occurrence
 *   count, then the canonical value's string order, and named by that ordinal
 *   (`color-1`, `space-3`). No semantic name is ever guessed.
 * - **Truncation is reported, never silent.** Every category reports
 *   `{ distinct, kept, dropped, droppedOccurrences }`, `dropped: 0` included.
 *   Drift runs on the uncapped inventory, so a cap never turns a value into
 *   "undeclared" or a token into "unused".
 * - **Defaults are excluded and counted** (transparent backgrounds, zero
 *   spacing, `normal` line height, `none` shadows) — they would top every
 *   ranking and say nothing about the design.
 * - **Empty is UNKNOWN.** Inference over no samples answers `status: 'empty'`
 *   with a reason and no guide; drift with nothing to compare answers
 *   `verdict: 'unknown'` with a reason, never `no-drift`.
 *
 * Technique adapted (reimplemented) from INSANE0777/Awwwards-mcp
 * `export_design_tokens` (MIT).
 *
 * Pure: no DOM access. The DOM collection lives in `./style-inference-request`.
 */

import { canonicalColor, colorDistance, parseColor, toCanonicalHex } from './style-color';
import { STYLE_GUIDE_VERSION, type DesignTokens, type StyleGuideConfig } from './style-types';

// ============================================================================
// Categories
// ============================================================================

/** The inventory categories. `borders` has no `DesignTokens` slot (inventory only). */
export type StyleCategory =
  | 'colors'
  | 'fontFamilies'
  | 'fontSizes'
  | 'fontWeights'
  | 'lineHeights'
  | 'letterSpacings'
  | 'spacing'
  | 'borderRadius'
  | 'shadows'
  | 'borders';

export const STYLE_CATEGORIES: readonly StyleCategory[] = [
  'colors',
  'fontFamilies',
  'fontSizes',
  'fontWeights',
  'lineHeights',
  'letterSpacings',
  'spacing',
  'borderRadius',
  'shadows',
  'borders',
];

/** The ordinal name prefix per category: `color-1`, `space-2`, … */
export const ORDINAL_PREFIX: Readonly<Record<StyleCategory, string>> = {
  colors: 'color',
  fontFamilies: 'font-family',
  fontSizes: 'font-size',
  fontWeights: 'font-weight',
  lineHeights: 'line-height',
  letterSpacings: 'letter-spacing',
  spacing: 'space',
  borderRadius: 'radius',
  shadows: 'shadow',
  borders: 'border',
};

/** Categories the inventory reports but `DesignTokens` has no slot for. */
export const NOT_IN_GUIDE: readonly StyleCategory[] = ['borders'];
/** `DesignTokens` keys computed styles at one viewport cannot reveal. */
export const NOT_INFERABLE: readonly string[] = ['breakpoints'];

/** Default per-category cap on the inferred guide's tokens. */
export const DEFAULT_MAX_PER_CATEGORY = 24;
/** Distinct px spellings kept per font-relative entry. */
const MAX_PX_SPELLINGS = 10;
/** Matching custom-property names kept per entry. */
const MAX_MATCHING_CUSTOM_PROPERTIES = 5;

function perCategory<T>(make: (category: StyleCategory) => T): Record<StyleCategory, T> {
  const out = {} as Record<StyleCategory, T>;
  for (const c of STYLE_CATEGORIES) out[c] = make(c);
  return out;
}

// ============================================================================
// Input
// ============================================================================

/**
 * One element's computed styles. `ElementDesignData` (web) and the native
 * package's design data both satisfy it structurally.
 */
export interface StyleSample {
  elementId: string;
  styles: Partial<Record<string, string>>;
  customProperties?: Record<string, string>;
}

export interface StyleInventoryOptions {
  /** Root font size for `rem` → px (default 16). */
  rootFontSizePx?: number;
  /** Custom properties beyond the samples' own (e.g. `:root`'s). */
  customProperties?: Record<string, string>;
}

// ============================================================================
// Normalisation
// ============================================================================

const LENGTH = /^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)(px|rem|em|%)?$/i;

/** Round to 0.01 and render without trailing zeros: `13.333` → `13.33`. */
function round(n: number, places = 2): number {
  const f = Math.pow(10, places);
  const r = Math.round(n * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

export function formatPx(n: number): string {
  return `${round(n)}px`;
}

/**
 * A length in px. `rem` resolves against `rootFontSizePx`; a bare number is px
 * (React Native's unit, and CSS's `0`). `em` and `%` are not px — `null`.
 */
export function lengthToPx(value: string, rootFontSizePx = 16): number | null {
  const m = LENGTH.exec(value.trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = (m[2] ?? '').toLowerCase();
  if (unit === '' || unit === 'px') return n;
  if (unit === 'rem') return n * rootFontSizePx;
  return null;
}

/** A length in its canonical spelling: px for absolute lengths, `N%` kept as is. */
export function canonicalLength(value: string, rootFontSizePx = 16): string | null {
  const px = lengthToPx(value, rootFontSizePx);
  if (px !== null) return formatPx(px);
  const m = LENGTH.exec(value.trim());
  if (m && m[2] === '%') return `${round(parseFloat(m[1]))}%`;
  return null;
}

/** Split on whitespace and commas at paren depth 0. */
function topLevelSplit(value: string, separator: ',' | ' '): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    const isSep = separator === ',' ? ch === ',' : /\s/.test(ch);
    if (isSep && depth === 0) {
      if (current.trim() !== '') out.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim() !== '') out.push(current.trim());
  return out;
}

/** `"Inter", ui-sans-serif ,system-ui` → `inter, ui-sans-serif, system-ui`. */
export function normalizeFontFamily(value: string): string {
  return topLevelSplit(value, ',')
    .map((f) =>
      f
        .replace(/^["']|["']$/g, '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')
    )
    .filter(Boolean)
    .join(', ');
}

/** The first family of a stack. */
function primaryFamily(normalizedStack: string): string {
  return normalizedStack.split(',')[0]?.trim() ?? '';
}

/** `normal` → `400`, `bold` → `700`, numbers kept. `null` for relative keywords. */
export function normalizeFontWeight(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (v === 'normal') return '400';
  if (v === 'bold') return '700';
  if (/^\d+(\.\d+)?$/.test(v)) return String(round(parseFloat(v)));
  return null;
}

/**
 * One shadow layer in a fixed order — `[inset] x y blur spread colour` — with
 * lengths in px, a missing blur/spread as `0px` and the colour canonicalised.
 * Chrome serialises the colour first, authors usually write it last; without a
 * fixed order a declared shadow could never equal a computed one. A token this
 * cannot read is kept, lowercased, at the end.
 */
function canonicalShadowLayer(layer: string): string {
  let inset = false;
  let color: string | null = null;
  const lengths: string[] = [];
  const other: string[] = [];
  for (const token of topLevelSplit(layer, ' ')) {
    const t = token.toLowerCase();
    if (t === 'inset') inset = true;
    else if (lengthToPx(t) !== null) lengths.push(formatPx(lengthToPx(t)!));
    else if (canonicalColor(t) !== null) color = canonicalColor(t);
    else other.push(t);
  }
  while (lengths.length < 4 && lengths.length >= 2) lengths.push('0px');
  return [inset ? 'inset' : '', ...lengths, color ?? '', ...other].filter(Boolean).join(' ');
}

/** True when a shadow layer's colour is fully transparent (an invisible placeholder layer). */
function isTransparentLayer(layer: string): boolean {
  return topLevelSplit(layer, ' ').some((token) => {
    const c = canonicalColor(token);
    return c !== null && isTransparent(c);
  });
}

/**
 * A shadow list with each layer in canonical order (`canonicalShadowLayer`),
 * layers joined by `, `. Fully transparent layers — Tailwind's `rgba(0,0,0,0) 0 0 0 0`
 * placeholders — are dropped; an all-transparent list normalises to `none`.
 */
export function normalizeShadow(value: string): string {
  const layers = topLevelSplit(value, ',').filter((layer) => !isTransparentLayer(layer));
  if (layers.length === 0) return 'none';
  return layers.map((layer) => canonicalShadowLayer(layer)).join(', ');
}

/** A unitless number rendered at 3 decimals (`1.5`, `1.333`). */
function ratioString(n: number): string {
  return String(round(n, 3));
}

const BORDER_STYLES = new Set([
  'none',
  'hidden',
  'dotted',
  'dashed',
  'solid',
  'double',
  'groove',
  'ridge',
  'inset',
  'outset',
]);

/** A border/outline shorthand split into width, style and colour (any order). */
function parseBorderShorthand(value: string): {
  width: number | null;
  style: string | null;
  color: string | null;
  rawColor: string | null;
} {
  let width: number | null = null;
  let style: string | null = null;
  let color: string | null = null;
  let rawColor: string | null = null;
  for (const token of topLevelSplit(value.trim(), ' ')) {
    const t = token.toLowerCase();
    if (BORDER_STYLES.has(t)) style = t;
    else if (lengthToPx(t) !== null) width = lengthToPx(t);
    else if (t === 'thin') width = 1;
    else if (t === 'medium') width = 3;
    else if (t === 'thick') width = 5;
    else {
      rawColor = t;
      color = canonicalColor(t);
    }
  }
  return { width, style, color, rawColor };
}

/** A border's canonical spelling: `1px solid #e5e7eb`. */
function canonicalBorder(width: number, style: string, color: string): string {
  return `${formatPx(width)} ${style}${color ? ` ${color}` : ''}`;
}

/** The raw colour tokens of a shadow layer list's visible layers. */
function shadowColors(value: string): string[] {
  const out: string[] = [];
  for (const layer of topLevelSplit(value, ',')) {
    if (isTransparentLayer(layer)) continue;
    for (const token of topLevelSplit(layer, ' ')) {
      if (canonicalColor(token)) out.push(token);
    }
  }
  return out;
}

/** The alpha byte of a canonical hex colour (`ff` when it has none). */
function alphaOf(hex: string): string {
  return hex.length === 9 ? hex.slice(7) : 'ff';
}

/** True when a canonical colour is fully transparent (`#rrggbb00`). */
function isTransparent(hex: string): boolean {
  return /^#[0-9a-f]{6}00$/.test(hex);
}

// ============================================================================
// Inventory
// ============================================================================

/** One distinct value in use. */
export interface InventoryEntry {
  /** Ordinal name by frequency rank: `color-1`, `space-2`. */
  name: string;
  /** The canonical value. */
  value: string;
  /** Property instances carrying the value. */
  occurrences: number;
  /** Distinct elements carrying the value. */
  elementCount: number;
  /** The properties the value was read from, sorted. */
  properties: string[];
  /**
   * Custom properties whose resolved value canonicalises to this value — a
   * value match, not proof the element used `var()` (computed styles cannot
   * show that). Sorted, at most 5.
   */
  matchingCustomProperties: string[];
  /** False when the value could not be canonicalised and is kept verbatim. */
  normalized: boolean;
  /**
   * Colours only: present (true) when some source spelling lay outside the
   * sRGB gamut and was clamped to this hex — distinct wide-gamut colours may
   * share one entry.
   */
  outOfGamut?: true;
  /**
   * Font-relative categories (line height, letter spacing) only: the distinct
   * px values that rendered this ratio, sorted — all of them in the full
   * inventory, at most 10 in an inferred guide's inventory.
   */
  px?: string[];
}

export interface CategoryTruncation {
  /** Distinct values in use. */
  distinct: number;
  /** Values kept in the guide. */
  kept: number;
  /** Values dropped by the cap. */
  dropped: number;
  /** Property instances the dropped values accounted for. */
  droppedOccurrences: number;
}

/** The full, uncapped inventory. */
export interface StyleInventory {
  /** Ranked and ordinally named entries per category (uncapped). */
  entries: Record<StyleCategory, InventoryEntry[]>;
  /** Default values excluded from each category (transparent, 0, normal, none). */
  excludedDefaults: Record<StyleCategory, number>;
  /** Samples read. */
  sampleCount: number;
  /** Distinct custom-property names seen. */
  customPropertiesSeen: number;
  /** Values a canonical form could not be found for, per category. */
  unnormalized: Record<StyleCategory, number>;
}

interface Accumulator {
  value: string;
  occurrences: number;
  elements: Set<string>;
  properties: Set<string>;
  normalized: boolean;
  outOfGamut: boolean;
  px: Set<string>;
}

/** Index custom properties by every canonical form their value has. */
function indexCustomPropertyValues(
  all: Map<string, Set<string>>,
  rootFontSizePx: number
): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  const put = (key: string, name: string): void => {
    const set = index.get(key);
    if (set) set.add(name);
    else index.set(key, new Set([name]));
  };
  for (const [name, values] of all) {
    for (const raw of values) {
      const v = raw.trim();
      if (v === '') continue;
      const color = canonicalColor(v);
      if (color) put(`c:${color}`, name);
      const length = canonicalLength(v, rootFontSizePx);
      if (length) put(`l:${length}`, name);
      if (/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(v)) put(`n:${ratioString(parseFloat(v))}`, name);
      const em = /^([-+]?(?:\d+\.?\d*|\.\d+))em$/i.exec(v);
      if (em) put(`e:${ratioString(parseFloat(em[1]))}em`, name);
      put(`f:${normalizeFontFamily(v)}`, name);
      put(`s:${normalizeShadow(v)}`, name);
      const border = parseBorderShorthand(v);
      if (border.width && border.style) {
        put(
          `b:${canonicalBorder(border.width, border.style, border.color ?? border.rawColor ?? '')}`,
          name
        );
      }
    }
  }
  return index;
}

/** The custom-property index key a category's canonical value is looked up under. */
function customPropertyKey(category: StyleCategory, value: string): string {
  switch (category) {
    case 'colors':
      return `c:${value}`;
    case 'fontSizes':
    case 'spacing':
    case 'borderRadius':
      return `l:${value}`;
    case 'fontWeights':
    case 'lineHeights':
      return `n:${value}`;
    case 'letterSpacings':
      return `e:${value}`;
    case 'fontFamilies':
      return `f:${value}`;
    case 'shadows':
      return `s:${value}`;
    case 'borders':
      return `b:${value}`;
  }
}

/** Rank: element count desc, occurrences desc, value asc (code-unit order). */
function compareEntries(
  a: { elementCount: number; occurrences: number; value: string },
  b: { elementCount: number; occurrences: number; value: string }
): number {
  if (b.elementCount !== a.elementCount) return b.elementCount - a.elementCount;
  if (b.occurrences !== a.occurrences) return b.occurrences - a.occurrences;
  return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
}

/** The four sides of a box property, from per-side keys or the shorthand. */
function sides(styles: Partial<Record<string, string>>, prop: 'margin' | 'padding'): string[] {
  const keys = ['Top', 'Right', 'Bottom', 'Left'].map((s) => `${prop}${s}`);
  const perSide = keys.map((k) => styles[k]);
  if (perSide.some((v) => v !== undefined && v !== '')) return perSide.map((v) => v ?? '');
  const parts = topLevelSplit(styles[prop] ?? '', ' ');
  switch (parts.length) {
    case 1:
      return [parts[0], parts[0], parts[0], parts[0]];
    case 2:
      return [parts[0], parts[1], parts[0], parts[1]];
    case 3:
      return [parts[0], parts[1], parts[2], parts[1]];
    case 4:
      return parts;
    default:
      return [];
  }
}

/**
 * Aggregate samples into the ranked, uncapped inventory.
 */
export function buildStyleInventory(
  samples: readonly StyleSample[],
  options: StyleInventoryOptions = {}
): StyleInventory {
  const rootFontSizePx = options.rootFontSizePx ?? 16;
  const acc = perCategory(() => new Map<string, Accumulator>());
  const excludedDefaults = perCategory(() => 0);
  const unnormalized = perCategory(() => 0);
  const customValues = new Map<string, Set<string>>();

  const addCustom = (props: Record<string, string> | undefined): void => {
    if (!props) return;
    for (const [name, value] of Object.entries(props)) {
      if (!name.startsWith('--') || typeof value !== 'string') continue;
      const set = customValues.get(name);
      if (set) set.add(value);
      else customValues.set(name, new Set([value]));
    }
  };
  addCustom(options.customProperties);

  for (const sample of samples) {
    addCustom(sample.customProperties);
    const s = sample.styles;
    const id = sample.elementId;

    const add = (
      category: StyleCategory,
      value: string,
      property: string,
      normalized = true,
      px?: string,
      outOfGamut = false
    ): void => {
      if (!normalized) unnormalized[category]++;
      const map = acc[category];
      let entry = map.get(value);
      if (!entry) {
        entry = {
          value,
          occurrences: 0,
          elements: new Set(),
          properties: new Set(),
          normalized,
          outOfGamut: false,
          px: new Set(),
        };
        map.set(value, entry);
      }
      entry.occurrences++;
      entry.elements.add(id);
      entry.properties.add(property);
      if (px) entry.px.add(px);
      if (outOfGamut) entry.outOfGamut = true;
    };

    const addColor = (raw: string | undefined, property: string): void => {
      if (raw === undefined) return;
      const v = raw.trim().toLowerCase();
      if (v === '' || v === 'currentcolor' || v === 'inherit' || v === 'initial') return;
      const parsed = parseColor(v);
      if (parsed === null) {
        add('colors', v, property, false);
        return;
      }
      const hex = toCanonicalHex(parsed);
      if (isTransparent(hex)) {
        excludedDefaults.colors++;
        return;
      }
      add('colors', hex, property, true, undefined, parsed.outOfGamut === true);
    };

    // Colours: text and background.
    addColor(s.color, 'color');
    addColor(s.backgroundColor, 'backgroundColor');

    // Borders (and their colours). A non-uniform border computes to an empty
    // shorthand; that case is invisible here and is not invented.
    if (s.border !== undefined && s.border.trim() !== '') {
      const b = parseBorderShorthand(s.border);
      if (
        b.width === null ||
        b.width === 0 ||
        b.style === null ||
        b.style === 'none' ||
        b.style === 'hidden'
      ) {
        excludedDefaults.borders++;
      } else {
        const colorPart = b.color ?? b.rawColor ?? '';
        if (b.color && isTransparent(b.color)) {
          excludedDefaults.borders++;
        } else {
          add(
            'borders',
            canonicalBorder(b.width, b.style, colorPart),
            'border',
            b.color !== null || b.rawColor === null
          );
          if (b.rawColor !== null) addColor(b.rawColor, 'border');
        }
      }
    }

    // Outline colour only (an outline is rarely a design token of its own).
    if (s.outline !== undefined && s.outline.trim() !== '') {
      const o = parseBorderShorthand(s.outline);
      if (o.width && o.style && o.style !== 'none' && o.style !== 'hidden' && o.rawColor) {
        addColor(o.rawColor, 'outline');
      }
    }

    // Shadows (and their colours).
    if (s.boxShadow !== undefined && s.boxShadow.trim() !== '') {
      const shadow = normalizeShadow(s.boxShadow);
      if (shadow === 'none') {
        excludedDefaults.shadows++;
      } else {
        add('shadows', shadow, 'boxShadow');
        for (const c of shadowColors(s.boxShadow)) addColor(c, 'boxShadow');
      }
    }

    // Typography.
    if (s.fontFamily !== undefined && s.fontFamily.trim() !== '') {
      add('fontFamilies', normalizeFontFamily(s.fontFamily), 'fontFamily');
    }
    if (s.fontWeight !== undefined && s.fontWeight.trim() !== '') {
      const w = normalizeFontWeight(s.fontWeight);
      if (w === null) add('fontWeights', s.fontWeight.trim().toLowerCase(), 'fontWeight', false);
      else add('fontWeights', w, 'fontWeight');
    }
    const fontSizePx =
      s.fontSize !== undefined && s.fontSize.trim() !== ''
        ? lengthToPx(s.fontSize, rootFontSizePx)
        : null;
    if (s.fontSize !== undefined && s.fontSize.trim() !== '') {
      if (fontSizePx === null) add('fontSizes', s.fontSize.trim().toLowerCase(), 'fontSize', false);
      else add('fontSizes', formatPx(fontSizePx), 'fontSize');
    }
    if (s.lineHeight !== undefined && s.lineHeight.trim() !== '') {
      const v = s.lineHeight.trim().toLowerCase();
      if (v === 'normal') {
        excludedDefaults.lineHeights++;
      } else if (/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(v)) {
        // A bare number is already a ratio.
        add('lineHeights', ratioString(parseFloat(v)), 'lineHeight');
      } else {
        const px = lengthToPx(v, rootFontSizePx);
        if (px !== null && fontSizePx) {
          add('lineHeights', ratioString(px / fontSizePx), 'lineHeight', true, formatPx(px));
        } else {
          add('lineHeights', v, 'lineHeight', false);
        }
      }
    }
    if (s.letterSpacing !== undefined && s.letterSpacing.trim() !== '') {
      const v = s.letterSpacing.trim().toLowerCase();
      const px = lengthToPx(v, rootFontSizePx);
      if (v === 'normal' || px === 0) {
        excludedDefaults.letterSpacings++;
      } else if (px !== null && fontSizePx) {
        add(
          'letterSpacings',
          `${ratioString(px / fontSizePx)}em`,
          'letterSpacing',
          true,
          formatPx(px)
        );
      } else if (LENGTH.exec(v)?.[2] === 'em') {
        add('letterSpacings', `${ratioString(parseFloat(v))}em`, 'letterSpacing');
      } else {
        add('letterSpacings', v, 'letterSpacing', false);
      }
    }

    // Spacing: margin and padding per side, and gap (row and column).
    const addSpacing = (raw: string, property: string): void => {
      const v = raw.trim().toLowerCase();
      if (v === '' || v === 'auto' || v === 'normal') {
        if (v === 'normal') excludedDefaults.spacing++;
        return;
      }
      const length = canonicalLength(v, rootFontSizePx);
      if (length === null) {
        add('spacing', v, property, false);
        return;
      }
      if (length === '0px' || length === '0%') {
        excludedDefaults.spacing++;
        return;
      }
      add('spacing', length, property);
    };
    for (const prop of ['margin', 'padding'] as const) {
      for (const side of sides(s, prop)) addSpacing(side, prop);
    }
    if (s.gap !== undefined && s.gap.trim() !== '') {
      const parts = topLevelSplit(s.gap, ' ');
      // A two-value gap with equal halves is one value, not two occurrences.
      const distinct = parts.length === 2 && parts[0] === parts[1] ? [parts[0]] : parts;
      for (const part of distinct) addSpacing(part, 'gap');
    }

    // Radii: each distinct non-zero corner once per element.
    if (s.borderRadius !== undefined && s.borderRadius.trim() !== '') {
      const v = s.borderRadius.trim().toLowerCase();
      if (v.includes('/')) {
        add('borderRadius', topLevelSplit(v, ' ').join(' '), 'borderRadius', false);
      } else {
        const corners = new Set<string>();
        let anyZero = false;
        for (const corner of topLevelSplit(v, ' ')) {
          const length = canonicalLength(corner, rootFontSizePx);
          if (length === '0px' || length === '0%') {
            anyZero = true;
            continue;
          }
          corners.add(length ?? corner);
        }
        if (corners.size === 0 && anyZero) excludedDefaults.borderRadius++;
        for (const corner of corners) {
          add('borderRadius', corner, 'borderRadius', canonicalLength(corner) !== null);
        }
      }
    }
  }

  const cpIndex = indexCustomPropertyValues(customValues, rootFontSizePx);
  const entries = perCategory((category) => {
    const ranked = [...acc[category].values()]
      .map((a) => ({
        value: a.value,
        occurrences: a.occurrences,
        elementCount: a.elements.size,
        acc: a,
      }))
      .sort(compareEntries);
    return ranked.map((r, i): InventoryEntry => {
      const matching = [...(cpIndex.get(customPropertyKey(category, r.value)) ?? [])]
        .sort()
        .slice(0, MAX_MATCHING_CUSTOM_PROPERTIES);
      const entry: InventoryEntry = {
        name: `${ORDINAL_PREFIX[category]}-${i + 1}`,
        value: r.value,
        occurrences: r.occurrences,
        elementCount: r.elementCount,
        properties: [...r.acc.properties].sort(),
        matchingCustomProperties: matching,
        normalized: r.acc.normalized,
      };
      if (r.acc.outOfGamut) entry.outOfGamut = true;
      if (category === 'lineHeights' || category === 'letterSpacings') {
        // Uncapped here: drift matches px tokens against every spelling. The
        // guide's inventory caps the list (inferStyleGuideFromInventory).
        entry.px = [...r.acc.px].sort((a, b) => parseFloat(a) - parseFloat(b));
      }
      return entry;
    });
  });

  return {
    entries,
    excludedDefaults,
    sampleCount: samples.length,
    customPropertiesSeen: customValues.size,
    unnormalized,
  };
}

// ============================================================================
// Inferred style guide
// ============================================================================

export interface InferOptions {
  /** Cap per category (default 24). */
  maxPerCategory?: number;
  /** Per-category cap overrides. */
  limits?: Partial<Record<StyleCategory, number>>;
  /** The guide's `name` (default `inferred-draft`). */
  name?: string;
}

export interface InferredStyleGuide {
  /** `ok` when anything was sampled; `empty` (with `reason`) otherwise. */
  status: 'ok' | 'empty';
  reason?: string;
  /** Loadable through `/design/style-guide/load`. `null` when `status` is `empty`. */
  guide: StyleGuideConfig | null;
  /** The capped, ranked entries per category. */
  inventory: Record<StyleCategory, InventoryEntry[]>;
  truncation: Record<StyleCategory, CategoryTruncation>;
  excludedDefaults: Record<StyleCategory, number>;
  unnormalized: Record<StyleCategory, number>;
  notInGuide: StyleCategory[];
  notInferable: string[];
}

function capFor(category: StyleCategory, options: InferOptions): number {
  const cap = options.limits?.[category] ?? options.maxPerCategory ?? DEFAULT_MAX_PER_CATEGORY;
  return Math.max(0, Math.floor(cap));
}

/** The tokens map of a category's kept entries: `{ "color-1": "#3b82f6", … }`. */
function tokenMap(entries: InventoryEntry[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const e of entries) map[e.name] = e.value;
  return map;
}

/**
 * The draft guide from an inventory: the top `cap` entries of each category,
 * ordinally named, with truncation reported for every category.
 */
export function inferStyleGuideFromInventory(
  inventory: StyleInventory,
  options: InferOptions = {}
): InferredStyleGuide {
  const kept = perCategory((c) =>
    inventory.entries[c]
      .slice(0, capFor(c, options))
      .map((e) =>
        e.px && e.px.length > MAX_PX_SPELLINGS ? { ...e, px: e.px.slice(0, MAX_PX_SPELLINGS) } : e
      )
  );
  const truncation = perCategory((c): CategoryTruncation => {
    const all = inventory.entries[c];
    const dropped = all.slice(kept[c].length);
    return {
      distinct: all.length,
      kept: kept[c].length,
      dropped: dropped.length,
      droppedOccurrences: dropped.reduce((n, e) => n + e.occurrences, 0),
    };
  });
  const base = {
    inventory: kept,
    truncation,
    excludedDefaults: inventory.excludedDefaults,
    unnormalized: inventory.unnormalized,
    notInGuide: [...NOT_IN_GUIDE],
    notInferable: [...NOT_INFERABLE],
  };

  if (inventory.sampleCount === 0) {
    return { status: 'empty', reason: 'no elements were sampled', guide: null, ...base };
  }
  if (
    STYLE_CATEGORIES.filter((c) => !NOT_IN_GUIDE.includes(c)).every(
      (c) => inventory.entries[c].length === 0
    )
  ) {
    return {
      status: 'empty',
      reason: `${inventory.sampleCount} element(s) sampled, but none carried a non-default style value a style guide has tokens for`,
      guide: null,
      ...base,
    };
  }

  const tokens: DesignTokens = {
    colors: tokenMap(kept.colors),
    typography: {
      fontFamilies: tokenMap(kept.fontFamilies),
      fontSizes: tokenMap(kept.fontSizes),
      fontWeights: tokenMap(kept.fontWeights),
      lineHeights: tokenMap(kept.lineHeights),
      letterSpacings: tokenMap(kept.letterSpacings),
    },
    spacing: tokenMap(kept.spacing),
    borderRadius: tokenMap(kept.borderRadius),
    shadows: tokenMap(kept.shadows),
    breakpoints: {},
  };
  const guide: StyleGuideConfig = {
    version: STYLE_GUIDE_VERSION,
    name: options.name ?? 'inferred-draft',
    description:
      `Draft inferred from the computed styles of ${inventory.sampleCount} element(s). ` +
      'Tokens are named by frequency rank, not meaning; line heights are unitless ratios ' +
      'and letter spacings are em, both relative to the element font size. ' +
      'Breakpoints are not inferable from one viewport. Review before adopting.',
    tokens,
    rules: [],
  };
  return { status: 'ok', guide, ...base };
}

// ============================================================================
// Token drift
// ============================================================================

/** How a declared token's value is compared. */
type TokenKind =
  | 'color'
  | 'length'
  | 'number'
  | 'ratio'
  | 'em'
  | 'family'
  | 'shadow'
  | 'lineHeightPx'
  | 'letterSpacingPx';

/** A declared token, resolved for comparison. */
interface ResolvedToken {
  /** Dot path (`colors.primary`) or custom-property name. */
  token: string;
  value: string;
  /** Categories this token can match values in. */
  categories: StyleCategory[];
  kind: TokenKind;
  key: string;
}

export interface UnresolvedToken {
  token: string;
  value: string;
  reason: string;
  /** The category a structured (`tokens`) entry belongs to; absent for a flat-map entry of unknown kind. */
  category?: StyleCategory;
}

/** The declared token set: a `DesignTokens`-shaped object and/or a flat custom-property map. */
export interface DeclaredTokenSet {
  tokens?: DeepPartialTokens;
  customProperties?: Record<string, string | number>;
}

/** `Partial<DesignTokens>` with partial typography and number-or-string values. */
export interface DeepPartialTokens {
  colors?: Record<string, string>;
  typography?: Partial<Record<keyof DesignTokens['typography'], Record<string, string | number>>>;
  spacing?: Record<string, string | number>;
  borderRadius?: Record<string, string | number>;
  shadows?: Record<string, string>;
  breakpoints?: Record<string, string | number>;
}

export interface DriftTolerance {
  /** CIEDE2000 ΔE within which a colour is a near miss (default 3). */
  colorDeltaE?: number;
  /** px within which a length is a near miss (default 2). */
  px?: number;
}

export interface DriftOptions extends DriftTolerance {
  /** Root font size for `rem` tokens (default 16). */
  rootFontSizePx?: number;
  /** Cap on each category's undeclared and unused lists (default 50). */
  maxListed?: number;
}

export const DEFAULT_COLOR_DELTA_E = 3;
export const DEFAULT_PX_TOLERANCE = 2;
export const DEFAULT_MAX_LISTED = 50;
/** Ratio, em and weight tolerances are fixed: they are not caller-tunable. */
const RATIO_TOLERANCE = 0.05;
/**
 * Colours closer than this (CIEDE2000) are the same token: it absorbs the
 * one-step 8-bit rounding between a declared `oklch` and a computed `oklab`.
 */
export const COLOR_MATCH_DELTA_E = 0.5;
const EM_TOLERANCE = 0.01;
const WEIGHT_TOLERANCE = 100;

export type DriftUnit = 'deltaE2000' | 'px' | 'ratio' | 'em' | 'weight' | 'same-primary-family';

export interface NearestToken {
  token: string;
  value: string;
  distance: number;
  unit: DriftUnit;
}

export interface UndeclaredValue {
  category: StyleCategory;
  value: string;
  occurrences: number;
  elementCount: number;
  properties: string[];
  /** The closest declared token in the category, when one is comparable. */
  nearest: NearestToken | null;
  /** True when `nearest` is within tolerance — likely a token typed by hand. */
  nearMiss: boolean;
}

export interface UnusedToken {
  token: string;
  value: string;
  categories: StyleCategory[];
}

export type CategoryDriftStatus =
  /** Values in use were compared against declared tokens. */
  | 'compared'
  /** Values are in use, but no token in the declared set covers the category. */
  | 'no-declared-tokens'
  /** Tokens are declared, but no value in the category is in use. */
  | 'no-values-in-use'
  /** Neither. */
  | 'empty';

export interface CategoryDrift {
  status: CategoryDriftStatus;
  /** Distinct values in use. */
  inUse: number;
  /** Comparable declared tokens covering the category. */
  declared: number;
  /** In-use values matched by a token. */
  matched: number;
  undeclaredInUse: number;
  unusedDeclared: number;
  /** Structured tokens of this category that could not be compared (see `unresolved`). */
  unresolvedDeclared: number;
}

export interface ListTruncation {
  total: number;
  listed: number;
  dropped: number;
}

export type DriftVerdict = 'drift' | 'no-drift' | 'unknown';

export interface TokenDriftReport {
  /**
   * `drift` — some compared value has no token; `no-drift` — every compared
   * value matched; `unknown` (with `reason`) — nothing could be compared.
   */
  verdict: DriftVerdict;
  reason?: string;
  categories: Record<StyleCategory, CategoryDrift>;
  /** One human line per category with anything in it. */
  summary: string[];
  undeclared: UndeclaredValue[];
  unused: UnusedToken[];
  unresolved: UnresolvedToken[];
  /** Declared keys never compared against computed styles (`breakpoints`). */
  notComparable: string[];
  /** Declared motion values (durations, easings) skipped: computed styles carry no such value. */
  ignoredDeclared: number;
  /**
   * Unresolved flat-map tokens whose kind could not be classified, so no
   * category's `unresolvedDeclared` counts them. With the per-category counts
   * this sums to `unresolved.length`.
   */
  unresolvedUncategorised: number;
  truncation: {
    undeclared: Record<StyleCategory, ListTruncation>;
    unused: Record<StyleCategory, ListTruncation>;
  };
}

const LENGTH_CATEGORIES: StyleCategory[] = ['fontSizes', 'spacing', 'borderRadius'];

/**
 * Evaluate the one-operator `calc()` design-token systems emit
 * (`calc(1px * 22)`, `calc(2rem / 2)`). Anything else is `null`.
 */
function evalSimpleCalc(value: string, rootFontSizePx: number): string | null {
  const m = /^calc\(\s*([^\s*/+]+)\s*([*/])\s*([^\s*/+]+)\s*\)$/i.exec(value.trim());
  if (!m) return null;
  const [, left, op, right] = m;
  const num = (t: string): number | null =>
    /^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(t) ? parseFloat(t) : null;
  const lpx = lengthToPx(left, rootFontSizePx);
  const rn = num(right);
  if (lpx !== null && num(left) === null && rn !== null) {
    if (op === '/' && rn === 0) return null;
    return formatPx(op === '*' ? lpx * rn : lpx / rn);
  }
  const ln = num(left);
  const rpx = lengthToPx(right, rootFontSizePx);
  if (ln !== null && rpx !== null && num(right) === null && op === '*') return formatPx(ln * rpx);
  return null;
}

const BARE_NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)$/;
const VAR_REFERENCE = /var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/;
const MAX_VAR_DEPTH = 8;

/**
 * Substitute `var(--x)` references in a flat custom-property map from the map
 * itself (a reference's fallback when the map lacks it). A value that still
 * references something after `MAX_VAR_DEPTH` passes — a cycle, or a name the
 * map does not declare and no fallback — resolves to `null`.
 */
function substituteVars(
  map: Record<string, string | number>
): Map<string, { raw: string; value: string | null }> {
  const raw = new Map(Object.entries(map).map(([k, v]) => [k, String(v)]));
  const out = new Map<string, { raw: string; value: string | null }>();
  for (const [name, original] of raw) {
    let value = original;
    for (let depth = 0; depth < MAX_VAR_DEPTH && VAR_REFERENCE.test(value); depth++) {
      value = value.replace(
        new RegExp(VAR_REFERENCE.source, 'g'),
        (whole, ref: string, fallback?: string) => {
          if (ref === name) return whole;
          const target = raw.get(ref);
          if (target !== undefined) return target;
          return fallback !== undefined ? fallback.trim() : whole;
        }
      );
    }
    out.set(name, { raw: original, value: VAR_REFERENCE.test(value) ? null : value.trim() });
  }
  return out;
}

/** A duration or easing — a motion token, not a style value computed styles carry. */
function isNonStyleValue(v: string): boolean {
  const t = v.trim().toLowerCase();
  if (/^[-+]?(?:\d+\.?\d*|\.\d+)m?s$/.test(t)) return true;
  if (/^(cubic-bezier|steps)\(/.test(t)) return true;
  return [
    'ease',
    'ease-in',
    'ease-out',
    'ease-in-out',
    'linear',
    'step-start',
    'step-end',
  ].includes(t);
}

/** A default value the inventory excludes, so a token declaring it is never "matched". */
function isDefaultValue(v: string): boolean {
  const t = v.trim().toLowerCase();
  if (t === 'normal' || t === 'none' || t === 'transparent' || t === 'auto') return true;
  const length = LENGTH.exec(t);
  if (length && parseFloat(length[1]) === 0) return true;
  const c = canonicalColor(t);
  return c !== null && isTransparent(c);
}

/** The category of a structured token path (`colors.x`, `typography.fontSizes.y`). */
function categoryOfTokenPath(token: string): StyleCategory | undefined {
  const parts = token.split('.');
  const group = parts[0] === 'typography' ? parts[1] : parts[0];
  return (STYLE_CATEGORIES as readonly string[]).includes(group)
    ? (group as StyleCategory)
    : undefined;
}

function resolveTokens(
  declared: DeclaredTokenSet,
  rootFontSizePx: number
): {
  resolved: ResolvedToken[];
  unresolved: UnresolvedToken[];
  notComparable: string[];
  ignoredDeclared: number;
} {
  const resolved: ResolvedToken[] = [];
  const unresolved: UnresolvedToken[] = [];
  const notComparable: string[] = [];
  let ignoredDeclared = 0;

  const unresolve = (token: string, value: string, reason: string): void => {
    const category = categoryOfTokenPath(token);
    unresolved.push(category ? { token, value, reason, category } : { token, value, reason });
  };

  /**
   * A value with a one-operator `calc()` evaluated. `var()` is substituted
   * only within a flat custom-property map (`substituteVars`); a structured
   * token holding one has nothing to resolve it against.
   */
  const prepared = (raw: string): string => {
    const v = raw.trim();
    return evalSimpleCalc(v, rootFontSizePx) ?? v;
  };

  const lengthToken = (token: string, raw: string, categories: StyleCategory[]): void => {
    const v = prepared(raw);
    if (isDefaultValue(v)) {
      unresolve(
        token,
        raw,
        'declares a default value (0, auto, none), which the inventory excludes'
      );
      return;
    }
    const key = canonicalLength(v, rootFontSizePx);
    if (key === null) {
      unresolve(
        token,
        raw,
        'not an absolute length (px, rem, unitless or %) after resolving calc()'
      );
      return;
    }
    resolved.push({ token, value: raw, categories, kind: 'length', key });
  };

  /** True (and recorded unresolved) when a structured token's value holds an unsubstituted var(). */
  const unsubstituted = (token: string, raw: string): boolean => {
    if (!VAR_REFERENCE.test(raw)) return false;
    unresolve(
      token,
      raw,
      'unsubstituted var() — a DesignTokens object has no map to resolve it against; pass resolved values, a customProperties map, or pageCustomPropertyPrefix'
    );
    return true;
  };

  const t = declared.tokens;
  if (t) {
    for (const [name, raw] of Object.entries(t.colors ?? {})) {
      if (unsubstituted(`colors.${name}`, String(raw))) continue;
      const token = `colors.${name}`;
      const key = canonicalColor(String(raw));
      if (key === null) unresolve(token, String(raw), 'not a parseable colour');
      else if (isTransparent(key))
        unresolve(
          token,
          String(raw),
          'declares a fully transparent colour, which the inventory excludes'
        );
      else resolved.push({ token, value: String(raw), categories: ['colors'], kind: 'color', key });
    }
    const ty = t.typography ?? {};
    for (const [name, raw] of Object.entries(ty.fontFamilies ?? {})) {
      if (unsubstituted(`typography.fontFamilies.${name}`, String(raw))) continue;
      resolved.push({
        token: `typography.fontFamilies.${name}`,
        value: String(raw),
        categories: ['fontFamilies'],
        kind: 'family',
        key: normalizeFontFamily(String(raw)),
      });
    }
    for (const [name, raw] of Object.entries(ty.fontSizes ?? {})) {
      if (unsubstituted(`typography.fontSizes.${name}`, String(raw))) continue;
      lengthToken(`typography.fontSizes.${name}`, String(raw), ['fontSizes']);
    }
    for (const [name, raw] of Object.entries(ty.fontWeights ?? {})) {
      if (unsubstituted(`typography.fontWeights.${name}`, String(raw))) continue;
      const token = `typography.fontWeights.${name}`;
      const key = normalizeFontWeight(String(raw));
      if (key === null) unresolve(token, String(raw), 'not a numeric font weight');
      else
        resolved.push({
          token,
          value: String(raw),
          categories: ['fontWeights'],
          kind: 'number',
          key,
        });
    }
    for (const [name, raw] of Object.entries(ty.lineHeights ?? {})) {
      if (unsubstituted(`typography.lineHeights.${name}`, String(raw))) continue;
      const token = `typography.lineHeights.${name}`;
      const v = prepared(String(raw)).toLowerCase();
      if (v === 'normal') {
        unresolve(token, String(raw), 'declares the default value, which the inventory excludes');
      } else if (/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(v)) {
        resolved.push({
          token,
          value: String(raw),
          categories: ['lineHeights'],
          kind: 'ratio',
          key: ratioString(parseFloat(v)),
        });
      } else if (/%$/.test(v) && LENGTH.test(v)) {
        resolved.push({
          token,
          value: String(raw),
          categories: ['lineHeights'],
          kind: 'ratio',
          key: ratioString(parseFloat(v) / 100),
        });
      } else if (/em$/.test(v) && !/rem$/.test(v) && LENGTH.test(v)) {
        resolved.push({
          token,
          value: String(raw),
          categories: ['lineHeights'],
          kind: 'ratio',
          key: ratioString(parseFloat(v)),
        });
      } else {
        const px = lengthToPx(v, rootFontSizePx);
        if (px === null)
          unresolve(token, String(raw), 'not a ratio, percentage, em or absolute length');
        else
          resolved.push({
            token,
            value: String(raw),
            categories: ['lineHeights'],
            kind: 'lineHeightPx',
            key: formatPx(px),
          });
      }
    }
    for (const [name, raw] of Object.entries(ty.letterSpacings ?? {})) {
      if (unsubstituted(`typography.letterSpacings.${name}`, String(raw))) continue;
      const token = `typography.letterSpacings.${name}`;
      const v = prepared(String(raw)).toLowerCase();
      if (isDefaultValue(v)) {
        unresolve(
          token,
          String(raw),
          'declares the default value (normal / 0), which the inventory excludes'
        );
      } else if (/em$/.test(v) && !/rem$/.test(v) && LENGTH.test(v)) {
        resolved.push({
          token,
          value: String(raw),
          categories: ['letterSpacings'],
          kind: 'em',
          key: `${ratioString(parseFloat(v))}em`,
        });
      } else {
        const px = lengthToPx(v, rootFontSizePx);
        if (px === null) unresolve(token, String(raw), 'not an em or absolute length');
        else
          resolved.push({
            token,
            value: String(raw),
            categories: ['letterSpacings'],
            kind: 'letterSpacingPx',
            key: formatPx(px),
          });
      }
    }
    for (const [name, raw] of Object.entries(t.spacing ?? {})) {
      if (unsubstituted(`spacing.${name}`, String(raw))) continue;
      lengthToken(`spacing.${name}`, String(raw), ['spacing']);
    }
    for (const [name, raw] of Object.entries(t.borderRadius ?? {})) {
      if (unsubstituted(`borderRadius.${name}`, String(raw))) continue;
      lengthToken(`borderRadius.${name}`, String(raw), ['borderRadius']);
    }
    for (const [name, raw] of Object.entries(t.shadows ?? {})) {
      if (unsubstituted(`shadows.${name}`, String(raw))) continue;
      const token = `shadows.${name}`;
      if (isDefaultValue(String(raw)))
        unresolve(token, String(raw), 'declares the default value, which the inventory excludes');
      else
        resolved.push({
          token,
          value: String(raw),
          categories: ['shadows'],
          kind: 'shadow',
          key: normalizeShadow(String(raw)),
        });
    }
    if (t.breakpoints && Object.keys(t.breakpoints).length > 0) notComparable.push('breakpoints');
  }

  for (const [name, entry] of substituteVars(declared.customProperties ?? {})) {
    const raw = entry.raw;
    if (entry.value === null) {
      unresolve(
        name,
        raw,
        'references a custom property the map does not declare, or a var() cycle'
      );
      continue;
    }
    const v = prepared(entry.value);
    if (v === '') {
      unresolve(name, raw, 'empty value');
      continue;
    }
    if (isNonStyleValue(v)) {
      ignoredDeclared++;
      continue;
    }
    if (isDefaultValue(v)) {
      unresolve(name, raw, 'declares a default value, which the inventory excludes');
      continue;
    }
    const color = canonicalColor(v);
    if (color) {
      resolved.push({ token: name, value: raw, categories: ['colors'], kind: 'color', key: color });
      continue;
    }
    if (BARE_NUMBER.test(v)) {
      // Classified by magnitude, never by name: an integer 100–1000 is a font
      // weight, a number below 10 a line-height ratio, anything else unknown.
      const n = parseFloat(v);
      if (Number.isInteger(n) && n >= 100 && n <= 1000) {
        resolved.push({
          token: name,
          value: raw,
          categories: ['fontWeights'],
          kind: 'number',
          key: String(n),
        });
      } else if (n > 0 && n < 10) {
        resolved.push({
          token: name,
          value: raw,
          categories: ['lineHeights'],
          kind: 'ratio',
          key: ratioString(n),
        });
      } else {
        unresolve(
          name,
          raw,
          'a bare number that is neither a font weight (100–1000) nor a line-height ratio (< 10)'
        );
      }
      continue;
    }
    const length = canonicalLength(v, rootFontSizePx);
    if (length) {
      // A flat map says nothing about what a length is for: it may match any
      // length category.
      resolved.push({
        token: name,
        value: raw,
        categories: [...LENGTH_CATEGORIES],
        kind: 'length',
        key: length,
      });
      continue;
    }
    const em = /^([-+]?(?:\d+\.?\d*|\.\d+))em$/i.exec(v);
    if (em) {
      resolved.push({
        token: name,
        value: raw,
        categories: ['letterSpacings'],
        kind: 'em',
        key: `${ratioString(parseFloat(em[1]))}em`,
      });
      continue;
    }
    const layers = topLevelSplit(v, ',');
    const looksLikeShadow = layers.every((layer) => {
      const parts = topLevelSplit(layer, ' ');
      return parts.filter((p) => lengthToPx(p) !== null).length >= 2;
    });
    if (looksLikeShadow) {
      resolved.push({
        token: name,
        value: raw,
        categories: ['shadows'],
        kind: 'shadow',
        key: normalizeShadow(v),
      });
      continue;
    }
    if (/^[a-z"'][a-z0-9 _"',-]*$/i.test(v) && (v.includes(',') || /["']/.test(v))) {
      resolved.push({
        token: name,
        value: raw,
        categories: ['fontFamilies'],
        kind: 'family',
        key: normalizeFontFamily(v),
      });
      continue;
    }
    unresolve(
      name,
      raw,
      'value kind not recognised (not a colour, length, number, em, shadow or font stack)'
    );
  }

  return { resolved, unresolved, notComparable, ignoredDeclared };
}

/** Whether a token matches an inventory entry exactly. */
function tokenMatches(
  token: ResolvedToken,
  category: StyleCategory,
  entry: InventoryEntry
): boolean {
  if (!token.categories.includes(category)) return false;
  switch (token.kind) {
    case 'lineHeightPx':
    case 'letterSpacingPx':
      return (entry.px ?? []).includes(token.key);
    case 'color': {
      if (entry.value === token.key) return true;
      // ΔE ignores alpha: a 50%-alpha blue is not the opaque blue token.
      if (!entry.normalized || alphaOf(entry.value) !== alphaOf(token.key)) return false;
      const d = colorDistance(entry.value, token.key);
      return d !== null && d < COLOR_MATCH_DELTA_E;
    }
    default:
      return entry.value === token.key;
  }
}

/** Distance between an in-use value and a token, in the token's unit; `null` if not comparable. */
function tokenDistance(
  token: ResolvedToken,
  category: StyleCategory,
  entry: InventoryEntry
): { distance: number; unit: DriftUnit } | null {
  if (!token.categories.includes(category) || !entry.normalized) return null;
  switch (token.kind) {
    case 'color': {
      // A token of another opacity is not a candidate: ΔE cannot see alpha.
      if (alphaOf(entry.value) !== alphaOf(token.key)) return null;
      const d = colorDistance(entry.value, token.key);
      return d === null ? null : { distance: round(d), unit: 'deltaE2000' };
    }
    case 'length': {
      if (!entry.value.endsWith('px') || !token.key.endsWith('px')) return null;
      return {
        distance: round(Math.abs(parseFloat(entry.value) - parseFloat(token.key))),
        unit: 'px',
      };
    }
    case 'number':
      return {
        distance: round(Math.abs(parseFloat(entry.value) - parseFloat(token.key))),
        unit: 'weight',
      };
    case 'ratio':
      return {
        distance: round(Math.abs(parseFloat(entry.value) - parseFloat(token.key)), 3),
        unit: 'ratio',
      };
    case 'em':
      return {
        distance: round(Math.abs(parseFloat(entry.value) - parseFloat(token.key)), 3),
        unit: 'em',
      };
    case 'lineHeightPx':
    case 'letterSpacingPx': {
      const px = entry.px ?? [];
      if (px.length === 0) return null;
      const d = Math.min(...px.map((p) => Math.abs(parseFloat(p) - parseFloat(token.key))));
      return { distance: round(d), unit: 'px' };
    }
    case 'family':
      return primaryFamily(entry.value) === primaryFamily(token.key)
        ? { distance: 0, unit: 'same-primary-family' }
        : null;
    case 'shadow':
      return null;
  }
}

function withinTolerance(n: NearestToken, options: DriftOptions): boolean {
  switch (n.unit) {
    case 'deltaE2000':
      return n.distance <= (options.colorDeltaE ?? DEFAULT_COLOR_DELTA_E);
    case 'px':
      return n.distance <= (options.px ?? DEFAULT_PX_TOLERANCE);
    case 'ratio':
      return n.distance <= RATIO_TOLERANCE;
    case 'em':
      return n.distance <= EM_TOLERANCE;
    case 'weight':
      return n.distance <= WEIGHT_TOLERANCE;
    case 'same-primary-family':
      return true;
  }
}

const CATEGORY_LABEL: Record<StyleCategory, string> = {
  colors: 'colors',
  fontFamilies: 'font families',
  fontSizes: 'font sizes',
  fontWeights: 'font weights',
  lineHeights: 'line heights',
  letterSpacings: 'letter spacings',
  spacing: 'spacing values',
  borderRadius: 'radii',
  shadows: 'shadows',
  borders: 'borders',
};

/**
 * Compare the (uncapped) inventory against a declared token set.
 *
 * A category is compared only when the declared set covers it; values in an
 * uncovered category are counted (`no-declared-tokens`) but are not listed as
 * undeclared and do not decide the verdict — a colour palette alone says
 * nothing about spacing. `borders` has no token slot and is never compared.
 */
export function computeTokenDrift(
  inventory: StyleInventory,
  declared: DeclaredTokenSet,
  options: DriftOptions = {}
): TokenDriftReport {
  const rootFontSizePx = options.rootFontSizePx ?? 16;
  const maxListed = Math.max(0, Math.floor(options.maxListed ?? DEFAULT_MAX_LISTED));
  const { resolved, unresolved, notComparable, ignoredDeclared } = resolveTokens(
    declared,
    rootFontSizePx
  );

  const tokensFor = perCategory((c) => resolved.filter((t) => t.categories.includes(c)));
  const matchedTokens = new Set<ResolvedToken>();
  const undeclaredAll = perCategory((): UndeclaredValue[] => []);
  const categories = perCategory((c): CategoryDrift => {
    const entries = inventory.entries[c];
    const tokens = c === 'borders' ? [] : tokensFor[c];
    let matched = 0;
    for (const entry of entries) {
      const hits = tokens.filter((t) => tokenMatches(t, c, entry));
      if (hits.length > 0) {
        matched++;
        for (const h of hits) matchedTokens.add(h);
        continue;
      }
      if (tokens.length === 0) continue;
      let nearest: NearestToken | null = null;
      for (const t of tokens) {
        const d = tokenDistance(t, c, entry);
        if (d && (nearest === null || d.distance < nearest.distance)) {
          nearest = { token: t.token, value: t.value, distance: d.distance, unit: d.unit };
        }
      }
      undeclaredAll[c].push({
        category: c,
        value: entry.value,
        occurrences: entry.occurrences,
        elementCount: entry.elementCount,
        properties: entry.properties,
        nearest,
        nearMiss: nearest !== null && withinTolerance(nearest, options),
      });
    }
    const status: CategoryDriftStatus =
      entries.length > 0 && tokens.length > 0
        ? 'compared'
        : entries.length > 0
          ? 'no-declared-tokens'
          : tokens.length > 0
            ? 'no-values-in-use'
            : 'empty';
    return {
      status,
      inUse: entries.length,
      declared: tokens.length,
      matched,
      undeclaredInUse: undeclaredAll[c].length,
      unusedDeclared: 0,
      unresolvedDeclared: unresolved.filter((u) => u.category === c).length,
    };
  });

  // A token is unused when it matched nothing in any of its categories. A
  // flat-map length token covers three categories; it is listed — and counted
  // in `unusedDeclared` — once, under the first, so per-category counts agree
  // with `truncation.unused`.
  const unusedAll = perCategory((): UnusedToken[] => []);
  const seen = new Set<string>();
  const usedNames = new Set([...matchedTokens].map((t) => t.token));
  for (const t of resolved) {
    if (usedNames.has(t.token) || seen.has(t.token)) continue;
    seen.add(t.token);
    const cats = [
      ...new Set(resolved.filter((r) => r.token === t.token).flatMap((r) => r.categories)),
    ];
    const unused: UnusedToken = { token: t.token, value: t.value, categories: cats };
    unusedAll[cats[0]].push(unused);
    categories[cats[0]].unusedDeclared++;
  }

  const truncation = {
    undeclared: perCategory((c): ListTruncation => {
      const total = undeclaredAll[c].length;
      const listed = Math.min(total, maxListed);
      return { total, listed, dropped: total - listed };
    }),
    unused: perCategory((c): ListTruncation => {
      const total = unusedAll[c].length;
      const listed = Math.min(total, maxListed);
      return { total, listed, dropped: total - listed };
    }),
  };
  const undeclared = STYLE_CATEGORIES.flatMap((c) => undeclaredAll[c].slice(0, maxListed));
  const unused = STYLE_CATEGORIES.flatMap((c) => unusedAll[c].slice(0, maxListed));

  const summary: string[] = [];
  for (const c of STYLE_CATEGORIES) {
    const d = categories[c];
    const label = CATEGORY_LABEL[c];
    switch (d.status) {
      case 'compared':
        summary.push(
          `${d.inUse} distinct ${label} in use vs ${d.declared} declared: ${d.matched} matched, ` +
            `${d.undeclaredInUse} undeclared, ${d.unusedDeclared} declared but unused`
        );
        break;
      case 'no-declared-tokens':
        summary.push(
          c === 'borders'
            ? `${d.inUse} distinct ${label} in use — no token slot for borders, not compared`
            : `${d.inUse} distinct ${label} in use — no tokens declared for this category, not compared`
        );
        break;
      case 'no-values-in-use':
        summary.push(`${d.declared} ${label} declared, none in use`);
        break;
      case 'empty':
        break;
    }
  }

  const compared = STYLE_CATEGORIES.filter((c) => categories[c].status === 'compared');
  let verdict: DriftVerdict;
  let reason: string | undefined;
  if (inventory.sampleCount === 0) {
    verdict = 'unknown';
    reason = 'no elements were sampled';
  } else if (STYLE_CATEGORIES.every((c) => inventory.entries[c].length === 0)) {
    verdict = 'unknown';
    reason = `${inventory.sampleCount} element(s) sampled, but none carried a non-default style value`;
  } else if (resolved.length === 0) {
    verdict = 'unknown';
    reason =
      unresolved.length > 0
        ? `none of the ${unresolved.length} declared token(s) could be resolved for comparison`
        : 'the declared token set is empty';
  } else if (compared.length === 0) {
    verdict = 'unknown';
    reason = 'no category has both values in use and declared tokens to compare them with';
  } else {
    verdict = compared.some((c) => categories[c].undeclaredInUse > 0) ? 'drift' : 'no-drift';
  }

  return {
    verdict,
    ...(reason !== undefined ? { reason } : {}),
    categories,
    summary,
    undeclared,
    unused,
    unresolved,
    notComparable,
    ignoredDeclared,
    unresolvedUncategorised: unresolved.filter((u) => u.category === undefined).length,
    truncation,
  };
}

// ============================================================================
// Canonical equivalence (for the style validator)
// ============================================================================

/**
 * Whether a computed value and an expected (token or literal) value name the
 * same style once both are canonicalised: colours as hex, lengths as px, font
 * stacks and weights normalised, shadows normalised, and a unitless/`%`/`em`
 * line height or an `em` letter spacing compared as a ratio of the element's
 * font size (`styles.fontSize`).
 *
 * `style-validator.ts` falls back to this after its literal comparison, so a
 * `tokenRef` to `#3b82f6` passes against Chrome's `rgb(59, 130, 246)` — and a
 * draft guide inferred here can be referenced by rules at all.
 */
export function styleValuesEquivalent(
  actual: string,
  expected: string,
  property: string,
  styles?: Partial<Record<string, string>>
): boolean {
  const a = actual.trim();
  const e = expected.trim();
  if (a === '' || e === '') return false;

  const pa = parseColor(a);
  const pe = parseColor(e);
  if (pa !== null && pe !== null) {
    // Clamping merges distinct wide-gamut colours into one hex; never let
    // that turn a failing comparison into a pass.
    if (pa.outOfGamut || pe.outOfGamut) return false;
    return toCanonicalHex(pa) === toCanonicalHex(pe);
  }

  const fontSizePx = styles?.fontSize ? lengthToPx(styles.fontSize) : null;
  const relative = (scale: 'ratio' | 'em'): boolean | null => {
    const apx = lengthToPx(a);
    if (apx === null || !fontSizePx) return null;
    const lower = e.toLowerCase();
    let expectedRatio: number | null = null;
    if (scale === 'ratio' && BARE_NUMBER.test(lower)) expectedRatio = parseFloat(lower);
    else if (scale === 'ratio' && /%$/.test(lower) && LENGTH.test(lower)) {
      expectedRatio = parseFloat(lower) / 100;
    } else if (/em$/.test(lower) && !/rem$/.test(lower) && LENGTH.test(lower)) {
      expectedRatio = parseFloat(lower);
    }
    if (expectedRatio === null) return null;
    return ratioString(apx / fontSizePx) === ratioString(expectedRatio);
  };
  if (property === 'lineHeight') {
    const r = relative('ratio');
    if (r !== null) return r;
    // A unitless line height is a ratio, never px: without a font size it
    // cannot be compared.
    if (BARE_NUMBER.test(e)) return false;
  }
  if (property === 'letterSpacing') {
    const r = relative('em');
    if (r !== null) return r;
  }

  const la = canonicalLength(a);
  const le = canonicalLength(e);
  if (la !== null && le !== null) return la === le;

  if (property === 'fontFamily') return normalizeFontFamily(a) === normalizeFontFamily(e);
  if (property === 'fontWeight') {
    const wa = normalizeFontWeight(a);
    return wa !== null && wa === normalizeFontWeight(e);
  }
  if (property === 'boxShadow') return normalizeShadow(a) === normalizeShadow(e);
  return false;
}
