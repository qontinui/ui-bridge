/**
 * Verification Contract Types
 *
 * Schema-first verification contracts that formalize pre/postconditions
 * around spec group execution. Inspired by testergizer-open-core's
 * schema-first contract pattern.
 */

import type { SpecAssertion, SpecAssertionResult } from '../specs/types';

// =============================================================================
// Conditions
// =============================================================================

/**
 * How to check a contract condition.
 */
export type ContractCheck =
  | {
      /** Reuse existing spec assertion machinery. */
      type: 'assertion';
      assertion: SpecAssertion;
    }
  | {
      /** HTTP request check (e.g. API health endpoint). */
      type: 'api';
      endpoint: string;
      method: 'GET' | 'POST' | 'PUT' | 'DELETE';
      expectedStatus: number;
      headers?: Record<string, string>;
      timeout?: number;
    };

/**
 * A single precondition or postcondition.
 */
export interface ContractCondition {
  /** Unique ID within the contract. */
  id: string;
  /** Human-readable description: "API server is reachable", "User is logged in". */
  description: string;
  /** The check to evaluate. */
  check: ContractCheck;
  /** What to do if this condition fails. */
  onFailure: 'skip' | 'fail' | 'warn';
}

// =============================================================================
// Verification Target
// =============================================================================

/**
 * What to verify — either a reference to an existing spec group or inline assertions.
 */
export type ContractVerification =
  | {
      /** Reference a spec group by spec ID + group ID. */
      type: 'specGroupRef';
      specId: string;
      groupId: string;
    }
  | {
      /** Inline assertions (no separate spec file needed). */
      type: 'inline';
      assertions: SpecAssertion[];
    };

// =============================================================================
// Contract
// =============================================================================

/**
 * A verification contract: preconditions → verification → postconditions.
 */
export interface VerificationContract {
  /** Unique contract ID. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Description of what this contract verifies. */
  description: string;
  /** Contract schema version. */
  version: string;
  /** Conditions that must hold before verification runs. */
  preconditions: ContractCondition[];
  /** The core verification (spec assertions). */
  verification: ContractVerification;
  /** Conditions that must hold after verification passes. */
  postconditions: ContractCondition[];
  /** Optional metadata. */
  metadata?: ContractMetadata;
}

export interface ContractMetadata {
  author?: string;
  component?: string;
  pageUrl?: string;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
}

// =============================================================================
// Config (the .contract.uibridge.json file format)
// =============================================================================

export interface ContractConfig {
  version: '1.0.0';
  contracts: VerificationContract[];
  metadata?: {
    author?: string;
    description?: string;
  };
}

// =============================================================================
// Execution Results
// =============================================================================

export interface ConditionResult {
  conditionId: string;
  description: string;
  passed: boolean;
  /** Only populated for 'assertion' checks. */
  assertionResult?: SpecAssertionResult;
  /** Only populated for 'api' checks. */
  apiResult?: {
    status: number;
    ok: boolean;
    durationMs: number;
  };
  /** Failure handling outcome. */
  onFailure: 'skip' | 'fail' | 'warn';
  /** Was the contract skipped due to this condition? */
  skippedContract: boolean;
  durationMs: number;
}

export interface ContractExecutionResult {
  contractId: string;
  contractName: string;
  /** Precondition evaluation results. */
  preconditionResults: ConditionResult[];
  /** Whether all preconditions passed (or were warnings). */
  preconditionsPassed: boolean;
  /** Whether the contract was skipped due to a precondition with onFailure='skip'. */
  skipped: boolean;
  /** Core verification results (null if skipped). */
  verificationResults: SpecAssertionResult[] | null;
  verificationPassed: boolean;
  /** Postcondition evaluation results (null if skipped or verification failed). */
  postconditionResults: ConditionResult[] | null;
  postconditionsPassed: boolean;
  /** Overall pass/fail. */
  passed: boolean;
  /** Warnings from conditions with onFailure='warn'. */
  warnings: string[];
  durationMs: number;
  timestamp: number;
}

// =============================================================================
// Constants
// =============================================================================

export const CONTRACT_CONFIG_VERSION = '1.0.0';

export const CONTRACT_FILE_EXTENSION = '.contract.uibridge.json';
