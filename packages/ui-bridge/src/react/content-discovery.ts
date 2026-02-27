/**
 * Content Discovery
 *
 * Discovers static text content elements (headings, paragraphs, table cells, etc.)
 * and generates stable IDs and semantic metadata for AI consumption.
 *
 * Separate from the interactive element discovery in useAutoRegister.ts —
 * content elements have no interactive actions and use ContentType instead of ElementType.
 */

import type { ContentType, ContentRole, ContentMetadata } from '../core/types';

// ============================================================================
// Configuration
// ============================================================================

/**
 * Options for content discovery
 */
export interface ContentDiscoveryOptions {
  /** Enable content discovery (default: true) */
  enabled?: boolean;
  /** Additional CSS selectors to include */
  includeContentSelectors?: string[];
  /** Additional CSS selectors to exclude */
  excludeContentSelectors?: string[];
  /** Minimum text length to register (default: 1) */
  minTextLength?: number;
  /** Maximum content elements to register (default: 500) */
  maxContentElements?: number;
  /** Debounce interval for content registration (default: 250ms) */
  contentDebounceMs?: number;
  /** Only register elements with these content roles */
  contentRoles?: ContentRole[];
}

// ============================================================================
// Selectors
// ============================================================================

/**
 * CSS selectors for content elements
 */
export const CONTENT_SELECTORS = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'li',
  'td',
  'th',
  'label:not([for])',
  'figcaption',
  'caption',
  'blockquote',
  'pre',
  'code',
  'dd',
  'dt',
  '[role="heading"]',
  '[role="status"]',
  '[role="alert"]',
  '[aria-live]',
  'legend',
  'summary',
  '[data-content-role]',
];

/**
 * CSS selectors for elements that should always be excluded
 */
export const CONTENT_EXCLUDE_SELECTORS = [
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
// Noise Filtering
// ============================================================================

/**
 * Get only the direct text content of an element (not nested elements)
 */
export function getDirectTextContent(element: HTMLElement): string {
  let text = '';
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent || '';
    }
  }
  return text.trim();
}

/**
 * Tags that are semantic content — never treated as noise wrappers,
 * even when their text comes from styled child spans.
 */
const SEMANTIC_CONTENT_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'li',
  'td',
  'th',
  'label',
  'figcaption',
  'caption',
  'blockquote',
  'pre',
  'code',
  'dd',
  'dt',
  'legend',
  'summary',
]);

/**
 * Check if an element is noise (should not be registered as content)
 */
export function isNoise(element: HTMLElement): boolean {
  const text = getDirectTextContent(element);
  const tag = element.tagName.toLowerCase();

  // Empty direct text — wrapper div whose text is just concatenated children.
  // BUT: semantic content tags (h1-h6, p, li, etc.) often wrap text in styled
  // child spans like <h2><span>Title</span></h2> — these are NOT noise.
  if (
    !text &&
    element.children.length > 0 &&
    !SEMANTIC_CONTENT_TAGS.has(tag) &&
    !element.hasAttribute('data-content-role')
  ) {
    return true;
  }

  // Single-character icon containers (e.g., "×", "▶", "•")
  const fullText = element.textContent?.trim() || '';
  if (fullText.length === 1 && !/\w/.test(fullText)) {
    return true;
  }

  return false;
}

/**
 * Check if an element is visible
 */
function isContentVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') {
    return false;
  }
  if (parseFloat(style.opacity) === 0) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * Check if an element should be registered as content
 */
export function shouldRegisterContent(
  element: HTMLElement,
  options: ContentDiscoveryOptions = {},
  registeredIds: Set<string>
): boolean {
  const minTextLength = options.minTextLength ?? 1;

  // Check exclusion selectors
  const excludeSelectors = [
    ...CONTENT_EXCLUDE_SELECTORS,
    ...(options.excludeContentSelectors || []),
  ];
  for (const sel of excludeSelectors) {
    if (element.matches(sel)) {
      return false;
    }
  }

  // Must be visible
  if (!isContentVisible(element)) {
    return false;
  }

  // Must have text content meeting minimum length
  const text = element.textContent?.trim() || '';
  if (text.length < minTextLength) {
    return false;
  }

  // Noise check
  if (isNoise(element)) {
    return false;
  }

  // Skip interactive elements that are already handled by the interactive scanner
  if (isInteractiveElement(element)) {
    return false;
  }

  // Check if already registered
  const id = generateContentId(element);
  if (registeredIds.has(id)) {
    return false;
  }

  // Filter by content role if specified
  if (options.contentRoles && options.contentRoles.length > 0) {
    const metadata = inferContentMetadata(element);
    if (!options.contentRoles.includes(metadata.contentRole)) {
      return false;
    }
  }

  return true;
}

