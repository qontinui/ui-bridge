/**
 * Dependency Spec Types
 *
 * Type definitions for cross-cutting dependency mapping.
 * Maps relationships between pages, API endpoints, data entities,
 * and modules — enabling build ordering and impact analysis.
 *
 * Distinct from FeatureDependency in architecture specs (feature-to-feature).
 * This maps concrete artifacts: which page calls which API endpoint,
 * which endpoint reads/writes which data entity, etc.
 */

// The kind of artifact being referenced
export type ArtifactKind =
  | 'page'
  | 'api-endpoint'
  | 'data-entity'
  | 'module'
  | 'service'
  | 'component';

// A reference to a specific artifact
export interface ArtifactRef {
  /** Kind of artifact */
  kind: ArtifactKind;
  /** ID within its spec (e.g., endpoint ID, entity ID, page spec ID) */
  artifactId: string;
  /** Which spec file this artifact lives in */
  specId?: string;
  /** Human-readable label */
  label?: string;
}

// A dependency link between two artifacts
export interface DependencyLink {
  id: string;
  /** The artifact that depends on another */
  from: ArtifactRef;
  /** The artifact being depended upon */
  to: ArtifactRef;
  /** Nature of the dependency */
  type: 'calls' | 'reads' | 'writes' | 'renders' | 'imports' | 'extends' | 'configures';
  /** Is this dependency required for the "from" artifact to function? */
  required: boolean;
  description?: string;
}

// A module/package in the project
export interface ModuleRef {
  id: string;
  name: string;
  /** File path or package name */
  path: string;
  description?: string;
  /** What kind of module */
  moduleType:
    | 'page'
    | 'component'
    | 'service'
    | 'utility'
    | 'middleware'
    | 'config'
    | 'test'
    | 'other';
}

// A dependency cluster — a group of tightly coupled artifacts
export interface DependencyCluster {
  id: string;
  name: string;
  description: string;
  /** Artifact refs in this cluster */
  artifacts: ArtifactRef[];
  /** Build priority — clusters with lower numbers should be built first */
  buildOrder: number;
}

// Main dependency config (the .deps.uibridge.json format)
export interface DependencyConfig {
  version: '1.0.0';
  description?: string;
  /** All modules/packages in the project */
  modules: ModuleRef[];
  /** All dependency links */
  links: DependencyLink[];
  /** Optional grouping into build-order clusters */
  clusters?: DependencyCluster[];
  metadata?: {
    author?: string;
    createdAt?: string;
    updatedAt?: string;
    [key: string]: unknown;
  };
}

export const DEPENDENCY_FILE_EXTENSION = '.deps.uibridge.json';
export const DEPENDENCY_CONFIG_VERSION = '1.0.0';
