/**
 * UI Bridge Debug Module
 *
 * DevTools, inspection, metrics, and browser event capture utilities.
 */

// Inspector
export {
  Inspector,
  InspectorOverlay,
  InfoPanel,
  useInspector,
  type InspectorState,
  type ElementInfo,
  type InspectorOverlayProps,
  type InfoPanelProps,
  type UseInspectorOptions,
  type InspectorProps,
} from './inspector';

// Browser Event Capture (replaces ConsoleCapture)
export { BrowserEventCapture } from './browser-capture';
export {
  type BrowserEventType,
  type BrowserCapturedEvent,
  type ConsoleCapturedEvent,
  type NetworkCapturedEvent,
  type ReactErrorCapturedEvent,
  type NavigationCapturedEvent,
  type LongTaskCapturedEvent,
  type ResourceErrorCapturedEvent,
  type WebVitalCapturedEvent,
  type MemoryCapturedEvent,
  type WsDisconnectionCapturedEvent,
  type HmrCapturedEvent,
  type AnyCapturedEvent,
  type OnBrowserEventCallback,
  type BrowserCaptureConfig,
  // Backward-compat exports
  type CapturedError,
  type OnCaptureCallback,
  DEFAULT_CAPTURE_CONFIG,
} from './browser-capture-types';

// Error Fingerprinting & Deduplication
export {
  computeFingerprint,
  deduplicateEvents,
  extractSourceLocation,
  type FingerprintedEvent,
} from './error-fingerprint';

// Error Severity Classification
export {
  classifyEvent,
  classifyEvents,
  filterBySeverity,
  SEVERITY_RANK,
  DEFAULT_NOISE_PATTERNS,
  type ErrorSeverity,
  type ClassifiedEvent,
} from './error-severity';

// Error Timeline & Error Diff
export {
  TimelineBuffer,
  type BrowserEventCaptureLike,
  type ClassifiedBrowserEvent,
  type TimelineEntryType,
  type ActionTimelineEntry,
  type BrowserEventTimelineEntry,
  type TimelineEntry,
  type ErrorDiff,
  type TimelineQueryOptions,
} from './error-timeline';

// Error Sessions & Baselines
export {
  ErrorSession,
  ErrorSessionManager,
  type ErrorBaseline,
  type BaselineComparison,
  type ErrorSessionSummary,
} from './error-session';

// Health Score
export {
  computeHealthReport,
  computeHealthScore,
  computeHealthStatus,
  type HealthStatus,
  type HealthReport,
  type HealthScoreConfig,
} from './health-score';

// Network Chain Tracking (request-response-error correlation)
export {
  NetworkChainTracker,
  type NetworkRequest,
  type NetworkResponse,
  type NetworkChain,
  type CorrelatedError,
  type NetworkChainConfig,
} from './network-chain';

// Error Snapshots (auto-captured on significant errors)
export {
  ErrorSnapshotBuffer,
  extractMessage,
  type ErrorSnapshot,
  type ErrorSnapshotPageState,
  type ErrorSnapshotConfig,
} from './error-snapshot';

// WebSocket Real-Time Streaming (transport-agnostic)
export {
  BrowserEventStream,
  type BrowserEventStreamMessage,
  type StreamSubscription,
  type StreamConfig,
} from './ws-streaming';

// Error Impact Assessment (UI state diffing)
export {
  ErrorImpactAssessor,
  type ErrorImpact,
  type UIConsequences,
  type UIStateSnapshot,
  type ErrorImpactConfig,
} from './error-impact';

// Shared utilities
export { getEventStack } from './shared-utils';

// Metrics
export {
  MetricsCollector,
  createMetricsCollector,
  formatDuration,
  formatPercentage,
  type ActionHistoryEntry,
  type PerformanceMetrics,
  type MetricsCollectorOptions,
} from './metrics';
