import { g as SpecExecutionResult, h as SpecGroupResult } from './types-DnPf3Cto.js';
import { C as ContractExecutionResult } from './types-B9PgNsZ7.js';
import { M as MatrixExecutionResult } from './types-D5M9ar71.js';

/**
 * Artifact Types
 *
 * Immutable, content-addressed result records for verification evidence.
 * Each artifact is a tamper-evident envelope around a spec/contract/matrix execution result.
 */

interface ArtifactSource {
    /** Spec config ID (if from spec execution). */
    specId?: string;
    /** Contract ID (if from contract execution). */
    contractId?: string;
    /** Execution matrix ID (if from multi-layer execution). */
    matrixId?: string;
    /** Workflow run ID from the runner (for traceability). */
    runId?: string;
    /** How this execution was triggered. */
    triggeredBy: 'manual' | 'ci' | 'scheduled' | 'workflow-step';
}
interface ArtifactEnvironment {
    /** Browser user agent string. */
    userAgent?: string;
    /** Viewport dimensions at time of execution. */
    viewport?: {
        width: number;
        height: number;
    };
    /** Page URL at time of execution. */
    url?: string;
    /** Execution timestamp (ms since epoch). */
    timestamp: number;
    /** UI Bridge SDK version. */
    sdkVersion: string;
}
/**
 * The result payload union covering all execution result types.
 */
type ArtifactResult = SpecExecutionResult | SpecGroupResult | ContractExecutionResult | MatrixExecutionResult;
/**
 * An immutable, content-addressed verification result record.
 */
interface ResultArtifact {
    /** Content-addressed ID: SHA-256 hex digest of the canonical JSON payload. */
    artifactId: string;
    /** What produced this artifact. */
    source: ArtifactSource;
    /** The execution result payload. */
    result: ArtifactResult;
    /** Environment context at time of execution. */
    environment: ArtifactEnvironment;
    /** ISO 8601 creation timestamp. */
    createdAt: string;
    /** Marker field — always true. Signals this record must not be mutated. */
    readonly immutable: true;
}
interface ArtifactQuery {
    /** Filter by spec ID. */
    specId?: string;
    /** Filter by contract ID. */
    contractId?: string;
    /** Filter by matrix ID. */
    matrixId?: string;
    /** Filter by workflow run ID. */
    runId?: string;
    /** Filter by date range (ISO 8601). */
    dateRange?: {
        from: string;
        to: string;
    };
    /** Only include passed results. */
    passedOnly?: boolean;
    /** Only include failed results. */
    failedOnly?: boolean;
    /** Maximum number of results. */
    limit?: number;
    /** Offset for pagination. */
    offset?: number;
}
/**
 * Pluggable storage backend for artifacts.
 * Implementations: MemoryArtifactStore (in-SDK), IpcArtifactStore (runner SQLite).
 */
interface ArtifactStore {
    /** Persist an artifact. Throws if artifactId already exists (immutable). */
    save(artifact: ResultArtifact): Promise<void>;
    /** Retrieve by content-addressed ID. */
    get(artifactId: string): Promise<ResultArtifact | null>;
    /** Query with filters. */
    query(query: ArtifactQuery): Promise<ResultArtifact[]>;
    /** Verify integrity by recomputing hash and comparing to artifactId. */
    verify(artifactId: string): Promise<boolean>;
    /** Total number of stored artifacts. */
    count(): Promise<number>;
}
type ArtifactEventType = 'artifact:saved' | 'artifact:integrity-passed' | 'artifact:integrity-failed';
interface ArtifactEvent {
    type: ArtifactEventType;
    artifactId: string;
    timestamp: number;
}
type ArtifactListener = (event: ArtifactEvent) => void;

export type { ArtifactEnvironment as A, ResultArtifact as R, ArtifactEvent as a, ArtifactEventType as b, ArtifactListener as c, ArtifactQuery as d, ArtifactResult as e, ArtifactSource as f, ArtifactStore as g };
