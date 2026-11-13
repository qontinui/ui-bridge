/**
 * Colour parsing, canonicalisation and perceptual distance for style inference.
 *
 * Computed styles spell one colour many ways — `rgb(59, 130, 246)`,
 * `rgb(59 130 246 / 1)`, `oklch(0.623 0.214 259.8)` (what Chrome reports for a
 * colour declared in oklch), `color(srgb 0.23 0.51 0.96)` — and declared tokens
 * add hex and hsl. Inference has to count them as one value, so every colour is
 * reduced to one canonical form: lowercase `#rrggbb`, or `#rrggbbaa` when the
 * alpha is below 1.
 *
 * Distance is CIEDE2000 ΔE over CIELAB (D65), the metric a "nearest token"
 * suggestion needs: an RGB distance ranks a dark-grey pair and a saturated-blue
 * pair the same when the eye does not.
 *
 * Pure: no DOM access.
 */

/** An sRGB colour: channels 0–255 (unrounded), alpha 0–1. */
export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
  /**
   * True when the source colour lay outside the sRGB gamut (a wide-gamut
   * `oklch`/`oklab`) and its channels were clamped to fit.
   */
  outOfGamut?: boolean;
  /**
   * Out-of-gamut colours only: the unclamped linear-light sRGB channels
   * (outside 0–1). Two wide-gamut spellings of one colour share these where
   * their clamped hex cannot tell distinct colours apart.
   */
  linear?: [number, number, number];
}

/**
 * The CSS named colours (CSS Color Level 4) and `transparent`, as hex digits.
 * React Native samples carry names; computed web styles never do.
 */
const NAMED_COLORS: Record<string, string> = Object.fromEntries(
  (
    'aliceblue f0f8ff antiquewhite faebd7 aqua 00ffff aquamarine 7fffd4 azure f0ffff ' +
    'beige f5f5dc bisque ffe4c4 black 000000 blanchedalmond ffebcd blue 0000ff ' +
    'blueviolet 8a2be2 brown a52a2a burlywood deb887 cadetblue 5f9ea0 ' +
    'chartreuse 7fff00 chocolate d2691e coral ff7f50 cornflowerblue 6495ed ' +
    'cornsilk fff8dc crimson dc143c cyan 00ffff darkblue 00008b darkcyan 008b8b ' +
    'darkgoldenrod b8860b darkgray a9a9a9 darkgreen 006400 darkgrey a9a9a9 ' +
    'darkkhaki bdb76b darkmagenta 8b008b darkolivegreen 556b2f darkorange ff8c00 ' +
    'darkorchid 9932cc darkred 8b0000 darksalmon e9967a darkseagreen 8fbc8f ' +
    'darkslateblue 483d8b darkslategray 2f4f4f darkslategrey 2f4f4f ' +
    'darkturquoise 00ced1 darkviolet 9400d3 deeppink ff1493 deepskyblue 00bfff ' +
    'dimgray 696969 dimgrey 696969 dodgerblue 1e90ff firebrick b22222 ' +
    'floralwhite fffaf0 forestgreen 228b22 fuchsia ff00ff gainsboro dcdcdc ' +
    'ghostwhite f8f8ff gold ffd700 goldenrod daa520 gray 808080 green 008000 ' +
    'greenyellow adff2f grey 808080 honeydew f0fff0 hotpink ff69b4 indianred cd5c5c ' +
    'indigo 4b0082 ivory fffff0 khaki f0e68c lavender e6e6fa lavenderblush fff0f5 ' +
    'lawngreen 7cfc00 lemonchiffon fffacd lightblue add8e6 lightcoral f08080 ' +
    'lightcyan e0ffff lightgoldenrodyellow fafad2 lightgray d3d3d3 lightgreen 90ee90 ' +
    'lightgrey d3d3d3 lightpink ffb6c1 lightsalmon ffa07a lightseagreen 20b2aa ' +
    'lightskyblue 87cefa lightslategray 778899 lightslategrey 778899 ' +
    'lightsteelblue b0c4de lightyellow ffffe0 lime 00ff00 limegreen 32cd32 ' +
    'linen faf0e6 magenta ff00ff maroon 800000 mediumaquamarine 66cdaa ' +
    'mediumblue 0000cd mediumorchid ba55d3 mediumpurple 9370db mediumseagreen 3cb371 ' +
    'mediumslateblue 7b68ee mediumspringgreen 00fa9a mediumturquoise 48d1cc ' +
    'mediumvioletred c71585 midnightblue 191970 mintcream f5fffa mistyrose ffe4e1 ' +
    'moccasin ffe4b5 navajowhite ffdead navy 000080 oldlace fdf5e6 olive 808000 ' +
    'olivedrab 6b8e23 orange ffa500 orangered ff4500 orchid da70d6 ' +
    'palegoldenrod eee8aa palegreen 98fb98 paleturquoise afeeee palevioletred db7093 ' +
    'papayawhip ffefd5 peachpuff ffdab9 peru cd853f pink ffc0cb plum dda0dd ' +
    'powderblue b0e0e6 purple 800080 rebeccapurple 663399 red ff0000 rosybrown bc8f8f ' +
    'royalblue 4169e1 saddlebrown 8b4513 salmon fa8072 sandybrown f4a460 ' +
    'seagreen 2e8b57 seashell fff5ee sienna a0522d silver c0c0c0 skyblue 87ceeb ' +
    'slateblue 6a5acd slategray 708090 slategrey 708090 snow fffafa ' +
    'springgreen 00ff7f steelblue 4682b4 tan d2b48c teal 008080 thistle d8bfd8 ' +
    'tomato ff6347 turquoise 40e0d0 violet ee82ee wheat f5deb3 white ffffff ' +
    'whitesmoke f5f5f5 yellow ffff00 yellowgreen 9acd32 transparent 00000000 '
  )
    .trim()
    .split(/\s+/)
    .reduce<Array<[string, string]>>((pairs, word, i, all) => {
      if (i % 2 === 0) pairs.push([word, `#${all[i + 1]}`]);
      return pairs;
    }, [])
);

