/**
 * Spec Migration
 *
 * Converts legacy TestGeneratorOutput format (from qontinui-schemas)
 * to the new SpecConfig format.
 */

import type { AssertionType } from '../ai/types';
import { VALID_ASSERTION_TYPES } from './types';
import type {
  SpecConfig,
  SpecGroup,
  SpecAssertion,
  SpecTarget,
  SpecCategory,
  SpecSeverity,
  SpecSource,
} from './types';

// =============================================================================
// Legacy Types (inline — no dependency on qontinui-schemas)
// =============================================================================

export interface LegacyTestTarget {
  type: 'elementId' | 'formId' | 'modalId';
  elementId?: string;
  formId?: string;
  modalId?: string;
  label?: string;
}

export interface LegacyTestAssertion {
  id: string;
  description: string;
  category: string;
  severity: string;
  target: LegacyTestTarget;
  assertionType: string;
  expected?: unknown;
  attributeName?: string;
  source: string;
  reviewed: boolean;
  enabled: boolean;
  notes?: string;
}

export interface LegacyTestSpecification {
  id: string;
  name: string;
  description: string;
  category: string;
  assertions: LegacyTestAssertion[];
  stateId: string;
  transitionId?: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface LegacyTestGeneratorOutput {
  version: string;
  projectId?: string;
  generatorType?: string;
  states?: unknown[];
  transitions?: unknown[];
  testSpecifications: LegacyTestSpecification[];
  snapshotMetadata?: Record<string, unknown>;
  explorationMetadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

// =============================================================================
// Coercion Helpers
// =============================================================================

/**
 * Coerce a raw string to a valid AssertionType, or return null.
 */
export function coerceAssertionType(raw: string): AssertionType | null {
  if ((VALID_ASSERTION_TYPES as readonly string[]).includes(raw)) {
    return raw as AssertionType;
  }
  return null;
}

function coerceCategory(raw: string): SpecCategory {
  const valid: SpecCategory[] = [
    'element-presence',
    'accessibility',
    'form-validation',
    'state-consistency',
    'modal-dialog',
    'navigation',
    'cross-page-consistency',
    'custom',
  ];
  return valid.includes(raw as SpecCategory) ? (raw as SpecCategory) : 'custom';
}

function coerceSeverity(raw: string): SpecSeverity {
  const valid: SpecSeverity[] = ['critical', 'warning', 'info'];
  return valid.includes(raw as SpecSeverity) ? (raw as SpecSeverity) : 'info';
}

function coerceSource(raw: string): SpecSource {
  if (raw === 'auto' || raw === 'manual' || raw === 'ai-generated') return raw;
  return 'auto';
}

// =============================================================================
// Target Migration
// =============================================================================

/**
 * Convert a legacy TestTarget to a SpecTarget.
 */
export function migrateLegacyTarget(legacy: LegacyTestTarget): SpecTarget {
  switch (legacy.type) {
    case 'elementId':
      return {
        type: 'elementId',
        elementId: legacy.elementId || '',
        label: legacy.label,
      };
    case 'formId':
      return {
        type: 'search',
        criteria: {
          idPattern: legacy.formId || '',
          role: 'form',
        },
        label: legacy.label,
      };
    case 'modalId':
      return {
        type: 'search',
        criteria: {
          idPattern: legacy.modalId || '',
          role: 'dialog',
        },
        label: legacy.label,
      };
    default:
      return {
        type: 'elementId',
        elementId: '',
        label: legacy.label,
      };
  }
}

// =============================================================================
// Assertion Migration
// =============================================================================

/**
 * Convert a legacy TestAssertion to a SpecAssertion.
 */
export function migrateLegacyAssertion(legacy: LegacyTestAssertion): SpecAssertion {
  const assertionType = coerceAssertionType(legacy.assertionType);

  return {
    id: legacy.id,
    description: legacy.description,
    category: coerceCategory(legacy.category),
    severity: coerceSeverity(legacy.severity),
    target: migrateLegacyTarget(legacy.target),
    assertionType: assertionType ?? 'exists',
    expected: legacy.expected,
    attributeName: legacy.attributeName,
    source: coerceSource(legacy.source),
    reviewed: legacy.reviewed,
    enabled: legacy.enabled,
    notes: legacy.notes,
  };
}

// =============================================================================
// Full Migration
// =============================================================================

/**
 * Convert a legacy TestGeneratorOutput to a SpecConfig.
 */
export function migrateFromTestGeneratorOutput(legacy: LegacyTestGeneratorOutput): SpecConfig {
  const groups: SpecGroup[] = legacy.testSpecifications.map((spec) => ({
    id: spec.id,
    name: spec.name,
    description: spec.description,
    category: coerceCategory(spec.category),
    assertions: spec.assertions.map(migrateLegacyAssertion),
    stateId: spec.stateId,
    transitionId: spec.transitionId,
    source: coerceSource(spec.source),
  }));

  return {
    version: '1.0.0',
    description: legacy.generatorType
      ? `Migrated from ${legacy.generatorType} test generator output`
      : 'Migrated from legacy test generator output',
    groups,
    metadata: {
      createdAt: legacy.createdAt,
      updatedAt: legacy.updatedAt,
      ...(legacy.snapshotMetadata?.pageUrl
        ? { pageUrl: legacy.snapshotMetadata.pageUrl as string }
        : {}),
      ...(legacy.explorationMetadata?.targetUrl
        ? { pageUrl: legacy.explorationMetadata.targetUrl as string }
        : {}),
    },
  };
}
