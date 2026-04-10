/**
 * Navigation / Page-Route Awareness Types
 *
 * Types for tracking page navigation state, route information,
 * and navigation history within the UI Bridge.
 */

// ============================================================================
// Navigation Entry (History Tracking)
// ============================================================================

/**
 * How a navigation was triggered
 */
export type NavigationTrigger = 'push' | 'replace' | 'pop' | 'initial' | 'hash';

/**
 * A single navigation event in the history buffer
 */
export interface PageNavigationEntry {
  /** URL navigated from (empty for initial load) */
  from: string;
  /** URL navigated to */
  to: string;
  /** How the navigation was triggered */
  trigger: NavigationTrigger;
  /** Timestamp of the navigation */
  timestamp: number;
}

// ============================================================================
// Page Info (Current State)
// ============================================================================

/**
 * Current page information extracted from the browser
 */
export interface PageInfo {
  /** Full URL (window.location.href) */
  url: string;
  /** Pathname only (window.location.pathname) */
  pathname: string;
  /** Query string including ? (window.location.search) */
  search: string;
  /** Hash fragment including # (window.location.hash) */
  hash: string;
  /** Document title */
  title: string;
}

// ============================================================================
// Developer-Provided Page Context
// ============================================================================

/**
 * Structured route information provided by framework router integration
 */
export interface RouteInfo {
  /** Route pattern (e.g., "/tasks/:id") */
  pattern?: string;
  /** Extracted route parameters (e.g., { id: "123" }) */
  params?: Record<string, string>;
  /** Query parameters as key-value pairs */
  queryParams?: Record<string, string>;
  /** Matched route stack / breadcrumb (e.g., ["/", "/tasks", "/tasks/:id"]) */
  routeStack?: string[];
}

/**
 * Semantic page context provided by developers via usePageContext()
 */
export interface DeveloperPageContext {
  /** Semantic page name (e.g., "Task Detail", "Dashboard") */
  name: string;
  /** Application section/area (e.g., "tasks", "settings", "admin") */
  section?: string;
  /** Breadcrumb trail (e.g., ["Tasks", "Task #123"]) */
  breadcrumb?: string[];
  /** Arbitrary metadata */
  meta?: Record<string, unknown>;
}

// ============================================================================
// Snapshot Page Context (Combined Output)
// ============================================================================

/**
 * Full page context included in ControlSnapshot.
 * Combines auto-detected info with developer-provided context.
 */
export interface SnapshotPageContext {
  /** Full URL */
  url: string;
  /** Pathname only */
  pathname: string;
  /** Query string */
  search: string;
  /** Hash fragment */
  hash: string;
  /** Document title */
  title: string;
  /** Recent navigation history (most recent last) */
  recentNavigations: PageNavigationEntry[];
  /** Framework router info (if provided via useRouteAwareness) */
  route?: RouteInfo;
  /** Developer-annotated page context (if provided via usePageContext) */
  pageContext?: DeveloperPageContext;
}

// ============================================================================
// Navigation Tracker Options
// ============================================================================

/**
 * Configuration for the NavigationTracker
 */
export interface NavigationTrackerOptions {
  /** Maximum number of navigation entries to keep (default: 20) */
  maxHistory?: number;
  /** Whether to observe document.title changes (default: true) */
  observeTitle?: boolean;
}

// ============================================================================
// Navigation Event Data (for bridge events)
// ============================================================================

/**
 * Data emitted with navigation:change bridge events
 */
export interface NavigationEventData {
  /** Previous page info */
  from: PageInfo;
  /** New page info */
  to: PageInfo;
  /** How the navigation was triggered */
  trigger: NavigationTrigger;
}

// ============================================================================
// Navigation Complete Signal
// ============================================================================

/**
 * Data tracked when a navigation is explicitly marked complete
 */
export interface NavigationCompleteData {
  /** URL at which navigation completed */
  url: string;
  /** Timestamp when the navigation was marked complete */
  completedAt: number;
  /** Application-defined route key (e.g., "/tasks/:id") */
  routeKey: string;
  /** Optional metadata from the caller */
  metadata?: Record<string, unknown>;
}

/**
 * Parameters for the wait_for_navigation_complete IPC command
 */
export interface WaitForNavigationParams {
  /** Only match navigations completed after this timestamp */
  since?: number;
  /** Only match navigations whose URL matches this pattern (substring or regex) */
  urlPattern?: string;
  /** Maximum time to wait in milliseconds */
  timeout: number;
}

/**
 * Result of the wait_for_navigation_complete IPC command
 */
export interface WaitForNavigationResult {
  /** Whether navigation completed (true) or timed out (false) */
  completed: boolean;
  /** URL where navigation completed */
  url?: string;
  /** Application-defined route key */
  routeKey?: string;
  /** Timestamp when the navigation completed */
  completedAt?: number;
  /** Whether the signal came from an explicit markNavigationComplete call or idle-based fallback */
  source: 'explicit' | 'fallback-idle';
}
