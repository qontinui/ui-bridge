/**
 * Target Description Decomposer
 *
 * Decomposes natural language element descriptions into structured components
 * for the search engine. Extracts element type, spatial relationships,
 * container context, ordinals, and state filters from free-form text.
 *
 * Examples:
 *   "close button near Terminal 1 tab"
 *   → { elementText: "close", elementType: "button", spatial: { relation: "near", referenceDescription: "Terminal 1 tab" } }
 *
 *   "the email input in the login form"
 *   → { elementText: "email", elementType: "input", container: "login form" }
 *
 *   "third item in the list"
 *   → { elementText: "item", container: "list", ordinal: 3 }
 */

/**
 * Spatial relationship between elements
 */
export type SpatialRelation = 'near' | 'above' | 'below' | 'leftOf' | 'rightOf' | 'inside';

/**
 * Decomposed target description
 */
export interface DecomposedTarget {
  /** Core text to match against element content/labels */
  elementText: string;
  /** Element type hint extracted from description */
  elementType?: string;
  /** Spatial relationship to another element */
  spatial?: {
    relation: SpatialRelation;
    referenceDescription: string;
  };
  /** Container context (e.g., "the login form", "sidebar") */
  container?: string;
  /** Ordinal position (1-based) */
  ordinal?: number;
  /** State filter */
  stateFilter?:
    | 'disabled'
    | 'enabled'
    | 'active'
    | 'selected'
    | 'checked'
    | 'focused'
    | 'hidden'
    | 'visible';
  // ---------------------------------------------------------------------------
  // Source-signal mirrors (B3)
  //
  // These optional fields document which element-side attributes the matcher
  // probes for the query. They are populated for free-form natural-language
  // queries (mirroring `elementText`) so callers can see at a glance that
  // `ai/find` now considers placeholder/aria-label/<label>/name in addition
  // to visible text content.
  //
  // Existing consumers ignore unknown fields, so this is backward compatible.
  // ---------------------------------------------------------------------------
  /** Query value also probed against `<label>` text (for/wrapping). */
  label?: string;
  /** Query value also probed against `aria-label`. */
  ariaLabel?: string;
  /** Query value also probed against `placeholder` (input/textarea). */
  placeholder?: string;
  /** Query value also probed against the `name` attribute. */
  name?: string;
}

// Noise words to strip from descriptions
const NOISE_WORDS = new Set(['the', 'a', 'an', 'that', 'this', 'those', 'these', 'its', 'my']);

// Element type keywords — order matters (longer matches first)
const ELEMENT_TYPES: Array<{ pattern: RegExp; type: string }> = [
  { pattern: /\btext\s*(?:area|field|box)\b/i, type: 'textarea' },
  { pattern: /\bdrop\s*down\b/i, type: 'select' },
  { pattern: /\bcheck\s*box\b/i, type: 'checkbox' },
  { pattern: /\bradio\s*button\b/i, type: 'radio' },
  { pattern: /\bbutton\b/i, type: 'button' },
  { pattern: /\binput\b/i, type: 'input' },
  { pattern: /\bfield\b/i, type: 'input' },
  { pattern: /\btab\b/i, type: 'tab' },
  { pattern: /\blink\b/i, type: 'link' },
  { pattern: /\bicon\b/i, type: 'button' },
  { pattern: /\bswitch\b/i, type: 'switch' },
  { pattern: /\btoggle\b/i, type: 'switch' },
  { pattern: /\bslider\b/i, type: 'slider' },
  { pattern: /\blabel\b/i, type: 'label' },
  { pattern: /\bheading\b/i, type: 'heading' },
  { pattern: /\bmenu\b/i, type: 'menu' },
  { pattern: /\bmenu\s*item\b/i, type: 'menuitem' },
  { pattern: /\bselect\b/i, type: 'select' },
  { pattern: /\bcombo\s*box\b/i, type: 'select' },
];

// Spatial relation patterns — order matters (longer/more specific first)
const SPATIAL_PATTERNS: Array<{ pattern: RegExp; relation: SpatialRelation }> = [
  { pattern: /\bnext\s+to\s+(.+)$/i, relation: 'near' },
  { pattern: /\bbeside\s+(.+)$/i, relation: 'near' },
  { pattern: /\bnear\s+(.+)$/i, relation: 'near' },
  { pattern: /\babove\s+(.+)$/i, relation: 'above' },
  { pattern: /\bbelow\s+(.+)$/i, relation: 'below' },
  { pattern: /\bunder(?:neath)?\s+(.+)$/i, relation: 'below' },
  { pattern: /\bleft\s+of\s+(.+)$/i, relation: 'leftOf' },
  { pattern: /\bright\s+of\s+(.+)$/i, relation: 'rightOf' },
  { pattern: /\binside\s+(.+)$/i, relation: 'inside' },
];

// Container patterns — "in the X", "within the X", "inside the X" (when not at end of string)
const CONTAINER_PATTERNS: RegExp[] = [
  /\b(?:in|within|inside)\s+(?:the\s+)?(.+?)(?:\s+(?:near|above|below|left of|right of|next to|beside)|\s*$)/i,
];

// Ordinal patterns
const ORDINAL_MAP: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  last: -1,
  '1st': 1,
  '2nd': 2,
  '3rd': 3,
  '4th': 4,
  '5th': 5,
  '6th': 6,
  '7th': 7,
  '8th': 8,
  '9th': 9,
  '10th': 10,
};

