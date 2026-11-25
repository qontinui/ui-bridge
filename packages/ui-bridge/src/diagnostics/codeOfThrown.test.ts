/**
 * `codeOfThrown` reads a thrown value's TYPE, never its message.
 *
 * Plan 2026-11-21-ui-bridge-relay-follow-ups-from-434-438 Phase 2: both
 * transports used to guess a thrown error's code from substrings of its
 * message, so a reworded message silently changed the code and the two
 * transports disagreed about the same failure.
 */

import { describe, expect, it } from 'vitest';
import { codeOfThrown, mapInternalErrorCode } from './index';

const coded = (message: string, code: string) => Object.assign(new Error(message), { code });

describe('codeOfThrown', () => {
  it.each([
    ['ELEMENT_NOT_FOUND', 'UB-ELEM-NOT-FOUND'],
    ['VALIDATION_ERROR', 'UB-VALIDATION-ERROR'],
    ['UNSUPPORTED_ACTION', 'UB-UNSUPPORTED-ACTION'],
    ['TIMEOUT', 'UB-ACTION-TIMEOUT'],
    ['NETWORK_ERROR', 'UB-NET-ERROR'],
    ['ECONNREFUSED', 'UB-NET-ERROR'],
    ['ECONNRESET', 'UB-NET-ERROR'],
    ['ENOTFOUND', 'UB-NET-ERROR'],
    ['EAI_AGAIN', 'UB-NET-ERROR'],
    ['ETIMEDOUT', 'UB-ACTION-TIMEOUT'],
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

  it.each([
    'x is not a function',
    "Cannot read properties of undefined (reading 'prefetch')",
    'networking is off',
  ])('a TypeError that is not a fetch failure (%s) is not a network error', (message) => {
    expect(codeOfThrown(new TypeError(message))).toBe('UB-UNKNOWN-ERROR');
  });

  it('a TimeoutError by NAME is a timeout, whatever its message says', () => {
    expect(codeOfThrown(new DOMException('signal timed out', 'TimeoutError'))).toBe(
      'UB-ACTION-TIMEOUT'
    );
    expect(codeOfThrown(Object.assign(new Error('reworded'), { name: 'TimeoutError' }))).toBe(
      'UB-ACTION-TIMEOUT'
    );
    expect(codeOfThrown(new Error('timeout'))).toBe('UB-UNKNOWN-ERROR');
  });

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'a code naming an Object.prototype member (%s) does not resolve through the prototype',
    (code) => {
      expect(codeOfThrown(coded('x', code))).toBe('UB-UNKNOWN-ERROR');
      expect(mapInternalErrorCode(code)).toBe('UB-UNKNOWN-ERROR');
    }
  );

  it('a non-string code (a DOMException numeric code) is UB-UNKNOWN-ERROR', () => {
    expect(codeOfThrown(new DOMException('gone', 'NotFoundError'))).toBe('UB-UNKNOWN-ERROR');
  });
});
