/**
 * Matcher resolution: which items of a capture a targets matcher selects.
 *
 * Two halves, because the capture keeps no text. At CAPTURE time the adapter
 * evaluates every `text` field once ({@link evaluateDensityTextMatchers}) and
 * records the ids it matched under the matcher's hash. At RESOLUTION time
 * ({@link resolveDensityMatcher}) the structural fields — `ids`, `idPrefix`,
 * `idGlob`, `role`, `tag`, `within` — are applied to the capture, and a `text`
 * field is read back from that record.
 *
 * A matcher that selects nothing is UNRESOLVED, never an absence: the answer
 * may be on the page under an id the author mistyped, inside a redacted
 * subtree, or under a structure this capture has not resolved. The reason says
 * which.
 */

import type {
  DensityCapture,
  DensityMatcher,
  DensityTargets,
  DensityTextMatchRecord,
} from './schema';
import { hashDensityCanonical } from './hash';

/** The key a matcher's `text` evaluation is stored under: the hash of its RFC 8785 form. */
export function densityMatcherKey(matcher: DensityMatcher): string {
  return hashDensityCanonical(matcher);
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Whether `text` satisfies a matcher's `text` field: the collapsed needle is a substring of the collapsed text. */
export function densityTextSatisfies(text: string, needle: string): boolean {
  return collapse(text).includes(collapse(needle));
}

function visitMatcher(matcher: DensityMatcher, out: DensityMatcher[]): void {
  if (matcher.text !== undefined) out.push(matcher);
  if (matcher.within) visitMatcher(matcher.within, out);
}

/**
 * Every matcher in `targets` that carries a `text` field — in `classify`,
 * `blocks`, every ask's `answer`, and nested under `within` — once each, in
 * document order.
 */
export function collectDensityTextMatchers(targets: DensityTargets): DensityMatcher[] {
  const found: DensityMatcher[] = [];
  for (const c of targets.classify) visitMatcher(c.match, found);
  for (const b of targets.blocks) visitMatcher(b.match, found);
  for (const role of targets.roles) {
    for (const ask of role.asks) {
      if (ask.answer === null) continue;
      const answers = Array.isArray(ask.answer) ? ask.answer : [ask.answer];
      for (const m of answers) visitMatcher(m, found);
    }
  }
  const seen = new Set<string>();
  return found.filter((m) => {
    const key = densityMatcherKey(m);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Capture-time evaluation of `text` fields. `texts` holds each item's text,
 * or `null` where it could not be read (a redacted item): those are counted in
 * `unevaluated`, so an empty `ids` list beside a nonzero count is never read
 * as "the text is not on the page".
 */
export function evaluateDensityTextMatchers(
  texts: ReadonlyArray<{ id: string; text: string | null }>,
  matchers: readonly DensityMatcher[]
): Record<string, DensityTextMatchRecord> {
  const out: Record<string, DensityTextMatchRecord> = {};
  const unevaluated = texts.filter((t) => t.text === null).length;
  for (const m of matchers) {
    if (m.text === undefined) continue;
    const needle = m.text;
    out[densityMatcherKey(m)] = {
      ids: texts
        .filter((t) => t.text !== null && densityTextSatisfies(t.text, needle))
        .map((t) => t.id),
      unevaluated,
    };
  }
  return out;
}

/** Why a matcher selected nothing that can be relied on. */
export type DensityUnresolvedReason =
  /** Every field was evaluable and together they selected no item. */
  | 'no-match'
  /** The matcher has a `text` field this capture did not evaluate (it was taken without these targets). */
  | 'text-not-captured'
  /** The matcher has `within`, and this capture's parent links are not resolved. */
  | 'structure-not-resolved';

export type DensityMatchResult =
  | {
      status: 'resolved';
      /** Matched item ids, in capture order. Never empty. */
      ids: string[];
      /** Items whose text was unreadable when a `text` field was evaluated; they may also match. */
      textUnevaluated: number;
    }
  | { status: 'unresolved'; reason: DensityUnresolvedReason; textUnevaluated: number };

function globToRegExp(glob: string): RegExp {
  let source = '^';
  for (const ch of glob) {
    if (ch === '*') source += '.*';
    else if (ch === '?') source += '.';
    else source += ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  }
  // `u`: `?` is one character (code point), not one UTF-16 unit.
  return new RegExp(source + '$', 'su');
}

/** Apply `matcher` to `capture`. */
export function resolveDensityMatcher(
  capture: DensityCapture,
  matcher: DensityMatcher
): DensityMatchResult {
  let textUnevaluated = 0;
  let textIds: Set<string> | null = null;
  if (matcher.text !== undefined) {
    const record = capture.textMatches[densityMatcherKey(matcher)];
    if (!record) return { status: 'unresolved', reason: 'text-not-captured', textUnevaluated: 0 };
    textIds = new Set(record.ids);
    textUnevaluated = record.unevaluated;
  }

  let withinIds: Set<string> | null = null;
  if (matcher.within) {
    if (!capture.structureResolved) {
      return { status: 'unresolved', reason: 'structure-not-resolved', textUnevaluated };
    }
    const inner = resolveDensityMatcher(capture, matcher.within);
    // Both counts are over the same items, so the larger bounds what is unread.
    textUnevaluated = Math.max(textUnevaluated, inner.textUnevaluated);
    if (inner.status === 'unresolved') {
      return { status: 'unresolved', reason: inner.reason, textUnevaluated };
    }
    withinIds = new Set(inner.ids);
  }

  const parentOf = new Map<string, string | null>();
  for (const item of capture.items) parentOf.set(item.id, item.parent);
  const hasAncestorIn = (id: string, set: Set<string>): boolean => {
    const seen = new Set<string>();
    let cur = parentOf.get(id) ?? null;
    while (cur !== null && !seen.has(cur)) {
      if (set.has(cur)) return true;
      seen.add(cur);
      cur = parentOf.get(cur) ?? null;
    }
    return false;
  };

  const idSet = matcher.ids ? new Set(matcher.ids) : null;
  const glob = matcher.idGlob !== undefined ? globToRegExp(matcher.idGlob) : null;
  const ids = capture.items
    .filter((item) => {
      if (idSet && !idSet.has(item.id)) return false;
      if (matcher.idPrefix !== undefined && !item.id.startsWith(matcher.idPrefix)) return false;
      if (glob && !glob.test(item.id)) return false;
      if (matcher.role !== undefined && item.role !== matcher.role) return false;
      if (matcher.tag !== undefined && item.tag !== matcher.tag.toLowerCase()) return false;
      if (textIds && !textIds.has(item.id)) return false;
      if (withinIds && !hasAncestorIn(item.id, withinIds)) return false;
      return true;
    })
    .map((item) => item.id);

  return ids.length > 0
    ? { status: 'resolved', ids, textUnevaluated }
    : { status: 'unresolved', reason: 'no-match', textUnevaluated };
}

/**
 * Apply each of `matchers` (an ask's `answer` list). `ids` is the union of the
 * resolved members in capture order; `results` keeps every member's own answer,
 * so a caller can tell a list that resolved in full from one that resolved in
 * part.
 */
export function resolveDensityMatchers(
  capture: DensityCapture,
  matchers: readonly DensityMatcher[]
): { ids: string[]; results: DensityMatchResult[] } {
  const results = matchers.map((m) => resolveDensityMatcher(capture, m));
  const union = new Set<string>();
  for (const r of results) if (r.status === 'resolved') r.ids.forEach((id) => union.add(id));
  return { ids: capture.items.filter((i) => union.has(i.id)).map((i) => i.id), results };
}
