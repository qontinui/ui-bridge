/**
 * Change Tracker
 *
 * Orchestrates element change diffing with:
 * - Action-integrated diffing (snapshot → action → settle → snapshot → diff)
 * - Conditional waits (waitForChange with declarative predicates)
 * - Semantic change categorization
 * - Scoped diffs (within a container)
 * - Change buffer with drain
 * - Snapshot bookmarks
 */

import type {
  SemanticSnapshot,
  SemanticDiff,
  ChangeCategory,
  CategorizedDiff,
  ActionWithDiffRequest,
  ActionDiffResult,
  ChangePredicate,
  WaitForChangeOptions,
  BufferedChange,
  BufferedRouteChange,
  BufferEntry,
  ChangeBufferDrainResult,
  DomMutationEntry,
  ConsoleErrorEntry,
  BufferedNetworkEntry,
  BufferedTauriEvent,
  SnapshotBookmark,
  NLActionResponse,
  ChangeTimeline,
  TimelineEvent,
  DiffSummaryOptions,
  StructuredChangeAnalysis,
  TableChangeAnalysis,
  ListChangeAnalysis,
} from './types';
import type { ControlSnapshot } from '../control/types';
import { computeDiff, hasSignificantChanges } from './semantic-diff';
import type { SemanticDiffConfig } from './semantic-diff';
import type { SemanticSnapshotManager } from './semantic-snapshot';
import type { CompositeIdleDetector } from '../idle';
import { detectTable, detectList } from './table-extraction';
import { classList } from '../core/class-name';
import { getGlobalBookmarkStore } from './bookmarks';

// ============================================================================
// Configuration
// ============================================================================

/** Dependencies injected into ChangeTracker */
export interface ChangeTrackerDeps {
  /** Creates semantic snapshots from control snapshots */
  snapshotManager: SemanticSnapshotManager;
  /** Idle detection (optional — falls back to timeout if null) */
  idleDetector: CompositeIdleDetector | null;
  /** Creates control snapshots from the current registry state */
  createControlSnapshot: () => ControlSnapshot;
  /** Executes a natural language action */
  executeNLAction?: (instruction: string) => Promise<NLActionResponse>;
  /** Executes an element action */
  executeElementAction?: (
    elementId: string,
    request: { action: string; params?: Record<string, unknown> }
  ) => Promise<unknown>;
  /** Refresh element references before snapshotting */
  refreshElements?: () => void;
  /**
   * Resolve element IDs within a CSS selector container (DOM containment).
   * When running in a browser, this uses actual `document.querySelector` + DOM traversal.
   * Returns the set of element IDs contained within the matched container.
   * If not provided, falls back to string-based scope matching.
   */
  resolveScope?: (scope: string) => Set<string> | null;
  /**
   * Subscribe to push-based change events (optional — falls back to polling).
   * Inspired by folk-js/allio's hybrid push-pull observation model.
   * When provided, waitForChange will use event-driven wakeups with a slower
   * safety-net poll instead of the default 200ms polling interval.
   */
  subscribeChanges?: (callback: (event: { type: string; timestamp: number }) => void) => () => void;

  // ── Tier 3.3 extended buffer hooks ──────────────────────────────────────────

  /**
   * Subscribe to browser console/error events (optional).
   * When provided, the change buffer will capture console errors while enabled.
   * The callback receives events that were emitted by the BrowserEventCapture
   * (or compatible) service. Returns an unsubscribe function.
   */
  subscribeBrowserEvents?: (
    callback: (event: {
      type: string;
      timestamp: number;
      level?: string;
      message?: string;
      stack?: string;
    }) => void
  ) => () => void;

  /**
   * Subscribe to network request events (optional).
   * When provided, the change buffer will capture network requests while enabled.
   * The callback receives events from NetworkRequestTracker.onEvent.
   * Returns an unsubscribe function.
   */
  subscribeNetworkEvents?: (
    callback: (event: {
      type: string;
      timestamp: number;
      entry: {
        request: { url: string; method: string; startedAt: number };
        response?: { statusCode: number; durationMs: number };
      };
    }) => void
  ) => () => void;
}

/** ChangeTracker configuration */
export interface ChangeTrackerConfig {
  /** Default settle timeout for action-integrated diffing (ms) */
  defaultSettleTimeout: number;
  /** Default settle min stable time (ms) */
  defaultSettleMinStable: number;
  /** Default polling interval for waitForChange (ms) */
  defaultPollInterval: number;
  /** Default timeout for waitForChange (ms) */
  defaultWaitTimeout: number;
  /** Maximum buffer size before oldest entries are evicted */
  maxBufferSize: number;
  /** Maximum number of bookmarks */
  maxBookmarks: number;
  /** Diff configuration to use */
  diffConfig?: Partial<SemanticDiffConfig>;
}

const DEFAULT_CONFIG: ChangeTrackerConfig = {
  defaultSettleTimeout: 5000,
  defaultSettleMinStable: 300,
  defaultPollInterval: 200,
  defaultWaitTimeout: 10000,
  maxBufferSize: 1000,
  maxBookmarks: 50,
};

// ============================================================================
// ChangeTracker
// ============================================================================

export class ChangeTracker {
  private deps: ChangeTrackerDeps;
  private config: ChangeTrackerConfig;

  // Bookmarks — backed by the process-wide singleton store
  // (`getGlobalBookmarkStore()`). Previously this was a per-instance Map,
  // but parallel code paths (the SDK browser dispatcher and the runner-side
  // ChangeTracker) each owned their own map, so a `POST /ai/bookmarks` save
  // wasn't visible to a follow-up `GET /ai/bookmarks` list resolved through
  // the other path. The singleton ensures every reader/writer hits the
  // same backing storage. See B2 / `ai/bookmarks.ts`.

  // Change buffer — DOM mutations and SPA route changes share the same
  // buffer so a drain returns them interleaved by `recordedAt`. The DOM
  // entry shape is unchanged for backward compatibility; route entries
  // carry `type: "route-change"` as a discriminator (P1.3).
  private changeBuffer: BufferEntry[] = [];
  private bufferEnabled = false;
  private bufferSequence = 0;
  private bufferEnabledAt = 0;

  // Tier 3.3: Extended change-buffer sub-lists
  private domMutationBuffer: DomMutationEntry[] = [];
  private consoleErrorBuffer: ConsoleErrorEntry[] = [];
  private networkRequestBuffer: BufferedNetworkEntry[] = [];

  // Tier 3.3: Active subscriptions / observers (live while buffer is enabled)
  private mutationObserver: MutationObserver | null = null;
  private unsubscribeBrowserEvents: (() => void) | null = null;
  private unsubscribeNetworkEvents: (() => void) | null = null;

  // Phase 2a: Tauri events sub-buffer. Only populated inside a Tauri webview
  // (guarded by `window.__TAURI_INTERNALS__`). `@tauri-apps/api` is loaded via
  // dynamic import so non-Tauri hosts don't pay for the dependency.
  private tauriEventBuffer: BufferedTauriEvent[] = [];
  private tauriEventNames: string[] = [];
  private tauriEventUnlisteners: Array<() => void> = [];
  private readonly tauriEventBufferCap = 200;

  // Recent route-change ring buffer — always on, independent of `bufferEnabled`.
  // Used by `/ai/wait-for-route-change` to resolve immediately when a matching
  // navigation happened between the HTTP request arriving and the subscription
  // being attached.
  private recentRouteChanges: Array<{ from: string; to: string; at: number }> = [];
  private readonly recentRouteChangesCap = 100;

  // Listeners fired synchronously from `pushRouteChange`. Independent of the
  // buffer-enabled gate so consumers like wait-for-route-change can subscribe
  // without first having to toggle the change buffer.
  private routeChangeListeners: Set<(event: { from: string; to: string; at: number }) => void> =
    new Set();

  // Last diff for categorization
  private lastDiff: SemanticDiff | null = null;

