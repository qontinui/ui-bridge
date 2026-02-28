/**
 * Spec Types
 *
 * Type definitions for the UI Bridge specification system.
 * Specs define declarative assertions about UI elements that can be
 * authored, stored, executed, and used for regression testing.
 */

import type { AssertionType, AssertionResult, SearchCriteria } from '../ai/types';

// =============================================================================
// Categories & Severity
// =============================================================================

export type SpecCategory =
  | 'element-presence'
  | 'accessibility'
  | 'form-validation'
  | 'state-consistency'
  | 'modal-dialog'
  | 'navigation'
  | 'cross-page-consistency'
  | 'semantic'
  | 'design'
  | 'custom';

export type SpecSeverity = 'critical' | 'warning' | 'info';

export type SpecSource = 'auto' | 'manual' | 'ai-generated';

// =============================================================================
// Targets
// =============================================================================

/**
 * Unified target for spec assertions.
 * Bridges to AssertionRequest.target (string | SearchCriteria).
 */
export type SpecTarget =
  | { type: 'elementId'; elementId: string; label?: string }
  | { type: 'search'; criteria: SearchCriteria; label?: string };

// =============================================================================
// Conditions (for conditional assertions)
// =============================================================================

/**
 * A condition that must be met for an assertion to be evaluated.
 * If the condition is not met, the assertion is skipped (passes with no opinion).
 *
 * Use case: "Button is disabled WHEN runner is not connected"
 * - The assertion only has an opinion when the runner is NOT connected
 * - When connected, the assertion should skip (not fail)
 */
export type AssertionCondition =
  | {
      /** Check if a target element exists */
      type: 'exists';
      target: SpecTarget;
    }
  | {
      /** Check if a target element does NOT exist */
      type: 'notExists';
      target: SpecTarget;
    }
  | {
      /** Check if a target element has specific text content */
      type: 'hasText';
      target: SpecTarget;
      text: string;
    };

// =============================================================================
// Assertions
// =============================================================================

/**
 * A single spec assertion — wraps an AssertionRequest with metadata.
 */
export interface SpecAssertion {
  id: string;
  description: string;
  category: SpecCategory;
  severity: SpecSeverity;
  target: SpecTarget;
  /** Strongly typed assertion type from ui-bridge/ai */
  assertionType: AssertionType;
  expected?: unknown;
  attributeName?: string;
  propertyName?: string;
  message?: string;
  timeout?: number;
  source: SpecSource;
  reviewed: boolean;
  enabled: boolean;
  notes?: string;
  /**
   * Human-readable precondition describing when this assertion applies.
   * Complements the machine-evaluated `condition` field with a natural-language
   * description of the expected UI state (e.g., "Workflow is loaded in editor").
   */
  precondition?: string;
  /**
   * Optional condition that must be met for this assertion to be evaluated.
   * If condition is not met, the assertion is skipped (passes with no opinion).
   *
   * Example: "A is false when B is false" → condition checks if B is false,
   * and only then evaluates whether A is false. If B is true, skip.
   */
  condition?: AssertionCondition;
}

// =============================================================================
// Groups
// =============================================================================

/**
 * A named collection of related spec assertions.
 */
export interface SpecGroup {
  id: string;
  name: string;
  description: string;
  category: SpecCategory;
  assertions: SpecAssertion[];
  stateId?: string;
  transitionId?: string;
  source: SpecSource;
  tags?: string[];
}

// =============================================================================
// Config (the .spec.uibridge.json file format)
// =============================================================================

export interface SpecMetadata {
  component?: string;
  author?: string;
  createdAt?: string;
  updatedAt?: string;
  pageUrl?: string;
  tags?: string[];
  /** Explicit element source: "control" for runner UI, "external" for browser tab */
  elementSource?: 'control' | 'external';
  [key: string]: unknown;
}

/**
 * Top-level spec config — the JSON file format.
 */
export interface SpecConfig {
  version: '1.0.0';
  description?: string;
  groups: SpecGroup[];
  /** Ungrouped assertions (convenience for simple specs) */
  assertions?: SpecAssertion[];
  metadata?: SpecMetadata;
}

// =============================================================================
// Execution Results
// =============================================================================

export interface SpecAssertionResult {
  assertionId: string;
  groupId?: string;
  severity: SpecSeverity;
  category: SpecCategory;
  skipped: boolean;
  /** Reason for skipping (if skipped) */
  skipReason?: 'disabled' | 'condition_not_met' | 'filtered';
  /** The underlying assertion result (null if skipped) */
  result: AssertionResult | null;
}

export interface SpecGroupResult {
  groupId: string;
  groupName: string;
  assertionResults: SpecAssertionResult[];
  passedCount: number;
  failedCount: number;
  skippedCount: number;
  passed: boolean;
  durationMs: number;
  timestamp: number;
}

export interface SpecExecutionResult {
  specVersion: string;
  groupResults: SpecGroupResult[];
  ungroupedResults: SpecAssertionResult[];
  totalAssertions: number;
  passedCount: number;
  failedCount: number;
  skippedCount: number;
  passed: boolean;
  durationMs: number;
  timestamp: number;
}

export interface SpecExecutionOptions {
  categories?: SpecCategory[];
  severities?: SpecSeverity[];
  groupIds?: string[];
  assertionIds?: string[];
  stopOnFailure?: boolean;
  skipUnreviewed?: boolean;
  timeout?: number;
}

// =============================================================================
// Coverage
// =============================================================================

export interface SpecCoverage {
  totalElements: number;
  specifiedElements: number;
  coveragePercent: number;
  specifiedIds: string[];
  unspecifiedIds: string[];
  timestamp: number;
}

// =============================================================================
// Events
// =============================================================================

export type SpecEventType =
  | 'spec:loaded'
  | 'spec:unloaded'
  | 'spec:updated'
  | 'spec:cleared'
  | 'spec:assertion-added'
  | 'spec:assertion-removed'
  | 'spec:group-added'
  | 'spec:group-removed';

export interface SpecEvent {
  type: SpecEventType;
  specId?: string;
  groupId?: string;
  assertionId?: string;
  timestamp: number;
}

// =============================================================================
// Constants
// =============================================================================

export const SPEC_CONFIG_VERSION = '1.0.0';

export const SPEC_FILE_EXTENSION = '.spec.uibridge.json';

export const VALID_ASSERTION_TYPES: readonly AssertionType[] = [
  'visible',
  'hidden',
  'enabled',
  'disabled',
  'focused',
  'checked',
  'unchecked',
  'hasText',
  'containsText',
  'hasValue',
  'hasClass',
  'exists',
  'notExists',
  'count',
  'attribute',
  'cssProperty',
  'cssPropertyInSet',
  'cssPropertyRange',
  'tokenCompliance',
] as const;

export const VALID_SPEC_CATEGORIES: readonly SpecCategory[] = [
  'element-presence',
  'accessibility',
  'form-validation',
  'state-consistency',
  'modal-dialog',
  'navigation',
  'cross-page-consistency',
  'semantic',
  'design',
  'custom',
] as const;

export const VALID_SPEC_SEVERITIES: readonly SpecSeverity[] = [
  'critical',
  'warning',
  'info',
] as const;

export const VALID_SPEC_SOURCES: readonly SpecSource[] = [
  'auto',
  'manual',
  'ai-generated',
] as const;
