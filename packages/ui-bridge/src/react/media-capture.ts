/**
 * Media capture — measures one media element (or one CSS background image)
 * into a {@link MediaObservation}: the facts it could measure, and — in the
 * provenance — every fact it could NOT, with the reason.
 *
 * One observation per media row, not one per field (plan
 * 2026-10-13-image-generation-and-visual-judgment, Phase 5 step 5): a dozen
 * facts across up to 200 rows would otherwise ship thousands of provenance
 * blocks per find. A fact the browser does not expose is listed in
 * `coverage.unmeasured` — `input_missing` when the input is not there (no
 * `Timing-Allow-Origin`, the image has not loaded, no LCP entry yet),
 * `capability_unavailable_in_build` when the engine lacks the API (no
 * `PerformanceObserver` entry type, no computed-value API) — and is never
 * reported as `0` or as a measured absence.
 *
 * Every capture is a fresh, synchronous read. The registry calls it on every
 * `getState()` of a media element, and the canonical find filter calls it
 * before deciding a media predicate, so a `pending → error` transition is seen
 * at find time, not at registration time.
 */

import { readAltAttr, readAriaLabelAttr } from '../core/a11y';
import type {
  MediaFacts,
  MediaFactsDimension,
  MediaLayoutShift,
  MediaObservation,
  MediaType,
} from '../core/types';
import { Observation, type UnknownCode } from '../observation/observation';

declare const __SDK_VERSION__: string;

/** The producer id every media observation carries. */
export const SDK_MEDIA_PRODUCER_ID = 'sdk/media-discovery';

/** Marks the image slot an element fills (Phase 14's `<SlotImage>`). */
export const IMAGE_SLOT_ATTR = 'data-ui-bridge-image-slot';

/** Marks a slot that still renders its placeholder. */
export const IMAGE_PLACEHOLDER_ATTR = 'data-ui-bridge-placeholder';

function mediaProducer() {
  return {
    id: SDK_MEDIA_PRODUCER_ID,
    version: typeof __SDK_VERSION__ === 'string' ? __SDK_VERSION__ : 'unknown',
  };
}

// ============================================================================
// The facts builder
// ============================================================================

interface Unmeasured {
  dimension: MediaFactsDimension;
  code: UnknownCode;
}

/** Facts plus the dimensions that could not be measured (each recorded once). */
class FactsBuilder {
  readonly unmeasured: Unmeasured[] = [];

  constructor(readonly facts: MediaFacts) {}

  /** Record that `dimension` could not be measured, and why. The field stays absent. */
  miss(dimension: MediaFactsDimension, code: UnknownCode): void {
    if (!this.unmeasured.some((u) => u.dimension === dimension)) {
      this.unmeasured.push({ dimension, code });
    }
  }
}

function toObservation(b: FactsBuilder, at: Date): MediaObservation {
  return Observation.measured(
    b.facts,
    Observation.provenance({
      producer: mediaProducer(),
      observedAt: at,
      evaluatedAt: at,
      coverage: {
        // One element considered; "measured" counts it only when NOTHING went
        // unmeasured — a gap makes the observation degraded, which is legal.
        considered: 1,
        measured: b.unmeasured.length === 0 ? 1 : 0,
        unmeasured: b.unmeasured.map((u) => ({ dimension: u.dimension, count: 1, code: u.code })),
      },
    })
  );
}

/** The capture threw: say so, typed, rather than ship a half-built fact set. */
function captureFailed(err: unknown, at: Date): MediaObservation {
  // The detail names the error CLASS only — an exception message can quote a
  // URL, and nothing element-derived may ride prose past the §4.6 scrub.
  const kind = err instanceof Error ? err.name : typeof err;
  return Observation.unknown(
    'producer_failed',
    `media capture threw ${kind}`,
    Observation.provenance({
      producer: mediaProducer(),
      observedAt: at,
      evaluatedAt: at,
      coverage: { considered: 1, measured: 0, unmeasured: [] },
    })
  );
}

// ============================================================================
// Small readers
// ============================================================================

