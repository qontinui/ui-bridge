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
    } else if (last === 'x' && /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(body)) {
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

/** Resolve one `sizes` source-size length to CSS px. */
function resolveLength(raw: string, layoutWidth: number | undefined): Length {
  const s = raw.trim().toLowerCase();
  if (s === 'auto') {
    return layoutWidth !== undefined && layoutWidth > 0
      ? { px: layoutWidth }
      : { code: 'input_missing', reason: 'sizes=auto with no layout width' };
  }
  const m = /^(\d+\.?\d*|\.\d+)(px|vw|vh|vmin|vmax)?$/.exec(s);
  if (!m) {
    return {
      code: 'capability_unavailable_in_build',
      reason: 'a sizes length this build cannot evaluate',
    };
  }
  const value = parseFloat(m[1]!);
  const unit = m[2];
  if (unit === undefined) {
    // Only a unitless zero is a valid length.
    return value === 0
      ? { px: 0 }
      : { code: 'input_missing', reason: 'a unitless non-zero sizes length' };
  }
  if (unit === 'px') return { px: value };
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
 * The source size a `sizes` attribute selects (absent = `100vw`). Entries are
 * `<media-condition>? <length>`; the first whose condition matches wins.
 */
export function resolveSourceSize(sizes: string | null, layoutWidth: number | undefined): Length {
  const entries = sizes === null || sizes.trim() === '' ? ['100vw'] : splitTopLevel(sizes);
  for (const entry of entries) {
    // The length is the last component: everything after the final top-level
    // whitespace that is outside parentheses.
    let depth = 0;
    let split = -1;
    for (let i = 0; i < entry.length; i++) {
      const c = entry[i]!;
      if (c === '(') depth++;
      else if (c === ')') depth = Math.max(0, depth - 1);
      else if (depth === 0 && WHITESPACE.test(c)) split = i;
    }
    const condition = split === -1 ? '' : entry.slice(0, split).trim();
    const length = split === -1 ? entry : entry.slice(split + 1);
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
    return resolveLength(length, layoutWidth);
  }
  // No entry matched: the spec's fallback is 100vw.
  return resolveLength('100vw', layoutWidth);
}

interface Offer {
  srcset: string | null;
  sizes: string | null;
}

/**
 * The density of the candidate `img` is displaying (see the module doc).
 * `layoutWidth` is the image's content-box width, for `sizes="auto"`.
 */
export function displayedCandidateDensity(
  img: HTMLImageElement,
  layoutWidth: number | undefined
): CandidateDensity {
  const picture =
    img.parentElement?.tagName.toLowerCase() === 'picture' ? img.parentElement : undefined;
  const offers: Offer[] = [];
  if (picture) {
    for (const source of Array.from(picture.querySelectorAll(':scope > source'))) {
      offers.push({ srcset: source.getAttribute('srcset'), sizes: source.getAttribute('sizes') });
    }
  }
  offers.push({ srcset: img.getAttribute('srcset'), sizes: img.getAttribute('sizes') });

  // No srcset anywhere: `src` is the only candidate, and it is 1x.
  if (offers.every((o) => !o.srcset || o.srcset.trim() === '')) return { density: 1 };

  const current = img.currentSrc ? absoluteUrl(img.currentSrc) : undefined;
  if (!current) {
    return { code: 'input_missing', reason: 'no currentSrc to match a srcset candidate against' };
  }

  const densities: number[] = [];
  for (const offer of offers) {
    if (!offer.srcset) continue;
    for (const c of parseSrcset(offer.srcset)) {
      if (absoluteUrl(c.url) !== current) continue;
      if (c.density !== undefined) {
        densities.push(c.density);
        continue;
      }
      const size = resolveSourceSize(offer.sizes, layoutWidth);
      if ('code' in size) return size;
      if (!(size.px > 0)) {
        return { code: 'input_missing', reason: 'a zero source size has no density' };
      }
      densities.push(c.width! / size.px);
    }
  }
  const src = img.getAttribute('src');
  if (src && absoluteUrl(src) === current) densities.push(1);

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
