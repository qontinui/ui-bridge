/**
 * In-situ asset override — swap an image in its real slot, then restore it.
 *
 * `POST /control/media/override` replaces what one image slot renders (an
 * `<img>`'s `src`/`srcset`, every `<source srcset>` of its `<picture>`, or an
 * element's CSS `background-image`) so a candidate asset can be captured in
 * the page it is meant for, across the capture matrix, and judged there.
 * `DELETE /control/media/override` puts the originals back and VERIFIES they
 * are back. `GET /control/media/override` lists what is still overridden, so
 * a caller can prove the page ended restored.
 *
 * Plan 2026-10-13-image-generation-and-visual-judgment, Phase 18 step 1.
 *
 * GUARANTEES
 *
 *  - The originals are recorded before anything is written: each attribute's
 *    exact value, or its absence (an absent attribute is restored by REMOVING
 *    it, never by writing `""`), and an element's whole `style` attribute for
 *    the background arm, so the restored DOM is the DOM that was there.
 *  - `<picture>` is overridden whole. A browser picks a `<source>` before it
 *    ever looks at the `<img>`, so changing only `img.src` leaves the original
 *    showing. Every `<source srcset>` is replaced too (per type when the caller
 *    names `sources`, which is the AVIF/WebP-plus-fallback shape Phase 19's
 *    compile step emits).
 *  - Nothing is reported ready until the browser has DECODED the new image and
 *    `currentSrc` names one of the candidates the caller supplied. An override
 *    that cannot get there is undone before it answers, so a capture can never
 *    run against a half-applied or still-loading swap.
 *  - A TTL restores the page by itself, so a caller that dies mid-run cannot
 *    leave the page altered.
 *  - A restore never clobbers the app. If the app rewrote an attribute after
 *    the override (a re-render with a new `src`), that attribute is left as
 *    the app set it and reported as `drift`, rather than reverted to a value
 *    older than the app's own.
 *
 * It is a DEV CONTROL (`core/dev-controls.ts`): the command handlers answer
 * `capability_unavailable_in_build` unless the realm opted in.
 *
 * Redaction: a target inside a `data-bridge-redact` boundary has its ORIGINAL
 * URLs scrubbed from every response — a presigned asset URL is a secret of the
 * page. The caller's own candidate URLs are echoed; they came from the caller.
 */

import { isContentRedacted, REDACTED_VALUE } from '../core/redaction';
import { IMAGE_SLOT_ATTR } from '../react/media-capture';

// ============================================================================
// Contract
// ============================================================================

/** One `<source>` replacement, matched to a `<picture>` source by `type`. */
export interface MediaOverrideSource {
  /** MIME type of the `<source>` to match (`image/avif`). Omit to match any. */
  type?: string;
  srcset: string;
  sizes?: string;
}

/** Body of `POST /control/media/override`. */
export interface MediaOverrideRequest {
  /** Target by `data-ui-bridge-image-slot` value. Exactly one of slotId / elementId. */
  slotId?: string;
  /** Target by registered element id. */
  elementId?: string;
  /** New `<img src>`. Alone, it also clears `srcset`/`sizes` so the browser uses it. */
  src?: string;
  /** New `<img srcset>`; with no `sources`, also every `<source srcset>` of the `<picture>`. */
  srcset?: string;
  /** New `<img sizes>`; with no `sources`, also every `<source sizes>`. */
  sizes?: string;
  /** Per-type `<source>` replacements for a `<picture>`. */
  sources?: MediaOverrideSource[];
  /** URL for the target's CSS `background-image`. Exclusive with the image fields. */
  backgroundImage?: string;
  /** Auto-restore after this many ms. Default {@link DEFAULT_OVERRIDE_TTL_MS}. */
  ttlMs?: number;
  /** Bound on the decode wait. Default {@link DEFAULT_DECODE_TIMEOUT_MS}. */
  decodeTimeoutMs?: number;
}

/** Body of `DELETE /control/media/override`. Omit `overrideId` to restore all. */
export interface MediaOverrideRestoreRequest {
  overrideId?: string;
}

export type MediaOverrideMode = 'image' | 'background';

