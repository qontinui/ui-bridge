import { U as UiAssertion, L as LayerAssertionResult, A as ApiAssertion, F as FsAssertion, D as DbAssertion, E as ExecutionMatrix, M as MatrixExecutionResult } from '../types-BXo-P-4N.mjs';
export { a as ApiLayerResult, b as DbLayerResult, c as ExecutionStrategy, d as FsLayerResult, e as LayerSummary, f as LayeredAssertion, g as LayeredAssertionPayload, h as MATRIX_FILE_EXTENSION, i as UiLayerResult, V as VerificationLayer } from '../types-BXo-P-4N.mjs';
import { am as DiscoveredElement, an as AIDiscoveredElement } from '../types-gR41i0Eb.mjs';
import { A as AssertionConfig } from '../assertions-CITDjwsv.mjs';
import '../types-BAi5RZ1S.mjs';

/**
 * UI Layer Executor
 *
 * Thin wrapper around SpecExecutor for UI-layer assertions within the execution matrix.
 */

declare class UiLayerExecutor {
    private specExecutor;
    constructor(config?: Partial<AssertionConfig>);
    updateElements(elements: Array<DiscoveredElement | AIDiscoveredElement>): void;
    execute(id: string, assertion: UiAssertion): Promise<LayerAssertionResult>;
}

/**
 * API Layer Executor
 *
 * Executes HTTP assertions for the API verification layer.
 * Works in both browser and server contexts via fetch().
 */

declare class ApiLayerExecutor {
    private baseUrl?;
    constructor(options?: {
        baseUrl?: string;
    });
    execute(id: string, assertion: ApiAssertion): Promise<LayerAssertionResult>;
}

/**
 * IPC Layer Executor
 *
 * Executes filesystem and database assertions via Tauri IPC.
 * Only works in a Tauri (runner) context. Returns failures in browser-only environments.
 */

declare class IpcLayerExecutor {
    private invoke;
    constructor();
    get isAvailable(): boolean;
    executeFs(id: string, assertion: FsAssertion): Promise<LayerAssertionResult>;
    executeDb(id: string, assertion: DbAssertion): Promise<LayerAssertionResult>;
}

/**
 * Matrix Executor
 *
 * Orchestrates multi-layer verification across UI, API, FS, and DB layers.
 * Supports parallel, sequential, and ui-first execution strategies.
 */

interface MatrixExecutorConfig {
    assertionConfig?: Partial<AssertionConfig>;
    apiBaseUrl?: string;
}
declare class MatrixExecutor {
    private uiExecutor;
    private apiExecutor;
    private ipcExecutor;
    constructor(config?: MatrixExecutorConfig);
    updateElements(elements: Array<DiscoveredElement | AIDiscoveredElement>): void;
    execute(matrix: ExecutionMatrix): Promise<MatrixExecutionResult>;
    private executeParallel;
    private executeSequential;
    private executeUiFirst;
    private executeSingle;
    private buildLayerSummaries;
}

export { ApiAssertion, ApiLayerExecutor, DbAssertion, ExecutionMatrix, FsAssertion, IpcLayerExecutor, LayerAssertionResult, MatrixExecutionResult, MatrixExecutor, type MatrixExecutorConfig, UiAssertion, UiLayerExecutor };
