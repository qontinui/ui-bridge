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
