/**
 * Phase 2 — the documented `paramSchema` subset.
 *
 * Plan: `2026-08-20-ui-bridge-action-declaration-shape.md`, Phase 2.
 *
 * Every expectation below is a HAND-WRITTEN LITERAL — the exact strings and
 * objects a caller sees. Nothing is asserted via `satisfies`, a type
 * assertion, a constant imported from the module under test, or by re-deriving
 * the expectation from the same code path that produced it. A test written
 * against its own subject pins nothing.
 *
 * The schemas exercised here are the shapes that actually exist in the fleet
 * (census 2026-08-22): `paramSchemaOf()` output from
 * `@qontinui/ui-bridge-wrapper`, the hand-authored object-schema literal in
 * `server/component-action-wire-shape.test.ts`, and `qontinui-runner`'s ~50
 * prose hint maps.
 */

import { describe, it, expect } from 'vitest';
import { validateActionParams, formatParamValidationFailure } from './param-schema';

describe('Phase 2 — object-schema form', () => {
  it('accepts params that satisfy the schema', () => {
    const schema = {
      type: 'object',
      properties: {
        username: { type: 'string' },
        remember: { type: 'boolean' },
      },
      required: ['username'],
    };

    expect(validateActionParams(schema, { username: 'ada', remember: true })).toEqual({
      valid: true,
      issues: [],
    });
  });

  it('accepts params that omit a NON-required property', () => {
    const schema = {
      type: 'object',
      properties: {
        username: { type: 'string' },
        remember: { type: 'boolean' },
      },
      required: ['username'],
    };

    expect(validateActionParams(schema, { username: 'ada' })).toEqual({
      valid: true,
      issues: [],
    });
  });

  it('names the missing required param', () => {
    const schema = {
      type: 'object',
      properties: { username: { type: 'string' }, remember: { type: 'boolean' } },
      required: ['username'],
    };

    expect(validateActionParams(schema, { remember: true })).toEqual({
      valid: false,
      issues: [
        {
          path: 'username',
          keyword: 'required',
          expected: 'present',
          message: 'Required parameter "username" is missing.',
        },
      ],
    });
  });

  it('reports required params when `params` is omitted entirely', () => {
    const schema = {
      type: 'object',
      properties: { username: { type: 'string' } },
      required: ['username'],
    };

    expect(validateActionParams(schema, undefined)).toEqual({
      valid: false,
      issues: [
        {
          path: 'username',
          keyword: 'required',
          expected: 'present',
          message: 'Required parameter "username" is missing.',
        },
      ],
    });
  });

  it('names the wrongly-typed param, the expected type and the received value', () => {
    const schema = {
      type: 'object',
      properties: { username: { type: 'string' } },
      required: ['username'],
    };

    expect(validateActionParams(schema, { username: 5 })).toEqual({
      valid: false,
      issues: [
        {
          path: 'username',
          keyword: 'type',
          expected: 'string',
          received: '5',
          message: 'Parameter "username" must be of type string, received integer (5).',
        },
      ],
    });
  });

  it('accepts a `type` union array when the value matches any member', () => {
    const schema = {
      type: 'object',
      properties: { target: { type: ['number', 'string'] } },
    };

    expect(validateActionParams(schema, { target: 'next' })).toEqual({ valid: true, issues: [] });
    expect(validateActionParams(schema, { target: 3 })).toEqual({ valid: true, issues: [] });
    expect(validateActionParams(schema, { target: true })).toEqual({
      valid: false,
      issues: [
        {
          path: 'target',
          keyword: 'type',
          expected: 'number | string',
          received: 'true',
          message: 'Parameter "target" must be of type number | string, received boolean (true).',
        },
      ],
    });
  });

  it('distinguishes integer from number', () => {
    const schema = { type: 'object', properties: { count: { type: 'integer' } } };

    expect(validateActionParams(schema, { count: 2 })).toEqual({ valid: true, issues: [] });
    expect(validateActionParams(schema, { count: 2.5 })).toEqual({
      valid: false,
      issues: [
        {
          path: 'count',
          keyword: 'type',
          expected: 'integer',
          received: '2.5',
          message: 'Parameter "count" must be of type integer, received number (2.5).',
        },
      ],
    });
  });

  it('names the param that fell outside `enum`', () => {
    const schema = {
      type: 'object',
      properties: { mode: { type: 'string', enum: ['fast', 'slow'] } },
    };

    expect(validateActionParams(schema, { mode: 'medium' })).toEqual({
      valid: false,
      issues: [
        {
          path: 'mode',
          keyword: 'enum',
          expected: '"fast", "slow"',
          received: '"medium"',
          message: 'Parameter "mode" must be one of ["fast", "slow"], received "medium".',
        },
      ],
    });
  });

  it('enforces `const`', () => {
    const schema = { type: 'object', properties: { kind: { const: 'fixed' } } };

    expect(validateActionParams(schema, { kind: 'fixed' })).toEqual({ valid: true, issues: [] });
    expect(validateActionParams(schema, { kind: 'loose' })).toEqual({
      valid: false,
      issues: [
        {
          path: 'kind',
          keyword: 'const',
          expected: '"fixed"',
          received: '"loose"',
          message: 'Parameter "kind" must equal "fixed", received "loose".',
        },
      ],
    });
  });

  it('names an undeclared param when additionalProperties is false', () => {
    const schema = {
      type: 'object',
      properties: { username: { type: 'string' }, remember: { type: 'boolean' } },
      required: ['username'],
      additionalProperties: false,
    };

    expect(validateActionParams(schema, { username: 'ada', nickname: 'a' })).toEqual({
      valid: false,
      issues: [
        {
          path: 'nickname',
          keyword: 'additionalProperties',
          expected: 'one of [username, remember]',
          received: '"a"',
          message:
            'Parameter "nickname" is not declared by the schema, which sets additionalProperties: false.',
        },
      ],
    });
  });

  it('ignores additionalProperties when it is not exactly `false`', () => {
    const schema = {
      type: 'object',
      properties: { username: { type: 'string' } },
      additionalProperties: true,
    };

    expect(validateActionParams(schema, { username: 'ada', extra: 1 })).toEqual({
      valid: true,
      issues: [],
    });
  });

  it('enforces numeric bounds', () => {
    const schema = {
      type: 'object',
      properties: { count: { type: 'number', minimum: 1, maximum: 10 } },
    };

    expect(validateActionParams(schema, { count: 5 })).toEqual({ valid: true, issues: [] });
    expect(validateActionParams(schema, { count: 0 })).toEqual({
      valid: false,
      issues: [
        {
          path: 'count',
          keyword: 'minimum',
          expected: '>= 1',
          received: '0',
          message: 'Parameter "count" must be >= 1, received 0.',
        },
      ],
    });
    expect(validateActionParams(schema, { count: 11 })).toEqual({
      valid: false,
      issues: [
        {
          path: 'count',
          keyword: 'maximum',
          expected: '<= 10',
          received: '11',
          message: 'Parameter "count" must be <= 10, received 11.',
        },
      ],
    });
  });

  it('enforces string length and pattern', () => {
    const schema = {
      type: 'object',
      properties: {
        short: { type: 'string', minLength: 2, maxLength: 3 },
        slug: { type: 'string', pattern: '^[a-z]+$' },
      },
    };

    expect(validateActionParams(schema, { short: 'ab', slug: 'abc' })).toEqual({
      valid: true,
      issues: [],
    });
    expect(validateActionParams(schema, { short: 'a' })).toEqual({
      valid: false,
      issues: [
        {
          path: 'short',
          keyword: 'minLength',
          expected: 'length >= 2',
          received: 'length 1',
          message: 'Parameter "short" must be at least 2 characters, received 1.',
        },
      ],
    });
    expect(validateActionParams(schema, { short: 'abcd' })).toEqual({
      valid: false,
      issues: [
        {
          path: 'short',
          keyword: 'maxLength',
          expected: 'length <= 3',
          received: 'length 4',
          message: 'Parameter "short" must be at most 3 characters, received 4.',
        },
      ],
    });
    expect(validateActionParams(schema, { slug: 'AB1' })).toEqual({
      valid: false,
      issues: [
        {
          path: 'slug',
          keyword: 'pattern',
          expected: 'match /^[a-z]+$/',
          received: '"AB1"',
          message: 'Parameter "slug" must match /^[a-z]+$/, received "AB1".',
        },
      ],
    });
  });

  it('ignores an uncompilable `pattern` rather than failing on it', () => {
    const schema = { type: 'object', properties: { slug: { type: 'string', pattern: '[' } } };

    expect(validateActionParams(schema, { slug: 'anything' })).toEqual({
      valid: true,
      issues: [],
    });
  });

  it('walks `items` and reports the offending INDEX', () => {
    const schema = {
      type: 'object',
      properties: { ids: { type: 'array', items: { type: 'string' } } },
    };

    expect(validateActionParams(schema, { ids: ['a', 'b'] })).toEqual({ valid: true, issues: [] });
    expect(validateActionParams(schema, { ids: ['a', 7, 'c'] })).toEqual({
      valid: false,
      issues: [
        {
          path: 'ids[1]',
          keyword: 'type',
          expected: 'string',
          received: '7',
          message: 'Parameter "ids[1]" must be of type string, received integer (7).',
        },
      ],
    });
  });

  it('walks nested object properties and reports the DOTTED path', () => {
    const schema = {
      type: 'object',
      properties: {
        filter: {
          type: 'object',
          properties: { status: { type: 'string', enum: ['open', 'closed'] } },
          required: ['status'],
        },
      },
    };

    expect(validateActionParams(schema, { filter: { status: 'open' } })).toEqual({
      valid: true,
      issues: [],
    });
    expect(validateActionParams(schema, { filter: {} })).toEqual({
      valid: false,
      issues: [
        {
          path: 'filter.status',
          keyword: 'required',
          expected: 'present',
          message: 'Required parameter "filter.status" is missing.',
        },
      ],
    });
    expect(validateActionParams(schema, { filter: { status: 'archived' } })).toEqual({
      valid: false,
      issues: [
        {
          path: 'filter.status',
          keyword: 'enum',
          expected: '"open", "closed"',
          received: '"archived"',
          message: 'Parameter "filter.status" must be one of ["open", "closed"], received "archived".',
        },
      ],
    });
  });

  it('reports a non-object `params` bag', () => {
    const schema = {
      type: 'object',
      properties: { username: { type: 'string' } },
      required: ['username'],
    };

    expect(validateActionParams(schema, 'nope')).toEqual({
      valid: false,
      issues: [
        {
          path: '',
          keyword: 'type',
          expected: 'object',
          received: '"nope"',
          message: 'Action params must be an object, received string ("nope").',
        },
      ],
    });
  });

  it('reports only the type issue for a wrongly-typed value, not the bound it cannot satisfy', () => {
    const schema = {
      type: 'object',
      properties: { count: { type: 'number', minimum: 5 } },
    };

    expect(validateActionParams(schema, { count: 'many' })).toEqual({
      valid: false,
      issues: [
        {
          path: 'count',
          keyword: 'type',
          expected: 'number',
          received: '"many"',
          message: 'Parameter "count" must be of type number, received string ("many").',
        },
      ],
    });
  });
});

