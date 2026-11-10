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
 *
 * Supports: hex (#RGB, #RGBA, #RRGGBB, #RRGGBBAA), rgb(), rgba(), named
 * colors, and the CSS Color 4 functions a browser's computed style serializes
 * a non-legacy colour in: `color(srgb | srgb-linear | display-p3 | xyz |
 * xyz-d50 | xyz-d65 …)`, `oklab()`, `oklch()`, `lab()`, `lch()` and `hwb()`.
 * Tailwind v4 declares its palette in `oklch`, and Chrome's computed style
 * keeps that space (`oklch(0.7 0.1 200)`), so without these a contrast check
 * could not read the colours of most current pages.
 *
 * Wide-gamut colours are converted to sRGB and clipped per channel. The
 * channels may come back fractional (the CSS Color 4 functions are not
 * quantized); `rgb()` and hex stay integers as before.
 *
 * Returns null for anything else, and for a malformed value — never a
 * default colour (the defect `ai/design-inspector.ts`'s own parser has: it
 * reads an unparsed colour as black).
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

  return parseColor4Function(trimmed);
}

// ============================================================================
// CSS Color 4 functions
// ============================================================================

/** One parsed function argument: a number, a percentage, or the `none` keyword. */
type ColorArg = { kind: 'number'; value: number } | { kind: 'percent'; value: number } | null;

/** A CSS number, unit-less or with an angle unit (hue arguments only). */
const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/;
const PERCENT_RE = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)%$/;
const ANGLE_RE = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(deg|grad|rad|turn)$/;

/** `none` in a component is a missing component: 0 in every conversion here. */
function parseArg(token: string): ColorArg | undefined {
  if (token === 'none') return null;
  if (NUMBER_RE.test(token)) return { kind: 'number', value: Number(token) };
  const pct = PERCENT_RE.exec(token);
  if (pct) return { kind: 'percent', value: Number(pct[1]) };
  return undefined;
}

/** A hue argument in degrees: a bare number, or a number with an angle unit. */
function parseHue(token: string): number | undefined {
  if (token === 'none') return 0;
  if (NUMBER_RE.test(token)) return Number(token);
  const angle = ANGLE_RE.exec(token);
  if (!angle) return undefined;
  const v = Number(angle[1]);
  switch (angle[2]) {
    case 'deg':
      return v;
    case 'grad':
      return v * 0.9;
    case 'rad':
      return (v * 180) / Math.PI;
    default:
      return v * 360;
  }
}

/** Resolve an argument against the value a 100% stands for. */
function resolveArg(arg: ColorArg, hundredPercent: number): number {
  if (arg === null) return 0;
  return arg.kind === 'percent' ? (arg.value / 100) * hundredPercent : arg.value;
}

/** Resolve the optional `/ alpha` argument: 1 when absent, clamped to [0, 1]. */
function resolveAlpha(token: string | undefined): number | undefined {
  if (token === undefined) return 1;
  const arg = parseArg(token);
  if (arg === undefined) return undefined;
  return Math.min(1, Math.max(0, resolveArg(arg, 1)));
}

/**
 * Split `name(a b c / alpha)` into its function name, its space-separated
 * components and its alpha token. The modern syntax only: CSS Color 4 gives
 * these functions no comma form.
 */
function splitFunction(
  str: string
): { name: string; components: string[]; alpha: string | undefined } | null {
  const m = /^([a-z-]+)\(\s*([^()]*?)\s*\)$/.exec(str);
  if (!m) return null;
  const [body, alphaPart, ...rest] = m[2].split('/');
  if (rest.length > 0) return null;
  const components = body.trim().split(/\s+/).filter(Boolean);
  const alpha = alphaPart === undefined ? undefined : alphaPart.trim();
  if (alpha === '') return null;
  return { name: m[1], components, alpha };
}

type Matrix3 = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];

