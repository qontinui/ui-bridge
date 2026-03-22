/**
 * Recency Model Tests
 */

import { describe, it, expect } from 'vitest';
import { Recency, isSatisfiedBy, requiresFetch, mightRequireFetch, parseRecency } from './recency';

describe('Recency', () => {
  // ==========================================================================
  // isSatisfiedBy
  // ==========================================================================

  describe('isSatisfiedBy', () => {
    it('Any is always satisfied regardless of age', () => {
      expect(isSatisfiedBy(Recency.Any, 0)).toBe(true);
      expect(isSatisfiedBy(Recency.Any, 999999)).toBe(true);
    });

    it('Current is never satisfied regardless of age', () => {
      expect(isSatisfiedBy(Recency.Current, 0)).toBe(false);
      expect(isSatisfiedBy(Recency.Current, 1)).toBe(false);
    });

    it('MaxAge is satisfied when age <= threshold', () => {
      expect(isSatisfiedBy(Recency.MaxAge(5000), 3000)).toBe(true);
      expect(isSatisfiedBy(Recency.MaxAge(5000), 5000)).toBe(true);
    });

    it('MaxAge is not satisfied when age > threshold', () => {
      expect(isSatisfiedBy(Recency.MaxAge(5000), 5001)).toBe(false);
      expect(isSatisfiedBy(Recency.MaxAge(5000), 6000)).toBe(false);
    });

    it('MaxAge edge case: zero ms threshold', () => {
      expect(isSatisfiedBy(Recency.MaxAge(0), 0)).toBe(true);
      expect(isSatisfiedBy(Recency.MaxAge(0), 1)).toBe(false);
    });
  });

  // ==========================================================================
  // requiresFetch / mightRequireFetch
  // ==========================================================================

  describe('requiresFetch', () => {
    it('Any never requires fetch', () => {
      expect(requiresFetch(Recency.Any)).toBe(false);
    });

    it('Current always requires fetch', () => {
      expect(requiresFetch(Recency.Current)).toBe(true);
    });

    it('MaxAge does not always require fetch', () => {
      expect(requiresFetch(Recency.MaxAge(5000))).toBe(false);
    });
  });

  describe('mightRequireFetch', () => {
    it('Any never might require fetch', () => {
      expect(mightRequireFetch(Recency.Any)).toBe(false);
    });

    it('Current might require fetch', () => {
      expect(mightRequireFetch(Recency.Current)).toBe(true);
    });

    it('MaxAge might require fetch', () => {
      expect(mightRequireFetch(Recency.MaxAge(5000))).toBe(true);
    });
  });

  // ==========================================================================
  // parseRecency
  // ==========================================================================

  describe('parseRecency', () => {
    it('returns Default for undefined', () => {
      const result = parseRecency(undefined);
      expect(result.kind).toBe('maxAge');
      expect((result as { kind: 'maxAge'; ms: number }).ms).toBe(5000);
    });

    it('returns Default for null', () => {
      const result = parseRecency(null);
      expect(result.kind).toBe('maxAge');
      expect((result as { kind: 'maxAge'; ms: number }).ms).toBe(5000);
    });

    it('parses "any" string', () => {
      expect(parseRecency('any')).toEqual(Recency.Any);
    });

    it('parses "current" string', () => {
      expect(parseRecency('current')).toEqual(Recency.Current);
    });

    it('parses numeric string as MaxAge', () => {
      const result = parseRecency('2000');
      expect(result.kind).toBe('maxAge');
      expect((result as { kind: 'maxAge'; ms: number }).ms).toBe(2000);
    });

    it('parses number as MaxAge', () => {
      const result = parseRecency(3000);
      expect(result.kind).toBe('maxAge');
      expect((result as { kind: 'maxAge'; ms: number }).ms).toBe(3000);
    });

    it('returns Default for invalid string', () => {
      const result = parseRecency('garbage');
      expect(result.kind).toBe('maxAge');
      expect((result as { kind: 'maxAge'; ms: number }).ms).toBe(5000);
    });

    it('returns Default for zero', () => {
      // Zero is not > 0, so it falls through to Default
      const result = parseRecency('0');
      expect(result.kind).toBe('maxAge');
      expect((result as { kind: 'maxAge'; ms: number }).ms).toBe(5000);
    });

    it('returns Default for negative number', () => {
      const result = parseRecency('-100');
      expect(result.kind).toBe('maxAge');
      expect((result as { kind: 'maxAge'; ms: number }).ms).toBe(5000);
    });
  });

  // ==========================================================================
  // Constructors
  // ==========================================================================

  describe('constructors', () => {
    it('Default equals MaxAge(5000)', () => {
      expect(Recency.Default).toEqual(Recency.MaxAge(5000));
    });

    it('Any is frozen', () => {
      expect(Object.isFrozen(Recency.Any)).toBe(true);
    });

    it('Current is frozen', () => {
      expect(Object.isFrozen(Recency.Current)).toBe(true);
    });

    it('MaxAge returns correct kind and ms', () => {
      const r = Recency.MaxAge(1234);
      expect(r.kind).toBe('maxAge');
      expect((r as { kind: 'maxAge'; ms: number }).ms).toBe(1234);
    });
  });
});
