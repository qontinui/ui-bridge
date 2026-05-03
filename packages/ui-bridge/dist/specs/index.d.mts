import { S as SpecCategory, a as SpecSeverity, r as SpecSource, c as SpecConfig, e as SpecAssertion, s as SpecTarget, i as SpecAssertionResult, d as SpecGroup, o as SpecExecutionOptions, h as SpecGroupResult, g as SpecExecutionResult } from '../types-BAi5RZ1S.mjs';
export { A as AssertionCondition, j as AsyncStrategy, k as SPEC_CONFIG_VERSION, l as SPEC_FILE_EXTENSION, m as SetupAction, f as SpecCoverage, b as SpecEvent, n as SpecEventType, p as SpecGroupTesting, q as SpecMetadata, t as SpecTestingConfig, T as TestDataAsset, u as TestFixture, v as TestInfrastructureRequirements, w as TestScenario, x as TestStep, V as VALID_ASSERTION_TYPES, y as VALID_SPEC_CATEGORIES, z as VALID_SPEC_SEVERITIES, B as VALID_SPEC_SOURCES } from '../types-BAi5RZ1S.mjs';
import { ao as AssertionType, am as DiscoveredElement, an as AIDiscoveredElement, K as AssertionRequest, G as SearchCriteria, ce as ExtendedComputedStyles, ag as ElementDesignData } from '../types-gR41i0Eb.mjs';
export { a as SpecFilterOptions, b as SpecListener, S as SpecStore, g as getGlobalSpecStore, r as resetGlobalSpecStore } from '../store-YDeTApd3.mjs';
import { A as AssertionConfig } from '../assertions-CITDjwsv.mjs';
import { g as ArtifactStore } from '../types-py3YaOCv.mjs';
import { p as StyleConstraint, D as DesignTokens, q as StyleConstraintResult, S as StyleGuideConfig, a as StyleAuditReport, r as StyleRule, s as StyleValidationResult, k as QualityMetricId, f as MetricFunction, h as QualityContext, V as ViewportDimensions, Q as QualityEvaluationReport, n as SnapshotBaseline, b as SnapshotDiffReport } from '../style-types-CAMWbmV6.mjs';
export { c as ElementDiff, E as EvaluateRequest, L as LayoutShift, M as MetricContextConfig, d as MetricFinding, e as MetricFindingSeverity, g as MetricResult, i as QualityGrade, j as QualityMetricCategory, l as STYLE_GUIDE_FILE_EXTENSION, m as STYLE_GUIDE_VERSION, o as StyleChange } from '../style-types-CAMWbmV6.mjs';
import '../types-C9w2WFhh.mjs';
import '../types-BXo-P-4N.mjs';

/**
 * Spec Validator
 *
 * Structural validation for .spec.uibridge.json files.
 * No JSON Schema dependency — validates manually.
 */

interface ValidationError {
    path: string;
    message: string;
}
interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
}
declare function isValidAssertionType(value: unknown): value is AssertionType;
declare function isValidSpecCategory(value: unknown): value is SpecCategory;
declare function isValidSpecSeverity(value: unknown): value is SpecSeverity;
declare function isValidSpecSource(value: unknown): value is SpecSource;
declare function validateSpecAssertion(data: unknown, path?: string): ValidationError[];
declare function validateSpecGroup(data: unknown, path?: string): ValidationError[];
declare function validateSpecConfig(data: unknown): ValidationResult;

/**
 * Spec Migration
 *
 * Converts legacy TestGeneratorOutput format (from qontinui-schemas)
 * to the new SpecConfig format.
 */