describe('Phase 2 — unknown keywords are IGNORED, never rejected', () => {
  it('passes a schema carrying keywords outside the documented subset', () => {
    const schema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'Login',
      type: 'object',
      properties: {
        username: {
          type: 'string',
          description: 'The account name',
          default: 'anonymous',
          format: 'email',
          examples: ['a@b.c'],
        },
      },
      required: ['username'],
      minProperties: 5,
      patternProperties: { '^x-': { type: 'string' } },
      oneOf: [{ required: ['nothing-like-this'] }],
      $defs: { Nope: { type: 'string' } },
    };

    expect(validateActionParams(schema, { username: 'ada' })).toEqual({
      valid: true,
      issues: [],
    });
  });

  it('treats an unrecognised `type` name as no constraint', () => {
    const schema = { type: 'object', properties: { thing: { type: 'Widget' } } };

    expect(validateActionParams(schema, { thing: 12345 })).toEqual({ valid: true, issues: [] });
  });

  it('treats a schema that is not an object as no constraint', () => {
    expect(validateActionParams(null, { anything: 1 })).toEqual({ valid: true, issues: [] });
    expect(validateActionParams(['a'], { anything: 1 })).toEqual({ valid: true, issues: [] });
    expect(validateActionParams('string', { anything: 1 })).toEqual({ valid: true, issues: [] });
  });

  it('treats `{ type: "object" }` with nothing else as no constraint', () => {
    expect(validateActionParams({ type: 'object' }, { anything: 1 })).toEqual({
      valid: true,
      issues: [],
    });
  });
});