  constructor(deps: ChangeTrackerDeps, config?: Partial<ChangeTrackerConfig>) {
    this.deps = deps;
    this.config = { ...DEFAULT_CONFIG, ...config };
    // Propagate the configured cap to the shared bookmark store. Last
    // constructor wins, but every host today initialises with the same cap
    // (50) so this is fine in practice.
    getGlobalBookmarkStore().setMaxBookmarks(this.config.maxBookmarks);
  }

  // ==========================================================================
  // Feature 1: Action-Integrated Diffing
  // ==========================================================================

  /**
   * Execute an action and return the diff of what changed.
   *
   * Flow: snapshot before → execute action → wait for idle → snapshot after → diff
   */
  async executeWithDiff(request: ActionWithDiffRequest): Promise<ActionDiffResult> {
    const startTime = performance.now();

    // Track push events during action execution for fast-path optimization
    let changeReceivedDuringAction = false;
    const unsubscribeChanges = this.deps.subscribeChanges?.(() => {
      changeReceivedDuringAction = true;
    });

    // Refresh elements for accurate snapshot
    this.deps.refreshElements?.();

    // 1. Snapshot before
    const beforeControl = this.deps.createControlSnapshot();
    const beforeSnapshot = this.deps.snapshotManager.createSnapshot(beforeControl);

    // 2. Execute action
    let actionResult: unknown;
    let actionSuccess: boolean;

    if (request.instruction && this.deps.executeNLAction) {
      const nlResult = await this.deps.executeNLAction(request.instruction);
      actionResult = nlResult;
      actionSuccess = nlResult.success;
    } else if (request.elementAction && this.deps.executeElementAction) {
      const result = await this.deps.executeElementAction(request.elementAction.elementId, {
        action: request.elementAction.action,
        params: request.elementAction.params,
      });
      actionResult = result;
      actionSuccess =
        result !== null &&
        typeof result === 'object' &&
        'success' in result &&
        (result as { success: boolean }).success;
    } else {
      throw new Error(
        'Either instruction (with executeNLAction) or elementAction (with executeElementAction) must be provided'
      );
    }

    // 3. Wait for idle / settle, optionally recording a timeline
    const settleTimeout = request.settleTimeout ?? this.config.defaultSettleTimeout;
    const settleMinStable = request.settleMinStable ?? this.config.defaultSettleMinStable;
    let settleTimedOut = false;
    let timeline: ChangeTimeline | undefined;

    if (request.timeline) {
      // Record intermediate snapshots during settling
      timeline = await this.recordTimeline(
        beforeSnapshot,
        startTime,
        settleTimeout,
        settleMinStable,
        request.timelineInterval ?? 100,
        request.scope
      );
      settleTimedOut = !timeline.settled;
    } else if (this.deps.idleDetector) {
      try {
        await this.deps.idleDetector.waitForIdle({
          timeout: settleTimeout,
          minStableMs: settleMinStable,
        });
      } catch {
        settleTimedOut = true;
      }
    } else {
      // Fallback: simple delay
      await sleep(settleMinStable);
    }

    // 4. Snapshot after
    this.deps.refreshElements?.();
    const afterControl = this.deps.createControlSnapshot();
    const afterSnapshot = this.deps.snapshotManager.createSnapshot(afterControl);

    // 5. Compute diff (optionally scoped)
    //    When push-based observation is available and reported no changes during
    //    the settle window, use a fast-path empty diff to avoid unnecessary computation.
    let diff: SemanticDiff;
    if (
      this.deps.subscribeChanges &&
      !changeReceivedDuringAction &&
      afterControl.elements?.length === beforeControl.elements?.length
    ) {
      // Fast path: push events indicate nothing changed, element count matches
      diff = computeDiff(beforeSnapshot, afterSnapshot, this.config.diffConfig);
    } else if (request.scope) {
      diff = this.computeScopedDiff(beforeSnapshot, afterSnapshot, request.scope);
    } else {
      diff = computeDiff(beforeSnapshot, afterSnapshot, this.config.diffConfig);
    }

    // 6. Categorize
    const categorize = request.categorize !== false;
    const categorized = categorize ? this.categorizeChanges(diff) : undefined;

    // 7. Store in buffer if enabled
    this.lastDiff = diff;
    if (this.bufferEnabled) {
      this.appendToBuffer(diff, categorized?.category ?? this.categorizeChanges(diff).category);
    }

    // 8. Optional budget-aware summary
    const budgetSummary =
      request.summaryBudget != null
        ? this.summarizeDiff(diff, {
            budget: request.summaryBudget,
            includeCategory: !!categorized,
          })
        : undefined;

    // 9. Optional structured change analysis
    const structuredChanges = request.analyzeStructured
      ? analyzeStructuredChanges(beforeSnapshot, afterSnapshot)
      : undefined;

    // Cleanup push event subscription
    unsubscribeChanges?.();

    return {
      actionSuccess,
      actionResult,
      beforeSnapshot,
      afterSnapshot,
      diff,
      categorized,
      timeline,
      settleTimedOut,
      budgetSummary,
      structuredChanges,
      durationMs: performance.now() - startTime,
      timestamp: Date.now(),
    };
  }

  // ==========================================================================
  // Feature 2: waitForChange
  // ==========================================================================

  /**
   * Wait for a specific change condition to be met.
   *
   * Polls at configurable intervals, computing diffs until the predicate matches.
   */
  async waitForChange(
    predicate: ChangePredicate,
    options?: WaitForChangeOptions
  ): Promise<SemanticDiff> {
    const timeout = options?.timeout ?? this.config.defaultWaitTimeout;
    const startTime = performance.now();

    // Take baseline snapshot
    this.deps.refreshElements?.();
    const baselineControl = this.deps.createControlSnapshot();
    const baselineSnapshot = this.deps.snapshotManager.createSnapshot(baselineControl);

    // Choose push-based or polling path
    if (this.deps.subscribeChanges) {
      return this.waitForChangePush(predicate, baselineSnapshot, options, startTime, timeout);
    }
    return this.waitForChangePoll(predicate, baselineSnapshot, options, startTime, timeout);
  }

  /**
   * Push-based path: subscribe to change events, snapshot + diff only when
   * a change event arrives. Safety-net poll at 2000ms to catch missed events.
   */
  private async waitForChangePush(
    predicate: ChangePredicate,
    baselineSnapshot: SemanticSnapshot,
    options: WaitForChangeOptions | undefined,
    startTime: number,
    timeout: number
  ): Promise<SemanticDiff> {
    const safetyPollMs = 2000; // Much slower than the 200ms default poll
    let changeReceived = false;
    let unsubscribe: (() => void) | null = null;

    try {
      // Subscribe to push events
      unsubscribe = this.deps.subscribeChanges!(() => {
        changeReceived = true;
      });

      while (performance.now() - startTime < timeout) {
        // Wait for either a push event or the safety-net poll interval
        await sleep(
          changeReceived ? 0 : Math.min(safetyPollMs, timeout - (performance.now() - startTime))
        );
        changeReceived = false;

        const diff = this.snapshotAndDiff(baselineSnapshot, options);
        if (this.matchesPredicate(diff, predicate)) {
          this.lastDiff = diff;
          if (this.bufferEnabled) {
            this.appendToBuffer(diff, this.categorizeChanges(diff).category);
          }
          return diff;
        }
      }
    } finally {
      unsubscribe?.();
    }

    return this.timeoutWithDiff(baselineSnapshot, options, timeout);
  }

  /**
   * Polling path: original behavior — poll at defaultPollInterval (200ms).
   */
  private async waitForChangePoll(
    predicate: ChangePredicate,
    baselineSnapshot: SemanticSnapshot,
    options: WaitForChangeOptions | undefined,
    startTime: number,
    timeout: number
  ): Promise<SemanticDiff> {
    const interval = options?.interval ?? this.config.defaultPollInterval;

    while (performance.now() - startTime < timeout) {
      await sleep(interval);

      const diff = this.snapshotAndDiff(baselineSnapshot, options);
      if (this.matchesPredicate(diff, predicate)) {
        this.lastDiff = diff;
        if (this.bufferEnabled) {
          this.appendToBuffer(diff, this.categorizeChanges(diff).category);
        }
        return diff;
      }
    }

    return this.timeoutWithDiff(baselineSnapshot, options, timeout);
  }

