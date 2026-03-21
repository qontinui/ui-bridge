/**
 * UI Layer Executor
 *
 * Thin wrapper around SpecExecutor for UI-layer assertions within the execution matrix.
 */

import { SpecExecutor } from '../specs/executor';
import type { DiscoveredElement } from '../control/types';
import type { AIDiscoveredElement } from '../ai/types';
import type { AssertionConfig } from '../ai/assertions';
import type { UiAssertion, LayerAssertionResult, UiLayerResult } from './types';

export class UiLayerExecutor {
  private specExecutor: SpecExecutor;

  constructor(config?: Partial<AssertionConfig>) {
    this.specExecutor = new SpecExecutor(config);
  }

  updateElements(elements: Array<DiscoveredElement | AIDiscoveredElement>): void {
    this.specExecutor.updateElements(elements);
  }

  async execute(id: string, assertion: UiAssertion): Promise<LayerAssertionResult> {
    const startTime = Date.now();
    const result = await this.specExecutor.executeAssertion(assertion.assertion);
    const passed = result.skipped || (result.result?.passed ?? false);

    const details: UiLayerResult = {
      type: 'ui',
      assertionResult: result,
    };

    return {
      assertionId: id,
      layer: 'ui',
      passed,
      details,
      durationMs: Date.now() - startTime,
    };
  }
}
