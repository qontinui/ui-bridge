/**
 * Media Discovery
 *
 * Decides WHICH media elements register (images, video, canvas, SVG, picture,
 * `[role=img]`, CSS background images) and under WHAT id. What is measured
 * about each one — the observation the registry carries — lives in
 * `media-capture.ts`.
 *
 * Follows the same pattern as content-discovery.ts — media elements get their own
 * category ('media') and metadata type (a media observation).
 */

import { readAriaLabelAttr, readAltAttr, readTitleAttr } from '../core/a11y';
import { isContentRedacted } from '../core/redaction';
import type { UIBridgeRegistry } from '../core/registry';
import {
  backgroundImageUrl,
  captureBackgroundImageMetadata,
  captureMediaMetadata,
  inferMediaType,
  transcodedSourceUrl,
} from './media-capture';

// ============================================================================
// Configuration
// ============================================================================

/**
 * Options for media discovery
 */
export interface MediaDiscoveryOptions {
  /** Enable media discovery (default: true) */
  enabled?: boolean;
  /** Include elements with CSS background images (default: false) */
  includeBackgroundImages?: boolean;
  /** Maximum media elements to register (default: 200) */
  maxMediaElements?: number;
  /** Debounce interval for media registration (default: 200ms) */
  mediaDebounceMs?: number;
}

// ============================================================================
// Selectors
// ============================================================================

/**
 * CSS selectors for media elements.
 *
 * `<picture>` is deliberately absent: it is a container for the `<img>` that
 * paints, which IS matched, and is registered as the picture (`mediaType:
 * 'picture'`, with the `<source>` list). Listing both registered one image
 * twice.
 */
export const MEDIA_SELECTORS = ['img', 'svg:not(button svg)', 'video', 'canvas', '[role="img"]'];

/**
 * CSS selectors for elements that should always be excluded from media discovery
 */
export const MEDIA_EXCLUDE_SELECTORS = [
  'script',
  'style',
  'noscript',
  'template',
  '[aria-hidden="true"]',
  '[data-no-register]',
  '.sr-only',
  '.visually-hidden',
];

// ============================================================================
// Visibility & Filtering
// ============================================================================

/**
 * Check if a media element is visible
 */
function isMediaVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') {
    return false;
  }
  if (parseFloat(style.opacity) === 0) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  // Media elements can be 0x0 before loading; allow pending images through
  if (element.tagName.toLowerCase() === 'img') {
    const img = element as HTMLImageElement;
    if (!img.complete && img.loading === 'lazy') return true; // lazy not yet loaded
    if (!img.complete) return true; // still loading
  }
  return rect.width > 0 && rect.height > 0;
}

/**
 * Check if an element is an interactive element (should not be registered as media)
 */
function isInteractiveElement(element: HTMLElement): boolean {
  const tag = element.tagName.toLowerCase();
  if (['button', 'input', 'select', 'textarea', 'a'].includes(tag)) return true;
  const role = element.getAttribute('role');
  if (role && ['button', 'link', 'checkbox', 'radio', 'menuitem', 'tab', 'switch'].includes(role)) {
    return true;
  }
  return false;
}

/**
 * Check if an element should be registered as media.
 *
 * `isRegistered` answers by ELEMENT identity, never by derived id: two images
 * that derive the same id (a shared alt, two alt-less `next/image`s) are two
 * images, and the second one used to be skipped here as a "duplicate" — which
 * left it invisible to every media find and audit.
 */
export function shouldRegisterMedia(
  element: HTMLElement,
  _options: MediaDiscoveryOptions = {},
  isRegistered: (element: HTMLElement) => boolean
): boolean {
  // Check exclusion selectors
  for (const sel of MEDIA_EXCLUDE_SELECTORS) {
    if (element.matches(sel)) {
      return false;
    }
  }

  // Must be visible (with exceptions for loading images)
  if (!isMediaVisible(element)) {
    return false;
  }

  // Skip interactive elements — they're handled by interactive discovery
  if (isInteractiveElement(element)) {
    return false;
  }

  // Skip tiny SVG icons embedded in interactive elements (e.g., button > svg)
  const tag = element.tagName.toLowerCase();
  if (tag === 'svg') {
    const parent = element.parentElement;
    if (parent && isInteractiveElement(parent)) {
      return false;
    }
  }

  return !isRegistered(element);
}

/** Whether `element` paints a CSS `url(...)` background image. */
export function hasBackgroundImage(element: Element): boolean {
  return backgroundImageUrl(element) !== undefined;
}

/**
 * Find elements with CSS background images in a subtree (the root itself is
 * not visited — check it with {@link hasBackgroundImage}).
 *
 * Walks visible elements checking `getComputedStyle(el).backgroundImage`.
 * Skips elements already matched by standard media selectors. `maxVisited`
 * bounds the walk itself: every visited node costs a style read, and a
 * mutation-path scan must not turn one class change on a large subtree into a
 * full-document style pass.
 */