/**
 * Check if an element is interactive (and thus should not be registered as content)
 */
function isInteractiveElement(element: HTMLElement): boolean {
  const tag = element.tagName.toLowerCase();
  const interactiveTags = ['button', 'input', 'select', 'textarea', 'a'];
  if (interactiveTags.includes(tag)) return true;

  const role = element.getAttribute('role');
  const interactiveRoles = [
    'button',
    'link',
    'checkbox',
    'radio',
    'menuitem',
    'tab',
    'switch',
    'slider',
    'spinbutton',
    'combobox',
    'listbox',
    'option',
    'textbox',
  ];
  if (role && interactiveRoles.includes(role)) return true;

  if (element.getAttribute('contenteditable') === 'true') return true;
  if (element.hasAttribute('data-ui-id')) return true;
  if (element.hasAttribute('data-ui-element')) return true;

  return false;
}

// ============================================================================
// Type Inference
// ============================================================================

/**
 * Infer ContentType from a DOM element
 */
export function inferContentType(element: HTMLElement): ContentType {
  // Explicit data-content-role takes highest priority
  const explicitRole = element.getAttribute('data-content-role');
  if (explicitRole) return roleToContentType(explicitRole as ContentRole);

  const tag = element.tagName.toLowerCase();
  const role = element.getAttribute('role');

  // ARIA role-based inference
  if (role === 'heading') return 'heading';
  if (role === 'status') return 'status-message';
  if (role === 'alert') return 'status-message';

  // Tag-based inference
  if (/^h[1-6]$/.test(tag)) return 'heading';
  if (tag === 'p') return 'paragraph';
  if (tag === 'li') return 'list-item';
  if (tag === 'td') return 'table-cell';
  if (tag === 'th') return 'table-header';
  if (tag === 'label') return 'label';
  if (tag === 'figcaption' || tag === 'caption') return 'caption';
  if (tag === 'blockquote') return 'blockquote';
  if (tag === 'pre' || tag === 'code') return 'code-block';
  if (tag === 'dd') return 'description-text';
  if (tag === 'dt') return 'label';
  if (tag === 'legend') return 'label';
  if (tag === 'summary') return 'label';

  // Check for aria-live (dynamic content)
  if (element.hasAttribute('aria-live')) return 'status-message';

  // Check for common CSS classes that indicate content type
  const classList = element.className?.toLowerCase() || '';
  if (classList.includes('badge')) return 'badge';
  if (classList.includes('status')) return 'status-message';
  if (classList.includes('metric') || classList.includes('stat')) return 'metric-value';

  return 'content-generic';
}

/**
 * Map ContentRole to ContentType (inverse of contentTypeToRole)
 */
function roleToContentType(role: ContentRole): ContentType {
  const map: Record<ContentRole, ContentType> = {
    heading: 'heading',
    'body-text': 'paragraph',
    'list-item': 'list-item',
    'table-cell': 'table-cell',
    'table-header': 'table-header',
    label: 'label',
    caption: 'caption',
    quote: 'blockquote',
    code: 'code-block',
    badge: 'badge',
    status: 'status-message',
    metric: 'metric-value',
    description: 'description-text',
    navigation: 'nav-text',
    generic: 'content-generic',
  };
  return map[role] ?? 'content-generic';
}

/**
 * Map ContentType to ContentRole
 */
function contentTypeToRole(contentType: ContentType): ContentRole {
  const map: Record<ContentType, ContentRole> = {
    heading: 'heading',
    paragraph: 'body-text',
    'list-item': 'list-item',
    'table-cell': 'table-cell',
    'table-header': 'table-header',
    label: 'label',
    caption: 'caption',
    blockquote: 'quote',
    'code-block': 'code',
    badge: 'badge',
    'status-message': 'status',
    'metric-value': 'metric',
    'description-text': 'description',
    'nav-text': 'navigation',
    'content-generic': 'generic',
  };
  return map[contentType];
}

