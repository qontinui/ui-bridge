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

    if ('getState' in element && typeof element.getState === 'function') {
      // RegisteredElement
      state = getState ? getState(element) : element.getState();
      textContent = state.textContent || undefined;
      tagName = element.element.tagName.toLowerCase();
      role = element.element.getAttribute('role') || undefined;
      ariaLabel = element.element.getAttribute('aria-label') || undefined;
      placeholder = element.element.getAttribute('placeholder') || undefined;
      title = element.element.getAttribute('title') || undefined;

      // Get associated label
      if (element.element.id) {
        const labelEl = document.querySelector(`label[for="${element.element.id}"]`);
        labelText = labelEl?.textContent?.trim() || undefined;
      }

      // Get value for inputs
      if (
        element.element instanceof HTMLInputElement ||
        element.element instanceof HTMLTextAreaElement ||
        element.element instanceof HTMLSelectElement
      ) {
        value = (element.element as HTMLInputElement).value || undefined;
      }
    } else {
      // DiscoveredElement
      const discovered = element as DiscoveredElement;
      state = discovered.state;
      textContent = state.textContent || undefined;
      tagName = discovered.tagName;
      role = discovered.role || undefined;
      ariaLabel = discovered.accessibleName || undefined;
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
   * Score text match
   */
  private scoreTextMatch(
    searchable: SearchableElement,
    text: string,
    fuzzy: boolean,
    threshold: number
  ): { score: number; reasons: string[] } {
    const reasons: string[] = [];
    let maxScore = 0;

    const textsToMatch = [searchable.textContent, searchable.labelText, searchable.value].filter(
      Boolean
    ) as string[];

    for (const targetText of textsToMatch) {
      // Exact match
      if (targetText.toLowerCase() === text.toLowerCase()) {
        maxScore = Math.max(maxScore, 1.0);
        reasons.push('exact text match');
        continue;
      }

      // Fuzzy match
      if (fuzzy) {
        const result = fuzzyMatch(targetText, text, { threshold });
        if (result.isMatch && result.similarity > maxScore) {
          maxScore = result.similarity;
          reasons.push(`text similarity: ${(result.similarity * 100).toFixed(0)}%`);
        }

        // Word-level match
        const wordSim = wordSimilarity(targetText, text, { threshold });
        if (wordSim > maxScore && wordSim >= threshold) {
          maxScore = wordSim;
          reasons.push(`word match: ${(wordSim * 100).toFixed(0)}%`);
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
      parentContext: undefined, // Would need DOM traversal
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
