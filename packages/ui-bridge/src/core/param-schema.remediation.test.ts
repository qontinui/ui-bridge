/**
 * Pre-PR review remediation for `core/param-schema.ts` (qontinui/ui-bridge#163).
 *
 * Plan: `2026-08-20-ui-bridge-action-declaration-shape.md`, Phase 2.
 *
 * Five defects the review found in the validator this PR introduced. Four of
 * them are the SAME class the whole PR exists to fix — a declaration that
 * quietly stops meaning anything:
 *
 *   1. a map-form schema declaring a param named `type` was read as object
 *      form, so **every sibling constraint in it was silently dropped**;
 *   2. `additionalProperties: false` with no `properties` accepted everything;
 *   3. `key in value` walked the prototype chain, so a param named `toString`
 *      was never reported missing and was checked against `Object.prototype`;
 *   4. `enum`/`const` messages rendered every object as the literal word
 *      "object", and `const` compared via `JSON.stringify`, so an equal value
 *      with different key order was rejected;
 *   5. the validator could throw (self-referential schema) or hang (ReDoS
 *      `pattern`) instead of returning a verdict.
 *
 * Every expectation below is a hand-written literal. Nothing is asserted via a
 * constant, type, helper or `satisfies` from the module under test.
 */

import { describe, it, expect } from 'vitest';
import { validateActionParams } from './param-schema';

describe('map-form disambiguation: a param named "type" (review #5)', () => {
  it('validates the SIBLING params of a map that declares a param named "type"', () => {
    // The exact repro from the review. Before the fix this answered
    // `{ valid: true }`: `type === 'object'` sent it down the object-form
    // branch, which found no `properties` and returned "no constraint" —
    // dropping the `id: 'string'` declaration entirely.
    const result = validateActionParams({ type: 'object', id: 'string' }, { id: 12345 });

    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].path).toBe('id');
    expect(result.issues[0].keyword).toBe('type');
    expect(result.issues[0].expected).toBe('string');
    expect(result.issues[0].message).toBe(
      'Parameter "id" must be of type string, received integer (12345).'
    );
  });

  it('still validates the "type" param itself in that map', () => {
    const result = validateActionParams(
      { type: 'object', id: 'string' },
      { type: 'not-an-object', id: 'ok' }
    );

    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].path).toBe('type');
    expect(result.issues[0].keyword).toBe('type');
  });

  it('accepts the conforming payload for that same map', () => {
    expect(validateActionParams({ type: 'object', id: 'string' }, { id: 'abc' })).toEqual({
      valid: true,
      issues: [],
    });
  });

  it('still reads a real object schema as object form', () => {
    const schema = {
      type: 'object',
      properties: { username: { type: 'string' } },
      required: ['username'],
    };

    expect(validateActionParams(schema, { username: 'ada' })).toEqual({ valid: true, issues: [] });

    const missing = validateActionParams(schema, {});
    expect(missing.valid).toBe(false);
    expect(missing.issues).toHaveLength(1);
    expect(missing.issues[0].path).toBe('username');
    expect(missing.issues[0].keyword).toBe('required');
  });

  it('still reads an object schema carrying only schema keywords as object form', () => {
    // `title`/`description` are schema keywords, not param names, so this must
    // NOT flip to map form and start demanding a param called `description`.
    const schema = {
      type: 'object',
      title: 'Login',
      description: 'Signs a user in',
      properties: { username: { type: 'string' } },
    };
    expect(validateActionParams(schema, { username: 'ada' })).toEqual({ valid: true, issues: [] });
  });

  it('still reads `{ type: "string" }` as a map declaring a param named "type"', () => {
    const result = validateActionParams({ type: 'string' }, { type: 99 });
    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].path).toBe('type');
    expect(result.issues[0].expected).toBe('string');
  });

  it('reads a bare `{ type: "object" }` as an empty object schema (constrains nothing)', () => {
    expect(validateActionParams({ type: 'object' }, { anything: 1 })).toEqual({
      valid: true,
      issues: [],
    });
  });
});