function computedStyleOf(el: Element): CSSStyleDeclaration | undefined {
  try {
    return typeof window !== 'undefined' ? window.getComputedStyle(el) : undefined;
  } catch {
    return undefined;
  }
}

function readDevicePixelRatio(): number | undefined {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : undefined;
  return typeof dpr === 'number' && Number.isFinite(dpr) && dpr > 0 ? dpr : undefined;
}

/** A positive number parsed from a dimension attribute, or `undefined`. */
function readDimensionAttr(el: Element, name: 'width' | 'height'): number | undefined {
  const raw = el.getAttribute(name);
  if (raw === null) return undefined;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** The first non-empty value of `attr` across `nodes` (an `<img>` and its `<picture>`, …). */
function readMarker(attr: string, nodes: ReadonlyArray<Element | null | undefined>): string | undefined {
  for (const node of nodes) {
    const v = node?.getAttribute(attr);
    if (v) return v;
  }
  return undefined;
}

function readEnumAttr<T extends string>(
  el: Element,
  name: string,
  allowed: readonly T[],
  fallback: T
): T {
  const raw = el.getAttribute(name)?.trim().toLowerCase();
  return raw !== undefined && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

/** Content box (border box minus padding and border), CSS px. */
function contentBox(
  rect: DOMRect,
  cs: CSSStyleDeclaration | undefined
): { width: number; height: number } {
  if (!cs) return { width: rect.width, height: rect.height };
  const px = (v: string | undefined) => {
    const n = parseFloat(v ?? '');
    return Number.isFinite(n) ? n : 0;
  };
  return {
    width: Math.max(
      0,
      rect.width -
        px(cs.paddingLeft) -
        px(cs.paddingRight) -
        px(cs.borderLeftWidth) -
        px(cs.borderRightWidth)
    ),
    height: Math.max(
      0,
      rect.height -
        px(cs.paddingTop) -
        px(cs.paddingBottom) -
        px(cs.borderTopWidth) -
        px(cs.borderBottomWidth)
    ),
  };
}

/**
 * Source pixels per device pixel actually displayed. `object-fit` decides the
 * size the image is painted at inside the content box; under `fill` the axes
 * scale independently and the smaller density is the one that limits.
 */
export function computeEffectiveResolution(
  natural: { width: number; height: number },
  box: { width: number; height: number },
  devicePixelRatio: number,
  objectFit: string
): number | undefined {
  const { width: nw, height: nh } = natural;
  const { width: cw, height: ch } = box;
  if (!(nw > 0 && nh > 0 && cw > 0 && ch > 0 && devicePixelRatio > 0)) return undefined;
  let dw = cw;
  let dh = ch;
  switch (objectFit) {
    case 'contain': {
      const s = Math.min(cw / nw, ch / nh);
      dw = nw * s;
      dh = nh * s;
      break;
    }
    case 'cover': {
      const s = Math.max(cw / nw, ch / nh);
      dw = nw * s;
      dh = nh * s;
      break;
    }
    case 'none':
      dw = nw;
      dh = nh;
      break;
    case 'scale-down': {
      const s = Math.min(1, cw / nw, ch / nh);
      dw = nw * s;
      dh = nh * s;
      break;
    }
    default:
    // `fill` — the box, per axis.
  }
  return Math.min(nw / (dw * devicePixelRatio), nh / (dh * devicePixelRatio));
}

// ============================================================================
// Format and weight (Resource Timing)
// ============================================================================

/** Endpoints that transcode on the fly: their URL says nothing about the served format. */
const TRANSCODING_PATHS = [/\/_next\/image\/?$/, /\/_vercel\/image\/?$/];

function parseUrl(url: string): URL | undefined {
  try {
    const base = typeof location !== 'undefined' ? location.href : 'http://localhost/';
    return new URL(url, base);
  } catch {
    return undefined;
  }
}

/**
 * For an image-optimizer URL (`/_next/image?url=%2Fhero.png&w=1920`, the
 * Vercel equivalent) the ORIGINAL source it transcodes, else `undefined`.
 * Every `next/image` shares one path, so the source is the only thing that
 * tells two of them apart.
 */
export function transcodedSourceUrl(url: string): string | undefined {
  const parsed = parseUrl(url);
  if (!parsed || !TRANSCODING_PATHS.some((re) => re.test(parsed.pathname))) return undefined;
  return parsed.searchParams.get('url') || undefined;
}

const EXTENSION_FORMATS: Record<string, string> = {
  jpg: 'jpeg',
  jpeg: 'jpeg',
  png: 'png',
  gif: 'gif',
  webp: 'webp',
  avif: 'avif',
  svg: 'svg+xml',
  bmp: 'bmp',
  ico: 'ico',
  mp4: 'mp4',
  webm: 'webm',
  ogg: 'ogg',
  mov: 'quicktime',
};

function formatFromMime(mime: string): string | undefined {
  const m = /^(?:image|video)\/([a-z0-9.+-]+)/i.exec(mime.trim());
  return m ? m[1].toLowerCase() : undefined;
}

function formatFromUrl(url: string): string | undefined {
  if (url.startsWith('data:')) return formatFromMime(url.slice(5));
  const pathname = parseUrl(url)?.pathname;
  if (pathname === undefined || TRANSCODING_PATHS.some((re) => re.test(pathname))) {
    return undefined;
  }
  const ext = /\.([a-z0-9]+)$/i.exec(pathname)?.[1]?.toLowerCase();
  return ext ? (EXTENSION_FORMATS[ext] ?? ext) : undefined;
}

/** Bytes in a `data:` URL's payload, or `undefined` for a malformed one. */
function dataUrlBytes(url: string): number | undefined {
  const comma = url.indexOf(',');
  if (comma < 0) return undefined;
  const meta = url.slice(5, comma);
  const payload = url.slice(comma + 1);
  if (/;base64$/i.test(meta)) {
    const clean = payload.replace(/\s+/g, '');
    const pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor((clean.length * 3) / 4) - pad);
  }
  try {
    return new TextEncoder().encode(decodeURIComponent(payload)).length;
  } catch {
    return payload.length;
  }
}

type ResourceLookup =
  | { entry: PerformanceResourceTiming }
  | { entry?: undefined; code: UnknownCode };

/** The latest Resource Timing entry for exactly `url`. */
function resourceEntry(url: string): ResourceLookup {
  if (typeof performance === 'undefined' || typeof performance.getEntriesByName !== 'function') {
    return { code: 'capability_unavailable_in_build' };
  }
  let entries: PerformanceEntryList;
  try {
    entries = performance.getEntriesByName(url, 'resource');
  } catch {
    return { code: 'capability_unavailable_in_build' };
  }
  // No entry: memory-cache reuse, a full timing buffer, or not fetched yet.
  if (entries.length === 0) return { code: 'input_missing' };
  return { entry: entries[entries.length - 1] as PerformanceResourceTiming };
}

/** `format`, `encodedBodySize` — keyed on the URL the element DISPLAYS. */
function measureFormatAndWeight(b: FactsBuilder, url: string | undefined): ResourceLookup | undefined {
  if (!url) return undefined;
  if (url.startsWith('data:')) {
    b.facts.format = formatFromUrl(url);
    if (!b.facts.format) b.miss('format', 'input_missing');
    const bytes = dataUrlBytes(url);
    if (bytes === undefined) b.miss('encodedBodySize', 'input_missing');
    else b.facts.encodedBodySize = bytes;
    return undefined;
  }
  const lookup: ResourceLookup = url.startsWith('blob:')
    ? { code: 'input_missing' }
    : resourceEntry(url);
  const contentType = lookup.entry
    ? (lookup.entry as PerformanceResourceTiming & { contentType?: unknown }).contentType
    : undefined;
  b.facts.format =
    (typeof contentType === 'string' && contentType ? formatFromMime(contentType) : undefined) ??
    formatFromUrl(url);
  if (!b.facts.format) b.miss('format', 'input_missing');
  if (!lookup.entry) {
    b.miss('encodedBodySize', lookup.code);
  } else if (lookup.entry.encodedBodySize > 0) {
    b.facts.encodedBodySize = lookup.entry.encodedBodySize;
  } else {
    // A cross-origin response without `Timing-Allow-Origin` reports 0 —
    // which is "could not see", never "weighs nothing".
    b.miss('encodedBodySize', 'input_missing');
  }
  return lookup;
}

// ============================================================================
// LCP and layout shift (PerformanceObserver)
// ============================================================================

interface LcpEntryLike extends PerformanceEntry {
  element?: Element | null;
}

interface ShiftSourceLike {
  node?: Node | null;
  previousRect?: DOMRectReadOnly;
  currentRect?: DOMRectReadOnly;
}

interface LayoutShiftEntryLike extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
  sources?: readonly ShiftSourceLike[];
}

