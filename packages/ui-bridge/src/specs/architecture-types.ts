/**
 * Architecture Spec Types
 *
 * Type definitions for project-level architecture specifications.
 * Describes tech stack, directory structure, patterns, and constraints
 * for a project — even before any code exists.
 */

// Tech stack entry
export interface TechStackEntry {
  name: string;
  category: 'language' | 'framework' | 'library' | 'database' | 'service' | 'tool' | 'other';
  version?: string;
  purpose: string;
}

// Directory structure entry
export interface DirectoryEntry {
  path: string;
  purpose: string;
  /** Whether this directory must exist (vs optional) */
  required: boolean;
}

// Architectural pattern
export interface ArchitecturePattern {
  id: string;
  name: string;
  description: string;
  /** Which areas of the project this pattern applies to */
  scope: 'frontend' | 'backend' | 'fullstack' | 'infrastructure' | 'data';
}

// Architecture constraint (things that must be true)
export interface ArchitectureConstraint {
  id: string;
  description: string;
  category: 'performance' | 'security' | 'accessibility' | 'compatibility' | 'convention' | 'other';
  severity: 'critical' | 'warning' | 'info';
  /** How to verify this constraint */
  verificationHint?: string;
}

// Page/feature dependency
export interface FeatureDependency {
  /** Feature that depends on another */
  featureId: string;
  /** Feature that is depended upon */
  dependsOn: string;
  /** Type of dependency */
  type: 'requires' | 'extends' | 'uses';
  description?: string;
}

// Feature definition (for project planning)
export interface FeatureSpec {
  id: string;
  name: string;
  description: string;
  /** Associated page spec ID (if this feature has a UI) */
  pageSpecId?: string;
  /** Priority for build ordering */
  priority: 'critical' | 'high' | 'medium' | 'low';
  /** Status for tracking progress */
  status: 'planned' | 'in-progress' | 'completed' | 'blocked';
}

// Main architecture config (the .architecture.uibridge.json format)
export interface ArchitectureConfig {
  version: '1.0.0';
  projectName: string;
  description?: string;
  techStack: TechStackEntry[];
  directories: DirectoryEntry[];
  patterns: ArchitecturePattern[];
  constraints: ArchitectureConstraint[];
  features: FeatureSpec[];
  dependencies: FeatureDependency[];
  metadata?: {
    author?: string;
    createdAt?: string;
    updatedAt?: string;
    [key: string]: unknown;
  };
}

export const ARCHITECTURE_FILE_EXTENSION = '.architecture.uibridge.json';
export const ARCHITECTURE_CONFIG_VERSION = '1.0.0';
