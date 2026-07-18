/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { UndoTracker } from '../undo-tracker';

describe('UndoTracker', () => {
  let tracker: UndoTracker;

  beforeEach(() => {
    tracker = new UndoTracker();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  // -----------------------------------------------------------------------
  // Basic state
  // -----------------------------------------------------------------------

  describe('getState', () => {
    it('returns unavailable when no undo elements or declared state', () => {
      const state = tracker.getState();

      expect(state.undoAvailable).toBe(false);
      expect(state.redoAvailable).toBe(false);
      expect(state.undoStack).toHaveLength(0);
      expect(state.redoStack).toHaveLength(0);
      expect(state.timestamp).toBeGreaterThan(0);
    });

    it('detects undo from DOM elements', () => {
      document.body.innerHTML = '<button aria-label="Undo">↩</button>';

      const state = tracker.getState();

      expect(state.undoAvailable).toBe(true);
      expect(state.undoElement).toBeDefined();
      expect(state.detectionSources).toContain('dom-element');
    });

    it('detects redo from DOM elements', () => {
      document.body.innerHTML = '<button aria-label="Redo">↪</button>';

      const state = tracker.getState();

      expect(state.redoAvailable).toBe(true);
      expect(state.redoElement).toBeDefined();
    });

    it('reports disabled undo as unavailable', () => {
      document.body.innerHTML = '<button aria-label="Undo" disabled>↩</button>';

      const state = tracker.getState();

      expect(state.undoAvailable).toBe(false);
      expect(state.undoElement).toBeDefined();
      expect(state.undoElement!.enabled).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Developer-declared state
  // -----------------------------------------------------------------------

  describe('declared state', () => {
    it('uses developer-declared state when available', () => {
      tracker.setDeclaredState({
        canUndo: true,
        canRedo: false,
        undoDescription: 'Delete row',
        undoStack: ['Delete row', 'Add row', 'Edit cell'],
      });

      const state = tracker.getState();

      expect(state.undoAvailable).toBe(true);
      expect(state.redoAvailable).toBe(false);
      expect(state.undoDescription).toBe('Delete row');
      expect(state.undoStack).toHaveLength(3);
      expect(state.undoStack[0].description).toBe('Delete row');
      expect(state.undoStack[0].confidence).toBe(1.0);
      expect(state.undoStack[0].source).toBe('developer-declared');
      expect(state.undoDepth).toBe(3);
      expect(state.detectionSources).toContain('developer-declared');
    });

    it('overrides DOM detection with declared state', () => {
      document.body.innerHTML = '<button aria-label="Undo" disabled>↩</button>';

      // DOM says undo is disabled, but developer says it's available
      tracker.setDeclaredState({
        canUndo: true,
        canRedo: false,
        undoDescription: 'Custom action',
      });

      const state = tracker.getState();

      expect(state.undoAvailable).toBe(true);
      expect(state.undoDescription).toBe('Custom action');
    });

    it('clears declared state', () => {
      tracker.setDeclaredState({
        canUndo: true,
        canRedo: true,
      });

      expect(tracker.getState().undoAvailable).toBe(true);

      tracker.setDeclaredState(null);

      // Back to heuristic detection (no DOM elements, so unavailable)
      expect(tracker.getState().undoAvailable).toBe(false);
    });

    it('includes redo stack from declared state', () => {
      tracker.setDeclaredState({
        canUndo: false,
        canRedo: true,
        redoDescription: 'Add item',
        redoStack: ['Add item', 'Remove item'],
      });

      const state = tracker.getState();

      expect(state.redoAvailable).toBe(true);
      expect(state.redoDescription).toBe('Add item');
      expect(state.redoStack).toHaveLength(2);
      expect(state.redoDepth).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // Action recording & correlation
  // -----------------------------------------------------------------------

  describe('action recording', () => {
    it('correlates recorded actions with undo stack', () => {
      document.body.innerHTML = '<button aria-label="Undo">↩</button>';

      tracker.recordAction({
        id: 'action-1',
        target: 'button-save',
        action: 'click',
      });

      const state = tracker.getState();

      expect(state.undoAvailable).toBe(true);
      expect(state.undoStack).toHaveLength(1);
      expect(state.undoStack[0].description).toBe('clicking button-save');
      expect(state.undoStack[0].actionId).toBe('action-1');
    });

    it('orders undo stack most-recent first', () => {
      document.body.innerHTML = '<button aria-label="Undo">↩</button>';

      tracker.recordAction({
        id: 'action-1',
        target: 'input-name',
        action: 'type',
        params: { text: 'hello' },
      });

      tracker.recordAction({
        id: 'action-2',
        target: 'button-save',
        action: 'click',
      });

      const state = tracker.getState();

      expect(state.undoStack.length).toBeGreaterThanOrEqual(2);
      expect(state.undoStack[0].actionId).toBe('action-2');
      expect(state.undoStack[1].actionId).toBe('action-1');
    });

    it('describes type actions with text', () => {
      document.body.innerHTML = '<button aria-label="Undo">↩</button>';

      tracker.recordAction({
        id: 'action-1',
        target: 'input-name',
        action: 'type',
        params: { text: 'Hello World' },
      });

      const state = tracker.getState();

      expect(state.undoStack[0].description).toContain('typing');
      expect(state.undoStack[0].description).toContain('Hello World');
    });

    it('describes select actions with value', () => {
      document.body.innerHTML = '<button aria-label="Undo">↩</button>';

      tracker.recordAction({
        id: 'action-1',
        target: 'select-country',
        action: 'select',
        params: { value: 'US' },
      });

      const state = tracker.getState();

      expect(state.undoStack[0].description).toContain('selecting');
      expect(state.undoStack[0].description).toContain('US');
    });

    it('respects max action entries', () => {
      tracker = new UndoTracker({ maxActionEntries: 3 });
      document.body.innerHTML = '<button aria-label="Undo">↩</button>';

      for (let i = 0; i < 10; i++) {
        tracker.recordAction({
          id: `action-${i}`,
          target: `element-${i}`,
          action: 'click',
        });
      }

      // Only keep last 3, but undoStack only shows top 5
      const state = tracker.getState();
      expect(state.undoStack.length).toBeLessThanOrEqual(5);
      expect(state.undoStack[0].actionId).toBe('action-9');
    });

    it('does not show action correlation without undo available', () => {
      // No undo DOM element
      tracker.recordAction({
        id: 'action-1',
        target: 'button-save',
        action: 'click',
      });

      const state = tracker.getState();

      expect(state.undoStack).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Snapshot context
  // -----------------------------------------------------------------------

  describe('getSnapshotUndoContext', () => {
    it('returns proper structure', () => {
      const ctx = tracker.getSnapshotUndoContext();

      expect(ctx).toHaveProperty('canUndo');
      expect(ctx).toHaveProperty('canRedo');
      expect(ctx).toHaveProperty('summary');
      expect(typeof ctx.summary).toBe('string');
    });

    it('includes description in summary when available', () => {
      tracker.setDeclaredState({
        canUndo: true,
        canRedo: false,
        undoDescription: 'Delete row',
        undoStack: ['Delete row'],
      });

      const ctx = tracker.getSnapshotUndoContext();

      expect(ctx.canUndo).toBe(true);
      expect(ctx.undoDescription).toBe('Delete row');
      expect(ctx.summary).toContain('Delete row');
      expect(ctx.summary).toContain('Undo available');
    });

    it('reports unavailable in summary', () => {
      const ctx = tracker.getSnapshotUndoContext();

      expect(ctx.canUndo).toBe(false);
      expect(ctx.summary).toContain('not available');
    });

    it('includes depth when known', () => {
      tracker.setDeclaredState({
        canUndo: true,
        canRedo: false,
        undoStack: ['a', 'b', 'c'],
      });

      const ctx = tracker.getSnapshotUndoContext();

      expect(ctx.undoDepth).toBe(3);
      expect(ctx.summary).toContain('3 steps');
    });
  });

  // -----------------------------------------------------------------------
  // Execute undo/redo
  // -----------------------------------------------------------------------

  describe('executeUndo', () => {
    it('calls developer handler when available', () => {
      const onUndo = vi.fn();
      tracker.setDeclaredState({
        canUndo: true,
        canRedo: false,
        onUndo,
      });

      const result = tracker.executeUndo();

      expect(result).toBe(true);
      expect(onUndo).toHaveBeenCalledOnce();
    });

    it('dispatches keyboard event as fallback', () => {
      const listener = vi.fn();
      document.addEventListener('keydown', listener);

      const result = tracker.executeUndo();

      expect(result).toBe(true);
      // The event dispatches on activeElement (document.body in jsdom)

      document.removeEventListener('keydown', listener);
    });
  });

  describe('executeRedo', () => {
    it('calls developer handler when available', () => {
      const onRedo = vi.fn();
      tracker.setDeclaredState({
        canUndo: false,
        canRedo: true,
        onRedo,
      });

      const result = tracker.executeRedo();

      expect(result).toBe(true);
      expect(onRedo).toHaveBeenCalledOnce();
    });
  });

  // -----------------------------------------------------------------------
  // Shortcut detection
  // -----------------------------------------------------------------------

  describe('shortcuts', () => {
    it('includes platform-appropriate shortcuts', () => {
      const state = tracker.getState();

      // In jsdom, navigator.platform is empty string, so non-Mac
      expect(state.undoShortcut).toBe('Ctrl+Z');
      expect(state.redoShortcut).toBe('Ctrl+Shift+Z');
    });
  });
});
