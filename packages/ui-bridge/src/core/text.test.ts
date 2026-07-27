import { describe, it, expect } from 'vitest';

import { truncateCodePoints } from './text';

/** True iff `s` contains a surrogate that has no partner — the invalid-JSON hazard. */
function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < s.length ? s.charCodeAt(i + 1) : NaN;
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i++; // consume the low surrogate
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return true; // low surrogate with no preceding high
    }
  }
  return false;
}

/** The semantics `server/page-health.ts` already ships, used as the oracle. */
function referenceTruncate(s: string, n: number): string {
  return [...s].slice(0, n).join('');
}

describe('truncateCodePoints', () => {
  it('passes short ASCII through untouched', () => {
    expect(truncateCodePoints('hello', 10)).toBe('hello');
    expect(truncateCodePoints('hello', 5)).toBe('hello');
  });

  it('truncates long ASCII to exactly n characters', () => {
    expect(truncateCodePoints('abcdefghij', 4)).toBe('abcd');
  });

  it('returns empty string for n <= 0', () => {
    expect(truncateCodePoints('anything', 0)).toBe('');
    expect(truncateCodePoints('anything', -1)).toBe('');
  });

  it('handles the empty string', () => {
    expect(truncateCodePoints('', 5)).toBe('');
  });

  it('never splits a surrogate pair straddling the cut', () => {
    // 'ab' + 🔁 (U+1F501, one code point / two code units) + 'cd'.
    const s = 'ab\u{1F501}cd';
    // n=3 lands exactly on the emoji: it is kept whole (3 code points).
    const out = truncateCodePoints(s, 3);
    expect(out).toBe('ab\u{1F501}');
    expect(hasLoneSurrogate(out)).toBe(false);
  });

  it('produces JSON that round-trips when the cut lands on an astral char', () => {
    const s = 'ab\u{1F501}cd';
    for (let n = 0; n <= 6; n++) {
      const out = truncateCodePoints(s, n);
      expect(hasLoneSurrogate(out)).toBe(false);
      expect(JSON.parse(JSON.stringify({ text: out })).text).toBe(out);
    }
  });

  it('regression: a raw .slice at the same boundary DOES leave a lone surrogate', () => {
    // Guards the premise — if this ever stops being true the helper is moot.
    const s = 'ab\u{1F501}cd';
    expect(hasLoneSurrogate(s.slice(0, 3))).toBe(true);
    expect(hasLoneSurrogate(truncateCodePoints(s, 3))).toBe(false);
  });

  it('counts code points, not code units, for multi-astral strings', () => {
    const s = '\u{1F501}\u{1F502}\u{1F503}'; // 3 code points, 6 code units
    expect(truncateCodePoints(s, 3)).toBe(s);
    expect(truncateCodePoints(s, 2)).toBe('\u{1F501}\u{1F502}');
    expect(truncateCodePoints(s, 1)).toBe('\u{1F501}');
  });

  it('does not cut a string whose code-unit length exceeds n but code-point count does not', () => {
    const s = '\u{1F501}\u{1F502}'; // 2 code points, 4 code units
    expect(truncateCodePoints(s, 3)).toBe(s);
  });

  it('passes through a pre-existing lone surrogate as one code point', () => {
    const s = 'a\ud801b'; // already-invalid input from the DOM
    expect(truncateCodePoints(s, 3)).toBe(s);
    expect(truncateCodePoints(s, 2)).toBe('a\ud801');
  });

  it('matches [...s].slice(0, n).join("") over a mixed corpus', () => {
    const corpus = [
      'plain ascii text',
      '\u{1F501}\u{1F502}\u{1F503}\u{1F504}',
      'a\u{1F501}b\u{1F502}c',
      'café naïve',
      '\u{1F468}‍\u{1F469}‍\u{1F467}', // ZWJ family sequence
      '',
      '\u{10000}',
    ];
    for (const s of corpus) {
      for (let n = 0; n <= 8; n++) {
        expect(truncateCodePoints(s, n)).toBe(referenceTruncate(s, n));
      }
    }
  });
});
