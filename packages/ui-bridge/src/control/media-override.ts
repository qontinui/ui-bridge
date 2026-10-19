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
 *    it, never by writing `""`). The background arm owns ONE inline
 *    declaration, `background-image`, and records only that one, so an inline
 *    style the app writes while the override is up survives the restore.
 *  - `<picture>` is overridden whole. A browser picks a `<source>` before it
 *    ever looks at the `<img>`, so changing only `img.src` leaves the original
 *    showing. Every `<source srcset>` is replaced too (per type when the caller
 *    names `sources`, which is the AVIF/WebP-plus-fallback shape Phase 19's
 *    compile step emits).
 *  - Nothing is reported ready until the browser has DECODED the new image and
 *    `currentSrc` names one of the candidates the caller supplied. An override
 *    that cannot get there is undone before it answers, so a capture can never
 *    run against a half-applied or still-loading swap. A `loading="lazy"` slot
 *    is switched to `eager` for the override's lifetime, because an offscreen
 *    lazy image never loads, so it would never decode.
 *  - A TTL restores the page by itself, so a caller that dies mid-run cannot
 *    leave the page altered.
 *  - A restore is verified against what the browser RENDERS, not against what
 *    was just written: the `<img>`'s `currentSrc` must be back on an original
 *    URL, or the computed `background-image` must no longer show the
 *    candidate. Reading back an attribute the restore itself wrote could
 *    never fail, so it is not the proof.
 *  - A restore never clobbers the app. If the app rewrote an attribute after
 *    the override (a re-render with a new `src`), that attribute is left as
 *    the app set it and reported as `drift`, rather than reverted to a value
 *    older than the app's own. A restore with drift is `restored_with_drift`
 *    and NEVER `verified`: what the page shows is then the app's choice, not
 *    the original, and may still be the candidate.
 *  - Candidate URLs are http(s), `blob:`, `data:image/*`, or the page's own
 *    scheme (what a relative reference resolves to). The scheme is the one
 *    the browser's URL parser resolves, never a pattern over the raw text, so
 *    characters the parser strips cannot disguise one. Any other scheme is
 *    refused, typed (`UNSUPPORTED_URL_SCHEME`).
 *
 * TRANSPORT BUDGETS. An apply can take up to `decodeTimeoutMs` plus
 * {@link POST_DECODE_WAIT_MS}; a restore up to its `verifyTimeoutMs` (default:
 * the override's own `decodeTimeoutMs`). A transport that times commands out
 * must leave {@link MEDIA_OVERRIDE_TRANSPORT_HEADROOM_MS} above both, or a slow
 * swap comes back as a bare transport timeout instead of the typed result
 * (with its rollback). {@link fitMediaOverrideBudget} does that fit: it fills
 * an absent wait with one that fits and refuses one that does not. The
 * relay's handlers apply it against the relay's command timeout (the smaller
 * of its WebSocket and SSE timeouts, 10 s and 8 s by default, so a 6 s
 * ceiling); the qontinui-runner applies its own (`fit_decode_budget`).
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
import {
  DEFAULT_DECODE_TIMEOUT_MS,
  MAX_DECODE_TIMEOUT_MS,
  POST_DECODE_WAIT_MS,
} from './media-override-budget';

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
  /**
   * Bound on each restore's wait for the original to render. Default: the
   * override's own `decodeTimeoutMs`. A transport sets it to fit its budget.
   */
  verifyTimeoutMs?: number;
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
  | 'UNSUPPORTED_URL_SCHEME'
  /** A concurrent DELETE, TTL or later override on the same target won while the decode was awaited. */
  | 'OVERRIDE_CANCELLED'
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
   * The candidate's size in image PIXELS. For an `<img>` it is read from the
   * slot element itself, through `createImageBitmap(img)` over the image it
   * just decoded — no second fetch, so `--no-cache` costs nothing extra. Not
   * the slot's `naturalWidth`: that is divided by the density the browser
   * selected, and Chromium keeps the density of the slot's PREVIOUS srcset
   * choice after a src-only swap, so a 100 px candidate in a slot that last
   * chose a 2x source reads 50. For a background it is the decode probe's own
   * size (the probe has no srcset, so density 1). `null` when it could not be
   * measured — no `createImageBitmap`, or an image with no intrinsic size —
   * unmeasured, never 0.
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
   * `restored` — every attribute the override wrote was put back; `verified`
   * says whether the browser then RENDERS the original. `restored_with_drift`
   * — the app rewrote at least one attribute after the override, so that one
   * was left as the app set it (`drift`); the page is the app's, not the
   * original, and the restore is never verified. `detached` — the target left
   * the DOM; there is nothing to restore and nothing was verified.
   */
  status: 'restored' | 'restored_with_drift' | 'detached';
  /**
   * True only when no attribute drifted, every restored attribute reads back
   * as its original, AND the rendered state is off the candidate: the
   * `<img>`'s `currentSrc` is on an original URL again (waited for, bounded by
   * the override's `decodeTimeoutMs`), or the computed `background-image` no
   * longer shows the candidate. `false` otherwise — read it as an UNKNOWN
   * restore, never as a clean page. `null` when detached.
   */
  verified: boolean | null;
  /**
   * What did not come back. Attribute keys (`img.src`) compare the DOM;
   * `rendered.currentSrc` and `rendered.background-image` compare what the
   * browser shows.
   */
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
export {
  DEFAULT_DECODE_TIMEOUT_MS,
  MAX_DECODE_TIMEOUT_MS,
  POST_DECODE_WAIT_MS,
  MEDIA_OVERRIDE_TRANSPORT_HEADROOM_MS,
  fitMediaOverrideBudget,
} from './media-override-budget';
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
// URLs: srcset grammar, scheme allowlist, CSS escaping
// ============================================================================

const isSrcsetSpace = (c: string): boolean =>
  c === ' ' || c === '\t' || c === '\n' || c === '\f' || c === '\r';

/**
 * The URLs of a `srcset`, parsed per the HTML "parse a srcset attribute"
 * grammar: a URL is a run of non-whitespace (so a `data:` URL keeps its
 * commas), trailing commas end a candidate with no descriptors, and a
 * descriptor list ends at the first comma outside parentheses — whether or
 * not whitespace follows it (`a.png 1x,b.png 2x` is two candidates).
 */
export function parseSrcsetUrls(srcset: string): string[] {
  const urls: string[] = [];
  const n = srcset.length;
  let i = 0;
  while (i < n) {
    while (i < n && (isSrcsetSpace(srcset[i]!) || srcset[i] === ',')) i++;
    if (i >= n) break;
    const start = i;
    while (i < n && !isSrcsetSpace(srcset[i]!)) i++;
    let url = srcset.slice(start, i);
    if (url.endsWith(',')) {
      url = url.replace(/,+$/, '');
      if (url) urls.push(url);
      continue;
    }
    urls.push(url);
    let inParens = false;
    while (i < n) {
      const c = srcset[i]!;
      i++;
      if (c === '(') inParens = true;
      else if (c === ')') inParens = false;
      else if (c === ',' && !inParens) break;
    }
  }
  return urls;
}

const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'blob:']);

