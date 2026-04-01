/**
 * Recording Module
 *
 * Provides recording session management for capturing user interactions
 * and producing CooccurrenceExport data for state machine bootstrapping.
 */

export { RecordingSessionManager } from './session-manager';
export { InteractionInterceptor } from './interaction-interceptor';
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
