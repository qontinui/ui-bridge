/**
 * Element Fingerprint Generation
 *
 * Computes stable fingerprints for DOM elements that enable cross-page element matching
 * and state discovery. Fingerprint hashes are deterministic and match the Python
 * ElementFingerprint schema in qontinui/state_machine/fingerprint_types.py.
 *
 * Fingerprints capture structural and semantic properties that remain stable across
 * page loads and navigation, enabling the state machine to identify states by
 * element composition rather than brittle selectors.
 */

import type { UIBridgeRegistry } from './registry';
import type { RegisteredElement } from './types';
import { classString, classList } from './class-name';
import { readAriaLabelAttr, readAriaLabelledbyAttr, readPlaceholderAttr } from './a11y';

// ============================================================================
// Types
// ============================================================================

/**
 * Repeat pattern information for list/grid/table items.
 * Matches Python RepeatPattern.to_dict() output.
 */
export interface RepeatPatternData {
  type: 'list' | 'grid' | 'table';
  containerSelector: string;
  itemSelector: string;
  index: number;
  totalCount: number;
}

/**
 * Browser-computed element fingerprint for stable identification.
 * Matches Python ElementFingerprint.to_dict() output (camelCase keys).
 */
export interface ElementFingerprintData {
  hash: string;
  structuralPath: string;
  positionZone: string;
  landmarkContext: string;
  landmarkLabel?: string;
  role: string;
  tagName: string;
  accessibleName?: string;
  sizeCategory: string;
  relativePosition: { top: number; left: number };
  isRepeating: boolean;
  repeatPattern?: RepeatPatternData;
}

// ============================================================================
// Constants
// ============================================================================

/** ARIA landmark roles */
const ARIA_LANDMARKS = new Set([
  'banner',
  'complementary',
  'contentinfo',
  'form',
  'main',
  'navigation',
  'region',
  'search',
]);

/** Tag name to implicit landmark mapping */
const IMPLICIT_LANDMARKS: Record<string, string> = {
  NAV: 'navigation',
  MAIN: 'main',
  HEADER: 'banner',
  FOOTER: 'contentinfo',
  ASIDE: 'complementary',
  FORM: 'form',
  SEARCH: 'search',
};

/** Tag name to implicit ARIA role mapping */
const IMPLICIT_ROLES: Record<string, string | ((el: HTMLElement) => string)> = {
  BUTTON: 'button',
  A: (el) => (el.hasAttribute('href') ? 'link' : ''),
  INPUT: (el) => {
    const type = (el as HTMLInputElement).type?.toLowerCase();
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (type === 'range') return 'slider';
    if (type === 'submit' || type === 'reset' || type === 'button') return 'button';
    return 'textbox';
  },
  SELECT: (el) => ((el as HTMLSelectElement).multiple ? 'listbox' : 'combobox'),
  TEXTAREA: 'textbox',
  IMG: 'img',
  TABLE: 'table',
  UL: 'list',
  OL: 'list',
  LI: 'listitem',
  H1: 'heading',
  H2: 'heading',
  H3: 'heading',
  H4: 'heading',
  H5: 'heading',
  H6: 'heading',
  DIALOG: 'dialog',
  DETAILS: 'group',
  SUMMARY: 'button',
  PROGRESS: 'progressbar',
  METER: 'meter',
};

/** Dynamic content patterns to replace with placeholders */
const DYNAMIC_PATTERNS = [
  // UUIDs
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
  // ISO dates
  /\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/g,
  // Timestamps (10+ digits)
  /\b\d{10,13}\b/g,
  // Standalone numbers (3+ digits, not part of a word)
  /\b\d{3,}\b/g,
  // Common date formats (MM/DD/YYYY, DD.MM.YYYY)
  /\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/g,
  // Time patterns
  /\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM|am|pm)?/g,
];

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Compute the structural path of an element (tag names only).
 * Walks up from the element to <body>, collecting only tag names.
 * Example: "main > section > div > button"
 */
function computeStructuralPath(element: HTMLElement): string {
  const parts: string[] = [];
  let current: HTMLElement | null = element;

  while (current && current.tagName !== 'BODY' && current.tagName !== 'HTML') {
    parts.unshift(current.tagName.toLowerCase());
    current = current.parentElement;
  }

  return parts.join(' > ');
}