/**
 * Why `url` may not be a candidate, or `null` when it may. The scheme judged
 * is the one the WHATWG URL parser resolves against the page — the same parse
 * the browser applies when the attribute or `url()` is loaded — so leading
 * C0 controls, spaces, tabs or newlines the parser strips cannot make a
 * scheme look like a relative reference. Allowed: http, https, `blob:`,
 * `data:image/*`, and the page's own scheme (what a relative reference
 * resolves to, so it loads from where the page itself came from).
 */
/** The page's own scheme, or `null` when its base URL does not parse. */
function pageSchemeOf(): string | null {
  try {
    return new URL(document.baseURI).protocol;
  } catch {
    return null;
  }
}

function schemeProblem(url: string): string | null {
  let resolved: URL;
  try {
    resolved = new URL(url, document.baseURI);
  } catch {
    return `${JSON.stringify(url)} is not a URL the page can resolve`;
  }
  const scheme = resolved.protocol;
  if (ALLOWED_SCHEMES.has(scheme)) return null;
  if (scheme === 'data:') {
    if (/^data:image\//i.test(resolved.href)) return null;
  } else {
    if (scheme === pageSchemeOf() && scheme !== 'javascript:') return null;
  }
  return (
    `${JSON.stringify(scheme)} is not an override scheme; a candidate must be http(s), ` +
    `blob:, data:image/*, or the page's own scheme`
  );
}

/** Every URL a validated request would make the page load. */
function requestUrls(req: ValidatedMediaOverride): string[] {
  const out: string[] = [];
  if (req.src !== null) out.push(req.src);
  if (req.srcset !== null) out.push(...parseSrcsetUrls(req.srcset));
  for (const s of req.sources ?? []) out.push(...parseSrcsetUrls(s.srcset));
  if (req.backgroundImage !== null) out.push(req.backgroundImage);
  return out;
}

/** Code points left as themselves inside a quoted CSS `url("…")`. */
const CSS_URL_SAFE = /^[A-Za-z0-9\-._~:/?#[\]@!$&*+,=%]$/;

/**
 * CSS `url("…")` for a URL. Every code point outside a small safe set —
 * every control character (form feed and NUL included), quotes, backslash,
 * parentheses, `;`, whitespace and all non-ASCII — is written as a CSS hex
 * escape `\HH ` (the trailing space ends the escape and is consumed by the
 * parser). No URL can therefore end the string or the declaration.
 */
export function cssUrl(url: string): string {
  let out = '';
  for (const ch of url) {
    out += CSS_URL_SAFE.test(ch) ? ch : `\\${ch.codePointAt(0)!.toString(16)} `;
  }
  return `url("${out}")`;
}

function resolveUrl(u: string): string {
  try {
    return new URL(u, document.baseURI).href;
  } catch {
    return u;
  }
}

// ============================================================================
// State
// ============================================================================

/**
 * One value the override wrote: where, what was there, what we put there.
 * `kind: 'attr'` is an element attribute; `kind: 'style'` is ONE inline CSS
 * declaration (`attr` names the property), read and written through the
 * element's `style` declaration block so other inline declarations are never
 * touched. A style value is `<value>` or `<value> !important`, `null` when
 * the declaration is absent. `key` names it in responses (`img.src`,
 * `source[1].srcset`, `style.background-image`).
 */
interface AttrRecord {
  key: string;
  el: Element;
  kind: 'attr' | 'style';
  attr: string;
  original: string | null;
  applied: string | null;
  /** The original is a URL a redaction boundary hides. */
  url: boolean;
  /** Restored only after the rendered state settled (`img.loading`). */
  restoreLast?: boolean;
}

/** What the restore verifies against the RENDERED page. */
type RenderProbe =
  | {
      kind: 'image';
      img: HTMLImageElement;
      /** `currentSrc` before the first override. */
      originalCurrentSrc: string;
      /** Every URL the original markup offers, resolved. */
      originalUrls: Set<string>;
    }
  | {
      kind: 'background';
      /** Computed `background-image` before the first override. */
      originalComputed: string;
      /** The candidate, resolved and as given. */
      candidate: { resolved: string; raw: string };
    };

interface OverrideRecord {
  overrideId: string;
  mode: MediaOverrideMode;
  /** The element the override writes to: the `<img>`, or the background's element. */
  targetEl: Element;
  /** The element the caller named (redaction is judged on it). */
  anchor: Element;
  target: MediaOverrideTarget;
  attrs: AttrRecord[];
  render: RenderProbe;
  /**
   * Background arm: the whole `style` attribute before the first override and
   * right after the latest one. When nothing else touched the attribute in
   * between, the restore writes the original text back verbatim (byte-exact);
   * otherwise it restores only the `background-image` declaration.
   */
  styleAttr: { original: string | null; applied: string | null } | null;
  decodeTimeoutMs: number;
  /** Bumped by every apply, so an apply can tell a later one superseded it. */
  generation: number;
  /** Set when the record was restored; an awaiting apply reports it. */
  restoredBy: RestoreResult['trigger'] | null;
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
    if (!(anchor as Partial<ElementCSSInlineStyle>).style) {
      return {
        ok: false,
        code: 'TARGET_NOT_AN_IMAGE',
        error: `the <${anchor.tagName.toLowerCase()}> target has no inline style to override`,
      };
    }
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
// Reading and writing one recorded value
// ============================================================================

function writeAttr(el: Element, attr: string, value: string | null): void {
  if (value === null) el.removeAttribute(attr);
  else el.setAttribute(attr, value);
}

function styleOf(el: Element): CSSStyleDeclaration {
  return (el as unknown as ElementCSSInlineStyle).style;
}

const IMPORTANT = ' !important';

function readValue(a: Pick<AttrRecord, 'el' | 'kind' | 'attr'>): string | null {
  if (a.kind === 'attr') return a.el.getAttribute(a.attr);
  const style = styleOf(a.el);
  const value = style.getPropertyValue(a.attr);
  if (value === '') return null;
  return style.getPropertyPriority(a.attr) === 'important' ? `${value}${IMPORTANT}` : value;
}

function writeValue(a: Pick<AttrRecord, 'el' | 'kind' | 'attr'>, value: string | null): void {
  if (a.kind === 'attr') {
    writeAttr(a.el, a.attr, value);
    return;
  }
  const style = styleOf(a.el);
  if (value === null) style.removeProperty(a.attr);
  else if (value.endsWith(IMPORTANT)) {
    style.setProperty(a.attr, value.slice(0, -IMPORTANT.length), 'important');
  } else style.setProperty(a.attr, value, '');
}

// ============================================================================
// Apply
// ============================================================================

type PlannedWrite = Omit<AttrRecord, 'original'>;

/**
 * Plan the attribute writes for a request. Each entry's `original` is read
 * from the live DOM, unless a re-override supplies the first override's.
 */
function planImageWrites(
  req: ValidatedMediaOverride,
  img: HTMLImageElement,
  picture: Element | null,
  reuse: OverrideRecord | null
): PlannedWrite[] {
  const writes: PlannedWrite[] = [];
  const attr = (
    key: string,
    el: Element,
    name: string,
    applied: string | null,
    url: boolean
  ): PlannedWrite => ({ key, el, kind: 'attr', attr: name, applied, url });
  // An offscreen `loading="lazy"` image never loads, so it would never
  // decode. Eager for the override's lifetime; written FIRST so the load the
  // src write starts is already eager, and restored LAST (after the restore
  // re-rendered the original), or the original's load would be deferred and
  // `currentSrc` would stay on the candidate.
  const lazy = (img.getAttribute('loading') ?? '').toLowerCase() === 'lazy';
  if (lazy || reuse?.attrs.some((a) => a.key === 'img.loading')) {
    writes.push({ ...attr('img.loading', img, 'loading', 'eager', false), restoreLast: true });
  }
  // The <img>: `src` keeps the original as the srcset fallback unless given;
  // `src` alone clears srcset/sizes, or the browser would keep choosing from them.
  if (req.src !== null) writes.push(attr('img.src', img, 'src', req.src, true));
  if (req.srcset !== null) {
    writes.push(attr('img.srcset', img, 'srcset', req.srcset, true));
    if (req.sizes !== null) writes.push(attr('img.sizes', img, 'sizes', req.sizes, false));
  } else {
    writes.push(attr('img.srcset', img, 'srcset', null, true));
    writes.push(attr('img.sizes', img, 'sizes', null, false));
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
      writes.push(attr(`source[${i}].srcset`, source, 'srcset', srcset, true));
      writes.push(attr(`source[${i}].sizes`, source, 'sizes', sizes, false));
    });
  }
  return writes;
}

/** Every URL the caller offered, resolved against the document, for the currentSrc check. */
function candidateUrls(req: ValidatedMediaOverride): Set<string> {
  return new Set(requestUrls(req).map(resolveUrl));
}

/** Every URL the slot's ORIGINAL markup offers, resolved — what a verified restore may show. */
function originalImageUrls(img: HTMLImageElement, picture: Element | null): Set<string> {
  const out = new Set<string>();
  const src = img.getAttribute('src');
  if (src) out.add(resolveUrl(src));
  for (const u of parseSrcsetUrls(img.getAttribute('srcset') ?? '')) out.add(resolveUrl(u));
  for (const c of picture ? Array.from(picture.children) : []) {
    if (c.tagName.toLowerCase() !== 'source') continue;
    for (const u of parseSrcsetUrls(c.getAttribute('srcset') ?? '')) out.add(resolveUrl(u));
  }
  return out;
}

class DecodeTimeout extends Error {}

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
  const size = await pixelSize(img);
  return {
    ok: true,
    ready: { decoded: true, currentSrc, naturalWidth: size.width, naturalHeight: size.height },
  };
}