interface RecordedShift {
  value: number;
  startTime: number;
  hadRecentInput: boolean;
  sources: Array<{
    node: Node | null;
    previousRect: MediaLayoutShift['previousRect'];
    currentRect: MediaLayoutShift['currentRect'];
  }>;
}

interface PerfTracker {
  lcp: PerformanceObserver | 'unsupported';
  cls: PerformanceObserver | 'unsupported';
  /** `undefined` = no LCP entry reported yet; `null` = the current LCP element is gone. */
  lcpElement: Element | null | undefined;
  /** Bounded: the browser's own buffer for this type holds 150. */
  shifts: RecordedShift[];
}

const MAX_RECORDED_SHIFTS = 200;

let perfTracker: PerfTracker | null = null;

function rectOf(r: DOMRectReadOnly | undefined): MediaLayoutShift['currentRect'] {
  return { x: r?.x ?? 0, y: r?.y ?? 0, width: r?.width ?? 0, height: r?.height ?? 0 };
}

function ingestLcp(t: PerfTracker, entries: PerformanceEntryList): void {
  for (const e of entries) t.lcpElement = (e as LcpEntryLike).element ?? null;
}

function ingestShifts(t: PerfTracker, entries: PerformanceEntryList): void {
  for (const e of entries) {
    const s = e as LayoutShiftEntryLike;
    t.shifts.push({
      value: s.value,
      startTime: s.startTime,
      hadRecentInput: s.hadRecentInput,
      sources: (s.sources ?? []).map((src) => ({
        node: src.node ?? null,
        previousRect: rectOf(src.previousRect),
        currentRect: rectOf(src.currentRect),
      })),
    });
  }
  if (t.shifts.length > MAX_RECORDED_SHIFTS) {
    t.shifts.splice(0, t.shifts.length - MAX_RECORDED_SHIFTS);
  }
}

