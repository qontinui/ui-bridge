/**
 * Undo/Redo Tracker
 *
 * Stateful tracker that combines DOM detection with action history correlation
 * and developer-declared undo state to provide comprehensive undo/redo awareness.
 *
 * Responsibilities:
 * - Maintains a rolling buffer of recent bridge actions as potential undo targets
 * - Integrates with UndoDetector for DOM scanning
 * - Accepts developer-declared state via setDeclaredState() (from useUndoRedo hook)
 * - Produces SnapshotUndoContext for ControlSnapshot integration
 */

import type {
  UndoRedoState,
  UndoEntry,
  SnapshotUndoContext,
  UndoDetectionSource,
  DeclaredUndoState,
  UndoTrackerConfig,
} from './types';
import { UndoDetector } from './undo-detector';
import { truncateCodePoints } from '../core/text';
import { buildKeyboardEventInit } from '../core/key-events';
import type { UndoDetectionResult } from './undo-detector';

// ---------------------------------------------------------------------------
// Action description helpers
// ---------------------------------------------------------------------------

interface ActionRecord {
  id: string;
  target: string;
  action: string;
  params?: Record<string, unknown>;
  timestamp: number;
}

function truncate(str: string | undefined, maxLen: number): string {
  if (!str) return '';
  return str.length > maxLen ? truncateCodePoints(str, maxLen) + '...' : str;
}

function describeAction(record: ActionRecord): string {
  switch (record.action) {
    case 'type':
      return `typing "${truncate(record.params?.text as string, 30)}"`;
    case 'click':
      return `clicking ${record.target}`;
    case 'select':
      return `selecting "${truncate(String(record.params?.value ?? ''), 30)}"`;
    case 'scroll':
      return `scrolling ${record.params?.direction ?? 'down'}`;
    case 'drag':
      return `dragging ${record.target}`;
    case 'focus':
      return `focusing ${record.target}`;
    case 'hover':
      return `hovering ${record.target}`;
    case 'keyboard': {
      const key = record.params?.key as string | undefined;
      return key ? `pressing ${key}` : `keyboard action on ${record.target}`;
    }
    default:
      return `${record.action} on ${record.target}`;
  }
}

// ---------------------------------------------------------------------------
// Summary builder
// ---------------------------------------------------------------------------

function buildSummary(state: UndoRedoState): string {
  const parts: string[] = [];

  if (state.undoAvailable) {
    let undoMsg = 'Undo available';
    if (state.undoDescription) {
      undoMsg += `: ${state.undoDescription}`;
    }
    if (state.undoStack.length > 0) {
      const topEntry = state.undoStack[0];
      const confLabel =
        topEntry.confidence >= 0.8 ? 'high' : topEntry.confidence >= 0.5 ? 'medium' : 'low';
      undoMsg += ` (${confLabel} confidence)`;
    }
    if (state.undoDepth !== undefined) {
      undoMsg += ` [${state.undoDepth} steps]`;
    }
    parts.push(undoMsg);
  } else {
    parts.push('Undo not available');
  }

  if (state.redoAvailable) {
    let redoMsg = 'Redo available';
    if (state.redoDescription) {
      redoMsg += `: ${state.redoDescription}`;
    }
    parts.push(redoMsg);
  }

  if (state.undoShortcut) {
    parts.push(`Undo shortcut: ${state.undoShortcut}`);
  }

  return parts.join('. ');
}

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: Required<UndoTrackerConfig> = {
  maxActionEntries: 50,
  detectorConfig: {},
};

// ---------------------------------------------------------------------------
// UndoTracker
// ---------------------------------------------------------------------------

export class UndoTracker {
  private readonly detector: UndoDetector;
  private readonly maxActionEntries: number;

  /** Rolling buffer of recent bridge actions */
  private actionBuffer: ActionRecord[] = [];

  /** Developer-declared state (set via setDeclaredState) */
  private declaredState: DeclaredUndoState | null = null;

  constructor(config: UndoTrackerConfig = {}) {
    this.maxActionEntries = config.maxActionEntries ?? DEFAULT_CONFIG.maxActionEntries;
    this.detector = new UndoDetector(config.detectorConfig);
  }

