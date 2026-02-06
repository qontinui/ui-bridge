/**
 * AI Module
 *
 * AI-native interface for UI Bridge providing:
 * - Natural language element search
 * - Natural language action execution
 * - Semantic snapshots and diffs
 * - Assertion/verification API
 * - Rich error context
 */

// Types
export type {
  // Search types
  SearchCriteria,
  SearchResult,
  SearchResponse,

  // AI Element types
  AIDiscoveredElement,
  AIFindResponse,
  PageContext,
  FormAnalysis,
  FormFieldAnalysis,

  // NL Action types
  NLActionRequest,
  NLActionResponse,
  ParsedAction,

  // Assertion types
  AssertionType,
  AssertionRequest,
  AssertionResult,
  BatchAssertionRequest,
  BatchAssertionResult,

  // Snapshot types
  SemanticSnapshot,
  FormState,
  FormFieldState,
  ModalState,

  // Diff types
  SemanticDiff,
  ElementChange,
  ElementModification,

  // Error types
  AIErrorContext,
  RecoverySuggestion,

  // Registration types
  AIElementRegistrationOptions,

  // Semantic search types
  SemanticSearchCriteria,
  SemanticSearchResult,
  SemanticSearchResponse,
} from './types';

// Fuzzy Matcher
export {
  levenshteinDistance,
  levenshteinSimilarity,
  jaroSimilarity,
  jaroWinklerSimilarity,
  generateNgrams,
  ngramSimilarity,
  normalizeString,
  fuzzyMatch,
  findBestMatch,
  findAllMatches,
  fuzzyContains,
  wordSimilarity,
  tokenize,
  tokenSimilarity,
  DEFAULT_FUZZY_CONFIG,
} from './fuzzy-matcher';
export type { FuzzyMatchConfig, FuzzyMatchResult } from './fuzzy-matcher';

// Alias Generator
export {
  generateAliases,
  generateDescription,
  generatePurpose,
  generateSuggestedActions,
  getSynonyms,
  areSynonyms,
  DEFAULT_ALIAS_CONFIG,
} from './alias-generator';
export type { AliasGeneratorConfig, AliasGeneratorInput } from './alias-generator';

// Search Engine
export { SearchEngine, createSearchEngine, DEFAULT_SEARCH_CONFIG } from './search-engine';
export type { SearchEngineConfig } from './search-engine';

// Summary Generator
export {
  generatePageSummary,
  generateElementDescription,
  generateSnapshotSummary,
  generateDiffSummary,
  inferPageType,
} from './summary-generator';
export type { SummaryConfig } from './summary-generator';

// NL Action Parser
export {
  parseNLInstruction,
  parseNLInstructions,
  splitCompoundInstruction,
  extractModifiers,
  validateParsedAction,
  describeAction,
} from './nl-action-parser';

// NL Action Executor
export {
  NLActionExecutor,
  createNLActionExecutor,
  DEFAULT_EXECUTOR_CONFIG,
} from './nl-action-executor';
export type { NLActionExecutorConfig } from './nl-action-executor';

// Assertions
export { AssertionExecutor, createAssertionExecutor, DEFAULT_ASSERTION_CONFIG } from './assertions';
export type { AssertionConfig } from './assertions';

// Semantic Snapshot
export {
  SemanticSnapshotManager,
  createSnapshotManager,
  DEFAULT_SNAPSHOT_CONFIG,
} from './semantic-snapshot';
export type { SemanticSnapshotConfig } from './semantic-snapshot';

// Semantic Diff
export {
  computeDiff,
  SemanticDiffManager,
  createDiffManager,
  hasSignificantChanges,
  describeDiff,
  DEFAULT_DIFF_CONFIG,
} from './semantic-diff';
export type { SemanticDiffConfig } from './semantic-diff';

// Error Context
export {
  ErrorCodes,
  createErrorContext,
  formatErrorContext,
  createSimpleError,
  isRecoverableError,
  getBestRecoverySuggestion,
} from './error-context';
export type { ErrorCode } from './error-context';
