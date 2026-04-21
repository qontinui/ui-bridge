/**
 * Structured NL-disambiguation query
 *
 * Given a snapshot (or any array of findable elements) and either a free-text
 * query or a structured filter object, returns ranked candidates by token-bag
 * scoring over the element's label, type, variant, position, color, and
 * contextPath fields.
 *
 * This replaces the VLM-for-disambiguation use case that the platform-scope
 * refinement (see `proj_platform_scope_split`) took off the table. When an
 * NL query like *"the red destructive Save at bottom-right"* matches
 * multiple elements by label alone, the disambiguation metadata fields
 * (set via `useUIElement`) rank the intended one without pixel inspection.
 *
 * Design notes:
 *
 * - **Pure function, no registry coupling.** Takes an array of serialized
 *   elements (snapshot shape). Works against `BridgeSnapshot.elements`,
 *   `ControlSnapshot.elements`, and any future mirror — we only read the
 *   subset of fields listed in {@link FindableElement}.
 * - **Token-bag scoring, no hardcoded keyword lists.** Design systems use
 *   their own variant/color/position tokens; a fixed "red/blue/green" list
 *   would prevent "accent" or "#ef4444" from working. Every query token is
 *   compared to every metadata field; matches accumulate score weighted by
 *   field importance.
 * - **No LLM involvement.** Deterministic, synchronous, cheap. If an LLM
 *   rerank is ever needed for tie-breaking, the caller can feed the top
 *   candidates back to one — but most queries are unambiguous once tokens
 *   overlap correctly.
 * - **Order is stable.** Ties break on visibility first, then registration
 *   order (input order of the `elements` array), so repeated calls return
 *   the same ranking.
 */

/**
 * Minimal element shape consumed by {@link findElements}. Matches the
 * serialized entries in both `BridgeSnapshot.elements` and
 * `ControlSnapshot.elements`.
 */
export interface FindableElement {
  id: string;
  type?: string;
  label?: string;
  variant?: string;
  position?: string;
  color?: string;
  contextPath?: string;
  origin?: 'hook' | 'auto';
  visible?: boolean;
  /** Passthrough — callers may include arbitrary extra fields. */
  [key: string]: unknown;
}

/** Structured query shape. All fields optional; at least one must be provided. */
export interface ElementQuery {
  /** Free-text query — tokens overlap against every metadata field. */
  text?: string;
  /** Exact type filter (hard constraint). */
  type?: string;
  /** Variant hint. Matched as a token; caller can repeat in `text` too. */
  variant?: string;
  /** Positional hint. */
  position?: string;
  /** Color hint. */
  color?: string;
  /** Context-path prefix (substring match against the element's contextPath). */
  contextPathContains?: string;
  /** Restrict to hook-registered, auto-registered, or either. Default: either. */
  origin?: 'hook' | 'auto';
  /** Only return candidates flagged `visible: true`. Default: false (both). */
  visibleOnly?: boolean;
  /** Maximum results to return. Default: 10. */
  limit?: number;
  /** Drop candidates with score below this. Default: 0 (keep any match). */
  minScore?: number;
}

export interface ElementMatch {
  /** The element's stable id. */
  id: string;
  /** The element entry from the snapshot. */
  element: FindableElement;
  /** Total score (higher = better). */
  score: number;
  /** Which fields contributed, for debugging. */
  reasons: string[];
}

/** Field weights — higher = more decisive. Tuned so a type match beats
 *  a bare label overlap, but a variant + color + position combo can still
 *  win against a single loose label match. */
const FIELD_WEIGHTS = {
  type: 15,
  variant: 8,
  position: 6,
  color: 5,
  contextPath: 3,
  label: 5, // per-token; full label phrase adds an extra bonus
} as const;

const FULL_LABEL_BONUS = 10;

/**
 * Find and rank elements matching the given query.
 *
 * @param elements  Serialized snapshot elements.
 * @param query     Either a free-text string or a structured {@link ElementQuery}.
 *                  A plain string is treated as `{ text: <string> }`.
 * @returns Ranked matches, highest score first. Empty array if no element
 *          passes hard filters or scores above `minScore`.
 */
