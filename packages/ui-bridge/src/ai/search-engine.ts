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
        ariaLabel = element.element.getAttribute('aria-label') || undefined;
        placeholder = element.element.getAttribute('placeholder') || undefined;
        title = element.element.getAttribute('title') || undefined;
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
          labelText = labelEl?.textContent?.trim() || undefined;
        }
        // Fall back to a wrapping <label> ancestor if no explicit `for=` match
        if (!labelText) {
          let ancestor: HTMLElement | null = element.element.parentElement;
          while (ancestor) {
            if (ancestor.tagName.toLowerCase() === 'label') {
              labelText = ancestor.textContent?.trim() || undefined;
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
          value = (element.element as HTMLInputElement).value || undefined;
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

    // Generate aliases and description
    let aliases = generateAliases({
      textContent,
      ariaLabel,
      placeholder,
      title,
      elementType: element.type,
      tagName,
      id: element.id,
      labelText,
      value,
    });

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

    // Infer icon meaning for icon-only buttons and add to aliases
    const iconAliases = this.inferIconAliases(element);
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

    // Score each element
    const results: SearchResult[] = [];

    for (const searchable of searchableElements) {
      const result = this.scoreElement(searchable, criteria);
      if (result.confidence >= (criteria.fuzzyThreshold ?? this.config.fuzzyThreshold)) {
        results.push(result);
      }
    }

    // Sort by confidence
    results.sort((a, b) => b.confidence - a.confidence);

    // Limit results
    const limitedResults = results.slice(0, this.config.maxResults);

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

    const fuzzyConfig = {
      ...DEFAULT_FUZZY_CONFIG,
      threshold: criteria.fuzzyThreshold ?? this.config.fuzzyThreshold,
    };

    // Text matching
    if (criteria.text) {
      const textScore = this.scoreTextMatch(
        searchable,
        criteria.text,
        criteria.fuzzy !== false,
        fuzzyConfig.threshold
      );
      scores.text = textScore.score;
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
    const confidence = totalWeight > 0 ? weightedScore / totalWeight : 0;

    // Convert to AIDiscoveredElement
    const aiElement = this.toAIDiscoveredElement(searchable);

    return {
      element: aiElement,
      confidence,
      matchReasons,
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
  ): { score: number; reasons: string[] } {
    const reasons: string[] = [];
    let maxScore = 0;

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

        // Substring/contains check — placeholders and labels are often
        // sentence-shaped ("What would you like to do?") while queries are
        // a single keyword. `wordSimilarity` requires reasonable token overlap;
        // a literal substring is a strong signal even when overlap is low.
        if (targetText.toLowerCase().includes(text.toLowerCase())) {
          // Slightly under-weight contains vs. exact/fuzzy to avoid false
          // positives where the query is one common word.
          const score = 0.85 * weight;
          if (score > maxScore) {
            maxScore = score;
            reasons.push(`${sourceLabel} contains "${text}"`);
          }
        }
      }
    }

    return { score: maxScore, reasons };
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
          const label =
            ancestor.getAttribute('aria-label') ||
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
    const discoveredBase: DiscoveredElement =
      'getState' in searchable.element
        ? {
            id: searchable.id,
            type: searchable.type,
            label: (searchable.element as RegisteredElement).label,
            tagName: searchable.tagName,
            role: searchable.role,
            accessibleName: searchable.ariaLabel,
            actions: (searchable.element as RegisteredElement).actions,
            state: searchable.state,
            registered: true,
          }
        : (searchable.element as DiscoveredElement);

    return {
      ...discoveredBase,
      description: searchable.description,
      aliases: searchable.aliases,
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
