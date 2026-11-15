/**
 * Colour normalisation: a token's declared colour in the form a browser
 * serialises a computed colour (`rgb(r, g, b)` / `rgba(r, g, b, a)`), so a
 * computed value and a token value can be compared as text.
 *
 * Handled: hex (3/4/6/8 digits), `rgb()`/`rgba()` (comma or space syntax,
 * numbers or percentages, `/` alpha), `hsl()`/`hsla()`, the 148 named colours
 * and `transparent`. Not handled: `oklch()`, `oklab()`, `lab()`, `lch()`,
 * `color()`, `color-mix()` and system colours — a browser serialises those in
 * their own space, so a token declared that way is compared as written only.
 *
 * Alpha follows the CSSOM serialisation: the alpha is quantised to a byte and
 * written with two decimals when that round-trips to the same byte, else three
 * (`#1f4e8c80` → `0.5`, not `0.502`).
 */

/** The CSS named colours (CSS Color 4), name → hex; data from the MIT `color-name` package. */
const NAMED_COLOR_TABLE =
  'aliceblue:f0f8ff antiquewhite:faebd7 aqua:00ffff aquamarine:7fffd4 azure:f0ffff ' +
  'beige:f5f5dc bisque:ffe4c4 black:000000 blanchedalmond:ffebcd blue:0000ff blueviolet:8a2be2 ' +
  'brown:a52a2a burlywood:deb887 cadetblue:5f9ea0 chartreuse:7fff00 chocolate:d2691e ' +
  'coral:ff7f50 cornflowerblue:6495ed cornsilk:fff8dc crimson:dc143c cyan:00ffff ' +
  'darkblue:00008b darkcyan:008b8b darkgoldenrod:b8860b darkgray:a9a9a9 darkgreen:006400 ' +
  'darkgrey:a9a9a9 darkkhaki:bdb76b darkmagenta:8b008b darkolivegreen:556b2f darkorange:ff8c00 ' +
  'darkorchid:9932cc darkred:8b0000 darksalmon:e9967a darkseagreen:8fbc8f darkslateblue:483d8b ' +
  'darkslategray:2f4f4f darkslategrey:2f4f4f darkturquoise:00ced1 darkviolet:9400d3 ' +
  'deeppink:ff1493 deepskyblue:00bfff dimgray:696969 dimgrey:696969 dodgerblue:1e90ff ' +
  'firebrick:b22222 floralwhite:fffaf0 forestgreen:228b22 fuchsia:ff00ff gainsboro:dcdcdc ' +
  'ghostwhite:f8f8ff gold:ffd700 goldenrod:daa520 gray:808080 green:008000 greenyellow:adff2f ' +
  'grey:808080 honeydew:f0fff0 hotpink:ff69b4 indianred:cd5c5c indigo:4b0082 ivory:fffff0 ' +
  'khaki:f0e68c lavender:e6e6fa lavenderblush:fff0f5 lawngreen:7cfc00 lemonchiffon:fffacd ' +
  'lightblue:add8e6 lightcoral:f08080 lightcyan:e0ffff lightgoldenrodyellow:fafad2 ' +
  'lightgray:d3d3d3 lightgreen:90ee90 lightgrey:d3d3d3 lightpink:ffb6c1 lightsalmon:ffa07a ' +
  'lightseagreen:20b2aa lightskyblue:87cefa lightslategray:778899 lightslategrey:778899 ' +
  'lightsteelblue:b0c4de lightyellow:ffffe0 lime:00ff00 limegreen:32cd32 linen:faf0e6 ' +
  'magenta:ff00ff maroon:800000 mediumaquamarine:66cdaa mediumblue:0000cd mediumorchid:ba55d3 ' +
  'mediumpurple:9370db mediumseagreen:3cb371 mediumslateblue:7b68ee mediumspringgreen:00fa9a ' +
  'mediumturquoise:48d1cc mediumvioletred:c71585 midnightblue:191970 mintcream:f5fffa ' +
  'mistyrose:ffe4e1 moccasin:ffe4b5 navajowhite:ffdead navy:000080 oldlace:fdf5e6 olive:808000 ' +
  'olivedrab:6b8e23 orange:ffa500 orangered:ff4500 orchid:da70d6 palegoldenrod:eee8aa ' +
  'palegreen:98fb98 paleturquoise:afeeee palevioletred:db7093 papayawhip:ffefd5 ' +
  'peachpuff:ffdab9 peru:cd853f pink:ffc0cb plum:dda0dd powderblue:b0e0e6 purple:800080 ' +
  'rebeccapurple:663399 red:ff0000 rosybrown:bc8f8f royalblue:4169e1 saddlebrown:8b4513 ' +
  'salmon:fa8072 sandybrown:f4a460 seagreen:2e8b57 seashell:fff5ee sienna:a0522d silver:c0c0c0 ' +
  'skyblue:87ceeb slateblue:6a5acd slategray:708090 slategrey:708090 snow:fffafa ' +
  'springgreen:00ff7f steelblue:4682b4 tan:d2b48c teal:008080 thistle:d8bfd8 tomato:ff6347 ' +
  'turquoise:40e0d0 violet:ee82ee wheat:f5deb3 white:ffffff whitesmoke:f5f5f5 yellow:ffff00 ' +
  'yellowgreen:9acd32 ';