  /** Snapshot current state and diff against baseline. */
  private snapshotAndDiff(
    baselineSnapshot: SemanticSnapshot,
    options?: WaitForChangeOptions
  ): SemanticDiff {
    this.deps.refreshElements?.();
    const currentControl = this.deps.createControlSnapshot();
    const currentSnapshot = this.deps.snapshotManager.createSnapshot(currentControl);

    if (options?.scope) {
      return this.computeScopedDiff(baselineSnapshot, currentSnapshot, options.scope);
    }
    return computeDiff(baselineSnapshot, currentSnapshot, this.config.diffConfig);
  }

  /** Handle timeout: capture final diff and throw. */
  private timeoutWithDiff(
    baselineSnapshot: SemanticSnapshot,
    options: WaitForChangeOptions | undefined,
    timeout: number
  ): never {
    const finalDiff = this.snapshotAndDiff(baselineSnapshot, options);
    this.lastDiff = finalDiff;
    throw new Error(
      `waitForChange timed out after ${timeout}ms. ` +
        `Changes detected: ${finalDiff.changes.appeared.length} appeared, ` +
        `${finalDiff.changes.disappeared.length} disappeared, ` +
        `${finalDiff.changes.modified.length} modified`
    );
  }

  /**
   * Check if a diff matches a predicate
   */
  private matchesPredicate(diff: SemanticDiff, predicate: ChangePredicate): boolean {
    // anySignificantChange
    if (predicate.anySignificantChange) {
      if (hasSignificantChanges(diff)) return true;
    }

    // elementAppeared
    if (predicate.elementAppeared !== undefined) {
      const matcher = predicate.elementAppeared;
      if (typeof matcher === 'string') {
        // Match by ID or description substring
        const found = diff.changes.appeared.some(
          (e) =>
            e.elementId === matcher || e.description.toLowerCase().includes(matcher.toLowerCase())
        );
        if (found) return true;
      } else {
        // Match by criteria
        const found = diff.changes.appeared.some((e) => {
          if (matcher.text && !e.description.toLowerCase().includes(matcher.text.toLowerCase())) {
            return false;
          }
          if (matcher.type && e.type !== matcher.type) {
            return false;
          }
          return true;
        });
        if (found) return true;
      }
    }

    // elementDisappeared
    if (predicate.elementDisappeared !== undefined) {
      const found = diff.changes.disappeared.some(
        (e) =>
          e.elementId === predicate.elementDisappeared ||
          e.description.toLowerCase().includes(predicate.elementDisappeared!.toLowerCase())
      );
      if (found) return true;
    }

    // propertyChanged
    if (predicate.propertyChanged) {
      const { elementId, property, expectedValue } = predicate.propertyChanged;
      const found = diff.changes.modified.some((m) => {
        if (m.elementId !== elementId) return false;
        if (m.property !== property) return false;
        if (expectedValue !== undefined && m.to !== expectedValue) return false;
        return true;
      });
      if (found) return true;
    }

    // textContains
    if (predicate.textContains) {
      const { elementId, text } = predicate.textContains;
      const textLower = text.toLowerCase();

      if (elementId) {
        // Check specific element's text content change
        const found = diff.changes.modified.some(
          (m) =>
            m.elementId === elementId &&
            m.property === 'textContent' &&
            m.to.toLowerCase().includes(textLower)
        );
        if (found) return true;

        // Also check appeared elements
        const appeared = diff.changes.appeared.some(
          (e) => e.elementId === elementId && e.description.toLowerCase().includes(textLower)
        );
        if (appeared) return true;
      } else {
        // Check any element for text
        const inModified = diff.changes.modified.some(
          (m) => m.property === 'textContent' && m.to.toLowerCase().includes(textLower)
        );
        if (inModified) return true;

        const inAppeared = diff.changes.appeared.some((e) =>
          e.description.toLowerCase().includes(textLower)
        );
        if (inAppeared) return true;

        // Check content changes
        if (diff.contentChanges) {
          const inText = diff.contentChanges.textChanges.some((t) =>
            t.newText.toLowerCase().includes(textLower)
          );
          if (inText) return true;
        }
      }
    }

    // category
    if (predicate.category) {
      const categorized = this.categorizeChanges(diff);
      if (
        categorized.category === predicate.category ||
        categorized.secondaryCategories.includes(predicate.category)
      ) {
        return true;
      }
    }

    // elementCount — check that enough elements of a type/text exist in the "after" snapshot
    if (predicate.elementCount) {
      const { min, type, text } = predicate.elementCount;
      // Count matching appeared elements
      const matchingAppeared = diff.changes.appeared.filter((e) => {
        if (type && e.type !== type) return false;
        if (text && !e.description.toLowerCase().includes(text.toLowerCase())) return false;
        return true;
      });
      if (matchingAppeared.length >= min) return true;
    }

    // urlChanged — wait for any URL change
    if (predicate.urlChanged) {
      if (diff.pageChanges?.urlChanged) return true;
    }

    // urlContains — wait for URL to contain a substring
    if (predicate.urlContains) {
      if (
        diff.pageChanges?.urlChanged &&
        diff.pageChanges.newUrl?.toLowerCase().includes(predicate.urlContains.toLowerCase())
      ) {
        return true;
      }
    }

    // formValid — wait for error elements to disappear
    if (predicate.formValid) {
      const { formId } = predicate.formValid;
      // Check that error-related elements have disappeared and none appeared
      const errorAppeared = diff.changes.appeared.some((e) => {
        const desc = e.description.toLowerCase();
        const inScope = !formId || e.elementId.toLowerCase().includes(formId.toLowerCase());
        return (
          inScope &&
          (desc.includes('error') || desc.includes('invalid') || desc.includes('validation'))
        );
      });
      const errorDisappeared = diff.changes.disappeared.some((e) => {
        const desc = e.description.toLowerCase();
        const inScope = !formId || e.elementId.toLowerCase().includes(formId.toLowerCase());
        return (
          inScope &&
          (desc.includes('error') || desc.includes('invalid') || desc.includes('validation'))
        );
      });
      // Form became valid: errors disappeared and none new appeared
      if (errorDisappeared && !errorAppeared) return true;
    }

    // statusChanged — wait for a status indicator to change direction
    if (predicate.statusChanged) {
      const { elementId, direction, newStatus } = predicate.statusChanged;
      if (diff.contentChanges?.statusChanges) {
        const found = diff.contentChanges.statusChanges.some((s) => {
          if (elementId && s.elementId !== elementId) return false;
          if (direction && s.direction !== direction) return false;
          if (newStatus && !s.newStatus.toLowerCase().includes(newStatus.toLowerCase()))
            return false;
          return true;
        });
        if (found) return true;
      }
    }

    return false;
  }

  // ==========================================================================
  // Feature: Change Timeline
  // ==========================================================================