function multiply(m: Matrix3, v: readonly [number, number, number]): [number, number, number] {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

// The CSS Color 4 sample-code matrices (https://www.w3.org/TR/css-color-4/#color-conversion-code).
const XYZ_D65_TO_LINEAR_SRGB: Matrix3 = [
  [3.2409699419045226, -1.537383177570094, -0.4986107602930034],
  [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
  [0.05563007969699366, -0.20397695888897652, 1.0569715142428786],
];
const XYZ_D50_TO_D65: Matrix3 = [
  [0.955473421488075, -0.02309845494876471, 0.06325924320057072],
  [-0.0283697093338637, 1.0099953980813041, 0.021041441191917323],
  [0.012314014864481998, -0.020507649298898964, 1.330365926242124],
];
const LINEAR_P3_TO_XYZ_D65: Matrix3 = [
  [0.4865709486482162, 0.26566769316909306, 0.1982172852343625],
  [0.2289745640697488, 0.6917385218365064, 0.079286914093745],
  [0, 0.04511338185890264, 1.043944368900976],
];
/** D50 reference white, as CSS Color 4 fixes it. */
const D50_WHITE: readonly [number, number, number] = [
  0.3457 / 0.3585,
  1,
  (1 - 0.3457 - 0.3585) / 0.3585,
];

/** The sRGB transfer function, applied to one linear-light channel. */
function encodeSrgb(c: number): number {
  const abs = Math.abs(c);
  const encoded = abs <= 0.0031308 ? 12.92 * abs : 1.055 * Math.pow(abs, 1 / 2.4) - 0.055;
  return Math.sign(c) * encoded;
}

/** The inverse sRGB transfer function (also display-p3's). */
function decodeSrgb(c: number): number {
  const abs = Math.abs(c);
  const decoded = abs <= 0.04045 ? abs / 12.92 : Math.pow((abs + 0.055) / 1.055, 2.4);
  return Math.sign(c) * decoded;
}

/** Linear-light sRGB → gamma-encoded 0-255 channels, clipped to the sRGB gamut. */
function fromLinearSrgb(rgb: readonly [number, number, number], a: number): RGBA {
  const channel = (c: number): number => Math.min(255, Math.max(0, encodeSrgb(c) * 255));
  return { r: channel(rgb[0]), g: channel(rgb[1]), b: channel(rgb[2]), a };
}

function fromXyzD65(xyz: readonly [number, number, number], a: number): RGBA {
  return fromLinearSrgb(multiply(XYZ_D65_TO_LINEAR_SRGB, xyz), a);
}

function fromLab(l: number, aAxis: number, bAxis: number, alpha: number): RGBA {
  const kappa = 24389 / 27;
  const epsilon = 216 / 24389;
  const fy = (l + 16) / 116;
  const fx = aAxis / 500 + fy;
  const fz = fy - bAxis / 200;
  const xr = fx ** 3 > epsilon ? fx ** 3 : (116 * fx - 16) / kappa;
  const yr = l > kappa * epsilon ? ((l + 16) / 116) ** 3 : l / kappa;
  const zr = fz ** 3 > epsilon ? fz ** 3 : (116 * fz - 16) / kappa;
  const xyzD50: [number, number, number] = [
    xr * D50_WHITE[0],
    yr * D50_WHITE[1],
    zr * D50_WHITE[2],
  ];
  return fromXyzD65(multiply(XYZ_D50_TO_D65, xyzD50), alpha);
}

function fromOklab(l: number, aAxis: number, bAxis: number, alpha: number): RGBA {
  const l_ = l + 0.3963377774 * aAxis + 0.2158037573 * bAxis;
  const m_ = l - 0.1055613458 * aAxis - 0.0638541728 * bAxis;
  const s_ = l - 0.0894841775 * aAxis - 1.291485548 * bAxis;
  const [lc, mc, sc] = [l_ ** 3, m_ ** 3, s_ ** 3];
  return fromLinearSrgb(
    [
      4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc,
      -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc,
      -0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc,
    ],
    alpha
  );
}

/** A hue → its fully saturated sRGB channel triple in [0, 1] (the `hsl(h 100% 50%)` colour). */
function pureHue(hue: number): [number, number, number] {
  const h = (((hue % 360) + 360) % 360) / 60;
  const f = (n: number): number => {
    const k = (n + h) % 6;
    return 1 - Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
}

/** Parse the CSS Color 4 functions {@link parseColor} documents; null on anything else. */
function parseColor4Function(str: string): RGBA | null {
  const fn = splitFunction(str);
  if (!fn) return null;
  const alpha = resolveAlpha(fn.alpha);
  if (alpha === undefined) return null;

  if (fn.name === 'color') {
    const [space, ...rest] = fn.components;
    if (rest.length !== 3) return null;
    const args = rest.map(parseArg);
    if (args.some((a) => a === undefined)) return null;
    const [x, y, z] = (args as ColorArg[]).map((a) => resolveArg(a, 1)) as [number, number, number];
    switch (space) {
      case 'srgb': {
        // Already gamma-encoded: scale and clip, with no transfer round trip.
        const channel = (c: number): number => Math.min(255, Math.max(0, c * 255));
        return { r: channel(x), g: channel(y), b: channel(z), a: alpha };
      }
      case 'srgb-linear':
        return fromLinearSrgb([x, y, z], alpha);
      case 'display-p3':
        return fromXyzD65(
          multiply(LINEAR_P3_TO_XYZ_D65, [decodeSrgb(x), decodeSrgb(y), decodeSrgb(z)]),
          alpha
        );
      case 'xyz':
      case 'xyz-d65':
        return fromXyzD65([x, y, z], alpha);
      case 'xyz-d50':
        return fromXyzD65(multiply(XYZ_D50_TO_D65, [x, y, z]), alpha);
      default:
        return null;
    }
  }

  if (fn.components.length !== 3) return null;
  const [c0, c1, c2] = fn.components;

  switch (fn.name) {
    case 'oklab':
    case 'lab': {
      const args = [c0, c1, c2].map(parseArg);
      if (args.some((a) => a === undefined)) return null;
      const [l, a, b] = args as ColorArg[];
      return fn.name === 'oklab'
        ? fromOklab(resolveArg(l, 1), resolveArg(a, 0.4), resolveArg(b, 0.4), alpha)
        : fromLab(resolveArg(l, 100), resolveArg(a, 125), resolveArg(b, 125), alpha);
    }
    case 'oklch':
    case 'lch': {
      const l = parseArg(c0);
      const c = parseArg(c1);
      const h = parseHue(c2);
      if (l === undefined || c === undefined || h === undefined) return null;
      const rad = (h * Math.PI) / 180;
      if (fn.name === 'oklch') {
        const chroma = resolveArg(c, 0.4);
        return fromOklab(resolveArg(l, 1), chroma * Math.cos(rad), chroma * Math.sin(rad), alpha);
      }
      const chroma = resolveArg(c, 150);
      return fromLab(resolveArg(l, 100), chroma * Math.cos(rad), chroma * Math.sin(rad), alpha);
    }
    case 'hwb': {
      const h = parseHue(c0);
      const w = parseArg(c1);
      const bl = parseArg(c2);
      if (h === undefined || w === undefined || bl === undefined) return null;
      // hwb() takes percentages for whiteness and blackness; a bare number is
      // read on the same 0-100 scale (CSS Color 4's "none or <number>" form).
      const white = resolveArg(w, 100) / 100;
      const black = resolveArg(bl, 100) / 100;
      if (white + black >= 1) {
        const gray = (white / (white + black)) * 255;
        return { r: gray, g: gray, b: gray, a: alpha };
      }
      const pure = pureHue(h);
      const channel = (v: number): number => (v * (1 - white - black) + white) * 255;
      return { r: channel(pure[0]), g: channel(pure[1]), b: channel(pure[2]), a: alpha };
    }
    default:
      return null;
  }
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
