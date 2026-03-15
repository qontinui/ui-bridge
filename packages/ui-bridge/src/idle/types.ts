/**
 * Idle Detection Types
 *
 * Types for the idle detection system. Each signal is a first-class,
 * independently-accessible detector that also feeds into a composite.
 */

import type { NetworkRequestTracker } from '../network/tracker';

// ============================================================================
// Signal Interface
// ============================================================================

/**
 * Base interface for all idle signals.
 *
 * Each signal is independently usable — it can be queried, waited on,
 * and subscribed to without going through the composite detector.
 */
export interface IdleSignal<TStatus extends SignalStatus = SignalStatus> {
  /** Unique signal name, used as API path segment and event prefix */
  readonly name: string;

  /** Whether this signal currently considers the app idle */
  isIdle(): boolean;

  /** Signal-specific detailed status */
  getStatus(): TStatus;

  /** Wait for this specific signal to become idle */
  waitForIdle(options?: SignalWaitOptions): Promise<TStatus>;

  /** Subscribe to idle/busy transitions on this signal */
  onTransition(callback: SignalTransitionCallback<TStatus>): () => void;

  /** Weight when used in composite (0-1). Higher = more important. */
  readonly weight: number;

  /** Install interceptors/observers. Called once during setup. */
  install(): void;

  /** Clean up interceptors/observers. */
  destroy(): void;
}

export type SignalTransitionCallback<TStatus extends SignalStatus = SignalStatus> = (
  idle: boolean,
  status: TStatus
) => void;

export interface SignalWaitOptions {
  /** Maximum time to wait in ms (default: 30000) */
  timeout?: number;
  /** Minimum time the signal must remain idle before resolving (default: 0) */
  minStableMs?: number;
}

// ============================================================================
// Signal Status Types
// ============================================================================

/** Base status that all signals include */
export interface SignalStatus {
  idle: boolean;
  timestamp: number;
}

/** Network signal status */
export interface NetworkSignalStatus extends SignalStatus {
  pendingCount: number;
  pendingRequests: PendingRequest[];
}

export interface PendingRequest {
  url: string;
  method: string;
  startedAt: number;
  durationMs: number;
}

/** DOM mutation settling signal status */
export interface DOMSignalStatus extends SignalStatus {
  settled: boolean;
  lastMutationAt: number;
  msSinceLastMutation: number;
  recentMutationCount: number;
}

/** Loading indicator signal status */
export interface LoadingIndicatorSignalStatus extends SignalStatus {
  loading: boolean;
  indicators: DetectedLoadingIndicator[];
}

export interface DetectedLoadingIndicator {
  type: 'aria-busy' | 'selector' | 'animation' | 'cursor';
  selector?: string;
  element?: string;
  details?: string;
}

/** Form mutation settling signal status */
export interface FormMutationSignalStatus extends SignalStatus {
  settled: boolean;
  lastMutationAt: number;
  msSinceLastMutation: number;
  recentMutationCount: number;
  activeFieldId?: string;
}

/** Animation signal status */
export interface AnimationSignalStatus extends SignalStatus {
  activeCount: number;
  animations: DetectedAnimation[];
}

export interface DetectedAnimation {
  name: string;
  targetElement?: string;
  durationMs?: number;
  isInfinite: boolean;
}

// ============================================================================
// Composite Types
// ============================================================================

/** Status of an individual signal within the composite */
export interface CompositeSignalEntry<TStatus extends SignalStatus = SignalStatus> {
  name: string;
  idle: boolean;
  weight: number;
  status: TStatus;
}

/** Full composite idle status */
export interface CompositeIdleStatus {
  /** Whether the composite considers the app idle */
  idle: boolean;
  /** Weighted idle score (0-1) */
  idleScore: number;
  /** Individual signal statuses, keyed by signal name */
  signals: Record<string, CompositeSignalEntry>;
  timestamp: number;
}

/** Options for composite waitForIdle */
export interface CompositeWaitOptions {
  /** Maximum time to wait in ms (default: 30000) */
  timeout?: number;
  /** Minimum time composite must remain idle before resolving (default: 500) */
  minStableMs?: number;
  /** Signal names to exclude from the check */
  exclude?: string[];
}

/** Options for composite waitFor (subset of signals) */
export interface SelectiveWaitOptions {
  /** Maximum time to wait in ms (default: 30000) */
  timeout?: number;
  /** Minimum stable time in ms (default: 0) */
  minStableMs?: number;
}

/** A wait target: either a signal name or a specific loading indicator */
export type WaitTarget = string | { indicator: string };

// ============================================================================
// Event Types
// ============================================================================

/** Idle-related event types */
export type IdleEventType =
  // Composite
  | 'app:busy'
  | 'app:idle'
  // Network
  | 'network:busy'
  | 'network:idle'
  | 'network:requestStart'
  | 'network:requestEnd'
  // DOM
  | 'dom:mutating'
  | 'dom:settled'
  // Loading indicators
  | 'loading:detected'
  | 'loading:cleared'
  // Form mutations
  | 'form:mutating'
  | 'form:settled'
  // Animations
  | 'animations:active'
  | 'animations:idle';