describe('Phase 2 — map form', () => {
  it('type-checks a primitive type-name map', () => {
    const schema = { username: 'string', count: 'number' };

    expect(validateActionParams(schema, { username: 'ada', count: 2 })).toEqual({
      valid: true,
      issues: [],
    });
    expect(validateActionParams(schema, { username: 'ada', count: 'two' })).toEqual({
      valid: false,
      issues: [
        {
          path: 'count',
          keyword: 'type',
          expected: 'number',
          received: '"two"',
          message: 'Parameter "count" must be of type number, received string ("two").',
        },
      ],
    });
  });

  it('never marks a map-form param required', () => {
    const schema = { username: 'string', count: 'number' };

    expect(validateActionParams(schema, {})).toEqual({ valid: true, issues: [] });
    expect(validateActionParams(schema, undefined)).toEqual({ valid: true, issues: [] });
  });

  it("accepts qontinui-runner's prose hint maps without a single violation", () => {
    // Verbatim from `qontinui-runner/src/components/terminal/commands/
    // useTerminalCommands.ts` `SCHEMA.spawnAi` — the largest real population of
    // `paramSchema` values in the fleet. Every value is a human hint, not a
    // type name, and the "--tenant" key is a CLI flag marker.
    const schema = {
      count: 'number (>= 1, defaults to 1)',
      account:
        'string — either a Claude account label (e.g. "gmail", "hotmail") or the literal "best" to pick the lowest-utilization account',
      context: 'string (optional initial prompt auto-typed after `claude` starts)',
      '--tenant':
        "string (optional tenant slug or uuid this spawn binds to; defaults to the device's active tenant)",
    };

    expect(validateActionParams(schema, { count: 2 })).toEqual({ valid: true, issues: [] });
    expect(validateActionParams(schema, {})).toEqual({ valid: true, issues: [] });
    expect(validateActionParams(schema, { count: 'two', account: 7 })).toEqual({
      valid: true,
      issues: [],
    });
  });

  it('reads `{ type: "string" }` as a map declaring a param NAMED type', () => {
    // Verbatim from `qontinui-runner/src/components/terminal/commands/
    // useTerminalCommands.ts:1032` — `type` is a field name there, not the
    // JSON Schema keyword.
    const schema = {
      type: 'string — one of "session-summary", "architecture", "change-impact"',
    };

    expect(validateActionParams(schema, { type: 'architecture' })).toEqual({
      valid: true,
      issues: [],
    });

    // And with a real primitive name, the same key is type-checked as a param.
    expect(validateActionParams({ type: 'string' }, { type: 9 })).toEqual({
      valid: false,
      issues: [
        {
          path: 'type',
          keyword: 'type',
          expected: 'string',
          received: '9',
          message: 'Parameter "type" must be of type string, received integer (9).',
        },
      ],
    });
  });

  it('strips the monorepo-only `optional` marker from a map-form property schema', () => {
    const schema = { verbose: { type: 'boolean', optional: true } };

    expect(validateActionParams(schema, { verbose: true })).toEqual({ valid: true, issues: [] });
    expect(validateActionParams(schema, {})).toEqual({ valid: true, issues: [] });
    expect(validateActionParams(schema, { verbose: 'yes' })).toEqual({
      valid: false,
      issues: [
        {
          path: 'verbose',
          keyword: 'type',
          expected: 'boolean',
          received: '"yes"',
          message: 'Parameter "verbose" must be of type boolean, received string ("yes").',
        },
      ],
    });
  });

  it('accepts an empty map', () => {
    expect(validateActionParams({}, { whatever: 1 })).toEqual({ valid: true, issues: [] });
  });
});

