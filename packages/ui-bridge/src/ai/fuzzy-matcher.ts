/**
 * Fuzzy Matcher
 *
 * Provides fuzzy text matching utilities for finding elements by natural language descriptions.
 * Implements multiple matching algorithms with configurable thresholds.
 */

/**
 * Configuration for fuzzy matching
 */
export interface FuzzyMatchConfig {
  /** Minimum similarity threshold (0-1) */
  threshold: number;
  /** Weight for Levenshtein distance */
  levenshteinWeight: number;
  /** Weight for Jaro-Winkler similarity */
  jaroWinklerWeight: number;
  /** Weight for N-gram matching */
  ngramWeight: number;
  /** N-gram size */
  ngramSize: number;
  /** Case sensitive matching */
  caseSensitive: boolean;
  /** Ignore whitespace differences */
  ignoreWhitespace: boolean;
}

/**
 * Default fuzzy match configuration
 */
export const DEFAULT_FUZZY_CONFIG: FuzzyMatchConfig = {
  threshold: 0.7,
  levenshteinWeight: 0.3,
  jaroWinklerWeight: 0.4,
  ngramWeight: 0.3,
  ngramSize: 2,
  caseSensitive: false,
  ignoreWhitespace: true,
};

/**
 * Result from a fuzzy match operation
 */
export interface FuzzyMatchResult {
  /** Overall similarity score (0-1) */
  similarity: number;
  /** Whether the match passes the threshold */
  isMatch: boolean;
  /** Individual algorithm scores */
  scores: {
    levenshtein: number;
    jaroWinkler: number;
    ngram: number;
  };
  /** Normalized source string */
  normalizedSource: string;
  /** Normalized target string */
  normalizedTarget: string;
}

/**
 * Calculate Levenshtein distance between two strings
 */
export function levenshteinDistance(s1: string, s2: string): number {
  const len1 = s1.length;
  const len2 = s2.length;

  // Create distance matrix
  const matrix: number[][] = Array(len1 + 1)
    .fill(null)
    .map(() => Array(len2 + 1).fill(0));

  // Initialize first column and row
  for (let i = 0; i <= len1; i++) matrix[i][0] = i;
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;

  // Fill in the rest of the matrix
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return matrix[len1][len2];
}

/**
 * Calculate Levenshtein similarity (0-1)
 */
export function levenshteinSimilarity(s1: string, s2: string): number {
  if (s1.length === 0 && s2.length === 0) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;

  const distance = levenshteinDistance(s1, s2);
  const maxLength = Math.max(s1.length, s2.length);

  return 1 - distance / maxLength;
}

/**
 * Calculate Jaro similarity between two strings
 */
export function jaroSimilarity(s1: string, s2: string): number {
  if (s1.length === 0 && s2.length === 0) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;

  const matchDistance = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  const s1Matches = new Array(s1.length).fill(false);
  const s2Matches = new Array(s2.length).fill(false);

  let matches = 0;
  let transpositions = 0;

  // Find matches
  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, s2.length);

    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  // Count transpositions
  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  return (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3;
}

/**
 * Calculate Jaro-Winkler similarity
 * Gives more weight to strings that match from the beginning
 */
export function jaroWinklerSimilarity(s1: string, s2: string, prefixScale: number = 0.1): number {
  const jaroSim = jaroSimilarity(s1, s2);

  // Find common prefix (up to 4 characters)
  let prefixLength = 0;
  const maxPrefix = Math.min(4, Math.min(s1.length, s2.length));

  for (let i = 0; i < maxPrefix; i++) {
    if (s1[i] === s2[i]) {
      prefixLength++;
    } else {
      break;
    }
  }

  return jaroSim + prefixLength * prefixScale * (1 - jaroSim);
}

/**
 * Generate N-grams from a string
 */
export function generateNgrams(s: string, n: number): Set<string> {
  const ngrams = new Set<string>();

  if (s.length < n) {
    ngrams.add(s);
    return ngrams;
  }

  for (let i = 0; i <= s.length - n; i++) {
    ngrams.add(s.substring(i, i + n));
  }

  return ngrams;
}

/**
 * Calculate N-gram similarity (Jaccard coefficient)
 */
export function ngramSimilarity(s1: string, s2: string, n: number = 2): number {
  if (s1.length === 0 && s2.length === 0) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;

  const ngrams1 = generateNgrams(s1, n);
  const ngrams2 = generateNgrams(s2, n);

  // Calculate intersection
  let intersection = 0;
  for (const ngram of ngrams1) {
    if (ngrams2.has(ngram)) {
      intersection++;
    }
  }

  // Jaccard coefficient: |A ∩ B| / |A ∪ B|
  const union = ngrams1.size + ngrams2.size - intersection;

  return union === 0 ? 0 : intersection / union;
}

/**
 * Normalize a string for comparison
 */
export function normalizeString(s: string, config: Partial<FuzzyMatchConfig> = {}): string {
  let normalized = s;

  // Handle case sensitivity
  if (!config.caseSensitive) {
    normalized = normalized.toLowerCase();
  }

  // Handle whitespace
  if (config.ignoreWhitespace !== false) {
    normalized = normalized.replace(/\s+/g, ' ').trim();
  }

  return normalized;
}

/**
 * Main fuzzy match function
 * Combines multiple algorithms for robust matching
 */
