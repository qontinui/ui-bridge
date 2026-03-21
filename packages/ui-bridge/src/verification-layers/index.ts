/**
 * Verification Layers
 *
 * Multi-layer execution matrix for UI, API, FS, and DB verification.
 */

export type {
  VerificationLayer,
  UiAssertion,
  ApiAssertion,
  FsAssertion,
  DbAssertion,
  LayeredAssertionPayload,
  LayeredAssertion,
  ExecutionStrategy,
  ExecutionMatrix,
  LayerAssertionResult,
  UiLayerResult,
  ApiLayerResult,
  FsLayerResult,
  DbLayerResult,
  LayerSummary,
  MatrixExecutionResult,
} from './types';

export { MATRIX_FILE_EXTENSION } from './types';

export { UiLayerExecutor } from './ui-executor';
export { ApiLayerExecutor } from './api-executor';
export { IpcLayerExecutor } from './ipc-executor';
export { MatrixExecutor } from './matrix-executor';
export type { MatrixExecutorConfig } from './matrix-executor';