function startObserver(
  type: string,
  ingest: (entries: PerformanceEntryList) => void
): PerformanceObserver | 'unsupported' {
  try {
    if (typeof PerformanceObserver === 'undefined') return 'unsupported';
    if (!(PerformanceObserver.supportedEntryTypes ?? []).includes(type)) return 'unsupported';
    const observer = new PerformanceObserver((list) => ingest(list.getEntries()));
    // `buffered: true` hands over what happened before the SDK loaded.
    observer.observe({ type, buffered: true });
    return observer;
  } catch {
    return 'unsupported';
  }
}

/**
 * The page-lifetime LCP / layout-shift tracker, started on first use and then
 * drained synchronously on every read: `takeRecords()` returns whatever the
 * browser queued since the last delivery, so even the first capture after a
 * page load sees the buffered backlog.
 */
function perf(): PerfTracker {
  if (!perfTracker) {
    const t: PerfTracker = { lcp: 'unsupported', cls: 'unsupported', lcpElement: undefined, shifts: [] };
    perfTracker = t;
    t.lcp = startObserver('largest-contentful-paint', (entries) => ingestLcp(t, entries));
    t.cls = startObserver('layout-shift', (entries) => ingestShifts(t, entries));
  }
  const t = perfTracker;
  if (t.lcp !== 'unsupported') ingestLcp(t, t.lcp.takeRecords());
  if (t.cls !== 'unsupported') ingestShifts(t, t.cls.takeRecords());
  return t;
}

/**
 * Tear the tracker down so the next capture starts a new one. For tests that
 * install a fake `PerformanceObserver`; never needed in a page.
 */
