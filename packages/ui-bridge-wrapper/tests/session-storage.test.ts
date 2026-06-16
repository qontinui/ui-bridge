import { describe, it, expect } from 'vitest';
import {
  mergeSessionStorageIntoArtifact,
  buildMultiOriginSessionStorageMap,
  mergeMultiOriginSessionStorageIntoArtifact,
  frameOrigin,
  type FrameSessionStorage,
} from '../src/session-storage-capture.js';
import {
  splitSessionStorageArtifact,
  restoreSessionStorageInitScript,
} from '@qontinui/ui-bridge-headless';

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

describe('frameOrigin', () => {
  it('returns the origin for a normal https URL', () => {
    expect(frameOrigin('https://qontinui.io/admin/coord/onboarding?x=1#h')).toBe(
      'https://qontinui.io'
    );
    expect(frameOrigin('https://embed.example:8443/widget')).toBe('https://embed.example:8443');
  });

  it('returns null for about:blank / opaque / unparseable URLs', () => {
    expect(frameOrigin('about:blank')).toBeNull();
    expect(frameOrigin('data:text/html,<p>x')).toBeNull();
    expect(frameOrigin('')).toBeNull();
    expect(frameOrigin('not a url')).toBeNull();
  });
});

describe('buildMultiOriginSessionStorageMap (capture side, all frames)', () => {
  it('keys each frame by its own origin (main frame + cross-origin iframe)', () => {
    const frames: FrameSessionStorage[] = [
      { url: 'https://qontinui.io/admin', kv: { auth_bearer_access_token: 'MAIN' } },
      { url: 'https://embed.example/widget', kv: { widget_token: 'IFRAME' } },
    ];
    expect(buildMultiOriginSessionStorageMap(frames)).toEqual({
      'https://qontinui.io': { auth_bearer_access_token: 'MAIN' },
      'https://embed.example': { widget_token: 'IFRAME' },
    });
  });

  it('merges multiple frames sharing one origin; later keys win on collision', () => {
    const frames: FrameSessionStorage[] = [
      { url: 'https://qontinui.io/a', kv: { shared: 'first', onlyA: '1' } },
      { url: 'https://qontinui.io/b', kv: { shared: 'second', onlyB: '2' } },
    ];
    expect(buildMultiOriginSessionStorageMap(frames)).toEqual({
      'https://qontinui.io': { shared: 'second', onlyA: '1', onlyB: '2' },
    });
  });

  it('skips frames whose capture threw (kv === null) and opaque/about:blank origins', () => {
    const frames: FrameSessionStorage[] = [
      { url: 'https://qontinui.io/a', kv: { tok: 't' } },
      { url: 'https://cross.example/b', kv: null }, // cross-origin evaluate threw
      { url: 'about:blank', kv: { ignored: 'x' } }, // opaque origin
      { url: 'data:text/html,x', kv: { ignored: 'y' } }, // opaque origin
    ];
    expect(buildMultiOriginSessionStorageMap(frames)).toEqual({
      'https://qontinui.io': { tok: 't' },
    });
  });

  it('single main frame yields exactly the legacy single-origin shape', () => {
    const frames: FrameSessionStorage[] = [
      { url: 'https://qontinui.io/admin/coord/onboarding', kv: { auth_bearer_access_token: 'T' } },
    ];
    expect(buildMultiOriginSessionStorageMap(frames)).toEqual({
      'https://qontinui.io': { auth_bearer_access_token: 'T' },
    });
  });

  it('returns an empty map when no frame contributes', () => {
    expect(
      buildMultiOriginSessionStorageMap([{ url: 'about:blank', kv: { a: '1' } }])
    ).toEqual({});
    expect(buildMultiOriginSessionStorageMap([])).toEqual({});
  });
});

