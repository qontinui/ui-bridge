/**
 * Search Engine
 *
 * Multi-strategy element search using text, role, accessibility,
 * spatial proximity, and fuzzy matching.
 */

import type { RegisteredElement, ElementState } from '../core/types';
import type { DiscoveredElement } from '../control/types';
import type { SearchCriteria, SearchResult, SearchResponse, AIDiscoveredElement } from './types';
import {
  fuzzyMatch,
  fuzzyContains,
  wordSimilarity,
  tokenSimilarity,
  DEFAULT_FUZZY_CONFIG,
} from './fuzzy-matcher';
import {
  generateAliases,
  generateDescription,
  generatePurpose,
  generateSuggestedActions,
  areSynonyms,
} from './alias-generator';
import { getGlobalAnnotationStore } from '../annotations';
import { getGlobalRegistry } from '../core/registry';
import { truncateCodePoints } from '../core/text';
import {
  verdictOf,
  verdictFromState,
  isContentRedacted,
  scrubContentByVerdict,
  scrubContentRequired,
  scrubAliases,
  trustDeveloperContent,
  readScrubbedValue,
  readScrubbedText,
  type RedactionVerdict,
} from '../core/redaction';
import { readAriaLabelAttr, readPlaceholderAttr, readTitleAttr } from '../core/a11y';

/**
 * Returns true when the `UI_BRIDGE_DEBUG_FIND` find-diagnostic flag is enabled
 * via either of two channels:
 *
 *   1. `globalThis.process.env.UI_BRIDGE_DEBUG_FIND === '1'` — the Node /
 *      vitest path, also honoured at runner spawn time when the supervisor
 *      forwards the env var into the webview process.
 *   2. `globalThis.localStorage.getItem('UI_BRIDGE_DEBUG_FIND') === '1'` —
 *      the webview path. The qontinui-runner's `/ui-bridge/control/page/
 *      evaluate` endpoint executes each call in an isolated VM context, so
 *      mutations to `process.env` set by one evaluate call do not persist
 *      into the next. localStorage is shared across all evaluate calls in
 *      the same origin, so writes via
 *      `localStorage.setItem('UI_BRIDGE_DEBUG_FIND','1')` survive and the
 *      subsequent `/ai/find` request sees the gate as enabled.
 *
 * Either channel set is sufficient — they OR together. Both wrapped in
 * try/catch so missing-globals (Node test runner) and getter-throws
 * (Safari private-mode-style failures) never escape.
 *
 * This gate is permanent — keep instrumentation behind it as a stable
 * diagnostic affordance for `/ui-bridge/ai/find` triage.
 *
 * Exported for unit testing — kept on the public surface alongside
 * `__scoringInternals` so consumers don't have to fork module internals to
 * exercise the gate semantics.
 *
 * @internal
 */
export function isFindDebugEnabled(): boolean {
  try {
    const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
    if (proc?.env?.UI_BRIDGE_DEBUG_FIND === '1') {
      return true;
    }
  } catch {
    // process / env access threw — fall through to localStorage check.
  }

  try {
    const ls = (globalThis as { localStorage?: { getItem?: (key: string) => string | null } })
      .localStorage;
    if (ls && typeof ls.getItem === 'function') {
      if (ls.getItem('UI_BRIDGE_DEBUG_FIND') === '1') {
        return true;
      }
    }
  } catch {
    // localStorage missing or threw (Safari private mode / SecurityError) —
    // treat as not-enabled.
  }

  return false;
}

/**
 * Truncate a string to `max` chars for safe logging — long labels would
 * otherwise blow up console output / response payloads.
 */
function truncForDebug(s: string | undefined, max = 80): string | undefined {
  if (!s) return s;
  return s.length > max ? `${truncateCodePoints(s, max)}…` : s;
}

/**
 * Punctuation that should be stripped from tokens before alignment checks.
 * Matches the characters most commonly used to terminate or join label words
 * in real UIs: `: , . ; — - / ( )` and family. We keep apostrophes and
 * intra-word digits intact so brand-shaped labels still tokenize sensibly.
 */