describe('Phase 2 — real fleet schemas', () => {
  it('accepts a paramSchemaOf() output for conforming params', () => {
    // Verbatim expected output from `@qontinui/ui-bridge-wrapper`
    // `helpers.test.ts:163` — `paramSchemaOf({ email, password, remember })`.
    const schema = {
      type: 'object',
      properties: {
        email: { type: 'string' },
        password: { type: 'string' },
        remember: { type: 'boolean' },
      },
      required: ['email', 'password', 'remember'],
      additionalProperties: false,
    };

    expect(
      validateActionParams(schema, { email: 'a@b.c', password: 'hunter2', remember: false })
    ).toEqual({ valid: true, issues: [] });
  });

  it('accepts a paramSchemaOf() output that OMITS `required` entirely', () => {
    // Verbatim from `helpers.test.ts:211` — the all-optional case. `required`
    // is absent, which means "nothing required", never "malformed".
    const schema = {
      type: 'object',
      properties: { flag: { type: 'boolean' } },
      additionalProperties: false,
    };

    expect(validateActionParams(schema, {})).toEqual({ valid: true, issues: [] });
    expect(validateActionParams(schema, { flag: true })).toEqual({ valid: true, issues: [] });
  });

  it('reports every violation of a paramSchemaOf() output at once', () => {
    const schema = {
      type: 'object',
      properties: {
        email: { type: 'string' },
        remember: { type: 'boolean' },
      },
      required: ['email'],
      additionalProperties: false,
    };

    expect(validateActionParams(schema, { remember: 'yes', extra: 1 })).toEqual({
      valid: false,
      issues: [
        {
          path: 'email',
          keyword: 'required',
          expected: 'present',
          message: 'Required parameter "email" is missing.',
        },
        {
          path: 'extra',
          keyword: 'additionalProperties',
          expected: 'one of [email, remember]',
          received: '1',
          message:
            'Parameter "extra" is not declared by the schema, which sets additionalProperties: false.',
        },
        {
          path: 'remember',
          keyword: 'type',
          expected: 'boolean',
          received: '"yes"',
          message: 'Parameter "remember" must be of type boolean, received string ("yes").',
        },
      ],
    });
  });
});

describe('Phase 2 — failure message', () => {
  it('names the component, the action, and every offending param', () => {
    const schema = {
      type: 'object',
      properties: { username: { type: 'string' } },
      required: ['username'],
    };
    const result = validateActionParams(schema, { username: 5 });

    expect(formatParamValidationFailure('login-form', 'submit', result.issues)).toBe(
      'Action "submit" on component "login-form" was rejected: params do not match the ' +
        "action's declared paramSchema. " +
        'Parameter "username" must be of type string, received integer (5).'
    );
  });
});
