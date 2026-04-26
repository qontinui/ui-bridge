import { L as AssertionResult, G as SearchCriteria, ao as AssertionType } from './types-X8pyInrK.mjs';

/**
 * Spec Types
 *
 * Type definitions for the UI Bridge specification system.
 * Specs define declarative assertions about UI elements that can be
 * authored, stored, executed, and used for regression testing.
 */

type SpecCategory = 'element-presence' | 'accessibility' | 'form-validation' | 'state-consistency' | 'modal-dialog' | 'navigation' | 'cross-page-consistency' | 'semantic' | 'design' | 'custom' | 'layout';
type SpecSeverity = 'critical' | 'warning' | 'info';
type SpecSource = 'auto' | 'manual' | 'ai-generated';
/**
 * Unified target for spec assertions.
 * Bridges to AssertionRequest.target (string | SearchCriteria).
 */
type SpecTarget = {
    type: 'elementId';
    elementId: string;
    label?: string;
} | {
    type: 'search';
    criteria: SearchCriteria;
    label?: string;
} | {
    type: 'ctr';
    logicalName: string;
    label?: string;
};
/**
 * A condition that must be met for an assertion to be evaluated.
 * If the condition is not met, the assertion is skipped (passes with no opinion).
 *
 * Use case: "Button is disabled WHEN runner is not connected"
 * - The assertion only has an opinion when the runner is NOT connected
 * - When connected, the assertion should skip (not fail)
 */
type AssertionCondition = {
    /** Check if a target element exists */
    type: 'exists';
    target: SpecTarget;
} | {
    /** Check if a target element does NOT exist */
    type: 'notExists';
    target: SpecTarget;
} | {
    /** Check if a target element has specific text content */
    type: 'hasText';
    target: SpecTarget;
    text: string;
};
/**
 * An action that puts the UI into a specific state before assertions run.
 * Used in SpecGroup.setupActions to trigger error states, navigate, etc.
 */
type SetupAction = {
    type: 'click';
    target: SpecTarget;
} | {
    type: 'type';
    target: SpecTarget;
    value: string;
    clear?: boolean;
} | {
    type: 'navigate';
    url: string;
} | {
    type: 'waitForElement';
    target: SpecTarget;
    timeout?: number;
} | {
    type: 'wait';
    ms: number;
};
/**
 * A single spec assertion — wraps an AssertionRequest with metadata.
 */
