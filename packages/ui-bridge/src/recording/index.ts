/**
 * Recording Module
 *
 * Provides recording session management for capturing user interactions
 * and producing CooccurrenceExport data for state machine bootstrapping.
 */

export { RecordingSessionManager } from './session-manager';
export { InteractionInterceptor } from './interaction-interceptor';
export {
  startPassiveCapture,
  getPassiveCaptureStatuses,
  admissionFromRegistration,
  PASSIVE_CAPTURE_MAX_IN_FLIGHT,
  PASSIVE_CAPTURE_RELAY_TIMEOUT_MS,
  PASSIVE_CAPTURE_BODY_READ_TIMEOUT_MS,
  buildObservation,
  observeUrl,
  isObserveIdentifier,
  PASSIVE_CAPTURE_RUNNER_APP_ID,
} from './passive-capture';
export type {
  PassiveCaptureOptions,
  PassiveCaptureHandle,
  PassiveCaptureStatus,
  PassiveCaptureState,
  PassiveCaptureAdmission,
  PassiveObservation,
  PassiveObservationIds,
} from './passive-capture';
export type {
  RecordingSessionConfig,
  RecordingSessionResult,
  RecordingStatus,
  RecordedInteraction,
  VariableCandidate,
  InteractionEvent,
  InteractionActionType,
  CooccurrenceExportData,
  TransitionRecordData,
  PresenceMatrixEntryData,
  FingerprintStatsData,
  StateCandidateData,
} from './types';