export function fuzzyMatch(
  source: string,
  target: string,
  config: Partial<FuzzyMatchConfig> = {}
): FuzzyMatchResult {
  const finalConfig = { ...DEFAULT_FUZZY_CONFIG, ...config };

  // Normalize strings
  const normalizedSource = normalizeString(source, finalConfig);
  const normalizedTarget = normalizeString(target, finalConfig);

  // Calculate individual scores
  const levenshteinScore = levenshteinSimilarity(normalizedSource, normalizedTarget);
  const jaroWinklerScore = jaroWinklerSimilarity(normalizedSource, normalizedTarget);
  const ngramScore = ngramSimilarity(normalizedSource, normalizedTarget, finalConfig.ngramSize);

  // Weighted combination
  const similarity =
    levenshteinScore * finalConfig.levenshteinWeight +
    jaroWinklerScore * finalConfig.jaroWinklerWeight +
    ngramScore * finalConfig.ngramWeight;

  return {
    similarity,
    isMatch: similarity >= finalConfig.threshold,
    scores: {
      levenshtein: levenshteinScore,
      jaroWinkler: jaroWinklerScore,
      ngram: ngramScore,
    },
    normalizedSource,
    normalizedTarget,
  };
}

/**
 * Find the best match from a list of candidates
 */
export function findBestMatch(
  source: string,
  candidates: string[],
  config: Partial<FuzzyMatchConfig> = {}
): { match: string | null; index: number; result: FuzzyMatchResult | null } {
  if (candidates.length === 0) {
    return { match: null, index: -1, result: null };
  }

  let bestMatch: string | null = null;
  let bestIndex = -1;
  let bestResult: FuzzyMatchResult | null = null;

  for (let i = 0; i < candidates.length; i++) {
    const result = fuzzyMatch(source, candidates[i], config);

    if (result.isMatch && (!bestResult || result.similarity > bestResult.similarity)) {
      bestMatch = candidates[i];
      bestIndex = i;
      bestResult = result;
    }
  }

  return { match: bestMatch, index: bestIndex, result: bestResult };
}

/**
 * Find all matches above threshold
 */
export function findAllMatches(
  source: string,
  candidates: string[],
  config: Partial<FuzzyMatchConfig> = {}
): Array<{ candidate: string; index: number; result: FuzzyMatchResult }> {
  const matches: Array<{ candidate: string; index: number; result: FuzzyMatchResult }> = [];

  for (let i = 0; i < candidates.length; i++) {
    const result = fuzzyMatch(source, candidates[i], config);

    if (result.isMatch) {
      matches.push({ candidate: candidates[i], index: i, result });
    }
  }

  // Sort by similarity descending
  matches.sort((a, b) => b.result.similarity - a.result.similarity);

  return matches;
}

/**
 * Check if source contains target (fuzzy)
 */
export function fuzzyContains(
  source: string,
  target: string,
  config: Partial<FuzzyMatchConfig> = {}
): boolean {
  const finalConfig = { ...DEFAULT_FUZZY_CONFIG, ...config };
  const normalizedSource = normalizeString(source, finalConfig);
  const normalizedTarget = normalizeString(target, finalConfig);

  // Exact contains check
  if (normalizedSource.includes(normalizedTarget)) {
    return true;
  }

  // Word-by-word fuzzy check
  const sourceWords = normalizedSource.split(/\s+/);
  const targetWords = normalizedTarget.split(/\s+/);

  // All target words must have a fuzzy match in source
  for (const targetWord of targetWords) {
    const hasMatch = sourceWords.some((sourceWord) => {
      const result = fuzzyMatch(sourceWord, targetWord, { ...finalConfig, threshold: 0.8 });
      return result.isMatch;
    });

    if (!hasMatch) {
      return false;
    }
  }

  return true;
}

/**
 * Calculate word-level similarity
 * Useful for comparing phrases
 */
export function wordSimilarity(
  s1: string,
  s2: string,
  config: Partial<FuzzyMatchConfig> = {}
): number {
  const finalConfig = { ...DEFAULT_FUZZY_CONFIG, ...config };
  const words1 = normalizeString(s1, finalConfig).split(/\s+/);
  const words2 = normalizeString(s2, finalConfig).split(/\s+/);

  if (words1.length === 0 && words2.length === 0) return 1;
  if (words1.length === 0 || words2.length === 0) return 0;

  let totalSimilarity = 0;
  let matchCount = 0;

  // For each word in s1, find best match in s2
  for (const word1 of words1) {
    let bestSim = 0;
    for (const word2 of words2) {
      const result = fuzzyMatch(word1, word2, finalConfig);
      if (result.similarity > bestSim) {
        bestSim = result.similarity;
      }
    }
    totalSimilarity += bestSim;
    if (bestSim >= finalConfig.threshold) {
      matchCount++;
    }
  }

  // Return combination of average similarity and match ratio
  const avgSimilarity = totalSimilarity / words1.length;
  const matchRatio = matchCount / Math.max(words1.length, words2.length);

  return avgSimilarity * 0.5 + matchRatio * 0.5;
}

/**
 * Tokenize a string for matching
 * Handles camelCase, PascalCase, snake_case, kebab-case
 */
export function tokenize(s: string): string[] {
  return s
    // Split camelCase and PascalCase
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    // Split snake_case and kebab-case
    .replace(/[_-]/g, ' ')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .split(' ')
    .filter((token) => token.length > 0);
}

/**
 * Calculate token-based similarity
 * Better for matching identifiers and labels
 */
export function tokenSimilarity(s1: string, s2: string): number {
  const tokens1 = tokenize(s1);
  const tokens2 = tokenize(s2);

  if (tokens1.length === 0 && tokens2.length === 0) return 1;
  if (tokens1.length === 0 || tokens2.length === 0) return 0;

  const set1 = new Set(tokens1);
  const set2 = new Set(tokens2);

  // Calculate Jaccard similarity on tokens
  let intersection = 0;
  for (const token of set1) {
    if (set2.has(token)) {
      intersection++;
    }
  }

  const union = set1.size + set2.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
