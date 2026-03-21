/**
 * Artifacts Module
 *
 * Immutable, content-addressed verification result records.
 */

export type {
  ArtifactSource,
  ArtifactEnvironment,
  ArtifactResult,
  ResultArtifact,
  ArtifactQuery,
  ArtifactStore,
  ArtifactEventType,
  ArtifactEvent,
  ArtifactListener,
} from './types';

export { computeHash } from './hash';

export { createArtifact, captureEnvironment } from './factory';

export {
  MemoryArtifactStore,
  getGlobalArtifactStore,
  setGlobalArtifactStore,
  resetGlobalArtifactStore,
} from './memory-store';

export { IpcArtifactStore } from './ipc-store';
