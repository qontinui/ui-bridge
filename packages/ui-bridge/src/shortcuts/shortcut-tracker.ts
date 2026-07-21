/**
 * Shortcut Tracker
 *
 * Discovers keyboard shortcuts by scanning the DOM for aria-keyshortcuts,
 * accesskey, data-shortcut/data-hotkey attributes, and title/tooltip hints.
 * Also accepts developer-registered shortcuts via registerShortcuts().
 *
 * Follows the NavigationTracker pattern — install/uninstall lifecycle,
 * periodic re-scan, and snapshot context generation.
 */

import type {
  KeyboardShortcut,
  ShortcutSource,
  ShortcutTrackerOptions,
  SnapshotShortcutContext,
} from './types';
import { readAriaLabelAttr, readTitleAttr } from '../core/a11y';

/** Canonical modifier order for normalization */
const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const;

/**
 * Source priority for deduplication — higher number wins.
 */
const SOURCE_PRIORITY: Record<ShortcutSource, number> = {
  'title-hint': 1,
  'data-attribute': 2,
  accesskey: 3,
  'aria-keyshortcuts': 4,
  developer: 5,
};

/**
 * Normalize a key combo string to canonical form.
 * Canonical order: Ctrl+Alt+Shift+Meta+<key>
 *
 * Examples:
 *   "shift+ctrl+t" → "Ctrl+Shift+T"
 *   "cmd+s" → "Meta+S"
 *   "Control+Alt+Delete" → "Ctrl+Alt+Delete"
 */