  /**
   * Record a timeline of changes during the settle period.
   *
   * Takes intermediate snapshots at regular intervals and records what changed
   * at each step, producing a time-ordered sequence of events.
   */
  private async recordTimeline(
    beforeSnapshot: SemanticSnapshot,
    actionStartTime: number,
    settleTimeout: number,
    settleMinStable: number,
    intervalMs: number,
    scope?: string
  ): Promise<ChangeTimeline> {
    const events: TimelineEvent[] = [];
    let lastSnapshot = beforeSnapshot;
    let stableMs = 0;
    let settled = false;
    const timelineStart = performance.now();

    // Record the action event
    events.push({
      offsetMs: 0,
      type: 'action',
      summary: 'Action executed',
    });

    while (performance.now() - timelineStart < settleTimeout) {
      await sleep(intervalMs);
      const offsetMs = Math.round(performance.now() - actionStartTime);

      this.deps.refreshElements?.();
      const control = this.deps.createControlSnapshot();
      const currentSnapshot = this.deps.snapshotManager.createSnapshot(control);

      // Compute incremental diff from last snapshot
      const incrementalDiff = scope
        ? this.computeScopedDiff(lastSnapshot, currentSnapshot, scope)
        : computeDiff(lastSnapshot, currentSnapshot, this.config.diffConfig);

      const hasChanges = hasSignificantChanges(incrementalDiff);

      if (hasChanges) {
        stableMs = 0; // Reset stable counter

        // Record appeared
        if (incrementalDiff.changes.appeared.length > 0) {
          events.push({
            offsetMs,
            type: 'elements-appeared',
            summary: `${incrementalDiff.changes.appeared.length} element(s) appeared`,
            elementIds: incrementalDiff.changes.appeared.map((e) => e.elementId),
            count: incrementalDiff.changes.appeared.length,
          });
        }

        // Record disappeared
        if (incrementalDiff.changes.disappeared.length > 0) {
          events.push({
            offsetMs,
            type: 'elements-disappeared',
            summary: `${incrementalDiff.changes.disappeared.length} element(s) disappeared`,
            elementIds: incrementalDiff.changes.disappeared.map((e) => e.elementId),
            count: incrementalDiff.changes.disappeared.length,
          });
        }

        // Record modified
        const significantMods = incrementalDiff.changes.modified.filter((m) => m.significant);
        if (significantMods.length > 0) {
          events.push({
            offsetMs,
            type: 'elements-modified',
            summary: `${significantMods.length} element(s) modified`,
            elementIds: significantMods.map((m) => m.elementId),
            count: significantMods.length,
          });
        }

        // Record page changes
        if (incrementalDiff.pageChanges?.urlChanged) {
          events.push({
            offsetMs,
            type: 'page-changed',
            summary: `URL changed to ${incrementalDiff.pageChanges.newUrl ?? 'unknown'}`,
          });
        }

        lastSnapshot = currentSnapshot;
      } else {
        stableMs += intervalMs;
        if (stableMs >= settleMinStable) {
          settled = true;
          events.push({
            offsetMs,
            type: 'settled',
            summary: `UI settled after ${stableMs}ms of stability`,
          });
          break;
        }
      }
    }

    return {
      events,
      settleMs: Math.round(performance.now() - timelineStart),
      settled,
    };
  }

  // ==========================================================================
  // Feature 3: Semantic Change Categories
  // ==========================================================================

  /**
   * Classify a diff into a semantic category.
   */
  categorizeChanges(diff: SemanticDiff): CategorizedDiff {
    const scores: Record<ChangeCategory, number> = {
      navigation: 0,
      feedback: 0,
      'data-update': 0,
      'ui-state': 0,
      loading: 0,
      'no-op': 0,
    };

    // No changes at all
    if (!hasSignificantChanges(diff)) {
      return {
        category: 'no-op',
        confidence: 1.0,
        secondaryCategories: [],
        diff,
      };
    }

    // Navigation signals
    if (diff.pageChanges?.urlChanged) {
      scores.navigation += 0.8;
    }
    if (diff.changes.appeared.length > 10 && diff.changes.disappeared.length > 10) {
      scores.navigation += 0.4;
    }
    if (diff.probableTrigger === 'Page navigation') {
      scores.navigation += 0.6;
    }

    // Feedback signals (errors, success messages, toasts, validation)
    const feedbackAppeared = diff.changes.appeared.filter((e) => {
      const desc = e.description.toLowerCase();
      return (
        desc.includes('error') ||
        desc.includes('success') ||
        desc.includes('warning') ||
        desc.includes('toast') ||
        desc.includes('notification') ||
        desc.includes('alert') ||
        desc.includes('validation') ||
        e.type === 'dialog'
      );
    });
    if (feedbackAppeared.length > 0) {
      scores.feedback += 0.3 + Math.min(feedbackAppeared.length * 0.2, 0.5);
    }
    if (diff.probableTrigger === 'Form validation') {
      scores.feedback += 0.6;
    }
    if (diff.probableTrigger === 'Modal opened' || diff.probableTrigger === 'Modal closed') {
      scores.feedback += 0.3;
    }
    if (diff.contentChanges?.statusChanges && diff.contentChanges.statusChanges.length > 0) {
      scores.feedback += 0.3;
    }

    // Data-update signals
    if (diff.contentChanges?.metricChanges && diff.contentChanges.metricChanges.length > 0) {
      scores['data-update'] += 0.3 + Math.min(diff.contentChanges.metricChanges.length * 0.15, 0.5);
    }
    if (diff.contentChanges?.textChanges) {
      const dataTextChanges = diff.contentChanges.textChanges.filter(
        (t) => t.changeType === 'modified'
      );
      if (dataTextChanges.length > 0) {
        scores['data-update'] += 0.2 + Math.min(dataTextChanges.length * 0.1, 0.4);
      }
    }

    // UI-state signals (visibility, enabled, expanded toggling)
    const visibilityMods = diff.changes.modified.filter(
      (m) => m.property === 'visible' || m.property === 'enabled' || m.property === 'checked'
    );
    if (visibilityMods.length > 0) {
      scores['ui-state'] += 0.3 + Math.min(visibilityMods.length * 0.15, 0.5);
    }
    if (
      diff.probableTrigger === 'UI expansion/collapse' ||
      diff.probableTrigger === 'Focus changed'
    ) {
      scores['ui-state'] += 0.4;
    }

    // Loading signals
    const loadingAppeared = diff.changes.appeared.filter((e) => {
      const desc = e.description.toLowerCase();
      return (
        desc.includes('loading') ||
        desc.includes('spinner') ||
        desc.includes('skeleton') ||
        desc.includes('progress')
      );
    });
    const loadingDisappeared = diff.changes.disappeared.filter((e) => {
      const desc = e.description.toLowerCase();
      return (
        desc.includes('loading') ||
        desc.includes('spinner') ||
        desc.includes('skeleton') ||
        desc.includes('progress')
      );
    });
    if (loadingAppeared.length > 0 || loadingDisappeared.length > 0) {
      scores.loading +=
        0.5 + Math.min((loadingAppeared.length + loadingDisappeared.length) * 0.15, 0.4);
    }
    if (diff.probableTrigger === 'Loading state change') {
      scores.loading += 0.5;
    }

    // Find primary and secondary categories
    const sortedCategories = (Object.entries(scores) as [ChangeCategory, number][])
      .filter(([, score]) => score > 0)
      .sort(([, a], [, b]) => b - a);

    if (sortedCategories.length === 0) {
      // Something changed but doesn't match known patterns
      return {
        category: 'ui-state',
        confidence: 0.3,
        secondaryCategories: [],
        diff,
      };
    }

    const [primary, primaryScore] = sortedCategories[0];
    const secondaryCategories = sortedCategories
      .slice(1)
      .filter(([, score]) => score > 0.2)
      .map(([cat]) => cat);

    // Confidence is the primary score normalized (capped at 1.0)
    const confidence = Math.min(primaryScore, 1.0);

    return {
      category: primary,
      confidence,
      secondaryCategories,
      diff,
    };
  }

  /**
   * Categorize the last computed diff (convenience for the server handler).
   */
  categorizeLastDiff(): CategorizedDiff | null {
    if (!this.lastDiff) return null;
    return this.categorizeChanges(this.lastDiff);
  }

  // ==========================================================================
  // Feature: Budget-Aware Diff Summary
  // ==========================================================================

