/**
 * `codeOfThrown` reads a thrown value's TYPE, never its message.
 *
 * Plan 2026-11-21-ui-bridge-relay-follow-ups-from-434-438 Phase 2: both
 * transports used to guess a thrown error's code from substrings of its
 * message, so a reworded message silently changed the code and the two
 * transports disagreed about the same failure.
 */

import { describe, expect, it } from 'vitest';
import { codeOfThrown } from './index';

const coded = (message: string, code: string) => Object.assign(new Error(message), { code });

describe('codeOfThrown', () => {
  it.each([
    ['ELEMENT_NOT_FOUND', 'UB-ELEM-NOT-FOUND'],
    ['VALIDATION_ERROR', 'UB-VALIDATION-ERROR'],
    ['UNSUPPORTED_ACTION', 'UB-UNSUPPORTED-ACTION'],
    ['TIMEOUT', 'UB-ACTION-TIMEOUT'],
    ['NETWORK_ERROR', 'UB-NET-ERROR'],
    ['UB-ACTION-REJECTED', 'UB-ACTION-REJECTED'],
  ])('code %s answers %s', (code, expected) => {
    expect(codeOfThrown(coded('x', code))).toBe(expected);
  });

  it('a reworded message keeps its code', () => {
    expect(codeOfThrown(coded('wholly different words', 'ELEMENT_NOT_FOUND'))).toBe(
      'UB-ELEM-NOT-FOUND'
    );
  });

  it('a message that reads like another cause does not override the code', () => {
    expect(codeOfThrown(coded('request timeout: element not found', 'VALIDATION_ERROR'))).toBe(
      'UB-VALIDATION-ERROR'
    );
  });

  it('a `*_ERROR` code is not categorised by prose (no message reaches the mapper)', () => {
    expect(codeOfThrown(coded('element not found', 'SOMETHING_ERROR'))).toBe('UB-UNKNOWN-ERROR');
  });

  it.each([
    ['a plain Error whose message says not found', new Error('element not found')],
    ['a plain Error whose message says timeout', new Error('timeout')],
    ['a string', 'not found'],
    ['null', null],
    ['undefined', undefined],
    ['a code of the wrong type', Object.assign(new Error('x'), { code: 404 })],
  ])('%s has no code: UB-UNKNOWN-ERROR', (_label, thrown) => {
    expect(codeOfThrown(thrown)).toBe('UB-UNKNOWN-ERROR');
  });

  it.each(['Failed to fetch', 'fetch failed', 'NetworkError when attempting to fetch resource.'])(
    'a thrown fetch-failure TypeError (%s) stays UB-NET-ERROR',
    (message) => {
      expect(codeOfThrown(new TypeError(message))).toBe('UB-NET-ERROR');
    }
  );

  it('a TypeError that is not a fetch failure is not a network error', () => {
    expect(codeOfThrown(new TypeError('x is not a function'))).toBe('UB-UNKNOWN-ERROR');
  });
});
