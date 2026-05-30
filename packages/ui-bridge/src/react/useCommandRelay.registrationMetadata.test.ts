/**
 * Tests for the `registrationMetadata` resolver in useCommandRelay.
 *
 * Mirrors `useCommandRelay.authHeader.test.ts`: the heartbeat-emitting
 * effect itself is exercised via integration in qontinui-web, but the
 * pure normalization helper that gates whether a `registrationMetadata`
 * envelope is attached to the heartbeat body lives next to the source
 * so we can pin its contract end-to-end.
 *
 * Strict-mode contract: the server-side relay rejects any heartbeat
 * that omits a complete `{userId, sessionId}` envelope. The resolver's
 * job is to ensure half-valid or buggy implementations return `null`
 * (so the SDK does NOT ship a malformed envelope the server would
 * reject anyway). A returned value MUST be `{userId, sessionId}` with
 * both fields non-empty trimmed strings.
 */

import { describe, it, expect } from 'vitest';
import { __test_resolveRegistrationMetadata as resolveRegistrationMetadata } from './useCommandRelay';

type Hook = Parameters<typeof resolveRegistrationMetadata>[0];

describe('resolveRegistrationMetadata', () => {
  it('returns null when no hook is supplied', () => {
    expect(resolveRegistrationMetadata(undefined)).toBe(null);
  });

  it('returns null when the hook returns null / undefined', () => {
    expect(resolveRegistrationMetadata((() => null) as Hook)).toBe(null);
    expect(resolveRegistrationMetadata((() => undefined) as Hook)).toBe(null);
  });

  it('returns the normalized envelope when both fields resolve', () => {
    expect(
      resolveRegistrationMetadata((() => ({ userId: 'u1', sessionId: 'sess-abc' })) as Hook),
    ).toEqual({ userId: 'u1', sessionId: 'sess-abc' });
  });

  it('trims whitespace from both fields', () => {
    expect(
      resolveRegistrationMetadata(
        (() => ({ userId: '  alice  ', sessionId: '  s1\n' })) as Hook,
      ),
    ).toEqual({ userId: 'alice', sessionId: 's1' });
  });

  it('returns null when userId is missing / empty / non-string', () => {
    expect(
      resolveRegistrationMetadata((() => ({ sessionId: 's1' }) as never) as Hook),
    ).toBe(null);
    expect(
      resolveRegistrationMetadata((() => ({ userId: '', sessionId: 's1' })) as Hook),
    ).toBe(null);
    expect(
      resolveRegistrationMetadata((() => ({ userId: '   ', sessionId: 's1' })) as Hook),
    ).toBe(null);
     
    expect(
      resolveRegistrationMetadata((() => ({ userId: 42 as unknown as string, sessionId: 's1' })) as Hook),
    ).toBe(null);
  });

  it('returns null when sessionId is missing / empty / non-string', () => {
    expect(
      resolveRegistrationMetadata((() => ({ userId: 'u1' }) as never) as Hook),
    ).toBe(null);
    expect(
      resolveRegistrationMetadata((() => ({ userId: 'u1', sessionId: '' })) as Hook),
    ).toBe(null);
    expect(
      resolveRegistrationMetadata(
        (() => ({ userId: 'u1', sessionId: '\t  \n' })) as Hook,
      ),
    ).toBe(null);
  });

  it('returns null for non-object return values (defensive)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(resolveRegistrationMetadata((() => 'sometoken' as any) as Hook)).toBe(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(resolveRegistrationMetadata((() => 42 as any) as Hook)).toBe(null);
  });

  it('returns null when the hook throws (defensive)', () => {
    expect(
      resolveRegistrationMetadata(
        (() => {
          throw new Error('storage unavailable');
        }) as Hook,
      ),
    ).toBe(null);
  });
});
