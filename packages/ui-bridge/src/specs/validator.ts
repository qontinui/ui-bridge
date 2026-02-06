/**
 * Spec Validator
 *
 * Structural validation for .spec.uibridge.json files.
 * No JSON Schema dependency — validates manually.
 */

import type { AssertionType } from '../ai/types';
import {
  SPEC_CONFIG_VERSION,
  VALID_ASSERTION_TYPES,
  VALID_SPEC_CATEGORIES,
  VALID_SPEC_SEVERITIES,
  VALID_SPEC_SOURCES,
} from './types';
import type { SpecCategory, SpecSeverity, SpecSource } from './types';

// =============================================================================
// Types
// =============================================================================

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

// =============================================================================
// Type Guards
// =============================================================================

export function isValidAssertionType(value: unknown): value is AssertionType {
  return typeof value === 'string' && (VALID_ASSERTION_TYPES as readonly string[]).includes(value);
}

export function isValidSpecCategory(value: unknown): value is SpecCategory {
  return typeof value === 'string' && (VALID_SPEC_CATEGORIES as readonly string[]).includes(value);
}

export function isValidSpecSeverity(value: unknown): value is SpecSeverity {
  return typeof value === 'string' && (VALID_SPEC_SEVERITIES as readonly string[]).includes(value);
}

export function isValidSpecSource(value: unknown): value is SpecSource {
  return typeof value === 'string' && (VALID_SPEC_SOURCES as readonly string[]).includes(value);
}

// =============================================================================
// Assertion Validation
// =============================================================================

export function validateSpecAssertion(data: unknown, path = 'assertion'): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!data || typeof data !== 'object') {
    errors.push({ path, message: 'must be an object' });
    return errors;
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.id !== 'string' || obj.id.length === 0) {
    errors.push({ path: `${path}.id`, message: 'must be a non-empty string' });
  }

  if (typeof obj.description !== 'string') {
    errors.push({ path: `${path}.description`, message: 'must be a string' });
  }

  if (!isValidSpecCategory(obj.category)) {
    errors.push({
      path: `${path}.category`,
      message: `must be one of: ${VALID_SPEC_CATEGORIES.join(', ')}`,
    });
  }

  if (!isValidSpecSeverity(obj.severity)) {
    errors.push({
      path: `${path}.severity`,
      message: `must be one of: ${VALID_SPEC_SEVERITIES.join(', ')}`,
    });
  }

  // Target validation
  if (!obj.target || typeof obj.target !== 'object') {
    errors.push({ path: `${path}.target`, message: 'must be an object' });
  } else {
    const target = obj.target as Record<string, unknown>;
    if (target.type === 'elementId') {
      if (typeof target.elementId !== 'string' || target.elementId.length === 0) {
        errors.push({ path: `${path}.target.elementId`, message: 'must be a non-empty string' });
      }
    } else if (target.type === 'search') {
      if (!target.criteria || typeof target.criteria !== 'object') {
        errors.push({ path: `${path}.target.criteria`, message: 'must be an object' });
      }
    } else {
      errors.push({ path: `${path}.target.type`, message: 'must be "elementId" or "search"' });
    }
  }

  if (!isValidAssertionType(obj.assertionType)) {
    errors.push({
      path: `${path}.assertionType`,
      message: `must be one of: ${VALID_ASSERTION_TYPES.join(', ')}`,
    });
  }

  if (!isValidSpecSource(obj.source)) {
    errors.push({
      path: `${path}.source`,
      message: `must be one of: ${VALID_SPEC_SOURCES.join(', ')}`,
    });
  }

  if (typeof obj.reviewed !== 'boolean') {
    errors.push({ path: `${path}.reviewed`, message: 'must be a boolean' });
  }

  if (typeof obj.enabled !== 'boolean') {
    errors.push({ path: `${path}.enabled`, message: 'must be a boolean' });
  }

  if (obj.timeout !== undefined && (typeof obj.timeout !== 'number' || obj.timeout < 0)) {
    errors.push({ path: `${path}.timeout`, message: 'must be a non-negative number' });
  }

  return errors;
}

// =============================================================================
// Group Validation
// =============================================================================

export function validateSpecGroup(data: unknown, path = 'group'): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!data || typeof data !== 'object') {
    errors.push({ path, message: 'must be an object' });
    return errors;
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.id !== 'string' || obj.id.length === 0) {
    errors.push({ path: `${path}.id`, message: 'must be a non-empty string' });
  }

  if (typeof obj.name !== 'string') {
    errors.push({ path: `${path}.name`, message: 'must be a string' });
  }

  if (typeof obj.description !== 'string') {
    errors.push({ path: `${path}.description`, message: 'must be a string' });
  }

  if (!isValidSpecCategory(obj.category)) {
    errors.push({
      path: `${path}.category`,
      message: `must be one of: ${VALID_SPEC_CATEGORIES.join(', ')}`,
    });
  }

  if (!isValidSpecSource(obj.source)) {
    errors.push({
      path: `${path}.source`,
      message: `must be one of: ${VALID_SPEC_SOURCES.join(', ')}`,
    });
  }

  if (!Array.isArray(obj.assertions)) {
    errors.push({ path: `${path}.assertions`, message: 'must be an array' });
  } else {
    for (let i = 0; i < obj.assertions.length; i++) {
      errors.push(...validateSpecAssertion(obj.assertions[i], `${path}.assertions[${i}]`));
    }
  }

  return errors;
}

// =============================================================================
// Config Validation
// =============================================================================

export function validateSpecConfig(data: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: [{ path: '', message: 'must be an object' }] };
  }

  const obj = data as Record<string, unknown>;

  if (obj.version !== SPEC_CONFIG_VERSION) {
    errors.push({ path: 'version', message: `must be "${SPEC_CONFIG_VERSION}"` });
  }

  if (obj.description !== undefined && typeof obj.description !== 'string') {
    errors.push({ path: 'description', message: 'must be a string if provided' });
  }

  if (!Array.isArray(obj.groups)) {
    errors.push({ path: 'groups', message: 'must be an array' });
  } else {
    for (let i = 0; i < obj.groups.length; i++) {
      errors.push(...validateSpecGroup(obj.groups[i], `groups[${i}]`));
    }
  }

  if (obj.assertions !== undefined) {
    if (!Array.isArray(obj.assertions)) {
      errors.push({ path: 'assertions', message: 'must be an array if provided' });
    } else {
      for (let i = 0; i < obj.assertions.length; i++) {
        errors.push(...validateSpecAssertion(obj.assertions[i], `assertions[${i}]`));
      }
    }
  }

  if (obj.metadata !== undefined && (typeof obj.metadata !== 'object' || obj.metadata === null)) {
    errors.push({ path: 'metadata', message: 'must be an object if provided' });
  }

  return { valid: errors.length === 0, errors };
}