/** Typed failure codes. */
export type MediaOverrideErrorCode =
  | 'INVALID_REQUEST'
  | 'TARGET_NOT_FOUND'
  | 'AMBIGUOUS_TARGET'
  | 'TARGET_NOT_AN_IMAGE'
  | 'DECODE_FAILED'
  | 'DECODE_TIMEOUT'
  | 'CURRENT_SRC_MISMATCH'
  | 'NOT_FOUND'
  | 'capability_unavailable_in_build';

export interface MediaOverrideFailure {
  success: false;
  code: MediaOverrideErrorCode;
  error: string;
  /** Present when an applied override was undone before answering. */
  rolledBack?: RestoreResult;
  timestamp: number;
}

/** What the browser shows after the swap, read back — never copied from the request. */
export interface MediaOverrideReadiness {
  decoded: true;
  /** `img.currentSrc`, or the resolved background URL. */
  currentSrc: string;
  /**
   * The candidate's size in image PIXELS, from a detached decode of
   * `currentSrc`. Not the slot's own `naturalWidth`: that is divided by the
   * density the browser selected, and Chromium keeps the density of the
   * slot's PREVIOUS srcset choice after a src-only swap, so a 100 px candidate
   * in a slot that last chose a 2x source reads 50. `null` when the detached
   * decode could not measure it (unmeasured, never 0).
   */
  naturalWidth: number | null;
  naturalHeight: number | null;
}

export interface MediaOverrideTarget {
  slotId: string | null;
  elementId: string | null;
  /** Lower-case tag of the element the override writes to. */
  tag: string;
  inPicture: boolean;
}

export interface MediaOverrideSuccess {
  success: true;
  overrideId: string;
  /** True when this call replaced an override already active on the target. */
  replaced: boolean;
  mode: MediaOverrideMode;
  target: MediaOverrideTarget;
  /** The values recorded before the first override; URLs scrubbed inside a redaction boundary. */
  originals: Record<string, string | null>;
  applied: Record<string, string | null>;
  ready: MediaOverrideReadiness;
  appliedAt: number;
  expiresAt: number;
  timestamp: number;
}

/** One attribute the restore could not bring back to its recorded original. */
export interface RestoreMismatch {
  key: string;
  expected: string | null;
  actual: string | null;
}

export interface RestoreResult {
  overrideId: string;
  /**
   * `restored` — every attribute is back (or left as the app rewrote it, see
   * `drift`). `detached` — the target left the DOM; there is nothing to
   * restore and nothing was verified.
   */
  status: 'restored' | 'detached';
  /** True only when every restored attribute reads back as its original. `null` when detached. */
  verified: boolean | null;
  mismatches: RestoreMismatch[];
  /** Attributes the app changed after the override; left as the app set them. */
  drift: string[];
  trigger: 'request' | 'ttl' | 'rollback';
}

export interface MediaOverrideRestoreSuccess {
  success: true;
  restored: RestoreResult[];
  /** Overrides still active after this call. */
  remaining: number;
  timestamp: number;
}

export interface MediaOverrideListEntry {
  overrideId: string;
  mode: MediaOverrideMode;
  target: MediaOverrideTarget;
  appliedAt: number;
  expiresAt: number;
  connected: boolean;
}

export interface MediaOverrideListSuccess {
  success: true;
  active: MediaOverrideListEntry[];
  /** The last few TTL restores, so a caller that died can see the page healed. */
  recentlyExpired: RestoreResult[];
  timestamp: number;
}

export const DEFAULT_OVERRIDE_TTL_MS = 120_000;
export const MIN_OVERRIDE_TTL_MS = 1_000;
export const MAX_OVERRIDE_TTL_MS = 900_000;
export const DEFAULT_DECODE_TIMEOUT_MS = 10_000;
export const MAX_DECODE_TIMEOUT_MS = 60_000;
const RECENTLY_EXPIRED_LIMIT = 20;

// ============================================================================
// Validation
// ============================================================================

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function boundedInt(
  raw: unknown,
  field: string,
  min: number,
  max: number,
  fallback: number
): number | string {
  if (raw === undefined) return fallback;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < min || raw > max) {
    return `${field} must be an integer in ${min}..${max} (got ${JSON.stringify(raw)})`;
  }
  return raw;
}