/**
 * Infer ContentMetadata from a DOM element
 */
export function inferContentMetadata(element: HTMLElement): ContentMetadata {
  const contentType = inferContentType(element);

  // Use explicit data-content-role if present, otherwise derive from contentType
  const explicitRole = element.getAttribute('data-content-role');
  const contentRole = explicitRole ? (explicitRole as ContentRole) : contentTypeToRole(contentType);

  const metadata: ContentMetadata = {
    contentRole,
  };

  // Heading level: explicit data-content-level > tag > aria-level
  const explicitLevel = element.getAttribute('data-content-level');
  const tag = element.tagName.toLowerCase();
  const role = element.getAttribute('role');
  if (explicitLevel) {
    metadata.headingLevel = parseInt(explicitLevel, 10);
  } else if (/^h([1-6])$/.test(tag)) {
    metadata.headingLevel = parseInt(tag[1], 10);
  } else if (role === 'heading') {
    const ariaLevel = element.getAttribute('aria-level');
    metadata.headingLevel = ariaLevel ? parseInt(ariaLevel, 10) : 2;
  }

  // Dynamic content detection
  if (element.hasAttribute('aria-live') || role === 'status' || role === 'alert') {
    metadata.dynamic = true;
  }

  // Structural context for table cells
  if (tag === 'td' || tag === 'th') {
    const row = element.closest('tr');
    const table = element.closest('table');
    if (row && table) {
      const rows = Array.from(table.querySelectorAll('tr'));
      const rowIndex = rows.indexOf(row);
      const cells = Array.from(row.children);
      const colIndex = cells.indexOf(element);
      metadata.structuralContext = `table > row ${rowIndex} > col ${colIndex}`;
    }
  }

  // Stable text prefix for dynamic content
  if (metadata.dynamic) {
    const text = element.textContent?.trim() || '';
    if (text.length > 10) {
      metadata.stableTextPrefix = text.substring(0, 10);
    }
  }

  return metadata;
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
 * Generate a deterministic, stable ID for a content element
 */
export function generateContentId(element: HTMLElement): string {
  // Respect explicit data-content-id if present
  const explicitId = element.getAttribute('data-content-id');
  if (explicitId) return explicitId;

  const contentType = inferContentType(element);
  const tag = element.tagName.toLowerCase();
  const contentLabel = element.getAttribute('data-content-label');

  // Headings: heading-{level}-{textSlug}
  if (contentType === 'heading') {
    const level =
      element.getAttribute('data-content-level') ||
      (/^h([1-6])$/.test(tag) ? tag[1] : element.getAttribute('aria-level') || '2');
    const text = contentLabel || element.textContent?.trim() || '';
    const slug = slugify(text);
    return `heading-${level}-${slug || 'untitled'}`;
  }

  // Table cells: cell-r{row}-c{col}-{tableAnchor}
  if (contentType === 'table-cell' || contentType === 'table-header') {
    const row = element.closest('tr');
    const table = element.closest('table');
    if (row && table) {
      const rows = Array.from(table.querySelectorAll('tr'));
      const rowIndex = rows.indexOf(row);
      const cells = Array.from(row.children);
      const colIndex = cells.indexOf(element);
      const tableAnchor =
        table.getAttribute('data-ui-id') ||
        table.getAttribute('data-testid') ||
        table.id ||
        'table';
      return `cell-r${rowIndex}-c${colIndex}-${tableAnchor}`;
    }
  }

  // Other content: content-{type}-{anchorId}-{siblingIndex}
  const parent = element.parentElement;
  const anchorId =
    parent?.getAttribute('data-ui-id') || parent?.getAttribute('data-testid') || parent?.id || '';

  // Sibling index among same-type siblings
  const siblings = parent ? Array.from(parent.querySelectorAll(`:scope > ${tag}`)) : [];
  const siblingIndex = siblings.indexOf(element);

  const textSlug = slugify(contentLabel || element.textContent?.trim() || '', 20);
  const anchor = anchorId ? slugify(anchorId, 15) : textSlug;

  return `content-${contentType}-${anchor || 'unknown'}-${siblingIndex >= 0 ? siblingIndex : 0}`;
}
