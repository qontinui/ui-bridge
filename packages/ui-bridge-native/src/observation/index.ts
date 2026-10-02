/**
 * The Observation envelope, vendored from `@qontinui/ui-bridge`.
 *
 * `./observation.ts` is a GENERATED copy of the canonical
 * `packages/ui-bridge/src/observation/observation.ts` (see
 * `scripts/sync-observation.mjs`); CI fails if the two drift. This package
 * imports it by relative path so it takes no runtime dependency on
 * `@qontinui/ui-bridge` (an optional peer here) and needs no package-`exports`
 * support from Metro.
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