/**
 * Determine the position zone of an element based on viewport-relative position.
 */
function computePositionZone(element: HTMLElement): string {
  // Check for modal first (walk up ancestors)
  let ancestor: HTMLElement | null = element;
  while (ancestor) {
    if (
      ancestor.getAttribute('role') === 'dialog' ||
      ancestor.getAttribute('aria-modal') === 'true' ||
      ancestor.tagName === 'DIALOG'
    ) {
      return 'modal';
    }
    ancestor = ancestor.parentElement;
  }

  const rect = element.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  if (vw === 0 || vh === 0) return 'main';

  const centerY = (rect.top + rect.bottom) / 2 / vh;
  const centerX = (rect.left + rect.right) / 2 / vw;

  if (centerY < 0.1) return 'header';
  if (centerY > 0.9) return 'footer';
  if (centerX < 0.2) return 'sidebar-left';
  if (centerX > 0.8) return 'sidebar-right';

  return 'main';
}

/**
 * Get the ARIA role of an element (explicit or implicit).
 */
function computeRole(element: HTMLElement): string {
  const explicit = element.getAttribute('role');
  if (explicit) return explicit;

  const implicit = IMPLICIT_ROLES[element.tagName];
  if (typeof implicit === 'function') return implicit(element);
  if (typeof implicit === 'string') return implicit;

  return '';
}

/**
 * Get the accessible name of an element.
 * Priority: aria-label → resolved aria-labelledby → textContent for buttons/links.
 * Dynamic patterns (numbers, dates, UUIDs) are replaced with {…}.
 */
function computeAccessibleName(element: HTMLElement): string | undefined {
  // aria-label
  const ariaLabel = readAriaLabelAttr(element);
  if (ariaLabel) return normalizeName(ariaLabel);

  // aria-labelledby
  const labelledBy = readAriaLabelledbyAttr(element);
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim())
      .filter(Boolean);
    if (parts.length > 0) return normalizeName(parts.join(' '));
  }

  // For buttons, links, headings: use textContent
  const tag = element.tagName;
  if (
    tag === 'BUTTON' ||
    tag === 'A' ||
    tag === 'SUMMARY' ||
    tag.match(/^H[1-6]$/) ||
    element.getAttribute('role') === 'button' ||
    element.getAttribute('role') === 'link' ||
    element.getAttribute('role') === 'tab'
  ) {
    const text = element.textContent?.trim();
    if (text) return normalizeName(text);
  }

  // For inputs: use associated label
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  ) {
    // Check for label[for]
    if (element.id) {
      const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
      if (label?.textContent?.trim()) return normalizeName(label.textContent.trim());
    }
    // Check for wrapping label
    const wrappingLabel = element.closest('label');
    if (wrappingLabel?.textContent?.trim()) return normalizeName(wrappingLabel.textContent.trim());
    // Placeholder as last resort
    const placeholder = readPlaceholderAttr(element);
    if (placeholder) return normalizeName(placeholder);
  }

  return undefined;
}

/**
 * Normalize an accessible name: truncate, replace dynamic patterns.
 */
function normalizeName(name: string): string {
  let normalized = name.trim();

  // Replace dynamic patterns with placeholder
  for (const pattern of DYNAMIC_PATTERNS) {
    normalized = normalized.replace(pattern, '{…}');
  }

  // Collapse whitespace
  normalized = normalized.replace(/\s+/g, ' ');

  // Truncate to 50 chars
  if (normalized.length > 50) {
    normalized = normalized.slice(0, 50);
  }

  return normalized;
}

/**
 * Compute the size category based on element area relative to viewport.
 */
function computeSizeCategory(element: HTMLElement): string {
  const rect = element.getBoundingClientRect();
  const viewportArea = window.innerWidth * window.innerHeight;

  if (viewportArea === 0) return 'medium';

  const ratio = (rect.width * rect.height) / viewportArea;

  if (ratio < 0.005) return 'icon';
  if (ratio < 0.01) return 'button';
  if (ratio < 0.03) return 'small';
  if (ratio < 0.1) return 'medium';
  if (ratio < 0.3) return 'large';
  if (ratio < 0.6) return 'fullwidth';
  return 'panel';
}