interface LegacyTestTarget {
    type: 'elementId' | 'formId' | 'modalId';
    elementId?: string;
    formId?: string;
    modalId?: string;
    label?: string;
}
interface LegacyTestAssertion {
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
interface LegacyTestSpecification {
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
interface LegacyTestGeneratorOutput {
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
/**
 * Coerce a raw string to a valid AssertionType, or return null.
 */
declare function coerceAssertionType(raw: string): AssertionType | null;
/**
 * Convert a legacy TestTarget to a SpecTarget.
 */
declare function migrateLegacyTarget(legacy: LegacyTestTarget): SpecTarget;
/**
 * Convert a legacy TestAssertion to a SpecAssertion.
 */
declare function migrateLegacyAssertion(legacy: LegacyTestAssertion): SpecAssertion;
/**
 * Convert a legacy TestGeneratorOutput to a SpecConfig.
 */
declare function migrateFromTestGeneratorOutput(legacy: LegacyTestGeneratorOutput): SpecConfig;

/**
 * Spec Executor
 *
 * Converts SpecAssertions to AssertionRequests and delegates
 * to the existing AssertionExecutor from ui-bridge/ai.
 */

/**
 * Resolve a SpecTarget to an AssertionRequest target.
 *
 * For elementId targets, returns a SearchCriteria with idPattern for exact
 * ID matching rather than a raw string (which would be treated as a text search).
 */
declare function resolveTarget(target: SpecTarget): string | SearchCriteria;
interface SpecExecutorConfig {
    /** Assertion configuration. */
    assertionConfig?: Partial<AssertionConfig>;
    /** Optional artifact store — when set, results are automatically persisted as immutable artifacts. */
    artifactStore?: ArtifactStore;
    /** Spec ID used as source when creating artifacts. */
    specId?: string;
}
declare class SpecExecutor {
    private assertionExecutor;
    private artifactStore?;
    private specId?;
    constructor(config?: Partial<AssertionConfig> | SpecExecutorConfig);
    /**
     * Update the element registry (pass-through to AssertionExecutor).
     */
    updateElements(elements: Array<DiscoveredElement | AIDiscoveredElement>): void;
    /**
     * Convert a SpecAssertion to an AssertionRequest.
     */
    toAssertionRequest(assertion: SpecAssertion): AssertionRequest;
    /**
     * Evaluate a condition to determine if an assertion should be executed.
     * Returns true if the condition is met (assertion should run),
     * false if condition is not met (assertion should skip/pass).
     */
    private evaluateCondition;
    /**
     * Execute a single SpecAssertion.
     */
    executeAssertion(assertion: SpecAssertion): Promise<SpecAssertionResult>;
    /**
     * Execute all assertions in a SpecGroup.
     */
    executeGroup(group: SpecGroup, options?: SpecExecutionOptions): Promise<SpecGroupResult>;
    /**
     * Execute a full SpecConfig.
     */
    execute(config: SpecConfig, options?: SpecExecutionOptions): Promise<SpecExecutionResult>;
    /**
     * Emit a result to the artifact store if configured.
     * Failures are silently caught to avoid breaking the execution pipeline.
     */
    private emitArtifact;
}

/**
 * Style Validator Module
 *
 * Validates element design data against a style guide configuration.
 * Resolves design tokens, evaluates constraints, and produces audit reports.
 */

/**
 * Resolve a dot-path token reference to its value from design tokens.
 *
 * @param tokenPath - Dot-separated path like "colors.primary" or "typography.fontSizes.lg"
 * @param tokens - The design tokens object
 * @returns The resolved value, or null if not found
 */
declare function resolveTokenValue(tokenPath: string, tokens: DesignTokens): string | null;
/**
 * Evaluate a single style constraint against an element's computed styles.
 */
declare function evaluateConstraint(constraint: StyleConstraint, styles: ExtendedComputedStyles, tokens: DesignTokens, customProperties?: Record<string, string>): StyleConstraintResult;
/**
 * Validate an element's design data against a set of rules.
 */
declare function validateElement(data: ElementDesignData, rules: StyleRule[], tokens: DesignTokens): StyleValidationResult[];
/**
 * Run a complete style audit against a style guide.
 */
declare function runStyleAudit(elements: ElementDesignData[], guide: StyleGuideConfig): StyleAuditReport;

/**
 * Color Utilities
 *
 * Pure-math color functions for quality metric computations.
 * No DOM or browser APIs — works in any JavaScript runtime.
 */
interface RGBA {
    r: number;
    g: number;
    b: number;
    a: number;
}
interface HSL {
    h: number;
    s: number;
    l: number;
}
/**
 * Parse a CSS color string to RGBA.
 * Supports: hex (#RGB, #RRGGBB, #RRGGBBAA), rgb(), rgba(), named colors.
 * Returns null for unparseable values.
 */
declare function parseColor(str: string): RGBA | null;
/**
 * Convert RGB to HSL.
 */
declare function rgbToHsl(color: RGBA): HSL;
/**
 * Compute WCAG 2.1 relative luminance (0-1).
 */
declare function relativeLuminance(color: RGBA): number;
/**
 * Compute WCAG contrast ratio between two colors.
 * Returns a value between 1 and 21.
 */
declare function contrastRatio(fg: RGBA, bg: RGBA): number;
/**
 * Weighted Euclidean distance in RGB space.
 * Uses human perception weights (red is less perceptually distinct).
 */
declare function colorDistance(c1: RGBA, c2: RGBA): number;
/**
 * Cluster colors by distance using single-linkage clustering.
 * Returns array of clusters, each an array of input colors.
 */
declare function clusterColors(colors: RGBA[], threshold?: number): RGBA[][];
/**
 * Check if a color is effectively grayscale (saturation < threshold).
 */
declare function isGrayscale(color: RGBA, threshold?: number): boolean;
/**
 * Angular distance between two hue values (0-360), accounting for wraparound.
 */
declare function hueDistance(h1: number, h2: number): number;

/**
 * Quality Metrics
 *
 * 22 metric functions measuring holistic UI quality across
 * density, spacing, color, typography, and consistency.
 * All functions are pure — no DOM or browser APIs.
 */

declare const METRIC_FUNCTIONS: Record<QualityMetricId, MetricFunction>;

/**
 * Quality Contexts
 *
 * Built-in evaluation contexts that adjust metric weights and thresholds
 * for different UI design philosophies.
 */

declare const BUILT_IN_CONTEXTS: Record<string, QualityContext>;
/**
 * Get a context by name. Returns undefined if not found.
 */
declare function getContext(name: string): QualityContext | undefined;
/**
 * List available context names and descriptions.
 */
declare function listContexts(): Array<{
    name: string;
    description: string;
}>;
/**
 * Merge a base context with partial overrides.
 * Useful for creating custom contexts that extend built-in ones.
 */
declare function mergeContext(base: QualityContext, overrides: Partial<QualityContext>): QualityContext;

/**
 * Quality Evaluator
 *
 * Orchestrator that runs quality metrics, applies context weights,
 * and produces a comprehensive evaluation report.
 */

/**
 * Run a holistic UI quality evaluation.
 *
 * @param elements - Design data for all elements to evaluate
 * @param viewport - Viewport dimensions
 * @param context - Context name (string) or custom context object. Defaults to 'general'.
 * @returns Complete evaluation report with scores, grades, and actionable findings
 */
declare function evaluateQuality(elements: ElementDesignData[], viewport: ViewportDimensions, context?: QualityContext | string): QualityEvaluationReport;

/**
 * Quality Diff
 *
 * Snapshot baseline creation and diffing for regression detection.
 * Compares element design data across two points in time.
 */

/**
 * Create a snapshot baseline from current element data.
 */
declare function createBaseline(elements: ElementDesignData[], viewport: ViewportDimensions, label?: string): SnapshotBaseline;
interface DiffOptions {
    /** Layout shift threshold in px to consider "significant". Default: 2 */
    layoutThreshold?: number;
    /** CLS threshold to flag hasSignificantChanges. Default: 0.1 */
    clsThreshold?: number;
}
/**
 * Diff current elements against a baseline snapshot.
 */
declare function diffSnapshots(baseline: SnapshotBaseline, current: ElementDesignData[], options?: DiffOptions): SnapshotDiffReport;

/**
 * Architecture Spec Types
 *
 * Type definitions for project-level architecture specifications.
 * Describes tech stack, directory structure, patterns, and constraints
 * for a project — even before any code exists.
 */
interface TechStackEntry {
    name: string;
    category: 'language' | 'framework' | 'library' | 'database' | 'service' | 'tool' | 'other';
    version?: string;
    purpose: string;
}
interface DirectoryEntry {
    path: string;
    purpose: string;
    /** Whether this directory must exist (vs optional) */
    required: boolean;
}
interface ArchitecturePattern {
    id: string;
    name: string;
    description: string;
    /** Which areas of the project this pattern applies to */
    scope: 'frontend' | 'backend' | 'fullstack' | 'infrastructure' | 'data';
}
interface ArchitectureConstraint {
    id: string;
    description: string;
    category: 'performance' | 'security' | 'accessibility' | 'compatibility' | 'convention' | 'other';
    severity: 'critical' | 'warning' | 'info';
    /** How to verify this constraint */
    verificationHint?: string;
}
interface FeatureDependency {
    /** Feature that depends on another */
    featureId: string;
    /** Feature that is depended upon */
    dependsOn: string;
    /** Type of dependency */
    type: 'requires' | 'extends' | 'uses';
    description?: string;
}
interface FeatureSpec {
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
interface ArchitectureConfig {
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
declare const ARCHITECTURE_FILE_EXTENSION = ".architecture.uibridge.json";
declare const ARCHITECTURE_CONFIG_VERSION = "1.0.0";

/**
 * API Spec Types
 *
 * Type definitions for API contract specifications.
 * Describes endpoints, request/response schemas, and data models
 * that connect frontend pages to backend services.
 */
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
interface SchemaField {
    name: string;
    type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null' | 'any';
    required: boolean;
    description?: string;
    /** For object types, nested fields */
    fields?: SchemaField[];
    /** For array types, item type */
    items?: SchemaField;
    /** Example value */
    example?: unknown;
}
interface ApiEndpoint {
    id: string;
    /** HTTP method */
    method: HttpMethod;
    /** Path pattern, e.g. "/api/v1/invoices/:id" */
    path: string;
    description: string;
    /** Which feature this endpoint supports */
    featureId?: string;
    /** Request body schema (for POST/PUT/PATCH) */
    requestBody?: SchemaField[];
    /** Query parameters */
    queryParams?: SchemaField[];
    /** Path parameters */
    pathParams?: SchemaField[];
    /** Response body schema */
    responseBody?: SchemaField[];
    /** Expected HTTP status codes */
    statusCodes?: Array<{
        code: number;
        description: string;
    }>;
    /** Authentication required */
    auth: boolean;
}
interface DataModel {
    id: string;
    name: string;
    description: string;
    fields: SchemaField[];
    /** Related models */
    relations?: Array<{
        modelId: string;
        type: 'one-to-one' | 'one-to-many' | 'many-to-many';
        foreignKey?: string;
        description?: string;
    }>;
}
interface ApiConfig {
    version: '1.0.0';
    /** Base URL for the API */
    basePath: string;
    description?: string;
    /** Auth mechanism used */
    authType?: 'none' | 'jwt' | 'api-key' | 'oauth' | 'session';
    endpoints: ApiEndpoint[];
    models: DataModel[];
    metadata?: {
        author?: string;
        createdAt?: string;
        updatedAt?: string;
        [key: string]: unknown;
    };
}
declare const API_FILE_EXTENSION = ".api.uibridge.json";
declare const API_CONFIG_VERSION = "1.0.0";

/**
 * Data Spec Types
 *
 * Type definitions for persistence/database layer specifications.
 * Describes entities, columns, indexes, relationships, and seed data
 * at the database level — distinct from API data models which describe
 * request/response shapes.
 */
type ColumnType = 'string' | 'text' | 'integer' | 'float' | 'decimal' | 'boolean' | 'date' | 'datetime' | 'timestamp' | 'json' | 'uuid' | 'enum' | 'binary' | 'array';
interface DataColumn {
    name: string;
    type: ColumnType;
    /** Is this column required (NOT NULL)? */
    required: boolean;
    /** Is this the primary key or part of a composite PK? */
    primaryKey?: boolean;
    /** Is this column unique? */
    unique?: boolean;
    /** Default value expression */
    defaultValue?: string;
    description?: string;
    /** For enum types, the allowed values */
    enumValues?: string[];
    /** Max length for string/text columns */
    maxLength?: number;
}
interface DataIndex {
    name: string;
    columns: string[];
    unique: boolean;
    description?: string;
}
interface DataRelation {
    id: string;
    /** Source entity ID */
    fromEntity: string;
    /** Source column(s) */
    fromColumns: string[];
    /** Target entity ID */
    toEntity: string;
    /** Target column(s) */
    toColumns: string[];
    type: 'one-to-one' | 'one-to-many' | 'many-to-many';
    /** ON DELETE behavior */
    onDelete?: 'cascade' | 'set-null' | 'restrict' | 'no-action';
    /** ON UPDATE behavior */
    onUpdate?: 'cascade' | 'set-null' | 'restrict' | 'no-action';
    description?: string;
}
interface DataEntity {
    id: string;
    name: string;
    description: string;
    columns: DataColumn[];
    indexes?: DataIndex[];
    /** Soft delete column name (e.g. "deleted_at") */
    softDelete?: string;
    /** Timestamp columns managed automatically */
    timestamps?: {
        createdAt?: string;
        updatedAt?: string;
    };
}
interface DataSeed {
    entityId: string;
    description: string;
    /** Number of records, or specific records */
    records: number | Array<Record<string, unknown>>;
    /** When to seed: always, development only, or on first setup */
    environment: 'all' | 'development' | 'setup';
}
interface DataMigration {
    id: string;
    description: string;
    /** Order in which migrations should run */
    order: number;
    /** Which entities this migration affects */
    entityIds: string[];
    /** Type of change */
    changeType: 'create-table' | 'alter-table' | 'drop-table' | 'add-column' | 'drop-column' | 'add-index' | 'data-migration' | 'other';
}
interface DataConfig {
    version: '1.0.0';
    /** Database technology */
    database: 'postgresql' | 'mysql' | 'sqlite' | 'mongodb' | 'other';
    description?: string;
    entities: DataEntity[];
    relations: DataRelation[];
    seeds?: DataSeed[];
    migrations?: DataMigration[];
    metadata?: {
        author?: string;
        createdAt?: string;
        updatedAt?: string;
        [key: string]: unknown;
    };
}
declare const DATA_FILE_EXTENSION = ".data.uibridge.json";
declare const DATA_CONFIG_VERSION = "1.0.0";

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
type ArtifactKind = 'page' | 'api-endpoint' | 'data-entity' | 'module' | 'service' | 'component';
interface ArtifactRef {
    /** Kind of artifact */
    kind: ArtifactKind;
    /** ID within its spec (e.g., endpoint ID, entity ID, page spec ID) */
    artifactId: string;
    /** Which spec file this artifact lives in */
    specId?: string;
    /** Human-readable label */
    label?: string;
}
interface DependencyLink {
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
interface ModuleRef {
    id: string;
    name: string;
    /** File path or package name */
    path: string;
    description?: string;
    /** What kind of module */
    moduleType: 'page' | 'component' | 'service' | 'utility' | 'middleware' | 'config' | 'test' | 'other';
}
interface DependencyCluster {
    id: string;
    name: string;
    description: string;
    /** Artifact refs in this cluster */
    artifacts: ArtifactRef[];
    /** Build priority — clusters with lower numbers should be built first */
    buildOrder: number;
}
interface DependencyConfig {
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
declare const DEPENDENCY_FILE_EXTENSION = ".deps.uibridge.json";
declare const DEPENDENCY_CONFIG_VERSION = "1.0.0";

/**
 * Constraint Spec Types
 *
 * Type definitions for concrete, measurable project constraints.
 * Performance budgets, browser support, responsive breakpoints,
 * bundle size limits, and other quantifiable requirements.
 *
 * Distinct from ArchitectureConstraint (high-level pattern constraints).
 * These are specific, measurable, and verifiable targets.
 */
interface PerformanceBudget {
    id: string;
    /** What is being measured */
    metric: 'lcp' | 'fcp' | 'cls' | 'fid' | 'inp' | 'ttfb' | 'tti' | 'total-blocking-time' | 'speed-index' | 'custom';
    /** Custom metric name (when metric is 'custom') */
    customMetric?: string;
    /** Maximum allowed value */
    budget: number;
    /** Unit of measurement */
    unit: 'ms' | 's' | 'score' | 'ratio';
    /** Which pages this applies to (empty = all pages) */
    pageIds?: string[];
    description?: string;
}
interface BundleBudget {
    id: string;
    /** What bundle or chunk */
    target: 'total' | 'initial' | 'chunk' | 'asset';
    /** Specific chunk/asset name (when target is 'chunk' or 'asset') */
    name?: string;
    /** Max size in bytes */
    maxSizeBytes: number;
    /** Whether this is gzipped or raw */
    compressed: boolean;
    description?: string;
}
interface BrowserTarget {
    browser: 'chrome' | 'firefox' | 'safari' | 'edge' | 'ios-safari' | 'android-chrome' | 'samsung-internet' | 'opera';
    /** Minimum supported version */
    minVersion: string;
    /** Support level */
    support: 'full' | 'partial' | 'none';
}
interface ResponsiveBreakpoint {
    id: string;
    name: string;
    /** Minimum viewport width in px */
    minWidth: number;
    /** Maximum viewport width in px (optional) */
    maxWidth?: number;
    /** Layout expectations at this breakpoint */
    description?: string;
}
interface AccessibilityTarget {
    /** WCAG conformance level */
    level: 'A' | 'AA' | 'AAA';
    /** Specific criteria IDs that must pass (e.g., "1.4.3" for contrast) */
    requiredCriteria?: string[];
    /** Minimum contrast ratio for normal text */
    minContrastRatio?: number;
    /** Minimum touch target size in px */
    minTouchTarget?: number;
    description?: string;
}
interface CapacityConstraint {
    id: string;
    /** What system or endpoint */
    target: string;
    /** Maximum concurrent users/requests */
    maxConcurrent?: number;
    /** Maximum requests per time window */
    rateLimit?: {
        requests: number;
        windowSeconds: number;
    };
    /** Maximum response time under load */
    maxResponseTimeMs?: number;
    description?: string;
}
interface ConstraintConfig {
    version: '1.0.0';
    description?: string;
    performance?: PerformanceBudget[];
    bundleBudgets?: BundleBudget[];
    browsers?: BrowserTarget[];
    breakpoints?: ResponsiveBreakpoint[];
    accessibility?: AccessibilityTarget;
    capacity?: CapacityConstraint[];
    metadata?: {
        author?: string;
        createdAt?: string;
        updatedAt?: string;
        [key: string]: unknown;
    };
}
declare const CONSTRAINT_FILE_EXTENSION = ".constraints.uibridge.json";
declare const CONSTRAINT_CONFIG_VERSION = "1.0.0";

export { API_CONFIG_VERSION, API_FILE_EXTENSION, ARCHITECTURE_CONFIG_VERSION, ARCHITECTURE_FILE_EXTENSION, type AccessibilityTarget, type ApiConfig, type ApiEndpoint, type ArchitectureConfig, type ArchitectureConstraint, type ArchitecturePattern, type ArtifactKind, type ArtifactRef, AssertionType, BUILT_IN_CONTEXTS, type BrowserTarget, type BundleBudget, CONSTRAINT_CONFIG_VERSION, CONSTRAINT_FILE_EXTENSION, type CapacityConstraint, type ColumnType, type ConstraintConfig, DATA_CONFIG_VERSION, DATA_FILE_EXTENSION, DEPENDENCY_CONFIG_VERSION, DEPENDENCY_FILE_EXTENSION, type DataColumn, type DataConfig, type DataEntity, type DataIndex, type DataMigration, type DataModel, type DataRelation, type DataSeed, type DependencyCluster, type DependencyConfig, type DependencyLink, DesignTokens, type DirectoryEntry, type FeatureDependency, type FeatureSpec, type HSL, type HttpMethod, type LegacyTestAssertion, type LegacyTestGeneratorOutput, type LegacyTestSpecification, type LegacyTestTarget, METRIC_FUNCTIONS, MetricFunction, type ModuleRef, type PerformanceBudget, QualityContext, QualityEvaluationReport, QualityMetricId, type RGBA, type ResponsiveBreakpoint, type SchemaField, SearchCriteria, SnapshotBaseline, SnapshotDiffReport, SpecAssertion, SpecAssertionResult, SpecCategory, SpecConfig, SpecExecutionOptions, SpecExecutionResult, SpecExecutor, type SpecExecutorConfig, SpecGroup, SpecGroupResult, SpecSeverity, SpecSource, SpecTarget, StyleAuditReport, StyleConstraint, StyleConstraintResult, StyleGuideConfig, StyleRule, StyleValidationResult, type TechStackEntry, type ValidationError, type ValidationResult, ViewportDimensions, clusterColors, coerceAssertionType, colorDistance, contrastRatio, createBaseline, diffSnapshots, evaluateConstraint, evaluateQuality, getContext, hueDistance, isGrayscale, isValidAssertionType, isValidSpecCategory, isValidSpecSeverity, isValidSpecSource, listContexts, mergeContext, migrateFromTestGeneratorOutput, migrateLegacyAssertion, migrateLegacyTarget, parseColor, relativeLuminance, resolveTarget, resolveTokenValue, rgbToHsl, runStyleAudit, validateElement, validateSpecAssertion, validateSpecConfig, validateSpecGroup };
