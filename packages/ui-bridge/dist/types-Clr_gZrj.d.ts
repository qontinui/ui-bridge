import { i as SpecAssertionResult, e as SpecAssertion } from './types-MG0zeRbG.js';

/**
 * Verification Contract Types
 *
 * Schema-first verification contracts that formalize pre/postconditions
 * around spec group execution. Inspired by testergizer-open-core's
 * schema-first contract pattern.
 */

/**
 * How to check a contract condition.
 */
type ContractCheck = {
    /** Reuse existing spec assertion machinery. */
    type: 'assertion';
    assertion: SpecAssertion;
} | {
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
interface ContractCondition {
    /** Unique ID within the contract. */
    id: string;
    /** Human-readable description: "API server is reachable", "User is logged in". */
    description: string;
    /** The check to evaluate. */
    check: ContractCheck;
    /** What to do if this condition fails. */
    onFailure: 'skip' | 'fail' | 'warn';
}
/**
 * What to verify — either a reference to an existing spec group or inline assertions.
 */
type ContractVerification = {
    /** Reference a spec group by spec ID + group ID. */
    type: 'specGroupRef';
    specId: string;
    groupId: string;
} | {
    /** Inline assertions (no separate spec file needed). */
    type: 'inline';
    assertions: SpecAssertion[];
};
/**
 * A verification contract: preconditions → verification → postconditions.
 */
interface VerificationContract {
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
interface ContractMetadata {
    author?: string;
    component?: string;
    pageUrl?: string;
    tags?: string[];
    createdAt?: string;
    updatedAt?: string;
}
interface ContractConfig {
    version: '1.0.0';
    contracts: VerificationContract[];
    metadata?: {
        author?: string;
        description?: string;
    };
}
interface ConditionResult {
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
interface ContractExecutionResult {
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
declare const CONTRACT_CONFIG_VERSION = "1.0.0";
declare const CONTRACT_FILE_EXTENSION = ".contract.uibridge.json";

export { type ContractExecutionResult as C, type VerificationContract as V, CONTRACT_CONFIG_VERSION as a, CONTRACT_FILE_EXTENSION as b, type ConditionResult as c, type ContractCheck as d, type ContractCondition as e, type ContractConfig as f, type ContractMetadata as g, type ContractVerification as h };
