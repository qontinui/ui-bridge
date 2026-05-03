/**
 * Phase 3.2 (plan 2026-05-03) — `revealsAny` selector tests for the shared
 * `matchesElementSelector` matcher. Covers exact match, query-as-glob,
 * entry-as-glob, and array-empty / missing-field early outs.
 */

import { describe, it, expect } from 'vitest';
import {
  matchesElementSelector,
  revealsEntryMatches,
  type MatchableElement,
} from './selector-match';

function elt(id: string, reveals?: string[]): MatchableElement {
  return { id, reveals };
}

describe('revealsEntryMatches', () => {
  it('returns true for exact equality', () => {
    expect(revealsEntryMatches('session-card-1', 'session-card-1')).toBe(true);
  });

  it('returns false when neither side contains *', () => {
    expect(revealsEntryMatches('session-card-1', 'session-card-2')).toBe(false);
  });

  it('matches when the query is a glob and the entry is concrete', () => {
    expect(revealsEntryMatches('session-card-*', 'session-card-1')).toBe(true);
    expect(revealsEntryMatches('session-card-*', 'unrelated-card')).toBe(false);
  });

  it('matches when the entry is a glob and the query is concrete', () => {
    expect(revealsEntryMatches('session-card-1', 'session-card-*')).toBe(true);
    expect(revealsEntryMatches('promote-1', 'session-card-*')).toBe(false);
  });

  it('escapes regex metacharacters so `.` is literal', () => {
    // Without escaping, `*.` would match `xY` because `.` is "any char".
    expect(revealsEntryMatches('a.b', 'a.b')).toBe(true);
    expect(revealsEntryMatches('aXb', 'a.b')).toBe(false);
  });

  it('anchors the regex so partial matches do not pass', () => {
    expect(revealsEntryMatches('session-card', 'session-card-*')).toBe(false);
  });
});

describe('matchesElementSelector · revealsAny (Phase 3.2)', () => {
  const button = elt('button-browse-claude-code-sessions', [
    'session-card-*',
    'promote-to-worktree-*',
  ]);
  const noReveals = elt('plain-button');
  const concreteReveals = elt('toggle', ['exact-id']);

  it('matches an element whose `reveals` glob covers a concrete query value', () => {
    expect(matchesElementSelector(button, { revealsAny: 'session-card-12' })).toBe(true);
  });

  it('matches an element whose `reveals` entry exactly equals the query value', () => {
    expect(matchesElementSelector(concreteReveals, { revealsAny: 'exact-id' })).toBe(true);
  });

  it('matches when the query is a glob and the array contains a concrete entry', () => {
    expect(matchesElementSelector(concreteReveals, { revealsAny: 'exact-*' })).toBe(true);
  });

  it('matches when both sides are globs (entry contains the queried family)', () => {
    expect(matchesElementSelector(button, { revealsAny: 'session-card-*' })).toBe(true);
  });

  it('returns false for elements without a `reveals` array', () => {
    expect(matchesElementSelector(noReveals, { revealsAny: 'session-card-*' })).toBe(false);
  });

  it('returns false when no entry in the array matches the query', () => {
    expect(
      matchesElementSelector(button, { revealsAny: 'completely-unrelated-id' })
    ).toBe(false);
  });

  it('combines with other filters via AND', () => {
    const labeled: MatchableElement = {
      id: 'sidebar-toggle',
      label: 'Browse Claude Code sessions',
      reveals: ['session-card-*'],
    };
    // Both filters pass.
    expect(
      matchesElementSelector(labeled, { revealsAny: 'session-card-1', text: 'browse' })
    ).toBe(true);
    // revealsAny passes but text doesn't — overall fails.
    expect(
      matchesElementSelector(labeled, { revealsAny: 'session-card-1', text: 'unrelated' })
    ).toBe(false);
  });
});
