/**
 * A type a caller NAMES answers for its family; a role a kind implies answers
 * for the kind (`core/element-kind`).
 *
 * The one inferrer keeps a native `<input>` and an ARIA `textbox` apart, and a
 * native `<select>` apart from an ARIA `combobox` / `listbox`, because their
 * verbs differ. Before it, the registry path reported every role="textbox" as
 * `input` and every role="combobox"/"listbox" as `select`, so a query, filter
 * or selector naming `input` or `select` found them. Every reader that matches
 * a named type therefore matches the name's whole family — and "textbox" finds
 * a native input, "combobox" a native select — while a reader comparing ARIA
 * roles reads the role a role-less row's kind implies.
 */

import { describe, it, expect } from 'vitest';
import {
  answersToNamedType,
  impliedAriaRole,
  inferElementType,
  namedTypeFamily,
} from './element-kind';
import { applyCanonicalFindFilter, type FindFilterableElement } from './find-filter';
import { matchesElementSelector, selectorTypeMatches } from '../server/selector-match';
import { find } from '../ai/find';
import { SearchEngine } from '../ai/search-engine';
import type { RegisteredElement } from './types';

describe('namedTypeFamily / answersToNamedType', () => {
  it('a text field is a native input or an ARIA textbox, either way round', () => {
    expect(namedTypeFamily('input')).toEqual(['input', 'textbox']);
    expect(namedTypeFamily('TEXTBOX')).toEqual(['input', 'textbox']);
    expect(answersToNamedType('textbox', 'input')).toBe(true);
    expect(answersToNamedType('input', 'textbox')).toBe(true);
  });

  it('a dropdown is a native select or an ARIA combobox or listbox', () => {
    expect(namedTypeFamily('combobox')).toEqual(['select', 'combobox', 'listbox']);
    expect(answersToNamedType('select', 'combobox')).toBe(true);
    expect(answersToNamedType('listbox', 'select')).toBe(true);
  });

  it('any other name answers for itself only', () => {
    expect(namedTypeFamily('Button')).toEqual(['button']);
    expect(answersToNamedType('button', 'button')).toBe(true);
    expect(answersToNamedType('textbox', 'button')).toBe(false);
    expect(answersToNamedType('textarea', 'input')).toBe(false);
    expect(answersToNamedType(undefined, 'input')).toBe(false);
  });
});

/**
 * Auto-registered ids are `{type}-{slug}`, and specs pin them, so a role whose
 * verbs are `generic`'s must stay `generic` (ROLE_KINDS): a kind of its own
 * would rename every such id.
 */
describe('inferElementType keeps id-bearing kinds stable', () => {
  const div = (attrs: Record<string, string>): HTMLElement => {
    const el = document.createElement('div');
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  };

  it('a role="tablist" div is generic', () => {
    expect(inferElementType(div({ role: 'tablist' }))).toBe('generic');
  });

  it('a role="status" div is generic', () => {
    expect(inferElementType(div({ role: 'status' }))).toBe('generic');
  });

  it('a non-native role="spinbutton" div is generic', () => {
    expect(inferElementType(div({ role: 'spinbutton', 'aria-valuenow': '1' }))).toBe('generic');
  });
});

describe('impliedAriaRole', () => {
  it('names the role a role-less node of each kind has', () => {
    expect(impliedAriaRole('input')).toBe('textbox');
    expect(impliedAriaRole('select')).toBe('combobox');
    expect(impliedAriaRole('disclosure')).toBe('group');
    expect(impliedAriaRole('generic')).toBeUndefined();
    expect(impliedAriaRole('constructor')).toBeUndefined();
  });
});

const row = (id: string, type: string, extra: Partial<FindFilterableElement> = {}) =>
  ({
    id,
    type,
    actions: ['click'],
    category: 'interactive',
    state: { visible: true },
    ...extra,
  }) as FindFilterableElement;