/**
 * Find the nearest ARIA landmark context by walking up ancestors.
 * Returns { landmark, label } tuple.
 */
function computeLandmarkContext(element: HTMLElement): {
  landmark: string;
  label: string | undefined;
} {
  let current: HTMLElement | null = element.parentElement;

  while (current && current.tagName !== 'BODY' && current.tagName !== 'HTML') {
    // Explicit landmark role
    const role = current.getAttribute('role');
    if (role && ARIA_LANDMARKS.has(role)) {
      return { landmark: role, label: readAriaLabelAttr(current) || undefined };
    }

    // Implicit landmark from tag
    const implicitLandmark = IMPLICIT_LANDMARKS[current.tagName];
    if (implicitLandmark) {
      return { landmark: implicitLandmark, label: readAriaLabelAttr(current) || undefined };
    }

    current = current.parentElement;
  }

  return { landmark: '', label: undefined };
}

/**
 * Detect if an element is part of a repeating pattern (list, grid, table).
 */
function computeRepeatPattern(element: HTMLElement): RepeatPatternData | undefined {
  const parent = element.parentElement;
  if (!parent) return undefined;

  // Check for semantic list/grid/table containers
  const parentRole = parent.getAttribute('role');
  const parentTag = parent.tagName;

  let containerType: 'list' | 'grid' | 'table' | undefined;

  if (parentRole === 'list' || parentTag === 'UL' || parentTag === 'OL') {
    containerType = 'list';
  } else if (parentRole === 'grid' || parentRole === 'row') {
    containerType = 'grid';
  } else if (parentTag === 'TABLE' || parentTag === 'TBODY' || parentTag === 'THEAD') {
    containerType = 'table';
  }

  // Fallback: check if parent has 3+ children with identical tag+class
  if (!containerType) {
    const children = Array.from(parent.children);
    if (children.length >= 3) {
      const signature = (el: Element) => `${el.tagName}|${classString(el)}`;
      const sig = signature(element);
      const matches = children.filter((c) => signature(c) === sig);
      if (matches.length >= 3) {
        containerType = 'list'; // Infer as list
      } else {
        return undefined;
      }
    } else {
      return undefined;
    }
  }

  // Compute index and total
  const siblings = Array.from(parent.children);
  const itemTag = element.tagName;
  const itemClass = classString(element);
  const matchingSiblings = siblings.filter(
    (s) => s.tagName === itemTag && classString(s) === itemClass
  );
  const index = matchingSiblings.indexOf(element);

  // Generate selectors
  const containerSelector = generateSimpleSelector(parent);
  const itemClassTokens = classList(element);
  const itemSelector = `${element.tagName.toLowerCase()}${
    itemClassTokens.length > 0 ? '.' + itemClassTokens.map((c) => CSS.escape(c)).join('.') : ''
  }`;

  return {
    type: containerType,
    containerSelector,
    itemSelector,
    index: Math.max(0, index),
    totalCount: matchingSiblings.length,
  };
}

/**
 * Generate a simple CSS selector for an element (for container references only).
 */
function generateSimpleSelector(element: HTMLElement): string {
  if (element.id) return `#${CSS.escape(element.id)}`;
  const testId = element.getAttribute('data-testid');
  if (testId) return `[data-testid="${testId}"]`;
  return element.tagName.toLowerCase();
}

/**
 * Synchronous hash using FNV-1a.
 * Produces a deterministic 16-char hex string from fingerprint properties.
 *
 * NOTE: The Python backend must use the same algorithm and input format
 * to produce matching hashes. Input format: "structuralPath|positionZone|role|accessibleName|sizeCategory"
 */
function computeHashSync(
  structuralPath: string,
  positionZone: string,
  role: string,
  accessibleName: string | undefined,
  sizeCategory: string
): string {
  const input = `${structuralPath}|${positionZone}|${role}|${accessibleName ?? ''}|${sizeCategory}`;

  // FNV-1a 64-bit hash (split into two 32-bit parts for JS)
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;

  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c * 31;
    h2 = Math.imul(h2, 0x01000193);
  }

  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return hex1 + hex2;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Compute an element fingerprint from a live DOM element.
 *
 * This is synchronous — uses the sync hash function.
 * For async SHA-256 hashing, use computeElementFingerprintAsync().
 */
