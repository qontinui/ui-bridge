/**
 * In-Memory Artifact Store
 *
 * Default ArtifactStore implementation for SDK use.
 * Stores artifacts in memory with query support.
 * Follows the SpecStore pattern (Map-backed, event-emitting).
 */

import type {
  ResultArtifact,
  ArtifactStore,
  ArtifactQuery,
  ArtifactListener,
  ArtifactEvent,
} from './types';
import { computeHash } from './hash';

export class MemoryArtifactStore implements ArtifactStore {
  private artifacts = new Map<string, ResultArtifact>();
  private listeners = new Set<ArtifactListener>();

  async save(artifact: ResultArtifact): Promise<void> {
    if (this.artifacts.has(artifact.artifactId)) {
      throw new Error(`Artifact ${artifact.artifactId} already exists (immutable)`);
    }
    this.artifacts.set(artifact.artifactId, artifact);
    this.emit({ type: 'artifact:saved', artifactId: artifact.artifactId, timestamp: Date.now() });
  }

  async get(artifactId: string): Promise<ResultArtifact | null> {
    return this.artifacts.get(artifactId) ?? null;
  }

  async query(query: ArtifactQuery): Promise<ResultArtifact[]> {
    let results = Array.from(this.artifacts.values());

    // Apply filters
    if (query.specId) {
      results = results.filter((a) => a.source.specId === query.specId);
    }
    if (query.contractId) {
      results = results.filter((a) => a.source.contractId === query.contractId);
    }
    if (query.matrixId) {
      results = results.filter((a) => a.source.matrixId === query.matrixId);
    }
    if (query.runId) {
      results = results.filter((a) => a.source.runId === query.runId);
    }
    if (query.dateRange) {
      const from = new Date(query.dateRange.from).getTime();
      const to = new Date(query.dateRange.to).getTime();
      results = results.filter((a) => {
        const ts = new Date(a.createdAt).getTime();
        return ts >= from && ts <= to;
      });
    }
    if (query.passedOnly) {
      results = results.filter((a) => 'passed' in a.result && a.result.passed);
    }
    if (query.failedOnly) {
      results = results.filter((a) => 'passed' in a.result && !a.result.passed);
    }

    // Sort by creation time (newest first)
    results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Pagination
    if (query.offset) {
      results = results.slice(query.offset);
    }
    if (query.limit) {
      results = results.slice(0, query.limit);
    }

    return results;
  }

  async verify(artifactId: string): Promise<boolean> {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) return false;

    const hashPayload = {
      result: artifact.result,
      source: artifact.source,
      environment: artifact.environment,
    };
    const recomputed = await computeHash(hashPayload);
    const valid = recomputed === artifact.artifactId;

    this.emit({
      type: valid ? 'artifact:integrity-passed' : 'artifact:integrity-failed',
      artifactId,
      timestamp: Date.now(),
    });

    return valid;
  }

  async count(): Promise<number> {
    return this.artifacts.size;
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  on(listener: ArtifactListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  off(listener: ArtifactListener): void {
    this.listeners.delete(listener);
  }

  private emit(event: ArtifactEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Don't let listener errors break the store
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  clear(): void {
    this.artifacts.clear();
  }

  getAll(): ResultArtifact[] {
    return Array.from(this.artifacts.values());
  }
}

// =============================================================================
// Singleton
// =============================================================================

const GLOBAL_KEY = '__uiBridgeArtifactStore';

export function getGlobalArtifactStore(): MemoryArtifactStore {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new MemoryArtifactStore();
  }
  return g[GLOBAL_KEY] as MemoryArtifactStore;
}

export function setGlobalArtifactStore(store: MemoryArtifactStore): void {
  (globalThis as Record<string, unknown>)[GLOBAL_KEY] = store;
}

export function resetGlobalArtifactStore(): void {
  delete (globalThis as Record<string, unknown>)[GLOBAL_KEY];
}
