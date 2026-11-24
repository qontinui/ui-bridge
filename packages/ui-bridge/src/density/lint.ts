/**
 * `lint`: hold a targets file to the audience profile it cites.
 *
 * Each ask's `source.quote` must be found, verbatim, in the profile text the
 * caller supplies (compared with whitespace collapsed; case and punctuation
 * count). An ask citing a document other than the one the text is of cannot
 * be checked against it, and is reported as such — never as found. The
 * profile's sentences that no ask quotes are listed, because a sentence no
 * ask rests on is a need the targets file may have missed. A missing or stale
 * `review.asksHash` puts `review-targets` in `next[]`.
 *
 * The profile text is the caller's own document, not page text; the sentences
 * it lists are the caller's.
 *
 * Plan: 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change (Phase 6).
 */

import { densityAsksHash } from './hash';
import type { DensityCappedList, DensityNextStep } from './measure';
import type { DensityTargets } from './schema';

/** The longest list of unquoted sentences a lint prints; the rest is counted. */
export const DENSITY_LINT_SENTENCE_CAP = 50;

/** `found`; `missing` (not in the text); `other-doc` (the ask cites another document, so the text cannot check it). */
export type DensityQuoteStatus = 'found' | 'missing' | 'other-doc';

export interface DensityLintAsk {
  role: string;
  ask: string;
  doc: string;
  status: DensityQuoteStatus;
}

export interface DensityLintReport {
  /** The document the text is of. */
  profile: string;
  asks: DensityLintAsk[];
  counts: { found: number; missing: number; otherDoc: number };
  /** Profile sentences no ask quotes, in profile order. */
  unquoted: DensityCappedList<{ index: number; sentence: string }>;
  /** Sentences the profile text holds. */
  sentences: number;
  /** `missing`: no review block; `stale`: its `asksHash` is not the hash of the current asks. */
  review: 'current' | 'missing' | 'stale';
  next: DensityNextStep[];
}

export interface DensityLintOptions {
  /** The document the text is of; defaults to the targets' `profile`. */
  profileDoc?: string;
  cap?: number;
}

/** Whitespace collapsed to single spaces, trimmed. */
function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// A line that starts a unit of its own: a heading, a list item, a quote.
const UNIT_START = /^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/;

/**
 * The profile's sentences: the text is cut into units (paragraphs, and each
 * heading, list item and quoted line on its own), its markers dropped, and
 * each unit split after `.`, `!` or `?` followed by white space. A piece with
 * no letter (a rule, a number) is not a sentence.
 */
export function densityProfileSentences(text: string): string[] {
  const units: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length > 0) units.push(current.join(' '));
    current = [];
  };
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.trim() === '') {
      flush();
      continue;
    }
    if (UNIT_START.test(line)) {
      flush();
      current.push(line.replace(UNIT_START, ''));
      if (/^\s*#/.test(line)) flush();
      continue;
    }
    current.push(line);
  }
  flush();
  const sentences: string[] = [];
  for (const unit of units) {
    for (const piece of collapse(unit).split(/(?<=[.!?])\s+/)) {
      if (/\p{L}/u.test(piece)) sentences.push(piece);
    }
  }
  return sentences;
}

/** Lint `targets` against the text of its audience profile. */
export function lintDensityTargets(
  targets: DensityTargets,
  profileText: string,
  options: DensityLintOptions = {}
): DensityLintReport {
  const doc = options.profileDoc ?? targets.profile;
  const cap = options.cap ?? DENSITY_LINT_SENTENCE_CAP;
  const sentences = densityProfileSentences(profileText);
  // Quotes are looked for in each unit's collapsed text, so a quote may span
  // a sentence boundary but not a paragraph.
  const haystack = collapse(sentences.join(' '));
  const asks: DensityLintAsk[] = [];
  const quotes: string[] = [];
  for (const role of targets.roles) {
    for (const ask of role.asks) {
      const quote = collapse(ask.source.quote);
      let status: DensityQuoteStatus;
      if (ask.source.doc !== doc) status = 'other-doc';
      else if (quote !== '' && haystack.includes(quote)) {
        status = 'found';
        quotes.push(quote);
      } else status = 'missing';
      asks.push({ role: role.role, ask: ask.id, doc: ask.source.doc, status });
    }
  }
  const unquotedAll = sentences
    .map((sentence, index) => ({ index, sentence }))
    .filter(({ sentence }) => !quotes.some((q) => q.includes(sentence) || sentence.includes(q)));
  const list = unquotedAll.slice(0, Math.max(0, cap));
  const review: DensityLintReport['review'] =
    targets.review === null
      ? 'missing'
      : targets.review.asksHash === densityAsksHash(targets)
        ? 'current'
        : 'stale';
  const next: DensityNextStep[] = [];
  if (review !== 'current') next.push('review-targets');
  return {
    profile: doc,
    asks,
    counts: {
      found: asks.filter((a) => a.status === 'found').length,
      missing: asks.filter((a) => a.status === 'missing').length,
      otherDoc: asks.filter((a) => a.status === 'other-doc').length,
    },
    unquoted: {
      shown: list.length,
      total: unquotedAll.length,
      truncated: list.length < unquotedAll.length,
      list,
    },
    sentences: sentences.length,
    review,
    next,
  };
}

/** The exit code of a `lint`: 1 when a quote is missing, 3 when the only unchecked asks cite another document (or there is no ask), else 0. */
export function densityLintExitCode(report: DensityLintReport): 0 | 1 | 3 {
  if (report.counts.missing > 0) return 1;
  if (report.counts.otherDoc > 0 || report.asks.length === 0) return 3;
  return 0;
}

/** A valid, empty targets file for a surface: no role, no ask (`init`). */
export function emptyDensityTargets(surface: string, profile: string): DensityTargets {
  return {
    schema: 'ui-bridge/density-targets@1',
    surface,
    profile,
    classify: [],
    blocks: [],
    roles: [],
    review: null,
  };
}
