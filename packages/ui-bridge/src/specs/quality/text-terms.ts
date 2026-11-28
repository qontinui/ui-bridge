/**
 * Language-agnostic term extraction for `informationDensity`'s redundant-text
 * category. No dictionary and no stopword list:
 *
 *  1. NFKC, lower-case, split on anything that is not a Unicode letter or digit;
 *  2. keep tokens of at least `MIN_TERM_LENGTH` characters — a stand-in for a
 *     stopword list that drops most function words in German and English alike
 *     ("und", "die", "mit", "ihre", "the", "and", "with");
 *  3. drop tokens the density core classifies as a number, date, currency
 *     amount or identifier (`densityShapeOf`) — values, not terms;
 *  4. remove one inflection suffix (`SUFFIXES`, longest first), keeping a stem of
 *     at least `MIN_STEM_LENGTH`.
 *
 * Two stems MATCH when they are equal, or when one of at least
 * `MIN_COMPOUND_STEM` characters is a prefix or a suffix of the other — so a
 * compound ("projektname", "lieferadresse") matches its parts.
 */

import { densityShapeOf } from '../../density/shape';

/** Tunable: the shortest token counted as a term. */
export const MIN_TERM_LENGTH = 5;
/** Tunable: the shortest stem that matches as the prefix or suffix of a longer one. */
export const MIN_COMPOUND_STEM = 5;
/** Tunable: a suffix is removed only when at least this much stem remains. */
export const MIN_STEM_LENGTH = 4;
/** Inflection endings (English and German), removed once, longest first. */
export const SUFFIXES = ['ungen', 'ingen', 'ung', 'ing', 'en', 'er', 'es', 'ed', 'e', 'n', 's'] as const;

export function stem(token: string): string {
  for (const suffix of SUFFIXES) {
    if (token.endsWith(suffix) && token.length - suffix.length >= MIN_STEM_LENGTH) {
      return token.slice(0, -suffix.length);
    }
  }
  return token;
}

/** The distinct term stems of a text, in first-seen order. */
export function termStems(text: string): string[] {
  const tokens = text
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= MIN_TERM_LENGTH && densityShapeOf(t) === 'text');
  return Array.from(new Set(tokens.map(stem)));
}

export function stemsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= MIN_COMPOUND_STEM && (long.startsWith(short) || long.endsWith(short));
}

/** The stems of `a` that match some stem of `b`. */
export function sharedStems(a: readonly string[], b: readonly string[]): string[] {
  return a.filter((x) => b.some((y) => stemsMatch(x, y)));
}
