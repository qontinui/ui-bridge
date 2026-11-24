/**
 * Toast/Notification Detection Types
 *
 * Types for capturing and tracking transient toast notifications.
 */

/**
 * Severity level of a toast notification
 */
export type ToastLevel = 'info' | 'success' | 'warning' | 'error' | 'loading' | 'unknown';

/**
 * A captured toast notification
 */
export interface CapturedToast {
  /** Unique identifier */
  id: string;
  /** Toast message text */
  message: string;
  /** Severity level */
  level: ToastLevel;
  /** When the toast appeared (ms since epoch) */
  appearedAt: number;
  /** When the toast was dismissed (ms since epoch), if observed */
  dismissedAt?: number;
  /** Whether the toast is currently visible */
  visible: boolean;
  /** How long the toast was/has been visible (ms) */
  durationMs: number;
  /** Source library if detectable */
  source?: string;
  /** Whether toast has an action button */
  hasAction?: boolean;
  /** Action button text if present */
  actionText?: string;
}

/**
 * Snapshot of toast state
 */
export interface ToastSnapshot {
  /** Currently visible toasts */
  active: CapturedToast[];
  /** Recently dismissed toasts (ring buffer) */
  recent: CapturedToast[];
  /** Total toasts captured since install */
  totalCaptured: number;
}

/**
 * Snapshot context for ControlSnapshot integration
 */
export interface SnapshotToastContext {
  /** Currently visible toasts */
  active: CapturedToast[];
  /** Recently dismissed toasts */
  recent: CapturedToast[];
  /** Total captured since tracking began */
  totalCaptured: number;
}

/**
 * Configuration for toast capture
 */
export interface ToastCaptureConfig {
  /** Maximum number of recent toasts to keep (default: 20) */
  maxRecent?: number;
  /** Additional CSS selectors to watch for toasts */
  customSelectors?: string[];
  /** How long a dismissed toast stays in recent buffer (ms, default: 60000) */
  recentRetention?: number;
  /** Polling interval for dismissal detection (ms, default: 500) */
  pollInterval?: number;
  /**
   * Maximum age before a still-visible "toast" is auto-dismissed (ms, default: 60000).
   * Defense-in-depth against greedy selectors capturing persistent UI surfaces
   * (status bars, banners, sticky modals) and tracking them indefinitely.
   */
  maxToastAgeMs?: number;
  /**
   * Per-element announcement budget (default: 4). One element (a live region
   * whose text changes often — a timer, a progress count) is captured at most
   * this many times within `announcementWindowMs`. The capture that would
   * exceed it is withheld: the element's entry leaves `active`, it is
   * suppressed, and its further changes are absorbed silently until it has
   * been unchanged for `announcementWindowMs`; its settled text, if not empty,
   * is then announced once. A re-keyed element is the same element: a new
   * node on the same `id` / `data-testid` continues a warm budget whose
   * previous node is gone (a framework that replaces the node on every tick,
   * e.g. React `key={count}`, is held to the same bound); a second connected
   * node on that id has its own budget, and an element with neither attribute
   * is budgeted per node. A value below 1 is clamped to 1 and a fraction is
   * rounded down. There is no unlimited setting, by design (the budget is
   * tuned, not switched off): `Infinity`, `NaN` or any other non-finite value
   * means the default.
   */
  maxAnnouncementsPerWindow?: number;
  /**
   * Window of the per-element announcement budget, and the quiet period that
   * releases a suppressed element (ms, default: 10000). There is no setting
   * that disables the budget: a value below 1 ms, `Infinity`, `NaN` or any
   * other non-finite value means the default.
   */
  announcementWindowMs?: number;
}

/**
 * Toast event data for bridge events
 */
export interface ToastEventData {
  /** The toast that appeared or was dismissed */
  toast: CapturedToast;
  /** Event type */
  action: 'appeared' | 'dismissed';
}