/**
 * The pixel size of the image the slot element just decoded, through
 * `createImageBitmap(img)`: it reads the element's own decoded image data —
 * no request, so it is the same under `--no-cache` — at its full pixel size,
 * not divided by any srcset density. Bounded by {@link POST_DECODE_WAIT_MS}.
 * Unmeasurable (no `createImageBitmap`, an SVG with no intrinsic size, a
 * timeout) is `null`, never a guess.
 */
async function pixelSize(
  img: HTMLImageElement
): Promise<{ width: number | null; height: number | null }> {
  const unmeasured = { width: null, height: null };
  if (typeof createImageBitmap !== 'function') return unmeasured;
  const pending = createImageBitmap(img);
  try {
    const bitmap = await withTimeout(pending, POST_DECODE_WAIT_MS);
    const size = { width: bitmap.width || null, height: bitmap.height || null };
    bitmap.close?.();
    return size;
  } catch {
    pending.then((b) => b.close?.()).catch(() => {});
    return unmeasured;
  }
}

/**
 * A background has no element-level decode, so a detached probe decodes the
 * candidate to confirm the browser can (one extra request for the URL when
 * the HTTP cache is disabled), and the computed style confirms the element
 * shows it.
 */
async function awaitBackgroundReady(
  el: Element,
  url: string,
  timeoutMs: number
): Promise<Readiness> {
  const resolved = resolveUrl(url);
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
    void restoreRecord(rec, 'ttl', rec.decodeTimeoutMs).then((result) => {
      recentlyExpired.push(result);
      if (recentlyExpired.length > RECENTLY_EXPIRED_LIMIT) recentlyExpired.shift();
    });
  }, ttlMs);
}

