/**
 * Artifact Hash & MemoryArtifactStore & Factory Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { computeHash } from './hash';
import { MemoryArtifactStore } from './memory-store';
import { createArtifact, captureEnvironment } from './factory';
import type { ResultArtifact, ArtifactSource } from './types';

// =============================================================================
// computeHash
// =============================================================================

describe('computeHash', () => {
  it('should produce consistent output for the same input (determinism)', async () => {
    const data = { foo: 'bar', num: 42 };
    const hash1 = await computeHash(data);
    const hash2 = await computeHash(data);
    expect(hash1).toBe(hash2);
  });

  it('should produce different output for different input', async () => {
    const hash1 = await computeHash({ a: 1 });
    const hash2 = await computeHash({ a: 2 });
    expect(hash1).not.toBe(hash2);
  });

  it('should produce the same hash regardless of key order (canonical JSON)', async () => {
    const hash1 = await computeHash({ b: 2, a: 1 });
    const hash2 = await computeHash({ a: 1, b: 2 });
    expect(hash1).toBe(hash2);
  });

  it('should sort keys in nested objects', async () => {
    const hash1 = await computeHash({ outer: { z: 1, a: 2 } });
    const hash2 = await computeHash({ outer: { a: 2, z: 1 } });
    expect(hash1).toBe(hash2);
  });

  it('should return a hex string', async () => {
    const hash = await computeHash('hello');
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });
});

// =============================================================================
// MemoryArtifactStore
// =============================================================================

describe('MemoryArtifactStore', () => {
  let store: MemoryArtifactStore;

  const makeArtifact = (overrides: Partial<ResultArtifact> = {}): ResultArtifact => ({
    artifactId: `art-${Math.random().toString(36).slice(2, 8)}`,
    source: { triggeredBy: 'manual' as const, specId: 'spec-1' },
    result: {
      specVersion: '1.0.0',
      groupResults: [],
      ungroupedResults: [],
      totalAssertions: 1,
      passedCount: 1,
      failedCount: 0,
      skippedCount: 0,
      passed: true,
      durationMs: 100,
      timestamp: Date.now(),
    },
    environment: { timestamp: Date.now(), sdkVersion: '1.0.0' },
    createdAt: new Date().toISOString(),
    immutable: true as const,
    ...overrides,
  });

  beforeEach(() => {
    store = new MemoryArtifactStore();
  });

  describe('save / get', () => {
    it('should save and retrieve an artifact', async () => {
      const artifact = makeArtifact({ artifactId: 'a1' });
      await store.save(artifact);
      const retrieved = await store.get('a1');
      expect(retrieved).toBe(artifact);
    });

    it('should return null for missing artifact', async () => {
      expect(await store.get('nonexistent')).toBeNull();
    });

    it('should throw on duplicate artifactId (immutability)', async () => {
      const artifact = makeArtifact({ artifactId: 'dup' });
      await store.save(artifact);
      await expect(store.save(artifact)).rejects.toThrow('already exists');
    });
  });

  describe('query', () => {
    it('should filter by specId', async () => {
      await store.save(
        makeArtifact({ artifactId: 'a1', source: { triggeredBy: 'manual', specId: 'spec-1' } })
      );
      await store.save(
        makeArtifact({ artifactId: 'a2', source: { triggeredBy: 'manual', specId: 'spec-2' } })
      );
      const results = await store.query({ specId: 'spec-1' });
      expect(results).toHaveLength(1);
      expect(results[0].artifactId).toBe('a1');
    });

    it('should filter passedOnly', async () => {
      await store.save(
        makeArtifact({
          artifactId: 'pass',
          result: {
            specVersion: '1.0.0',
            groupResults: [],
            ungroupedResults: [],
            totalAssertions: 1,
            passedCount: 1,
            failedCount: 0,
            skippedCount: 0,
            passed: true,
            durationMs: 10,
            timestamp: Date.now(),
          },
        })
      );
      await store.save(
        makeArtifact({
          artifactId: 'fail',
          result: {
            specVersion: '1.0.0',
            groupResults: [],
            ungroupedResults: [],
            totalAssertions: 1,
            passedCount: 0,
            failedCount: 1,
            skippedCount: 0,
            passed: false,
            durationMs: 10,
            timestamp: Date.now(),
          },
        })
      );
      const results = await store.query({ passedOnly: true });
      expect(results).toHaveLength(1);
      expect(results[0].artifactId).toBe('pass');
    });

    it('should filter failedOnly', async () => {
      await store.save(
        makeArtifact({
          artifactId: 'pass',
          result: {
            specVersion: '1.0.0',
            groupResults: [],
            ungroupedResults: [],
            totalAssertions: 1,
            passedCount: 1,
            failedCount: 0,
            skippedCount: 0,
            passed: true,
            durationMs: 10,
            timestamp: Date.now(),
          },
        })
      );
      await store.save(
        makeArtifact({
          artifactId: 'fail',
          result: {
            specVersion: '1.0.0',
            groupResults: [],
            ungroupedResults: [],
            totalAssertions: 1,
            passedCount: 0,
            failedCount: 1,
            skippedCount: 0,
            passed: false,
            durationMs: 10,
            timestamp: Date.now(),
          },
        })
      );
      const results = await store.query({ failedOnly: true });
      expect(results).toHaveLength(1);
      expect(results[0].artifactId).toBe('fail');
    });

    it('should filter by dateRange', async () => {
      const now = new Date();
      const past = new Date(now.getTime() - 100000);
      const future = new Date(now.getTime() + 100000);

      await store.save(makeArtifact({ artifactId: 'a1', createdAt: now.toISOString() }));
      await store.save(makeArtifact({ artifactId: 'a2', createdAt: past.toISOString() }));

      const results = await store.query({
        dateRange: {
          from: new Date(now.getTime() - 1000).toISOString(),
          to: future.toISOString(),
        },
      });
      expect(results).toHaveLength(1);
      expect(results[0].artifactId).toBe('a1');
    });

    it('should support limit and offset', async () => {
      for (let i = 0; i < 5; i++) {
        await store.save(
          makeArtifact({
            artifactId: `a${i}`,
            createdAt: new Date(Date.now() + i * 1000).toISOString(),
          })
        );
      }
      const results = await store.query({ limit: 2, offset: 1 });
      expect(results).toHaveLength(2);
    });
  });

  describe('verify', () => {
    it('should return true for a properly hashed artifact', async () => {
      const source: ArtifactSource = { triggeredBy: 'manual', specId: 's1' };
      const result = {
        specVersion: '1.0.0' as const,
        groupResults: [],
        ungroupedResults: [],
        totalAssertions: 0,
        passedCount: 0,
        failedCount: 0,
        skippedCount: 0,
        passed: true,
        durationMs: 0,
        timestamp: Date.now(),
      };
      // Create artifact via factory so the hash is correct
      const artifact = await createArtifact(result, source);
      await store.save(artifact);
      expect(await store.verify(artifact.artifactId)).toBe(true);
    });

    it('should return false for a tampered artifact', async () => {
      const artifact = makeArtifact({ artifactId: 'tampered-id' });
      await store.save(artifact);
      expect(await store.verify('tampered-id')).toBe(false);
    });

    it('should return false for a nonexistent artifact', async () => {
      expect(await store.verify('nonexistent')).toBe(false);
    });
  });

  describe('count', () => {
    it('should return the number of stored artifacts', async () => {
      expect(await store.count()).toBe(0);
      await store.save(makeArtifact({ artifactId: 'a1' }));
      await store.save(makeArtifact({ artifactId: 'a2' }));
      expect(await store.count()).toBe(2);
    });
  });

  describe('clear', () => {
    it('should remove all artifacts', async () => {
      await store.save(makeArtifact({ artifactId: 'a1' }));
      store.clear();
      expect(await store.count()).toBe(0);
      expect(await store.get('a1')).toBeNull();
    });
  });

  describe('events', () => {
    it('should emit artifact:saved on save', async () => {
      const listener = vi.fn();
      store.on(listener);
      await store.save(makeArtifact({ artifactId: 'a1' }));
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'artifact:saved', artifactId: 'a1' })
      );
    });

    it('should remove listener via returned unsubscribe', async () => {
      const listener = vi.fn();
      const unsub = store.on(listener);
      unsub();
      await store.save(makeArtifact({ artifactId: 'a1' }));
      expect(listener).not.toHaveBeenCalled();
    });

    it('should remove listener via off()', async () => {
      const listener = vi.fn();
      store.on(listener);
      store.off(listener);
      await store.save(makeArtifact({ artifactId: 'a1' }));
      expect(listener).not.toHaveBeenCalled();
    });
  });
});

// =============================================================================
// Factory
// =============================================================================

describe('createArtifact', () => {
  it('should produce a valid artifact with artifactId', async () => {
    const result = {
      specVersion: '1.0.0' as const,
      groupResults: [],
      ungroupedResults: [],
      totalAssertions: 1,
      passedCount: 1,
      failedCount: 0,
      skippedCount: 0,
      passed: true,
      durationMs: 50,
      timestamp: Date.now(),
    };
    const source: ArtifactSource = { triggeredBy: 'manual' };
    const artifact = await createArtifact(result, source);

    expect(artifact.artifactId).toBeDefined();
    expect(typeof artifact.artifactId).toBe('string');
    expect(artifact.artifactId.length).toBeGreaterThan(0);
    expect(artifact.immutable).toBe(true);
    expect(artifact.createdAt).toBeDefined();
  });

  it('should include source and environment', async () => {
    const source: ArtifactSource = { triggeredBy: 'ci', specId: 'my-spec' };
    const result = {
      specVersion: '1.0.0' as const,
      groupResults: [],
      ungroupedResults: [],
      totalAssertions: 0,
      passedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      passed: true,
      durationMs: 0,
      timestamp: Date.now(),
    };
    const artifact = await createArtifact(result, source);
    expect(artifact.source.triggeredBy).toBe('ci');
    expect(artifact.source.specId).toBe('my-spec');
    expect(artifact.environment.sdkVersion).toBe('1.0.0');
    expect(artifact.environment.timestamp).toBeDefined();
  });
});

describe('captureEnvironment', () => {
  it('should return timestamp in non-browser context', () => {
    const env = captureEnvironment();
    expect(env.timestamp).toBeDefined();
    expect(typeof env.timestamp).toBe('number');
  });
});