  // -----------------------------------------------------------------------
  // Action recording
  // -----------------------------------------------------------------------

  /**
   * Record a bridge action for undo correlation.
   * Call this when an action completes successfully.
   */
  recordAction(record: {
    id: string;
    target: string;
    action: string;
    params?: Record<string, unknown>;
  }): void {
    this.actionBuffer.push({
      ...record,
      timestamp: Date.now(),
    });

    // Evict oldest entries
    if (this.actionBuffer.length > this.maxActionEntries) {
      this.actionBuffer = this.actionBuffer.slice(-this.maxActionEntries);
    }
  }

  // -----------------------------------------------------------------------
  // Developer declaration
  // -----------------------------------------------------------------------

  /**
   * Set developer-declared undo/redo state (from useUndoRedo hook).
   * This overrides heuristic detection with authoritative data.
   */
  setDeclaredState(state: DeclaredUndoState | null): void {
    this.declaredState = state;
  }

  /**
   * Get the current developer-declared state, if any.
   */
  getDeclaredState(): DeclaredUndoState | null {
    return this.declaredState;
  }

  /**
   * Execute undo programmatically.
   * Uses developer handler if available, otherwise dispatches Ctrl+Z.
   * Returns true if an undo method was available to execute.
   */
  executeUndo(): boolean {
    if (this.declaredState?.onUndo) {
      this.declaredState.onUndo();
      return true;
    }

    // Fallback: dispatch Ctrl+Z / Cmd+Z keyboard event
    if (typeof document !== 'undefined') {
      const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
      // Built by the ONE shared keyboard-event builder so this dispatch carries
      // `keyCode`/`which` (90 for Z) as well as `key`/`code`. An undo handler
      // written as `if (e.ctrlKey && e.keyCode === 90)` saw 0 before and never
      // fired.
      document.activeElement?.dispatchEvent(
        new KeyboardEvent(
          'keydown',
          buildKeyboardEventInit('z', { ctrl: !isMac, meta: isMac }, 'keydown')
        )
      );
      return true;
    }

    return false;
  }

  /**
   * Execute redo programmatically.
   * Uses developer handler if available, otherwise dispatches Ctrl+Shift+Z.
   * Returns true if a redo method was available to execute.
   */
  executeRedo(): boolean {
    if (this.declaredState?.onRedo) {
      this.declaredState.onRedo();
      return true;
    }

    // Fallback: dispatch Ctrl+Shift+Z / Cmd+Shift+Z keyboard event
    if (typeof document !== 'undefined') {
      const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
      // Same shared builder as `executeUndo` — see the note there.
      document.activeElement?.dispatchEvent(
        new KeyboardEvent(
          'keydown',
          buildKeyboardEventInit('z', { ctrl: !isMac, meta: isMac, shift: true }, 'keydown')
        )
      );
      return true;
    }

    return false;
  }

  // -----------------------------------------------------------------------
  // State computation
  // -----------------------------------------------------------------------

  /**
   * Get the full undo/redo state by combining all detection sources.
   */
  getState(): UndoRedoState {
    const now = Date.now();
    const detection = this.detector.detect();
    const declared = this.declaredState;

    // If developer declared state, it's authoritative
    if (declared) {
      return this.buildDeclaredState(declared, detection, now);
    }

    // Otherwise, combine heuristic sources
    return this.buildHeuristicState(detection, now);
  }

  /**
   * Get the snapshot context for ControlSnapshot integration.
   */
  getSnapshotUndoContext(): SnapshotUndoContext {
    const state = this.getState();
    return {
      canUndo: state.undoAvailable,
      canRedo: state.redoAvailable,
      undoDescription: state.undoDescription,
      redoDescription: state.redoDescription,
      undoDepth: state.undoDepth,
      redoDepth: state.redoDepth,
      summary: buildSummary(state),
    };
  }

  // -----------------------------------------------------------------------
  // Private: build state from declared (developer) data
  // -----------------------------------------------------------------------

