/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UndoDetector } from '../undo-detector';

describe('UndoDetector', () => {
  let detector: UndoDetector;

  beforeEach(() => {
    detector = new UndoDetector();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  // -----------------------------------------------------------------------
  // Basic detection
  // -----------------------------------------------------------------------

  describe('detect', () => {
    it('returns empty result when no undo/redo elements exist', () => {
      const result = detector.detect();

      expect(result.undoElement).toBeUndefined();
      expect(result.redoElement).toBeUndefined();
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it('detects undo button by aria-label', () => {
      document.body.innerHTML = '<button aria-label="Undo">↩</button>';

      const result = detector.detect();

      expect(result.undoElement).toBeDefined();
      expect(result.undoElement!.enabled).toBe(true);
      expect(result.undoElement!.label).toBe('Undo');
    });

    it('detects redo button by aria-label', () => {
      document.body.innerHTML = '<button aria-label="Redo">↪</button>';

      const result = detector.detect();

      expect(result.redoElement).toBeDefined();
      expect(result.redoElement!.enabled).toBe(true);
      expect(result.redoElement!.label).toBe('Redo');
    });

    it('detects disabled undo button', () => {
      document.body.innerHTML = '<button aria-label="Undo" disabled>↩</button>';

      const result = detector.detect();

      expect(result.undoElement).toBeDefined();
      expect(result.undoElement!.enabled).toBe(false);
    });

    it('detects aria-disabled undo button', () => {
      document.body.innerHTML = '<button aria-label="Undo" aria-disabled="true">↩</button>';

      const result = detector.detect();

      expect(result.undoElement).toBeDefined();
      expect(result.undoElement!.enabled).toBe(false);
    });

    it('detects undo by title attribute', () => {
      document.body.innerHTML = '<button title="Undo (Ctrl+Z)">↩</button>';

      const result = detector.detect();

      expect(result.undoElement).toBeDefined();
      expect(result.undoElement!.label).toBe('Undo (Ctrl+Z)');
    });

    it('detects undo by data-action attribute', () => {
      document.body.innerHTML = '<button data-action="undo">↩</button>';

      const result = detector.detect();

      expect(result.undoElement).toBeDefined();
      expect(result.undoElement!.enabled).toBe(true);
    });

    it('detects undo by data-command attribute', () => {
      document.body.innerHTML = '<button data-command="undo">↩</button>';

      const result = detector.detect();

      expect(result.undoElement).toBeDefined();
    });

    it('detects undo menu item by role', () => {
      document.body.innerHTML = '<div role="menuitem" aria-label="Undo Typing">Undo Typing</div>';

      const result = detector.detect();

      expect(result.undoElement).toBeDefined();
      expect(result.undoElement!.label).toBe('Undo Typing');
      expect(result.undoElement!.parsedDescription).toBe('Typing');
    });

    it('detects both undo and redo', () => {
      document.body.innerHTML = `
        <button aria-label="Undo">↩</button>
        <button aria-label="Redo">↪</button>
      `;

      const result = detector.detect();

      expect(result.undoElement).toBeDefined();
      expect(result.redoElement).toBeDefined();
    });

    it('parses description from "Undo Typing" label', () => {
      document.body.innerHTML = '<button aria-label="Undo Typing">↩</button>';

      const result = detector.detect();

      expect(result.undoElement!.parsedDescription).toBe('Typing');
    });

    it('parses description from "Redo Delete" label', () => {
      document.body.innerHTML = '<button aria-label="Redo Delete">↪</button>';

      const result = detector.detect();

      expect(result.redoElement!.parsedDescription).toBe('Delete');
    });

    it('detects undo button by text content', () => {
      document.body.innerHTML = '<button>Undo</button>';

      const result = detector.detect();

      expect(result.undoElement).toBeDefined();
      expect(result.undoElement!.label).toBe('Undo');
    });

    it('detects redo button by text content', () => {
      document.body.innerHTML = '<button>Redo</button>';

      const result = detector.detect();

      expect(result.redoElement).toBeDefined();
      expect(result.redoElement!.label).toBe('Redo');
    });
  });

  // -----------------------------------------------------------------------
  // Custom selectors
  // -----------------------------------------------------------------------

  describe('custom selectors', () => {
    it('detects undo via custom selector', () => {
      detector = new UndoDetector({
        customUndoSelectors: ['.my-undo-btn'],
      });

      document.body.innerHTML = '<button class="my-undo-btn">↩</button>';

      const result = detector.detect();

      expect(result.undoElement).toBeDefined();
    });

    it('detects redo via custom selector', () => {
      detector = new UndoDetector({
        customRedoSelectors: ['.my-redo-btn'],
      });

      document.body.innerHTML = '<button class="my-redo-btn">↪</button>';

      const result = detector.detect();

      expect(result.redoElement).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // execCommand probe
  // -----------------------------------------------------------------------

  describe('execCommand', () => {
    it('probes execCommand when enabled', () => {
      const result = detector.detect();

      // jsdom may or may not support queryCommandEnabled
      expect(typeof result.execCommandUndo).toBe('boolean');
      expect(typeof result.execCommandRedo).toBe('boolean');
    });

    it('skips execCommand when disabled', () => {
      detector = new UndoDetector({ useExecCommand: false });

      const result = detector.detect();

      expect(result.execCommandUndo).toBe(false);
      expect(result.execCommandRedo).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Deduplication
  // -----------------------------------------------------------------------

  describe('deduplication', () => {
    it('does not duplicate elements matched by multiple selectors', () => {
      document.body.innerHTML =
        '<button aria-label="Undo" data-action="undo" data-testid="undo-btn">↩</button>';

      const result = detector.detect();

      // Should find exactly one undo element, not multiple
      expect(result.undoElement).toBeDefined();
      expect(result.undoElement!.selector).toContain('undo-btn');
    });
  });

  // -----------------------------------------------------------------------
  // Selector building
  // -----------------------------------------------------------------------

  describe('selector building', () => {
    it('uses id-based selector when element has id', () => {
      document.body.innerHTML = '<button id="undo-btn" aria-label="Undo">↩</button>';

      const result = detector.detect();

      expect(result.undoElement!.selector).toBe('#undo-btn');
    });

    it('uses data-testid selector when available', () => {
      document.body.innerHTML = '<button data-testid="undo" aria-label="Undo">↩</button>';

      const result = detector.detect();

      expect(result.undoElement!.selector).toBe('[data-testid="undo"]');
    });
  });
});
