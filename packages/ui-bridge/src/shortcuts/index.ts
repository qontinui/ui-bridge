/**
 * Shortcuts Module
 *
 * Provides keyboard shortcut discovery for the UI Bridge:
 * - Automatic DOM scanning for aria-keyshortcuts, accesskey, data-shortcut, title hints
 * - Developer-provided shortcut registration via useKeyboardShortcuts hook
 */

export { ShortcutTracker, normalizeCombo } from './shortcut-tracker';
export type {
  KeyboardShortcut,
  ShortcutSource,
  ShortcutTrackerOptions,
  SnapshotShortcutContext,
} from './types';
