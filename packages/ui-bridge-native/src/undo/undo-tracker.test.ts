import { describe, it, expect, beforeEach } from 'vitest';
import { UndoTracker } from './undo-tracker';
import type { ActionRecord } from './undo-tracker';

function makeAction(partial: Partial<ActionRecord> & { id: string; type: string }): ActionRecord {
  return {
    timestamp: Date.now(),
    ...partial,
  };
}

describe('UndoTracker', () => {
  let tracker: UndoTracker;

  beforeEach(() => {
    tracker = new UndoTracker();
  });

  it('returns canUndo=false, canRedo=false, summary="no undo available" when empty', () => {
    const ctx = tracker.getSnapshotUndoContext();
    expect(ctx.canUndo).toBe(false);
    expect(ctx.canRedo).toBe(false);
    expect(ctx.summary).toBe('no undo available');
  });

  it('infers canUndo=true after a reversible action is recorded', () => {
    tracker.recordAction(makeAction({ id: 'a1', type: 'press', description: 'pressed Submit' }));
    const ctx = tracker.getSnapshotUndoContext();
    expect(ctx.canUndo).toBe(true);
    expect(ctx.canRedo).toBe(false);
    expect(ctx.undoDescription).toBe('pressed Submit');
    expect(ctx.summary).toBe("undo: 'pressed Submit'");
  });

  it('does not flip canUndo when only an irreversible action is recorded', () => {
    tracker.recordAction(
      makeAction({
        id: 'nav-1',
        type: 'navigate',
        reversible: false,
        description: 'navigate /home',
      })
    );
    const ctx = tracker.getSnapshotUndoContext();
    expect(ctx.canUndo).toBe(false);
    expect(ctx.summary).toBe('no undo available');
  });

  it('uses declared state verbatim regardless of action history', () => {
    tracker.recordAction(makeAction({ id: 'a1', type: 'press', reversible: false }));
    tracker.setDeclaredState({
      canUndo: true,
      canRedo: true,
      undoDescription: 'Undo "type"',
      redoDescription: 'Redo "type"',
      undoDepth: 3,
      redoDepth: 2,
    });
    const ctx = tracker.getSnapshotUndoContext();
    expect(ctx.canUndo).toBe(true);
    expect(ctx.canRedo).toBe(true);
    expect(ctx.undoDescription).toBe('Undo "type"');
    expect(ctx.redoDescription).toBe('Redo "type"');
    expect(ctx.undoDepth).toBe(3);
    expect(ctx.redoDepth).toBe(2);
    expect(ctx.summary).toBe(`undo: 'Undo "type"' / redo: 'Redo "type"'`);
  });

  it('respects maxHistory and keeps only the most recent N records', () => {
    const small = new UndoTracker({ maxHistory: 3 });
    for (let i = 0; i < 5; i++) {
      small.recordAction(makeAction({ id: `a${i}`, type: 'press' }));
    }
    const history = small.getActionHistory();
    expect(history).toHaveLength(3);
    expect(history.map((a) => a.id)).toEqual(['a2', 'a3', 'a4']);
  });

  it('executeUndo and executeRedo return the not-implemented placeholder', () => {
    expect(tracker.executeUndo()).toEqual({ ok: false, reason: 'Not implemented in native' });
    expect(tracker.executeRedo()).toEqual({ ok: false, reason: 'Not implemented in native' });
  });

  it('clear() empties history AND drops declared state', () => {
    tracker.recordAction(makeAction({ id: 'a1', type: 'press' }));
    tracker.setDeclaredState({ canUndo: true, canRedo: true, undoDescription: 'X' });
    tracker.clear();

    expect(tracker.getActionHistory()).toEqual([]);
    const ctx = tracker.getSnapshotUndoContext();
    expect(ctx.canUndo).toBe(false);
    expect(ctx.canRedo).toBe(false);
    expect(ctx.summary).toBe('no undo available');
  });

  it('getActionHistory returns a copy (mutation does not affect the tracker)', () => {
    tracker.recordAction(makeAction({ id: 'a1', type: 'press' }));
    const copy = tracker.getActionHistory();
    copy.push(makeAction({ id: 'rogue', type: 'press' }));
    expect(tracker.getActionHistory()).toHaveLength(1);
  });
});