/** Data for network:requestStart event */
export interface NetworkRequestStartData {
  url: string;
  method: string;
  pendingCount: number;
}

/** Data for network:requestEnd event */
export interface NetworkRequestEndData {
  url: string;
  method: string;
  status?: number;
  durationMs: number;
  pendingCount: number;
}

// ============================================================================
// Configuration
// ============================================================================

/** Network idle detector configuration */
export interface NetworkIdleConfig {
  /** Time with 0 pending requests before considered idle (default: 500) */
  debounceMs?: number;
  /** URL patterns to ignore (regex strings). Matches are excluded from tracking. */
  ignorePatterns?: string[];
  /** Whether to track XHR in addition to fetch (default: true) */
  trackXHR?: boolean;
  /**
   * Optional NetworkRequestTracker instance. When provided, the idle detector
   * subscribes to tracker events instead of patching fetch/XHR directly.
   * This avoids redundant fetch interception when a tracker already exists.
   */
  tracker?: NetworkRequestTracker;
}

/** DOM settling detector configuration */
export interface DOMSettlingConfig {
  /** Time with no mutations before considered settled (default: 300) */
  settleMs?: number;
  /** Root element to observe (default: document.body) */
  root?: HTMLElement;
}

/** Loading indicator detector configuration */
export interface LoadingIndicatorConfig {
  /** Additional CSS selectors to check for loading indicators */
  additionalSelectors?: string[];
  /** Whether to check CSS animations for loading patterns (default: true) */
  checkAnimations?: boolean;
  /** Whether to check cursor style (default: true) */
  checkCursor?: boolean;
}

/** Form mutation detector configuration */
export interface FormMutationConfig {
  /** Time with no form changes before considered settled (default: 800) */
  settleMs?: number;
}

// ============================================================================
// Stuck Screen Diagnostic Types
// ============================================================================

export type StuckVerdict = 'stuck' | 'loading' | 'idle' | 'unknown';

export interface StuckScreenEvidence {
  /** Loading indicators found in the DOM */
  loadingIndicators: DetectedLoadingIndicator[];
  /** Whether network requests are in flight */
  networkBusy: boolean;
  /** Number of pending network requests */
  pendingNetworkRequests: number;
  /** Screenshot similarity between start and end of observation (0-1). Native capture only. */
  screenshotSimilarity?: number;
  /** Whether the screenshot changed during observation. Native capture only. */
  screenshotChanged?: boolean;
  /** Whether the UI Bridge DOM signals were available */
  uiBridgeResponsive?: boolean;
  /** Whether the DOM changed meaningfully during observation. DOM mode only. */
  domChanged?: boolean;
  /** Number of DOM mutations observed during window. DOM mode only. */
  domMutationCount?: number;
  /** Composite idle score at start of observation. DOM mode only. */
  idleScoreStart?: number;
  /** Composite idle score at end of observation. DOM mode only. */
  idleScoreEnd?: number;
}

export interface StuckScreenDiagnosis {
  /** The verdict: stuck, loading, idle, or unknown */
  verdict: StuckVerdict;
  /** Confidence in the verdict (0-1) */
  confidence: number;
  /** Human-readable explanation */
  summary: string;
  /** Detailed evidence supporting the verdict */
  evidence: StuckScreenEvidence;
  /** How long the observation took (ms) */
  observationWindowMs: number;
  /** Suggested recovery actions */
  suggestions: string[];
  /** Timestamp of diagnosis */
  timestamp: number;
  /** Screenshot at end of observation (base64 PNG). Native capture only. */
  screenshot?: string;
  /** Screenshot width in pixels */
  screenshotWidth?: number;
  /** Screenshot height in pixels */
  screenshotHeight?: number;
  /** Source of screenshot capture ('runner_window' or 'primary_monitor') */
  captureSource?: string;
}

export interface StuckScreenConfig {
  /** Observation window in ms (default: 3000) */
  observationWindowMs?: number;
  /** DOM mutation threshold — fewer than this = "not changing" (default: 3) */
  domMutationThreshold?: number;
}

/** Composite detector configuration */
export interface CompositeIdleConfig {
  /** Network detector config */
  network?: NetworkIdleConfig & { weight?: number; enabled?: boolean };
  /** DOM settling config */
  dom?: DOMSettlingConfig & { weight?: number; enabled?: boolean };
  /** Loading indicator config */
  loadingIndicators?: LoadingIndicatorConfig & { weight?: number; enabled?: boolean };
  /** Form mutation detector config */
  formMutation?: FormMutationConfig & { weight?: number; enabled?: boolean };
  /** Minimum idle score for composite to be considered idle (default: 0.7) */
  minIdleScore?: number;
}