// State filter keywords
const STATE_FILTERS = new Set([
  'disabled',
  'enabled',
  'active',
  'selected',
  'checked',
  'focused',
  'hidden',
  'visible',
]);

/**
 * Decompose a natural language target description into structured components.
 */
export function decomposeTarget(description: string): DecomposedTarget {
  let remaining = description.trim();
  const result: DecomposedTarget = { elementText: '' };

  // 1. Extract state filter (e.g., "the disabled save button")
  remaining = extractStateFilter(remaining, result);

  // 2. Extract spatial relation (e.g., "... near Terminal 1 tab")
  //    Must come before container extraction since "inside X" is both spatial and container
  remaining = extractSpatialRelation(remaining, result);

  // 3. Extract container context (e.g., "... in the login form")
  //    Only if no spatial "inside" was already extracted
  if (!result.spatial || result.spatial.relation !== 'inside') {
    remaining = extractContainer(remaining, result);
  } else {
    // If spatial is "inside", also set it as a container
    result.container = result.spatial.referenceDescription;
    // Clear spatial — "inside" is containment, not proximity
    result.spatial = undefined;
  }

  // 4. Extract ordinal (e.g., "third item", "2nd button")
  remaining = extractOrdinal(remaining, result);

  // 5. Extract element type (e.g., "button", "input", "tab")
  remaining = extractElementType(remaining, result);

  // 6. Clean up remaining text as the element text
  result.elementText = cleanElementText(remaining);

  // 7. Mirror the element text into source-signal fields (B3) so callers can
  //    see that placeholder/aria-label/<label>/name are probed in addition
  //    to the visible text content. Skipped for empty queries.
  if (result.elementText) {
    result.label = result.elementText;
    result.ariaLabel = result.elementText;
    result.placeholder = result.elementText;
    result.name = result.elementText;
  }

  return result;
}

/**
 * Extract state filter from description
 */
function extractStateFilter(text: string, result: DecomposedTarget): string {
  for (const state of STATE_FILTERS) {
    const regex = new RegExp(`\\b${state}\\b`, 'i');
    if (regex.test(text)) {
      result.stateFilter = state as DecomposedTarget['stateFilter'];
      return text.replace(regex, ' ').trim();
    }
  }
  return text;
}

/**
 * Extract spatial relationship from description
 */
function extractSpatialRelation(text: string, result: DecomposedTarget): string {
  for (const { pattern, relation } of SPATIAL_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[1]) {
      result.spatial = {
        relation,
        referenceDescription: cleanReferenceDescription(match[1]),
      };
      // Remove the spatial clause from the text
      return text.slice(0, match.index!).trim();
    }
  }
  return text;
}

/**
 * Extract container context from description
 */
function extractContainer(text: string, result: DecomposedTarget): string {
  for (const pattern of CONTAINER_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const container = cleanReferenceDescription(match[1]);
      // Avoid false positives where "in" is part of the element name (e.g., "sign in button")
      if (container.length > 2 && !isPartOfCompoundWord(text, match.index!, 'in')) {
        result.container = container;
        return text.slice(0, match.index!).trim();
      }
    }
  }
  return text;
}

/**
 * Check if "in" at the given position is part of a compound word like "sign in", "log in"
 */
function isPartOfCompoundWord(text: string, matchIndex: number, _word: string): boolean {
  const before = text.slice(0, matchIndex).trim().toLowerCase();
  const compoundPrefixes = ['sign', 'log', 'opt', 'check', 'plug', 'fill', 'zoom', 'fade', 'drop'];
  return compoundPrefixes.some((prefix) => before.endsWith(prefix));
}

/**
 * Extract ordinal from description
 */
function extractOrdinal(text: string, result: DecomposedTarget): string {
  // Check for word ordinals
  for (const [word, value] of Object.entries(ORDINAL_MAP)) {
    const regex = new RegExp(`\\b${word}\\b`, 'i');
    if (regex.test(text)) {
      result.ordinal = value;
      return text.replace(regex, ' ').trim();
    }
  }

  // Check for numeric ordinals like "3rd", "11th"
  const numericMatch = text.match(/\b(\d+)(?:st|nd|rd|th)\b/i);
  if (numericMatch) {
    result.ordinal = parseInt(numericMatch[1], 10);
    return text.replace(numericMatch[0], ' ').trim();
  }

  return text;
}

/**
 * Extract element type from description
 */
function extractElementType(text: string, result: DecomposedTarget): string {
  for (const { pattern, type } of ELEMENT_TYPES) {
    if (pattern.test(text)) {
      result.elementType = type;
      return text.replace(pattern, ' ').trim();
    }
  }
  return text;
}

/**
 * Clean up the remaining element text
 */
function cleanElementText(text: string): string {
  // Remove noise words
  const words = text.split(/\s+/).filter((w) => !NOISE_WORDS.has(w.toLowerCase()));

  // Rejoin and clean up whitespace/punctuation
  return words
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,]+|[\s,]+$/g, '')
    .trim();
}

/**
 * Clean up a reference description (spatial target or container name)
 */
function cleanReferenceDescription(text: string): string {
  return text
    .replace(/^(?:the|a|an)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}