export function resetMediaPerfTrackerForTests(): void {
  if (perfTracker) {
    if (perfTracker.lcp !== 'unsupported') perfTracker.lcp.disconnect();
    if (perfTracker.cls !== 'unsupported') perfTracker.cls.disconnect();
  }
  perfTracker = null;
}

/** `isLcpCandidate` and `clsSources` for an element (and, for a picture, its image). */
function measurePaintTiming(b: FactsBuilder, targets: ReadonlyArray<Element>): void {
  const t = perf();

  if (t.lcp === 'unsupported') b.miss('isLcpCandidate', 'capability_unavailable_in_build');
  // No entry yet, or the entry's element left the DOM: which element is the
  // LCP is then unknown, so this element's answer is too.
  else if (!t.lcpElement) b.miss('isLcpCandidate', 'input_missing');
  else b.facts.isLcpCandidate = targets.includes(t.lcpElement);

  if (t.cls === 'unsupported') {
    b.miss('clsSources', 'capability_unavailable_in_build');
    return;
  }
  const shifts: MediaLayoutShift[] = [];
  for (const s of t.shifts) {
    const src = s.sources.find((x) => x.node !== null && targets.includes(x.node as Element));
    if (src) {
      shifts.push({
        value: s.value,
        startTime: s.startTime,
        hadRecentInput: s.hadRecentInput,
        previousRect: src.previousRect,
        currentRect: src.currentRect,
      });
    }
  }
  b.facts.clsSources = shifts;
}

// ============================================================================
// Layout reservation
// ============================================================================

interface StyleMapValue {
  toString(): string;
}

interface StylePropertyMapLike {
  get(property: string): StyleMapValue | null | undefined;
}

/** `dimsReserved` for an element whose box can wait on a network load. */
function measureDimsReserved(b: FactsBuilder, el: HTMLElement, cs: CSSStyleDeclaration | undefined): void {
  if (b.facts.widthAttribute !== undefined && b.facts.heightAttribute !== undefined) {
    b.facts.dimsReserved = true;
    return;
  }
  const ratio = cs?.aspectRatio ?? '';
  const hasRatio = /\d/.test(ratio);
  const styleMap = (el as HTMLElement & { computedStyleMap?: () => StylePropertyMapLike })
    .computedStyleMap;
  if (typeof styleMap === 'function') {
    // COMPUTED values (not getComputedStyle's resolved px): `auto` stays `auto`.
    const map = styleMap.call(el);
    const definite = (prop: string) => {
      const v = map.get(prop);
      return v !== null && v !== undefined && String(v) !== 'auto';
    };
    const w = definite('width');
    const h = definite('height');
    b.facts.dimsReserved = (w && h) || (hasRatio && (w || h));
    return;
  }
  // No computed-value API: the inline style is the only place an explicit size
  // is visible. A stylesheet size cannot be seen, so "not reserved" cannot be
  // concluded — that is a could-not-look, not a `false`.
  const inline = el.style;
  if ((inline.width && inline.height) || (hasRatio && (inline.width || inline.height))) {
    b.facts.dimsReserved = true;
  } else {
    b.miss('dimsReserved', 'capability_unavailable_in_build');
  }
}

/** `objectFit` / `objectPosition` / `aspectRatio`, recording an engine that does not report them. */
function measureReplacedStyle(b: FactsBuilder, cs: CSSStyleDeclaration | undefined): void {
  if (cs?.objectFit) b.facts.objectFit = cs.objectFit;
  else b.miss('objectFit', 'capability_unavailable_in_build');
  if (cs?.objectPosition) b.facts.objectPosition = cs.objectPosition;
  else b.miss('objectPosition', 'capability_unavailable_in_build');
  if (cs?.aspectRatio) b.facts.aspectRatio = cs.aspectRatio;
  else b.miss('aspectRatio', 'capability_unavailable_in_build');
}

