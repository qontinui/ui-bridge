/**
 * Contract Executor
 *
 * Evaluates verification contracts: preconditions → verification → postconditions.
 * Wraps the existing SpecExecutor for assertion evaluation.
 */

import { SpecExecutor } from '../specs/executor';
import type { SpecExecutionOptions, SpecAssertionResult } from '../specs/types';
import { getGlobalSpecStore } from '../specs/store';
import type { DiscoveredElement } from '../control/types';
import type { AIDiscoveredElement } from '../ai/types';
import type { AssertionConfig } from '../ai/assertions';
import type {
  VerificationContract,
  ContractCondition,
  ConditionResult,
  ContractExecutionResult,
} from './types';

export class ContractExecutor {
  private specExecutor: SpecExecutor;

  constructor(config?: Partial<AssertionConfig>) {
    this.specExecutor = new SpecExecutor(config);
  }

  /**
   * Update the element registry (pass-through to SpecExecutor).
   */
  updateElements(elements: Array<DiscoveredElement | AIDiscoveredElement>): void {
    this.specExecutor.updateElements(elements);
  }

  /**
   * Execute a full verification contract.
   */
  async execute(
    contract: VerificationContract,
    options?: ContractExecutionOptions
  ): Promise<ContractExecutionResult> {
    const startTime = Date.now();
    const warnings: string[] = [];

    // Phase 1: Evaluate preconditions
    const preconditionResults: ConditionResult[] = [];
    let preconditionsPassed = true;
    let skipped = false;

    for (const condition of contract.preconditions) {
      const result = await this.evaluateCondition(condition);
      preconditionResults.push(result);

      if (!result.passed) {
        if (condition.onFailure === 'skip') {
          skipped = true;
          break;
        } else if (condition.onFailure === 'fail') {
          preconditionsPassed = false;
          break;
        } else if (condition.onFailure === 'warn') {
          warnings.push(`Precondition warning: ${condition.description}`);
        }
      }
    }

    // Phase 2: Run verification (if preconditions passed and not skipped)
    let verificationResults: SpecAssertionResult[] | null = null;
    let verificationPassed = false;

    if (!skipped && preconditionsPassed) {
      verificationResults = await this.runVerification(contract, options?.specOptions);
      verificationPassed = verificationResults.every(
        (r) => r.skipped || (r.result?.passed ?? false)
      );
    }

    // Phase 3: Evaluate postconditions (if verification passed)
    let postconditionResults: ConditionResult[] | null = null;
    let postconditionsPassed = true;

    if (!skipped && preconditionsPassed && verificationPassed) {
      postconditionResults = [];
      for (const condition of contract.postconditions) {
        const result = await this.evaluateCondition(condition);
        postconditionResults.push(result);

        if (!result.passed) {
          if (condition.onFailure === 'fail') {
            postconditionsPassed = false;
            break;
          } else if (condition.onFailure === 'warn') {
            warnings.push(`Postcondition warning: ${condition.description}`);
          }
          // 'skip' on postconditions doesn't make sense — treat as warn
        }
      }
    }

    const passed = !skipped && preconditionsPassed && verificationPassed && postconditionsPassed;

    return {
      contractId: contract.id,
      contractName: contract.name,
      preconditionResults,
      preconditionsPassed,
      skipped,
      verificationResults,
      verificationPassed,
      postconditionResults,
      postconditionsPassed,
      passed,
      warnings,
      durationMs: Date.now() - startTime,
      timestamp: Date.now(),
    };
  }

  // ---------------------------------------------------------------------------
  // Condition Evaluation
  // ---------------------------------------------------------------------------

  private async evaluateCondition(condition: ContractCondition): Promise<ConditionResult> {
    const startTime = Date.now();

    switch (condition.check.type) {
      case 'assertion': {
        const result = await this.specExecutor.executeAssertion(condition.check.assertion);
        const passed = result.skipped || (result.result?.passed ?? false);
        return {
          conditionId: condition.id,
          description: condition.description,
          passed,
          assertionResult: result,
          onFailure: condition.onFailure,
          skippedContract: !passed && condition.onFailure === 'skip',
          durationMs: Date.now() - startTime,
        };
      }

      case 'api': {
        const { endpoint, method, expectedStatus, headers, timeout } = condition.check;
        try {
          const controller = new AbortController();
          const timeoutId = timeout ? setTimeout(() => controller.abort(), timeout) : undefined;

          const parsedUrl = new URL(endpoint);
          if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
            throw new Error(`Unsafe protocol: ${parsedUrl.protocol}`);
          }

          const response = await fetch(endpoint, {
            method,
            headers,
            signal: controller.signal,
          });

          if (timeoutId) clearTimeout(timeoutId);

          const passed = response.status === expectedStatus;
          return {
            conditionId: condition.id,
            description: condition.description,
            passed,
            apiResult: {
              status: response.status,
              ok: response.ok,
              durationMs: Date.now() - startTime,
            },
            onFailure: condition.onFailure,
            skippedContract: !passed && condition.onFailure === 'skip',
            durationMs: Date.now() - startTime,
          };
        } catch {
          return {
            conditionId: condition.id,
            description: condition.description,
            passed: false,
            apiResult: { status: 0, ok: false, durationMs: Date.now() - startTime },
            onFailure: condition.onFailure,
            skippedContract: condition.onFailure === 'skip',
            durationMs: Date.now() - startTime,
          };
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Verification
  // ---------------------------------------------------------------------------

  private async runVerification(
    contract: VerificationContract,
    options?: SpecExecutionOptions
  ): Promise<SpecAssertionResult[]> {
    const verification = contract.verification;

    switch (verification.type) {
      case 'inline': {
        const results: SpecAssertionResult[] = [];
        for (const assertion of verification.assertions) {
          results.push(await this.specExecutor.executeAssertion(assertion));
        }
        return results;
      }

      case 'specGroupRef': {
        // Resolve the spec group from the global SpecStore
        const specStore = getGlobalSpecStore();
        const specConfig = specStore.get(verification.specId);
        if (!specConfig) {
          throw new Error(
            `Contract verification references spec "${verification.specId}" ` +
              `but it is not loaded in the SpecStore. ` +
              `Load it with specStore.load("${verification.specId}", config) first.`
          );
        }

        const group = specConfig.groups.find((g) => g.id === verification.groupId);
        if (!group) {
          throw new Error(
            `Contract verification references group "${verification.groupId}" ` +
              `in spec "${verification.specId}" but the group was not found. ` +
              `Available groups: ${specConfig.groups.map((g) => g.id).join(', ')}`
          );
        }

        const groupResult = await this.specExecutor.executeGroup(group, options);
        return groupResult.assertionResults;
      }
    }
  }
}

// =============================================================================
// Options
// =============================================================================

export interface ContractExecutionOptions {
  /** Options passed through to SpecExecutor for the verification phase. */
  specOptions?: SpecExecutionOptions;
}
