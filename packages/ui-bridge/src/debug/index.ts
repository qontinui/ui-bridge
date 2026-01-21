/**
 * UI Bridge Debug Module
 *
 * DevTools, inspection, and metrics utilities.
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