export function findBackgroundImageElements(
  root: HTMLElement,
  maxElements: number = 50,
  maxVisited: number = Number.POSITIVE_INFINITY
): HTMLElement[] {
  const results: HTMLElement[] = [];
  const mediaTags = new Set(['img', 'svg', 'picture', 'video', 'canvas']);

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      const el = node as HTMLElement;
      // Skip standard media elements — they're handled by MEDIA_SELECTORS
      if (mediaTags.has(el.tagName.toLowerCase())) return NodeFilter.FILTER_SKIP;
      // Skip invisible/excluded
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return NodeFilter.FILTER_SKIP;
      if (parseFloat(style.opacity) === 0) return NodeFilter.FILTER_SKIP;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let visited = 0;
  let node: Node | null;
  while (results.length < maxElements && visited < maxVisited && (node = walker.nextNode())) {
    visited++;
    const el = node as HTMLElement;
    if (hasBackgroundImage(el)) results.push(el);
  }

  return results;
}

// ============================================================================
// ID Generation
// ============================================================================

/**
 * Slugify text for use in IDs
 */
function slugify(text: string, maxLength: number = 30): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, maxLength)
    .replace(/-+$/, '');
}

/**
 * Get context from ancestor elements for disambiguation. Inside a §4.6
 * redaction boundary a landmark's `aria-label` is content, so only its role
 * is used.
 */
function getAncestorContext(element: HTMLElement, redacted: boolean): string | undefined {
  let current = element.parentElement;
  let depth = 0;
  while (current && depth < 5) {
    const testId = current.getAttribute('data-testid');
    if (testId) return slugify(testId, 20);

    const id = current.id;
    if (id && !/^:r[0-9a-z]+:$/.test(id)) return slugify(id, 20);

    const role = current.getAttribute('role');
    if (
      role &&
      ['main', 'banner', 'navigation', 'dialog', 'tabpanel', 'article', 'section'].includes(role)
    ) {
      const label = redacted ? null : readAriaLabelAttr(current);
      return label ? slugify(`${role}-${label}`, 20) : role;
    }

    current = current.parentElement;
    depth++;
  }
  return undefined;
}

/**
 * Get sibling index among same-tag siblings
 */
function getSiblingIndex(element: HTMLElement): number | undefined {
  const parent = element.parentElement;
  if (!parent) return undefined;
  const tag = element.tagName;
  const siblings = Array.from(parent.children).filter((c) => c.tagName === tag);
  if (siblings.length <= 1) return undefined;
  return siblings.indexOf(element);
}

/**
 * The file name a source URL names: `/img/hero.png?v=2` → `hero.png`. An
 * image-optimizer URL (`/_next/image?url=%2Fimg%2Fhero.png&w=1920`) is read
 * through to the source it transcodes — before this, every alt-less
 * `next/image` on a page derived the one id `img-image`. A `data:` / `blob:`
 * URL names no file (its "file name" would be a slice of the payload).
 */
function sourceFileName(url: string): string | undefined {
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) return undefined;
  const inner = transcodedSourceUrl(url);
  if (inner) return sourceFileName(inner);
  const filename = url.split('/').pop()?.split('?')[0]?.split('#')[0];
  if (!filename) return undefined;
  try {
    return decodeURIComponent(filename);
  } catch {
    return filename;
  }
}

/** The file stem a source URL names, for an id: `/img/hero.png?v=2` → `hero`. */
function sourceStem(url: string): string | undefined {
  return sourceFileName(url)?.replace(/\.[^.]+$/, '') || undefined;
}

/**
 * Generate a stable, deterministic BASE id for a media element. Two elements
 * can share a base id; {@link disambiguateMediaId} makes the registered id
 * unique.
 *
 * Format: {mediaType}-{label|context}[-{index}]
 *
 * Inside a §4.6 redaction boundary the alt / aria-label / title / source are
 * the secret (a QR code's alt, a signed URL's file name), so they are never
 * slugged into the id; the id falls back to structural context.
 *
 * Examples:
 *   <img alt="Company logo"> → "img-company-logo"
 *   <svg aria-label="Close icon"> → "svg-close-icon"
 *   <video> in hero section → "video-hero"
 *   3rd img in a gallery → "img-gallery-2"
 *   <img src="/_next/image?url=%2Fhero.png&w=1920"> → "img-hero"
 */
