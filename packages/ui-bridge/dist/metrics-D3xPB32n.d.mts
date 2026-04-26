import { C as ControlActionResponse, g as ComponentActionResponse, h as WorkflowStepResult, e as BridgeEvent } from './types-svkOxfrJ.mjs';

/**
 * Metrics Module
 *
 * Performance metrics and action history tracking.
 */

/**
 * Action history entry
 */
interface ActionHistoryEntry {
    /** Unique entry ID */
    id: string;
    /** Timestamp */
    timestamp: number;
    /** Action type */
    type: 'element' | 'component' | 'workflow-step';
    /** Target ID */
    target: string;
    /** Action name */
    action: string;
    /** Whether the action succeeded */
    success: boolean;
    /** Duration in milliseconds */
    durationMs: number;
    /** Error message if failed */
    error?: string;
    /** Action parameters */
    params?: Record<string, unknown>;
    /** Response data */
    response?: unknown;
}
/**
 * Performance metrics
 */
interface PerformanceMetrics {
    /** Total actions executed */
    totalActions: number;
    /** Successful actions */
    successfulActions: number;
    /** Failed actions */
    failedActions: number;
    /** Success rate (0-1) */
    successRate: number;
    /** Average action duration */
    avgDurationMs: number;
    /** Minimum action duration */
    minDurationMs: number;
    /** Maximum action duration */
    maxDurationMs: number;
    /** 95th percentile duration */
    p95DurationMs: number;
    /** Actions per second (last minute) */
    actionsPerSecond: number;
    /** Errors by type */
    errorsByType: Record<string, number>;
    /** Actions by type */
    actionsByType: Record<string, number>;
}
/**
 * Metrics collector options
 */
interface MetricsCollectorOptions {
    /** Maximum history entries to keep */
    maxHistoryEntries?: number;
    /** Window for rate calculations (ms) */
    rateWindow?: number;
}
/**
 * Metrics collector
 *
 * Collects and aggregates performance metrics.
 */
declare class MetricsCollector {
    private history;
    private maxHistoryEntries;
    private rateWindow;
    constructor(options?: MetricsCollectorOptions);
    /**
     * Record an element action
     */
    recordElementAction(target: string, action: string, response: ControlActionResponse, params?: Record<string, unknown>): ActionHistoryEntry;
    /**
     * Record a component action
     */
    recordComponentAction(target: string, action: string, response: ComponentActionResponse, params?: Record<string, unknown>): ActionHistoryEntry;
    /**
     * Record a workflow step
     */
    recordWorkflowStep(workflowId: string, result: WorkflowStepResult): ActionHistoryEntry;
    /**
     * Record from a bridge event
     */
    recordEvent(event: BridgeEvent): void;
    /**
     * Get action history
     */
    getHistory(options?: {
        type?: 'element' | 'component' | 'workflow-step';
        target?: string;
        action?: string;
        success?: boolean;
        since?: number;
        limit?: number;
    }): ActionHistoryEntry[];
    /**
     * Get performance metrics
     */
    getMetrics(since?: number): PerformanceMetrics;
    /**
     * Get recent errors
     */
    getRecentErrors(limit?: number): ActionHistoryEntry[];
    /**
     * Get slowest actions
     */
    getSlowestActions(limit?: number): ActionHistoryEntry[];
    /**
     * Clear history
     */
    clearHistory(): void;
    /**
     * Export history as JSON
     */
    exportHistory(): string;
    /**
     * Import history from JSON
     */
    importHistory(json: string): void;
    private addEntry;
}
/**
 * Create a metrics collector
 */
declare function createMetricsCollector(options?: MetricsCollectorOptions): MetricsCollector;
/**
 * Format duration for display
 */
declare function formatDuration(ms: number): string;
/**
 * Format percentage for display
 */
declare function formatPercentage(value: number): string;

export { type ActionHistoryEntry as A, MetricsCollector as M, type PerformanceMetrics as P, type MetricsCollectorOptions as a, formatPercentage as b, createMetricsCollector as c, formatDuration as f };
