/**
 * Recording Session Types
 *
 * Types for the recording session that captures user interactions and produces
 * CooccurrenceExport data for state machine bootstrapping.
 *
 * The CooccurrenceExportData interface matches the Python
 * CooccurrenceExport.to_dict() output exactly (camelCase keys).
 */

import type { ElementFingerprintData } from '../core/element-fingerprint';

// ============================================================================
// Recording Session Configuration
// ============================================================================

export interface RecordingSessionConfig {
  /** Post-interaction settle time in ms before taking "after" snapshot (default: 300) */
  debounceMs?: number;
  /** Max fingerprint snapshots to store (default: 500) */
  maxCaptures?: number;
  /** Only capture interactions on registered elements (default: true) */
  filterUnregistered?: boolean;
  /** Keystroke coalescing window in ms (default: 100) */
  keystrokeCoalesceMs?: number;
}

// ============================================================================
// Recording Session Output
// ============================================================================

export interface RecordingSessionResult {
  sessionId: string;
  duration: number;
  exportData: CooccurrenceExportData;
  variables: VariableCandidate[];
  interactionCount: number;
  captureCount: number;
}

export interface VariableCandidate {
  /** Fingerprint hash of the input element */
  fingerprint: string;
  /** Registry element ID */
  elementId: string;
  /** Input type: text, select, checkbox, radio, etc. */
  inputType: string;
  /** Value the user entered during recording */
  enteredValue: string;
  /** Accessible name or label for this field */
  label: string;
  /** Derived parameter name in camelCase */
  suggestedParamName: string;
}

// ============================================================================
// Recorded Interaction
// ============================================================================

export type InteractionActionType = 'click' | 'type' | 'select' | 'submit' | 'navigate' | 'check' | 'uncheck';

export interface RecordedInteraction {
  id: string;
  timestamp: number;
  actionType: InteractionActionType;
  targetFingerprint: string | null;
  targetElementId: string | null;
  beforeCaptureId: string;
  afterCaptureId: string;
  /** For type/select actions, the value entered */
  value?: string;
}

// ============================================================================
// Interaction Interceptor Events
// ============================================================================

export interface InteractionEvent {
  timestamp: number;
  actionType: InteractionActionType;
  targetElementId: string;
  targetElement: HTMLElement;
  value?: string;
}

// ============================================================================
// CooccurrenceExport — matches Python CooccurrenceExport.to_dict()
// ============================================================================

export interface TransitionRecordData {
  actionId: string;
  actionType: string;
  targetFingerprint: string | null;
  beforeCaptureId: string;
  afterCaptureId: string;
  appearedFingerprints: string[];
  disappearedFingerprints: string[];
  timestamp: number;
}

export interface PresenceMatrixEntryData {
  captureId: string;
  url: string;
  fingerprints: string[];
}

export interface FingerprintStatsData {
  totalAppearances: number;
  captureIds: string[];
  firstSeen: number;
  lastSeen: number;
}

export interface StateCandidateData {
  fingerprints: string[];
  cooccurrenceRate: number;
  positionZone?: string;
  landmarkContext?: string;
}

/**
 * Full export from a recording session.
 * This is the canonical input to FingerprintStateDiscovery.load_cooccurrence_export().
 */
export interface CooccurrenceExportData {
  sessionId: string;
  exportedAt: number;
  allFingerprints: string[];
  fingerprintDetails: Record<string, ElementFingerprintData>;
  presenceMatrix: PresenceMatrixEntryData[];
  cooccurrenceCounts: Record<string, Record<string, number>>;
  fingerprintStats: Record<string, FingerprintStatsData>;
  transitions: TransitionRecordData[];
  stateCandidates: StateCandidateData[];
}

// ============================================================================
// Recording Status
// ============================================================================

export interface RecordingStatus {
  active: boolean;
  sessionId?: string;
  duration: number;
  interactionCount: number;
  captureCount: number;
}
