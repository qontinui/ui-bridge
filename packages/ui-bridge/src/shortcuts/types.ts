/**
 * Keyboard Shortcut Discovery Types
 *
 * Types for tracking keyboard shortcuts registered by the application,
 * enabling AI agents to use shortcuts for faster automation.
 */

// ============================================================================
// Shortcut Definition
// ============================================================================

/**
 * How a shortcut was discovered
 */
export type ShortcutSource =
  | 'aria-keyshortcuts'
  | 'accesskey'
  | 'title-hint'
  | 'data-attribute'
  | 'developer';

/**
 * A single keyboard shortcut
 */
export interface KeyboardShortcut {
  /** Normalized key combo: "Ctrl+Shift+T", "Alt+N", "Escape" */
  combo: string;
  /** What the shortcut does (human-readable) */
  description?: string;
  /** Associated element ID in the bridge registry */
  elementId?: string;
  /** How this shortcut was discovered */
  source: ShortcutSource;
  /** Scope/context where this shortcut works (e.g., "global", "editor") */
  scope?: string;
}

// ============================================================================
// Tracker Options
// ============================================================================

/**
 * Configuration for ShortcutTracker
 */
export interface ShortcutTrackerOptions {
  /** Scan DOM for aria-keyshortcuts, accesskey, title hints (default: true) */
  scanDOM?: boolean;
  /** Interval (ms) for periodic DOM re-scan (default: 5000, 0 = disable) */
  rescanInterval?: number;
  /** Maximum shortcuts to track (default: 200) */
  maxShortcuts?: number;
}

// ============================================================================
// Snapshot Context
// ============================================================================

/**
 * Context included in ControlSnapshot.shortcuts
 */
export interface SnapshotShortcutContext {
  /** All discovered shortcuts */
  shortcuts: KeyboardShortcut[];
  /** Total count */
  totalCount: number;
  /** When the last scan/update occurred */
  lastScanTimestamp: number;
}