export function computeElementFingerprint(element: HTMLElement): ElementFingerprintData {
  const structuralPath = computeStructuralPath(element);
  const positionZone = computePositionZone(element);
  const role = computeRole(element);
  const accessibleName = computeAccessibleName(element);
  const sizeCategory = computeSizeCategory(element);
  const { landmark, label: landmarkLabel } = computeLandmarkContext(element);
  const repeatPattern = computeRepeatPattern(element);

  const rect = element.getBoundingClientRect();
  const vw = window.innerWidth || 1;
  const vh = window.innerHeight || 1;

  const fingerprint: ElementFingerprintData = {
    hash: computeHashSync(structuralPath, positionZone, role, accessibleName, sizeCategory),
    structuralPath,
    positionZone,
    landmarkContext: landmark,
    role,
    tagName: element.tagName.toLowerCase(),
    sizeCategory,
    relativePosition: {
      top: Math.round((rect.top / vh) * 1000) / 1000,
      left: Math.round((rect.left / vw) * 1000) / 1000,
    },
    isRepeating: repeatPattern !== undefined,
  };

  if (landmarkLabel) fingerprint.landmarkLabel = landmarkLabel;
  if (accessibleName) fingerprint.accessibleName = accessibleName;
  if (repeatPattern) fingerprint.repeatPattern = repeatPattern;

  return fingerprint;
}

/**
 * Compute fingerprints for all registered elements in the registry.
 * Returns a map keyed by fingerprint hash.
 *
 * Elements that share a fingerprint hash (e.g., identical list items)
 * are deduplicated — only the first is kept.
 */
export function computeAllFingerprints(
  registry: UIBridgeRegistry
): Map<string, ElementFingerprintData> {
  const result = new Map<string, ElementFingerprintData>();
  const elements = registry.getAllElements();

  for (const registered of elements) {
    if (!registered.mounted || !registered.element.isConnected) continue;

    const fingerprint = computeElementFingerprint(registered.element);
    // First-write wins for duplicate hashes (deduplicates repeating items)
    if (!result.has(fingerprint.hash)) {
      result.set(fingerprint.hash, fingerprint);
    }
  }

  return result;
}

/**
 * Compute fingerprints with element ID mapping.
 * Returns fingerprints map and a mapping from fingerprint hash → element IDs.
 *
 * This is useful for the recording session to track which registered elements
 * correspond to which fingerprints.
 */
export function computeFingerprintsWithMapping(registry: UIBridgeRegistry): {
  fingerprints: Map<string, ElementFingerprintData>;
  hashToElementIds: Map<string, string[]>;
  elementIdToHash: Map<string, string>;
} {
  const fingerprints = new Map<string, ElementFingerprintData>();
  const hashToElementIds = new Map<string, string[]>();
  const elementIdToHash = new Map<string, string>();

  const elements = registry.getAllElements();

  for (const registered of elements) {
    if (!registered.mounted || !registered.element.isConnected) continue;

    const fingerprint = computeElementFingerprint(registered.element);

    if (!fingerprints.has(fingerprint.hash)) {
      fingerprints.set(fingerprint.hash, fingerprint);
    }

    const ids = hashToElementIds.get(fingerprint.hash) || [];
    ids.push(registered.id);
    hashToElementIds.set(fingerprint.hash, ids);
    elementIdToHash.set(registered.id, fingerprint.hash);
  }

  return { fingerprints, hashToElementIds, elementIdToHash };
}

/**
 * Find the nearest registered element for a DOM element by walking up ancestors.
 * Used by the interaction interceptor to map DOM events to registered elements.
 */
export function findNearestRegisteredElement(
  target: HTMLElement,
  registry: UIBridgeRegistry
): RegisteredElement | undefined {
  let current: HTMLElement | null = target;

  while (current && current.tagName !== 'BODY') {
    const registered = registry.findByDOMElement(current);
    if (registered) return registered;
    current = current.parentElement;
  }

  return undefined;
}