describe('the canonical find filter', () => {
  const rows = [
    row('email', 'input'),
    row('notes', 'textbox'),
    row('country', 'select'),
    row('size', 'combobox'),
    row('save', 'button'),
  ];
  const ids = (criteria: Record<string, unknown>) =>
    applyCanonicalFindFilter(rows, criteria).map((r) => r.id);

  it('a named type finds its family', () => {
    expect(ids({ type: 'textbox' })).toEqual(['email', 'notes']);
    expect(ids({ type: 'input' })).toEqual(['email', 'notes']);
    expect(ids({ type: 'combobox' })).toEqual(['country', 'size']);
    expect(ids({ types: ['button', 'select'] })).toEqual(['country', 'size', 'save']);
    expect(ids({ type: 'button' })).toEqual(['save']);
  });

  it('a role finds a role-less row whose kind implies it', () => {
    expect(ids({ role: 'textbox' })).toEqual(['email', 'notes']);
    expect(ids({ role: 'combobox' })).toEqual(['country', 'size']);
  });
});

describe('selector matching', () => {
  it('getElements-style selectors take a named type as its family', () => {
    expect(matchesElementSelector({ id: 'a', type: 'textbox' }, { type: 'input' })).toBe(true);
    expect(matchesElementSelector({ id: 'a', type: 'select' }, { type: 'combobox' })).toBe(true);
    expect(matchesElementSelector({ id: 'a', type: 'button' }, { type: 'input' })).toBe(false);
  });

  it("the wait-for selector's substring match runs over the family and the tag", () => {
    expect(selectorTypeMatches('input', 'textbox', 'div')).toBe(true);
    expect(selectorTypeMatches('select', 'combobox', 'button')).toBe(true);
    expect(selectorTypeMatches('input', 'combobox', 'input')).toBe(true);
    expect(selectorTypeMatches('select', 'button', 'button')).toBe(false);
  });
});

describe('natural-language find', () => {
  /** A registered row of `type` whose only matching text is its label `label`. */
  function registered(id: string, type: string, label: string): RegisteredElement {
    const el = document.createElement(type === 'button' ? 'button' : 'div');
    document.body.appendChild(el);
    return {
      id,
      type,
      label,
      element: el,
      actions: ['click'],
      aliases: [],
      description: '',
      getState: () => ({
        visible: true,
        enabled: true,
        focused: false,
        textContent: '',
        rect: { x: 0, y: 0, width: 200, height: 30 },
      }),
    } as unknown as RegisteredElement;
  }

  /**
   * The ids the search matched ON TYPE for `query`. Two rows are labelled
   * alike, so the label scores them equally (and saturates the confidence);
   * the named type is what the search can tell them apart by.
   */
  function typeMatched(query: string, rows: RegisteredElement[]): string[] {
    document.body.innerHTML = '';
    const engine = new SearchEngine({ fuzzyThreshold: 0.5 });
    engine.updateElements(rows);
    const result = find(query, engine, { confidenceThreshold: 0.3 });
    if (!result.found) return [];
    const candidates = [result, ...(result.alternatives ?? [])];
    return candidates
      .filter((c) => c.matchReasons.some((reason) => reason.startsWith('type: ')))
      .map((c) => c.elementId)
      .sort();
  }

  it('"the email textbox" matches the native input on type, not the button', () => {
    expect(
      typeMatched('email textbox', [
        registered('btn', 'button', 'Email'),
        registered('in', 'input', 'Email'),
      ])
    ).toEqual(['in']);
  });

  it('"the country combobox" matches the native select on type, not the button', () => {
    expect(
      typeMatched('country combobox', [
        registered('btn', 'button', 'Country'),
        registered('sel', 'select', 'Country'),
      ])
    ).toEqual(['sel']);
  });

  it('"the notes input" matches an ARIA textbox on type', () => {
    expect(
      typeMatched('notes input', [
        registered('btn', 'button', 'Notes'),
        registered('tb', 'textbox', 'Notes'),
      ])
    ).toEqual(['tb']);
  });
});
