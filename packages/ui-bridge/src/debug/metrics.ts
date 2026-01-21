/**
 * Metrics Module
 *
 * Performance metrics and action history tracking.
 */

import type { BridgeEvent } from '../core/types';
import type {
  ControlActionResponse,
  ComponentActionResponse,
  WorkflowStepResult,
} from '../control/types';

/**
 * Action history entry
 */
export interface ActionHistoryEntry {
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
export interface PerformanceMetrics {
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
export interface MetricsCollectorOptions {
  /** Maximum history entries to keep */
  maxHistoryEntries?: number;
  /** Window for rate calculations (ms) */
  rateWindow?: number;
}

/**
 * Generate unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;
}

/**
 * Metrics collector
 *
 * Collects and aggregates performance metrics.
 */
export class MetricsCollector {
  private history: ActionHistoryEntry[] = [];
  private maxHistoryEntries: number;
  private rateWindow: number;

  constructor(options: MetricsCollectorOptions = {}) {
    this.maxHistoryEntries = options.maxHistoryEntries ?? 1000;
    this.rateWindow = options.rateWindow ?? 60000; // 1 minute
  }

  /**
   * Record an element action
   */
  recordElementAction(
    target: string,
    action: string,
    response: ControlActionResponse,
    params?: Record<string, unknown>
  ): ActionHistoryEntry {
    const entry: ActionHistoryEntry = {
      id: generateId(),
      timestamp: response.timestamp,
      type: 'element',
      target,
      action,
      success: response.success,
      durationMs: response.durationMs,
      error: response.error,
      params,
      response: response.elementState,
    };

    this.addEntry(entry);
    return entry;
  }

  /**
   * Record a component action
   */
  recordComponentAction(
    target: string,
    action: string,
    response: ComponentActionResponse,
    params?: Record<string, unknown>
  ): ActionHistoryEntry {
    const entry: ActionHistoryEntry = {
      id: generateId(),
      timestamp: response.timestamp,
      type: 'component',
      target,
      action,
      success: response.success,
      durationMs: response.durationMs,
      error: response.error,
      params,
      response: response.result,
    };

    this.addEntry(entry);
    return entry;
  }

  /**
   * Record a workflow step
   */
  recordWorkflowStep(workflowId: string, result: WorkflowStepResult): ActionHistoryEntry {
    const entry: ActionHistoryEntry = {
      id: generateId(),
      timestamp: result.timestamp,
      type: 'workflow-step',
      target: workflowId,
      action: result.stepId,
      success: result.success,
      durationMs: result.durationMs,
      error: result.error,
      response: result.result,
    };

    this.addEntry(entry);
    return entry;
  }

  /**
   * Record from a bridge event
   */
  recordEvent(event: BridgeEvent): void {
    if (event.type === 'action:completed' || event.type === 'action:failed') {
      const data = event.data as {
        elementId?: string;
        componentId?: string;
        action: string;
        response: ControlActionResponse | ComponentActionResponse;
        params?: Record<string, unknown>;
      };

      if (data.elementId) {
        this.recordElementAction(
          data.elementId,
          data.action,
          data.response as ControlActionResponse,
          data.params
        );
      } else if (data.componentId) {
        this.recordComponentAction(
          data.componentId,
          data.action,
          data.response as ComponentActionResponse,
          data.params
        );
      }
    }
  }

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
  }): ActionHistoryEntry[] {
    let results = [...this.history];

    if (options?.type) {
      results = results.filter((e) => e.type === options.type);
    }
    if (options?.target) {
      results = results.filter((e) => e.target === options.target);
    }
    if (options?.action) {
      results = results.filter((e) => e.action === options.action);
    }
    if (options?.success !== undefined) {
      results = results.filter((e) => e.success === options.success);
    }
    if (options?.since) {
      results = results.filter((e) => e.timestamp >= options.since!);
    }
    if (options?.limit) {
      results = results.slice(-options.limit);
    }

    return results;
  }

  /**
   * Get performance metrics
   */
  getMetrics(since?: number): PerformanceMetrics {
    const entries = since ? this.history.filter((e) => e.timestamp >= since) : this.history;

    if (entries.length === 0) {
      return {
        totalActions: 0,
        successfulActions: 0,
        failedActions: 0,
        successRate: 0,
        avgDurationMs: 0,
        minDurationMs: 0,
        maxDurationMs: 0,
        p95DurationMs: 0,
        actionsPerSecond: 0,
        errorsByType: {},
        actionsByType: {},
      };
    }

    const successful = entries.filter((e) => e.success);
    const failed = entries.filter((e) => !e.success);
    const durations = entries.map((e) => e.durationMs).sort((a, b) => a - b);

    // Calculate actions per second in the rate window
    const now = Date.now();
    const windowStart = now - this.rateWindow;
    const recentActions = this.history.filter((e) => e.timestamp >= windowStart);
    const windowSeconds = this.rateWindow / 1000;

    // Error aggregation
    const errorsByType: Record<string, number> = {};
    for (const entry of failed) {
      const errorType = entry.error?.split(':')[0] || 'Unknown';
      errorsByType[errorType] = (errorsByType[errorType] || 0) + 1;
    }

    // Action aggregation
    const actionsByType: Record<string, number> = {};
    for (const entry of entries) {
      const key = `${entry.type}:${entry.action}`;
      actionsByType[key] = (actionsByType[key] || 0) + 1;
    }

    return {
      totalActions: entries.length,
      successfulActions: successful.length,
      failedActions: failed.length,
      successRate: successful.length / entries.length,
      avgDurationMs: durations.reduce((a, b) => a + b, 0) / durations.length,
      minDurationMs: durations[0],
      maxDurationMs: durations[durations.length - 1],
      p95DurationMs: durations[Math.floor(durations.length * 0.95)],
      actionsPerSecond: recentActions.length / windowSeconds,
      errorsByType,
      actionsByType,
    };
  }

  /**
   * Get recent errors
   */
  getRecentErrors(limit = 10): ActionHistoryEntry[] {
    return this.history.filter((e) => !e.success).slice(-limit);
  }

  /**
   * Get slowest actions
   */
  getSlowestActions(limit = 10): ActionHistoryEntry[] {
    return [...this.history].sort((a, b) => b.durationMs - a.durationMs).slice(0, limit);
  }

  /**
   * Clear history
   */
  clearHistory(): void {
    this.history = [];
  }

  /**
   * Export history as JSON
   */
  exportHistory(): string {
    return JSON.stringify(this.history, null, 2);
  }

  /**
   * Import history from JSON
   */
  importHistory(json: string): void {
    const entries = JSON.parse(json) as ActionHistoryEntry[];
    this.history = entries.slice(-this.maxHistoryEntries);
  }

  private addEntry(entry: ActionHistoryEntry): void {
    this.history.push(entry);
    while (this.history.length > this.maxHistoryEntries) {
      this.history.shift();
    }
  }
}

/**
 * Create a metrics collector
 */
export function createMetricsCollector(options?: MetricsCollectorOptions): MetricsCollector {
  return new MetricsCollector(options);
}

/**
 * Format duration for display
 */
export function formatDuration(ms: number): string {
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/**
 * Format percentage for display
 */
export function formatPercentage(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
