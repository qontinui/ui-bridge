/**
 * Matrix Executor
 *
 * Orchestrates multi-layer verification across UI, API, FS, and DB layers.
 * Supports parallel, sequential, and ui-first execution strategies.
 */

import type { DiscoveredElement } from '../control/types';
import type { AIDiscoveredElement } from '../ai/types';
import type { AssertionConfig } from '../ai/assertions';
import type {
  ExecutionMatrix,
  LayeredAssertion,
  LayerAssertionResult,
  LayerSummary,
  MatrixExecutionResult,
  VerificationLayer,
} from './types';
import { UiLayerExecutor } from './ui-executor';
import { ApiLayerExecutor } from './api-executor';
import { IpcLayerExecutor } from './ipc-executor';

export interface MatrixExecutorConfig {
  assertionConfig?: Partial<AssertionConfig>;
  apiBaseUrl?: string;
}

export class MatrixExecutor {
  private uiExecutor: UiLayerExecutor;
  private apiExecutor: ApiLayerExecutor;
  private ipcExecutor: IpcLayerExecutor;

  constructor(config?: MatrixExecutorConfig) {
    this.uiExecutor = new UiLayerExecutor(config?.assertionConfig);
    this.apiExecutor = new ApiLayerExecutor({ baseUrl: config?.apiBaseUrl });
    this.ipcExecutor = new IpcLayerExecutor();
  }

  updateElements(elements: Array<DiscoveredElement | AIDiscoveredElement>): void {
    this.uiExecutor.updateElements(elements);
  }

  async execute(matrix: ExecutionMatrix): Promise<MatrixExecutionResult> {
    const startTime = Date.now();

    let results: LayerAssertionResult[];

    switch (matrix.strategy) {
      case 'parallel':
        results = await this.executeParallel(matrix.layers);
        break;
      case 'sequential':
        results = await this.executeSequential(matrix.layers);
        break;
      case 'ui-first':
        results = await this.executeUiFirst(matrix.layers);
        break;
    }

    // Build layer summaries
    const layerSummaries = this.buildLayerSummaries(results);
    const passedCount = results.filter((r) => r.passed).length;
    const failedCount = results.filter((r) => !r.passed).length;

    return {
      matrixId: matrix.id,
      matrixName: matrix.name,
      strategy: matrix.strategy,
      assertionResults: results,
      layerSummaries,
      overallPassed: failedCount === 0,
      totalAssertions: results.length,
      passedCount,
      failedCount,
      durationMs: Date.now() - startTime,
      timestamp: Date.now(),
    };
  }

  // ---------------------------------------------------------------------------
  // Strategies
  // ---------------------------------------------------------------------------

  private async executeParallel(assertions: LayeredAssertion[]): Promise<LayerAssertionResult[]> {
    return Promise.all(assertions.map((a) => this.executeSingle(a)));
  }

  private async executeSequential(assertions: LayeredAssertion[]): Promise<LayerAssertionResult[]> {
    const results: LayerAssertionResult[] = [];
    for (const assertion of assertions) {
      results.push(await this.executeSingle(assertion));
    }
    return results;
  }

  private async executeUiFirst(assertions: LayeredAssertion[]): Promise<LayerAssertionResult[]> {
    const uiAssertions = assertions.filter((a) => a.layer === 'ui');
    const otherAssertions = assertions.filter((a) => a.layer !== 'ui');

    // Run UI first
    const uiResults: LayerAssertionResult[] = [];
    for (const a of uiAssertions) {
      uiResults.push(await this.executeSingle(a));
    }

    // Then run remaining layers in parallel
    const otherResults = await Promise.all(otherAssertions.map((a) => this.executeSingle(a)));

    return [...uiResults, ...otherResults];
  }

  // ---------------------------------------------------------------------------
  // Single Assertion Dispatch
  // ---------------------------------------------------------------------------

  private async executeSingle(layered: LayeredAssertion): Promise<LayerAssertionResult> {
    const { assertion } = layered;

    switch (assertion.type) {
      case 'ui':
        return this.uiExecutor.execute(layered.id, assertion);
      case 'api':
        return this.apiExecutor.execute(layered.id, assertion);
      case 'fs':
        return this.ipcExecutor.executeFs(layered.id, assertion);
      case 'db':
        return this.ipcExecutor.executeDb(layered.id, assertion);
    }
  }

  // ---------------------------------------------------------------------------
  // Summaries
  // ---------------------------------------------------------------------------

  private buildLayerSummaries(results: LayerAssertionResult[]): LayerSummary[] {
    const byLayer = new Map<VerificationLayer, LayerAssertionResult[]>();

    for (const result of results) {
      const existing = byLayer.get(result.layer) ?? [];
      existing.push(result);
      byLayer.set(result.layer, existing);
    }

    return Array.from(byLayer.entries()).map(([layer, layerResults]) => ({
      layer,
      totalAssertions: layerResults.length,
      passedCount: layerResults.filter((r) => r.passed).length,
      failedCount: layerResults.filter((r) => !r.passed).length,
      durationMs: layerResults.reduce((sum, r) => sum + r.durationMs, 0),
    }));
  }
}