export function generateMediaId(element: HTMLElement): string {
  // Respect explicit data-media-id if present
  const explicitId = element.getAttribute('data-media-id');
  if (explicitId) return explicitId;

  const tag = element.tagName.toLowerCase();
  const prefix = tag === 'picture' ? 'picture' : tag;
  const redacted = isContentRedacted(element);
  // A <picture> carries its alt and source on its <img>.
  const imageHalf = tag === 'picture' ? (element.querySelector('img') ?? element) : element;

  if (!redacted) {
    // Try alt text
    const alt = readAltAttr(imageHalf);
    if (alt && alt.trim()) {
      const slug = slugify(alt.trim());
      if (slug) return `${prefix}-${slug}`;
    }

    // Try aria-label
    const ariaLabel = readAriaLabelAttr(element);
    if (ariaLabel) {
      const slug = slugify(ariaLabel);
      if (slug) return `${prefix}-${slug}`;
    }

    // Try title
    const title = readTitleAttr(element);
    if (title) {
      const slug = slugify(title);
      if (slug) return `${prefix}-${slug}`;
    }

    // Try the source's file name
    const src = imageHalf.getAttribute('src') ?? '';
    const stem = sourceStem(src);
    if (stem) {
      const slug = slugify(stem, 20);
      if (slug) return `${prefix}-${slug}`;
    }
  }

  // Use ancestor context + sibling index
  const context = getAncestorContext(element, redacted);
  const siblingIdx = getSiblingIndex(element);

  if (context && siblingIdx !== undefined) {
    return `${prefix}-${context}-${siblingIdx}`;
  }
  if (context) {
    return `${prefix}-${context}`;
  }
  if (siblingIdx !== undefined) {
    return `${prefix}-${siblingIdx}`;
  }

  // Last resort: parent child index
  const parent = element.parentElement;
  if (parent) {
    const idx = Array.from(parent.children).indexOf(element);
    return `${prefix}-child-${idx}`;
  }

  return `${prefix}-root`;
}

/**
 * Generate a stable BASE id for a background-image element (see
 * {@link generateMediaId} for the redaction and uniqueness rules).
 */
export function generateBackgroundImageId(element: HTMLElement): string {
  const explicitId = element.getAttribute('data-media-id');
  if (explicitId) return explicitId;

  const redacted = isContentRedacted(element);
  if (!redacted) {
    const stem = sourceStem(backgroundImageUrl(element) ?? '');
    if (stem) {
      const slug = slugify(stem, 20);
      if (slug) return `bg-${slug}`;
    }
  }

  const context = getAncestorContext(element, redacted);
  if (context) return `bg-${context}`;

  const parent = element.parentElement;
  if (parent) {
    const idx = Array.from(parent.children).indexOf(element);
    return `bg-child-${idx}`;
  }

  return `bg-root`;
}

/**
 * The registered id for a media element whose base id may already be taken by
 * ANOTHER element: the base id when free, else the first free `-2`, `-3`, …
 * suffix. Registration walks the DOM in document order, so the first image
 * keeps the bare id and later ones are numbered in page order.
 */
export function disambiguateMediaId(baseId: string, isTaken: (id: string) => boolean): string {
  if (!isTaken(baseId)) return baseId;
  for (let n = 2; ; n++) {
    const candidate = `${baseId}-${n}`;
    if (!isTaken(candidate)) return candidate;
  }
}

/**
 * Register one media element into `registry` — the ONE media registration
 * both scanners use: the React hook (`useAutoRegister`) and the injected
 * runtime's DOM seeder (`injected/seed-registry.ts`). A page driven through
 * inject-cli therefore carries the same media rows, ids and observations as
 * an instrumented app; before, the injected runtime registered no media at
 * all, so every media find there answered with nothing.
 *
 * The id is the element's base id disambiguated against the registry; the
 * observation is captured now and re-captured on every read
 * (`refreshMetadata`). Returns the registered id, or `null` when the element
 * paints no media (a background capture with no `url()`).
 */
export function registerMediaInRegistry(
  registry: UIBridgeRegistry,
  element: HTMLElement
): string | null {
  const isStandardMedia = element.matches(MEDIA_SELECTORS.join(', '));
  const metadata = isStandardMedia
    ? captureMediaMetadata(element)
    : captureBackgroundImageMetadata(element);
  if (!metadata) return null;

  const baseId = isStandardMedia ? generateMediaId(element) : generateBackgroundImageId(element);
  // Every image registers: two images that derive the same base id (a shared
  // alt, two alt-less `next/image`s) are two images, so the later one takes
  // the next free numbered id rather than being dropped as a "duplicate".
  const id = disambiguateMediaId(baseId, (candidate) => {
    const holder = registry.getElement(candidate);
    return holder !== undefined && holder.element !== element;
  });

  const facts = metadata.status === 'measured' ? metadata.value : undefined;
  const refresh = isStandardMedia
    ? captureMediaMetadata
    : (el: HTMLElement) => captureBackgroundImageMetadata(el) ?? metadata;
  registry.registerMediaElement(id, element, {
    mediaType: facts?.mediaType ?? (isStandardMedia ? inferMediaType(element) : 'background-image'),
    mediaMetadata: metadata,
    // Scraped (alt text, or the file name): every projection scrubs it.
    label: facts?.altText || (facts?.src ? sourceFileName(facts.src) : undefined) || undefined,
    refreshMetadata: refresh,
  });
  return id;
}
