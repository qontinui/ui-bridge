/**
 * Media Discovery
 *
 * Discovers media elements (images, video, canvas, SVG, picture, CSS background images)
 * and generates stable IDs and metadata for AI consumption.
 *
 * Follows the same pattern as content-discovery.ts — media elements get their own
 * category ('media') and metadata type (MediaMetadata).
 */

import type { MediaMetadata, MediaType } from '../core/types';
import { readAriaLabelAttr, readAltAttr, readTitleAttr } from '../core/a11y';

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
 * CSS selectors for media elements
 */
export const MEDIA_SELECTORS = [
  'img',
  'svg:not(button svg)',
  'picture',
  'video',
  'canvas',
  '[role="img"]',
];

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
 * Check if an element should be registered as media
 */
export function shouldRegisterMedia(
  element: HTMLElement,
  _options: MediaDiscoveryOptions = {},
  registeredIds: Set<string>
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

  // Check if already registered
  const id = generateMediaId(element);
  if (registeredIds.has(id)) {
    return false;
  }

  return true;
}

// ============================================================================
// Metadata Capture
// ============================================================================

/**
 * Infer image format from URL or content type
 */
function inferFormat(src: string | undefined): string | undefined {
  if (!src) return undefined;
  // Data URLs
  const dataMatch = src.match(/^data:image\/([^;,]+)/);
  if (dataMatch) return dataMatch[1];
  // File extension
  const extMatch = src.match(/\.([a-z0-9]+)(?:\?|#|$)/i);
  if (extMatch) {
    const ext = extMatch[1].toLowerCase();
    const formatMap: Record<string, string> = {
      jpg: 'jpeg',
      jpeg: 'jpeg',
      png: 'png',
      gif: 'gif',
      webp: 'webp',
      avif: 'avif',
      svg: 'svg+xml',
      bmp: 'bmp',
      ico: 'ico',
    };
    return formatMap[ext] || ext;
  }
  return undefined;
}

/**
 * Get transfer size from Performance API for a resource URL
 */
function getTransferSize(src: string | undefined): number | undefined {
  if (!src || typeof performance === 'undefined') return undefined;
  try {
    const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].name === src || entries[i].name.endsWith(src)) {
        return entries[i].transferSize || undefined;
      }
    }
  } catch {
    // Performance API not available
  }
  return undefined;
}

/**
 * Capture comprehensive metadata from a media element
 */
export function captureMediaMetadata(element: HTMLElement): MediaMetadata {
  const tag = element.tagName.toLowerCase();
  const rect = element.getBoundingClientRect();

  const base: MediaMetadata = {
    mediaType: inferMediaType(element),
    isDecorative: false,
    renderedWidth: rect.width,
    renderedHeight: rect.height,
    loadingState: 'loaded',
    lazyLoading: false,
  };

  if (tag === 'img') {
    const img = element as HTMLImageElement;
    base.src = img.currentSrc || img.src || undefined;
    base.altText = img.alt || undefined;
    base.isDecorative = img.alt === '' || img.getAttribute('role') === 'presentation';
    base.naturalWidth = img.naturalWidth || undefined;
    base.naturalHeight = img.naturalHeight || undefined;
    base.lazyLoading = img.loading === 'lazy';
    base.format = inferFormat(base.src);
    base.transferSize = getTransferSize(img.src);

    // Compute oversize ratio
    if (img.naturalWidth && img.naturalHeight && rect.width > 0 && rect.height > 0) {
      const widthRatio = img.naturalWidth / rect.width;
      const heightRatio = img.naturalHeight / rect.height;
      base.oversizeRatio = Math.max(widthRatio, heightRatio);
    }

    // Loading state
    if (!img.complete) {
      base.loadingState = img.loading === 'lazy' ? 'lazy' : 'pending';
    } else if (img.naturalWidth === 0 && img.src) {
      base.loadingState = 'error';
    } else {
      base.loadingState = 'loaded';
    }

    // Srcset and sizes
    if (img.srcset) base.srcset = img.srcset;
    if (img.sizes) base.sizes = img.sizes;
  }

  if (tag === 'picture') {
    const img = element.querySelector('img');
    if (img) {
      const imgMeta = captureMediaMetadata(img);
      Object.assign(base, imgMeta);
      base.mediaType = 'picture';
    }
    // Capture <source> elements
    const sources = element.querySelectorAll('source');
    if (sources.length > 0) {
      base.sources = Array.from(sources).map((source) => ({
        srcset: source.srcset,
        media: source.media || undefined,
        type: source.type || undefined,
      }));
    }
  }

  if (tag === 'svg') {
    base.svgViewBox = element.getAttribute('viewBox') || undefined;
    base.altText =
      readAriaLabelAttr(element) ||
      element.querySelector('title')?.textContent ||
      undefined;
    base.isDecorative =
      element.getAttribute('aria-hidden') === 'true' ||
      element.getAttribute('role') === 'presentation';
    // SVGs are always "loaded"
    base.loadingState = 'loaded';
  }

  if (tag === 'video') {
    const video = element as HTMLVideoElement;
    base.src = video.currentSrc || video.src || undefined;
    base.altText = readAriaLabelAttr(video) || undefined;
    base.naturalWidth = video.videoWidth || undefined;
    base.naturalHeight = video.videoHeight || undefined;
    base.format = inferFormat(base.src);

    if (video.videoWidth && video.videoHeight && rect.width > 0 && rect.height > 0) {
      base.oversizeRatio = Math.max(video.videoWidth / rect.width, video.videoHeight / rect.height);
    }

    base.loadingState = video.readyState >= 2 ? 'loaded' : 'pending';

    base.videoState = {
      poster: video.poster || undefined,
      currentTime: video.currentTime,
      duration: video.duration || 0,
      paused: video.paused,
      muted: video.muted,
    };
  }

  if (tag === 'canvas') {
    const canvas = element as HTMLCanvasElement;
    base.naturalWidth = canvas.width;
    base.naturalHeight = canvas.height;
    base.altText = readAriaLabelAttr(element) || element.textContent?.trim() || undefined;
    base.loadingState = 'loaded';
  }

  // Check role="img" on non-standard elements
  if (element.getAttribute('role') === 'img') {
    base.altText = base.altText || readAriaLabelAttr(element) || undefined;
    base.isDecorative = !base.altText && element.getAttribute('aria-hidden') === 'true';
  }

  return base;
}