const TOKEN_PUNCTUATION_RE = /[:,.;!?/()\\[\]{}<>"`—–-]+/g;

/**
 * Split a string into lowercased word-tokens with surrounding punctuation
 * removed. "Advanced:" → ["advanced"]. "per-stage controls" → ["per", "stage",
 * "controls"]. Empty tokens (from runs of punctuation) are dropped.
 */
function tokenizeForAlignment(s: string): string[] {
  return s
    .toLowerCase()
    .replace(TOKEN_PUNCTUATION_RE, ' ')
    .replace(/_+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * Result of comparing the query's tokens to the target's tokens.
 *
 *   - `prefix-aligned`     — every query token is a prefix of some target
 *                            token (case-insensitive, post-punctuation-strip).
 *                            Models the "your keyword introduces the label"
 *                            relationship like "Advanced" → "Advanced: …".
 *   - `all-tokens-present` — every query token appears as a complete or
 *                            partial substring of the target string. Captures
 *                            "per stage" → "per-stage controls" without the
 *                            stricter prefix requirement.
 *   - `partial`            — at least one query token matches; some don't.
 *                            Better than nothing, weaker than full coverage.
 *   - `none`               — no token overlap.
 */
type TokenAlignmentKind = 'prefix-aligned' | 'all-tokens-present' | 'partial' | 'none';

interface TokenAlignmentResult {
  kind: TokenAlignmentKind;
  matchedTokenCount: number;
  totalQueryTokens: number;
}

/** Strength ordering for `TokenAlignmentKind`, so "best verdict wins" is one lookup. */
const ALIGNMENT_STRENGTH: Readonly<Record<TokenAlignmentKind, number>> = {
  none: 0,
  partial: 1,
  'all-tokens-present': 2,
  'prefix-aligned': 3,
};

/**
 * Fold a new alignment verdict into the running best. `null` means "no text
 * criterion has been scored yet", which any real verdict replaces.
 */
function strongerAlignment(
  current: TokenAlignmentKind | null,
  next: TokenAlignmentKind
): TokenAlignmentKind {
  if (current === null) return next;
  return ALIGNMENT_STRENGTH[next] > ALIGNMENT_STRENGTH[current] ? next : current;
}

/**
 * Ceiling placed on an element's final confidence when the best text alignment
 * across every scored source was `partial` (some query tokens matched, the rest
 * matched nothing) or `none` (nothing in the query was answered for at all).
 *
 * WHY A CAP AND NOT JUST A RANKING PENALTY. The graduated ladder in
 * `scoreTextMatch` is a *ranking* signal: it decides which candidate sorts
 * first. Nothing downstream stopped a badly-aligned candidate from clearing the
 * gate outright, because the final confidence is a weighted average — so a
 * `partial` text score of 0.7 (weight 0.35) plus a synonym hit of 0.85
 * (weight 0.15) averages to 0.745 and sails past the 0.5 default
 * `confidenceThreshold`. That is how the query "Session Manager" returned
 * `found: true` at 74.5% on an element that answered for "session" and nothing
 * at all for "manager".
 *
 * A confidently-wrong answer is worse than no answer, so an unaligned match is
 * capped BELOW the 0.5 default threshold. It is a cap rather than a zero so the
 * candidate still ranks sensibly inside `partialMatches` / `alternatives`,
 * where sub-threshold candidates are exactly what the caller asked to see.
 */
const UNALIGNED_CONFIDENCE_CAP = 0.45;

/**
 * Compare a query string against a target string and report the strongest
 * token-level relationship between them. Returns `kind: 'none'` when nothing
 * lines up so the caller can fall through to a literal substring check.
 *
 * The order of checks is monotonic by signal strength: prefix-alignment is
 * the tightest, then all-tokens-anywhere, then partial. We never down-grade
 * a prefix-aligned hit to "partial" even when not every target token has a
 * query token — only the query's coverage of the target matters here.
 */
function analyzeTokenAlignment(query: string, target: string): TokenAlignmentResult {
  const queryTokens = tokenizeForAlignment(query);
  const targetTokens = tokenizeForAlignment(target);
  const totalQueryTokens = queryTokens.length;

  if (totalQueryTokens === 0 || targetTokens.length === 0) {
    return { kind: 'none', matchedTokenCount: 0, totalQueryTokens };
  }

  // Pass 1: prefix alignment. Each query token must be a prefix of some
  // target token. We don't require ordered/positional alignment — a
  // "clear filters" query against "filters: clear all" should still
  // qualify, mirroring user expectations for keyword queries.
  let prefixMatches = 0;
  for (const qt of queryTokens) {
    if (targetTokens.some((tt) => tt.startsWith(qt))) {
      prefixMatches += 1;
    }
  }
  if (prefixMatches === totalQueryTokens) {
    return { kind: 'prefix-aligned', matchedTokenCount: prefixMatches, totalQueryTokens };
  }

  // Pass 2: every query token appears somewhere in the target. Allows the
  // query token to land mid-target-token (e.g., "stage" → "per-stage"
  // pre-tokenization, but here we already split — so this is "stage" →
  // any target token containing "stage" as substring).
  let presenceMatches = 0;
  for (const qt of queryTokens) {
    if (targetTokens.some((tt) => tt.includes(qt))) {
      presenceMatches += 1;
    }
  }
  if (presenceMatches === totalQueryTokens) {
    return {
      kind: 'all-tokens-present',
      matchedTokenCount: presenceMatches,
      totalQueryTokens,
    };
  }

  if (presenceMatches > 0) {
    return { kind: 'partial', matchedTokenCount: presenceMatches, totalQueryTokens };
  }

  return { kind: 'none', matchedTokenCount: 0, totalQueryTokens };
}

/**
 * How close a query token must come to SOME target token before that token
 * counts as answered for.
 *
 * Deliberately a fixed floor rather than the caller's `fuzzyThreshold`. The two
 * ask different questions: the caller's threshold governs how good a match has
 * to be to WIN, while this one governs whether a word was addressed AT ALL.
 * Letting a stricter caller threshold also tighten this gate would start
 * rejecting typos the caller never asked to reject — and `find()` already
 * passes its `confidenceThreshold` (0.5 by default) down as `fuzzyThreshold`,
 * so the two are not independent knobs in practice.
 *
 * 0.5 is where the measured cases separate, and they separate cleanly:
 *
 *   covered   "sumbit" ~ "submit"      0.657   (a typo — must still find)
 *   covered   "buton"  ~ "button"      0.874
 *   UNCOVERED "warehouse" ~ "report"   0.369   (a word this page cannot answer)
 *   UNCOVERED "manager"   ~ "sessions" 0.000
 */
const TOKEN_COVERAGE_FLOOR = 0.5;

/**
 * The typo-tolerant reading of `analyzeTokenAlignment`'s coverage question:
 * does every query token have SOME target token it plausibly names?
 *
 * Used only to decide whether the confidence cap fires — never to score. It
 * cannot report `prefix-aligned`, because a fuzzy hit is by definition not a
 * clean prefix; the exact ladder remains the only source of that verdict.
 */
function analyzeFuzzyTokenCoverage(query: string, target: string): TokenAlignmentKind {
  const queryTokens = tokenizeForAlignment(query);
  const targetTokens = tokenizeForAlignment(target);
  if (queryTokens.length === 0 || targetTokens.length === 0) return 'none';

  let covered = 0;
  for (const qt of queryTokens) {
    let best = 0;
    for (const tt of targetTokens) {
      if (tt.startsWith(qt) || tt.includes(qt)) {
        best = 1;
        break;
      }
      const sim = fuzzyMatch(qt, tt, { threshold: TOKEN_COVERAGE_FLOOR }).similarity;
      if (sim > best) best = sim;
    }
    if (best >= TOKEN_COVERAGE_FLOOR) covered += 1;
  }

  if (covered === queryTokens.length) return 'all-tokens-present';
  return covered > 0 ? 'partial' : 'none';
}

/**
 * Internal export for unit tests — exposes the alignment helper without
 * leaking the broader `SearchableElement` shape. Test-only consumers should
 * import this name explicitly.
 *
 * @internal
 */
export const __scoringInternals = {
  analyzeTokenAlignment,
  tokenizeForAlignment,
};

/**
 * B2 — Literal-text precedence.
 *
 * Returns `true` when the element has a case-insensitive EXACT match
 * between `needle` and any of its identifying signals: id, labelText,
 * ariaLabel, textContent, title, placeholder, value, name. These are the
 * same sources `scoreTextMatch` already probes, just compared without
 * fuzzy weighting.
 *
 * Used to bypass fuzzy/alias scoring when the user typed a literal label
 * or id. Without this gate, alias-noise (`04`, `tsx`, `pg`, `tab`) used
 * to pull elements ahead of the literal match — e.g. "Decompose" landing
 * on `productivity.plan-list` instead of `productivity.decompose-plan-button`.
 *
 * Internal — exported only for the unit tests in `find.test.ts` /
 * `search-engine.test.ts`.
 */
function elementMatchesLiteral(searchable: SearchableElement, needle: string): boolean {
  const n = needle.toLowerCase().trim();
  if (n.length === 0) return false;
  // Candidate sources to compare. textContent is included even though it
  // may carry runs of whitespace — `.trim()` is enough for the common case
  // of a button whose textContent is "Decompose\n" or " Decompose ".
  const sources: Array<string | undefined> = [
    searchable.id,
    searchable.labelText,
    searchable.ariaLabel,
    searchable.textContent,
    searchable.title,
    searchable.placeholder,
    searchable.value,
    searchable.name,
  ];
  for (const s of sources) {
    if (!s) continue;
    if (s.toLowerCase() === n) return true;
    if (s.trim().toLowerCase() === n) return true;
  }
  return false;
}

/**
 * Internal — expose `elementMatchesLiteral` (and a public probe) for
 * `find.ts`, which needs to run literal-match against the ORIGINAL query
 * string before decomposition. The decomposer strips synonym words like
 * "button" / "tab" from queries that happen to be literal ids
 * (e.g. `productivity.decompose-plan-button`), so a search-engine-level
 * probe against `criteria.text` would miss those cases.
 *
 * Returns ids of every cached element whose identifying signals match
 * `needle` exactly (case-insensitive). Order is the engine's cache order;
 * callers that need ranking should call `search()`.
 *
 * @internal
 */
export function probeLiteralMatches(engine: SearchEngine, needle: string): string[] {
  // `cachedElements` is private; we read it through a typed escape hatch
  // rather than promoting the field to public because the cache invariants
  // are owned by the engine. The cast is `unknown` → typed to keep the
  // boundary explicit.
  const cached = (engine as unknown as { cachedElements: SearchableElement[] }).cachedElements;
  const out: string[] = [];
  for (const el of cached) {
    if (elementMatchesLiteral(el, needle)) out.push(el.id);
  }
  return out;
}

/**
 * Configuration for the search engine
 */
export interface SearchEngineConfig {
  /** Default fuzzy threshold */
  fuzzyThreshold: number;
  /** Weight for text matching */
  textWeight: number;
  /** Weight for accessibility matching */
  accessibilityWeight: number;
  /** Weight for role matching */
  roleWeight: number;
  /** Weight for spatial matching */
  spatialWeight: number;
  /** Weight for alias matching */
  aliasWeight: number;
  /** Maximum results to return */
  maxResults: number;
  /** Include hidden elements */
  includeHidden: boolean;
}

/**
 * Default search engine configuration
 */
export const DEFAULT_SEARCH_CONFIG: SearchEngineConfig = {
  fuzzyThreshold: 0.7,
  textWeight: 0.35,
  accessibilityWeight: 0.25,
  roleWeight: 0.15,
  spatialWeight: 0.1,
  aliasWeight: 0.15,
  maxResults: 20,
  includeHidden: false,
};

/**
 * Internal element representation for search
 */
interface SearchableElement {
  id: string;
  element: DiscoveredElement | RegisteredElement;
  state: ElementState;
  textContent?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  placeholder?: string;
  title?: string;
  role?: string;
  tagName: string;
  type: string;
  aliases: string[];
  description: string;
  rect: ElementState['rect'];
  labelText?: string;
  value?: string;
  /** `name` attribute (form fields) */
  name?: string;
  /** Nearest semantic container (e.g., "form[login-form]", "dialog", "nav") */
  parentContext?: string;
}

/**
 * Search Engine class
 */
export class SearchEngine {
  private config: SearchEngineConfig;
  private cachedElements: SearchableElement[] = [];
  private cacheTimestamp: number = 0;
  private readonly cacheValidityMs = 100; // Cache valid for 100ms

  constructor(config: Partial<SearchEngineConfig> = {}) {
    this.config = { ...DEFAULT_SEARCH_CONFIG, ...config };
  }

  /**
   * Update cached elements from various sources
   */
  updateElements(
    elements: Array<DiscoveredElement | RegisteredElement>,
    getState?: (el: RegisteredElement) => ElementState
  ): void {
    this.cachedElements = elements.map((el) => this.toSearchable(el, getState));
    this.cacheTimestamp = Date.now();
  }

  /**
   * Peek at the engine's current cache of {id, type} pairs.
   *
   * Used by callers like `find.ts` that need to know whether a given
   * element-type guess is even present in the cached page before deciding to
   * relax type-pinned criteria. Returns a copy so callers can iterate freely
   * without affecting the engine's internal state — and never exposes the
   * full `SearchableElement` shape so we don't leak internal scoring helpers
   * across the module boundary.
   */
  getCachedElementSummaries(): Array<{ id: string; type: string }> {
    return this.cachedElements.map((el) => ({ id: el.id, type: el.type }));
  }

  /**
   * Convert an element to searchable format
   */
  private toSearchable(
    element: DiscoveredElement | RegisteredElement,
    getState?: (el: RegisteredElement) => ElementState
  ): SearchableElement {
    // Get state depending on element type
    let state: ElementState;
    let textContent: string | undefined;
    let tagName: string;
    let role: string | undefined;
    let ariaLabel: string | undefined;
    let placeholder: string | undefined;
    let title: string | undefined;
    let labelText: string | undefined;
    let value: string | undefined;
    let name: string | undefined;

    if ('getState' in element && typeof element.getState === 'function') {
      // RegisteredElement — prefer getState() data over direct DOM queries
      // to be resilient when DOM refs are stale or inaccessible
      state = getState ? getState(element) : element.getState();
      textContent = state.textContent || undefined;

      // Safely extract DOM attributes with fallbacks
      try {
        tagName = element.element.tagName.toLowerCase();
      } catch {
        tagName = element.type || 'unknown';
      }

      try {
        role = element.element.getAttribute('role') || undefined;
        ariaLabel = readAriaLabelAttr(element.element) || undefined;
        placeholder = readPlaceholderAttr(element.element) || undefined;
        title = readTitleAttr(element.element) || undefined;
        name = element.element.getAttribute('name') || undefined;
      } catch {
        // DOM access failed — use fallbacks from RegisteredElement metadata
      }

      // Use registered label as labelText
      if (!ariaLabel && element.label) {
        ariaLabel = element.label;
      }

      try {
        if (element.element.id) {
          const labelEl = document.querySelector(`label[for="${element.element.id}"]`);
          labelText = readScrubbedText(labelEl) || undefined;
        }
        // Fall back to a wrapping <label> ancestor if no explicit `for=` match
        if (!labelText) {
          let ancestor: HTMLElement | null = element.element.parentElement;
          while (ancestor) {
            if (ancestor.tagName.toLowerCase() === 'label') {
              labelText = readScrubbedText(ancestor) || undefined;
              break;
            }
            ancestor = ancestor.parentElement;
          }
        }
      } catch {
        // label query failed
      }
      if (!labelText && element.label) {
        labelText = element.label;
      }

      // Use label as textContent fallback — ensures search can match by label
      if (!textContent && element.label) {
        textContent = element.label;
      }

      // Get value for inputs
      try {
        if (
          element.element instanceof HTMLInputElement ||
          element.element instanceof HTMLTextAreaElement ||
          element.element instanceof HTMLSelectElement
        ) {
          value = readScrubbedValue(element.element as HTMLInputElement) || undefined;
        }
      } catch {
        value = state.value || undefined;
      }
    } else {
      // DiscoveredElement
      const discovered = element as DiscoveredElement;
      state = discovered.state;
      textContent = state.textContent || undefined;
      tagName = discovered.tagName;
      role = discovered.role || undefined;
      ariaLabel = discovered.accessibleName || undefined;
      // Use label property if available and no other label source
      if (!labelText && (element as { label?: string }).label) {
        labelText = (element as { label?: string }).label;
      }
    }

    // §4.6 SINGLE CHOKE POINT. Every `criteria.*` scoring branch AND
    // `toAIDiscoveredElement` read from the fields below, so gating them HERE
    // closes both the EMISSION and the confirmation ORACLE by construction — a
    // scoring branch added later is safe without touching it. CONTENT axis
    // nulls descriptive text and skips DOM-derived alias generation; VALUE axis
    // nulls the entered value. Developer-SET aliases are re-merged below (the
    // documented boundary). The verdict comes from the live element
    // (RegisteredElement) or the stamped `state.redaction` (DiscoveredElement
    // crosses the wire with no DOM ref) — NEVER by sniffing the forgeable
    // sentinel.
    const redactionVerdict: RedactionVerdict =
      'getState' in element && typeof element.getState === 'function'
        ? verdictOf((element as RegisteredElement).element)
        : verdictFromState(state);
    if (redactionVerdict.content) {
      // `ariaLabel` becomes the accessibleName EMITTED for the element, so a
      // present name collapses to the SENTINEL (present-but-hidden — consistent
      // with the serialize/materialize projections), which ALSO can't confirm a
      // secret guess when matched. The secondary text channels are DROPPED
      // entirely (the per-site contract), and `textContent`/`name` are nulled so
      // no DOM-derived alias or score survives.
      ariaLabel = scrubContentByVerdict(ariaLabel, redactionVerdict);
      placeholder = undefined;
      title = undefined;
      labelText = undefined;
      name = undefined;
      textContent = undefined;
    }
    if (redactionVerdict.value) {
      value = undefined;
    }

    // Generate aliases and description. §4.6 by-construction gate: the
    // GENERATED (DOM-derived) portion routes through the `scrubAliases` minter
    // (→ `[]` when content-redacted, else branded), replacing the open-coded
    // `content ? [] : generate` ternary that carried no compile tripwire.
    // Developer-SET aliases merge back below (documented boundary exemption).
    let aliases: string[] = scrubAliases(
      generateAliases({
        textContent,
        ariaLabel,
        placeholder,
        title,
        elementType: element.type,
        tagName,
        id: element.id,
        labelText,
        value,
      }),
      redactionVerdict
    );

    // Merge pre-computed aliases from RegisteredElement if available
    if ('aliases' in element && Array.isArray(element.aliases) && element.aliases.length > 0) {
      const aliasSet = new Set([
        ...aliases,
        ...element.aliases.map((a: string) => a.toLowerCase()),
      ]);
      aliases = [...aliasSet];
    }

    let description = generateDescription({
      textContent,
      ariaLabel,
      placeholder,
      title,
      elementType: element.type,
      tagName,
      id: element.id,
      labelText,
    });

    // Use pre-computed description from RegisteredElement if available
    if (!description && 'description' in element && element.description) {
      description = element.description as string;
    }

    // Merge annotation overrides into searchable data
    const annotation = getGlobalAnnotationStore().get(element.id);
    if (annotation) {
      if (annotation.description) {
        description = annotation.description;
      }
      if (annotation.tags && annotation.tags.length > 0) {
        // Merge tags into aliases
        const tagSet = new Set([...aliases, ...annotation.tags.map((t) => t.toLowerCase())]);
        aliases = [...tagSet];
      }
      if (annotation.notes) {
        // Make notes searchable by adding as an alias
        aliases.push(annotation.notes.toLowerCase());
      }
    }

    // Resolve parent context (nearest semantic container)
    const parentContext = this.resolveParentContext(element);

    // Infer icon meaning for icon-only buttons and add to aliases. Skipped for
    // a content-redacted element — its nulled text/label would otherwise let
    // this re-populate `textContent`/`aliases` and re-open the projection.
    const iconAliases = redactionVerdict.content ? [] : this.inferIconAliases(element);
    if (iconAliases.length > 0 && !textContent && !ariaLabel) {
      const aliasSet = new Set([...aliases, ...iconAliases]);
      aliases = [...aliasSet];
      // Use the first icon alias as textContent for matching
      if (!textContent) {
        textContent = iconAliases[0];
      }
    }

    return {
      id: element.id,
      element,
      state,
      textContent,
      ariaLabel,
      placeholder,
      title,
      role,
      tagName,
      type: element.type,
      aliases,
      description,
      rect: state.rect,
      labelText,
      value,
      name,
      parentContext,
    };
  }

  /**
   * Search for elements matching the criteria
   */
  search(
    criteria: SearchCriteria,
    elements?: Array<DiscoveredElement | RegisteredElement>
  ): SearchResponse {
    const startTime = performance.now();

    // Update cache if elements provided or cache expired
    if (elements) {
      this.updateElements(elements);
    }

    // Filter visible elements if needed
    let searchableElements = this.cachedElements;
    if (!this.config.includeHidden && !criteria.fuzzy) {
      searchableElements = searchableElements.filter((el) => el.state.visible);
    }

    // -------------------------------------------------------------------
    // Diagnostic instrumentation — gated on UI_BRIDGE_DEBUG_FIND === '1'.
    // Permanent affordance for triaging /ui-bridge/ai/find empty-result
    // cases. Two surfaces:
    //   1) `console.debug('[ui-bridge:find] ...')` — visible in the
    //      webview devtools console and (if a log-forwarding plugin is
    //      installed) the host stderr.
    //   2) `globalThis.__UI_BRIDGE_LAST_FIND_DIAGNOSTIC__` — last
    //      diagnostic payload, readable via /control/page/evaluate. This
    //      is the reliable path on Tauri runners where webview console is
    //      not piped to stderr.
    // We collect pre-score state up front, then update with scored data
    // after the scoring loop completes.
    // -------------------------------------------------------------------
    const debugEnabled = isFindDebugEnabled();
    let candidateElementsForDebug:
      | Array<{ id: string; type: string; labelText?: string; ariaLabel?: string }>
      | undefined;
    let allScoredForDebug:
      | Array<{ id: string; confidence: number; scores: SearchResult['scores'] }>
      | undefined;
    if (debugEnabled) {
      const criteriaTypeLower = criteria.type?.toLowerCase();
      candidateElementsForDebug = this.cachedElements
        .filter((el) => {
          const idHit = el.id.toLowerCase().includes('advanced');
          const typeHit = criteriaTypeLower ? el.type.toLowerCase() === criteriaTypeLower : false;
          return idHit || typeHit;
        })
        .map((el) => ({
          id: el.id,
          type: el.type,
          labelText: truncForDebug(el.labelText),
          ariaLabel: truncForDebug(el.ariaLabel),
        }));
      allScoredForDebug = [];
      try {
        console.debug('[ui-bridge:find] cachedElements.length=', this.cachedElements.length);
        console.debug(
          '[ui-bridge:find] searchableElements.length (post visibility filter)=',
          searchableElements.length
        );
        console.debug('[ui-bridge:find] criteria=', JSON.stringify(criteria));
        console.debug(
          '[ui-bridge:find] candidateElements=',
          JSON.stringify(candidateElementsForDebug)
        );
      } catch {
        // logging never blocks the search
      }
    }

    // --------------------------------------------------------------------
    // B2 — Literal-text precedence pass.
    //
    // Probe every cached element for an EXACT (case-insensitive) match on
    // the user-supplied literal (`text` / `textContent` / `accessibleName`)
    // against id / labelText / ariaLabel / textContent / title /
    // placeholder / value / name. Two outcomes:
    //
    //   1. `strict: true` — fast-path that returns ONLY exact matches.
    //      No fuzzy / alias scoring runs. Empty array when no element
    //      matches literally.
    //   2. `strict: false` (default) — exact matches are collected and
    //      assigned a strong base score (1.0) so they outrank alias-only
    //      candidates. Non-exact-match elements still run through the
    //      normal scoring loop below; both sets are merged at the end.
    //
    // The literal probe is intentionally narrow: only the user-supplied
    // text fields participate. Spatial (`near`) / containment (`within`) /
    // role / type are still honoured by the regular scoring path, so
    // `find("Decompose")` on a page with two buttons named "Decompose"
    // still returns both candidates (each at 1.0) and lets find.ts
    // surface the ambiguity.
    // --------------------------------------------------------------------
    const literalNeedles: string[] = [];
    if (typeof criteria.text === 'string' && criteria.text.length > 0) {
      literalNeedles.push(criteria.text);
    }
    if (
      typeof criteria.textContent === 'string' &&
      criteria.textContent.length > 0 &&
      !literalNeedles.includes(criteria.textContent)
    ) {
      literalNeedles.push(criteria.textContent);
    }
    if (
      typeof criteria.accessibleName === 'string' &&
      criteria.accessibleName.length > 0 &&
      !literalNeedles.includes(criteria.accessibleName)
    ) {
      literalNeedles.push(criteria.accessibleName);
    }

    const exactMatches: SearchResult[] = [];
    const exactMatchIds = new Set<string>();
    if (literalNeedles.length > 0) {
      for (const searchable of searchableElements) {
        const hit = literalNeedles.some((n) => elementMatchesLiteral(searchable, n));
        if (!hit) continue;
        // Run the regular scorer too so we keep the rich match-reasons
        // (e.g. "exact aria-label match", "exact name match") — but
        // override the confidence to 1.0 so an exact literal hit can't
        // be dragged down by, e.g., a role mismatch that contributes
        // weight but score=0.
        const scored = this.scoreElement(searchable, criteria);
        const reasons = [
          `exact literal match: "${literalNeedles[0]}"`,
          ...scored.matchReasons,
        ];
        exactMatches.push({
          element: scored.element,
          confidence: 1.0,
          matchReasons: reasons,
          // Carry the scorer's per-strategy breakdown so callers that
          // introspect `scores` still see the source breakdown; but lift
          // text to 1.0 to reflect the literal-precedence outcome.
          scores: { ...scored.scores, text: 1.0 },
        });
        exactMatchIds.add(searchable.id);
      }
    }

    // Strict mode: return ONLY the exact-match candidates. No fuzzy
    // fallback at all — callers that opt in (`?strict=true` on /ai/find,
    // or `strict: true` in SearchCriteria) get a guaranteed-literal
    // answer or empty.
    if (criteria.strict === true) {
      exactMatches.sort((a, b) => b.confidence - a.confidence);
      const strictLimited = exactMatches.slice(0, this.config.maxResults);
      return {
        results: strictLimited,
        bestMatch: strictLimited.length > 0 ? strictLimited[0] : null,
        scannedCount: searchableElements.length,
        durationMs: performance.now() - startTime,
        criteria,
        timestamp: Date.now(),
      };
    }

    // Score each element. Skip elements that were already collected as
    // exact matches — re-scoring them through the fuzzy path is wasted
    // work AND would mean the fuzzy score (almost always < 1.0) replaces
    // their literal 1.0 in the results array.
    const results: SearchResult[] = [...exactMatches];

    for (const searchable of searchableElements) {
      if (exactMatchIds.has(searchable.id)) continue;
      const result = this.scoreElement(searchable, criteria);
      if (debugEnabled && allScoredForDebug && result.confidence > 0) {
        allScoredForDebug.push({
          id: searchable.id,
          confidence: result.confidence,
          scores: result.scores,
        });
      }
      if (result.confidence >= (criteria.fuzzyThreshold ?? this.config.fuzzyThreshold)) {
        results.push(result);
      }
    }

    // Sort by confidence
    results.sort((a, b) => b.confidence - a.confidence);

    // Limit results
    const limitedResults = results.slice(0, this.config.maxResults);

    if (debugEnabled && allScoredForDebug && candidateElementsForDebug) {
      const topScored = allScoredForDebug
        .slice()
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 5);

      // Registry-instance fingerprinting. The runner has historically shown
      // a divergence between `/control/snapshot` (which iterates the React
      // context's `bridge.registry`) and `/ui-bridge/ai/find` (which reads
      // `getGlobalRegistry()`). When the two paths return different element
      // counts, the most likely explanation is that they're talking to
      // *different registry instances* — multiple bundles each with their
      // own module-level `globalRegistry` singleton.
      //
      // We collect every reachable registry instance's tag here so a single
      // /ai/find call paints the full map.
      let registryTags:
        | {
            getGlobalRegistryTag: string | null;
            windowProvidersTag: string | null;
            windowProvidersHasRegistry: boolean;
            allWindowTags: Array<{ source: string; tag: string }>;
          }
        | undefined;
      try {
        const tags: Array<{ source: string; tag: string }> = [];
        let getGlobalRegistryTag: string | null = null;
        try {
          const reg = getGlobalRegistry() as unknown as { __instanceTag?: string };
          if (reg && typeof reg.__instanceTag === 'string') {
            getGlobalRegistryTag = reg.__instanceTag;
            tags.push({ source: 'getGlobalRegistry()', tag: reg.__instanceTag });
          }
        } catch {
          // getGlobalRegistry() may throw in unusual sandbox contexts; treat as null.
        }

        // The provider exposes itself on `window.__UI_BRIDGE__` via
        // exposeProviderOnWindow. We don't currently put the registry there
        // directly, but if it ever appears we want the diagnostic to surface
        // it. Walk the well-known global to find any UIBridgeRegistry-shaped
        // object and capture its tag.
        let windowProvidersTag: string | null = null;
        let windowProvidersHasRegistry = false;
        try {
          const w = (globalThis as { __UI_BRIDGE__?: Record<string, unknown> }).__UI_BRIDGE__;
          if (w && typeof w === 'object') {
            const candidate = (w as { registry?: { __instanceTag?: string } }).registry;
            if (candidate && typeof candidate.__instanceTag === 'string') {
              windowProvidersHasRegistry = true;
              windowProvidersTag = candidate.__instanceTag;
              tags.push({
                source: 'globalThis.__UI_BRIDGE__.registry',
                tag: candidate.__instanceTag,
              });
            }
          }
        } catch {
          // window walk failed — leave defaults.
        }
        registryTags = {
          getGlobalRegistryTag,
          windowProvidersTag,
          windowProvidersHasRegistry,
          allWindowTags: tags,
        };
      } catch {
        // Tag collection never blocks the search.
      }

      const diagnostic = {
        cachedElementsLength: this.cachedElements.length,
        searchableElementsLength: searchableElements.length,
        candidateElements: candidateElementsForDebug,
        topScored,
        criteria,
        threshold: criteria.fuzzyThreshold ?? this.config.fuzzyThreshold,
        resultsAboveThreshold: limitedResults.length,
        registryTags,
        timestamp: Date.now(),
      };
      try {
        console.debug('[ui-bridge:find] topScored=', JSON.stringify(topScored));
      } catch {
        // logging never blocks
      }
      // Side-channel: store on globalThis so /control/page/evaluate can
      // read the last diagnostic payload without requiring webview console
      // capture. This is the primary read-out path on Tauri runners.
      try {
        (
          globalThis as { __UI_BRIDGE_LAST_FIND_DIAGNOSTIC__?: unknown }
        ).__UI_BRIDGE_LAST_FIND_DIAGNOSTIC__ = diagnostic;
      } catch {
        // globalThis assign should never throw; swallow defensively
      }
    }

    return {
      results: limitedResults,
      bestMatch: limitedResults.length > 0 ? limitedResults[0] : null,
      scannedCount: searchableElements.length,
      durationMs: performance.now() - startTime,
      criteria,
      timestamp: Date.now(),
    };
  }

  /**
   * Find the best matching element
   */
  findBest(
    criteria: SearchCriteria,
    elements?: Array<DiscoveredElement | RegisteredElement>
  ): SearchResult | null {
    const response = this.search(criteria, elements);
    return response.bestMatch;
  }

  /**
   * Find elements by text content
   */
  findByText(
    text: string,
    fuzzy: boolean = true,
    elements?: Array<DiscoveredElement | RegisteredElement>
  ): SearchResult[] {
    return this.search({ text, fuzzy }, elements).results;
  }

  /**
   * Find elements by role
   */
  findByRole(
    role: string,
    name?: string,
    elements?: Array<DiscoveredElement | RegisteredElement>
  ): SearchResult[] {
    const criteria: SearchCriteria = { role };
    if (name) {
      criteria.accessibleName = name;
    }
    return this.search(criteria, elements).results;
  }

  /**
   * Find elements by accessible name
   */
  findByAccessibleName(
    name: string,
    elements?: Array<DiscoveredElement | RegisteredElement>
  ): SearchResult[] {
    return this.search({ accessibleName: name, fuzzy: true }, elements).results;
  }

  /**
   * Find elements near another element
   */
  findNear(
    referenceId: string,
    criteria?: SearchCriteria,
    elements?: Array<DiscoveredElement | RegisteredElement>
  ): SearchResult[] {
    return this.search({ ...criteria, near: referenceId }, elements).results;
  }

  /**
   * Find elements within a container
   */
  findWithin(
    containerId: string,
    criteria?: SearchCriteria,
    elements?: Array<DiscoveredElement | RegisteredElement>
  ): SearchResult[] {
    return this.search({ ...criteria, within: containerId }, elements).results;
  }

  /**
   * Score an element against search criteria
   */
  private scoreElement(searchable: SearchableElement, criteria: SearchCriteria): SearchResult {
    const scores: SearchResult['scores'] = {};
    const matchReasons: string[] = [];
    let totalWeight = 0;
    let weightedScore = 0;
    // Best token-alignment verdict seen across the text-bearing criteria.
    // `null` means the caller supplied no text criterion at all, in which case
    // there is nothing to align against and the cap below must not fire —
    // a structured `{ role: 'button' }` search is not an unaligned match.
    let textAlignment: TokenAlignmentKind | null = null;

    const fuzzyConfig = {
      ...DEFAULT_FUZZY_CONFIG,
      threshold: criteria.fuzzyThreshold ?? this.config.fuzzyThreshold,
    };

    // ----------------------------------------------------------------------
    // B2 — Dilution-safe scoring while preserving "user-supplied criteria
    // is a real constraint" semantics.
    //
    // The scoring helpers below already pick the *max* across populated
    // source fields (label/aria/placeholder/text/value/name) so multiple
    // sources don't dilute each other internally. The dilution problem the
    // plan calls out is between scoring *branches*: the alias-only bonus
    // path, plus type matching, were the only branches that previously
    // contributed weight ONLY when matched, while the primary text /
    // textContent / accessibleName / role / spatial branches added weight
    // unconditionally on the primary criteria's presence — so an element
    // that scored 0 against `criteria.text` "spent" 0.35 of its weight on
    // nothing.
    //
    // The compromise applied here:
    //   - Primary criteria branches (text, textContent, textContains,
    //     accessibleName, role, spatial) STILL count their full weight
    //     even when score=0. Pinning a text query and getting zero text
    //     match is a real signal — we should not let an element claim
    //     full confidence purely on a synonym-alias bonus when the user
    //     asked for literal text. This preserves the legacy semantics for
    //     `textContains: "Save"` against a `Submit` button (alias-only
    //     match should not dominate a literal text match).
    //   - The bonus branches (alias, type) and source-conditional branches
    //     (placeholder, title, idPattern) keep their existing behavior of
    //     only contributing weight on a positive score; no regression risk.
    // The actual long-label vs short-label "dilution" the plan worried
    // about lives inside `scoreTextMatch`, which already takes the max
    // over populated sources — so a long label that happens to have more
    // attributes set does NOT pile on additional text-source weight. The
    // B3 token-prefix boost above is what closes the long-label-loses
    // concern in practice; the dilution-safe gating below is restricted to
    // bonus branches to avoid breaking alias-driven recall.
    // ----------------------------------------------------------------------

    // Text matching
    if (criteria.text) {
      const textScore = this.scoreTextMatch(
        searchable,
        criteria.text,
        criteria.fuzzy !== false,
        fuzzyConfig.threshold
      );
      scores.text = textScore.score;
      textAlignment = strongerAlignment(textAlignment, textScore.alignment);
      if (textScore.score > 0) {
        matchReasons.push(...textScore.reasons);
      }
      weightedScore += textScore.score * this.config.textWeight;
      totalWeight += this.config.textWeight;
    }

    // textContent uses both exact and contains matching (best score wins)
    // This is more intuitive for spec assertions where textContent checks
    // if the text is present in the element, not necessarily the entire text.
    // Supports pipe-separated alternatives: "Connected|Disconnected" matches either.
    if (criteria.textContent && !criteria.text) {
      // Split on pipe to support alternatives (e.g., "Connected|Disconnected")
      const alternatives = criteria.textContent.includes('|')
        ? criteria.textContent
            .split('|')
            .map((s) => s.trim())
            .filter(Boolean)
        : [criteria.textContent];

      let bestScore = 0;
      let bestReasons: string[] = [];

      for (const alt of alternatives) {
        const exactScore = this.scoreTextMatch(
          searchable,
          alt,
          criteria.fuzzy !== false,
          fuzzyConfig.threshold
        );
        const containsScore = this.scoreContainsMatch(searchable, alt, criteria.fuzzy !== false);
        // Any ONE alternative aligning is enough — `"Connected|Disconnected"`
        // is satisfied by either side, so the best verdict across the
        // alternatives is the honest one.
        textAlignment = strongerAlignment(
          textAlignment,
          containsScore.score > exactScore.score ? 'all-tokens-present' : exactScore.alignment
        );
        const altBest = Math.max(exactScore.score, containsScore.score);
        if (altBest > bestScore) {
          bestScore = altBest;
          bestReasons =
            exactScore.score >= containsScore.score ? exactScore.reasons : containsScore.reasons;
        }
      }

      scores.text = bestScore;
      if (bestScore > 0) {
        matchReasons.push(...bestReasons);
      }
      weightedScore += bestScore * this.config.textWeight;
      totalWeight += this.config.textWeight;
    }

    // Partial text matching (contains)
    if (criteria.textContains) {
      const containsScore = this.scoreContainsMatch(
        searchable,
        criteria.textContains,
        criteria.fuzzy !== false
      );
      scores.text = Math.max(scores.text || 0, containsScore.score);
      if (containsScore.score > 0 && containsScore.reasons.length > 0) {
        matchReasons.push(...containsScore.reasons);
      }
      weightedScore += containsScore.score * this.config.textWeight;
      totalWeight += this.config.textWeight;
    }

    // Accessible name matching
    if (criteria.accessibleName) {
      const accessibilityScore = this.scoreAccessibilityMatch(
        searchable,
        criteria.accessibleName,
        criteria.fuzzy !== false,
        fuzzyConfig.threshold
      );
      scores.accessibility = accessibilityScore.score;
      if (accessibilityScore.score > 0) {
        matchReasons.push(...accessibilityScore.reasons);
      }
      weightedScore += accessibilityScore.score * this.config.accessibilityWeight;
      totalWeight += this.config.accessibilityWeight;
    }

    // Role matching
    if (criteria.role) {
      const roleScore = this.scoreRoleMatch(searchable, criteria.role);
      scores.role = roleScore.score;
      if (roleScore.score > 0) {
        matchReasons.push(...roleScore.reasons);
      }
      weightedScore += roleScore.score * this.config.roleWeight;
      totalWeight += this.config.roleWeight;
    }

    // Type matching
    if (criteria.type) {
      const typeMatch = searchable.type.toLowerCase() === criteria.type.toLowerCase();
      if (typeMatch) {
        matchReasons.push(`type: ${criteria.type}`);
        weightedScore += 1.0 * this.config.roleWeight;
        totalWeight += this.config.roleWeight;
      }
    }

    // Spatial matching (near)
    if (criteria.near) {
      const spatialScore = this.scoreSpatialMatch(searchable, criteria.near);
      scores.spatial = spatialScore.score;
      if (spatialScore.score > 0) {
        matchReasons.push(...spatialScore.reasons);
      }
      weightedScore += spatialScore.score * this.config.spatialWeight;
      totalWeight += this.config.spatialWeight;
    }

    // Placeholder matching
    if (criteria.placeholder && searchable.placeholder) {
      const placeholderResult = fuzzyMatch(
        searchable.placeholder,
        criteria.placeholder,
        fuzzyConfig
      );
      if (placeholderResult.isMatch) {
        matchReasons.push(`placeholder matches`);
        weightedScore += placeholderResult.similarity * this.config.textWeight;
        totalWeight += this.config.textWeight;
      }
    }

    // Title matching
    if (criteria.title && searchable.title) {
      const titleResult = fuzzyMatch(searchable.title, criteria.title, fuzzyConfig);
      if (titleResult.isMatch) {
        matchReasons.push(`title matches`);
        weightedScore += titleResult.similarity * this.config.textWeight;
        totalWeight += this.config.textWeight;
      }
    }

    // ID pattern matching
    if (criteria.idPattern) {
      const idMatch = this.matchPattern(searchable.id, criteria.idPattern);
      if (idMatch) {
        matchReasons.push(`id matches pattern`);
        weightedScore += 1.0 * this.config.textWeight;
        totalWeight += this.config.textWeight;
      }
    }

    // Within/containment matching (hard filter + small bonus)
    if (criteria.within) {
      const containmentScore = this.scoreContainmentMatch(searchable, criteria.within);
      if (containmentScore.score === 0) {
        // Hard filter: element is NOT inside the specified container — reject
        const aiElement = this.toAIDiscoveredElement(searchable);
        return { element: aiElement, confidence: 0, matchReasons: [], scores: {} };
      }
      matchReasons.push(...containmentScore.reasons);
      // Containment is primarily a filter; add a small scoring bonus
      weightedScore += 0.1;
      totalWeight += 0.1;
    }

    // Alias matching (always applied as a bonus)
    const aliasScore = this.scoreAliasMatch(searchable, criteria, fuzzyConfig.threshold);
    if (aliasScore.score > 0) {
      scores.fuzzy = aliasScore.score;
      matchReasons.push(...aliasScore.reasons);
      weightedScore += aliasScore.score * this.config.aliasWeight;
      totalWeight += this.config.aliasWeight;
    }

    // Calculate final confidence
    let confidence = totalWeight > 0 ? weightedScore / totalWeight : 0;

    // ALIGNMENT IS A GATE, NOT ONLY A REWARD.
    //
    // The weighted average above can be carried over the threshold by branches
    // that know nothing about whether the query's words are answered here —
    // synonym/alias weight most of all. When the winning text evidence was
    // `partial` or `none`, cap the result below the 0.5 default
    // `confidenceThreshold` so it cannot be reported as a find. See
    // `UNALIGNED_CONFIDENCE_CAP`.
    if (
      textAlignment !== null &&
      (textAlignment === 'partial' || textAlignment === 'none') &&
      confidence > UNALIGNED_CONFIDENCE_CAP
    ) {
      matchReasons.push(
        `capped at ${(UNALIGNED_CONFIDENCE_CAP * 100).toFixed(0)}%: query tokens ${
          textAlignment === 'partial' ? 'only partially align' : 'do not align'
        } with this element`
      );
      confidence = UNALIGNED_CONFIDENCE_CAP;
    }

    // Convert to AIDiscoveredElement
    const aiElement = this.toAIDiscoveredElement(searchable);

    return {
      element: aiElement,
      confidence,
      // B2 — display-only dedupe. The synonym branch of `scoreAliasMatch`
      // pushes one reason per (searchWord x aliasWord) hit, so the same pair
      // could be listed several times and read like term-frequency inflation.
      // Scoring is unaffected: every alias branch accumulates with `Math.max`.
      matchReasons: [...new Set(matchReasons)],
      scores,
    };
  }

  /**
   * Score text match.
   *
   * Probes multiple element-side signals so that form inputs with no visible
   * text content can still be located by their identifying attributes.
   * Each source has a weight that establishes precedence:
   *   label (1.00) > aria-label (0.95) > placeholder (0.90) > text (1.00) > name (0.80)
   * The final per-element score is `bestSimilarity * sourceWeight` taken across
   * all sources — i.e., best-matching signal wins, with weaker sources slightly
   * down-ranked so a weak `name` match cannot beat a strong placeholder match.
   */
  private scoreTextMatch(
    searchable: SearchableElement,
    text: string,
    fuzzy: boolean,
    threshold: number
  ): { score: number; reasons: string[]; alignment: TokenAlignmentKind } {
    const reasons: string[] = [];
    let maxScore = 0;
    // Best alignment verdict across every source, computed independently of
    // which scoring arm wins. Carried out so `scoreElement` can CAP the final
    // confidence when the query's tokens never lined up with this element —
    // see `UNALIGNED_CONFIDENCE_CAP`. `none` is the starting value and
    // therefore also the honest answer when no source matched at all.
    let alignment: TokenAlignmentKind = 'none';

    // Source weight establishes precedence when multiple signals match.
    // textContent stays at 1.00 to preserve the original behaviour where
    // visible text is treated as the primary signal.
    const sources: Array<{ value: string | undefined; label: string; weight: number }> = [
      { value: searchable.labelText, label: 'label', weight: 1.0 },
      { value: searchable.ariaLabel, label: 'aria-label', weight: 0.95 },
      { value: searchable.placeholder, label: 'placeholder', weight: 0.9 },
      { value: searchable.textContent, label: 'text', weight: 1.0 },
      { value: searchable.value, label: 'value', weight: 1.0 },
      { value: searchable.name, label: 'name', weight: 0.8 },
    ];

    for (const { value: targetText, label: sourceLabel, weight } of sources) {
      if (!targetText) continue;

      // The alignment verdict is computed for EVERY source, independently of
      // which scoring arm ends up winning. That independence is the point: the
      // fuzzy and word-similarity arms score generously across whole phrases
      // ("Export Report" scores 92% against "Export Warehouse"), so letting a
      // high score imply good alignment would put the gate back where it was.
      const tokenAnalysis = analyzeTokenAlignment(text, targetText);
      alignment = strongerAlignment(alignment, tokenAnalysis.kind);

      // TYPO TOLERANCE MUST SURVIVE THE GATE. The ladder above is exact-substring
      // based, so a misspelling ("Sumbit Buton") aligns as `none` even though the
      // user clearly named this element. Re-ask the same question fuzzily, but
      // only when the exact answer would have capped — this is the expensive arm
      // and it can only ever improve the verdict.
      if (
        fuzzy &&
        tokenAnalysis.kind !== 'prefix-aligned' &&
        tokenAnalysis.kind !== 'all-tokens-present'
      ) {
        alignment = strongerAlignment(alignment, analyzeFuzzyTokenCoverage(text, targetText));
      }

      // Exact match
      if (targetText.toLowerCase() === text.toLowerCase()) {
        const score = 1.0 * weight;
        if (score > maxScore) {
          maxScore = score;
          reasons.push(`exact ${sourceLabel} match`);
        }
        continue;
      }

      // Fuzzy match
      if (fuzzy) {
        const result = fuzzyMatch(targetText, text, { threshold });
        if (result.isMatch) {
          const score = result.similarity * weight;
          if (score > maxScore) {
            maxScore = score;
            reasons.push(`${sourceLabel} similarity: ${(result.similarity * 100).toFixed(0)}%`);
          }
        }

        // Word-level match — useful when the query is a single token like
        // "prompt" and the target is a longer phrase like "Prompt input".
        const wordSim = wordSimilarity(targetText, text, { threshold });
        if (wordSim >= threshold) {
          const score = wordSim * weight;
          if (score > maxScore) {
            maxScore = score;
            reasons.push(`${sourceLabel} word match: ${(wordSim * 100).toFixed(0)}%`);
          }
        }

        // B3 — Graduated substring/token-prefix scoring.
        //
        // A single 0.85 contains-score conflated three very different
        // structural relationships between query and target:
        //   1. "Advanced" → "Advanced: per-stage controls" — every query
        //      token prefix-aligns with a target token. Strongest signal:
        //      the user's keyword introduces the target. → 0.95.
        //   2. "per stage" → "Advanced: per-stage controls" — every query
        //      token appears somewhere in the target, but not all as
        //      prefixes. Solid signal. → 0.85.
        //   3. "xyz advanced" → "Advanced: per-stage controls" — only some
        //      query tokens appear; the others are unrelated noise. Weak
        //      signal that should still beat outright misses but lose to
        //      cleaner matches. → 0.7.
        // Punctuation is stripped from tokens (`Advanced:` → `advanced`)
        // so a label that ends a heading with `:` or `.` still aligns.
        if (tokenAnalysis.kind !== 'none') {
          const baseScore =
            tokenAnalysis.kind === 'prefix-aligned'
              ? 0.95
              : tokenAnalysis.kind === 'all-tokens-present'
                ? 0.85
                : 0.7;
          const score = baseScore * weight;
          if (score > maxScore) {
            maxScore = score;
            reasons.push(
              `${sourceLabel} ${tokenAnalysis.kind === 'prefix-aligned' ? 'prefix-aligns' : tokenAnalysis.kind === 'all-tokens-present' ? 'contains all tokens of' : 'partially contains'} "${text}"`
            );
          }
        } else if (targetText.toLowerCase().includes(text.toLowerCase())) {
          // Fallback: literal-substring match that didn't tokenize cleanly
          // (e.g., the query is a single contiguous chunk inside a longer
          // word). Treat as the legacy "contains" signal.
          const score = 0.85 * weight;
          if (score > maxScore) {
            maxScore = score;
            reasons.push(`${sourceLabel} contains "${text}"`);
          }
          // A literal substring hit IS full coverage of the query, even when
          // the tokenizer could not line the two up (the query is a contiguous
          // chunk inside one longer word).
          alignment = strongerAlignment(alignment, 'all-tokens-present');
        }
      }
    }

    return { score: maxScore, reasons, alignment };
  }

  /**
   * Score contains match
   */
  private scoreContainsMatch(
    searchable: SearchableElement,
    text: string,
    fuzzy: boolean
  ): { score: number; reasons: string[] } {
    const reasons: string[] = [];
    let maxScore = 0;

    const textsToMatch = [
      searchable.textContent,
      searchable.labelText,
      searchable.ariaLabel,
    ].filter(Boolean) as string[];

    for (const targetText of textsToMatch) {
      // Exact contains
      if (targetText.toLowerCase().includes(text.toLowerCase())) {
        maxScore = Math.max(maxScore, 0.9);
        reasons.push('text contains match');
        continue;
      }

      // Fuzzy contains
      if (fuzzy && fuzzyContains(targetText, text)) {
        maxScore = Math.max(maxScore, 0.7);
        reasons.push('fuzzy contains match');
      }
    }

    return { score: maxScore, reasons };
  }

  /**
   * Score accessibility match
   */
  private scoreAccessibilityMatch(
    searchable: SearchableElement,
    name: string,
    fuzzy: boolean,
    threshold: number
  ): { score: number; reasons: string[] } {
    const reasons: string[] = [];
    let maxScore = 0;

    const accessibleNames = [
      searchable.ariaLabel,
      searchable.ariaLabelledBy,
      searchable.labelText,
      searchable.title,
    ].filter(Boolean) as string[];

    for (const accessibleName of accessibleNames) {
      // Exact match
      if (accessibleName.toLowerCase() === name.toLowerCase()) {
        maxScore = Math.max(maxScore, 1.0);
        reasons.push('exact accessible name match');
        continue;
      }

      // Fuzzy match
      if (fuzzy) {
        const result = fuzzyMatch(accessibleName, name, { threshold });
        if (result.isMatch && result.similarity > maxScore) {
          maxScore = result.similarity;
          reasons.push(`accessible name similarity: ${(result.similarity * 100).toFixed(0)}%`);
        }
      }
    }

    return { score: maxScore, reasons };
  }

  /**
   * Score role match
   */
  private scoreRoleMatch(
    searchable: SearchableElement,
    role: string
  ): { score: number; reasons: string[] } {
    const reasons: string[] = [];
    const normalizedRole = role.toLowerCase();

    // Direct role match
    if (searchable.role?.toLowerCase() === normalizedRole) {
      return { score: 1.0, reasons: [`role: ${role}`] };
    }

    // Tag-based role inference
    const tagRoleMap: Record<string, string[]> = {
      button: ['button', 'input[type=button]', 'input[type=submit]'],
      textbox: ['input', 'textarea'],
      checkbox: ['input[type=checkbox]'],
      radio: ['input[type=radio]'],
      link: ['a'],
      listbox: ['select'],
      combobox: ['select', 'input[list]'],
      navigation: ['nav'],
      main: ['main'],
      heading: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
    };

    const inferredRoles = tagRoleMap[normalizedRole] || [];
    if (
      inferredRoles.some(
        (r) => searchable.tagName === r || searchable.type.toLowerCase() === normalizedRole
      )
    ) {
      return { score: 0.8, reasons: [`inferred role: ${role}`] };
    }

    return { score: 0, reasons };
  }

  /**
   * Score spatial match (proximity to another element)
   */
  private scoreSpatialMatch(
    searchable: SearchableElement,
    nearId: string
  ): { score: number; reasons: string[] } {
    // Find the reference element
    const reference = this.cachedElements.find((el) => el.id === nearId);
    if (!reference) {
      return { score: 0, reasons: [] };
    }

    // Calculate distance between elements
    const distance = this.calculateDistance(searchable.rect, reference.rect);

    // Score based on distance (closer = higher score)
    // Assuming 200px as "near" threshold
    const nearThreshold = 200;
    if (distance > nearThreshold * 3) {
      return { score: 0, reasons: [] };
    }

    const score = Math.max(0, 1 - distance / (nearThreshold * 3));
    return {
      score,
      reasons: [`${distance.toFixed(0)}px from ${nearId}`],
    };
  }

  /**
   * Calculate distance between two element rectangles
   */
  private calculateDistance(rect1: ElementState['rect'], rect2: ElementState['rect']): number {
    const center1 = {
      x: rect1.x + rect1.width / 2,
      y: rect1.y + rect1.height / 2,
    };
    const center2 = {
      x: rect2.x + rect2.width / 2,
      y: rect2.y + rect2.height / 2,
    };

    return Math.sqrt(Math.pow(center1.x - center2.x, 2) + Math.pow(center1.y - center2.y, 2));
  }

  /**
   * Score alias match
   */
  private scoreAliasMatch(
    searchable: SearchableElement,
    criteria: SearchCriteria,
    threshold: number
  ): { score: number; reasons: string[] } {
    const reasons: string[] = [];
    let maxScore = 0;

    // Build search terms from criteria
    const searchTerms: string[] = [];
    if (criteria.text) searchTerms.push(criteria.text);
    if (criteria.textContains) searchTerms.push(criteria.textContains);
    if (criteria.accessibleName) searchTerms.push(criteria.accessibleName);

    for (const searchTerm of searchTerms) {
      const termLower = searchTerm.toLowerCase();

      for (const alias of searchable.aliases) {
        // Exact alias match
        if (alias === termLower) {
          maxScore = Math.max(maxScore, 1.0);
          reasons.push(`alias match: "${alias}"`);
          continue;
        }

        // Synonym match
        const searchWords = termLower.split(/\s+/);
        const aliasWords = alias.split(/\s+/);

        for (const searchWord of searchWords) {
          for (const aliasWord of aliasWords) {
            if (areSynonyms(searchWord, aliasWord)) {
              maxScore = Math.max(maxScore, 0.85);
              reasons.push(`synonym match: "${searchWord}" ~ "${aliasWord}"`);
            }
          }
        }

        // Fuzzy alias match
        const result = fuzzyMatch(alias, termLower, { threshold });
        if (result.isMatch && result.similarity > maxScore) {
          maxScore = result.similarity;
          reasons.push(`fuzzy alias: "${alias}" (${(result.similarity * 100).toFixed(0)}%)`);
        }

        // Token similarity
        const tokenSim = tokenSimilarity(alias, termLower);
        if (tokenSim > maxScore && tokenSim >= threshold) {
          maxScore = tokenSim;
          reasons.push(`token match: "${alias}"`);
        }
      }
    }

    return { score: maxScore, reasons };
  }

  /**
   * Score containment match (is this element inside the specified container?)
   */
  private scoreContainmentMatch(
    searchable: SearchableElement,
    containerId: string
  ): { score: number; reasons: string[] } {
    // 1. Check parentContext string
    if (searchable.parentContext) {
      const ctx = searchable.parentContext.toLowerCase();
      if (ctx.includes(containerId.toLowerCase()) || containerId.toLowerCase().includes(ctx)) {
        return { score: 1.0, reasons: [`inside ${searchable.parentContext}`] };
      }
    }

    // 2. Try DOM containment if we have access to the actual elements
    const container = this.cachedElements.find((el) => el.id === containerId);
    if (container) {
      // Try actual DOM containment
      try {
        if ('getState' in searchable.element && 'getState' in container.element) {
          const containerEl = (container.element as RegisteredElement).element;
          const targetEl = (searchable.element as RegisteredElement).element;
          if (containerEl && targetEl && containerEl.contains(targetEl)) {
            return { score: 1.0, reasons: [`DOM child of ${containerId}`] };
          }
        }
      } catch {
        // DOM access failed, fall through to spatial check
      }

      // 3. Spatial containment fallback (element rect inside container rect)
      const cRect = container.rect;
      const eRect = searchable.rect;
      if (
        eRect.x >= cRect.x - 5 &&
        eRect.y >= cRect.y - 5 &&
        eRect.x + eRect.width <= cRect.x + cRect.width + 5 &&
        eRect.y + eRect.height <= cRect.y + cRect.height + 5
      ) {
        return { score: 0.8, reasons: [`spatially within ${containerId}`] };
      }
    }

    // 4. Check if the element's parentContext mentions the container by text match
    // (container might not be in the cache but the parentContext string might reference it)
    const containerLower = containerId.toLowerCase();
    if (searchable.parentContext) {
      const contextLower = searchable.parentContext.toLowerCase();
      for (const part of containerLower.split(/[\s-_]+/)) {
        if (part.length > 2 && contextLower.includes(part)) {
          return { score: 0.6, reasons: [`parent context partially matches ${containerId}`] };
        }
      }
    }

    return { score: 0, reasons: [] };
  }

  /**
   * Resolve the nearest semantic container for an element.
   * Walks up the DOM tree looking for forms, dialogs, nav, sections, etc.
   */
  private resolveParentContext(element: DiscoveredElement | RegisteredElement): string | undefined {
    try {
      let el: HTMLElement | null = null;

      if ('getState' in element && typeof element.getState === 'function') {
        el = (element as RegisteredElement).element;
      }
      if (!el) return undefined;

      let ancestor = el.parentElement;
      while (ancestor) {
        const role = ancestor.getAttribute('role');
        const tag = ancestor.tagName.toLowerCase();

        // Check for semantic containers
        const isContainer =
          role === 'dialog' ||
          role === 'alertdialog' ||
          role === 'form' ||
          role === 'navigation' ||
          role === 'region' ||
          role === 'group' ||
          role === 'tabpanel' ||
          role === 'toolbar' ||
          role === 'complementary' ||
          tag === 'form' ||
          tag === 'nav' ||
          tag === 'section' ||
          tag === 'aside' ||
          tag === 'dialog' ||
          tag === 'details' ||
          tag === 'fieldset' ||
          tag === 'main' ||
          tag === 'header' ||
          tag === 'footer';

        if (isContainer) {
          // §4.6: `parentContext` is emitted AND scored (`criteria.within`), so
          // an ancestor label from inside a redaction boundary leaks both ways.
          // Suppress the label there — the STRUCTURE (role/tag) survives.
          const label = isContentRedacted(ancestor)
            ? ''
            : readAriaLabelAttr(ancestor) ||
              ancestor.getAttribute('data-testid') ||
              ancestor.id ||
              '';
          return label ? `${role || tag}[${label}]` : role || tag;
        }

        ancestor = ancestor.parentElement;
      }
    } catch {
      // DOM access failed
    }

    return undefined;
  }

  /**
   * Known icon class patterns → semantic meaning
   */
  private static readonly ICON_CLASS_MAP: Record<string, string[]> = {
    close: [
      'close',
      'x-mark',
      'times',
      'dismiss',
      'lucide-x',
      'fa-times',
      'mdi-close',
      'ri-close-line',
      'icon-x',
    ],
    delete: [
      'trash',
      'delete',
      'remove',
      'lucide-trash',
      'fa-trash',
      'mdi-delete',
      'ri-delete-bin',
    ],
    edit: ['edit', 'pencil', 'pen', 'lucide-pencil', 'fa-edit', 'mdi-pencil', 'ri-edit'],
    search: ['search', 'magnify', 'lucide-search', 'fa-search', 'mdi-magnify', 'ri-search'],
    menu: ['menu', 'hamburger', 'bars', 'lucide-menu', 'fa-bars', 'mdi-menu', 'ri-menu'],
    more: ['more', 'dots', 'ellipsis', 'lucide-more', 'fa-ellipsis', 'mdi-dots', 'ri-more'],
    add: ['plus', 'add', 'lucide-plus', 'fa-plus', 'mdi-plus', 'ri-add'],
    back: [
      'arrow-left',
      'chevron-left',
      'back',
      'lucide-arrow-left',
      'fa-arrow-left',
      'ri-arrow-left',
    ],
    forward: ['arrow-right', 'chevron-right', 'forward', 'lucide-arrow-right', 'ri-arrow-right'],
    expand: ['chevron-down', 'expand', 'caret-down', 'lucide-chevron-down', 'fa-caret-down'],
    collapse: ['chevron-up', 'collapse', 'caret-up', 'lucide-chevron-up', 'fa-caret-up'],
    settings: ['gear', 'cog', 'settings', 'lucide-settings', 'fa-cog', 'mdi-cog', 'ri-settings'],
    info: ['info', 'circle-info', 'lucide-info', 'fa-info-circle', 'ri-information'],
    warning: [
      'warning',
      'alert-triangle',
      'exclamation',
      'lucide-alert-triangle',
      'fa-exclamation-triangle',
    ],
    copy: ['copy', 'clipboard', 'lucide-copy', 'fa-copy', 'mdi-content-copy', 'ri-file-copy'],
    download: ['download', 'lucide-download', 'fa-download', 'mdi-download', 'ri-download'],
    upload: ['upload', 'lucide-upload', 'fa-upload', 'mdi-upload', 'ri-upload'],
    refresh: ['refresh', 'reload', 'rotate', 'lucide-refresh-cw', 'fa-sync', 'mdi-refresh'],
    save: ['save', 'floppy', 'lucide-save', 'fa-save', 'mdi-content-save'],
    home: ['home', 'house', 'lucide-home', 'fa-home', 'mdi-home', 'ri-home'],
    user: ['user', 'person', 'avatar', 'lucide-user', 'fa-user', 'mdi-account', 'ri-user'],
    lock: ['lock', 'lucide-lock', 'fa-lock', 'mdi-lock', 'ri-lock'],
    unlock: ['unlock', 'lucide-unlock', 'fa-unlock', 'mdi-lock-open'],
    star: ['star', 'favorite', 'lucide-star', 'fa-star', 'mdi-star', 'ri-star'],
    heart: ['heart', 'like', 'lucide-heart', 'fa-heart', 'mdi-heart'],
    filter: ['filter', 'funnel', 'lucide-filter', 'fa-filter', 'mdi-filter', 'ri-filter'],
    sort: ['sort', 'lucide-arrow-up-down', 'fa-sort', 'mdi-sort'],
    share: ['share', 'lucide-share', 'fa-share', 'mdi-share', 'ri-share'],
    play: ['play', 'lucide-play', 'fa-play', 'mdi-play', 'ri-play'],
    pause: ['pause', 'lucide-pause', 'fa-pause', 'mdi-pause', 'ri-pause'],
    stop: ['stop', 'square', 'lucide-square', 'fa-stop', 'mdi-stop'],
  };

  /**
   * Infer aliases from icon CSS classes for icon-only elements.
   */
  private inferIconAliases(element: DiscoveredElement | RegisteredElement): string[] {
    try {
      let el: HTMLElement | null = null;
      if ('getState' in element && typeof element.getState === 'function') {
        el = (element as RegisteredElement).element;
      }
      if (!el) return [];

      // Collect classes from the element and its direct icon children
      const classSource = [Array.from(el.classList).join(' ')];
      const iconChild = el.querySelector('svg, [class*="icon"], i[class]');
      if (iconChild) {
        classSource.push(Array.from(iconChild.classList).join(' '));
      }

      const allClasses = classSource.join(' ').toLowerCase();
      if (!allClasses) return [];

      const foundAliases: string[] = [];
      for (const [meaning, patterns] of Object.entries(SearchEngine.ICON_CLASS_MAP)) {
        if (patterns.some((p) => allClasses.includes(p))) {
          foundAliases.push(meaning);
        }
      }
      return foundAliases;
    } catch {
      return [];
    }
  }

  /**
   * Match a string against a pattern (supports * wildcard)
   */
  private matchPattern(str: string, pattern: string): boolean {
    const regexPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*');
    return new RegExp(`^${regexPattern}$`, 'i').test(str);
  }

  /**
   * Convert searchable element to AI discovered element
   */
  private toAIDiscoveredElement(searchable: SearchableElement): AIDiscoveredElement {
    // The searchable fields are ALREADY gated by `toSearchable` (the choke
    // point). Route them through the branded minters for the wire slot: the
    // verdict comes from the stamped state (DOM-less-safe). `accessibleName`
    // (`searchable.ariaLabel`) is content-scrubbed; `label` scrubs on the
    // CONTENT axis regardless of origin (resolved design decision) via
    // `scrubContentByVerdict`; `aliases` are already gated in `toSearchable`
    // (generated portion emptied via `scrubAliases` when redacted, dev-set
    // survive), so what remains is trusted and branded wholesale.
    const verdict = verdictFromState(searchable.state);
    const discoveredBase: DiscoveredElement =
      'getState' in searchable.element
        ? {
            id: searchable.id,
            type: searchable.type,
            label: scrubContentByVerdict((searchable.element as RegisteredElement).label, verdict),
            tagName: searchable.tagName,
            role: searchable.role,
            accessibleName: scrubContentByVerdict(searchable.ariaLabel, verdict),
            actions: (searchable.element as RegisteredElement).actions,
            state: searchable.state,
            registered: true,
          }
        : (searchable.element as DiscoveredElement);

    return {
      ...discoveredBase,
      description: scrubContentRequired(searchable.description, verdict),
      aliases: searchable.aliases.map((a) => trustDeveloperContent(a)),
      purpose: generatePurpose({
        textContent: searchable.textContent,
        ariaLabel: searchable.ariaLabel,
        elementType: searchable.type,
        tagName: searchable.tagName,
      }),
      parentContext: searchable.parentContext,
      suggestedActions: generateSuggestedActions({
        textContent: searchable.textContent,
        ariaLabel: searchable.ariaLabel,
        elementType: searchable.type,
        tagName: searchable.tagName,
      }),
      semanticType: this.inferSemanticType(searchable),
      labelText: searchable.labelText,
      placeholder: searchable.placeholder,
      title: searchable.title,
    };
  }

  /**
   * Infer a semantic type for the element
   */
  private inferSemanticType(searchable: SearchableElement): string {
    const text = (searchable.textContent || searchable.ariaLabel || '').toLowerCase();
    const type = searchable.type.toLowerCase();

    // Form-related
    if (type === 'input' || type === 'textarea') {
      if (searchable.placeholder?.toLowerCase().includes('email') || text.includes('email')) {
        return 'email-input';
      }
      if (searchable.placeholder?.toLowerCase().includes('password') || text.includes('password')) {
        return 'password-input';
      }
      if (searchable.placeholder?.toLowerCase().includes('search') || text.includes('search')) {
        return 'search-input';
      }
      return 'text-input';
    }

    // Button types
    if (type === 'button') {
      if (text.match(/submit|save|confirm|ok|done|apply/)) return 'submit-button';
      if (text.match(/cancel|close|dismiss/)) return 'cancel-button';
      if (text.match(/delete|remove|trash/)) return 'delete-button';
      if (text.match(/add|create|new|\+/)) return 'add-button';
      if (text.match(/edit|modify/)) return 'edit-button';
      if (text.match(/next|continue/)) return 'next-button';
      if (text.match(/back|previous/)) return 'back-button';
      return 'action-button';
    }

    // Navigation
    if (type === 'link') {
      if (text.match(/home|dashboard/)) return 'home-link';
      if (text.match(/login|sign.?in/)) return 'login-link';
      if (text.match(/logout|sign.?out/)) return 'logout-link';
      return 'navigation-link';
    }

    return type;
  }
}

/**
 * Create a default search engine instance
 */
export function createSearchEngine(config?: Partial<SearchEngineConfig>): SearchEngine {
  return new SearchEngine(config);
}