/** `naturalWidth/Height` and `effectiveResolution`, given an intrinsic size (or not). */
function measureResolution(
  b: FactsBuilder,
  natural: { width: number; height: number } | undefined,
  rect: DOMRect,
  cs: CSSStyleDeclaration | undefined,
  defaultFit: string
): void {
  if (!natural || !(natural.width > 0 && natural.height > 0)) {
    b.miss('naturalWidth', 'input_missing');
    b.miss('naturalHeight', 'input_missing');
    b.miss('effectiveResolution', 'input_missing');
    return;
  }
  b.facts.naturalWidth = natural.width;
  b.facts.naturalHeight = natural.height;
  const dpr = b.facts.devicePixelRatio;
  if (dpr === undefined) {
    b.miss('effectiveResolution', 'capability_unavailable_in_build');
    return;
  }
  // An engine that does not report object-fit does not implement it, so it
  // paints the UA default: `fill` (`contain` for video, per the HTML UA sheet).
  const fit = b.facts.objectFit ?? defaultFit;
  const value = computeEffectiveResolution(natural, contentBox(rect, cs), dpr, fit);
  if (value === undefined) b.miss('effectiveResolution', 'input_missing');
  else b.facts.effectiveResolution = value;
}

// ============================================================================
// Per-element measurement
// ============================================================================

/** The `<picture>` an `<img>` paints for, if any. */
function pictureOf(element: Element): Element | undefined {
  const parent = element.parentElement;
  return parent?.tagName.toLowerCase() === 'picture' ? parent : undefined;
}

/**
 * The media type an element registers as, from its tag. An `<img>` inside a
 * `<picture>` is the picture's one row (`picture`).
 */
export function inferMediaType(element: Element): MediaType {
  if (element.tagName.toLowerCase() === 'img' && pictureOf(element)) return 'picture';
  switch (element.tagName.toLowerCase()) {
    case 'svg':
      return 'svg';
    case 'video':
      return 'video';
    case 'canvas':
      return 'canvas';
    case 'picture':
      return 'picture';
    default:
      return 'image'; // img, or role="img"
  }
}

/** Facts for an `<img>` — also the image half of a `<picture>` (`host`). */
function measureImage(b: FactsBuilder, img: HTMLImageElement, host: Element): void {
  const rect = img.getBoundingClientRect();
  b.facts.renderedWidth = rect.width;
  b.facts.renderedHeight = rect.height;
  const cs = computedStyleOf(img);

  const src = img.currentSrc || img.src || undefined;
  b.facts.src = src;
  const alt = readAltAttr(img);
  b.facts.altText = alt || undefined;
  // `img.alt` reads '' for a MISSING alt too; only a present-and-empty one
  // marks the image decorative. A missing alt is a finding, not a decoration.
  b.facts.isDecorative = alt === '' || img.getAttribute('role') === 'presentation';

  const loading = readEnumAttr(img, 'loading', ['lazy', 'eager'] as const, 'eager');
  b.facts.loading = loading;
  b.facts.decoding = readEnumAttr(img, 'decoding', ['sync', 'async', 'auto'] as const, 'auto');
  b.facts.fetchPriority = readEnumAttr(
    img,
    'fetchpriority',
    ['high', 'low', 'auto'] as const,
    'auto'
  );

  if (!img.complete) {
    b.facts.loadingState = loading === 'lazy' ? 'lazy' : 'pending';
  } else if (img.naturalWidth === 0 && src) {
    b.facts.loadingState = 'error';
  } else {
    b.facts.loadingState = 'loaded';
  }

  if (img.srcset) b.facts.srcset = img.srcset;
  if (img.sizes) b.facts.sizes = img.sizes;

  b.facts.widthAttribute = readDimensionAttr(img, 'width');
  b.facts.heightAttribute = readDimensionAttr(img, 'height');
  measureReplacedStyle(b, cs);
  measureDimsReserved(b, img, cs);

  // A BROKEN image has no image at all: its resolution, format and weight do
  // not apply (absent, not listed) — the bytes that came back were an error
  // page, not an image. A pending image's are merely not known yet
  // (unmeasured, `input_missing`).
  if (b.facts.loadingState !== 'error') {
    const loaded = img.complete && img.naturalWidth > 0;
    measureResolution(
      b,
      loaded ? { width: img.naturalWidth, height: img.naturalHeight } : undefined,
      rect,
      cs,
      'fill'
    );
    measureFormatAndWeight(b, src);
  }
  measurePaintTiming(b, host === img ? [img] : [host, img]);
}

