/**
 * Observation module — the envelope every UI Bridge observation surface
 * answers in, and the SDK's own observation producers.
 *
 * Kept free of server / React / Node imports so `@qontinui/ui-bridge-server`
 * and `@qontinui/ui-bridge-native` (React Native) can import it at runtime
 * without dragging a transport along.
 */

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
  type ObservationProvenanceInit,
  type ObservationUnknown,
  type ObservationTime,
  type MeasuredObservation,
  type AbsentObservation,
  type UnknownObservation,
} from './observation';

export {
  diagnosePageHealth,
  pageHealthUnknown,
  SDK_PAGE_HEALTH_PRODUCER_ID,
  type PageHealthValue,
  type PageHealthObservation,
  type PageHealthInput,
  type PageHealthOptions,
  type PageHealthFinding,
  type PageHealthSeverity,
} from '../server/page-health';
