/**
 * The pixel density of the srcset candidate an `<img>` is displaying.
 *
 * A browser reports `naturalWidth` / `naturalHeight` DENSITY-CORRECTED for a
 * srcset candidate (HTML "density-corrected natural width"): the 800x600 file
 * of a `2x` candidate reads 400x300, and so does an `800w` candidate laid out
 * at a 400px source size. The media facts report the FILE's pixels, so the
 * capture multiplies the browser's numbers back by this density.
 *
 * The candidate is found by matching `currentSrc` (the URL the browser chose)
 * against every candidate the element offers — its own `srcset` and `src`,
 * and each `<source srcset>` of its `<picture>`. A `w` descriptor's density is
 * `w / source size`, the source size being the first `sizes` entry whose media
 * condition matches (absent `sizes` = `100vw`; `sizes="auto"` = the layout
 * width).
 *
 * When the density cannot be established — `currentSrc` matches no candidate,
 * two matching candidates disagree, or a `sizes` length this build cannot
 * evaluate (`calc()`, font-relative units, no `matchMedia`) — the answer is a
 * typed reason, never a guessed `1`.
 */

import type { UnknownCode } from '../observation/observation';

/** One parsed srcset candidate. Exactly one of `density` / `width` is set. */
export interface SrcsetCandidate {
  url: string;
  /** An `x` descriptor, or `1` for a candidate with no descriptor. */
  density?: number;
  /** A `w` descriptor. */
  width?: number;
}

export type CandidateDensity = { density: number } | { code: UnknownCode; reason: string };

const WHITESPACE = /[\t\n\f\r ]/;

/**
 * A valid HTML floating-point number (non-negative here: a density is > 0).
 * `1.`, `+1`, `1.e2` and `.` are not one, and the browser drops a candidate
 * that carries them.
 */
const HTML_FLOAT = /^(\d+(\.\d+)?|\.\d+)(e[+-]?\d+)?$/i;

/**
 * Parse a srcset attribute per the HTML "parse a srcset attribute" algorithm
 * (URLs may contain commas; descriptors may contain parenthesised commas).
 * A candidate with an invalid descriptor list is dropped, as the browser drops
 * it.
 */
export function parseSrcset(input: string): SrcsetCandidate[] {
  const out: SrcsetCandidate[] = [];
  let pos = 0;
  const n = input.length;
  while (pos < n) {
    while (pos < n && (WHITESPACE.test(input[pos]!) || input[pos] === ',')) pos++;
    if (pos >= n) break;
    let end = pos;
    while (end < n && !WHITESPACE.test(input[end]!)) end++;
    let url = input.slice(pos, end);
    pos = end;
    const descriptors: string[] = [];
    if (url.endsWith(',')) {
      url = url.replace(/,+$/, '');
    } else {
      // Collect descriptor tokens up to the next comma outside parentheses.
      let token = '';
      let inParens = false;
      while (pos < n) {
        const c = input[pos]!;
        if (inParens) {
          token += c;
          if (c === ')') inParens = false;
        } else if (WHITESPACE.test(c)) {
          if (token) descriptors.push(token);
          token = '';
        } else if (c === ',') {
          pos++;
          break;
        } else {
          token += c;
          if (c === '(') inParens = true;
        }
        pos++;
      }
      if (token) descriptors.push(token);
    }
    if (!url) continue;
    const candidate = parseDescriptors(url, descriptors);
    if (candidate) out.push(candidate);
  }
  return out;
}

function parseDescriptors(url: string, descriptors: string[]): SrcsetCandidate | undefined {
  let density: number | undefined;
  let width: number | undefined;
  let height = false;
  for (const d of descriptors) {
    const last = d.slice(-1);
    const body = d.slice(0, -1);
    if (last === 'w' && /^\d+$/.test(body)) {
      if (width !== undefined || density !== undefined) return undefined;
      width = parseInt(body, 10);
      if (!(width > 0)) return undefined;
    } else if (last === 'x' && HTML_FLOAT.test(body)) {
      if (width !== undefined || density !== undefined || height) return undefined;
      density = parseFloat(body);
      if (!(density > 0)) return undefined;
    } else if (last === 'h' && /^\d+$/.test(body)) {
      if (height || density !== undefined) return undefined;
      height = true;
    } else {
      return undefined;
    }
  }
  // An `h` descriptor is only valid beside a `w`.
  if (height && width === undefined) return undefined;
  if (width !== undefined) return { url, width };
  return { url, density: density ?? 1 };
}

function absoluteUrl(url: string): string | undefined {
  try {
    const base =
      typeof document !== 'undefined' && document.baseURI
        ? document.baseURI
        : typeof location !== 'undefined'
          ? location.href
          : 'http://localhost/';
    return new URL(url, base).href;
  } catch {
    return undefined;
  }
}

type Length = { px: number } | { code: UnknownCode; reason: string };

