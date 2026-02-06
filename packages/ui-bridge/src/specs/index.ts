/**
 * Specs Module
 *
 * Declarative specification system for UI Bridge elements.
 * Specs define expected element behavior as assertions that can
 * be authored, stored, executed, and used for regression testing.
 */

// Types
export type {
  SpecCategory,
  SpecSeverity,
  SpecSource,
  SpecTarget,
  SpecAssertion,
  SpecGroup,
  SpecConfig,
  SpecMetadata,
  SpecAssertionResult,
  SpecGroupResult,
  SpecExecutionResult,
  SpecExecutionOptions,
  SpecCoverage,
  SpecEventType,
  SpecEvent,
  AssertionCondition,
} from './types';

// Re-export AI types used in spec assertions
export type { AssertionType, SearchCriteria } from '../ai/types';

export {
  SPEC_CONFIG_VERSION,
  SPEC_FILE_EXTENSION,
  VALID_ASSERTION_TYPES,
  VALID_SPEC_CATEGORIES,
  VALID_SPEC_SEVERITIES,
  VALID_SPEC_SOURCES,
} from './types';

// Validator
export {
  validateSpecConfig,
  validateSpecGroup,
  validateSpecAssertion,
  isValidAssertionType,
  isValidSpecCategory,
  isValidSpecSeverity,
  isValidSpecSource,
} from './validator';
export type { ValidationResult, ValidationError } from './validator';

// Migration
export {
  migrateFromTestGeneratorOutput,
  migrateLegacyAssertion,
  migrateLegacyTarget,
  coerceAssertionType,
} from './migration';
export type {
  LegacyTestGeneratorOutput,
  LegacyTestSpecification,
  LegacyTestAssertion,
  LegacyTestTarget,
} from './migration';

// Store
export { SpecStore, getGlobalSpecStore, resetGlobalSpecStore } from './store';
export type { SpecListener, SpecFilterOptions } from './store';

// Executor
export { SpecExecutor, resolveTarget } from './executor';
