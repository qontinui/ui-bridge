/**
 * Tests for the authHeader hook helpers in useCommandRelay.
 *
 * The hook itself attaches to a React component lifecycle and is tested
 * via integration in the consuming app. The helpers it composes
 * (`resolveAuthToken`, `transportHeaders`, `parseSSEDataBlock`) are pure
 * functions and the security boundary that matters; lock them here.
 *
 * The helpers are NOT publicly exported from the package — this test
 * file lives next to the source so it can import them via the source
 * module, not the published entry point.
 */

import { describe, it, expect } from 'vitest';

// Import the source module directly so we can reach the internal helpers
// that are intentionally not in the public surface.
import {
  // The public option type, re-exported alongside the helpers below.
  type UseCommandRelayOptions,
} from './useCommandRelay';

// Re-implement the helper signatures here to keep the test honest about
// the contract. The actual implementations live inside useCommandRelay.ts
// — we import them via a thin re-export.
// (When the implementation drifts from these signatures, the import
// statement breaks and the test surfaces the API change.)
import {
  __test_resolveAuthToken as resolveAuthToken,
  __test_transportHeaders as transportHeaders,
  __test_parseSSEDataBlock as parseSSEDataBlock,
} from './useCommandRelay';

type Hook = UseCommandRelayOptions['authHeader'];

describe('resolveAuthToken', () => {
  it('returns null when no hook is supplied', () => {
    expect(resolveAuthToken(undefined)).toBe(null);
  });

  it('returns null when the hook returns null / undefined', () => {
    expect(resolveAuthToken((() => null) as Hook)).toBe(null);
    expect(resolveAuthToken((() => undefined) as Hook)).toBe(null);
  });

  it('returns null when the hook returns an empty / whitespace string', () => {
    expect(resolveAuthToken((() => '') as Hook)).toBe(null);
    expect(resolveAuthToken((() => '   ') as Hook)).toBe(null);
  });

  it('returns the trimmed token when the hook returns a non-empty string', () => {
    expect(resolveAuthToken((() => 'eyJhbGc.token') as Hook)).toBe(
      'eyJhbGc.token',
    );
    expect(resolveAuthToken((() => '  padded  ') as Hook)).toBe('padded');
  });

  it('returns null when the hook returns a non-string (defensive)', () => {
    // The hook signature says `string | null | undefined`, but a consumer
    // could pass a buggy implementation. Don't crash; treat as no token.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(resolveAuthToken((() => 42 as any) as Hook)).toBe(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(resolveAuthToken((() => ({}) as any) as Hook)).toBe(null);
  });

  it('returns null when the hook throws (defensive)', () => {
    expect(
      resolveAuthToken((() => {
        throw new Error('storage unavailable');
      }) as Hook),
    ).toBe(null);
  });
});

describe('transportHeaders', () => {
  it('returns just Content-Type when no token is available', () => {
    expect(transportHeaders(undefined)).toEqual({
      'Content-Type': 'application/json',
    });
    expect(transportHeaders((() => null) as Hook)).toEqual({
      'Content-Type': 'application/json',
    });
  });

  it('attaches Authorization: Bearer when a token resolves', () => {
    expect(transportHeaders((() => 'tok-123') as Hook)).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer tok-123',
    });
  });

  it('uses the trimmed token in the Authorization header', () => {
    expect(transportHeaders((() => '  padded-token  ') as Hook)).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer padded-token',
    });
  });

  it('omits Authorization when the hook returns empty after trim', () => {
    expect(transportHeaders((() => '   ') as Hook)).toEqual({
      'Content-Type': 'application/json',
    });
  });
});

describe('parseSSEDataBlock', () => {
  it('extracts the data payload from a single data: line', () => {
    expect(parseSSEDataBlock('data: {"a":1}')).toBe('{"a":1}');
  });

  it('returns null for a comment-only (heartbeat) block', () => {
    expect(parseSSEDataBlock(': heartbeat')).toBe(null);
  });

  it('returns null for an empty block', () => {
    expect(parseSSEDataBlock('')).toBe(null);
  });

  it('ignores event: lines and returns just the data payload', () => {
    expect(parseSSEDataBlock('event: foo\ndata: {"x":2}')).toBe('{"x":2}');
  });

  it('joins multi-line data: payloads with a newline', () => {
    expect(parseSSEDataBlock('data: line1\ndata: line2')).toBe('line1\nline2');
  });

  it('preserves data with no leading space after the colon', () => {
    expect(parseSSEDataBlock('data:nospace')).toBe('nospace');
  });
});