describe('additionalProperties: false with no properties (review #6)', () => {
  it('rejects every supplied param — "this action takes no params at all"', () => {
    const result = validateActionParams(
      { type: 'object', additionalProperties: false },
      { anything: 1 }
    );

    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].path).toBe('anything');
    expect(result.issues[0].keyword).toBe('additionalProperties');
    expect(result.issues[0].expected).toBe('no parameters');
    expect(result.issues[0].message).toBe(
      'Parameter "anything" is not declared by the schema, which sets additionalProperties: false.'
    );
  });

  it('accepts an empty params bag against that schema', () => {
    expect(validateActionParams({ type: 'object', additionalProperties: false }, {})).toEqual({
      valid: true,
      issues: [],
    });
  });

  it('accepts undefined params against that schema', () => {
    expect(
      validateActionParams({ type: 'object', additionalProperties: false }, undefined)
    ).toEqual({ valid: true, issues: [] });
  });

  it('still names the declared keys when there ARE properties', () => {
    const result = validateActionParams(
      {
        type: 'object',
        properties: { a: { type: 'string' } },
        additionalProperties: false,
      },
      { a: 'x', b: 2 }
    );
    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].expected).toBe('one of [a]');
  });

  it('enforces additionalProperties: false on a NESTED object with no properties', () => {
    const result = validateActionParams(
      {
        type: 'object',
        properties: { filter: { type: 'object', additionalProperties: false } },
      },
      { filter: { nope: 1 } }
    );
    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].path).toBe('filter.nope');
    expect(result.issues[0].keyword).toBe('additionalProperties');
  });
});

describe('own-property tests, not `in` (review #7)', () => {
  it('reports a required param named "toString" as missing', () => {
    // `'toString' in {}` is TRUE — it lives on Object.prototype. With `in`,
    // this required param was never reported missing.
    const result = validateActionParams(
      { type: 'object', properties: { toString: { type: 'string' } }, required: ['toString'] },
      {}
    );

    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].path).toBe('toString');
    expect(result.issues[0].keyword).toBe('required');
    expect(result.issues[0].message).toBe('Required parameter "toString" is missing.');
  });

  it('reports a required param named "constructor" as missing', () => {
    const result = validateActionParams(
      { type: 'object', properties: {}, required: ['constructor'] },
      {}
    );
    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].path).toBe('constructor');
    expect(result.issues[0].keyword).toBe('required');
  });

  it('does not validate an ABSENT "valueOf" param against Object.prototype.valueOf', () => {
    // With `in`, this walked into `Object.prototype.valueOf` (a function) and
    // reported a spurious `type` violation on a param nobody supplied.
    expect(
      validateActionParams({ type: 'object', properties: { valueOf: { type: 'string' } } }, {})
    ).toEqual({ valid: true, issues: [] });
  });

  it('still validates a SUPPLIED param named "toString"', () => {
    const result = validateActionParams(
      { type: 'object', properties: { toString: { type: 'string' } } },
      { toString: 42 }
    );
    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].path).toBe('toString');
    expect(result.issues[0].keyword).toBe('type');
  });

  it('accepts a supplied param named "hasOwnProperty" of the declared type', () => {
    expect(
      validateActionParams(
        { type: 'object', properties: { hasOwnProperty: { type: 'string' } } },
        { hasOwnProperty: 'yes' }
      )
    ).toEqual({ valid: true, issues: [] });
  });
});

