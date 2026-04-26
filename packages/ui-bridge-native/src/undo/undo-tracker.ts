import type { NativeSnapshotUndoContext } from '../core/types';

/**
 * A single bridge action recorded for undo correlation. Action-correlation
 * only — RN has no DOM/execCommand probe, so we rely on developer
 * declaration plus this rolling history of recent actions.
 */
export interface ActionRecord {
  id: string;
  type: string;
  targetId?: string;
  description?: string;
  timestamp: number;
  /** Default true — set false for actions that aren't reversible (e.g. navigation, network calls) */
  reversible?: boolean;
}

/**
 * Developer-declared undo/redo state. When set, this is authoritative and
 * overrides any heuristic inference from action history.
 */
export interface DeclaredUndoState {
  canUndo: boolean;
  canRedo: boolean;
  undoDescription?: string;
  redoDescription?: string;
  undoDepth?: number;
  redoDepth?: number;
}

export interface UndoTrackerConfig {
  maxHistory?: number;
}

const DEFAULT_MAX_HISTORY = 50;

function buildSummary(ctx: {
  canUndo: boolean;
  canRedo: boolean;
  undoDescription?: string;
  redoDescription?: string;
}): string {
  if (!ctx.canUndo && !ctx.canRedo) {
    return 'no undo available';
  }
  const parts: string[] = [];
  if (ctx.canUndo) {
    parts.push(`undo: '${ctx.undoDescription ?? 'available'}'`);
  }
  if (ctx.canRedo) {
    parts.push(`redo: '${ctx.redoDescription ?? 'available'}'`);
  }
  return parts.join(' / ');
}

/**
 * Action-correlation undo tracker for React Native.
 *
 * Maintains a rolling buffer of recent actions and a developer-declared
 * undo state slot. The declared state is authoritative when set; otherwise
 * we infer `canUndo` from whether any reversible action has been recorded.
 * `executeUndo`/`executeRedo` are placeholders pending an IPC path through
 * ui-bridge-native to the runner's `/control/undo`.
 */
export class UndoTracker {
  private readonly maxHistory: number;
  private actions: ActionRecord[] = [];
  private declaredState: DeclaredUndoState | null = null;

  constructor(config: UndoTrackerConfig = {}) {
    this.maxHistory = config.maxHistory ?? DEFAULT_MAX_HISTORY;
  }

  recordAction(record: ActionRecord): void {
    this.actions.push(record);
    if (this.actions.length > this.maxHistory) {
      this.actions = this.actions.slice(-this.maxHistory);
    }
  }

  setDeclaredState(state: DeclaredUndoState): void {
    this.declaredState = state;
  }

  getActionHistory(): ActionRecord[] {
    return this.actions.slice();
  }

  getSnapshotUndoContext(): NativeSnapshotUndoContext {
    const declared = this.declaredState;
    if (declared) {
      const summary = buildSummary({
        canUndo: declared.canUndo,
        canRedo: declared.canRedo,
        undoDescription: declared.undoDescription,
        redoDescription: declared.redoDescription,
      });
      return {
        canUndo: declared.canUndo,
        canRedo: declared.canRedo,
        undoDescription: declared.undoDescription,
        redoDescription: declared.redoDescription,
        undoDepth: declared.undoDepth,
        redoDepth: declared.redoDepth,
        summary,
      };
    }

    const canUndo = this.actions.some((a) => a.reversible !== false);
    const canRedo = false;
    // Surface the most recent reversible action's description as the inferred undo target
    const lastReversible = [...this.actions].reverse().find((a) => a.reversible !== false);
    const undoDescription = lastReversible?.description;
    const summary = buildSummary({ canUndo, canRedo, undoDescription });
    return {
      canUndo,
      canRedo,
      undoDescription,
      summary,
    };
  }

  executeUndo(): { ok: boolean; reason?: string } {
    return { ok: false, reason: 'Not implemented in native' };
  }

  executeRedo(): { ok: boolean; reason?: string } {
    return { ok: false, reason: 'Not implemented in native' };
  }

  clear(): void {
    this.actions = [];
    this.declaredState = null;
  }
}