  /**
   * Generate a text summary of a diff that fits within a character budget.
   *
   * Prioritizes information by importance:
   * 1. Category header (if available)
   * 2. Page changes (URL/title)
   * 3. Appeared elements
   * 4. Disappeared elements
   * 5. Significant modifications
   * 6. Content changes (metrics, statuses, text)
   * 7. Minor modifications
   *
   * Each section is only included if there's remaining budget.
   */
  summarizeDiff(diff: SemanticDiff, options: DiffSummaryOptions): string {
    const { budget, includeIds = false, includeCategory = true } = options;
    const sections: string[] = [];
    let remaining = budget;

    const addSection = (text: string): boolean => {
      if (text.length + 1 > remaining) return false; // +1 for newline
      sections.push(text);
      remaining -= text.length + 1;
      return true;
    };

    const truncateText = (text: string, max: number): string => {
      if (text.length <= max) return text;
      return text.substring(0, max - 3) + '...';
    };

    // 1. Category header
    if (includeCategory) {
      const cat = this.categorizeChanges(diff);
      const header = `[${cat.category}] (${Math.round(cat.confidence * 100)}% confidence)`;
      addSection(header);
    }

    // 2. Page changes
    if (diff.pageChanges?.urlChanged) {
      addSection(`Page: navigated to ${diff.pageChanges.newUrl ?? 'new URL'}`);
    } else if (diff.pageChanges?.titleChanged) {
      addSection(`Page: title changed to "${diff.pageChanges.newTitle ?? ''}"`);
    }

    // 3. Appeared elements
    if (diff.changes.appeared.length > 0) {
      const count = diff.changes.appeared.length;
      if (count <= 3 && remaining > 80) {
        const details = diff.changes.appeared
          .map((e) => {
            const id = includeIds ? ` [${e.elementId}]` : '';
            return `  + ${truncateText(e.description, 40)}${id}`;
          })
          .join('\n');
        addSection(`Appeared (${count}):\n${details}`);
      } else {
        const firstFew = diff.changes.appeared
          .slice(0, 2)
          .map((e) => e.description)
          .join(', ');
        addSection(`Appeared: ${count} elements (${truncateText(firstFew, 50)}...)`);
      }
    }

    // 4. Disappeared elements
    if (diff.changes.disappeared.length > 0) {
      const count = diff.changes.disappeared.length;
      if (count <= 3 && remaining > 80) {
        const details = diff.changes.disappeared
          .map((e) => {
            const id = includeIds ? ` [${e.elementId}]` : '';
            return `  - ${truncateText(e.description, 40)}${id}`;
          })
          .join('\n');
        addSection(`Disappeared (${count}):\n${details}`);
      } else {
        addSection(`Disappeared: ${count} elements`);
      }
    }

    // 5. Significant modifications
    const significantMods = diff.changes.modified.filter((m) => m.significant);
    if (significantMods.length > 0 && remaining > 40) {
      const maxItems = Math.min(significantMods.length, 3);
      const details = significantMods
        .slice(0, maxItems)
        .map((m) => `  ~ ${m.description}: ${m.property} "${m.from}" -> "${m.to}"`)
        .join('\n');
      const suffix =
        significantMods.length > maxItems
          ? `\n  ... +${significantMods.length - maxItems} more`
          : '';
      addSection(
        `Modified (${significantMods.length} significant):\n${truncateText(details + suffix, remaining - 30)}`
      );
    }

    // 6. Content changes
    if (diff.contentChanges && remaining > 30) {
      const { metricChanges, statusChanges, textChanges } = diff.contentChanges;

      if (metricChanges.length > 0) {
        const metricSummary = metricChanges
          .slice(0, 2)
          .map((m) => `${m.label}: ${m.oldValue} -> ${m.newValue}`)
          .join(', ');
        addSection(`Metrics: ${truncateText(metricSummary, remaining - 12)}`);
      }

      if (statusChanges.length > 0 && remaining > 20) {
        const statusSummary = statusChanges
          .slice(0, 2)
          .map((s) => `${s.label}: ${s.oldStatus} -> ${s.newStatus} (${s.direction})`)
          .join(', ');
        addSection(`Statuses: ${truncateText(statusSummary, remaining - 12)}`);
      }

      if (textChanges.length > 0 && remaining > 20) {
        addSection(`Text changes: ${textChanges.length}`);
      }
    }

    // 7. Minor modifications (only if plenty of budget left)
    const minorMods = diff.changes.modified.filter((m) => !m.significant);
    if (minorMods.length > 0 && remaining > 30) {
      addSection(`Minor changes: ${minorMods.length}`);
    }

    if (sections.length === 0) {
      return 'No changes detected';
    }

    return sections.join('\n');
  }

  // ==========================================================================
  // Feature 4: Scoped Diffs
  // ==========================================================================

  /**
   * Compute a diff scoped to elements within a CSS selector container.
   *
   * When `resolveScope` is provided (browser environment), uses actual DOM containment
   * to determine which elements are inside the container. Falls back to string-based
   * matching on parentContext, ID prefix, and description.
   */
  computeScopedDiff(
    fromSnapshot: SemanticSnapshot,
    toSnapshot: SemanticSnapshot,
    scope: string
  ): SemanticDiff {
    // Try DOM containment first
    const domScopedIds = this.deps.resolveScope?.(scope) ?? null;

    const filterElements = (elements: SemanticSnapshot['elements']) => {
      if (domScopedIds) {
        // DOM containment: only include elements whose ID is in the resolved set
        return elements.filter((el) => domScopedIds.has(el.id));
      }

      // Fallback: string-based matching
      const scopeLower = scope.toLowerCase();
      return elements.filter((el) => {
        if (el.parentContext && el.parentContext.toLowerCase().includes(scopeLower)) {
          return true;
        }
        if (el.id.toLowerCase().startsWith(scopeLower)) {
          return true;
        }
        if (el.description.toLowerCase().includes(scopeLower)) {
          return true;
        }
        return false;
      });
    };

    const scopedFrom: SemanticSnapshot = {
      ...fromSnapshot,
      snapshotId: `${fromSnapshot.snapshotId}:scoped(${scope})`,
      elements: filterElements(fromSnapshot.elements),
    };

    const scopedTo: SemanticSnapshot = {
      ...toSnapshot,
      snapshotId: `${toSnapshot.snapshotId}:scoped(${scope})`,
      elements: filterElements(toSnapshot.elements),
    };

    return computeDiff(scopedFrom, scopedTo, this.config.diffConfig);
  }

  /**
   * Get a scoped diff from the current state vs. a named bookmark.
   */
  scopedDiffFromBookmark(bookmarkName: string, scope: string): SemanticDiff | null {
    const bookmark = getGlobalBookmarkStore().get(bookmarkName);
    if (!bookmark) return null;

    this.deps.refreshElements?.();
    const currentControl = this.deps.createControlSnapshot();
    const currentSnapshot = this.deps.snapshotManager.createSnapshot(currentControl);

    return this.computeScopedDiff(bookmark.snapshot, currentSnapshot, scope);
  }

  // ==========================================================================
  // Feature 5: Change Buffer
  // ==========================================================================

