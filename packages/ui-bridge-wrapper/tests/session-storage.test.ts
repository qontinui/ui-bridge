import { describe, it, expect } from 'vitest';
import { mergeSessionStorageIntoArtifact } from '../src/session-storage-capture.js';
import { splitSessionStorageArtifact } from '@qontinui/ui-bridge-headless';

// These two pure helpers are the contract of the sessionStorage parity feature:
//   - merge (capture side, login-web-cli) folds the captured sessionStorage map
//     into the storageState artifact under the custom `__sessionStorage` key.
//   - split (restore side, launcher) extracts that map AND returns a CLEANED
//     storageState object with the custom key removed, so Playwright's
//     `newContext({ storageState })` schema validation doesn't reject it.

describe('mergeSessionStorageIntoArtifact (capture side)', () => {
  it('adds __sessionStorage for the origin without disturbing cookies/origins', () => {
    const artifact = {
      cookies: [{ name: 'sid', value: 'abc' }],
      origins: [{ origin: 'https://qontinui.io', localStorage: [{ name: 'k', value: 'v' }] }],
    };
    mergeSessionStorageIntoArtifact(artifact as Record<string, unknown>, 'https://qontinui.io', {
      auth_bearer_access_token: 'TOKEN',
    });
    expect((artifact as Record<string, unknown>).__sessionStorage).toEqual({
      'https://qontinui.io': { auth_bearer_access_token: 'TOKEN' },
    });
    // Untouched.
    expect(artifact.cookies).toEqual([{ name: 'sid', value: 'abc' }]);
    expect(artifact.origins).toEqual([
      { origin: 'https://qontinui.io', localStorage: [{ name: 'k', value: 'v' }] },
    ]);
  });

  it('preserves sessionStorage already recorded for other origins', () => {
    const artifact: Record<string, unknown> = {
      __sessionStorage: { 'https://other.example': { foo: 'bar' } },
    };
    mergeSessionStorageIntoArtifact(artifact, 'https://qontinui.io', { tok: 't' });
    expect(artifact.__sessionStorage).toEqual({
      'https://other.example': { foo: 'bar' },
      'https://qontinui.io': { tok: 't' },
    });
  });

  it('records an empty map for an origin with no sessionStorage', () => {
    const artifact: Record<string, unknown> = { cookies: [] };
    mergeSessionStorageIntoArtifact(artifact, 'https://qontinui.io', {});
    expect(artifact.__sessionStorage).toEqual({ 'https://qontinui.io': {} });
  });

  it('returns the same (mutated) object', () => {
    const artifact: Record<string, unknown> = {};
    const out = mergeSessionStorageIntoArtifact(artifact, 'https://x.io', { a: '1' });
    expect(out).toBe(artifact);
  });
});

describe('splitSessionStorageArtifact (restore side)', () => {
  it('strips __sessionStorage from the storageState and returns the map', () => {
    const artifact = {
      cookies: [{ name: 'sid', value: 'abc' }],
      origins: [{ origin: 'https://qontinui.io', localStorage: [] }],
      __sessionStorage: { 'https://qontinui.io': { auth_bearer_access_token: 'TOKEN' } },
    };
    const { storageState, sessionStorage } = splitSessionStorageArtifact(artifact);

    // CLEANED object must NOT carry the custom key (Playwright rejects it).
    expect('__sessionStorage' in storageState).toBe(false);
    expect(storageState.cookies).toEqual([{ name: 'sid', value: 'abc' }]);
    expect(storageState.origins).toEqual([{ origin: 'https://qontinui.io', localStorage: [] }]);
    expect(sessionStorage).toEqual({
      'https://qontinui.io': { auth_bearer_access_token: 'TOKEN' },
    });
  });

  it('does not mutate the input artifact', () => {
    const artifact = { cookies: [], __sessionStorage: { 'https://x.io': { a: '1' } } };
    splitSessionStorageArtifact(artifact);
    expect('__sessionStorage' in artifact).toBe(true);
  });

  it('legacy artifact WITHOUT __sessionStorage → sessionStorage null, storageState unchanged', () => {
    const artifact = {
      cookies: [{ name: 'sid', value: 'abc' }],
      origins: [{ origin: 'https://qontinui.io', localStorage: [] }],
    };
    const { storageState, sessionStorage } = splitSessionStorageArtifact(artifact);
    expect(sessionStorage).toBeNull();
    expect(storageState).toEqual(artifact);
    expect('__sessionStorage' in storageState).toBe(false);
  });

  it('round-trips a merge then split for the same origin', () => {
    const artifact: Record<string, unknown> = {
      cookies: [],
      origins: [],
    };
    mergeSessionStorageIntoArtifact(artifact, 'https://qontinui.io', {
      auth_bearer_access_token: 'TOKEN',
    });
    const { storageState, sessionStorage } = splitSessionStorageArtifact(artifact);
    expect(sessionStorage).toEqual({
      'https://qontinui.io': { auth_bearer_access_token: 'TOKEN' },
    });
    expect('__sessionStorage' in storageState).toBe(false);
  });
});