function measureVideo(b: FactsBuilder, video: HTMLVideoElement, rect: DOMRect): void {
  const cs = computedStyleOf(video);
  const src = video.currentSrc || video.src || undefined;
  b.facts.src = src;
  b.facts.altText = readAriaLabelAttr(video) || undefined;
  b.facts.loadingState = video.readyState >= 2 ? 'loaded' : 'pending';
  b.facts.format = src ? formatFromUrl(src) : undefined;
  if (src && !b.facts.format) b.miss('format', 'input_missing');
  b.facts.widthAttribute = readDimensionAttr(video, 'width');
  b.facts.heightAttribute = readDimensionAttr(video, 'height');
  measureReplacedStyle(b, cs);
  measureDimsReserved(b, video, cs);
  measureResolution(
    b,
    video.videoWidth > 0 ? { width: video.videoWidth, height: video.videoHeight } : undefined,
    rect,
    cs,
    'contain'
  );
  b.facts.videoState = {
    poster: video.poster || undefined,
    currentTime: video.currentTime,
    duration: video.duration || 0,
    paused: video.paused,
    muted: video.muted,
  };
  measurePaintTiming(b, [video]);
}

function measureCanvas(b: FactsBuilder, canvas: HTMLCanvasElement, rect: DOMRect): void {
  const cs = computedStyleOf(canvas);
  b.facts.altText = readAriaLabelAttr(canvas) || canvas.textContent?.trim() || undefined;
  b.facts.loadingState = 'loaded';
  measureReplacedStyle(b, cs);
  // The backing store IS the canvas's intrinsic size; a blurry canvas is one
  // whose backing store is smaller than the device pixels it covers.
  measureResolution(b, { width: canvas.width, height: canvas.height }, rect, cs, 'fill');
  measurePaintTiming(b, [canvas]);
}

function measureSvg(b: FactsBuilder, svg: Element): void {
  b.facts.svgViewBox = svg.getAttribute('viewBox') || undefined;
  b.facts.altText =
    readAriaLabelAttr(svg) || svg.querySelector('title')?.textContent || undefined;
  b.facts.isDecorative =
    svg.getAttribute('aria-hidden') === 'true' || svg.getAttribute('role') === 'presentation';
  // Inline SVG is painted with the document: nothing is pending.
  b.facts.loadingState = 'loaded';
  measurePaintTiming(b, [svg]);
}

/** A `<picture>`'s `<source>` children, or `undefined` when it has none. */
function pictureSources(picture: Element): MediaFacts['sources'] {
  const sources = picture.querySelectorAll('source');
  if (sources.length === 0) return undefined;
  return Array.from(sources).map((source) => ({
    srcset: source.srcset,
    media: source.media || undefined,
    type: source.type || undefined,
  }));
}

