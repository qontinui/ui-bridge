import { V as VerificationContract, C as ContractExecutionResult } from '../types-C9w2WFhh.mjs';
export { a as CONTRACT_CONFIG_VERSION, b as CONTRACT_FILE_EXTENSION, c as ConditionResult, d as ContractCheck, e as ContractCondition, f as ContractConfig, g as ContractMetadata, h as ContractVerification } from '../types-C9w2WFhh.mjs';
import { o as SpecExecutionOptions } from '../types-BAi5RZ1S.mjs';
import { am as DiscoveredElement, an as AIDiscoveredElement } from '../types-gR41i0Eb.mjs';
import { A as AssertionConfig } from '../assertions-CITDjwsv.mjs';

/**
 * Contract Executor
 *
 * Evaluates verification contracts: preconditions → verification → postconditions.
 * Wraps the existing SpecExecutor for assertion evaluation.
 */

declare class ContractExecutor {
    private specExecutor;
    constructor(config?: Partial<AssertionConfig>);
    /**
     * Update the element registry (pass-through to SpecExecutor).
     */
    updateElements(elements: Array<DiscoveredElement | AIDiscoveredElement>): void;
    /**
     * Execute a full verification contract.
     */
    execute(contract: VerificationContract, options?: ContractExecutionOptions): Promise<ContractExecutionResult>;
    private evaluateCondition;
    private runVerification;
}
interface ContractExecutionOptions {
    /** Options passed through to SpecExecutor for the verification phase. */
    specOptions?: SpecExecutionOptions;
}

/**
 * Contract Validator
 *
 * Validates .contract.uibridge.json files against the ContractConfig schema.
 */
interface ContractValidationError {
    path: string;
    message: string;
}
interface ContractValidationResult {
    valid: boolean;
    errors: ContractValidationError[];
}
/**
 * Validate a ContractConfig object.
 */
declare function validateContractConfig(config: unknown): ContractValidationResult;

export { type ContractExecutionOptions, ContractExecutionResult, ContractExecutor, type ContractValidationError, type ContractValidationResult, VerificationContract, validateContractConfig };
