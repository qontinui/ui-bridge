/**
 * IPC Artifact Store
 *
 * ArtifactStore implementation that persists artifacts to the runner's
 * Rust backend via Tauri IPC for SQLite storage.
 *
 * Falls back to MemoryArtifactStore when not running in a Tauri context.
 */

import type { ResultArtifact, ArtifactStore, ArtifactQuery } from './types';
import { MemoryArtifactStore } from './memory-store';

/**
 * Tauri invoke function type (from @tauri-apps/api).
 */
type TauriInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

/**
 * Detect whether we're in a Tauri environment and get the invoke function.
 */
function getTauriInvoke(): TauriInvoke | null {
  try {
    if (typeof window !== 'undefined' && '__TAURI__' in window) {
      const tauri = (window as Record<string, unknown>).__TAURI__ as Record<string, unknown>;
      const core = tauri.core as Record<string, unknown> | undefined;
      if (core && typeof core.invoke === 'function') {
        return core.invoke as TauriInvoke;
      }
    }
  } catch {
    // Not in Tauri
  }
  return null;
}

export class IpcArtifactStore implements ArtifactStore {
  private invoke: TauriInvoke | null;
  private fallback: MemoryArtifactStore;

  constructor() {
    this.invoke = getTauriInvoke();
    this.fallback = new MemoryArtifactStore();
  }

  async save(artifact: ResultArtifact): Promise<void> {
    if (this.invoke) {
      await this.invoke('plugin:ui-bridge|save_artifact', { artifact });
    } else {
      await this.fallback.save(artifact);
    }
  }

  async get(artifactId: string): Promise<ResultArtifact | null> {
    if (this.invoke) {
      const result = await this.invoke('plugin:ui-bridge|get_artifact', { artifactId });
      return (result as ResultArtifact) ?? null;
    }
    return this.fallback.get(artifactId);
  }

  async query(query: ArtifactQuery): Promise<ResultArtifact[]> {
    if (this.invoke) {
      const result = await this.invoke('plugin:ui-bridge|query_artifacts', { query });
      return result as ResultArtifact[];
    }
    return this.fallback.query(query);
  }

  async verify(artifactId: string): Promise<boolean> {
    if (this.invoke) {
      const result = await this.invoke('plugin:ui-bridge|verify_artifact', { artifactId });
      return result as boolean;
    }
    return this.fallback.verify(artifactId);
  }

  async count(): Promise<number> {
    if (this.invoke) {
      const result = await this.invoke('plugin:ui-bridge|count_artifacts', {});
      return result as number;
    }
    return this.fallback.count();
  }

  /**
   * Whether this store is using Tauri IPC (true) or in-memory fallback (false).
   */
  get isIpcAvailable(): boolean {
    return this.invoke !== null;
  }
}