const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** A number, or a percentage of `percentScale`; `none` reads as 0 (CSS Color 4). */
function channel(token: string, percentScale: number): number | null {
  const t = token.trim().toLowerCase();
  if (t === 'none') return 0;
  if (t.endsWith('%')) {
    const n = t.slice(0, -1);
    return NUMBER.test(n) ? (parseFloat(n) / 100) * percentScale : null;
  }
  return NUMBER.test(t) ? parseFloat(t) : null;
}

/** An alpha token: a 0–1 number or a percentage. */
function alphaOf(token: string | undefined): number | null {
  if (token === undefined) return 1;
  const a = channel(token, 1);
  return a === null ? null : clamp(a, 0, 1);
}

/** A hue token in degrees (`deg`, `turn`, `rad`, `grad`, or unitless). */
function hueOf(token: string): number | null {
  const t = token.trim().toLowerCase();
  if (t === 'none') return 0;
  const m = /^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)(deg|turn|rad|grad)?$/.exec(t);
  if (!m) return null;
  const n = parseFloat(m[1]);
  switch (m[2]) {
    case 'turn':
      return n * 360;
    case 'rad':
      return (n * 180) / Math.PI;
    case 'grad':
      return n * 0.9;
    default:
      return n;
  }
}

/**
 * The channel list of a functional colour: `a, b, c[, d]` or `a b c[ / d]`.
 * Returns the three channels and the optional alpha token.
 */
function functionArgs(inner: string): { channels: string[]; alpha?: string } | null {
  const body = inner.trim();
  if (body.includes(',')) {
    const parts = body.split(',').map((p) => p.trim());
    if (parts.length !== 3 && parts.length !== 4) return null;
    return { channels: parts.slice(0, 3), alpha: parts[3] };
  }
  const [main, alpha, extra] = body.split('/').map((p) => p.trim());
  if (extra !== undefined) return null;
  const channels = main.split(/\s+/).filter(Boolean);
  if (channels.length !== 3) return null;
  return { channels, alpha };
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s, 0, 1);
  const light = clamp(l, 0, 1);
  const k = (n: number): number => (n + hue / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number): number => light - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** Linear-light sRGB (0–1) → gamma-encoded 0–255. */
