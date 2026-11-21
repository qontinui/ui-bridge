/**
 * Color Utilities
 *
 * Pure-math color functions for quality metric computations.
 * No DOM or browser APIs — works in any JavaScript runtime.
 */

import { parseColor as parseCssColor } from './style-color';

// ============================================================================
// Types
// ============================================================================

/**
 * An sRGB colour. Channels are 0-255 and UNROUNDED (an `oklch()` or `hsl()`
 * value rarely lands on an integer); `rgb()` percentages scale to 255. Alpha
 * is 0-1.
 */
export interface RGBA {
  r: number; // 0-255, unrounded
  g: number; // 0-255, unrounded
  b: number; // 0-255, unrounded
  a: number; // 0-1
}

/**
 * The alpha below which a colour is treated as not shown — a background that
 * faint is not a background, and a colour that faint is no colour choice. One
 * cut-off for every colour metric. Contrast does not use it: it composites any
 * foreground with alpha above 0, so faint text measures as faint.
 */
export const VISIBLE_ALPHA = 0.1;

/** Whether `color` is opaque enough to count as shown (`a >= VISIBLE_ALPHA`). */
export function isVisibleColor(color: RGBA | null): color is RGBA {
  return color !== null && color.a >= VISIBLE_ALPHA;
}

export interface HSL {
  h: number; // 0-360
  s: number; // 0-100
  l: number; // 0-100
}

// ============================================================================
// Parsing
// ============================================================================

/**
 * Parse a CSS color value to RGBA, or `null` for anything that is not a
 * colour this package reads (a missing value, `none`, a CSS-wide keyword,
 * `currentcolor`, `var()`, `display-p3`).
 *
 * The quality metrics, the `/design/audit` heuristics and `computeContrastRatio`
 * share ONE colour grammar: this delegates to `style-color`'s parser (which
 * style inference and token drift use too; `ai/css-color.ts` token
 * normalisation is separate), which reads hex, `rgb()`/`rgba()`, `hsl()`/`hsla()`, `oklch()`, `oklab()`,
 * `lab()`, `lch()`, `color(srgb …)` and every CSS named colour.
 * A wide-gamut colour is clamped into sRGB. Channels are unrounded 0-255;
 * alpha is 0-1; the result carries exactly the four `RGBA` fields. Tailwind v4
 * computes its palette to `oklch(…)`, so a parser without it skipped every
 * such element.
 */
export function parseColor(str: unknown): RGBA | null {
  if (typeof str !== 'string') return null;
  const parsed = parseCssColor(str);
  if (parsed === null) return null;
  return { r: parsed.r, g: parsed.g, b: parsed.b, a: parsed.a };
}

// ============================================================================
// Color Space Conversions
// ============================================================================

/**
 * Convert RGB to HSL.
 */
export function rgbToHsl(color: RGBA): HSL {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;

  if (d === 0) {
    return { h: 0, s: 0, l: l * 100 };
  }

  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h: number;
  if (max === r) {
    h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  } else if (max === g) {
    h = ((b - r) / d + 2) / 6;
  } else {
    h = ((r - g) / d + 4) / 6;
  }

  return { h: h * 360, s: s * 100, l: l * 100 };
}

// ============================================================================
// WCAG Luminance & Contrast
// ============================================================================

/**
 * Linearize an sRGB channel value (0-255) per WCAG 2.1.
 */
function linearize(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Compute WCAG 2.1 relative luminance (0-1).
 */
export function relativeLuminance(color: RGBA): number {
  return 0.2126 * linearize(color.r) + 0.7152 * linearize(color.g) + 0.0722 * linearize(color.b);
}

/**
 * `top` painted over `under` (source-over): channels blended by `top.a`, alpha
 * 1. Only meaningful when `under` is opaque (`a === 1`).
 */
export function compositeOver(top: RGBA, under: RGBA): RGBA {
  const a = top.a;
  return {
    r: top.r * a + under.r * (1 - a),
    g: top.g * a + under.g * (1 - a),
    b: top.b * a + under.b * (1 - a),
    a: 1,
  };
}

/**
 * WCAG contrast of foreground `fg` drawn on background `bg`, both CSS colour
 * values, or `null` (UNKNOWN) when it cannot be read: either value does not
 * parse, the foreground's alpha is 0 (nothing is painted — gradient text with
 * `background-clip: text` computes to that), or the background is not opaque
 * (what shows through it is not known here). Any other foreground is
 * composited over the background first, so 50% black on white measures as the
 * grey it renders (about 4:1), not 21:1, and very faint text measures close to
 * 1:1 — reported, not hidden.
 */
export function contrastOfColors(fg: unknown, bg: unknown): number | null {
  const f = parseColor(fg);
  const b = parseColor(bg);
  if (f === null || f.a === 0 || b === null || b.a < 1) return null;
  return contrastRatio(compositeOver(f, b), b);
}

/**
 * Compute WCAG contrast ratio between two colors, by their channels alone
 * (alpha is not read: composite first, as `contrastOfColors` does).
 * Returns a value between 1 and 21.
 */
export function contrastRatio(fg: RGBA, bg: RGBA): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ============================================================================
// Color Distance & Clustering
// ============================================================================

/**
 * Weighted Euclidean distance in RGB space.
 * Uses human perception weights (red is less perceptually distinct).
 */
export function colorDistance(c1: RGBA, c2: RGBA): number {
  const dr = c1.r - c2.r;
  const dg = c1.g - c2.g;
  const db = c1.b - c2.b;
  // Weighted: green channel is most perceptually significant
  return Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db);
}

/**
 * Cluster colors by distance using single-linkage clustering.
 * Returns array of clusters, each an array of input colors.
 */
export function clusterColors(colors: RGBA[], threshold: number = 25): RGBA[][] {
  if (colors.length === 0) return [];

  // Union-Find
  const parent = colors.map((_, i) => i);

  function find(i: number): number {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }

  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      if (colorDistance(colors[i], colors[j]) < threshold) {
        union(i, j);
      }
    }
  }

  const clusters = new Map<number, RGBA[]>();
  for (let i = 0; i < colors.length; i++) {
    const root = find(i);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root)!.push(colors[i]);
  }

  return Array.from(clusters.values());
}

/**
 * Check if a color is effectively grayscale (saturation < threshold).
 */
export function isGrayscale(color: RGBA, threshold: number = 5): boolean {
  const hsl = rgbToHsl(color);
  return hsl.s < threshold;
}

/**
 * Angular distance between two hue values (0-360), accounting for wraparound.
 */
export function hueDistance(h1: number, h2: number): number {
  const d = Math.abs(h1 - h2);
  return Math.min(d, 360 - d);
}