export function normalizeCombo(raw: string): string {
  // Split on + or space (aria-keyshortcuts uses space-separated)
  const parts = raw
    .split(/[+\s]+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const modifiers = new Set<string>();
  let key = '';

  for (const part of parts) {
    const lower = part.toLowerCase();
    switch (lower) {
      case 'ctrl':
      case 'control':
        modifiers.add('Ctrl');
        break;
      case 'alt':
      case 'option':
        modifiers.add('Alt');
        break;
      case 'shift':
        modifiers.add('Shift');
        break;
      case 'meta':
      case 'cmd':
      case 'command':
      case 'super':
      case 'win':
        modifiers.add('Meta');
        break;
      default:
        // Last non-modifier part is the key
        key = part.length === 1 ? part.toUpperCase() : capitalize(part);
        break;
    }
  }

  const orderedMods = MODIFIER_ORDER.filter((m) => modifiers.has(m));
  return [...orderedMods, key].join('+');
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Parse aria-keyshortcuts attribute value.
 * The spec allows multiple shortcuts separated by space, where each shortcut
 * uses "+" to join keys. Example: "Control+S Alt+Shift+S"
 *
 * However, single shortcuts also use space: "Control S" means Ctrl+S.
 * We handle both by trying "+" split first; if no "+", treat as single combo.
 */
function parseAriaKeyShortcuts(value: string): string[] {
  // If it contains "+", split combos by whitespace only when there are multiple combo groups
  // "Control+S" → ["Control+S"]
  // "Control+S Alt+Shift+S" → ["Control+S", "Alt+Shift+S"]
  if (value.includes('+')) {
    return value.split(/\s+/).filter(Boolean);
  }
  // Space-separated single combo: "Control S" → treat as one combo
  return [value];
}

/**
 * Try to extract shortcut hints from title/tooltip text.
 * Matches patterns like: (Ctrl+S), [Ctrl+Shift+T], Ctrl+N
 */
function extractTitleHints(title: string): string[] {
  const results: string[] = [];
  // Simple approach: find patterns like "Ctrl+X", "Cmd+Shift+N" etc.
  const simplePattern =
    /\b(?:Ctrl|Control|Alt|Shift|Meta|Cmd|Command)\s*\+\s*(?:(?:Ctrl|Control|Alt|Shift|Meta|Cmd|Command)\s*\+\s*)*\w+\b/gi;
  let match: RegExpExecArray | null;
  while ((match = simplePattern.exec(title)) !== null) {
    results.push(match[0]);
  }
  return results;
}

/**
 * Map platform accesskey to a user-friendly combo.
 * accesskey="s" → "Alt+Shift+S" on Windows/Linux, "Ctrl+Alt+S" on Mac
 */
function accesskeyToCombo(key: string): string {
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
  if (isMac) {
    return `Ctrl+Alt+${key.toUpperCase()}`;
  }
  return `Alt+Shift+${key.toUpperCase()}`;
}

/**
 * Tracks keyboard shortcuts registered by the application.
 */
export class ShortcutTracker {
  private shortcuts: Map<string, KeyboardShortcut> = new Map();
  private installed = false;
  private observer: MutationObserver | null = null;
  private rescanTimer: ReturnType<typeof setInterval> | null = null;
  private lastScanTimestamp = 0;
  private maxShortcuts: number;
  private scanDOM: boolean;
  private rescanInterval: number;

  constructor(options: ShortcutTrackerOptions = {}) {
    this.scanDOM = options.scanDOM ?? true;
    this.rescanInterval = options.rescanInterval ?? 5000;
    this.maxShortcuts = options.maxShortcuts ?? 200;
  }

  /**
   * Install DOM scanning and observation.
   */
  install(): void {
    if (this.installed) return;
    if (typeof document === 'undefined') return;

    this.installed = true;

    if (this.scanDOM) {
      // Initial scan
      this.scan();

      // Observe DOM for added/changed elements
      this.observer = new MutationObserver(() => {
        this.scan();
      });
      this.observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          'aria-keyshortcuts',
          'accesskey',
          'data-shortcut',
          'data-hotkey',
          'title',
        ],
      });

      // Periodic re-scan for lazy-loaded UI
      if (this.rescanInterval > 0) {
        this.rescanTimer = setInterval(() => this.scan(), this.rescanInterval);
      }
    }
  }

  /**
   * Uninstall all observation and clean up.
   */
  uninstall(): void {
    if (!this.installed) return;

    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    if (this.rescanTimer !== null) {
      clearInterval(this.rescanTimer);
      this.rescanTimer = null;
    }

    this.installed = false;
  }

  // ===========================================================================
  // Public API — Developer Registration
  // ===========================================================================

  /**
   * Register shortcuts from developer code (via useKeyboardShortcuts hook).
   */
  registerShortcuts(shortcuts: KeyboardShortcut[]): void {
    for (const shortcut of shortcuts) {
      const combo = normalizeCombo(shortcut.combo);
      const existing = this.shortcuts.get(combo);

      // Developer source always wins; otherwise higher priority wins
      if (!existing || SOURCE_PRIORITY[shortcut.source] >= SOURCE_PRIORITY[existing.source]) {
        this.shortcuts.set(combo, { ...shortcut, combo });
      }
    }

    this.enforceLimit();
    this.lastScanTimestamp = Date.now();
  }

  /**
   * Remove developer-registered shortcuts by combo string.
   */
  unregisterShortcuts(combos: string[]): void {
    for (const raw of combos) {
      const combo = normalizeCombo(raw);
      const existing = this.shortcuts.get(combo);
      if (existing && existing.source === 'developer') {
        this.shortcuts.delete(combo);
      }
    }
  }

  // ===========================================================================
  // Public API — Read State
  // ===========================================================================

  /**
   * Get all tracked shortcuts.
   */
  getShortcuts(): KeyboardShortcut[] {
    return Array.from(this.shortcuts.values());
  }

  /**
   * Build the SnapshotShortcutContext for inclusion in ControlSnapshot.
   */
  getSnapshotShortcutContext(): SnapshotShortcutContext {
    const shortcuts = this.getShortcuts();
    return {
      shortcuts,
      totalCount: shortcuts.length,
      lastScanTimestamp: this.lastScanTimestamp,
    };
  }

  /**
   * Force a DOM re-scan.
   */
  rescan(): void {
    this.scan();
  }

  // ===========================================================================
  // Internal — DOM Scanning
  // ===========================================================================

  private scan(): void {
    if (typeof document === 'undefined') return;

    // Remove non-developer shortcuts — they'll be re-discovered
    for (const [combo, shortcut] of this.shortcuts) {
      if (shortcut.source !== 'developer') {
        this.shortcuts.delete(combo);
      }
    }

    // 1. aria-keyshortcuts
    this.scanAriaKeyShortcuts();

    // 2. accesskey
    this.scanAccessKeys();

    // 3. data-shortcut / data-hotkey
    this.scanDataAttributes();

    // 4. title hints
    this.scanTitleHints();

    this.enforceLimit();
    this.lastScanTimestamp = Date.now();
  }

  private scanAriaKeyShortcuts(): void {
    const elements = document.querySelectorAll('[aria-keyshortcuts]');
    for (const el of elements) {
      const attr = el.getAttribute('aria-keyshortcuts');
      if (!attr) continue;

      const combos = parseAriaKeyShortcuts(attr);
      for (const raw of combos) {
        const combo = normalizeCombo(raw);
        this.addScanned(combo, 'aria-keyshortcuts', el as HTMLElement);
      }
    }
  }

  private scanAccessKeys(): void {
    const elements = document.querySelectorAll('[accesskey]');
    for (const el of elements) {
      const key = el.getAttribute('accesskey');
      if (!key) continue;

      const combo = accesskeyToCombo(key);
      this.addScanned(combo, 'accesskey', el as HTMLElement);
    }
  }

  private scanDataAttributes(): void {
    const elements = document.querySelectorAll('[data-shortcut], [data-hotkey]');
    for (const el of elements) {
      const attr = el.getAttribute('data-shortcut') || el.getAttribute('data-hotkey');
      if (!attr) continue;

      const combo = normalizeCombo(attr);
      this.addScanned(combo, 'data-attribute', el as HTMLElement);
    }
  }

  private scanTitleHints(): void {
    const elements = document.querySelectorAll('[title]');
    for (const el of elements) {
      const title = readTitleAttr(el);
      if (!title) continue;

      const hints = extractTitleHints(title);
      for (const raw of hints) {
        const combo = normalizeCombo(raw);
        this.addScanned(combo, 'title-hint', el as HTMLElement);
      }
    }
  }

  private addScanned(combo: string, source: ShortcutSource, el: HTMLElement): void {
    const existing = this.shortcuts.get(combo);
    if (existing && SOURCE_PRIORITY[existing.source] > SOURCE_PRIORITY[source]) {
      return; // Existing has higher priority
    }

    const description = this.inferDescription(el);
    const elementId = el.getAttribute('data-testid') || el.getAttribute('id') || undefined;

    this.shortcuts.set(combo, {
      combo,
      description,
      elementId,
      source,
    });
  }

  private inferDescription(el: HTMLElement): string | undefined {
    // Try aria-label, then textContent, then title (without the shortcut part)
    const ariaLabel = readAriaLabelAttr(el);
    if (ariaLabel) return ariaLabel;

    const text = el.textContent?.trim();
    if (text && text.length > 0 && text.length < 100) return text;

    return undefined;
  }

  private enforceLimit(): void {
    if (this.shortcuts.size <= this.maxShortcuts) return;

    // Remove lowest-priority shortcuts first
    const sorted = Array.from(this.shortcuts.entries()).sort(
      ([, a], [, b]) => SOURCE_PRIORITY[b.source] - SOURCE_PRIORITY[a.source]
    );

    this.shortcuts.clear();
    for (const [combo, shortcut] of sorted.slice(0, this.maxShortcuts)) {
      this.shortcuts.set(combo, shortcut);
    }
  }
}