  /** Enable change buffering. Starts MutationObserver and subscribes to
   * console/network events. When running inside a Tauri webview and
   * `setTauriEventNames()` has been called, also subscribes to those Tauri
   * backend events. The returned promise resolves once Tauri-event
   * subscriptions are in place; all other subscriptions are synchronous. In
   * non-Tauri hosts the promise resolves immediately. */
  async enableBuffer(): Promise<void> {
    this.bufferEnabled = true;
    this.bufferEnabledAt = Date.now();

    // Start MutationObserver for raw DOM mutations
    if (
      typeof MutationObserver !== 'undefined' &&
      typeof document !== 'undefined' &&
      !this.mutationObserver
    ) {
      this.mutationObserver = new MutationObserver((records) => {
        for (const record of records) {
          if (this.domMutationBuffer.length >= 500) {
            // Cap at 500: drop the oldest entry
            this.domMutationBuffer.shift();
          }
          const entry: DomMutationEntry = {
            type: record.type as DomMutationEntry['type'],
            target_selector: this.selectorFor(record.target),
            timestamp: Date.now(),
          };
          if (record.type === 'childList') {
            entry.added = record.addedNodes.length;
            entry.removed = record.removedNodes.length;
          } else if (record.type === 'attributes') {
            entry.attribute_name = record.attributeName ?? undefined;
          }
          this.domMutationBuffer.push(entry);
        }
      });
      try {
        this.mutationObserver.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true,
          attributeOldValue: false,
          characterDataOldValue: false,
        });
      } catch {
        // document.body may not be available (SSR / test env) — silently skip
        this.mutationObserver = null;
      }
    }

    // Subscribe to browser console/error events
    if (this.deps.subscribeBrowserEvents && !this.unsubscribeBrowserEvents) {
      const enabledAt = this.bufferEnabledAt;
      this.unsubscribeBrowserEvents = this.deps.subscribeBrowserEvents((event) => {
        if (event.timestamp < enabledAt) return;
        // Only capture console-level events (errors, warns, unhandled rejections)
        if (event.type !== 'console') return;
        if (this.consoleErrorBuffer.length >= 100) {
          this.consoleErrorBuffer.shift();
        }
        this.consoleErrorBuffer.push({
          level: (event.level ?? 'error') as ConsoleErrorEntry['level'],
          message: event.message ?? '',
          stack: event.stack,
          timestamp: event.timestamp,
        });
      });
    }

    // Subscribe to network events
    if (this.deps.subscribeNetworkEvents && !this.unsubscribeNetworkEvents) {
      const enabledAt = this.bufferEnabledAt;
      this.unsubscribeNetworkEvents = this.deps.subscribeNetworkEvents((event) => {
        // Only record when a request starts (to capture timestamp of start accurately)
        // We update/overwrite on completion to add status and duration.
        if (event.type === 'request-start') {
          if (event.entry.request.startedAt < enabledAt) return;
          if (this.networkRequestBuffer.length >= 200) {
            this.networkRequestBuffer.shift();
          }
          this.networkRequestBuffer.push({
            url: event.entry.request.url,
            method: event.entry.request.method,
            timestamp: event.entry.request.startedAt,
          });
        } else if (event.type === 'request-complete' || event.type === 'request-error') {
          if (event.entry.request.startedAt < enabledAt) return;
          // Update existing entry with status + duration, or append if not found
          const existing = this.networkRequestBuffer.find(
            (e) =>
              e.url === event.entry.request.url && e.timestamp === event.entry.request.startedAt
          );
          if (existing) {
            existing.status = event.entry.response?.statusCode;
            existing.duration_ms = event.entry.response?.durationMs;
          } else {
            // Request started before subscription began but finished after — append
            if (this.networkRequestBuffer.length >= 200) {
              this.networkRequestBuffer.shift();
            }
            this.networkRequestBuffer.push({
              url: event.entry.request.url,
              method: event.entry.request.method,
              status: event.entry.response?.statusCode,
              duration_ms: event.entry.response?.durationMs,
              timestamp: event.entry.request.startedAt,
            });
          }
        }
      });
    }

    // Subscribe to Tauri backend events (no-op outside a Tauri webview).
    await this.subscribeTauriEvents();
  }

  /** Disable change buffering. Stops MutationObserver and unsubscribes from services. */
  disableBuffer(): void {
    this.bufferEnabled = false;
    this._teardownExtendedObservers();
  }

  /**
   * Set the list of Tauri event names to capture in the change buffer.
   * Safe to call before or after `enableBuffer()`. When the buffer is
   * currently enabled, this unsubscribes from the previous names and
   * subscribes to the new ones (best-effort — returns a promise that
   * resolves once resubscription completes).
   */
  async setTauriEventNames(names: string[]): Promise<void> {
    // Clone so external mutations to the caller's array don't affect us.
    this.tauriEventNames = [...names];
    if (this.bufferEnabled) {
      this.unsubscribeTauriEvents();
      await this.subscribeTauriEvents();
    }
  }

  /**
   * Subscribe to Tauri backend events. No-op when not running inside a
   * Tauri webview (detected via `window.__TAURI_INTERNALS__`) or when the
   * event-name list is empty. Loads `@tauri-apps/api/event` via dynamic
   * import so the SDK stays usable in non-Tauri hosts without the optional
   * dependency installed.
   */
  private async subscribeTauriEvents(): Promise<void> {
    // Idempotent: if listeners are already registered (e.g., enableBuffer was
    // called twice without an intervening disableBuffer, or a concurrent
    // setTauriEventNames raced the first subscribe), bail out so we don't
    // accumulate duplicate subscriptions that fire each event multiple times.
    if (this.tauriEventUnlisteners.length > 0) return;
    // Guard: only run in a Tauri webview.
    if (
      typeof window === 'undefined' ||
      !(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
    ) {
      return;
    }
    if (this.tauriEventNames.length === 0) return;

    type ListenFn = (
      name: string,
      handler: (e: { event: string; payload: unknown }) => void
    ) => Promise<() => void>;

    // Prefer the globally exposed Tauri event API. When the Tauri frontend
    // runs with `withGlobalTauri: true` (the default for v2), the helpers are
    // published at `window.__TAURI__.event.listen`. This avoids the dynamic-
    // import path entirely, which otherwise fails in production bundles
    // where bare specifiers like `@tauri-apps/api/event` can't be resolved
    // at runtime by the browser (Vite's `@vite-ignore` opts out of bundling
    // and rewriting, so the specifier reaches the browser unchanged and
    // throws `Failed to resolve module specifier`).
    const globalTauri = (
      window as unknown as {
        __TAURI__?: { event?: { listen?: ListenFn } };
      }
    ).__TAURI__;
    let listen: ListenFn | undefined = globalTauri?.event?.listen;

    if (typeof listen !== 'function') {
      try {
        // Fallback: dynamic import of `@tauri-apps/api/event` for hosts
        // that don't expose the global (e.g. `withGlobalTauri: false`).
        // Kept out of the static dep tree via the helper below so vitest
        // can mock by specifier.
        const specifier = `@tauri-apps/api/event`;
        const mod = await loadTauriEventModule(specifier);
        const dynListen = (mod as { listen?: unknown }).listen;
        if (typeof dynListen === 'function') {
          listen = dynListen as ListenFn;
        }
      } catch (err) {
        console.warn('[ui-bridge] Tauri event subscription unavailable:', err);
        return;
      }
    }

    if (typeof listen !== 'function') {
      // Neither global nor dynamic-import path produced a usable listen fn.
      return;
    }

    for (const name of this.tauriEventNames) {
      try {
        const unlisten = await listen(name, (e) => {
          // Skip events when the buffer is disabled — handlers registered
          // mid-flight may fire after a concurrent disableBuffer cleared the
          // array, and the push would otherwise silently grow the buffer.
          if (!this.bufferEnabled) return;
          if (this.tauriEventBuffer.length >= this.tauriEventBufferCap) return;
          this.tauriEventBuffer.push({
            event: e.event,
            payload: e.payload,
            timestamp: Date.now(),
          });
        });
        // Race guard: if disableBuffer ran while we were awaiting listen(),
        // the unlisteners array was already cleared. Tear down this new
        // subscription immediately so it doesn't leak.
        if (!this.bufferEnabled) {
          try {
            unlisten();
          } catch {
            /* ignore */
          }
          // Don't keep subscribing — disableBuffer asked us to stop.
          return;
        }
        this.tauriEventUnlisteners.push(unlisten);
      } catch (err) {
        // One bad name shouldn't block the others.

        console.warn(`[ui-bridge] Failed to subscribe to Tauri event "${name}":`, err);
      }
    }
  }

  /** Invoke every stored unlisten function and clear the list. */
  private unsubscribeTauriEvents(): void {
    for (const unlisten of this.tauriEventUnlisteners) {
      try {
        unlisten();
      } catch {
        /* ignore */
      }
    }
    this.tauriEventUnlisteners = [];
  }

  /** Stop MutationObserver and unsubscribe from console/network services. */
  private _teardownExtendedObservers(): void {
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }
    if (this.unsubscribeBrowserEvents) {
      try {
        this.unsubscribeBrowserEvents();
      } catch {
        /* ignore */
      }
      this.unsubscribeBrowserEvents = null;
    }
    if (this.unsubscribeNetworkEvents) {
      try {
        this.unsubscribeNetworkEvents();
      } catch {
        /* ignore */
      }
      this.unsubscribeNetworkEvents = null;
    }
    // Clear Tauri listeners and drop any queued events — buffer semantics
    // match the other sub-lists which are not preserved across disable.
    this.unsubscribeTauriEvents();
    this.tauriEventBuffer = [];
  }

  /** Whether the buffer is enabled */
  isBufferEnabled(): boolean {
    return this.bufferEnabled;
  }

  /** Get buffer size (registry-level changes only, for backward compat) */
  getBufferSize(): number {
    return this.changeBuffer.length;
  }

  /**
   * Drain all buffered changes and clear the four sub-lists.
   * Observers remain active if the buffer is still enabled (incremental semantics:
   * subsequent drains return only events since the previous drain).
   *
   * Route-change and registry-diff entries are returned in `changes`, interleaved by
   * `recordedAt`. Raw DOM mutations, console errors, and network requests are returned
   * in separate typed lists.
   */
  drainBuffer(): ChangeBufferDrainResult {
    const changes = [...this.changeBuffer];
    this.changeBuffer = [];
    // Defensive sort in case route-change events were pushed slightly out
    // of order (e.g. queued microtask ran after a synchronous DOM mutation
    // appended later).
    changes.sort((a, b) => a.recordedAt - b.recordedAt || a.sequence - b.sequence);

    // Drain extended sub-lists
    const dom = [...this.domMutationBuffer];
    this.domMutationBuffer = [];

    const console_errors = [...this.consoleErrorBuffer];
    this.consoleErrorBuffer = [];

    const network_requests = [...this.networkRequestBuffer];
    this.networkRequestBuffer = [];

    const tauri_events = [...this.tauriEventBuffer];
    this.tauriEventBuffer = [];

    return {
      changes,
      dom,
      console_errors,
      network_requests,
      tauri_events,
      count: changes.length,
      enabled_at: this.bufferEnabledAt,
      fromTimestamp: changes.length > 0 ? changes[0].recordedAt : 0,
      toTimestamp: changes.length > 0 ? changes[changes.length - 1].recordedAt : 0,
    };
  }

  /**
   * Return a shallow copy of the registry-level change buffer without
   * draining it. Safe to call repeatedly — does not advance the drain
   * cursor.
   *
   * Used by callers that filter by timestamp (`getChangesSince`) or by
   * element id (`getElementHistory`) and need to read the same window
   * across multiple calls. Compare with `drainBuffer()`, which is the
   * incremental "give me everything since last drain" reader and
   * clears the buffer.
   *
   * Only the registry-level `changeBuffer` (`BufferedChange |
   * BufferedRouteChange`) is exposed here. Sub-buffers (DOM mutations,
   * console errors, network requests, Tauri events) intentionally
   * remain drain-only — peek is for the change/route-change feed that
   * external HTTP endpoints filter against.
   */
  peekBuffer(): BufferEntry[] {
    return [...this.changeBuffer];
  }

  /**
   * Derive a best-effort CSS selector string for a DOM node.
   * Used for DomMutationEntry.target_selector.
   */
  private selectorFor(node: Node): string {
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return node.nodeName.toLowerCase();
    }
    const el = node as Element;
    const parts: string[] = [el.tagName.toLowerCase()];
    if (el.id) {
      return `#${el.id}`;
    }
    const cls = classList(el).slice(0, 2).join('.');
    if (cls) parts.push(`.${cls}`);
    return parts.join('');
  }

  /**
   * Push a SPA route-change entry into the buffer (P1.3). Called by the
   * runner's `useChangeTrackingEvents` integration when the
   * NavigationTracker fires a `navigation:change` event.
   *
   * Always feeds the always-on `recentRouteChanges` ring buffer and fires
   * any `subscribeRouteChange` listeners, regardless of `bufferEnabled`, so
   * that `/ai/wait-for-route-change` can resolve without the change buffer
   * being explicitly enabled. The existing `changeBuffer` append remains
   * gated on `bufferEnabled` for backward compatibility with drain semantics.
   */
  pushRouteChange(from: string, to: string, at?: number): void {
    const recordedAt = at ?? Date.now();

    // Always-on tracking for wait-for-route-change race mitigation.
    this.recentRouteChanges.push({ from, to, at: recordedAt });
    if (this.recentRouteChanges.length > this.recentRouteChangesCap) {
      this.recentRouteChanges.splice(
        0,
        this.recentRouteChanges.length - this.recentRouteChangesCap
      );
    }
    // Fire listeners synchronously — subscribers are expected to be cheap.
    for (const listener of this.routeChangeListeners) {
      try {
        listener({ from, to, at: recordedAt });
      } catch {
        /* ignore listener errors — one bad subscriber shouldn't block others */
      }
    }

    if (!this.bufferEnabled) return;
    const entry: BufferedRouteChange = {
      type: 'route-change',
      from,
      to,
      at: recordedAt,
      recordedAt,
      sequence: this.bufferSequence++,
    };
    this.changeBuffer.push(entry);
    this.evictIfOverLimit();
  }

  /**
   * Subscribe to SPA route-change events.
   *
   * Fires synchronously from `pushRouteChange`, regardless of whether the
   * change buffer is enabled. Returns an unsubscribe function.
   */
  subscribeRouteChange(
    listener: (event: { from: string; to: string; at: number }) => void
  ): () => void {
    this.routeChangeListeners.add(listener);
    return () => {
      this.routeChangeListeners.delete(listener);
    };
  }

  /**
   * Return recent route-change events from the always-on ring buffer,
   * optionally filtered to entries recorded at or after `sinceMs`.
   *
   * Used by `/ai/wait-for-route-change` to resolve immediately when a
   * matching navigation occurred between the HTTP request arriving and the
   * listener being attached.
   */
  getRecentRouteChanges(sinceMs?: number): Array<{ from: string; to: string; at: number }> {
    if (sinceMs === undefined) return [...this.recentRouteChanges];
    return this.recentRouteChanges.filter((entry) => entry.at >= sinceMs);
  }

  /** Append a diff to the buffer */
  private appendToBuffer(diff: SemanticDiff, category: ChangeCategory): void {
    if (!this.bufferEnabled) return;

    const entry: BufferedChange = {
      diff,
      category,
      recordedAt: Date.now(),
      sequence: this.bufferSequence++,
    };
    this.changeBuffer.push(entry);
    this.evictIfOverLimit();
  }

  /** Trim oldest entries when the buffer exceeds its configured size. */
  private evictIfOverLimit(): void {
    if (this.changeBuffer.length > this.config.maxBufferSize) {
      this.changeBuffer = this.changeBuffer.slice(
        this.changeBuffer.length - this.config.maxBufferSize
      );
    }
  }

  // ==========================================================================
  // Feature 6: Snapshot Bookmarks
  // ==========================================================================

  /**
   * Save a named snapshot of the current state.
   */
  saveBookmark(name: string): SnapshotBookmark {
    this.deps.refreshElements?.();
    const controlSnapshot = this.deps.createControlSnapshot();
    const snapshot = this.deps.snapshotManager.createSnapshot(controlSnapshot);

    const bookmark: SnapshotBookmark = {
      name,
      snapshot,
      savedAt: Date.now(),
    };

    // Persist via the shared bookmark store. Eviction policy lives in the
    // store so every code path benefits.
    getGlobalBookmarkStore().save(bookmark);
    return bookmark;
  }

  /**
   * Get a named bookmark.
   */
  getBookmark(name: string): SnapshotBookmark | null {
    return getGlobalBookmarkStore().get(name);
  }

  /**
   * Delete a named bookmark.
   */
  deleteBookmark(name: string): boolean {
    return getGlobalBookmarkStore().delete(name);
  }

  /**
   * List all bookmark names.
   */
  listBookmarks(): string[] {
    return getGlobalBookmarkStore().listNames();
  }

  /**
   * Compute a diff from a named bookmark to the current state.
   */
  diffFromBookmark(name: string): SemanticDiff | null {
    const bookmark = getGlobalBookmarkStore().get(name);
    if (!bookmark) return null;

    this.deps.refreshElements?.();
    const currentControl = this.deps.createControlSnapshot();
    const currentSnapshot = this.deps.snapshotManager.createSnapshot(currentControl);

    const diff = computeDiff(bookmark.snapshot, currentSnapshot, this.config.diffConfig);
    this.lastDiff = diff;
    return diff;
  }
}

