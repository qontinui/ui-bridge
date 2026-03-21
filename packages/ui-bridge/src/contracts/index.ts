/**
 * Verification Contracts
 *
 * Schema-first verification contracts with pre/postconditions.
 */

export type {
  ContractCheck,
  ContractCondition,
  ContractVerification,
  VerificationContract,
  ContractMetadata,
  ContractConfig,
  ConditionResult,
  ContractExecutionResult,
} from './types';

export { CONTRACT_CONFIG_VERSION, CONTRACT_FILE_EXTENSION } from './types';

export { ContractExecutor } from './executor';
export type { ContractExecutionOptions } from './executor';

export { validateContractConfig } from './validator';
export type { ContractValidationError, ContractValidationResult } from './validator';
