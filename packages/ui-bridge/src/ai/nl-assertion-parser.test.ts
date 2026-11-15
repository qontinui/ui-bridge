/**
 * What an `ai/assert` request must name before it runs (`ai/nl-assertion-parser.ts`).
 *
 * Both transports refuse what this refuses, typed UB-VALIDATION-ERROR — pinned
 * over HTTP in `server/element-projection.transports.test.ts`. This file pins
 * which search criteria count as selecting, against the search engine that
 * reads them.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  SELECTING_CRITERIA,
  isAssertionRequestError,
  normalizeAssertion,
} from './nl-assertion-parser';

/** The refusal `normalizeAssertion` throws for `raw`, or a failure when it accepts it. */
function refusal(raw: unknown): Error {
  try {
    normalizeAssertion(raw);
  } catch (err) {
    if (isAssertionRequestError(err)) return err;
    throw err;
  }
  throw new Error(`expected a refusal for ${JSON.stringify(raw)}`);
}

describe('a search-criteria target must select something', () => {
  it.each([
    ['empty criteria', {}],
    ['only the modifiers', { fuzzy: true, fuzzyThreshold: 0.5, strict: true }],
    ['only the content modifiers', { includeContent: true, contentOnly: true }],
    ['a blank selecting field', { idPattern: '' }],
    ['a whitespace selecting field', { text: '   ' }],
    ['a non-string selecting field', { text: 42 }],
    ['a field the assertion search does not read', { selector: '#pay' }],
    ['an unknown field', { foo: 'bar' }],
  ])(
    'refuses a notExists check whose target is %s: it would pass without looking',
    (_l, target) => {
      const err = refusal({ target, type: 'notExists' });
      expect(err).toMatchObject({ code: 'UB-VALIDATION-ERROR' });
      expect(err.message).toContain('the assertion names nothing to check');
      expect(err.message).toContain('selects by none of');
    }
  );

  it.each([
    ['text', { text: 'Save' }],
    ['an id pattern', { idPattern: 'sav*' }],
    ['a type', { type: 'button' }],
    ['a selecting field beside the modifiers', { role: 'button', fuzzy: false, strict: true }],
  ])('accepts criteria that select by %s', (_l, target) => {
    expect(normalizeAssertion({ target, type: 'notExists' })).toMatchObject({
      target,
      type: 'notExists',
    });
  });

  it('a natural-language assertion names the check even beside criteria that select nothing', () => {
    expect(normalizeAssertion({ target: {}, assertion: 'save exists' })).toMatchObject({
      type: 'exists',
    });
  });
});

describe('SELECTING_CRITERIA follows what the search engine reads', () => {
  // The fields the engine reads that only MODIFY a search.
  const MODIFIERS = ['fuzzy', 'fuzzyThreshold', 'strict'];
  const engine = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), 'search-engine.ts'),
    'utf8'
  );
  const read = new Set([...engine.matchAll(/\bcriteria\.([A-Za-z_]\w*)/g)].map((m) => m[1]));

  it('every criteria field the engine reads either selects or is a known modifier', () => {
    const unclassified = [...read].filter(
      (field) => !SELECTING_CRITERIA.includes(field) && !MODIFIERS.includes(field)
    );
    // A field here is one the engine started reading: add it to
    // SELECTING_CRITERIA (or MODIFIERS) so a target naming it is not refused.
    expect(unclassified).toEqual([]);
  });

  it('every selecting field is one the engine reads', () => {
    // A field here selects nothing any more: a target naming only it would run
    // and find nothing. Drop it from SELECTING_CRITERIA.
    expect(SELECTING_CRITERIA.filter((field) => !read.has(field))).toEqual([]);
  });
});
