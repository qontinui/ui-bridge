/**
 * Tests for the authHeader hook helpers in useCommandRelay.
 *
 * The hook itself attaches to a React component lifecycle and is tested
 * via integration in the consuming app. The helpers it composes
 * (`resolveAuthToken`, `transportHeaders`, `appendAuthQuery`) are pure
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
  __test_appendAuthQuery as appendAuthQuery,
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

describe('appendAuthQuery', () => {
  it('returns the url unchanged when no token resolves', () => {
    const url = 'https://example.com/api/ui-bridge/commands/stream';
    expect(appendAuthQuery(url, undefined)).toBe(url);
    expect(appendAuthQuery(url, (() => null) as Hook)).toBe(url);
  });

  it('appends ?_auth=<token> on a url with no existing query', () => {
    const url = 'https://example.com/api/ui-bridge/commands/stream';
    expect(appendAuthQuery(url, (() => 'abc') as Hook)).toBe(
      'https://example.com/api/ui-bridge/commands/stream?_auth=abc',
    );
  });

  it('appends &_auth=<token> on a url with an existing query', () => {
    const url =
      'https://example.com/api/ui-bridge/commands/stream?tabId=foo';
    expect(appendAuthQuery(url, (() => 'abc') as Hook)).toBe(
      'https://example.com/api/ui-bridge/commands/stream?tabId=foo&_auth=abc',
    );
  });

  it('URL-encodes the token value so dots / slashes survive', () => {
    // A real JWT looks like header.payload.signature; the value contains
    // base64url characters that are URL-safe, but we encode defensively.
    expect(
      appendAuthQuery(
        'https://example.com/x',
        (() => 'aBc.dEf.gHi-_~') as Hook,
      ),
    ).toBe('https://example.com/x?_auth=aBc.dEf.gHi-_~');
    expect(
      appendAuthQuery('https://example.com/x', (() => 'has space') as Hook),
    ).toBe('https://example.com/x?_auth=has%20space');
  });

  it('uses the trimmed token in the query', () => {
    expect(
      appendAuthQuery(
        'https://example.com/x',
        (() => '   padded   ') as Hook,
      ),
    ).toBe('https://example.com/x?_auth=padded');
  });
});
