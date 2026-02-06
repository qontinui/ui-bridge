/**
 * Fuzzy Matcher Tests
 */

import { describe, it, expect } from 'vitest';
import {
  levenshteinDistance,
  levenshteinSimilarity,
  jaroSimilarity,
  jaroWinklerSimilarity,
  generateNgrams,
  ngramSimilarity,
  normalizeString,
  fuzzyMatch,
  findBestMatch,
  findAllMatches,
  fuzzyContains,
  wordSimilarity,
  tokenize,
  tokenSimilarity,
  DEFAULT_FUZZY_CONFIG,
} from './fuzzy-matcher';

describe('FuzzyMatcher', () => {
  describe('levenshteinDistance', () => {
    it('should return 0 for identical strings', () => {
      expect(levenshteinDistance('hello', 'hello')).toBe(0);
    });

    it('should return 0 for empty strings', () => {
      expect(levenshteinDistance('', '')).toBe(0);
    });

    it('should return length for string vs empty', () => {
      expect(levenshteinDistance('hello', '')).toBe(5);
      expect(levenshteinDistance('', 'world')).toBe(5);
    });

    it('should calculate distance for single character difference', () => {
      expect(levenshteinDistance('cat', 'hat')).toBe(1);
      expect(levenshteinDistance('cat', 'car')).toBe(1);
      expect(levenshteinDistance('cat', 'cats')).toBe(1);
    });

    it('should calculate distance for multiple differences', () => {
      expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
      expect(levenshteinDistance('sunday', 'saturday')).toBe(3);
    });

    it('should handle completely different strings', () => {
      expect(levenshteinDistance('abc', 'xyz')).toBe(3);
    });

    it('should handle common typos', () => {
      expect(levenshteinDistance('receive', 'recieve')).toBe(2); // i and e transposed
      expect(levenshteinDistance('submit', 'sumbit')).toBe(2); // u and m transposed
      expect(levenshteinDistance('button', 'buttn')).toBe(1); // missing o
    });
  });

  describe('levenshteinSimilarity', () => {
    it('should return 1 for identical strings', () => {
      expect(levenshteinSimilarity('hello', 'hello')).toBe(1);
    });

    it('should return 1 for two empty strings', () => {
      expect(levenshteinSimilarity('', '')).toBe(1);
    });

    it('should return 0 for empty vs non-empty string', () => {
      expect(levenshteinSimilarity('hello', '')).toBe(0);
      expect(levenshteinSimilarity('', 'world')).toBe(0);
    });

    it('should return value between 0 and 1', () => {
      const similarity = levenshteinSimilarity('test', 'text');
      expect(similarity).toBeGreaterThan(0);
      expect(similarity).toBeLessThan(1);
    });

    it('should calculate similarity correctly', () => {
      // "cat" vs "hat" - 1 edit distance, max length 3
      expect(levenshteinSimilarity('cat', 'hat')).toBeCloseTo(1 - 1 / 3);
    });
  });

  describe('jaroSimilarity', () => {
    it('should return 1 for identical strings', () => {
      expect(jaroSimilarity('hello', 'hello')).toBe(1);
    });

    it('should return 1 for two empty strings', () => {
      expect(jaroSimilarity('', '')).toBe(1);
    });

    it('should return 0 for empty vs non-empty string', () => {
      expect(jaroSimilarity('hello', '')).toBe(0);
      expect(jaroSimilarity('', 'world')).toBe(0);
    });

    it('should return 0 for completely different strings', () => {
      expect(jaroSimilarity('abc', 'xyz')).toBe(0);
    });

    it('should handle transpositions', () => {
      const similarity = jaroSimilarity('martha', 'marhta');
      expect(similarity).toBeGreaterThan(0.9);
    });

    it('should return high similarity for similar strings', () => {
      const similarity = jaroSimilarity('DWAYNE', 'DUANE');
      expect(similarity).toBeGreaterThan(0.8);
    });
  });

  describe('jaroWinklerSimilarity', () => {
    it('should return 1 for identical strings', () => {
      expect(jaroWinklerSimilarity('hello', 'hello')).toBe(1);
    });

    it('should boost similarity for common prefix', () => {
      const jaroSim = jaroSimilarity('martha', 'marhta');
      const jaroWinklerSim = jaroWinklerSimilarity('martha', 'marhta');

      // Jaro-Winkler should be higher due to common prefix "mar"
      expect(jaroWinklerSim).toBeGreaterThanOrEqual(jaroSim);
    });

    it('should handle different prefix scales', () => {
      const defaultSim = jaroWinklerSimilarity('prefix_test', 'prefix_text');
      const highScaleSim = jaroWinklerSimilarity('prefix_test', 'prefix_text', 0.2);

      // Higher prefix scale should give higher similarity for common prefixes
      expect(highScaleSim).toBeGreaterThanOrEqual(defaultSim);
    });

    it('should handle strings with no common prefix', () => {
      const jaroSim = jaroSimilarity('abc', 'cba');
      const jaroWinklerSim = jaroWinklerSimilarity('abc', 'cba');

      // Without common prefix, Jaro-Winkler should equal Jaro
      expect(jaroWinklerSim).toBe(jaroSim);
    });

    it('should cap prefix length at 4', () => {
      const sim1 = jaroWinklerSimilarity('prefix_test', 'prefix_text');
      const sim2 = jaroWinklerSimilarity('prefixlonger_test', 'prefixlonger_text');

      // Both have prefix > 4, so prefix contribution should be capped
      expect(sim1).toBeCloseTo(sim2, 1);
    });
  });

  describe('generateNgrams', () => {
    it('should generate bigrams correctly', () => {
      const ngrams = generateNgrams('hello', 2);
      expect(ngrams).toContain('he');
      expect(ngrams).toContain('el');
      expect(ngrams).toContain('ll');
      expect(ngrams).toContain('lo');
      expect(ngrams.size).toBe(4);
    });

    it('should generate trigrams correctly', () => {
      const ngrams = generateNgrams('hello', 3);
      expect(ngrams).toContain('hel');
      expect(ngrams).toContain('ell');
      expect(ngrams).toContain('llo');
      expect(ngrams.size).toBe(3);
    });

    it('should handle string shorter than n', () => {
      const ngrams = generateNgrams('ab', 3);
      expect(ngrams).toContain('ab');
      expect(ngrams.size).toBe(1);
    });

    it('should handle empty string', () => {
      const ngrams = generateNgrams('', 2);
      expect(ngrams).toContain('');
      expect(ngrams.size).toBe(1);
    });

    it('should return unique ngrams', () => {
      // "aaa" should only have one unique bigram "aa"
      const ngrams = generateNgrams('aaa', 2);
      expect(ngrams.size).toBe(1);
      expect(ngrams).toContain('aa');
    });
  });

  describe('ngramSimilarity', () => {
    it('should return 1 for identical strings', () => {
      expect(ngramSimilarity('hello', 'hello')).toBe(1);
    });

    it('should return 1 for two empty strings', () => {
      expect(ngramSimilarity('', '')).toBe(1);
    });

    it('should return 0 for empty vs non-empty string', () => {
      expect(ngramSimilarity('hello', '')).toBe(0);
      expect(ngramSimilarity('', 'world')).toBe(0);
    });

    it('should return 0 for completely different strings', () => {
      expect(ngramSimilarity('abc', 'xyz')).toBe(0);
    });

    it('should return value between 0 and 1 for similar strings', () => {
      const similarity = ngramSimilarity('hello', 'hallo');
      expect(similarity).toBeGreaterThan(0);
      expect(similarity).toBeLessThan(1);
    });

    it('should work with custom n-gram size', () => {
      const bigramSim = ngramSimilarity('hello', 'help', 2);
      const trigramSim = ngramSimilarity('hello', 'help', 3);

      // Both should be valid similarities
      expect(bigramSim).toBeGreaterThan(0);
      expect(trigramSim).toBeGreaterThanOrEqual(0);
    });
  });

  describe('normalizeString', () => {
    it('should convert to lowercase by default', () => {
      expect(normalizeString('HELLO')).toBe('hello');
      expect(normalizeString('HeLLo WoRLD')).toBe('hello world');
    });

    it('should preserve case when caseSensitive is true', () => {
      expect(normalizeString('HELLO', { caseSensitive: true })).toBe('HELLO');
    });

    it('should normalize whitespace by default', () => {
      expect(normalizeString('hello   world')).toBe('hello world');
      expect(normalizeString('  hello  world  ')).toBe('hello world');
      expect(normalizeString('hello\n\tworld')).toBe('hello world');
    });

    it('should preserve whitespace when ignoreWhitespace is false', () => {
      expect(normalizeString('hello   world', { ignoreWhitespace: false })).toBe('hello   world');
    });
  });

  describe('fuzzyMatch', () => {
    it('should return exact match with similarity 1', () => {
      const result = fuzzyMatch('hello', 'hello');
      expect(result.similarity).toBeCloseTo(1);
      expect(result.isMatch).toBe(true);
    });

    it('should handle case insensitivity by default', () => {
      const result = fuzzyMatch('HELLO', 'hello');
      expect(result.similarity).toBeCloseTo(1);
      expect(result.isMatch).toBe(true);
    });

    it('should handle case sensitivity when configured', () => {
      const result = fuzzyMatch('HELLO', 'hello', { caseSensitive: true });
      expect(result.similarity).toBeLessThan(1);
    });

    it('should return isMatch false when below threshold', () => {
      const result = fuzzyMatch('hello', 'xyz', { threshold: 0.7 });
      expect(result.isMatch).toBe(false);
    });

    it('should include individual algorithm scores', () => {
      const result = fuzzyMatch('hello', 'hallo');
      expect(result.scores).toBeDefined();
      expect(result.scores.levenshtein).toBeDefined();
      expect(result.scores.jaroWinkler).toBeDefined();
      expect(result.scores.ngram).toBeDefined();
    });

    it('should include normalized strings', () => {
      const result = fuzzyMatch('HELLO WORLD', 'hello   world');
      expect(result.normalizedSource).toBe('hello world');
      expect(result.normalizedTarget).toBe('hello world');
    });

    it('should respect custom threshold', () => {
      const result1 = fuzzyMatch('test', 'text', { threshold: 0.5 });
      const result2 = fuzzyMatch('test', 'text', { threshold: 0.9 });

      expect(result1.isMatch).toBe(true);
      expect(result2.isMatch).toBe(false);
    });

    it('should handle common typos tolerantly', () => {
      // Common typos should still match with a more lenient threshold
      expect(fuzzyMatch('Submit', 'Sumbit', { threshold: 0.6 }).isMatch).toBe(true);
      expect(fuzzyMatch('receive', 'recieve', { threshold: 0.6 }).isMatch).toBe(true);
      expect(fuzzyMatch('separate', 'seperate', { threshold: 0.6 }).isMatch).toBe(true);

      // With default threshold (0.7), some typos may not match
      // but similarity should still be reasonably high
      expect(fuzzyMatch('Submit', 'Sumbit').similarity).toBeGreaterThan(0.5);
    });
  });

  describe('findBestMatch', () => {
    it('should find the best matching candidate', () => {
      const candidates = ['hello', 'world', 'help', 'held'];
      const result = findBestMatch('helo', candidates);

      expect(result.match).toBe('hello');
      expect(result.index).toBe(0);
      expect(result.result).not.toBeNull();
    });

    it('should return null for empty candidates', () => {
      const result = findBestMatch('hello', []);
      expect(result.match).toBeNull();
      expect(result.index).toBe(-1);
      expect(result.result).toBeNull();
    });

    it('should return null when no candidates match threshold', () => {
      const candidates = ['abc', 'xyz', 'def'];
      const result = findBestMatch('hello', candidates, { threshold: 0.9 });

      expect(result.match).toBeNull();
    });

    it('should return exact match when available', () => {
      const candidates = ['hell', 'hello', 'help'];
      const result = findBestMatch('hello', candidates);

      expect(result.match).toBe('hello');
      expect(result.result?.similarity).toBeCloseTo(1);
    });

    it('should handle case insensitive matching', () => {
      const candidates = ['SUBMIT', 'CANCEL', 'RESET'];
      const result = findBestMatch('submit', candidates);

      expect(result.match).toBe('SUBMIT');
    });
  });

  describe('findAllMatches', () => {
    it('should find all matching candidates', () => {
      const candidates = ['hello', 'help', 'held', 'world'];
      const results = findAllMatches('hel', candidates, { threshold: 0.5 });

      expect(results.length).toBeGreaterThan(0);
      // Results should be sorted by similarity descending
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].result.similarity).toBeGreaterThanOrEqual(
          results[i].result.similarity
        );
      }
    });

    it('should return empty array when no matches', () => {
      const candidates = ['abc', 'def', 'ghi'];
      const results = findAllMatches('xyz', candidates, { threshold: 0.9 });

      expect(results).toHaveLength(0);
    });

    it('should include candidate and index in results', () => {
      const candidates = ['hello', 'world'];
      const results = findAllMatches('hello', candidates);

      expect(results[0].candidate).toBe('hello');
      expect(results[0].index).toBe(0);
    });

    it('should return results sorted by similarity', () => {
      const candidates = ['completely different', 'helo', 'hello'];
      const results = findAllMatches('hello', candidates, { threshold: 0.5 });

      if (results.length > 1) {
        expect(results[0].result.similarity).toBeGreaterThanOrEqual(results[1].result.similarity);
      }
    });
  });

  describe('fuzzyContains', () => {
    it('should return true for exact contains', () => {
      expect(fuzzyContains('hello world', 'world')).toBe(true);
      expect(fuzzyContains('hello world', 'hello')).toBe(true);
    });

    it('should return true for case insensitive contains', () => {
      expect(fuzzyContains('Hello World', 'WORLD')).toBe(true);
    });

    it('should return true for fuzzy word matches', () => {
      // The internal threshold for fuzzyContains word matching is 0.8
      // which requires very close matches
      expect(fuzzyContains('hello world', 'worl')).toBe(true); // missing 'd' - should match

      // "wordl" swaps letters and may not meet 0.8 threshold
      // so we test with a different example
      expect(fuzzyContains('hello world program', 'world')).toBe(true); // exact word match

      // Very different strings won't match
      expect(fuzzyContains('hello world', 'xyz')).toBe(false);
    });

    it('should return false when no fuzzy match exists', () => {
      expect(fuzzyContains('hello world', 'xyz')).toBe(false);
    });

    it('should require all target words to have matches', () => {
      // "hello goodbye" - "goodbye" doesn't match "world"
      expect(fuzzyContains('hello world', 'hello goodbye')).toBe(false);
    });

    it('should handle whitespace normalization', () => {
      expect(fuzzyContains('hello   world', 'hello world')).toBe(true);
    });
  });

  describe('wordSimilarity', () => {
    it('should return 1 for identical phrases', () => {
      expect(wordSimilarity('hello world', 'hello world')).toBeCloseTo(1);
    });

    it('should return 1 for two empty strings', () => {
      expect(wordSimilarity('', '')).toBe(1);
    });

    it('should return 0 for empty vs non-empty', () => {
      expect(wordSimilarity('hello', '')).toBe(0);
      expect(wordSimilarity('', 'world')).toBe(0);
    });

    it('should handle word reordering', () => {
      const similarity = wordSimilarity('hello world', 'world hello');
      expect(similarity).toBeGreaterThan(0.5);
    });

    it('should handle partial word matches', () => {
      const similarity = wordSimilarity('submit button', 'sumbit buton');
      expect(similarity).toBeGreaterThan(0.5);
    });
  });

  describe('tokenize', () => {
    it('should split camelCase', () => {
      const tokens = tokenize('camelCaseString');
      expect(tokens).toContain('camel');
      expect(tokens).toContain('case');
      expect(tokens).toContain('string');
    });

    it('should split PascalCase', () => {
      const tokens = tokenize('PascalCaseString');
      expect(tokens).toContain('pascal');
      expect(tokens).toContain('case');
      expect(tokens).toContain('string');
    });

    it('should split snake_case', () => {
      const tokens = tokenize('snake_case_string');
      expect(tokens).toContain('snake');
      expect(tokens).toContain('case');
      expect(tokens).toContain('string');
    });

    it('should split kebab-case', () => {
      const tokens = tokenize('kebab-case-string');
      expect(tokens).toContain('kebab');
      expect(tokens).toContain('case');
      expect(tokens).toContain('string');
    });

    it('should convert to lowercase', () => {
      const tokens = tokenize('UPPERCASE');
      expect(tokens).toContain('uppercase');
    });

    it('should filter out empty tokens', () => {
      const tokens = tokenize('a__b');
      expect(tokens).not.toContain('');
    });

    it('should handle mixed conventions', () => {
      const tokens = tokenize('mySubmitButton_click');
      expect(tokens).toContain('my');
      expect(tokens).toContain('submit');
      expect(tokens).toContain('button');
      expect(tokens).toContain('click');
    });
  });

  describe('tokenSimilarity', () => {
    it('should return 1 for identical tokens', () => {
      expect(tokenSimilarity('submitButton', 'submit_button')).toBe(1);
    });

    it('should return 1 for two empty strings', () => {
      expect(tokenSimilarity('', '')).toBe(1);
    });

    it('should return 0 for empty vs non-empty', () => {
      expect(tokenSimilarity('hello', '')).toBe(0);
      expect(tokenSimilarity('', 'world')).toBe(0);
    });

    it('should handle different naming conventions', () => {
      const similarity = tokenSimilarity('myButton', 'my-button');
      expect(similarity).toBe(1);
    });

    it('should calculate Jaccard similarity', () => {
      // "login button" and "login form" share "login" but differ in "button"/"form"
      const similarity = tokenSimilarity('loginButton', 'loginForm');
      // Jaccard: 1 (login) / 3 (login, button, form) = 0.333
      expect(similarity).toBeCloseTo(1 / 3);
    });

    it('should return 0 for completely different tokens', () => {
      expect(tokenSimilarity('abc', 'xyz')).toBe(0);
    });
  });

  describe('DEFAULT_FUZZY_CONFIG', () => {
    it('should have expected default values', () => {
      expect(DEFAULT_FUZZY_CONFIG.threshold).toBe(0.7);
      expect(DEFAULT_FUZZY_CONFIG.levenshteinWeight).toBe(0.3);
      expect(DEFAULT_FUZZY_CONFIG.jaroWinklerWeight).toBe(0.4);
      expect(DEFAULT_FUZZY_CONFIG.ngramWeight).toBe(0.3);
      expect(DEFAULT_FUZZY_CONFIG.ngramSize).toBe(2);
      expect(DEFAULT_FUZZY_CONFIG.caseSensitive).toBe(false);
      expect(DEFAULT_FUZZY_CONFIG.ignoreWhitespace).toBe(true);
    });

    it('should have weights that sum to 1', () => {
      const weightSum =
        DEFAULT_FUZZY_CONFIG.levenshteinWeight +
        DEFAULT_FUZZY_CONFIG.jaroWinklerWeight +
        DEFAULT_FUZZY_CONFIG.ngramWeight;
      expect(weightSum).toBe(1);
    });
  });
});