describe('enum/const rendering and equality (review #8)', () => {
  it('renders a const object structurally, not as the word "object"', () => {
    const result = validateActionParams(
      { type: 'object', properties: { mode: { const: { kind: 'fast', retries: 2 } } } },
      { mode: { kind: 'slow', retries: 2 } }
    );

    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].keyword).toBe('const');
    expect(result.issues[0].expected).toBe('{"kind":"fast","retries":2}');
    expect(result.issues[0].received).toBe('{"kind":"slow","retries":2}');
    expect(result.issues[0].message).toBe(
      'Parameter "mode" must equal {"kind":"fast","retries":2}, received {"kind":"slow","retries":2}.'
    );
  });

  it('renders enum members structurally', () => {
    const result = validateActionParams(
      { type: 'object', properties: { pick: { enum: [{ a: 1 }, { b: 2 }] } } },
      { pick: { c: 3 } }
    );

    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].keyword).toBe('enum');
    expect(result.issues[0].expected).toBe('{"a":1}, {"b":2}');
    expect(result.issues[0].received).toBe('{"c":3}');
    expect(result.issues[0].message).toBe(
      'Parameter "pick" must be one of [{"a":1}, {"b":2}], received {"c":3}.'
    );
  });

  it('accepts a const object supplied with DIFFERENT key order', () => {
    // `JSON.stringify` comparison rejected this. Key order is not semantic in
    // JSON and the caller does not choose it.
    expect(
      validateActionParams(
        { type: 'object', properties: { filter: { const: { a: 1, b: 2 } } } },
        { filter: { b: 2, a: 1 } }
      )
    ).toEqual({ valid: true, issues: [] });
  });

  it('accepts a NESTED const object with different key order', () => {
    expect(
      validateActionParams(
        { type: 'object', properties: { f: { const: { outer: { a: 1, b: 2 }, z: 3 } } } },
        { f: { z: 3, outer: { b: 2, a: 1 } } }
      )
    ).toEqual({ valid: true, issues: [] });
  });

  it('accepts an enum member supplied with different key order', () => {
    expect(
      validateActionParams(
        { type: 'object', properties: { p: { enum: [{ a: 1, b: 2 }] } } },
        { p: { b: 2, a: 1 } }
      )
    ).toEqual({ valid: true, issues: [] });
  });

  it('still rejects an object with an EXTRA key against a const', () => {
    const result = validateActionParams(
      { type: 'object', properties: { f: { const: { a: 1 } } } },
      { f: { a: 1, b: 2 } }
    );
    expect(result.valid).toBe(false);
    expect(result.issues[0].keyword).toBe('const');
  });

  it('still rejects an array of the same members in a different ORDER (arrays are ordered)', () => {
    const result = validateActionParams(
      { type: 'object', properties: { f: { const: [1, 2] } } },
      { f: [2, 1] }
    );
    expect(result.valid).toBe(false);
    expect(result.issues[0].keyword).toBe('const');
  });

  it('keeps scalar const messages readable', () => {
    const result = validateActionParams(
      { type: 'object', properties: { v: { const: 'exact' } } },
      { v: 'other' }
    );
    expect(result.issues[0].message).toBe('Parameter "v" must equal "exact", received "other".');
  });

  it('does not confuse an object and an array carrying the same entries', () => {
    const result = validateActionParams(
      { type: 'object', properties: { f: { const: { 0: 'a' } } } },
      { f: ['a'] }
    );
    expect(result.valid).toBe(false);
  });
});

describe('the validator returns a verdict, it never throws or hangs (review #9)', () => {
  it('survives a self-referential paramSchema instead of blowing the stack', () => {
    const schema: Record<string, unknown> = { type: 'object', properties: {} };
    (schema.properties as Record<string, unknown>).self = schema;

    // Params deep enough that an unbounded walk blows the stack. (A cyclic
    // params object would too, but a plain deep chain is the shape a real
    // caller can actually send as JSON.)
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let i = 0; i < 20000; i += 1) {
      const next: Record<string, unknown> = {};
      cursor.self = next;
      cursor = next;
    }

    // Before the depth bound this recursed to `RangeError: Maximum call stack
    // size exceeded`, which the invocation seam could only label
    // `UB-ACTION-FAILED` — i.e. blame a handler that never ran.
    expect(() => validateActionParams(schema, { self: deep })).not.toThrow();
    expect(validateActionParams(schema, { self: deep }).valid).toBe(true);
  });

  it('survives a cyclic params value under a const', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(() =>
      validateActionParams(
        { type: 'object', properties: { f: { const: { a: 1 } } } },
        { f: cyclic }
      )
    ).not.toThrow();
  });

  it('ignores a catastrophically-backtracking pattern instead of hanging on it', () => {
    // `(a+)+$` is the textbook catastrophic-backtracking shape: against a long
    // non-matching input it is exponential, and no try/catch can rescue a hang
    // because the engine never returns. The only defence is not to compile it,
    // so the keyword must be IGNORED — which is what this pins. (How long any
    // particular engine takes on any particular input is not the contract; not
    // running it is.)
    const started = Date.now();
    const result = validateActionParams(
      { type: 'object', properties: { s: { pattern: '(a+)+$' } } },
      { s: `${'a'.repeat(30)}!` }
    );
    const elapsed = Date.now() - started;

    expect(result).toEqual({ valid: true, issues: [] });
    expect(elapsed).toBeLessThan(1000);
  });

  it('ignores an over-long pattern', () => {
    expect(
      validateActionParams(
        { type: 'object', properties: { s: { pattern: `^${'x'.repeat(400)}$` } } },
        { s: 'anything' }
      )
    ).toEqual({ valid: true, issues: [] });
  });

  it('still enforces an ordinary pattern', () => {
    const result = validateActionParams(
      { type: 'object', properties: { s: { pattern: '^[a-z]+$' } } },
      { s: 'ABC' }
    );
    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].keyword).toBe('pattern');
    expect(result.issues[0].message).toBe('Parameter "s" must match /^[a-z]+$/, received "ABC".');
  });
});