function matchMediaOf(): ((q: string) => MediaQueryList) | undefined {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia.bind(window)
    : undefined;
}

/**
 * The viewport extent `sizes` lengths resolve against, as media queries see
 * it — confirmed through `matchMedia`, since `innerWidth` and the layout
 * viewport differ by a classic scrollbar and the two disagree about which one
 * a `vw` means.
 */
function viewportExtent(axis: 'width' | 'height'): number | undefined {
  const mm = matchMediaOf();
  if (!mm || typeof window === 'undefined') return undefined;
  const root = typeof document !== 'undefined' ? document.documentElement : undefined;
  const options =
    axis === 'width'
      ? [window.innerWidth, root?.clientWidth]
      : [window.innerHeight, root?.clientHeight];
  for (const v of options) {
    if (typeof v === 'number' && v > 0 && mm(`(${axis}: ${v}px)`).matches) return v;
  }
  return undefined;
}

/** CSS px per absolute length unit. */
const ABSOLUTE_UNITS: Readonly<Record<string, number>> = {
  px: 1,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
  pt: 96 / 72,
  pc: 16,
};

/** Viewport units this build resolves against the confirmed viewport. */
const VIEWPORT_UNITS = new Set(['vw', 'vh', 'vmin', 'vmax']);

/**
 * Length units the browser accepts in `sizes` that this build cannot resolve:
 * font-relative ones (they resolve against the initial font size, which the
 * page cannot read), the small/large/dynamic and logical viewport variants,
 * and container units.
 */
const UNEVALUABLE_UNITS = new Set([
  'em',
  'rem',
  'ex',
  'rex',
  'cap',
  'rcap',
  'ch',
  'rch',
  'ic',
  'ric',
  'lh',
  'rlh',
  'vi',
  'vb',
  'svw',
  'svh',
  'svi',
  'svb',
  'svmin',
  'svmax',
  'lvw',
  'lvh',
  'lvi',
  'lvb',
  'lvmin',
  'lvmax',
  'dvw',
  'dvh',
  'dvi',
  'dvb',
  'dvmin',
  'dvmax',
  'cqw',
  'cqh',
  'cqi',
  'cqb',
  'cqmin',
  'cqmax',
]);

/** A CSS math function: valid in `sizes`, not evaluated by this build. */
const MATH_FUNCTION = /^(calc|min|max|clamp)\(.*\)$/;

/**
 * One `sizes` source-size value, resolved to CSS px; or `invalid` (the
 * browser drops the entry and reads the next one: a negative or percentage
 * length, an unknown unit, a unitless non-zero, garbage); or a typed unknown
 * for a valid length this build cannot evaluate.
 */