// ============================================================================
// Structured Change Analysis (List/Table-Aware Diffing)
// ============================================================================

/**
 * Analyze structural changes between two snapshots at the table/list level.
 *
 * Detects tables and lists in both snapshots using spatial layout analysis,
 * then compares them to identify added/removed/modified rows or items.
 */
export function analyzeStructuredChanges(
  before: SemanticSnapshot,
  after: SemanticSnapshot
): StructuredChangeAnalysis {
  const tableChanges: TableChangeAnalysis[] = [];
  const listChanges: ListChangeAnalysis[] = [];

  // Detect tables in before/after
  const beforeTable = detectTable(before.elements as any);
  const afterTable = detectTable(after.elements as any);

  if (beforeTable || afterTable) {
    const analysis = diffTables(beforeTable, afterTable);
    if (analysis) {
      tableChanges.push(analysis);
    }
  }

  // Detect lists in before/after
  const beforeList = detectList(before.elements as any);
  const afterList = detectList(after.elements as any);

  if (beforeList || afterList) {
    const analysis = diffLists(beforeList, afterList);
    if (analysis) {
      listChanges.push(analysis);
    }
  }

  return {
    tableChanges,
    listChanges,
    hasStructuredData: tableChanges.length > 0 || listChanges.length > 0,
  };
}