interface SpecAssertion {
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
    /** Second target for spatial assertions (noOverlap, minSpacing) */
    relatedTarget?: SpecTarget;
    /** Minimum gap in pixels (for minSpacing) */
    minGap?: number;
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
/**
 * A named collection of related spec assertions.
 */
interface SpecGroup {
    id: string;
    name: string;
    description: string;
    category: SpecCategory;
    assertions: SpecAssertion[];
    setupActions?: SetupAction[];
    stateId?: string;
    transitionId?: string;
    source: SpecSource;
    tags?: string[];
    /** Optional reference to a verification contract that wraps this group. */
    contractId?: string;
}
interface SpecMetadata {
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
interface SpecConfig {
    version: '1.0.0';
    description?: string;
    groups: SpecGroup[];
    /** Ungrouped assertions (convenience for simple specs) */
    assertions?: SpecAssertion[];
    metadata?: SpecMetadata;
    /** Optional testing configuration for workflow generation and automated test runs */
    testing?: SpecTestingConfig;
}
/**
 * State injection fixtures — pre-populate the world before a scenario runs
 * without requiring manual browser setup. Each fixture type targets a
 * different layer of the stack.
 */
type TestFixture = {
    /** Inject a value into localStorage (survives hard navigation within the app) */
    type: 'localStorage';
    key: string;
    value: unknown;
} | {
    /** Short-circuit an HTTP endpoint with a canned response */
    type: 'apiMock';
    endpoint: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    response: unknown;
    statusCode?: number;
    /** Artificial delay to simulate network latency */
    latencyMs?: number;
} | {
    /** Schedule a Tauri event to be emitted during the scenario */
    type: 'tauriEvent';
    event: string;
    payload?: unknown;
    /** Milliseconds after scenario start to emit the event */
    delayMs?: number;
} | {
    /** Force a UI element into a specific attribute/state without interaction */
    type: 'elementState';
    target: SpecTarget;
    attributes?: Record<string, string>;
};
/**
 * A single step in a test scenario.
 *
 * Extends SetupAction (navigate, click, type, wait, waitForElement) with
 * test-specific step kinds: assertions, component actions, mocking, and
 * key sequences for terminal/canvas input.
 */
type TestStep = {
    type: 'click';
    target: SpecTarget;
    label?: string;
} | {
    type: 'type';
    target: SpecTarget;
    value: string;
    clear?: boolean;
    label?: string;
} | {
    /** Send raw key sequences to a focused element — required for terminal/xterm input */
    type: 'sendKeys';
    target: SpecTarget;
    /** Key names as passed to UI Bridge sendKeys (e.g. ["Enter"], ["ctrl+c"]) */
    keys: string[];
    label?: string;
} | {
    /** Wait for a condition before proceeding */
    type: 'wait';
    condition: 'idle' | 'element' | 'text' | 'duration';
    target?: SpecTarget;
    text?: string;
    timeoutMs?: number;
    /** Used when condition is 'duration' */
    durationMs?: number;
    label?: string;
} | {
    /** Assert an existing SpecAssertion from the same spec by ID */
    type: 'assert';
    assertionId: string;
    label?: string;
} | {
    type: 'navigate';
    url: string;
    label?: string;
} | {
    /** Invoke a UI Bridge component action directly */
    type: 'componentAction';
    componentId: string;
    actionId: string;
    params?: Record<string, unknown>;
    label?: string;
} | {
    /** Install an API mock mid-scenario (stubs the next N calls to the endpoint) */
    type: 'apiMock';
    endpoint: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    response: unknown;
    statusCode?: number;
    label?: string;
} | {
    /** Emit a Tauri event during the scenario to simulate real-time backend push */
    type: 'tauriEvent';
    event: string;
    payload?: unknown;
    label?: string;
};
/**
 * A named end-to-end test scenario for one or more spec groups.
 *
 * Scenarios capture user workflows that span multiple interactions and async
 * operations — things single assertions can't express alone.
 */
interface TestScenario {
    id: string;
    name: string;
    description: string;
    /** Group IDs this scenario exercises */
    groupIds: string[];
    difficulty: 'easy' | 'medium' | 'hard';
    /** Only set for hard scenarios — explains the blocking constraint */
    hardnessReason?: string;
    /** Fixtures that must be in place before the scenario starts */
    fixtures?: TestFixture[];
    /** Ordered sequence of interactions and assertions */
    steps: TestStep[];
    /** Whether a live backend is required (vs. can be fully mocked) */
    requiresRealBackend?: boolean;
    /** True if timing/ordering of async events affects test reliability */
    hasTiming?: boolean;
    retryStrategy?: {
        maxAttempts: number;
        delayMs: number;
        /** Only retry on these specific error message substrings */
        onlyRetryOn?: string[];
    };
    /** Steps to run after the scenario completes (cleanup) */
    teardown?: TestStep[];
    implementationNotes?: string;
}
/**
 * A reusable block of test data — pre-built payloads, mock responses, or
 * document content that scenarios can reference instead of inlining verbatim.
 *
 * Examples: a file-registry state with known conflicts, a workflow JSON,
 * a Claude session transcript, a plan markdown file.
 */
interface TestDataAsset {
    id: string;
    name: string;
    category: 'mock-data' | 'terminal-output' | 'file-registry' | 'workflow' | 'findings' | 'analysis-result' | 'session-transcript' | 'plan-markdown' | 'other';
    data: unknown;
    description?: string;
}
/**
 * Async wait strategy for timing-sensitive operations.
 * Named strategies can be referenced by name in TestScenario steps so the
 * generator knows how long to wait and how often to poll.
 */
interface AsyncStrategy {
    timeoutMs: number;
    pollIntervalMs: number;
    description: string;
}
/**
 * Infrastructure requirements for a test group.
 *
 * Used by the workflow generator and CI runners to skip test groups that
 * require services not available in the current environment.
 */
interface TestInfrastructureRequirements {
    /** Requires a live PTY shell process (for terminal I/O tests) */
    pty?: boolean;
    /** Requires real file system access (for file registry, storage tests) */
    fileSystem?: boolean;
    /** Requires real Claude Code API / session management */
    claudeAPI?: boolean;
    /** Requires a live LLM backend (analysis, workflow generation) */
    llmBackend?: boolean;
    /** Requires the runner HTTP server to be reachable */
    runnerBackend?: boolean;
    /** Requires the Tauri native event system (cannot be simulated in a plain browser) */
    tauriEvents?: boolean;
}
/**
 * Per-group testing configuration that supplements the group's assertions.
 *
 * Each field is optional — add only what the group actually needs.
 */
interface SpecGroupTesting {
    /** End-to-end scenarios for this group */
    scenarios?: TestScenario[];
    /** Reusable test data assets referenced by scenarios in this group */
    testData?: TestDataAsset[];
    /**
     * Named async wait strategies.
     * Key is a name used in scenario step labels; value defines timeout/poll/description.
     */
    asyncStrategies?: Record<string, AsyncStrategy>;
    /** Actions to run before each scenario in this group */
    beforeEach?: SetupAction[];
    /** Actions to run after each scenario (cleanup) */
    afterEach?: SetupAction[];
    /** Infrastructure this group's scenarios require */
    requiresInfrastructure?: TestInfrastructureRequirements;
    /** 0–100: what percentage of this group's assertions can be automatically tested */
    automationCoverage?: number;
    /** Assertion IDs that can only be verified by a human */
    manualAssertions?: string[];
    /** Assertion IDs known to be timing-sensitive or intermittently failing */
    flakyAssertions?: string[];
    notes?: string;
}
/**
 * Global testing configuration for the whole spec file.
 * All fields are optional — omit what you don't need.
 */
interface SpecTestingConfig {
    /** Default async timeout applied to all wait steps across all groups (ms) */
    defaultTimeoutMs?: number;
    /** Default poll interval for all wait steps (ms) */
    defaultPollIntervalMs?: number;
    /** Per-group testing config, keyed by SpecGroup.id */
    groups?: Record<string, SpecGroupTesting>;
}
interface SpecAssertionResult {
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
interface SpecGroupResult {
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
interface SpecExecutionResult {
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
interface SpecExecutionOptions {
    categories?: SpecCategory[];
    severities?: SpecSeverity[];
    groupIds?: string[];
    assertionIds?: string[];
    stopOnFailure?: boolean;
    skipUnreviewed?: boolean;
    timeout?: number;
}
interface SpecCoverage {
    totalElements: number;
    specifiedElements: number;
    coveragePercent: number;
    specifiedIds: string[];
    unspecifiedIds: string[];
    timestamp: number;
}
type SpecEventType = 'spec:loaded' | 'spec:unloaded' | 'spec:updated' | 'spec:cleared' | 'spec:assertion-added' | 'spec:assertion-removed' | 'spec:group-added' | 'spec:group-removed';
interface SpecEvent {
    type: SpecEventType;
    specId?: string;
    groupId?: string;
    assertionId?: string;
    timestamp: number;
}
declare const SPEC_CONFIG_VERSION = "1.0.0";
declare const SPEC_FILE_EXTENSION = ".spec.uibridge.json";
declare const VALID_ASSERTION_TYPES: readonly AssertionType[];
declare const VALID_SPEC_CATEGORIES: readonly SpecCategory[];
declare const VALID_SPEC_SEVERITIES: readonly SpecSeverity[];
declare const VALID_SPEC_SOURCES: readonly SpecSource[];

export { type AssertionCondition as A, VALID_SPEC_SOURCES as B, type SpecCategory as S, type TestDataAsset as T, VALID_ASSERTION_TYPES as V, type SpecSeverity as a, type SpecEvent as b, type SpecConfig as c, type SpecGroup as d, type SpecAssertion as e, type SpecCoverage as f, type SpecExecutionResult as g, type SpecGroupResult as h, type SpecAssertionResult as i, type AsyncStrategy as j, SPEC_CONFIG_VERSION as k, SPEC_FILE_EXTENSION as l, type SetupAction as m, type SpecEventType as n, type SpecExecutionOptions as o, type SpecGroupTesting as p, type SpecMetadata as q, type SpecSource as r, type SpecTarget as s, type SpecTestingConfig as t, type TestFixture as u, type TestInfrastructureRequirements as v, type TestScenario as w, type TestStep as x, VALID_SPEC_CATEGORIES as y, VALID_SPEC_SEVERITIES as z };