/**
 * Capture metadata for an element with a CSS background image
 */
export function captureBackgroundImageMetadata(element: HTMLElement): MediaMetadata | null {
  const style = window.getComputedStyle(element);
  const bgImage = style.backgroundImage;

  if (!bgImage || bgImage === 'none') return null;

  // Extract URL from url("...")
  const urlMatch = bgImage.match(/url\(["']?([^"')]+)["']?\)/);
  if (!urlMatch) return null;

  const src = urlMatch[1];
  const rect = element.getBoundingClientRect();

  return {
    mediaType: 'background-image',
    src,
    isDecorative: true, // background images are decorative by default
    renderedWidth: rect.width,
    renderedHeight: rect.height,
    loadingState: 'loaded',
    lazyLoading: false,
    format: inferFormat(src),
    transferSize: getTransferSize(src),
  };
}

/**
 * Find elements with CSS background images in a subtree.
 *
 * Walks visible elements checking `getComputedStyle(el).backgroundImage`.
 * Skips elements already matched by standard media selectors.
 */
export function findBackgroundImageElements(
  root: HTMLElement,
  maxElements: number = 50
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

  let node: Node | null;
  while ((node = walker.nextNode()) && results.length < maxElements) {
    const el = node as HTMLElement;
    const bgImage = window.getComputedStyle(el).backgroundImage;
    if (bgImage && bgImage !== 'none' && bgImage.includes('url(')) {
      results.push(el);
    }
  }

  return results;
}

/**
 * Generate a stable ID for a background-image element
 */
export function generateBackgroundImageId(element: HTMLElement): string {
  const explicitId = element.getAttribute('data-media-id');
  if (explicitId) return explicitId;

  const src = window.getComputedStyle(element).backgroundImage;
  const urlMatch = src?.match(/url\(["']?([^"')]+)["']?\)/);
  if (urlMatch) {
    const filename = urlMatch[1].split('/').pop()?.split('?')[0]?.split('#')[0];
    if (filename) {
      const name = filename.replace(/\.[^.]+$/, '');
      const slug = slugify(name, 20);
      if (slug) return `bg-${slug}`;
    }
  }

  const context = getAncestorContext(element);
  if (context) return `bg-${context}`;

  const parent = element.parentElement;
  if (parent) {
    const idx = Array.from(parent.children).indexOf(element);
    return `bg-child-${idx}`;
  }

  return `bg-root`;
}

/**
 * Infer the media type from a DOM element
 */
function inferMediaType(element: HTMLElement): MediaType {
  const tag = element.tagName.toLowerCase();
  switch (tag) {
    case 'img':
      return 'image';
    case 'svg':
      return 'svg';
    case 'video':
      return 'video';
    case 'canvas':
      return 'canvas';
    case 'picture':
      return 'picture';
    default:
      return 'image'; // role="img" or other
  }
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
 * Get context from ancestor elements for disambiguation
 */
function getAncestorContext(element: HTMLElement): string | undefined {
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
      const label = readAriaLabelAttr(current);
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
 * Generate a stable, deterministic ID for a media element
 *
 * Format: {mediaType}-{label|context}[-{index}]
 *
 * Examples:
 *   <img alt="Company logo"> → "img-company-logo"
 *   <svg aria-label="Close icon"> → "svg-close-icon"
 *   <video> in hero section → "video-hero"
 *   3rd img in a gallery → "img-gallery-2"
 */
export function generateMediaId(element: HTMLElement): string {
  // Respect explicit data-media-id if present
  const explicitId = element.getAttribute('data-media-id');
  if (explicitId) return explicitId;

  const tag = element.tagName.toLowerCase();
  const prefix = tag === 'picture' ? 'picture' : tag;

  // Try alt text
  const alt = readAltAttr(element);
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

  // Try src filename
  const src = (element as HTMLImageElement).src || element.getAttribute('src');
  if (src) {
    const filename = src.split('/').pop()?.split('?')[0]?.split('#')[0];
    if (filename) {
      const name = filename.replace(/\.[^.]+$/, ''); // strip extension
      const slug = slugify(name, 20);
      if (slug) return `${prefix}-${slug}`;
    }
  }

  // Use ancestor context + sibling index
  const context = getAncestorContext(element);
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
