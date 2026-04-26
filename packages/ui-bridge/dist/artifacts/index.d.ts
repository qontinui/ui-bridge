import { A as ArtifactEnvironment, e as ArtifactResult, f as ArtifactSource, R as ResultArtifact, g as ArtifactStore, d as ArtifactQuery, c as ArtifactListener } from '../types-CZFpWw-t.js';
export { a as ArtifactEvent, b as ArtifactEventType } from '../types-CZFpWw-t.js';
import '../types-BJNqi4sD.js';
import '../types-X8pyInrK.js';
import '../types-WPj4JNnO.js';
import '../types-Dd92QcnK.js';

/**
 * Artifact Hashing
 *
 * Content-addressing via SHA-256 of canonical (deterministic) JSON.
 * Works in both browser (crypto.subtle) and Node.js (node:crypto) environments.
 */
/**
 * Compute a SHA-256 hex digest of the given data object.
 * Uses canonical JSON (sorted keys) for deterministic hashing.
 */
declare function computeHash(data: unknown): Promise<string>;

/**
 * Artifact Factory
 *
 * Creates immutable ResultArtifact records from execution results.
 */

/**
 * Create an immutable ResultArtifact from an execution result.
 * Computes the content-addressed artifactId from the result payload.
 */
declare function createArtifact(result: ArtifactResult, source: ArtifactSource, environment?: Partial<ArtifactEnvironment>): Promise<ResultArtifact>;
/**
 * Collect environment context from the current browser context.
 * Returns an empty object in non-browser environments.
 */
declare function captureEnvironment(): Partial<ArtifactEnvironment>;

/**
 * In-Memory Artifact Store
 *
 * Default ArtifactStore implementation for SDK use.
 * Stores artifacts in memory with query support.
 * Follows the SpecStore pattern (Map-backed, event-emitting).
 */

declare class MemoryArtifactStore implements ArtifactStore {
    private artifacts;
    private listeners;
    save(artifact: ResultArtifact): Promise<void>;
    get(artifactId: string): Promise<ResultArtifact | null>;
    query(query: ArtifactQuery): Promise<ResultArtifact[]>;
    verify(artifactId: string): Promise<boolean>;
    count(): Promise<number>;
    on(listener: ArtifactListener): () => void;
    off(listener: ArtifactListener): void;
    private emit;
    clear(): void;
    getAll(): ResultArtifact[];
}
declare function getGlobalArtifactStore(): MemoryArtifactStore;
declare function setGlobalArtifactStore(store: MemoryArtifactStore): void;
declare function resetGlobalArtifactStore(): void;

/**
 * IPC Artifact Store
 *
 * ArtifactStore implementation that persists artifacts to the runner's
 * Rust backend via Tauri IPC for SQLite storage.
 *
 * Falls back to MemoryArtifactStore when not running in a Tauri context.
 */

declare class IpcArtifactStore implements ArtifactStore {
    private invoke;
    private fallback;
    constructor();
    save(artifact: ResultArtifact): Promise<void>;
    get(artifactId: string): Promise<ResultArtifact | null>;
    query(query: ArtifactQuery): Promise<ResultArtifact[]>;
    verify(artifactId: string): Promise<boolean>;
    count(): Promise<number>;
    /**
     * Whether this store is using Tauri IPC (true) or in-memory fallback (false).
     */
    get isIpcAvailable(): boolean;
}

export { ArtifactEnvironment, ArtifactListener, ArtifactQuery, ArtifactResult, ArtifactSource, ArtifactStore, IpcArtifactStore, MemoryArtifactStore, ResultArtifact, captureEnvironment, computeHash, createArtifact, getGlobalArtifactStore, resetGlobalArtifactStore, setGlobalArtifactStore };
