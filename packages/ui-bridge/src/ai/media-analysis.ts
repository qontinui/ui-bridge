/**
 * Media Analysis
 *
 * Captures media element visual content + structured metadata for AI vision model consumption.
 * The SDK captures and delivers image data — the calling agent (Claude Code, MCP server)
 * performs the actual inference.
 */

import type { RegisteredElement } from '../core/types';
import { captureMediaSnapshot } from './media-snapshot';

// ============================================================================
// Types
// ============================================================================

/**
 * AI-ready image data for a single media element
 */
export interface MediaAnalysisResult {
  /** Base64 PNG image data, ready for vision LLM */
  image: {
    /** Base64-encoded PNG data */
    data: string;
    /** MIME type for LLM API */
    mediaType: 'image/png';
    /** Width of the captured image */
    width: number;
    /** Height of the captured image */
    height: number;
  };
  /** Structured context metadata for the LLM */
  context: {
    /** Element ID in the UI Bridge registry */
    elementId: string;
    /** Alt text if present */
    altText?: string;
    /** Source URL */
    src?: string;
    /** ARIA role */
    role?: string;
    /** Parent context description (e.g., "inside a card titled 'User Profile'") */
    parentContext?: string;
    /** Text labels of nearby sibling elements */
    siblingLabels?: string[];
    /** Current loading state */
    loadingState: string;
    /** Dimensions: natural and rendered */
    dimensions: {
      natural: [number, number];
      rendered: [number, number];
    };
  };
}

/**
 * Request to analyze a single media element
 */
export interface MediaAnalyzeRequest {
  /** Element ID to analyze */
  elementId: string;
  /** Maximum image dimension (default: 512) */
  maxSize?: number;
}

/**
 * Request to analyze multiple media elements
 */
export interface MediaAnalyzeBatchRequest {
  /** Element IDs to analyze */
  elementIds: string[];
  /** Maximum image dimension per element (default: 512) */
  maxSize?: number;
}

/**
 * Request to analyze all visible media on the page
 */
export interface MediaAnalyzePageRequest {
  /** Maximum number of elements to capture (default: 20) */
  maxElements?: number;
  /** Maximum image dimension per element (default: 512) */
  maxSize?: number;
  /** Include context metadata (default: true) */
  includeContext?: boolean;
}

// ============================================================================
// Context Extraction
// ============================================================================

/**
 * Get a human-readable description of the element's parent context
 */
function getParentContext(element: HTMLElement): string | undefined {
  let current = element.parentElement;
  let depth = 0;

  while (current && depth < 5) {
    const tag = current.tagName.toLowerCase();

    // Check for card/section/article patterns
    const role = current.getAttribute('role');
    const ariaLabel = current.getAttribute('aria-label');
    const testId = current.getAttribute('data-testid');

    // Find a meaningful label
    let label: string | undefined;
    if (ariaLabel) {
      label = ariaLabel;
    } else if (testId) {
      label = testId.replace(/[-_]/g, ' ');
    } else {
      // Look for a heading child
      const heading = current.querySelector('h1, h2, h3, h4, h5, h6');
      if (heading && heading !== element) {
        label = heading.textContent?.trim();
      }
    }

    if (label) {
      const containerType = role || tag;
      return `inside a ${containerType} titled '${label.substring(0, 50)}'`;
    }

    // Check for semantic containers
    if (
      ['article', 'section', 'aside', 'nav', 'main', 'header', 'footer', 'dialog', 'form'].includes(
        tag
      )
    ) {
      return `inside a ${tag}`;
    }

    current = current.parentElement;
    depth++;
  }

  return undefined;
}

/**
 * Get text labels from nearby sibling elements
 */
function getSiblingLabels(element: HTMLElement, maxLabels: number = 3): string[] {
  const parent = element.parentElement;
  if (!parent) return [];

  const labels: string[] = [];
  const siblings = Array.from(parent.children);

  for (const sibling of siblings) {
    if (sibling === element) continue;
    if (labels.length >= maxLabels) break;

    const text = (sibling as HTMLElement).textContent?.trim();
    if (text && text.length > 0 && text.length <= 100) {
      labels.push(text.substring(0, 50));
    }
  }

  return labels;
}

// ============================================================================
// Analysis Functions
// ============================================================================

/**
 * Capture a media element's visual content + metadata for AI consumption.
 *
 * Returns base64 PNG image data and structured context, formatted for
 * direct use with Claude's vision API.
 */
export function analyzeMediaElement(
  registeredElement: RegisteredElement,
  maxSize: number = 512
): MediaAnalysisResult | null {
  const { element, id } = registeredElement;
  const meta = registeredElement.mediaMetadata;

  // Capture the visual snapshot
  const snapshot = captureMediaSnapshot(element, id, maxSize);
  if (!snapshot) return null;

  // Build context
  const context: MediaAnalysisResult['context'] = {
    elementId: id,
    altText: meta?.altText,
    src: meta?.src,
    role: element.getAttribute('role') || undefined,
    parentContext: getParentContext(element),
    siblingLabels: getSiblingLabels(element),
    loadingState: meta?.loadingState || 'unknown',
    dimensions: {
      natural: [meta?.naturalWidth || 0, meta?.naturalHeight || 0],
      rendered: [meta?.renderedWidth || 0, meta?.renderedHeight || 0],
    },
  };

  return {
    image: {
      data: snapshot.data,
      mediaType: 'image/png',
      width: snapshot.width,
      height: snapshot.height,
    },
    context,
  };
}

/**
 * Analyze multiple media elements for batch comparison.
 */
export function analyzeMediaBatch(
  elements: RegisteredElement[],
  maxSize: number = 512
): MediaAnalysisResult[] {
  const results: MediaAnalysisResult[] = [];
  for (const el of elements) {
    const result = analyzeMediaElement(el, maxSize);
    if (result) results.push(result);
  }
  return results;
}

/**
 * Analyze all visible media elements on the page.
 */
export function analyzeMediaPage(
  allMediaElements: RegisteredElement[],
  maxElements: number = 20,
  maxSize: number = 512,
  includeContext: boolean = true
): MediaAnalysisResult[] {
  // Filter to visible elements and limit
  const visible = allMediaElements
    .filter((el) => {
      try {
        const state = el.getState();
        return state.visible;
      } catch {
        return false;
      }
    })
    .slice(0, maxElements);

  const results: MediaAnalysisResult[] = [];
  for (const el of visible) {
    const result = analyzeMediaElement(el, maxSize);
    if (result) {
      if (!includeContext) {
        result.context = {
          elementId: result.context.elementId,
          loadingState: result.context.loadingState,
          dimensions: result.context.dimensions,
        };
      }
      results.push(result);
    }
  }
  return results;
}