function resolveLength(raw: string): Length | 'invalid' {
  const s = raw.trim().toLowerCase();
  if (MATH_FUNCTION.test(s)) {
    return { code: 'capability_unavailable_in_build', reason: 'a sizes math function' };
  }
  const m = /^(\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?([a-z]*)$/.exec(s);
  if (!m) return 'invalid';
  const value = parseFloat(s);
  const unit = m[2]!;
  if (unit === '') return value === 0 ? { px: 0 } : 'invalid';
  const absolute = ABSOLUTE_UNITS[unit];
  if (absolute !== undefined) return { px: value * absolute };
  if (UNEVALUABLE_UNITS.has(unit)) {
    return {
      code: 'capability_unavailable_in_build',
      reason: `a sizes length in ${unit}, which this build cannot resolve`,
    };
  }
  if (!VIEWPORT_UNITS.has(unit)) return 'invalid';
  const w = viewportExtent('width');
  const h = unit === 'vw' ? undefined : viewportExtent('height');
  const extent =
    unit === 'vw'
      ? w
      : unit === 'vh'
        ? h
        : w === undefined || h === undefined
          ? undefined
          : unit === 'vmin'
            ? Math.min(w, h)
            : Math.max(w, h);
  if (extent === undefined) {
    return {
      code: 'capability_unavailable_in_build',
      reason: 'the viewport extent media queries use could not be confirmed',
    };
  }
  return { px: (value * extent) / 100 };
}

/** Split `sizes` on top-level commas (a media condition may hold parenthesised ones). */
function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const c of input) {
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    if (c === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/**
 * The source size a `sizes` attribute selects (absent = `100vw`), per HTML's
 * "parse a sizes attribute". Entries are `<media-condition>? <length>`; the
 * first VALID entry whose condition matches wins, and an invalid one is
 * skipped as the browser skips it. `auto` counts only as the FIRST entry of a
 * lazy-loading image (`autoWidth` is then its layout width); anywhere else it
 * is an invalid entry.
 */
export function resolveSourceSize(
  sizes: string | null,
  autoWidth: number | undefined,
  lazy = false
): Length {
  const entries = sizes === null || sizes.trim() === '' ? [] : splitTopLevel(sizes);
  for (const [i, entry] of entries.entries()) {
    // The length is the last component: everything after the final top-level
    // whitespace that is outside parentheses.
    let depth = 0;
    let split = -1;
    for (let j = 0; j < entry.length; j++) {
      const c = entry[j]!;
      if (c === '(') depth++;
      else if (c === ')') depth = Math.max(0, depth - 1);
      else if (depth === 0 && WHITESPACE.test(c)) split = j;
    }
    const condition = split === -1 ? '' : entry.slice(0, split).trim();
    const length = split === -1 ? entry : entry.slice(split + 1);
    if (length.trim().toLowerCase() === 'auto') {
      if (i !== 0 || condition || !lazy) continue;
      if (autoWidth !== undefined && autoWidth > 0) return { px: autoWidth };
      return { code: 'input_missing', reason: 'sizes=auto with no layout width' };
    }
    const resolved = resolveLength(length);
    if (resolved === 'invalid') continue;
    if (condition) {
      const mm = matchMediaOf();
      if (!mm) {
        return {
          code: 'capability_unavailable_in_build',
          reason: 'sizes has a media condition and the engine has no matchMedia',
        };
      }
      if (!mm(condition).matches) continue;
    }
    return resolved;
  }
  // No entry matched: the spec's fallback is 100vw.
  return resolveLength('100vw') as Length;
}

/** One source set the browser could have selected: a `<source>`'s, or the img's own. */
interface SourceSet {
  candidates: SrcsetCandidate[];
  sizes: string | null;
}

/** Drop later candidates repeating an earlier density, as "update the source set" does. */
function dedupeDensities(candidates: SrcsetCandidate[]): SrcsetCandidate[] {
  const seen = new Set<number>();
  return candidates.filter((c) => {
    if (c.density === undefined) return true;
    if (seen.has(c.density)) return false;
    seen.add(c.density);
    return true;
  });
}

/**
 * The density of the candidate `img` is displaying (see the module doc).
 * `layoutWidth` is the image's content-box width, for `sizes="auto"`.
 *
 * The candidates follow HTML's "update the source set": each `<picture>`
 * `<source>` whose `media` can match offers its own srcset (never the img's
 * `src`); the img offers its srcset, plus `src` as a `1x` candidate ONLY when
 * that srcset has no `w` descriptor and no `1x` candidate. So next/image's
 * `src` (its largest candidate's URL) is not a second, 1x reading of the 2x
 * file.
 */
export function displayedCandidateDensity(
  img: HTMLImageElement,
  layoutWidth: number | undefined
): CandidateDensity {
  const picture =
    img.parentElement?.tagName.toLowerCase() === 'picture' ? img.parentElement : undefined;
  const lazy = img.getAttribute('loading')?.trim().toLowerCase() === 'lazy';
  const mm = matchMediaOf();
  const sets: SourceSet[] = [];
  if (picture) {
    for (const source of Array.from(picture.querySelectorAll(':scope > source'))) {
      const srcset = source.getAttribute('srcset');
      if (!srcset || srcset.trim() === '') continue;
      // A <source> whose media does not match cannot be the selected one.
      const media = source.getAttribute('media');
      if (media && media.trim() !== '' && mm && !mm(media).matches) continue;
      sets.push({
        candidates: dedupeDensities(parseSrcset(srcset)),
        sizes: source.getAttribute('sizes'),
      });
    }
  }
  const own = parseSrcset(img.getAttribute('srcset') ?? '');
  const src = img.getAttribute('src');
  if (src && src !== '' && !own.some((c) => c.width !== undefined || c.density === 1)) {
    own.push({ url: src, density: 1 });
  }
  sets.push({ candidates: dedupeDensities(own), sizes: img.getAttribute('sizes') });

  // One candidate in all, at 1x (a plain `<img src>`): no lookup needed.
  const all = sets.flatMap((set) => set.candidates);
  if (all.length <= 1 && all.every((c) => c.density === 1)) return { density: 1 };

  const current = img.currentSrc ? absoluteUrl(img.currentSrc) : undefined;
  if (!current) {
    return { code: 'input_missing', reason: 'no currentSrc to match a srcset candidate against' };
  }

  const densities: number[] = [];
  for (const set of sets) {
    for (const c of set.candidates) {
      if (absoluteUrl(c.url) !== current) continue;
      if (c.density !== undefined) {
        densities.push(c.density);
        continue;
      }
      const size = resolveSourceSize(set.sizes, layoutWidth, lazy);
      if ('code' in size) return size;
      if (!(size.px > 0)) {
        return { code: 'input_missing', reason: 'a zero source size has no density' };
      }
      densities.push(c.width! / size.px);
    }
  }

  if (densities.length === 0) {
    return { code: 'input_missing', reason: 'currentSrc matches no srcset candidate' };
  }
  const first = densities[0]!;
  if (densities.some((d) => Math.abs(d - first) > 1e-9)) {
    return {
      code: 'input_missing',
      reason: 'candidates sharing currentSrc disagree about its density',
    };
  }
  return { density: first };
}
