import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ShortcutTracker, normalizeCombo } from '../shortcut-tracker';

describe('normalizeCombo', () => {
  it('normalizes modifier order to Ctrl+Alt+Shift+Meta', () => {
    expect(normalizeCombo('Shift+Ctrl+T')).toBe('Ctrl+Shift+T');
    expect(normalizeCombo('Alt+Shift+Ctrl+N')).toBe('Ctrl+Alt+Shift+N');
    expect(normalizeCombo('Meta+Ctrl+S')).toBe('Ctrl+Meta+S');
  });

  it('normalizes case', () => {
    expect(normalizeCombo('ctrl+shift+t')).toBe('Ctrl+Shift+T');
    expect(normalizeCombo('CTRL+S')).toBe('Ctrl+S');
  });

  it('maps Cmd/Command to Meta', () => {
    expect(normalizeCombo('Cmd+S')).toBe('Meta+S');
    expect(normalizeCombo('Command+Shift+N')).toBe('Shift+Meta+N');
  });

  it('maps Control to Ctrl', () => {
    expect(normalizeCombo('Control+S')).toBe('Ctrl+S');
  });

  it('handles single keys', () => {
    expect(normalizeCombo('Escape')).toBe('Escape');
    expect(normalizeCombo('F1')).toBe('F1');
  });

  it('handles space-separated (aria-keyshortcuts format)', () => {
    expect(normalizeCombo('Control S')).toBe('Ctrl+S');
  });
});