export function findElements(
  elements: readonly FindableElement[],
  query: ElementQuery | string
): ElementMatch[] {
  const q: ElementQuery = typeof query === 'string' ? { text: query } : query;

  const textTokens = tokenize(q.text ?? '');
  const limit = q.limit ?? 10;
  const minScore = q.minScore ?? 0;

  const results: ElementMatch[] = [];

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];

    // Hard filters first — cheap rejections before scoring.
    if (q.type && el.type !== q.type) continue;
    if (q.origin && el.origin !== q.origin) continue;
    if (q.visibleOnly && el.visible !== true) continue;
    if (q.contextPathContains) {
      const cp = (el.contextPath ?? '').toLowerCase();
      if (!cp.includes(q.contextPathContains.toLowerCase())) continue;
    }

    let score = 0;
    const reasons: string[] = [];

    // Structured hint matches (exact, case-insensitive).
    if (q.variant && eqCI(el.variant, q.variant)) {
      score += FIELD_WEIGHTS.variant;
      reasons.push(`variant=${el.variant}`);
    }
    if (q.position && eqCI(el.position, q.position)) {
      score += FIELD_WEIGHTS.position;
      reasons.push(`position=${el.position}`);
    }
    if (q.color && eqCI(el.color, q.color)) {
      score += FIELD_WEIGHTS.color;
      reasons.push(`color=${el.color}`);
    }

    // Token-bag matches against metadata fields and label.
    if (textTokens.length > 0) {
      const label = (el.label ?? '').toLowerCase();
      const labelTokens = tokenize(el.label ?? '');

      // Full phrase match against label is a strong signal — e.g. "save"
      // → label="Save" is a big win regardless of other fields.
      if (label && label === (q.text ?? '').trim().toLowerCase()) {
        score += FULL_LABEL_BONUS;
        reasons.push('label-full-match');
      }

      for (const token of textTokens) {
        // Label token overlap — capped at actual overlap, not duplicate
        // counted if the same token appears twice in the query.
        if (labelTokens.includes(token)) {
          score += FIELD_WEIGHTS.label;
          reasons.push(`label~${token}`);
        }
        // Each metadata field — single exact-ish match per field per token.
        if (eqCI(el.type, token)) {
          score += FIELD_WEIGHTS.type;
          reasons.push(`type=${el.type}`);
        }
        if (containsToken(el.variant, token)) {
          score += FIELD_WEIGHTS.variant;
          reasons.push(`variant~${token}`);
        }
        if (containsToken(el.position, token)) {
          score += FIELD_WEIGHTS.position;
          reasons.push(`position~${token}`);
        }
        if (containsToken(el.color, token)) {
          score += FIELD_WEIGHTS.color;
          reasons.push(`color~${token}`);
        }
        if (containsToken(el.contextPath, token)) {
          score += FIELD_WEIGHTS.contextPath;
          reasons.push(`contextPath~${token}`);
        }
      }
    }

    // NOTE: visibility does NOT contribute to score. A zero-score element
    // that happens to be visible shouldn't leak into results just because
    // it's on-screen — the query asked for something specific. Visibility
    // breaks ties below.

    // Score threshold only applies when the query carried text — a pure
    // structured filter query (e.g. `{ type: "button" }` alone) should
    // return everything that passed the hard filters, even at score 0.
    // Otherwise `{ type: "button" }` would return zero results.
    if (textTokens.length > 0 && score <= minScore) continue;
    results.push({ id: el.id, element: el, score, reasons });
  }

  // Sort: score desc, then visible first, then input order stable.
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aVis = a.element.visible === true ? 0 : 1;
    const bVis = b.element.visible === true ? 0 : 1;
    if (aVis !== bVis) return aVis - bVis;
    return 0;
  });

  return results.slice(0, limit);
}

/** Lowercase-normalize a string into word tokens. Splits on anything that
 *  isn't a letter, digit, or hyphen so `"bottom-right"` stays intact but
 *  `"top, bottom"` splits cleanly. Empty strings → empty array. */
function tokenize(s: string): string[] {
  if (!s) return [];
  return s
    .toLowerCase()
    .split(/[^a-z0-9#-]+/)
    .filter((t) => t.length > 0);
}

/** Case-insensitive equality; tolerates undefined on either side. */
function eqCI(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  return a.toLowerCase() === b.toLowerCase();
}

/** True if `value` contains `token` as an exact match, a hyphenated token
 *  (e.g. `"bottom-right"` as one token), or a hyphen-split token
 *  (e.g. `"bottom"` inside `"bottom-right"`). This dual check lets queries
 *  hit both the compound form ("top-right") and the component form
 *  ("top"). */
function containsToken(value: string | undefined, token: string): boolean {
  if (!value) return false;
  const v = value.toLowerCase();
  const t = token.toLowerCase();
  if (v === t) return true;
  // Compound form: keep hyphens in value tokens.
  const hyphenated = v.split(/[^a-z0-9#-]+/).filter((p) => p.length > 0);
  if (hyphenated.includes(t)) return true;
  // Component form: also split hyphens so "bottom-right" yields
  // ["bottom","right"] and a query token "bottom" hits.
  const split = v.split(/[^a-z0-9#]+/).filter((p) => p.length > 0);
  return split.includes(t);
}
