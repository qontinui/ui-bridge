/**
 * UI Bridge Native - Server
 *
 * HTTP and WebSocket server for external control of native apps.
 */

export * from './types';
export * from './handlers';
export * from './design-handlers';
export * from './http-server';
export * from './ws-protocol';
export * from './ws-types';
export { WebSocketConnection } from './ws-connection';
export type { WebSocketMessageHandler } from './ws-connection';
export { WebSocketEventBridge } from './ws-event-bridge';
export { ConsoleErrorBuffer, NetworkRequestBuffer } from './observability';
export { bindWithRetry, isAddrInUseError } from './bind-retry';
export type { BindWithRetryOptions } from './bind-retry';

// Page health (producer `sdk-native/page-health`) and the observation
// envelope it answers in.
export {
  diagnosePageHealth,
  pageHealthUnknown,
  NATIVE_PAGE_HEALTH_PRODUCER_ID,
  type PageHealthValue,
  type PageHealthObservation,
  type PageHealthInput,
  type PageHealthOptions,
  type PageHealthElement,
  type PageHealthFinding,
  type PageHealthSeverity,
} from './page-health';
export {
  Observation,
  ObservationError,
  UNKNOWN_CODES,
  isUnknownCode,
  type UnknownCode,
  type ObservationStatus,
  type ObservationProducer,
  type ObservationCoverage,
  type UnmeasuredDimension,
  type ObservationCache,
  type ObservationProvenance,
  type ObservationUnknown,
  type MeasuredObservation,
  type AbsentObservation,
  type UnknownObservation,
} from '@qontinui/ui-bridge/observation';
