/**
 * findElements tests
 */

import { describe, it, expect } from 'vitest';
import { findElements, type FindableElement } from './find';

function el(id: string, overrides: Partial<FindableElement> = {}): FindableElement {
  return {
    id,
    type: 'button',
    label: id,
    visible: true,
    ...overrides,
  };
}

describe('findElements — free-text', () => {
  it('finds a single-candidate match by label', () => {
    const elements = [el('submit', { label: 'Submit' }), el('cancel', { label: 'Cancel' })];
    const matches = findElements(elements, 'submit');
    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe('submit');
  });

  it('ranks full-phrase label match above partial token overlap', () => {
    const elements = [
      el('a', { label: 'Save Changes' }),
      el('b', { label: 'Save' }),
      el('c', { label: 'Changes' }),
    ];
    const matches = findElements(elements, 'save');
    expect(matches[0].id).toBe('b'); // full match "save" === "Save"
    expect(matches.map((m) => m.id)).toContain('a');
  });

  it('disambiguates duplicate labels via variant + color + position tokens', () => {
    const elements = [
      el('save-ghost', {
        label: 'Save',
        variant: 'ghost',
        color: 'gray',
        position: 'top',
      }),
      el('save-destructive', {
        label: 'Save',
        variant: 'destructive',
        color: 'red',
        position: 'bottom-right',
      }),
      el('save-primary', {
        label: 'Save',
        variant: 'primary',
        color: 'blue',
        position: 'top-right',
      }),
    ];
    const matches = findElements(elements, 'red destructive save at bottom-right');
    expect(matches[0].id).toBe('save-destructive');
    // Others should still appear (they share the label "Save").
    expect(matches.map((m) => m.id)).toEqual(
      expect.arrayContaining(['save-primary', 'save-ghost'])
    );
  });

  it('tokenizes hyphenated position hints correctly', () => {
    const elements = [
      el('top', { label: 'Go', position: 'top-right' }),
      el('bot', { label: 'Go', position: 'bottom-right' }),
    ];
    const topMatch = findElements(elements, 'top-right go');
    expect(topMatch[0].id).toBe('top');
    const botMatch = findElements(elements, 'bottom go');
    expect(botMatch[0].id).toBe('bot');
  });

  it('returns empty array when query has no overlap and no hard filter matches', () => {
    const elements = [el('a', { label: 'Submit' })];
    const matches = findElements(elements, 'completely-unrelated-token');
    expect(matches).toEqual([]);
  });
});

describe('findElements — structured filters', () => {
  it('applies exact type as a hard filter', () => {
    const elements = [
      el('btn', { type: 'button', label: 'Save' }),
      el('inp', { type: 'input', label: 'Save' }),
    ];
    const matches = findElements(elements, { text: 'save', type: 'input' });
    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe('inp');
  });

  it('applies visibleOnly as a hard filter', () => {
    const elements = [
      el('visible', { label: 'Go', visible: true }),
      el('offscreen', { label: 'Go', visible: false }),
    ];
    const matches = findElements(elements, { text: 'go', visibleOnly: true });
    expect(matches.map((m) => m.id)).toEqual(['visible']);
  });

  it('applies contextPathContains as a substring filter', () => {
    const elements = [
      el('modal-save', {
        label: 'Save',
        contextPath: 'settings-modal > theme-section > save',
      }),
      el('page-save', {
        label: 'Save',
        contextPath: 'workflow-editor > toolbar > save',
      }),
    ];
    const matches = findElements(elements, {
      text: 'save',
      contextPathContains: 'settings-modal',
    });
    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe('modal-save');
  });

  it('filters by origin (hook vs auto)', () => {
    const elements = [
      el('hooked', { label: 'Submit', origin: 'hook' }),
      el('scanned', { label: 'Submit', origin: 'auto' }),
    ];
    expect(findElements(elements, { text: 'submit', origin: 'hook' })).toHaveLength(1);
    expect(findElements(elements, { text: 'submit', origin: 'auto' })).toHaveLength(1);
    expect(findElements(elements, { text: 'submit' })).toHaveLength(2);
  });

  it('respects the limit option', () => {
    const elements = Array.from({ length: 20 }, (_, i) => el(`b-${i}`, { label: 'Go' }));
    const matches = findElements(elements, { text: 'go', limit: 3 });
    expect(matches).toHaveLength(3);
  });

  it('drops candidates below minScore', () => {
    const elements = [
      el('a', { label: 'Save Changes', variant: 'primary' }),
      el('b', { label: 'Something Else' }),
    ];
    // Only "a" should score non-zero on query "save".
    const matches = findElements(elements, { text: 'save', minScore: 1 });
    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe('a');
  });
});

describe('findElements — ranking & ties', () => {
  it('breaks ties on visibility then input order', () => {
    const elements = [
      el('hidden', { label: 'Click', visible: false }),
      el('visible-a', { label: 'Click', visible: true }),
      el('visible-b', { label: 'Click', visible: true }),
    ];
    const matches = findElements(elements, 'click');
    // Both visible elements tie on label-full-match; visible-a appears
    // first in input order so comes first.
    expect(matches.map((m) => m.id)).toEqual(['visible-a', 'visible-b', 'hidden']);
  });

  it('returns reasons describing why each match scored', () => {
    const elements = [
      el('save', {
        label: 'Save',
        variant: 'destructive',
        color: 'red',
        position: 'bottom-right',
      }),
    ];
    const matches = findElements(elements, 'red destructive save at bottom-right');
    expect(matches[0].reasons).toEqual(
      expect.arrayContaining(['label~save', 'variant~destructive', 'color~red'])
    );
  });
});

describe('findElements — edge cases', () => {
  it('returns empty for empty snapshot', () => {
    expect(findElements([], 'anything')).toEqual([]);
  });

  it('accepts an empty query only with structured filters', () => {
    const elements = [el('btn', { type: 'button' }), el('inp', { type: 'input' })];
    // No text, no score — but a type hard filter still selects.
    const matches = findElements(elements, { type: 'button' });
    // Score is 0 unless visible bonus applied (elements default to visible: true → +2).
    expect(matches.map((m) => m.id)).toEqual(['btn']);
  });

  it('handles missing optional fields without crashing', () => {
    const elements: FindableElement[] = [{ id: 'bare' }];
    const matches = findElements(elements, 'bare');
    // No label, no metadata — no tokens match. Score 0. Returned only if > minScore.
    expect(matches).toEqual([]);
  });
});