const NAMED_COLORS: ReadonlyMap<string, string> = new Map(
  NAMED_COLOR_TABLE.trim()
    .split(/\s+/)
    .map((entry) => entry.split(':') as [string, string])
);

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** CSSOM alpha serialisation for a 0..1 alpha. */
function serializeAlpha(alpha: number): number {
  const byte = Math.round(clamp(alpha, 0, 1) * 255);
  const twoDecimals = Math.round((byte / 255) * 100) / 100;
  if (Math.round(twoDecimals * 255) === byte) return twoDecimals;
  return Math.round((byte / 255) * 1000) / 1000;
}

function serialize(r: number, g: number, b: number, alpha: number): string {
  const [R, G, B] = [r, g, b].map((c) => Math.round(clamp(c, 0, 255)));
  const a = serializeAlpha(alpha);
  return a === 1 ? `rgb(${R}, ${G}, ${B})` : `rgba(${R}, ${G}, ${B}, ${a})`;
}

function hexColor(hex: string): string | null {
  if (!/^[0-9a-f]+$/.test(hex) || ![3, 4, 6, 8].includes(hex.length)) return null;
  const digits = hex.length <= 4 ? hex.split('').map((c) => c + c) : (hex.match(/../g) ?? []);
  const [r, g, b] = digits.slice(0, 3).map((d) => parseInt(d, 16));
  const alpha = digits.length === 4 ? parseInt(digits[3], 16) / 255 : 1;
  return serialize(r, g, b, alpha);
}

/** A number, or a percentage of `percentOf`; NaN when neither. */
function channel(text: string, percentOf: number): number {
  return text.endsWith('%') ? (Number(text.slice(0, -1)) / 100) * percentOf : Number(text);
}

/** The arguments of a colour function: `a b c [/ d]` or `a, b, c[, d]`. */
function colorArgs(body: string): string[] | null {
  const parts = body
    .replace(/\//g, ' / ')
    .split(/[\s,]+/)
    .filter((p) => p !== '');
  const slash = parts.indexOf('/');
  const args = slash >= 0 ? [...parts.slice(0, slash), ...parts.slice(slash + 1)] : parts;
  return args.length === 3 || args.length === 4 ? args : null;
}

function rgbColor(body: string): string | null {
  const args = colorArgs(body);
  if (!args) return null;
  const [r, g, b] = args.slice(0, 3).map((a) => channel(a, 255));
  const alpha = args[3] === undefined ? 1 : channel(args[3], 1);
  if ([r, g, b, alpha].some((n) => !Number.isFinite(n))) return null;
  return serialize(r, g, b, alpha);
}

/** A hue in degrees: unitless or `deg`, `turn`, `rad`, `grad`; `null` otherwise. */
function hueDegrees(text: string): number | null {
  const m = /^(-?[\d.]+)(deg|turn|rad|grad)?$/.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
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

function hslColor(body: string): string | null {
  const args = colorArgs(body);
  if (!args) return null;
  const degrees = hueDegrees(args[0]);
  if (degrees === null) return null;
  const h = (((degrees % 360) + 360) % 360) / 360;
  const s = clamp(parseFloat(args[1]) / 100, 0, 1);
  const l = clamp(parseFloat(args[2]) / 100, 0, 1);
  const alpha = args[3] === undefined ? 1 : channel(args[3], 1);
  if ([h, s, l, alpha].some((n) => !Number.isFinite(n))) return null;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number): number => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  return serialize(hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255, alpha);
}

/** `value` as a browser serialises the computed colour, or `null` when it is no colour handled here. */
export function normalizeColor(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (v === 'transparent') return 'rgba(0, 0, 0, 0)';
  if (v.startsWith('#')) return hexColor(v.slice(1));
  const named = NAMED_COLORS.get(v);
  if (named) return hexColor(named);
  const fn = /^(rgba?|hsla?)\((.*)\)$/.exec(v);
  if (!fn) return null;
  return fn[1].startsWith('rgb') ? rgbColor(fn[2]) : hslColor(fn[2]);
}