function failure(
  code: MediaOverrideErrorCode,
  error: string,
  rolledBack?: RestoreResult
): MediaOverrideFailure {
  return {
    success: false,
    code,
    error,
    ...(rolledBack ? { rolledBack } : {}),
    timestamp: Date.now(),
  };
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
  if (typeof req === 'string') return failure('INVALID_REQUEST', req);
  for (const u of requestUrls(req)) {
    const problem = schemeProblem(u);
    if (problem !== null) return failure('UNSUPPORTED_URL_SCHEME', problem);
  }
  const resolved = resolveTarget(req, resolveElement);
  if (!resolved.ok) return failure(resolved.code, resolved.error);
  const { anchor, img, picture } = resolved;

  const mode: MediaOverrideMode = req.backgroundImage !== null ? 'background' : 'image';
  // One record per element WRITTEN TO: a `<picture>` slot and its `<img>`
  // named by elementId are one target, never two records each holding the
  // other's candidate as its "original".
  const targetEl: Element = mode === 'background' ? anchor : (img as HTMLImageElement);
  const existing = Array.from(active.values()).find((r) => r.targetEl === targetEl);
  if (existing && existing.mode !== mode) {
    // A swap of mechanism (image ⇄ background) on one target: undo the first
    // completely, then start again from the true originals. Its result is not
    // reported, so it does not wait on the render.
    await restoreRecord(existing, 'request', 0);
  }
  const reuse = existing && existing.mode === mode ? existing : null;

  let attrs: AttrRecord[];
  let styleAttr: OverrideRecord['styleAttr'] = null;
  let render: RenderProbe;
  if (mode === 'background') {
    const write: PlannedWrite = {
      key: 'style.background-image',
      el: anchor,
      kind: 'style',
      attr: 'background-image',
      applied: `${cssUrl(req.backgroundImage as string)}${IMPORTANT}`,
      url: true,
    };
    const prior = reuse?.attrs.find((a) => a.key === write.key);
    attrs = [{ ...write, original: prior ? prior.original : readValue(write) }];
    styleAttr = {
      original: reuse?.styleAttr ? reuse.styleAttr.original : anchor.getAttribute('style'),
      applied: null,
    };
    const candidate = {
      resolved: resolveUrl(req.backgroundImage as string),
      raw: req.backgroundImage as string,
    };
    render =
      reuse?.render.kind === 'background'
        ? { ...reuse.render, candidate }
        : {
            kind: 'background',
            originalComputed: getComputedStyle(anchor).backgroundImage,
            candidate,
          };
  } else {
    const image = img as HTMLImageElement;
    // Originals: the FIRST override's record wins, so a chain of candidates on
    // one slot restores to what the page had, not to the previous candidate.
    attrs = planImageWrites(req, image, picture, reuse).map((w) => {
      const prior = reuse?.attrs.find((a) => a.key === w.key && a.el === w.el);
      return { ...w, original: prior ? prior.original : readValue(w) };
    });
    render = reuse?.render ?? {
      kind: 'image',
      img: image,
      originalCurrentSrc: image.currentSrc,
      originalUrls: originalImageUrls(image, picture),
    };
  }
  // A re-override that no longer writes an attribute the first one did (src
  // alone after srcset) must still put that attribute back eventually.
  if (reuse) {
    for (const prior of reuse.attrs) {
      const dropped = !attrs.some((a) => a.key === prior.key && a.el === prior.el);
      // Same no-clobber rule as a restore: only an attribute still holding
      // what the override wrote goes back.
      if (dropped && readValue(prior) === prior.applied) writeValue(prior, prior.original);
    }
  }

  for (const a of attrs) {
    writeValue(a, a.applied);
    // A style value is stored as the engine serialized it, so the restore's
    // "still what we wrote?" test compares like with like.
    if (a.kind === 'style') a.applied = readValue(a);
  }
  if (styleAttr) styleAttr.applied = anchor.getAttribute('style');

  const tag = targetEl.tagName.toLowerCase();
  const rec: OverrideRecord = reuse ?? {
    overrideId: nextOverrideId(),
    mode,
    targetEl,
    anchor,
    target: {
      slotId: req.slotId,
      elementId: req.elementId,
      tag,
      inPicture: picture !== null,
    },
    attrs,
    render,
    styleAttr,
    decodeTimeoutMs: req.decodeTimeoutMs,
    generation: 0,
    restoredBy: null,
    appliedAt: Date.now(),
    expiresAt: 0,
    timer: null,
  };
  rec.attrs = attrs;
  rec.render = render;
  rec.styleAttr = styleAttr;
  rec.decodeTimeoutMs = req.decodeTimeoutMs;
  rec.appliedAt = Date.now();
  rec.generation += 1;
  const generation = rec.generation;
  active.set(rec.overrideId, rec);
  // Re-armed now, before the decode, and long enough to outlast this apply's
  // own bounded waits. A re-override inherits the record's armed TTL, which
  // could otherwise lapse mid-decode and cancel the very apply that is
  // replacing its candidate. (A caller that abandons an apply needs no TTL
  // during it: the bounded decode wait ends in a rollback either way.)
  // Re-armed from the confirmed moment below.
  armTtl(rec, req.ttlMs + req.decodeTimeoutMs + POST_DECODE_WAIT_MS);

  const readiness =
    mode === 'background'
      ? await awaitBackgroundReady(anchor, req.backgroundImage as string, req.decodeTimeoutMs)
      : await awaitImageReady(img as HTMLImageElement, candidateUrls(req), req.decodeTimeoutMs);

  // While this apply awaited the decode, a DELETE, the TTL, or a later
  // override on the same target may have taken the record over. Its outcome
  // stands; this apply must not report a swap that is no longer on the page,
  // nor roll back what the later one wrote.
  if (active.get(rec.overrideId) !== rec) {
    return failure(
      'OVERRIDE_CANCELLED',
      `override ${rec.overrideId} was restored (trigger: ${rec.restoredBy ?? 'unknown'}) while ` +
        `its decode was awaited; the page is not showing this candidate`
    );
  }
  if (rec.generation !== generation) {
    return failure(
      'OVERRIDE_CANCELLED',
      `a later override on the same target superseded this one while its decode was awaited; ` +
        `override ${rec.overrideId} now holds that later candidate`
    );
  }

  if (!readiness.ok) {
    const rolledBack = await restoreRecord(rec, 'rollback', POST_DECODE_WAIT_MS);
    return failure(readiness.code, `${readiness.error}. The override was rolled back.`, rolledBack);
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

/**
 * Put one recorded value back unless the app rewrote it since. Returns false
 * for drift.
 */
function restoreValue(a: AttrRecord): boolean {
  if (readValue(a) !== a.applied) return false;
  writeValue(a, a.original);
  return true;
}

/**
 * Wait (bounded) for the `<img>` to finish loading what the restore wrote, so
 * `currentSrc` reports the rendered result rather than the candidate still
 * current while the original loads. A decode that fails or times out is not
 * an error here — `currentSrc` is then judged as it stands.
 */
async function settleImage(img: HTMLImageElement, waitMs: number): Promise<void> {
  if (waitMs <= 0 || typeof img.decode !== 'function') return;
  try {
    await withTimeout(img.decode(), waitMs);
  } catch {
    // judged below on currentSrc as it stands
  }
}

/** Compare what the browser now renders with the original. */
function renderMismatch(rec: OverrideRecord, hide: (v: string) => string): RestoreMismatch | null {
  const r = rec.render;
  if (r.kind === 'image') {
    const now = r.img.currentSrc;
    if (now === r.originalCurrentSrc || r.originalUrls.has(now)) return null;
    return {
      key: 'rendered.currentSrc',
      expected: hide(r.originalCurrentSrc),
      actual: hide(now),
    };
  }
  const computed = getComputedStyle(rec.targetEl).backgroundImage;
  const shows = (css: string): boolean =>
    css.includes(r.candidate.resolved) || css.includes(r.candidate.raw);
  // A candidate identical to the original cannot be told apart by rendering.
  if (shows(r.originalComputed)) return null;
  if (!shows(computed)) return null;
  return {
    key: 'rendered.background-image',
    expected: hide(r.originalComputed),
    actual: hide(computed),
  };
}

/**
 * Restore one record. The DOM writes happen synchronously, before the first
 * await, so a caller that does not wait still leaves the page restored; the
 * rendered check then waits up to `waitMs` for the original to load.
 */
async function restoreRecord(
  rec: OverrideRecord,
  trigger: RestoreResult['trigger'],
  waitMs: number
): Promise<RestoreResult> {
  if (rec.timer !== null) clearTimeout(rec.timer);
  rec.timer = null;
  rec.restoredBy = trigger;
  active.delete(rec.overrideId);

  if (!rec.anchor.isConnected || !rec.targetEl.isConnected) {
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
  const restore = (a: AttrRecord): void => {
    if (restoreValue(a)) restored.push(a);
    else drift.push(a.key);
  };

  const sa = rec.styleAttr;
  for (const a of rec.attrs) {
    if (a.restoreLast) continue;
    if (a.kind === 'style' && sa && rec.targetEl.getAttribute('style') === sa.applied) {
      // Nothing but the override touched the style attribute: put its exact
      // original text back (byte-exact, no re-serialization).
      writeAttr(rec.targetEl, 'style', sa.original);
      restored.push(a);
      continue;
    }
    restore(a);
    // The declaration alone was restored; an attribute that did not exist
    // before and now holds nothing goes away too.
    if (a.kind === 'style' && sa?.original === null && rec.targetEl.getAttribute('style') === '') {
      rec.targetEl.removeAttribute('style');
    }
  }

  const redact = isContentRedacted(rec.anchor as HTMLElement);
  const mismatches: RestoreMismatch[] = [];
  if (drift.length === 0) {
    if (rec.render.kind === 'image') await settleImage(rec.render.img, waitMs);
    const m = renderMismatch(rec, (v) => (redact && v !== '' ? REDACTED_VALUE : v));
    if (m) mismatches.push(m);
  }
  for (const a of rec.attrs) if (a.restoreLast) restore(a);

  for (const a of restored) {
    const actual = readValue(a);
    if (actual !== a.original) {
      const hide = (v: string | null): string | null =>
        redact && a.url && v !== null ? REDACTED_VALUE : v;
      mismatches.push({ key: a.key, expected: hide(a.original), actual: hide(actual) });
    }
  }
  return {
    overrideId: rec.overrideId,
    status: drift.length > 0 ? 'restored_with_drift' : 'restored',
    verified: drift.length === 0 && mismatches.length === 0,
    mismatches,
    drift,
    trigger,
  };
}

/**
 * Restore one override (by id) or all of them, verifying each against what
 * the browser renders. Each restore waits at most its override's
 * `decodeTimeoutMs` (or `verifyTimeoutMs`, when smaller) for the original to
 * load; they run concurrently.
 */
export async function restoreMediaOverrides(
  raw: unknown
): Promise<MediaOverrideRestoreSuccess | MediaOverrideFailure> {
  const r = (raw ?? {}) as MediaOverrideRestoreRequest;
  if (typeof r !== 'object' || Array.isArray(r)) {
    return failure('INVALID_REQUEST', 'body must be a JSON object');
  }
  if (r.overrideId !== undefined && !isNonEmptyString(r.overrideId)) {
    return failure('INVALID_REQUEST', 'overrideId must be a non-empty string');
  }
  const verify = boundedInt(
    r.verifyTimeoutMs,
    'verifyTimeoutMs',
    0,
    MAX_DECODE_TIMEOUT_MS,
    MAX_DECODE_TIMEOUT_MS
  );
  if (typeof verify === 'string') return failure('INVALID_REQUEST', verify);
  let targets: OverrideRecord[];
  if (r.overrideId !== undefined) {
    const rec = active.get(r.overrideId);
    if (!rec) {
      const expired = recentlyExpired.find((e) => e.overrideId === r.overrideId);
      return failure(
        'NOT_FOUND',
        expired
          ? `override ${r.overrideId} already expired and was restored by its TTL (verified: ${String(expired.verified)})`
          : `no active override ${r.overrideId}`
      );
    }
    targets = [rec];
  } else {
    targets = Array.from(active.values());
  }
  const restored = await Promise.all(
    targets.map((rec) => restoreRecord(rec, 'request', Math.min(rec.decodeTimeoutMs, verify)))
  );
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
      connected: rec.targetEl.isConnected,
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