function encodeSrgb(linear: number): number {
  const v = linear <= 0.0031308 ? 12.92 * linear : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
  return clamp(v, 0, 1) * 255;
}

/** Gamma-encoded 0–255 → linear-light 0–1. */
function decodeSrgb(channel255: number): number {
  const v = channel255 / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** Linear-light channels this far outside 0–1 count as out of gamut (float noise below). */
const GAMUT_EPSILON = 1e-4;

/**
 * CIELAB (D50, the reference white CSS `lab()`/`lch()` use) → sRGB (0–255,
 * clamped) plus whether clamping was needed: Lab → XYZ D50 → Bradford → XYZ
 * D65 → linear sRGB (CSS Color 4 sample code matrices).
 */
function cssLabToRgb(
  L: number,
  a: number,
  b: number
): [number, number, number, boolean, [number, number, number]] {
  const kappa = 24389 / 27;
  const epsilon = 216 / 24389;
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inv = (f: number): number => (f * f * f > epsilon ? f * f * f : (116 * f - 16) / kappa);
  const x50 = inv(fx) * 0.96422;
  const y50 = L > kappa * epsilon ? fy * fy * fy : L / kappa;
  const z50 = inv(fz) * 0.82521;
  const x = 0.9554734527042182 * x50 - 0.023098536874261423 * y50 + 0.0632593086610217 * z50;
  const y = -0.028369706963208136 * x50 + 1.0099954580058226 * y50 + 0.021041398966943008 * z50;
  const z = 0.012314001688319899 * x50 - 0.020507696433477912 * y50 + 1.3303659366080753 * z50;
  const linear = [
    3.2409699419045226 * x - 1.537383177570094 * y - 0.4986107602930034 * z,
    -0.9692436362808796 * x + 1.8759675015077202 * y + 0.04155505740717559 * z,
    0.05563007969699366 * x - 0.20397695888897652 * y + 1.0569715142428786 * z,
  ];
  const outOfGamut = linear.some((v) => v < -GAMUT_EPSILON || v > 1 + GAMUT_EPSILON);
  return [
    encodeSrgb(linear[0]),
    encodeSrgb(linear[1]),
    encodeSrgb(linear[2]),
    outOfGamut,
    linear as [number, number, number],
  ];
}

/**
 * OKLab → sRGB (0–255, clamped to gamut) plus whether clamping was needed.
 * Björn Ottosson's published matrices.
 */
function oklabToRgb(
  L: number,
  a: number,
  b: number
): [number, number, number, boolean, [number, number, number]] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const outOfGamut = linear.some((v) => v < -GAMUT_EPSILON || v > 1 + GAMUT_EPSILON);
  return [
    encodeSrgb(linear[0]),
    encodeSrgb(linear[1]),
    encodeSrgb(linear[2]),
    outOfGamut,
    linear as [number, number, number],
  ];
}