describe('mergeMultiOriginSessionStorageIntoArtifact', () => {
  it('folds a 2-origin map into the artifact under __sessionStorage', () => {
    const artifact: Record<string, unknown> = {
      cookies: [{ name: 'sid', value: 'abc' }],
      origins: [],
    };
    mergeMultiOriginSessionStorageIntoArtifact(artifact, {
      'https://qontinui.io': { auth_bearer_access_token: 'MAIN' },
      'https://embed.example': { widget_token: 'IFRAME' },
    });
    expect(artifact.__sessionStorage).toEqual({
      'https://qontinui.io': { auth_bearer_access_token: 'MAIN' },
      'https://embed.example': { widget_token: 'IFRAME' },
    });
    expect(artifact.cookies).toEqual([{ name: 'sid', value: 'abc' }]);
  });

  it('preserves origins already recorded that are not in the new map', () => {
    const artifact: Record<string, unknown> = {
      __sessionStorage: { 'https://old.example': { keep: 'me' } },
    };
    mergeMultiOriginSessionStorageIntoArtifact(artifact, {
      'https://qontinui.io': { tok: 't' },
    });
    expect(artifact.__sessionStorage).toEqual({
      'https://old.example': { keep: 'me' },
      'https://qontinui.io': { tok: 't' },
    });
  });

  it('overwrites an existing origin entry present in the new map', () => {
    const artifact: Record<string, unknown> = {
      __sessionStorage: { 'https://qontinui.io': { old: 'v' } },
    };
    mergeMultiOriginSessionStorageIntoArtifact(artifact, {
      'https://qontinui.io': { fresh: 'w' },
    });
    expect(artifact.__sessionStorage).toEqual({ 'https://qontinui.io': { fresh: 'w' } });
  });

  it('returns the same (mutated) object', () => {
    const artifact: Record<string, unknown> = {};
    const out = mergeMultiOriginSessionStorageIntoArtifact(artifact, {
      'https://x.io': { a: '1' },
    });
    expect(out).toBe(artifact);
  });

  it('a single-origin multi-origin merge yields the same shape as the legacy per-origin merge', () => {
    const viaMulti: Record<string, unknown> = { cookies: [] };
    mergeMultiOriginSessionStorageIntoArtifact(viaMulti, {
      'https://qontinui.io': { auth_bearer_access_token: 'T' },
    });
    const viaSingle: Record<string, unknown> = { cookies: [] };
    mergeSessionStorageIntoArtifact(viaSingle, 'https://qontinui.io', {
      auth_bearer_access_token: 'T',
    });
    expect(viaMulti).toEqual(viaSingle);
  });
});

describe('restoreSessionStorageInitScript picks the right origin per-frame (restore side)', () => {
  // The init-script reads `location.origin` and restores ONLY that origin's
  // entry. We simulate it by stubbing the two globals it touches per frame and
  // asserting each origin gets exactly its own keys — proving a multi-origin map
  // Just Works (each frame restores its own slice).
  function runForOrigin(map: Record<string, Record<string, string>>, origin: string) {
    const store: Record<string, string> = {};
    const g = globalThis as unknown as {
      location?: { origin: string };
      sessionStorage?: { setItem(k: string, v: string): void };
    };
    const prevLoc = g.location;
    const prevSS = g.sessionStorage;
    g.location = { origin };
    g.sessionStorage = { setItem: (k, v) => void (store[k] = v) };
    try {
      restoreSessionStorageInitScript(map);
    } finally {
      g.location = prevLoc;
      g.sessionStorage = prevSS;
    }
    return store;
  }

  const map = {
    'https://qontinui.io': { auth_bearer_access_token: 'MAIN' },
    'https://embed.example': { widget_token: 'IFRAME' },
  };

  it('restores only the main-origin keys when running in the main frame', () => {
    expect(runForOrigin(map, 'https://qontinui.io')).toEqual({
      auth_bearer_access_token: 'MAIN',
    });
  });

  it('restores only the iframe-origin keys when running in the iframe', () => {
    expect(runForOrigin(map, 'https://embed.example')).toEqual({ widget_token: 'IFRAME' });
  });

  it('restores nothing for a frame whose origin has no entry in the map', () => {
    expect(runForOrigin(map, 'https://unrelated.example')).toEqual({});
  });
});
