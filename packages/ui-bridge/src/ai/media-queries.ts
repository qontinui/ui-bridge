/**
 * Media Queries
 *
 * Convenience query functions for common media-related searches.
 * These wrap the find() API with pre-configured media filters.
 */

import type { FindRequest, FindResponse } from '../control/types';
import { mediaFactsOf } from '../core/media-observation';

/**
 * Accessibility audit result for media elements
 */
export interface MediaAccessibilityAudit {
  /** Images missing alt text entirely */
  missingAlt: Array<{ id: string; src?: string; tagName: string }>;
  /** Images with generic/unhelpful alt text (e.g., "image", "photo", "img") */
  genericAlt: Array<{ id: string; src?: string; altText: string }>;
  /** Decorative images that should have empty alt but don't */
  decorativeWithoutEmptyAlt: Array<{ id: string; src?: string; altText?: string }>;
  /** Total media elements audited */
  totalAudited: number;
}

/**
 * Performance audit result for media elements
 */
export interface MediaPerformanceAudit {
  /**
   * Images carrying more pixels than the screen shows: `effectiveResolution`
   * (source pixels per DEVICE pixel, DPR- and object-fit-aware) above the
   * threshold.
   */
  oversized: Array<{
    id: string;
    src?: string;
    effectiveResolution: number;
    naturalWidth: number;
    naturalHeight: number;
    renderedWidth: number;
    renderedHeight: number;
  }>;
  /** Images whose encoded body (`encodedBodySize`) is large (> 500KB) */
  largeTransferSize: Array<{ id: string; src?: string; encodedBodySize: number }>;
  /** Above-the-fold images not using lazy loading (which is fine) vs below-fold not lazy */
  notLazyLoaded: Array<{ id: string; src?: string; inViewport: boolean }>;
  /** Total media elements audited */
  totalAudited: number;
}

const GENERIC_ALT_PATTERNS = [
  /^image$/i,
  /^photo$/i,
  /^img$/i,
  /^picture$/i,
  /^icon$/i,
  /^logo$/i,
  /^banner$/i,
  /^untitled$/i,
  /^placeholder$/i,
  /^thumbnail$/i,
  /^screen\s*shot$/i,
  /^\d+$/,
];

/**
 * Create a find request with media filters
 */
export function createMediaFindRequest(overrides: Partial<FindRequest> = {}): FindRequest {
  return {
    mediaOnly: true,
    skipSettle: true,
    ...overrides,
  };
}

/**
 * Create a find request for broken images
 */
export function createBrokenImagesFindRequest(): FindRequest {
  return createMediaFindRequest({ brokenOnly: true });
}

/**
 * Create a find request for images missing alt text
 */
export function createMissingAltFindRequest(): FindRequest {
  return createMediaFindRequest({ missingAltOnly: true });
}

/**
 * Create a find request for oversized images
 */
export function createOversizedImagesFindRequest(threshold: number = 2.0): FindRequest {
  return createMediaFindRequest({ oversizeThreshold: threshold });
}

/**
 * Build an accessibility audit from a media find response
 */
export function buildAccessibilityAudit(response: FindResponse): MediaAccessibilityAudit {
  const result: MediaAccessibilityAudit = {
    missingAlt: [],
    genericAlt: [],
    decorativeWithoutEmptyAlt: [],
    totalAudited: response.elements.length,
  };

  for (const el of response.elements) {
    const meta = mediaFactsOf(el.mediaMetadata);
    if (!meta) continue;

    // Skip non-image media types for alt text audit
    if (meta.mediaType !== 'image' && meta.mediaType !== 'picture' && meta.mediaType !== 'svg') {
      continue;
    }

    const altText = meta.altText;

    // Missing alt
    if (altText === undefined || altText === null) {
      result.missingAlt.push({ id: el.id, src: meta.src, tagName: el.tagName });
    }
    // Generic alt
    else if (altText && GENERIC_ALT_PATTERNS.some((p) => p.test(altText.trim()))) {
      result.genericAlt.push({ id: el.id, src: meta.src, altText });
    }

    // Decorative check: if isDecorative but has non-empty alt
    if (meta.isDecorative && altText && altText.trim() !== '') {
      result.decorativeWithoutEmptyAlt.push({ id: el.id, src: meta.src, altText });
    }
  }

  return result;
}

/**
 * Build a performance audit from a media find response
 */
export function buildPerformanceAudit(
  response: FindResponse,
  oversizeThreshold: number = 2.0,
  largeTransferThreshold: number = 500 * 1024 // 500KB
): MediaPerformanceAudit {
  const result: MediaPerformanceAudit = {
    oversized: [],
    largeTransferSize: [],
    notLazyLoaded: [],
    totalAudited: response.elements.length,
  };

  for (const el of response.elements) {
    const meta = mediaFactsOf(el.mediaMetadata);
    if (!meta) continue;

    // Oversized check
    if (meta.effectiveResolution !== undefined && meta.effectiveResolution > oversizeThreshold) {
      result.oversized.push({
        id: el.id,
        src: meta.src,
        effectiveResolution: meta.effectiveResolution,
        naturalWidth: meta.naturalWidth || 0,
        naturalHeight: meta.naturalHeight || 0,
        renderedWidth: meta.renderedWidth,
        renderedHeight: meta.renderedHeight,
      });
    }

    // Large encoded body
    if (meta.encodedBodySize !== undefined && meta.encodedBodySize > largeTransferThreshold) {
      result.largeTransferSize.push({
        id: el.id,
        src: meta.src,
        encodedBodySize: meta.encodedBodySize,
      });
    }

    // Not lazy loaded (below the fold)
    if (meta.loading !== 'lazy' && meta.mediaType === 'image' && el.state.inViewport === false) {
      result.notLazyLoaded.push({
        id: el.id,
        src: meta.src,
        inViewport: false,
      });
    }
  }

  return result;
}
