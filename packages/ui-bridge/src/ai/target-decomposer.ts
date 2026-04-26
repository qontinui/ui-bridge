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
 *
 *   "Advanced details toggle"
 *   → { elementText: "Advanced", elementType: "disclosure" }
 *
 * Element-type recognition is driven by a single synonym table
 * (`ELEMENT_TYPE_SYNONYMS`). Multi-word phrases beat single words, so adding a
 * new family (or extending an existing one) is a one-line edit and naturally
 * resolves precedence ("details toggle" → disclosure, before "toggle" → switch).
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
  /**
   * @internal — true when `elementType` came from a soft-hint synonym
   * (e.g., "toggle" → switch, "details" → disclosure). Consumers like
   * `find.ts` use this flag to retry a label-only search if the
   * type-constrained search returns nothing. Not part of the stable
   * external contract; external clients should ignore it.
   */
  __softTypeHint?: boolean;
}

// Noise words to strip from descriptions
const NOISE_WORDS = new Set(['the', 'a', 'an', 'that', 'this', 'those', 'these', 'its', 'my']);

/**
 * Element-type synonym table.
 *
 * The decomposer scans synonyms in priority order: longer phrases first so
 * "details toggle" beats "toggle", "drop down" beats "drop", etc. This single
 * data structure replaces a scattered if/else regex chain — adding a new
 * widget family is a one-line edit and precedence falls out of phrase length.
 *
 * `softHint: true` marks synonyms that the surrounding language can override
 * (e.g., the bare verb "toggle" is a soft hint; in "details toggle" the
 * disclosure phrase wins). Soft hints are still emitted into `elementType`
 * but downstream consumers (see `find.ts`) treat them as advisory: if the
 * type-constrained search returns nothing, a label-only retry is attempted.
 */
interface ElementTypeSynonym {
  /** Element type to emit */
  type: string;
  /** Synonyms (case-insensitive). Multi-word entries match the literal phrase
   *  with flexible whitespace (e.g., "drop down" also matches "dropdown"). */
  synonyms: string[];
  /** When true, the matcher in find.ts will retry without `type=` if the
   *  type-constrained search produces no viable matches. */
  softHint?: boolean;
}

const ELEMENT_TYPE_SYNONYMS: ElementTypeSynonym[] = [
  // Inputs / form
  { type: 'textarea', synonyms: ['text area', 'text field', 'text box'] },
  { type: 'input', synonyms: ['input', 'field', 'textbox'] },
  { type: 'select', synonyms: ['drop down', 'dropdown', 'combo box', 'combobox', 'select'] },
  { type: 'checkbox', synonyms: ['check box', 'checkbox'] },
  { type: 'radio', synonyms: ['radio button', 'radio'] },

  // Buttons / links
  // 'icon' is a soft hint — "settings icon" is usually a button but could
  // also be a passive image; let the label match decide if the type fails.
  { type: 'button', synonyms: ['button'] },
  { type: 'button', synonyms: ['icon'], softHint: true },
  { type: 'link', synonyms: ['link', 'hyperlink', 'anchor'] },

  // Navigation
  { type: 'tab', synonyms: ['tab'] },
  { type: 'menuitem', synonyms: ['menu item', 'menuitem'] },
  { type: 'menu', synonyms: ['menu'] },

  // Disclosure / accordion family
  // Multi-word phrases (e.g., "details toggle") sit above the bare "toggle"
  // synonym below so they win precedence. The single-word "details" is
  // softHint because it commonly appears as label text ("Job details"); a
  // label match should still work when nothing else flags this as
  // a disclosure.
  {
    type: 'disclosure',
    synonyms: [
      'details toggle',
      'details panel',
      'disclosure',
      'accordion',
      'collapsible',
      'expander',
      'expandable',
    ],
  },
  {
    type: 'disclosure',
    synonyms: ['expand', 'collapse', 'details'],
    softHint: true,
  },

  // Switch / toggle
  // Plain "toggle" is a soft hint — "details toggle" already routed above to
  // disclosure; in other contexts the matcher should fall back to a
  // label-only retry rather than hard-pinning the type.
  { type: 'switch', synonyms: ['switch'] },
  { type: 'switch', synonyms: ['toggle'], softHint: true },

  // Misc
  { type: 'slider', synonyms: ['slider'] },
  { type: 'label', synonyms: ['label'] },
  { type: 'heading', synonyms: ['heading'] },
];

/**
 * Compiled regex form of ELEMENT_TYPE_SYNONYMS, with an order that always
 * tries the longest phrase first. Built once at module load.
 *
 * Each compiled entry preserves a back-reference to the source synonym so
 * downstream consumers (e.g., `find.ts`) can ask "was this a soft hint?".
 */
interface CompiledSynonym {
  pattern: RegExp;
  type: string;
  softHint: boolean;
  /** The original synonym text — useful for debugging / introspection. */
  synonym: string;
  /** Word count of the synonym; longer phrases sort first. */
  wordCount: number;
}

function compileSynonym(type: string, synonym: string, softHint: boolean): CompiledSynonym {
  // Multi-word synonyms require at least one whitespace between tokens — we
  // intentionally do NOT collapse "text box" to also match "textbox", because
  // "textbox" is a distinct ARIA role that maps to `input`. The synonym table
  // lists both forms explicitly when they should both be recognised
  // (e.g., "drop down" + "dropdown", "check box" + "checkbox").
  const tokens = synonym.trim().split(/\s+/);
  const escaped = tokens.map((t) => escapeRegExp(t)).join('\\s+');
  return {
    pattern: new RegExp(`\\b${escaped}\\b`, 'i'),
    type,
    softHint,
    synonym,
    wordCount: tokens.length,
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const COMPILED_ELEMENT_TYPE_SYNONYMS: CompiledSynonym[] = (() => {
  const compiled: CompiledSynonym[] = [];
  for (const entry of ELEMENT_TYPE_SYNONYMS) {
    for (const syn of entry.synonyms) {
      compiled.push(compileSynonym(entry.type, syn, entry.softHint === true));
    }
  }
  // Sort by word count desc, then synonym length desc, so longer phrases win.
  compiled.sort((a, b) => {
    if (b.wordCount !== a.wordCount) return b.wordCount - a.wordCount;
    return b.synonym.length - a.synonym.length;
  });
  return compiled;
})();

/**
 * Whether the decomposer's type guess on this result is advisory.
 *
 * Soft-hint synonyms (e.g., bare "toggle", "details") set
 * `__softTypeHint = true` on the decomposed result. Consumers such as
 * `find.ts` use this to relax type pinning when the type-constrained
 * search returns nothing — preserving label-driven matches.
 */
export function isSoftTypeHint(decomposed: DecomposedTarget): boolean {
  return decomposed.__softTypeHint === true;
}

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
 * Extract element type from description.
 *
 * Driven by the compiled synonym table. Longer phrases match first so
 * "details toggle" → disclosure beats "toggle" → switch.
 */
function extractElementType(text: string, result: DecomposedTarget): string {
  for (const entry of COMPILED_ELEMENT_TYPE_SYNONYMS) {
    if (entry.pattern.test(text)) {
      result.elementType = entry.type;
      if (entry.softHint) {
        result.__softTypeHint = true;
      }
      return text.replace(entry.pattern, ' ').trim();
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