describe('ShortcutTracker', () => {
  let tracker: ShortcutTracker;

  beforeEach(() => {
    tracker = new ShortcutTracker({ scanDOM: false });
  });

  afterEach(() => {
    tracker.uninstall();
  });

  describe('developer registration', () => {
    it('registers and returns shortcuts', () => {
      tracker.registerShortcuts([
        { combo: 'Ctrl+S', description: 'Save', source: 'developer' },
        { combo: 'Ctrl+Shift+N', description: 'New file', source: 'developer' },
      ]);

      const shortcuts = tracker.getShortcuts();
      expect(shortcuts).toHaveLength(2);
      expect(shortcuts.find((s) => s.combo === 'Ctrl+S')).toBeTruthy();
      expect(shortcuts.find((s) => s.combo === 'Ctrl+Shift+N')).toBeTruthy();
    });

    it('normalizes combo on registration', () => {
      tracker.registerShortcuts([
        { combo: 'shift+ctrl+t', description: 'Test', source: 'developer' },
      ]);

      const shortcuts = tracker.getShortcuts();
      expect(shortcuts[0].combo).toBe('Ctrl+Shift+T');
    });

    it('deduplicates by combo', () => {
      tracker.registerShortcuts([{ combo: 'Ctrl+S', description: 'Save v1', source: 'developer' }]);
      tracker.registerShortcuts([{ combo: 'Ctrl+S', description: 'Save v2', source: 'developer' }]);

      const shortcuts = tracker.getShortcuts();
      expect(shortcuts).toHaveLength(1);
      expect(shortcuts[0].description).toBe('Save v2');
    });

    it('unregisters developer shortcuts', () => {
      tracker.registerShortcuts([
        { combo: 'Ctrl+S', description: 'Save', source: 'developer' },
        { combo: 'Ctrl+N', description: 'New', source: 'developer' },
      ]);

      tracker.unregisterShortcuts(['Ctrl+S']);

      const shortcuts = tracker.getShortcuts();
      expect(shortcuts).toHaveLength(1);
      expect(shortcuts[0].combo).toBe('Ctrl+N');
    });

    it('only unregisters developer-sourced shortcuts', () => {
      // Simulate a scanned shortcut by registering with a non-developer source
      tracker.registerShortcuts([
        { combo: 'Ctrl+S', description: 'Save', source: 'aria-keyshortcuts' },
      ]);

      tracker.unregisterShortcuts(['Ctrl+S']);

      // Should NOT be removed since source is not 'developer'
      const shortcuts = tracker.getShortcuts();
      expect(shortcuts).toHaveLength(1);
    });
  });

  describe('source priority', () => {
    it('developer overrides aria-keyshortcuts', () => {
      tracker.registerShortcuts([
        { combo: 'Ctrl+S', description: 'From ARIA', source: 'aria-keyshortcuts' },
      ]);
      tracker.registerShortcuts([
        { combo: 'Ctrl+S', description: 'From Dev', source: 'developer' },
      ]);

      const shortcuts = tracker.getShortcuts();
      expect(shortcuts[0].description).toBe('From Dev');
    });

    it('aria-keyshortcuts overrides title-hint', () => {
      tracker.registerShortcuts([
        { combo: 'Ctrl+S', description: 'From Title', source: 'title-hint' },
      ]);
      tracker.registerShortcuts([
        { combo: 'Ctrl+S', description: 'From ARIA', source: 'aria-keyshortcuts' },
      ]);

      const shortcuts = tracker.getShortcuts();
      expect(shortcuts[0].description).toBe('From ARIA');
    });

    it('lower priority does not overwrite higher', () => {
      tracker.registerShortcuts([
        { combo: 'Ctrl+S', description: 'From Dev', source: 'developer' },
      ]);
      tracker.registerShortcuts([
        { combo: 'Ctrl+S', description: 'From Title', source: 'title-hint' },
      ]);

      const shortcuts = tracker.getShortcuts();
      expect(shortcuts[0].description).toBe('From Dev');
    });
  });

  describe('maxShortcuts', () => {
    it('enforces the limit', () => {
      const small = new ShortcutTracker({ scanDOM: false, maxShortcuts: 3 });

      small.registerShortcuts(
        Array.from({ length: 5 }, (_, i) => ({
          combo: `Ctrl+${String.fromCharCode(65 + i)}`,
          description: `Shortcut ${i}`,
          source: 'developer' as const,
        }))
      );

      expect(small.getShortcuts()).toHaveLength(3);
    });
  });

  describe('getSnapshotShortcutContext', () => {
    it('returns proper structure', () => {
      tracker.registerShortcuts([{ combo: 'Ctrl+S', description: 'Save', source: 'developer' }]);

      const ctx = tracker.getSnapshotShortcutContext();
      expect(ctx.shortcuts).toHaveLength(1);
      expect(ctx.totalCount).toBe(1);
      expect(ctx.lastScanTimestamp).toBeGreaterThan(0);
    });

    it('returns empty when no shortcuts', () => {
      const ctx = tracker.getSnapshotShortcutContext();
      expect(ctx.shortcuts).toHaveLength(0);
      expect(ctx.totalCount).toBe(0);
    });
  });

  describe('DOM scanning', () => {
    let domTracker: ShortcutTracker;

    beforeEach(() => {
      domTracker = new ShortcutTracker({ scanDOM: true, rescanInterval: 0 });
    });

    afterEach(() => {
      domTracker.uninstall();
      // Clean up any test elements
      document.querySelectorAll('[data-test-shortcut]').forEach((el) => el.remove());
    });

    it('scans aria-keyshortcuts attributes', () => {
      const btn = document.createElement('button');
      btn.setAttribute('aria-keyshortcuts', 'Control+S');
      btn.setAttribute('aria-label', 'Save');
      btn.setAttribute('data-test-shortcut', '');
      document.body.appendChild(btn);

      domTracker.install();

      const shortcuts = domTracker.getShortcuts();
      expect(shortcuts.find((s) => s.combo === 'Ctrl+S')).toBeTruthy();
      expect(shortcuts.find((s) => s.combo === 'Ctrl+S')?.source).toBe('aria-keyshortcuts');
      expect(shortcuts.find((s) => s.combo === 'Ctrl+S')?.description).toBe('Save');
    });

    it('scans accesskey attributes', () => {
      const link = document.createElement('a');
      link.setAttribute('accesskey', 'h');
      link.textContent = 'Home';
      link.setAttribute('data-test-shortcut', '');
      document.body.appendChild(link);

      domTracker.install();

      const shortcuts = domTracker.getShortcuts();
      // accesskey maps to Alt+Shift+H on non-Mac
      const found = shortcuts.find((s) => s.combo.includes('+H'));
      expect(found).toBeTruthy();
      expect(found?.source).toBe('accesskey');
    });

    it('scans data-shortcut attributes', () => {
      const btn = document.createElement('button');
      btn.setAttribute('data-shortcut', 'Ctrl+Shift+T');
      btn.textContent = 'New Terminal';
      btn.setAttribute('data-test-shortcut', '');
      document.body.appendChild(btn);

      domTracker.install();

      const shortcuts = domTracker.getShortcuts();
      const found = shortcuts.find((s) => s.combo === 'Ctrl+Shift+T');
      expect(found).toBeTruthy();
      expect(found?.source).toBe('data-attribute');
      expect(found?.description).toBe('New Terminal');
    });

    it('scans data-hotkey attributes', () => {
      const btn = document.createElement('button');
      btn.setAttribute('data-hotkey', 'Ctrl+K');
      btn.setAttribute('aria-label', 'Command Palette');
      btn.setAttribute('data-test-shortcut', '');
      document.body.appendChild(btn);

      domTracker.install();

      const shortcuts = domTracker.getShortcuts();
      const found = shortcuts.find((s) => s.combo === 'Ctrl+K');
      expect(found).toBeTruthy();
      expect(found?.description).toBe('Command Palette');
    });

    it('extracts shortcuts from title attributes', () => {
      const btn = document.createElement('button');
      btn.setAttribute('title', 'Save file (Ctrl+S)');
      btn.setAttribute('data-test-shortcut', '');
      document.body.appendChild(btn);

      domTracker.install();

      const shortcuts = domTracker.getShortcuts();
      const found = shortcuts.find((s) => s.combo === 'Ctrl+S');
      expect(found).toBeTruthy();
      expect(found?.source).toBe('title-hint');
    });

    it('picks up dynamically added elements via MutationObserver', async () => {
      domTracker.install();

      // Initially no shortcuts
      expect(domTracker.getShortcuts()).toHaveLength(0);

      // Add element dynamically
      const btn = document.createElement('button');
      btn.setAttribute('aria-keyshortcuts', 'Control+D');
      btn.setAttribute('aria-label', 'Delete');
      btn.setAttribute('data-test-shortcut', '');
      document.body.appendChild(btn);

      // MutationObserver is async — wait for microtask
      await new Promise((r) => setTimeout(r, 50));

      const shortcuts = domTracker.getShortcuts();
      expect(shortcuts.find((s) => s.combo === 'Ctrl+D')).toBeTruthy();
    });

    it('uses element testId or id for elementId', () => {
      const btn = document.createElement('button');
      btn.setAttribute('data-shortcut', 'Ctrl+P');
      btn.setAttribute('data-testid', 'print-button');
      btn.setAttribute('data-test-shortcut', '');
      document.body.appendChild(btn);

      domTracker.install();

      const found = domTracker.getShortcuts().find((s) => s.combo === 'Ctrl+P');
      expect(found?.elementId).toBe('print-button');
    });
  });

  describe('install / uninstall lifecycle', () => {
    it('is idempotent — double install does not break', () => {
      tracker.install();
      tracker.install();
      // Should not throw
      tracker.uninstall();
    });

    it('stops observing after uninstall', async () => {
      const domTracker = new ShortcutTracker({ scanDOM: true, rescanInterval: 0 });
      domTracker.install();
      domTracker.uninstall();

      const btn = document.createElement('button');
      btn.setAttribute('aria-keyshortcuts', 'Control+Z');
      btn.setAttribute('data-test-shortcut', '');
      document.body.appendChild(btn);

      await new Promise((r) => setTimeout(r, 50));

      // Should not have picked up the new element
      expect(domTracker.getShortcuts().find((s) => s.combo === 'Ctrl+Z')).toBeUndefined();

      btn.remove();
    });
  });
});