/**
 * Diff two detected tables at the row level.
 */
function diffTables(
  before: ReturnType<typeof detectTable>,
  after: ReturnType<typeof detectTable>
): TableChangeAnalysis | null {
  // Table appeared
  if (!before && after) {
    return {
      label: after.label,
      columns: after.columns.map((c) => c.header),
      addedRows: after.rows,
      removedRows: [],
      modifiedRows: [],
      summary: `Table "${after.label}" appeared with ${after.rows.length} rows`,
    };
  }

  // Table disappeared
  if (before && !after) {
    return {
      label: before.label,
      columns: before.columns.map((c) => c.header),
      addedRows: [],
      removedRows: before.rows,
      modifiedRows: [],
      summary: `Table "${before.label}" disappeared (had ${before.rows.length} rows)`,
    };
  }

  // Both exist — compare rows
  if (before && after) {
    const columns = after.columns.map((c) => c.header);
    const addedRows: string[][] = [];
    const removedRows: string[][] = [];
    const modifiedRows: TableChangeAnalysis['modifiedRows'] = [];

    // Build row keys (first column as identifier, or full row stringified)
    const keyFn = (row: string[]): string => row[0] ?? row.join('|');

    const beforeRowMap = new Map<string, { row: string[]; index: number }>();
    for (let i = 0; i < before.rows.length; i++) {
      beforeRowMap.set(keyFn(before.rows[i]), { row: before.rows[i], index: i });
    }

    const afterRowMap = new Map<string, { row: string[]; index: number }>();
    for (let i = 0; i < after.rows.length; i++) {
      afterRowMap.set(keyFn(after.rows[i]), { row: after.rows[i], index: i });
    }

    // Find added rows
    for (const [key, { row }] of afterRowMap) {
      if (!beforeRowMap.has(key)) {
        addedRows.push(row);
      }
    }

    // Find removed rows
    for (const [key, { row }] of beforeRowMap) {
      if (!afterRowMap.has(key)) {
        removedRows.push(row);
      }
    }

    // Find modified rows (same key, different cell values)
    for (const [key, afterEntry] of afterRowMap) {
      const beforeEntry = beforeRowMap.get(key);
      if (beforeEntry) {
        const changes: { column: string; from: string; to: string }[] = [];
        const maxCols = Math.max(beforeEntry.row.length, afterEntry.row.length);
        for (let c = 0; c < maxCols; c++) {
          const fromVal = beforeEntry.row[c] ?? '';
          const toVal = afterEntry.row[c] ?? '';
          if (fromVal !== toVal) {
            changes.push({
              column: columns[c] ?? `col_${c}`,
              from: fromVal,
              to: toVal,
            });
          }
        }
        if (changes.length > 0) {
          modifiedRows.push({ rowIndex: afterEntry.index, changes });
        }
      }
    }

    if (addedRows.length === 0 && removedRows.length === 0 && modifiedRows.length === 0) {
      return null; // No table-level changes
    }

    const parts: string[] = [];
    if (addedRows.length > 0) parts.push(`${addedRows.length} rows added`);
    if (removedRows.length > 0) parts.push(`${removedRows.length} rows removed`);
    if (modifiedRows.length > 0) parts.push(`${modifiedRows.length} rows modified`);

    return {
      label: after.label,
      columns,
      addedRows,
      removedRows,
      modifiedRows,
      summary: `Table "${after.label}": ${parts.join(', ')}`,
    };
  }

  return null;
}

/**
 * Diff two detected lists at the item level.
 */
function diffLists(
  before: ReturnType<typeof detectList>,
  after: ReturnType<typeof detectList>
): ListChangeAnalysis | null {
  // List appeared
  if (!before && after) {
    return {
      label: after.label,
      addedItems: after.items,
      removedItems: [],
      summary: `List appeared with ${after.items.length} items`,
    };
  }

  // List disappeared
  if (before && !after) {
    return {
      label: before.label,
      addedItems: [],
      removedItems: before.items,
      summary: `List disappeared (had ${before.items.length} items)`,
    };
  }

  // Both exist — compare items
  if (before && after) {
    const itemKey = (item: Record<string, string>): string => Object.values(item).join('|');

    const beforeKeys = new Set(before.items.map(itemKey));
    const afterKeys = new Set(after.items.map(itemKey));

    const addedItems = after.items.filter((item) => !beforeKeys.has(itemKey(item)));
    const removedItems = before.items.filter((item) => !afterKeys.has(itemKey(item)));

    if (addedItems.length === 0 && removedItems.length === 0) {
      return null;
    }

    const parts: string[] = [];
    if (addedItems.length > 0) parts.push(`${addedItems.length} items added`);
    if (removedItems.length > 0) parts.push(`${removedItems.length} items removed`);

    return {
      label: after.label,
      addedItems,
      removedItems,
      summary: `List: ${parts.join(', ')}`,
    };
  }

  return null;
}

// ============================================================================
// Factory
// ============================================================================

export function createChangeTracker(
  deps: ChangeTrackerDeps,
  config?: Partial<ChangeTrackerConfig>
): ChangeTracker {
  return new ChangeTracker(deps, config);
}

// ============================================================================
// Helpers
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Dynamic-import wrapper for `@tauri-apps/api/event`.
 *
 * The specifier is passed in as a variable so neither Vite (vitest) nor tsup
 * tries to resolve the module at transform/build time. This is load-bearing:
 * the SDK is published without `@tauri-apps/api` as a hard dependency, so the
 * module may not exist in the consumer's or test runner's node_modules, and a
 * static import would hard-fail at import-analysis. At runtime in a Tauri
 * webview the module is always present. Vitest's `vi.mock()` still matches
 * by module name and intercepts the dynamic import.
 *
 * Magic comments below silence each bundler's import analyzer:
 * - `@vite-ignore` keeps Vite (and vitest) quiet for consumers that bundle
 *   the SDK through Vite.
 * - `turbopackIgnore: true` does the same for Next.js Turbopack consumers
 *   (Next 15+; required by `examples/nextjs-app` on Next 16).
 */
async function loadTauriEventModule(specifier: string): Promise<unknown> {
  return import(/* @vite-ignore */ /* turbopackIgnore: true */ specifier);
}
