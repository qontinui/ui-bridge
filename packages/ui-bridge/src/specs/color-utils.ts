/**
 * Color Utilities
 *
 * Pure-math color functions for quality metric computations.
 * No DOM or browser APIs — works in any JavaScript runtime.
 */

// ============================================================================
// Types
// ============================================================================

export interface RGBA {
  r: number; // 0-255
  g: number; // 0-255
  b: number; // 0-255
  a: number; // 0-1
}

export interface HSL {
  h: number; // 0-360
  s: number; // 0-100
  l: number; // 0-100
}

// ============================================================================
// Named Colors (CSS Level 1 + common)
// ============================================================================

const NAMED_COLORS: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  maroon: '#800000',
  olive: '#808000',
  lime: '#00ff00',
  aqua: '#00ffff',
  teal: '#008080',
  navy: '#000080',
  fuchsia: '#ff00ff',
  purple: '#800080',
  orange: '#ffa500',
  transparent: '#00000000',
};

// ============================================================================
// Parsing
// ============================================================================

/**
 * Parse a CSS color string to RGBA.
 * Supports: hex (#RGB, #RRGGBB, #RRGGBBAA), rgb(), rgba(), named colors.
 * Returns null for unparseable values.
 */
export function parseColor(str: string): RGBA | null {
  if (!str || typeof str !== 'string') return null;

  const trimmed = str.trim().toLowerCase();
  if (!trimmed || trimmed === 'none' || trimmed === 'initial' || trimmed === 'inherit') return null;

  // Named color
  if (NAMED_COLORS[trimmed]) {
    return parseColor(NAMED_COLORS[trimmed]);
  }

  // Hex
  if (trimmed.startsWith('#')) {
    return parseHex(trimmed);
  }

  // rgb() / rgba()
  if (trimmed.startsWith('rgb')) {
    return parseRgbFunction(trimmed);
  }

  return null;
}

function parseHex(hex: string): RGBA | null {
  const h = hex.slice(1);
  if (h.length === 3) {
    return {
      r: parseInt(h[0] + h[0], 16),
      g: parseInt(h[1] + h[1], 16),
      b: parseInt(h[2] + h[2], 16),
      a: 1,
    };
  }
  if (h.length === 4) {
    return {
      r: parseInt(h[0] + h[0], 16),
      g: parseInt(h[1] + h[1], 16),
      b: parseInt(h[2] + h[2], 16),
      a: parseInt(h[3] + h[3], 16) / 255,
    };
  }
  if (h.length === 6) {
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: 1,
    };
  }
  if (h.length === 8) {
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: parseInt(h.slice(6, 8), 16) / 255,
    };
  }
  return null;
}

function parseRgbFunction(str: string): RGBA | null {
  // Match rgb(R, G, B) or rgba(R, G, B, A) or rgb(R G B / A)
  const match = str.match(
    /rgba?\(\s*(\d+(?:\.\d+)?)[,%\s]+(\d+(?:\.\d+)?)[,%\s]+(\d+(?:\.\d+)?)(?:[,/\s]+(\d+(?:\.\d+)?%?))?\s*\)/
  );
  if (!match) return null;

  const r = Math.min(255, Math.max(0, Math.round(parseFloat(match[1]))));
  const g = Math.min(255, Math.max(0, Math.round(parseFloat(match[2]))));
  const b = Math.min(255, Math.max(0, Math.round(parseFloat(match[3]))));
  let a = 1;
  if (match[4] !== undefined) {
    const aStr = match[4];
    a = aStr.endsWith('%') ? parseFloat(aStr) / 100 : parseFloat(aStr);
    a = Math.min(1, Math.max(0, a));
  }

  return { r, g, b, a };
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
 * Compute WCAG contrast ratio between two colors.
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