function measureMedia(element: HTMLElement): FactsBuilder {
  const tag = element.tagName.toLowerCase();
  const rect = element.getBoundingClientRect();
  const dpr = readDevicePixelRatio();
  const b = new FactsBuilder({
    mediaType: inferMediaType(element),
    isDecorative: false,
    renderedWidth: rect.width,
    renderedHeight: rect.height,
    ...(dpr !== undefined ? { devicePixelRatio: dpr } : {}),
  });
  if (dpr === undefined) b.miss('devicePixelRatio', 'capability_unavailable_in_build');

  let markerNodes: Array<Element | null | undefined> = [element];
  if (tag === 'img') {
    // An <img> inside a <picture> is the picture's one row: the image facts
    // are the <img>'s (it is what paints, what LCP names, what has a box), the
    // art-direction <source> list is the picture's.
    const picture = pictureOf(element);
    measureImage(b, element as HTMLImageElement, picture ?? element);
    if (picture) b.facts.sources = pictureSources(picture);
    markerNodes = [element, picture];
  } else if (tag === 'picture') {
    const img = element.querySelector('img');
    if (img) {
      measureImage(b, img, element);
      markerNodes = [element, img];
    } else {
      // A picture with no <img> displays nothing; there is no image to measure.
      b.facts.loadingState = 'error';
    }
    b.facts.sources = pictureSources(element);
  } else if (tag === 'svg') {
    measureSvg(b, element);
  } else if (tag === 'video') {
    measureVideo(b, element as HTMLVideoElement, rect);
  } else if (tag === 'canvas') {
    measureCanvas(b, element as HTMLCanvasElement, rect);
  } else {
    // A non-media element carrying role="img": painted with the document.
    b.facts.loadingState = 'loaded';
    measurePaintTiming(b, [element]);
  }

  if (element.getAttribute('role') === 'img') {
    b.facts.altText = b.facts.altText || readAriaLabelAttr(element) || undefined;
    b.facts.isDecorative = !b.facts.altText && element.getAttribute('aria-hidden') === 'true';
  }

  const slotId = readMarker(IMAGE_SLOT_ATTR, markerNodes);
  if (slotId) b.facts.slotId = slotId;
  if (readMarker(IMAGE_PLACEHOLDER_ATTR, markerNodes) === 'true') b.facts.placeholder = true;
  return b;
}

/**
 * Capture a media element's observation: `img`, `picture`, `svg`, `video`,
 * `canvas`, or any element with `role="img"`.
 */
export function captureMediaMetadata(element: HTMLElement): MediaObservation {
  const at = new Date();
  try {
    return toObservation(measureMedia(element), at);
  } catch (err) {
    return captureFailed(err, at);
  }
}

/** The `url(...)` a computed `background-image` paints, or `undefined`. */
export function backgroundImageUrl(element: Element): string | undefined {
  const bg = computedStyleOf(element)?.backgroundImage;
  if (!bg || bg === 'none') return undefined;
  return /url\(["']?([^"')]+)["']?\)/.exec(bg)?.[1];
}

/**
 * Capture a CSS background image's observation, or `null` when the element
 * paints no `url(...)` background. CSS exposes no intrinsic size for a
 * background, so its natural size and effective resolution are always
 * unmeasured (`input_missing`) rather than guessed.
 */
export function captureBackgroundImageMetadata(element: HTMLElement): MediaObservation | null {
  const src = backgroundImageUrl(element);
  if (!src) return null;
  const at = new Date();
  try {
    const rect = element.getBoundingClientRect();
    const dpr = readDevicePixelRatio();
    const b = new FactsBuilder({
      mediaType: 'background-image',
      src,
      // A background is presentation by construction — it has no alt channel.
      isDecorative: true,
      renderedWidth: rect.width,
      renderedHeight: rect.height,
      ...(dpr !== undefined ? { devicePixelRatio: dpr } : {}),
    });
    if (dpr === undefined) b.miss('devicePixelRatio', 'capability_unavailable_in_build');
    b.miss('naturalWidth', 'input_missing');
    b.miss('naturalHeight', 'input_missing');
    b.miss('effectiveResolution', 'input_missing');

    const lookup = measureFormatAndWeight(b, src);
    if (src.startsWith('data:')) {
      b.facts.loadingState = 'loaded';
    } else if (lookup?.entry) {
      const status = (lookup.entry as PerformanceResourceTiming & { responseStatus?: unknown })
        .responseStatus;
      if (typeof status === 'number' && status >= 400) b.facts.loadingState = 'error';
      else if (typeof status === 'number' && status >= 200) b.facts.loadingState = 'loaded';
      else if (lookup.entry.encodedBodySize > 0) b.facts.loadingState = 'loaded';
      else b.miss('loadingState', 'input_missing');
    } else {
      b.miss('loadingState', lookup?.code ?? 'input_missing');
    }

    measurePaintTiming(b, [element]);
    const slotId = readMarker(IMAGE_SLOT_ATTR, [element]);
    if (slotId) b.facts.slotId = slotId;
    if (readMarker(IMAGE_PLACEHOLDER_ATTR, [element]) === 'true') b.facts.placeholder = true;
    return toObservation(b, at);
  } catch (err) {
    return captureFailed(err, at);
  }
}