function parseHex(hex: string): RgbaColor | null {
  if (!/^#[0-9a-f]+$/i.test(hex)) return null;
  let digits = hex.slice(1);
  if (digits.length === 3 || digits.length === 4) {
    digits = digits
      .split('')
      .map((d) => d + d)
      .join('');
  }
  if (digits.length !== 6 && digits.length !== 8) return null;
  const n = (i: number): number => parseInt(digits.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: digits.length === 8 ? n(6) / 255 : 1 };
}

/**
 * Parse a CSS colour string. Returns `null` for anything this parser does not
 * understand (`currentcolor`, `display-p3`, system colours, most named colours),
 * which callers keep verbatim rather than guess at.
 */
export function parseColor(input: string): RgbaColor | null {
  const value = input.trim().toLowerCase();
  if (value === '') return null;
  if (value.startsWith('#')) return parseHex(value);
  const named = Object.prototype.hasOwnProperty.call(NAMED_COLORS, value)
    ? NAMED_COLORS[value]
    : undefined;
  if (named) return parseHex(named);

  const fn = /^([a-z]+)\((.*)\)$/.exec(value);
  if (!fn) return null;
  const [, name, inner] = fn;

  if (name === 'color') {
    // color(srgb r g b [/ a]) — sRGB channels as 0–1 numbers or percentages.
    const m = /^(srgb|srgb-linear)\s+(.*)$/.exec(inner.trim());
    if (!m) return null;
    const args = functionArgs(m[2]);
    if (!args) return null;
    const ch = args.channels.map((c) => channel(c, 1));
    const a = alphaOf(args.alpha);
    if (ch.some((c) => c === null) || a === null) return null;
    const [r, g, b] = ch as number[];
    const enc = m[1] === 'srgb-linear' ? encodeSrgb : (v: number): number => clamp(v, 0, 1) * 255;
    return { r: enc(r), g: enc(g), b: enc(b), a };
  }

  const args = functionArgs(inner);
  if (!args) return null;
  const a = alphaOf(args.alpha);
  if (a === null) return null;
  const [c0, c1, c2] = args.channels;

  switch (name) {
    case 'rgb':
    case 'rgba': {
      const ch = [c0, c1, c2].map((c) => channel(c, 255));
      if (ch.some((c) => c === null)) return null;
      const [r, g, b] = (ch as number[]).map((c) => clamp(c, 0, 255));
      return { r, g, b, a };
    }
    case 'hsl':
    case 'hsla': {
      const h = hueOf(c0);
      const s = channel(c1, 1);
      const l = channel(c2, 1);
      if (h === null || s === null || l === null) return null;
      // Legacy and modern hsl both take s/l as percentages; a bare number is a
      // percentage too in CSS Color 4 (`hsl(210 50 40)`).
      const sat = c1.trim().endsWith('%') ? s : s / 100;
      const light = c2.trim().endsWith('%') ? l : l / 100;
      const [r, g, b] = hslToRgb(h, sat, light);
      return { r, g, b, a };
    }
    case 'oklch': {
      const L = channel(c0, 1);
      const C = channel(c1, 0.4);
      const h = hueOf(c2);
      if (L === null || C === null || h === null) return null;
      const rad = (h * Math.PI) / 180;
      const [r, g, b, outOfGamut, linear] = oklabToRgb(L, C * Math.cos(rad), C * Math.sin(rad));
      return outOfGamut ? { r, g, b, a, outOfGamut, linear } : { r, g, b, a };
    }
    case 'lab': {
      const L = channel(c0, 100);
      const A = channel(c1, 125);
      const B = channel(c2, 125);
      if (L === null || A === null || B === null) return null;
      const [r, g, b, outOfGamut, linear] = cssLabToRgb(L, A, B);
      return outOfGamut ? { r, g, b, a, outOfGamut, linear } : { r, g, b, a };
    }
    case 'lch': {
      const L = channel(c0, 100);
      const C = channel(c1, 150);
      const h = hueOf(c2);
      if (L === null || C === null || h === null) return null;
      const rad = (h * Math.PI) / 180;
      const [r, g, b, outOfGamut, linear] = cssLabToRgb(L, C * Math.cos(rad), C * Math.sin(rad));
      return outOfGamut ? { r, g, b, a, outOfGamut, linear } : { r, g, b, a };
    }
    case 'oklab': {
      const L = channel(c0, 1);
      const A = channel(c1, 0.4);
      const B = channel(c2, 0.4);
      if (L === null || A === null || B === null) return null;
      const [r, g, b, outOfGamut, linear] = oklabToRgb(L, A, B);
      return outOfGamut ? { r, g, b, a, outOfGamut, linear } : { r, g, b, a };
    }
    default:
      return null;
  }
}

function hex2(n: number): string {
  return Math.round(clamp(n, 0, 255))
    .toString(16)
    .padStart(2, '0');
}

/** The canonical spelling: `#rrggbb`, or `#rrggbbaa` when alpha < 1. */
export function toCanonicalHex(color: RgbaColor): string {
  const base = `#${hex2(color.r)}${hex2(color.g)}${hex2(color.b)}`;
  const alpha = Math.round(clamp(color.a, 0, 1) * 255);
  return alpha >= 255 ? base : `${base}${hex2(alpha)}`;
}

/** Decimal places of a wide-gamut key's channels. */
const WIDE_GAMUT_PLACES = 4;
/** Channel difference within which two wide-gamut keys name one colour. */
const WIDE_GAMUT_TOLERANCE = 0.0015;

/**
 * The unclamped identity of an out-of-gamut colour, as a CSS colour:
 * `color(srgb-linear r g b / a)` with channels outside 0–1. `null` for a
 * colour inside sRGB, whose canonical hex already identifies it.
 */
export function wideGamutKey(color: RgbaColor): string | null {
  if (!color.outOfGamut || !color.linear) return null;
  const [r, g, b] = color.linear.map((n) => {
    const v = Number(n.toFixed(WIDE_GAMUT_PLACES));
    return Object.is(v, -0) ? 0 : v;
  });
  const a = Number(clamp(color.a, 0, 1).toFixed(3));
  return `color(srgb-linear ${r} ${g} ${b} / ${a})`;
}

/** Whether two `wideGamutKey`s name one colour (channels within 0.0015, alpha equal). */
export function sameWideGamutKey(a: string, b: string): boolean {
  const nums = (k: string): number[] | null => {
    const m = /^color\(srgb-linear (\S+) (\S+) (\S+) \/ (\S+)\)$/.exec(k);
    return m ? m.slice(1).map(Number) : null;
  };
  const na = nums(a);
  const nb = nums(b);
  if (!na || !nb || na.some(isNaN) || nb.some(isNaN)) return false;
  if (na[3] !== nb[3]) return false;
  return [0, 1, 2].every((i) => Math.abs(na[i] - nb[i]) <= WIDE_GAMUT_TOLERANCE);
}

/** Parse and canonicalise in one step; `null` when the input is not understood. */
export function canonicalColor(input: string): string | null {
  const parsed = parseColor(input);
  return parsed ? toCanonicalHex(parsed) : null;
}

/** CIELAB (D65) of an sRGB colour; alpha is ignored. */
export function rgbToLab(color: RgbaColor): [number, number, number] {
  const r = decodeSrgb(color.r);
  const g = decodeSrgb(color.g);
  const b = decodeSrgb(color.b);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/**
 * CIEDE2000 colour difference between two CIELAB colours (kL = kC = kH = 1).
 * Sharma, Wu & Dalal (2005), "The CIEDE2000 Color-Difference Formula".
 */
export function deltaE2000(lab1: [number, number, number], lab2: [number, number, number]): number {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const Cbar7 = Math.pow(Cbar, 7);
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + Math.pow(25, 7))));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hp = (a: number, b: number): number => {
    if (a === 0 && b === 0) return 0;
    const h = Math.atan2(b, a) / rad;
    return h < 0 ? h + 360 : h;
  };
  const h1p = hp(a1p, b1);
  const h2p = hp(a2p, b2);

  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);

  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;
  let hbarp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2;
    else if (h1p + h2p < 360) hbarp = (h1p + h2p + 360) / 2;
    else hbarp = (h1p + h2p - 360) / 2;
  }
  const T =
    1 -
    0.17 * Math.cos((hbarp - 30) * rad) +
    0.24 * Math.cos(2 * hbarp * rad) +
    0.32 * Math.cos((3 * hbarp + 6) * rad) -
    0.2 * Math.cos((4 * hbarp - 63) * rad);
  const dTheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2));
  const Cbarp7 = Math.pow(Cbarp, 7);
  const RC = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + Math.pow(25, 7)));
  const SL = 1 + (0.015 * Math.pow(Lbarp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbarp - 50, 2));
  const SC = 1 + 0.045 * Cbarp;
  const SH = 1 + 0.015 * Cbarp * T;
  const RT = -Math.sin(2 * dTheta * rad) * RC;
  return Math.sqrt(
    Math.pow(dLp / SL, 2) +
      Math.pow(dCp / SC, 2) +
      Math.pow(dHp / SH, 2) +
      RT * (dCp / SC) * (dHp / SH)
  );
}

/** CIEDE2000 between two canonical (or any parseable) colour strings; `null` if either is unparseable. */
export function colorDistance(a: string, b: string): number | null {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return null;
  return deltaE2000(rgbToLab(ca), rgbToLab(cb));
}
