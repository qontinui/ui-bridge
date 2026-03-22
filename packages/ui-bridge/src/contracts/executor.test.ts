/**
 * Contract Executor & Validator Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validateContractConfig } from './validator';
import { CONTRACT_CONFIG_VERSION } from './types';
import type { VerificationContract, ContractCondition } from './types';
import { getGlobalSpecStore, resetGlobalSpecStore } from '../specs/store';
import type { SpecConfig, SpecAssertion } from '../specs/types';

// We need a mock that behaves like a class with configurable assertion results.
// Store the mock executeAssertion/executeGroup functions so tests can override them.
let mockExecuteAssertion: ReturnType<typeof vi.fn>;
let mockExecuteGroup: ReturnType<typeof vi.fn>;

vi.mock('../specs/executor', () => {
  // Use a real class so `new SpecExecutor()` works
  const MockSpecExecutor = class {
    updateElements = vi.fn();
    executeAssertion(...args: unknown[]) {
      return mockExecuteAssertion(...args);
    }
    executeGroup(...args: unknown[]) {
      return mockExecuteGroup(...args);
    }
  };
  return { SpecExecutor: MockSpecExecutor };
});

// Import ContractExecutor AFTER the mock is set up
import { ContractExecutor } from './executor';

// =============================================================================
// ContractExecutor
// =============================================================================

describe('ContractExecutor', () => {
  let executor: ContractExecutor;

  const passingResult = {
    assertionId: 'mock',
    severity: 'info',
    category: 'element-presence',
    skipped: false,
    result: { passed: true, message: 'OK' },
  };

  const failingResult = {
    assertionId: 'mock',
    severity: 'info',
    category: 'element-presence',
    skipped: false,
    result: { passed: false, message: 'Failed' },
  };

  beforeEach(() => {
    resetGlobalSpecStore();
    mockExecuteAssertion = vi.fn().mockResolvedValue(passingResult);
    mockExecuteGroup = vi.fn().mockResolvedValue({
      groupId: 'g1',
      groupName: 'Test Group',
      assertionResults: [passingResult],
      passedCount: 1,
      failedCount: 0,
      skippedCount: 0,
      passed: true,
      durationMs: 10,
      timestamp: Date.now(),
    });
    executor = new ContractExecutor();
  });

  function makeAssertion(id = 'a1'): SpecAssertion {
    return {
      id,
      description: 'Test assertion',
      category: 'element-presence',
      severity: 'info',
      target: { type: 'elementId', elementId: 'el1' },
      assertionType: 'visible',
      source: 'manual',
      reviewed: true,
      enabled: true,
    };
  }

  function makeCondition(overrides: Partial<ContractCondition> = {}): ContractCondition {
    return {
      id: 'cond-1',
      description: 'Test condition',
      check: {
        type: 'assertion',
        assertion: makeAssertion(),
      },
      onFailure: 'fail',
      ...overrides,
    };
  }

  function makeContract(overrides: Partial<VerificationContract> = {}): VerificationContract {
    return {
      id: 'contract-1',
      name: 'Test Contract',
      description: 'A test contract',
      version: '1.0.0',
      preconditions: [],
      verification: {
        type: 'inline',
        assertions: [makeAssertion()],
      },
      postconditions: [],
      ...overrides,
    };
  }

  describe('execute with inline verification', () => {
    it('should pass when pre passes, verification runs, and post passes', async () => {
      const contract = makeContract({
        preconditions: [makeCondition()],
        postconditions: [makeCondition({ id: 'post-1' })],
      });

      const result = await executor.execute(contract);
      expect(result.passed).toBe(true);
      expect(result.preconditionsPassed).toBe(true);
      expect(result.verificationPassed).toBe(true);
      expect(result.postconditionsPassed).toBe(true);
      expect(result.skipped).toBe(false);
      expect(result.verificationResults).not.toBeNull();
    });
  });

  describe('execute with precondition onFailure=skip', () => {
    it('should skip verification when precondition fails', async () => {
      mockExecuteAssertion.mockResolvedValue(failingResult);

      const contract = makeContract({
        preconditions: [makeCondition({ onFailure: 'skip' })],
      });

      const result = await executor.execute(contract);
      expect(result.skipped).toBe(true);
      expect(result.verificationResults).toBeNull();
      expect(result.passed).toBe(false);
    });
  });

  describe('execute with precondition onFailure=fail', () => {
    it('should fail the contract when precondition fails', async () => {
      mockExecuteAssertion.mockResolvedValue(failingResult);

      const contract = makeContract({
        preconditions: [makeCondition({ onFailure: 'fail' })],
      });

      const result = await executor.execute(contract);
      expect(result.preconditionsPassed).toBe(false);
      expect(result.verificationResults).toBeNull();
      expect(result.passed).toBe(false);
    });
  });

  describe('execute with precondition onFailure=warn', () => {
    it('should add warning and continue verification', async () => {
      mockExecuteAssertion.mockResolvedValue(failingResult);

      const contract = makeContract({
        preconditions: [makeCondition({ onFailure: 'warn', description: 'Warn condition' })],
      });

      const result = await executor.execute(contract);
      expect(result.preconditionsPassed).toBe(true);
      expect(result.warnings).toContain('Precondition warning: Warn condition');
      // Verification still runs (and fails since mock returns failed)
      expect(result.verificationResults).not.toBeNull();
    });
  });

  describe('execute with postcondition failure', () => {
    it('should fail when postcondition with onFailure=fail fails', async () => {
      let callCount = 0;
      mockExecuteAssertion.mockImplementation(async () => {
        callCount++;
        // Calls 1 = precondition (pass), 2 = inline verification (pass), 3 = postcondition (fail)
        if (callCount <= 2) return passingResult;
        return failingResult;
      });

      const contract = makeContract({
        preconditions: [makeCondition()],
        postconditions: [makeCondition({ id: 'post-1', onFailure: 'fail' })],
      });

      const result = await executor.execute(contract);
      expect(result.postconditionsPassed).toBe(false);
      expect(result.passed).toBe(false);
    });
  });

  describe('specGroupRef verification', () => {
    it('should load spec from SpecStore and execute the group', async () => {
      const specConfig: SpecConfig = {
        version: '1.0.0',
        groups: [
          {
            id: 'g1',
            name: 'Test Group',
            description: 'A test group',
            category: 'element-presence',
            assertions: [makeAssertion()],
            source: 'manual',
          },
        ],
      };
      getGlobalSpecStore().load('my-spec', specConfig);

      const contract = makeContract({
        verification: {
          type: 'specGroupRef',
          specId: 'my-spec',
          groupId: 'g1',
        },
      });

      const result = await executor.execute(contract);
      expect(result.verificationResults).not.toBeNull();
      expect(result.verificationPassed).toBe(true);
      expect(mockExecuteGroup).toHaveBeenCalled();
    });

    it('should throw when spec is not loaded in SpecStore', async () => {
      const contract = makeContract({
        verification: {
          type: 'specGroupRef',
          specId: 'missing-spec',
          groupId: 'g1',
        },
      });

      await expect(executor.execute(contract)).rejects.toThrow('missing-spec');
    });

    it('should throw when group is not found in spec', async () => {
      const specConfig: SpecConfig = {
        version: '1.0.0',
        groups: [
          {
            id: 'g1',
            name: 'Test Group',
            description: 'A test group',
            category: 'element-presence',
            assertions: [makeAssertion()],
            source: 'manual',
          },
        ],
      };
      getGlobalSpecStore().load('my-spec', specConfig);

      const contract = makeContract({
        verification: {
          type: 'specGroupRef',
          specId: 'my-spec',
          groupId: 'nonexistent-group',
        },
      });

      await expect(executor.execute(contract)).rejects.toThrow('nonexistent-group');
    });
  });
});

// =============================================================================
// validateContractConfig
// =============================================================================

describe('validateContractConfig', () => {
  function makeValidConfig() {
    return {
      version: CONTRACT_CONFIG_VERSION,
      contracts: [
        {
          id: 'c1',
          name: 'Contract 1',
          description: 'A contract',
          version: '1.0.0',
          preconditions: [
            {
              id: 'pre-1',
              description: 'API is up',
              check: {
                type: 'api',
                endpoint: 'http://localhost:3000/health',
                method: 'GET',
                expectedStatus: 200,
              },
              onFailure: 'skip',
            },
          ],
          verification: {
            type: 'inline',
            assertions: [{ id: 'a1' }],
          },
          postconditions: [
            {
              id: 'post-1',
              description: 'Cleanup check',
              check: {
                type: 'assertion',
                assertion: { id: 'a2' },
              },
              onFailure: 'warn',
            },
          ],
        },
      ],
    };
  }

  it('should validate a valid config', () => {
    const result = validateContractConfig(makeValidConfig());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject non-object input', () => {
    const result = validateContractConfig(null);
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toBe('must be an object');
  });

  it('should reject wrong version', () => {
    const config = makeValidConfig();
    (config as any).version = '2.0.0';
    const result = validateContractConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'version')).toBe(true);
  });

  it('should reject missing contracts array', () => {
    const config = { version: CONTRACT_CONFIG_VERSION };
    const result = validateContractConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'contracts')).toBe(true);
  });

  it('should reject contract with missing id', () => {
    const config = makeValidConfig();
    delete (config.contracts[0] as any).id;
    const result = validateContractConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.includes('.id'))).toBe(true);
  });

  it('should reject contract with missing name', () => {
    const config = makeValidConfig();
    delete (config.contracts[0] as any).name;
    const result = validateContractConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.includes('.name'))).toBe(true);
  });

  it('should reject invalid verification type', () => {
    const config = makeValidConfig();
    (config.contracts[0] as any).verification = { type: 'invalid' };
    const result = validateContractConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.includes('verification.type'))).toBe(true);
  });

  it('should reject invalid check type in condition', () => {
    const config = makeValidConfig();
    (config.contracts[0].preconditions[0] as any).check = { type: 'invalid' };
    const result = validateContractConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.includes('check.type'))).toBe(true);
  });

  it('should reject invalid onFailure value', () => {
    const config = makeValidConfig();
    (config.contracts[0].preconditions[0] as any).onFailure = 'invalid';
    const result = validateContractConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.includes('onFailure'))).toBe(true);
  });

  it('should reject api check with missing endpoint', () => {
    const config = makeValidConfig();
    delete (config.contracts[0].preconditions[0].check as any).endpoint;
    const result = validateContractConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.includes('endpoint'))).toBe(true);
  });

  it('should reject api check with invalid method', () => {
    const config = makeValidConfig();
    (config.contracts[0].preconditions[0].check as any).method = 'PATCH';
    const result = validateContractConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.includes('method'))).toBe(true);
  });
});
