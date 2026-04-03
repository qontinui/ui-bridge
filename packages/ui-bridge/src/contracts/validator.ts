/**
 * Contract Validator
 *
 * Validates .contract.uibridge.json files against the ContractConfig schema.
 */

import { CONTRACT_CONFIG_VERSION } from './types';

export interface ContractValidationError {
  path: string;
  message: string;
}

export interface ContractValidationResult {
  valid: boolean;
  errors: ContractValidationError[];
}

/**
 * Validate a ContractConfig object.
 */
export function validateContractConfig(config: unknown): ContractValidationResult {
  const errors: ContractValidationError[] = [];

  if (!config || typeof config !== 'object') {
    return { valid: false, errors: [{ path: '', message: 'must be an object' }] };
  }

  const obj = config as Record<string, unknown>;

  // Version
  if (obj.version !== CONTRACT_CONFIG_VERSION) {
    errors.push({
      path: 'version',
      message: `must be "${CONTRACT_CONFIG_VERSION}"`,
    });
  }

  // Contracts array
  if (!Array.isArray(obj.contracts)) {
    errors.push({ path: 'contracts', message: 'must be an array' });
  } else {
    for (let i = 0; i < obj.contracts.length; i++) {
      validateContract(obj.contracts[i], `contracts[${i}]`, errors);
    }
  }

  return { valid: errors.length === 0, errors };
}

function validateContract(
  contract: unknown,
  path: string,
  errors: ContractValidationError[]
): void {
  if (!contract || typeof contract !== 'object') {
    errors.push({ path, message: 'must be an object' });
    return;
  }

  const obj = contract as Record<string, unknown>;

  if (typeof obj.id !== 'string' || obj.id.length === 0) {
    errors.push({ path: `${path}.id`, message: 'must be a non-empty string' });
  }
  if (typeof obj.name !== 'string' || obj.name.length === 0) {
    errors.push({ path: `${path}.name`, message: 'must be a non-empty string' });
  }
  if (typeof obj.description !== 'string') {
    errors.push({ path: `${path}.description`, message: 'must be a string' });
  }

  // Preconditions
  if (!Array.isArray(obj.preconditions)) {
    errors.push({ path: `${path}.preconditions`, message: 'must be an array' });
  } else {
    for (let i = 0; i < obj.preconditions.length; i++) {
      validateCondition(obj.preconditions[i], `${path}.preconditions[${i}]`, errors);
    }
  }

  // Verification
  if (!obj.verification || typeof obj.verification !== 'object') {
    errors.push({ path: `${path}.verification`, message: 'must be an object' });
  } else {
    const v = obj.verification as Record<string, unknown>;
    if (v.type === 'specGroupRef') {
      if (typeof v.specId !== 'string') {
        errors.push({ path: `${path}.verification.specId`, message: 'must be a string' });
      }
      if (typeof v.groupId !== 'string') {
        errors.push({ path: `${path}.verification.groupId`, message: 'must be a string' });
      }
    } else if (v.type === 'inline') {
      if (!Array.isArray(v.assertions)) {
        errors.push({ path: `${path}.verification.assertions`, message: 'must be an array' });
      }
    } else {
      errors.push({
        path: `${path}.verification.type`,
        message: 'must be "specGroupRef" or "inline"',
      });
    }
  }

  // Postconditions
  if (!Array.isArray(obj.postconditions)) {
    errors.push({ path: `${path}.postconditions`, message: 'must be an array' });
  } else {
    for (let i = 0; i < obj.postconditions.length; i++) {
      validateCondition(obj.postconditions[i], `${path}.postconditions[${i}]`, errors);
    }
  }
}

function validateCondition(
  condition: unknown,
  path: string,
  errors: ContractValidationError[]
): void {
  if (!condition || typeof condition !== 'object') {
    errors.push({ path, message: 'must be an object' });
    return;
  }

  const obj = condition as Record<string, unknown>;

  if (typeof obj.id !== 'string' || obj.id.length === 0) {
    errors.push({ path: `${path}.id`, message: 'must be a non-empty string' });
  }
  if (typeof obj.description !== 'string') {
    errors.push({ path: `${path}.description`, message: 'must be a string' });
  }

  // Check
  if (!obj.check || typeof obj.check !== 'object') {
    errors.push({ path: `${path}.check`, message: 'must be an object' });
  } else {
    const check = obj.check as Record<string, unknown>;
    if (check.type === 'assertion') {
      if (!check.assertion || typeof check.assertion !== 'object') {
        errors.push({ path: `${path}.check.assertion`, message: 'must be an object' });
      }
    } else if (check.type === 'api') {
      if (typeof check.endpoint !== 'string') {
        errors.push({ path: `${path}.check.endpoint`, message: 'must be a string' });
      }
      if (!['GET', 'POST', 'PUT', 'DELETE'].includes(check.method as string)) {
        errors.push({
          path: `${path}.check.method`,
          message: 'must be GET, POST, PUT, or DELETE',
        });
      }
      if (typeof check.expectedStatus !== 'number') {
        errors.push({ path: `${path}.check.expectedStatus`, message: 'must be a number' });
      }
    } else {
      errors.push({ path: `${path}.check.type`, message: 'must be "assertion" or "api"' });
    }
  }

  // onFailure
  if (!['skip', 'fail', 'warn'].includes(obj.onFailure as string)) {
    errors.push({ path: `${path}.onFailure`, message: 'must be "skip", "fail", or "warn"' });
  }
}
