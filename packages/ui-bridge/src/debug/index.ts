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