/** A validated request, with defaults filled. */
export interface ValidatedMediaOverride {
  slotId: string | null;
  elementId: string | null;
  src: string | null;
  srcset: string | null;
  sizes: string | null;
  sources: MediaOverrideSource[] | null;
  backgroundImage: string | null;
  ttlMs: number;
  decodeTimeoutMs: number;
}

/**
 * Validate a raw request body. Returns the validated request or an error
 * message. Pure — the runner's Rust handler mirrors these rules for an early
 * 400, and this copy is the authority.
 */
export function validateMediaOverrideRequest(raw: unknown): ValidatedMediaOverride | string {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return 'body must be a JSON object';
  }
  const r = raw as Record<string, unknown>;
  const hasSlot = r.slotId !== undefined;
  const hasElement = r.elementId !== undefined;
  if (hasSlot === hasElement) return 'exactly one of slotId or elementId is required';
  if (hasSlot && !isNonEmptyString(r.slotId)) return 'slotId must be a non-empty string';
  if (hasElement && !isNonEmptyString(r.elementId)) return 'elementId must be a non-empty string';

  for (const f of ['src', 'srcset', 'sizes', 'backgroundImage'] as const) {
    if (r[f] !== undefined && !isNonEmptyString(r[f])) return `${f} must be a non-empty string`;
  }
  let sources: MediaOverrideSource[] | null = null;
  if (r.sources !== undefined) {
    if (!Array.isArray(r.sources) || r.sources.length === 0) {
      return 'sources must be a non-empty array of {type?, srcset, sizes?}';
    }
    sources = [];
    for (const [i, s] of r.sources.entries()) {
      if (s === null || typeof s !== 'object' || Array.isArray(s)) {
        return `sources[${i}] must be an object`;
      }
      const o = s as Record<string, unknown>;
      if (!isNonEmptyString(o.srcset)) return `sources[${i}].srcset must be a non-empty string`;
      if (o.type !== undefined && !isNonEmptyString(o.type)) {
        return `sources[${i}].type must be a non-empty string`;
      }
      if (o.sizes !== undefined && !isNonEmptyString(o.sizes)) {
        return `sources[${i}].sizes must be a non-empty string`;
      }
      sources.push({
        srcset: o.srcset,
        ...(o.type !== undefined ? { type: o.type as string } : {}),
        ...(o.sizes !== undefined ? { sizes: o.sizes as string } : {}),
      });
    }
  }

  const imageFields = r.src !== undefined || r.srcset !== undefined || sources !== null;
  const bg = r.backgroundImage !== undefined;
  if (!imageFields && !bg) return 'one of src, srcset, sources or backgroundImage is required';
  if (imageFields && bg) {
    return 'backgroundImage overrides CSS; it cannot be combined with src, srcset or sources';
  }
  if (r.sizes !== undefined && r.srcset === undefined) return 'sizes needs srcset';
  if (sources !== null && r.src === undefined && r.srcset === undefined) {
    return 'sources replaces the <source> elements only; also give src or srcset for the <img> fallback';
  }

  const ttl = boundedInt(
    r.ttlMs,
    'ttlMs',
    MIN_OVERRIDE_TTL_MS,
    MAX_OVERRIDE_TTL_MS,
    DEFAULT_OVERRIDE_TTL_MS
  );
  if (typeof ttl === 'string') return ttl;
  const decode = boundedInt(
    r.decodeTimeoutMs,
    'decodeTimeoutMs',
    0,
    MAX_DECODE_TIMEOUT_MS,
    DEFAULT_DECODE_TIMEOUT_MS
  );
  if (typeof decode === 'string') return decode;

  return {
    slotId: hasSlot ? (r.slotId as string) : null,
    elementId: hasElement ? (r.elementId as string) : null,
    src: (r.src as string | undefined) ?? null,
    srcset: (r.srcset as string | undefined) ?? null,
    sizes: (r.sizes as string | undefined) ?? null,
    sources,
    backgroundImage: (r.backgroundImage as string | undefined) ?? null,
    ttlMs: ttl,
    decodeTimeoutMs: decode,
  };
}