  private buildDeclaredState(
    declared: DeclaredUndoState,
    detection: UndoDetectionResult,
    now: number
  ): UndoRedoState {
    const sources: UndoDetectionSource[] = ['developer-declared'];
    if (detection.undoElement || detection.redoElement) sources.push('dom-element');
    if (detection.execCommandUndo || detection.execCommandRedo) sources.push('exec-command');

    const undoStack: UndoEntry[] = (declared.undoStack ?? []).map((desc, i) => ({
      description: desc,
      source: 'developer-declared' as UndoDetectionSource,
      confidence: 1.0,
      timestamp: now - i, // Preserve ordering
    }));

    const redoStack: UndoEntry[] = (declared.redoStack ?? []).map((desc, i) => ({
      description: desc,
      source: 'developer-declared' as UndoDetectionSource,
      confidence: 1.0,
      timestamp: now - i,
    }));

    const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);

    return {
      undoAvailable: declared.canUndo,
      redoAvailable: declared.canRedo,
      undoDescription: declared.undoDescription ?? undoStack[0]?.description,
      redoDescription: declared.redoDescription ?? redoStack[0]?.description,
      undoDepth: declared.undoStack?.length,
      redoDepth: declared.redoStack?.length,
      undoStack,
      redoStack,
      detectionSources: sources,
      undoShortcut: isMac ? 'Cmd+Z' : 'Ctrl+Z',
      redoShortcut: isMac ? 'Cmd+Shift+Z' : 'Ctrl+Shift+Z',
      undoElement: detection.undoElement,
      redoElement: detection.redoElement,
      timestamp: now,
    };
  }

  // -----------------------------------------------------------------------
  // Private: build state from heuristic (DOM + execCommand + action history)
  // -----------------------------------------------------------------------

  private buildHeuristicState(detection: UndoDetectionResult, now: number): UndoRedoState {
    const sources: UndoDetectionSource[] = [];

    // DOM element detection
    let undoFromDom = false;
    let redoFromDom = false;
    let undoDescription: string | undefined;
    let redoDescription: string | undefined;

    if (detection.undoElement) {
      sources.push('dom-element');
      undoFromDom = detection.undoElement.enabled;
      undoDescription = detection.undoElement.parsedDescription;
    }

    if (detection.redoElement) {
      if (!sources.includes('dom-element')) sources.push('dom-element');
      redoFromDom = detection.redoElement.enabled;
      redoDescription = detection.redoElement.parsedDescription;
    }

    // execCommand probe
    let undoFromExec = false;
    let redoFromExec = false;
    if (detection.execCommandUndo || detection.execCommandRedo) {
      sources.push('exec-command');
      undoFromExec = detection.execCommandUndo;
      redoFromExec = detection.execCommandRedo;
    }

    const undoAvailable = undoFromDom || undoFromExec;
    const redoAvailable = redoFromDom || redoFromExec;

    // Build undo stack from action history correlation
    const undoStack: UndoEntry[] = [];
    if (undoAvailable && this.actionBuffer.length > 0) {
      // The most recent action is the most likely undo target
      const recentActions = [...this.actionBuffer].reverse();
      for (const action of recentActions.slice(0, 5)) {
        // Confidence decreases for older actions
        const ageSec = (now - action.timestamp) / 1000;
        const ageDecay = Math.max(0.1, 1.0 - ageSec / 60);
        const baseConfidence = undoFromDom ? 0.6 : 0.3;

        undoStack.push({
          description: describeAction(action),
          source: undoFromDom ? 'dom-element' : 'exec-command',
          actionId: action.id,
          confidence: Math.min(1.0, baseConfidence * ageDecay),
          timestamp: action.timestamp,
        });
      }
    }

    // Use the top undo stack description if no description from DOM
    if (!undoDescription && undoStack.length > 0) {
      undoDescription = undoStack[0].description;
    }

    const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);

    return {
      undoAvailable,
      redoAvailable,
      undoDescription,
      redoDescription,
      undoDepth: undefined,
      redoDepth: undefined,
      undoStack,
      redoStack: [],
      detectionSources: sources,
      undoShortcut: isMac ? 'Cmd+Z' : 'Ctrl+Z',
      redoShortcut: isMac ? 'Cmd+Shift+Z' : 'Ctrl+Shift+Z',
      undoElement: detection.undoElement,
      redoElement: detection.redoElement,
      timestamp: now,
    };
  }
}
