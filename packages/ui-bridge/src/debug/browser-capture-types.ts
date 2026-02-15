/**
 * Browser Event Capture Types
 *
 * Discriminated union of all browser-side events captured for debugging.
 */

// ---------------------------------------------------------------------------
// Event type discriminator
// ---------------------------------------------------------------------------

export type BrowserEventType =
  | 'console'
  | 'network'
  | 'react-error'
  | 'navigation'
  | 'long-task'
  | 'resource-error'
  | 'web-vital'
  | 'memory'
  | 'ws-disconnection';

// ---------------------------------------------------------------------------
// Base interface (all events share these fields)
// ---------------------------------------------------------------------------

export interface BrowserCapturedEvent {
  type: BrowserEventType;
  timestamp: number;
  url: string;
}

// ---------------------------------------------------------------------------
// Per-type event interfaces
// ---------------------------------------------------------------------------

export interface ConsoleCapturedEvent extends BrowserCapturedEvent {
  type: 'console';
  level: 'error' | 'warn' | 'unhandledrejection';
  message: string;
  stack?: string;
}

export interface NetworkCapturedEvent extends BrowserCapturedEvent {
  type: 'network';
  method: string;
  requestUrl: string;
  status?: number;
  statusText?: string;
  durationMs: number;
  kind: 'http-error' | 'network-error' | 'timeout' | 'cors' | 'abort';
  errorMessage?: string;
}

export interface ReactErrorCapturedEvent extends BrowserCapturedEvent {
  type: 'react-error';
  message: string;
  stack?: string;
  componentStack?: string;
}

export interface NavigationCapturedEvent extends BrowserCapturedEvent {
  type: 'navigation';
  from: string;
  to: string;
  trigger: 'pushState' | 'replaceState' | 'popstate';
}

export interface LongTaskCapturedEvent extends BrowserCapturedEvent {
  type: 'long-task';
  durationMs: number;
}

export interface ResourceErrorCapturedEvent extends BrowserCapturedEvent {
  type: 'resource-error';
  resourceUrl: string;
  tagName: string;
}

export interface WebVitalCapturedEvent extends BrowserCapturedEvent {
  type: 'web-vital';
  metric: 'LCP' | 'CLS';
  value: number;
}

export interface MemoryCapturedEvent extends BrowserCapturedEvent {
  type: 'memory';
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

export interface WsDisconnectionCapturedEvent extends BrowserCapturedEvent {
  type: 'ws-disconnection';
  previousState: string;
  newState: string;
  reconnectAttempt?: number;
}

// ---------------------------------------------------------------------------
// Union type
// ---------------------------------------------------------------------------

export type AnyCapturedEvent =
  | ConsoleCapturedEvent
  | NetworkCapturedEvent
  | ReactErrorCapturedEvent
  | NavigationCapturedEvent
  | LongTaskCapturedEvent
  | ResourceErrorCapturedEvent
  | WebVitalCapturedEvent
  | MemoryCapturedEvent
  | WsDisconnectionCapturedEvent;

// ---------------------------------------------------------------------------
// Callback
// ---------------------------------------------------------------------------

export type OnBrowserEventCallback = (event: AnyCapturedEvent) => void;

// ---------------------------------------------------------------------------
// Backward-compat alias: CapturedError
// ActionExecutor uses this in ControlActionResponse.consoleErrors
// ---------------------------------------------------------------------------

export interface CapturedError {
  timestamp: number;
  level: 'error' | 'warn' | 'unhandledrejection';
  message: string;
  stack?: string;
}

/**
 * @deprecated Use OnBrowserEventCallback instead
 */
export type OnCaptureCallback = (entry: CapturedError) => void;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface BrowserCaptureConfig {
  /** Capture console.error/warn + unhandled rejections. Default: true */
  console?: boolean;
  /** Capture failed fetch requests (4xx/5xx/network errors). Default: true */
  network?: boolean;
  /** Capture History API navigation. Default: true */
  navigation?: boolean;
  /** Capture PerformanceObserver long tasks. Default: true */
  longTasks?: boolean;
  /** Capture failed resource loads (img/script/link). Default: true */
  resourceErrors?: boolean;
  /** Capture WebSocket disconnection events. Default: true */
  wsDisconnections?: boolean;
  /** Capture Web Vitals (LCP, CLS). Default: false (opt-in) */
  webVitals?: boolean;
  /** Capture Chrome memory snapshots. Default: false (opt-in) */
  memory?: boolean;

  /** Advanced: network capture options */
  networkOptions?: {
    /** URL patterns to ignore (substrings). Defaults to dev-debug/ui-bridge endpoints. */
    ignorePatterns?: string[];
  };
  /** Advanced: memory polling interval in ms. Default: 30000 */
  memoryIntervalMs?: number;
  /** Maximum buffer size. Default: 200 */
  maxEntries?: number;
}

export const DEFAULT_CAPTURE_CONFIG: Required<
  Pick<
    BrowserCaptureConfig,
    | 'console'
    | 'network'
    | 'navigation'
    | 'longTasks'
    | 'resourceErrors'
    | 'wsDisconnections'
    | 'webVitals'
    | 'memory'
    | 'memoryIntervalMs'
    | 'maxEntries'
  >
> = {
  console: true,
  network: true,
  navigation: true,
  longTasks: true,
  resourceErrors: true,
  wsDisconnections: true,
  webVitals: false,
  memory: false,
  memoryIntervalMs: 30000,
  maxEntries: 200,
};