// ============================================================================
// State
// ============================================================================

/**
 * One attribute the override wrote: where, what was there, what we put there.
 * `key` names it in responses (`img.src`, `source[1].srcset`, `style`).
 */
interface AttrRecord {
  key: string;
  el: Element;
  attr: string;
  original: string | null;
  applied: string | null;
  /** The original is a URL (or a style holding one) that a redaction boundary hides. */
  url: boolean;
}

interface OverrideRecord {
  overrideId: string;
  mode: MediaOverrideMode;
  /** The element the caller targeted (identity used to detect a re-override). */
  anchor: Element;
  target: MediaOverrideTarget;
  attrs: AttrRecord[];
  appliedAt: number;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const active = new Map<string, OverrideRecord>();
const recentlyExpired: RestoreResult[] = [];
let sequence = 0;

function nextOverrideId(): string {
  sequence += 1;
  return `mo-${Date.now().toString(36)}-${sequence}`;
}

// ============================================================================
// Target resolution
// ============================================================================

type Resolved =
  | { ok: true; anchor: Element; img: HTMLImageElement | null; picture: Element | null }
  | { ok: false; code: MediaOverrideErrorCode; error: string };

function resolveTarget(
  req: ValidatedMediaOverride,
  resolveElement: (id: string) => Element | null | undefined
): Resolved {
  let anchor: Element | null | undefined;
  if (req.slotId !== null) {
    const escaped =
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(req.slotId)
        : req.slotId.replace(/["\\]/g, '\\$&');
    const matches = document.querySelectorAll(`[${IMAGE_SLOT_ATTR}="${escaped}"]`);
    if (matches.length === 0) {
      return {
        ok: false,
        code: 'TARGET_NOT_FOUND',
        error: `no element carries ${IMAGE_SLOT_ATTR}="${req.slotId}"`,
      };
    }
    if (matches.length > 1) {
      return {
        ok: false,
        code: 'AMBIGUOUS_TARGET',
        error:
          `${matches.length} elements carry ${IMAGE_SLOT_ATTR}="${req.slotId}"; a slot id must ` +
          `name one element. Target one by elementId instead.`,
      };
    }
    anchor = matches[0];
  } else {
    anchor = resolveElement(req.elementId as string);
    if (!anchor) {
      return {
        ok: false,
        code: 'TARGET_NOT_FOUND',
        error: `no registered element ${req.elementId}`,
      };
    }
  }
  if (!anchor || !anchor.isConnected) {
    return { ok: false, code: 'TARGET_NOT_FOUND', error: 'the target is not in the document' };
  }

  if (req.backgroundImage !== null) {
    return { ok: true, anchor, img: null, picture: null };
  }

  let img: HTMLImageElement | null;
  const tag = anchor.tagName.toLowerCase();
  if (tag === 'img') {
    img = anchor as HTMLImageElement;
  } else if (tag === 'picture') {
    img = anchor.querySelector(':scope > img');
  } else {
    const imgs = anchor.querySelectorAll('img');
    if (imgs.length === 1) img = imgs[0] as HTMLImageElement;
    else {
      return {
        ok: false,
        code: 'TARGET_NOT_AN_IMAGE',
        error:
          `the target is a <${tag}> holding ${imgs.length} <img> elements; src/srcset need ` +
          `exactly one. Target the <img> itself, or use backgroundImage for a CSS background.`,
      };
    }
  }
  if (!img) {
    return {
      ok: false,
      code: 'TARGET_NOT_AN_IMAGE',
      error: `the <${tag}> target has no <img>`,
    };
  }
  const parent = img.parentElement;
  const picture = parent && parent.tagName.toLowerCase() === 'picture' ? parent : null;
  return { ok: true, anchor, img, picture };
}

// ============================================================================
// Apply
// ============================================================================

function readAttr(el: Element, attr: string): string | null {
  return el.getAttribute(attr);
}

function writeAttr(el: Element, attr: string, value: string | null): void {
  if (value === null) el.removeAttribute(attr);
  else el.setAttribute(attr, value);
}

/** CSS `url("…")` for a URL, quoted so no URL can break out into other declarations. */
function cssUrl(url: string): string {
  return `url("${url.replace(/["\\\n\r]/g, (c) => (c === '\n' || c === '\r' ? '' : `\\${c}`))}")`;
}

/**
 * The element's own style text with a `background-image` declaration appended.
 * Appended LAST so it beats any earlier `background`/`background-image` in the
 * same attribute, and `!important` so it beats stylesheet rules. Built as text
 * rather than through `style.setProperty`, so the result does not depend on how
 * an engine re-serializes the declaration block.
 */
function styleWithBackground(original: string | null, url: string): string {
  const base = (original ?? '').trim();
  const sep = base === '' ? '' : base.endsWith(';') ? ' ' : '; ';
  return `${base}${sep}background-image: ${cssUrl(url)} !important;`;
}

/**
 * Plan the attribute writes for a request. Each entry's `original` is read
 * from the live DOM, unless a re-override supplies the first override's.
 */
function planImageWrites(
  req: ValidatedMediaOverride,
  img: HTMLImageElement,
  picture: Element | null
): Array<Omit<AttrRecord, 'original'>> {
  const writes: Array<Omit<AttrRecord, 'original'>> = [];
  // The <img>: `src` keeps the original as the srcset fallback unless given;
  // `src` alone clears srcset/sizes, or the browser would keep choosing from them.
  if (req.src !== null)
    writes.push({ key: 'img.src', el: img, attr: 'src', applied: req.src, url: true });
  if (req.srcset !== null) {
    writes.push({ key: 'img.srcset', el: img, attr: 'srcset', applied: req.srcset, url: true });
    if (req.sizes !== null) {
      writes.push({ key: 'img.sizes', el: img, attr: 'sizes', applied: req.sizes, url: false });
    }
  } else {
    writes.push({ key: 'img.srcset', el: img, attr: 'srcset', applied: null, url: true });
    writes.push({ key: 'img.sizes', el: img, attr: 'sizes', applied: null, url: false });
  }
  if (picture) {
    const fallbackSrcset = req.srcset ?? (req.src as string);
    const sourceEls = Array.from(picture.children).filter(
      (c) => c.tagName.toLowerCase() === 'source'
    );
    sourceEls.forEach((source, i) => {
      const type = source.getAttribute('type');
      const match =
        req.sources?.find((s) => s.type !== undefined && s.type === type) ??
        req.sources?.find((s) => s.type === undefined);
      const srcset = match ? match.srcset : fallbackSrcset;
      const sizes = match ? (match.sizes ?? null) : req.srcset !== null ? req.sizes : null;
      writes.push({
        key: `source[${i}].srcset`,
        el: source,
        attr: 'srcset',
        applied: srcset,
        url: true,
      });
      writes.push({
        key: `source[${i}].sizes`,
        el: source,
        attr: 'sizes',
        applied: sizes,
        url: false,
      });
    });
  }
  return writes;
}

/** Every URL the caller offered, resolved against the document, for the currentSrc check. */
function candidateUrls(req: ValidatedMediaOverride): Set<string> {
  const out = new Set<string>();
  const add = (u: string): void => {
    try {
      out.add(new URL(u, document.baseURI).href);
    } catch {
      out.add(u);
    }
  };
  const addSrcset = (s: string): void => {
    for (const candidate of s.split(/,\s+/)) {
      const url = candidate.trim().split(/\s+/)[0];
      if (url) add(url);
    }
  };
  if (req.src !== null) add(req.src);
  if (req.srcset !== null) addSrcset(req.srcset);
  for (const s of req.sources ?? []) addSrcset(s.srcset);
  if (req.backgroundImage !== null) add(req.backgroundImage);
  return out;
}

class DecodeTimeout extends Error {}

/** Least time the pixel-size probe gets after the slot itself decoded. */
const PIXEL_PROBE_FLOOR_MS = 1_000;

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new DecodeTimeout(`no decode within ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

type Readiness =
  | { ok: true; ready: MediaOverrideReadiness }
  | { ok: false; code: MediaOverrideErrorCode; error: string };

async function awaitImageReady(
  img: HTMLImageElement,
  candidates: Set<string>,
  timeoutMs: number
): Promise<Readiness> {
  if (typeof img.decode !== 'function') {
    return {
      ok: false,
      code: 'capability_unavailable_in_build',
      error:
        'HTMLImageElement.decode is unavailable in this engine, so the swap cannot be confirmed',
    };
  }
  const deadline = Date.now() + timeoutMs;
  try {
    await withTimeout(img.decode(), timeoutMs);
  } catch (err) {
    if (err instanceof DecodeTimeout) {
      return { ok: false, code: 'DECODE_TIMEOUT', error: err.message };
    }
    return {
      ok: false,
      code: 'DECODE_FAILED',
      error: `the browser could not decode the candidate: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const currentSrc = img.currentSrc;
  if (!candidates.has(currentSrc)) {
    return {
      ok: false,
      code: 'CURRENT_SRC_MISMATCH',
      error:
        `the image decoded, but currentSrc is ${JSON.stringify(currentSrc)}, which is none of the ` +
        `candidates supplied; the browser is still showing something else`,
    };
  }
  // A floor, not the bare remainder: the probe re-decodes a resource the slot
  // just decoded, and a decode that used the whole budget must still be
  // measurable. Callers size their transport budget with headroom above
  // decodeTimeoutMs (the runner keeps 2 s), which this floor stays inside.
  const size = await pixelSize(currentSrc, Math.max(deadline - Date.now(), PIXEL_PROBE_FLOOR_MS));
  return {
    ok: true,
    ready: { decoded: true, currentSrc, naturalWidth: size.width, naturalHeight: size.height },
  };
}

/**
 * The pixel size of `url`, decoded in a detached `<img>` with no srcset (so
 * density 1) — the size a resolution judgment needs. The resource is the one
 * the slot just decoded, so this is normally a cache hit. A failed or
 * timed-out probe is unmeasured (`null`), never a guess.
 */
async function pixelSize(
  url: string,
  timeoutMs: number
): Promise<{ width: number | null; height: number | null }> {
  const probe = new Image();
  probe.src = url;
  try {
    await withTimeout(probe.decode(), timeoutMs);
  } catch {
    return { width: null, height: null };
  }
  return { width: probe.naturalWidth || null, height: probe.naturalHeight || null };
}

async function awaitBackgroundReady(
  el: Element,
  url: string,
  timeoutMs: number
): Promise<Readiness> {
  const resolved = new URL(url, document.baseURI).href;
  const probe = new Image();
  if (typeof probe.decode !== 'function') {
    return {
      ok: false,
      code: 'capability_unavailable_in_build',
      error:
        'HTMLImageElement.decode is unavailable in this engine, so the swap cannot be confirmed',
    };
  }
  probe.src = resolved;
  try {
    await withTimeout(probe.decode(), timeoutMs);
  } catch (err) {
    if (err instanceof DecodeTimeout)
      return { ok: false, code: 'DECODE_TIMEOUT', error: err.message };
    return {
      ok: false,
      code: 'DECODE_FAILED',
      error: `the browser could not decode the candidate: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const computed = getComputedStyle(el).backgroundImage;
  if (!computed.includes(resolved) && !computed.includes(url)) {
    return {
      ok: false,
      code: 'CURRENT_SRC_MISMATCH',
      error:
        `the candidate decoded, but the computed background-image is ${JSON.stringify(computed)}; ` +
        `the element is not showing it`,
    };
  }
  return {
    ok: true,
    ready: {
      decoded: true,
      currentSrc: resolved,
      naturalWidth: probe.naturalWidth || null,
      naturalHeight: probe.naturalHeight || null,
    },
  };
}

function scrubbedOriginals(rec: OverrideRecord): Record<string, string | null> {
  const redact = isContentRedacted(rec.anchor as HTMLElement);
  const out: Record<string, string | null> = {};
  for (const a of rec.attrs) {
    out[a.key] = redact && a.url && a.original !== null ? REDACTED_VALUE : a.original;
  }
  return out;
}

function appliedValues(rec: OverrideRecord): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const a of rec.attrs) out[a.key] = a.applied;
  return out;
}

function armTtl(rec: OverrideRecord, ttlMs: number): void {
  if (rec.timer !== null) clearTimeout(rec.timer);
  rec.expiresAt = Date.now() + ttlMs;
  rec.timer = setTimeout(() => {
    if (active.get(rec.overrideId) !== rec) return;
    const result = restoreRecord(rec, 'ttl');
    recentlyExpired.push(result);
    if (recentlyExpired.length > RECENTLY_EXPIRED_LIMIT) recentlyExpired.shift();
  }, ttlMs);
}

/**
 * Apply an override. Resolves the target, records the originals, writes the
 * candidate, waits for the browser to decode it and confirms `currentSrc`;
 * an override that cannot be confirmed is rolled back before answering.
 */
export async function applyMediaOverride(
  raw: unknown,
  resolveElement: (id: string) => Element | null | undefined
): Promise<MediaOverrideSuccess | MediaOverrideFailure> {
  const req = validateMediaOverrideRequest(raw);
  if (typeof req === 'string') {
    return { success: false, code: 'INVALID_REQUEST', error: req, timestamp: Date.now() };
  }
  const resolved = resolveTarget(req, resolveElement);
  if (!resolved.ok) {
    return { success: false, code: resolved.code, error: resolved.error, timestamp: Date.now() };
  }
  const { anchor, img, picture } = resolved;

  const existing = Array.from(active.values()).find((r) => r.anchor === anchor);
  const mode: MediaOverrideMode = req.backgroundImage !== null ? 'background' : 'image';
  if (existing && existing.mode !== mode) {
    // A swap of mechanism (image ⇄ background) on one target: undo the first
    // completely, then start again from the true originals.
    restoreRecord(existing, 'request');
  }
  const reuse = existing && existing.mode === mode ? existing : null;

  const planned =
    mode === 'background'
      ? [
          {
            key: 'style',
            el: anchor,
            attr: 'style',
            applied: '',
            url: true,
          },
        ]
      : planImageWrites(req, img as HTMLImageElement, picture);

  // Originals: the FIRST override's record wins, so a chain of candidates on
  // one slot restores to what the page had, not to the previous candidate.
  const attrs: AttrRecord[] = planned.map((w) => {
    const prior = reuse?.attrs.find((a) => a.key === w.key && a.el === w.el);
    const original = prior ? prior.original : readAttr(w.el, w.attr);
    const applied =
      mode === 'background'
        ? styleWithBackground(original, req.backgroundImage as string)
        : w.applied;
    return { ...w, original, applied };
  });
  // A re-override that no longer writes an attribute the first one did (src
  // alone after srcset) must still put that attribute back eventually.
  if (reuse) {
    for (const prior of reuse.attrs) {
      const dropped = !attrs.some((a) => a.key === prior.key && a.el === prior.el);
      // Same no-clobber rule as a restore: only an attribute still holding
      // what the override wrote goes back.
      if (dropped && readAttr(prior.el, prior.attr) === prior.applied) {
        writeAttr(prior.el, prior.attr, prior.original);
      }
    }
  }

  for (const a of attrs) writeAttr(a.el, a.attr, a.applied);

  const tag = (mode === 'background' ? anchor : (img as HTMLImageElement)).tagName.toLowerCase();
  const rec: OverrideRecord = reuse ?? {
    overrideId: nextOverrideId(),
    mode,
    anchor,
    target: {
      slotId: req.slotId,
      elementId: req.elementId,
      tag,
      inPicture: picture !== null,
    },
    attrs,
    appliedAt: Date.now(),
    expiresAt: 0,
    timer: null,
  };
  rec.attrs = attrs;
  rec.appliedAt = Date.now();
  active.set(rec.overrideId, rec);

  const readiness =
    mode === 'background'
      ? await awaitBackgroundReady(anchor, req.backgroundImage as string, req.decodeTimeoutMs)
      : await awaitImageReady(img as HTMLImageElement, candidateUrls(req), req.decodeTimeoutMs);

  if (!readiness.ok) {
    const rolledBack = restoreRecord(rec, 'rollback');
    return {
      success: false,
      code: readiness.code,
      error: `${readiness.error}. The override was rolled back.`,
      rolledBack,
      timestamp: Date.now(),
    };
  }

  armTtl(rec, req.ttlMs);
  return {
    success: true,
    overrideId: rec.overrideId,
    replaced: reuse !== null,
    mode,
    target: rec.target,
    originals: scrubbedOriginals(rec),
    applied: appliedValues(rec),
    ready: readiness.ready,
    appliedAt: rec.appliedAt,
    expiresAt: rec.expiresAt,
    timestamp: Date.now(),
  };
}

// ============================================================================
// Restore
// ============================================================================

function restoreRecord(rec: OverrideRecord, trigger: RestoreResult['trigger']): RestoreResult {
  if (rec.timer !== null) clearTimeout(rec.timer);
  rec.timer = null;
  active.delete(rec.overrideId);

  if (!rec.anchor.isConnected) {
    return {
      overrideId: rec.overrideId,
      status: 'detached',
      verified: null,
      mismatches: [],
      drift: [],
      trigger,
    };
  }

  const drift: string[] = [];
  const restored: AttrRecord[] = [];
  for (const a of rec.attrs) {
    if (readAttr(a.el, a.attr) !== a.applied) {
      // The app rewrote it after the override. Its value is newer than our
      // original, so it stays.
      drift.push(a.key);
      continue;
    }
    writeAttr(a.el, a.attr, a.original);
    restored.push(a);
  }

  const redact = isContentRedacted(rec.anchor as HTMLElement);
  const mismatches: RestoreMismatch[] = [];
  for (const a of restored) {
    const actual = readAttr(a.el, a.attr);
    if (actual !== a.original) {
      const hide = (v: string | null): string | null =>
        redact && a.url && v !== null ? REDACTED_VALUE : v;
      mismatches.push({ key: a.key, expected: hide(a.original), actual: hide(actual) });
    }
  }
  return {
    overrideId: rec.overrideId,
    status: 'restored',
    verified: mismatches.length === 0,
    mismatches,
    drift,
    trigger,
  };
}

/** Restore one override (by id) or all of them, verifying each attribute reads back. */
export function restoreMediaOverrides(
  raw: unknown
): MediaOverrideRestoreSuccess | MediaOverrideFailure {
  const r = (raw ?? {}) as MediaOverrideRestoreRequest;
  if (typeof r !== 'object' || Array.isArray(r)) {
    return {
      success: false,
      code: 'INVALID_REQUEST',
      error: 'body must be a JSON object',
      timestamp: Date.now(),
    };
  }
  if (r.overrideId !== undefined && !isNonEmptyString(r.overrideId)) {
    return {
      success: false,
      code: 'INVALID_REQUEST',
      error: 'overrideId must be a non-empty string',
      timestamp: Date.now(),
    };
  }
  let targets: OverrideRecord[];
  if (r.overrideId !== undefined) {
    const rec = active.get(r.overrideId);
    if (!rec) {
      const expired = recentlyExpired.find((e) => e.overrideId === r.overrideId);
      return {
        success: false,
        code: 'NOT_FOUND',
        error: expired
          ? `override ${r.overrideId} already expired and was restored by its TTL (verified: ${String(expired.verified)})`
          : `no active override ${r.overrideId}`,
        timestamp: Date.now(),
      };
    }
    targets = [rec];
  } else {
    targets = Array.from(active.values());
  }
  const restored = targets.map((rec) => restoreRecord(rec, 'request'));
  return { success: true, restored, remaining: active.size, timestamp: Date.now() };
}

/** The overrides still in force, and the last few the TTL undid. */
export function listMediaOverrides(): MediaOverrideListSuccess {
  return {
    success: true,
    active: Array.from(active.values()).map((rec) => ({
      overrideId: rec.overrideId,
      mode: rec.mode,
      target: rec.target,
      appliedAt: rec.appliedAt,
      expiresAt: rec.expiresAt,
      connected: rec.anchor.isConnected,
    })),
    recentlyExpired: [...recentlyExpired],
    timestamp: Date.now(),
  };
}

/** Test-only: drop every record and timer without touching the DOM. */
export function resetMediaOverridesForTest(): void {
  for (const rec of active.values()) if (rec.timer !== null) clearTimeout(rec.timer);
  active.clear();
  recentlyExpired.length = 0;
  sequence = 0;
}
