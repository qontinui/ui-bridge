/**
 * Recording Session Manager
 *
 * Captures user interactions with before/after fingerprint snapshots,
 * producing a CooccurrenceExport for state machine bootstrapping.
 *
 * Pipeline:
 * 1. User clicks "Record" → start() takes initial fingerprint snapshot
 * 2. User interacts with app → InteractionInterceptor captures events
 * 3. For each interaction: before snapshot → wait for DOM settle → after snapshot
 * 4. User clicks "Stop" → stop() computes CooccurrenceExport from all captures
 * 5. Export is sent to Python backend for state discovery
 */

import type { UIBridgeRegistry } from '../core/registry';
import type { ChangeObserver } from '../core/change-observer';
import {
  computeFingerprintsWithMapping,
  type ElementFingerprintData,
} from '../core/element-fingerprint';
import { InteractionInterceptor } from './interaction-interceptor';
import type {
  RecordingSessionConfig,
  RecordingSessionResult,
  RecordingStatus,
  RecordedInteraction,
  VariableCandidate,
  InteractionEvent,
  CooccurrenceExportData,
  TransitionRecordData,
  PresenceMatrixEntryData,
  FingerprintStatsData,
  StateCandidateData,
} from './types';

// ============================================================================
// Internal Types
// ============================================================================

interface CaptureSnapshot {
  id: string;
  timestamp: number;
  url: string;
  title: string;
  fingerprintHashes: string[];
}

// ============================================================================
// Session Manager
// ============================================================================

export class RecordingSessionManager {
  private registry: UIBridgeRegistry;
  private changeObserver: ChangeObserver | null;
  private config: Required<Pick<RecordingSessionConfig, 'debounceMs' | 'maxCaptures' | 'filterUnregistered' | 'keystrokeCoalesceMs' | 'autoSaveIntervalMs'>> & {
    onAutoSave: RecordingSessionConfig['onAutoSave'];
  };

  // Session state
  private sessionId: string | null = null;
  private startTime = 0;
  private active = false;
  private interceptor: InteractionInterceptor | null = null;
  private autoSaveTimer: ReturnType<typeof setInterval> | null = null;

  // Collected data
  private captures: CaptureSnapshot[] = [];
  private allFingerprints = new Map<string, ElementFingerprintData>();
  private elementIdToHash = new Map<string, string>();
  private hashToElementIds = new Map<string, string[]>();
  private interactions: RecordedInteraction[] = [];
  private transitions: TransitionRecordData[] = [];
  private variables: VariableCandidate[] = [];

  // Snapshot caching
  private lastCaptureTime = 0;
  private lastCaptureId: string | null = null;

  // Pending interaction processing (queue to avoid dropping rapid interactions)
  private pendingSettleTimers: Array<{
    timer: ReturnType<typeof setTimeout>;
    unsubscribe?: () => void;
  }> = [];

  constructor(
    registry: UIBridgeRegistry,
    changeObserver: ChangeObserver | null = null,
    config: RecordingSessionConfig = {}
  ) {
    this.registry = registry;
    this.changeObserver = changeObserver;
    this.config = {
      debounceMs: config.debounceMs ?? 300,
      maxCaptures: config.maxCaptures ?? 500,
      filterUnregistered: config.filterUnregistered ?? true,
      keystrokeCoalesceMs: config.keystrokeCoalesceMs ?? 100,
      autoSaveIntervalMs: config.autoSaveIntervalMs ?? 30000,
      onAutoSave: config.onAutoSave,
    };
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  start(config?: RecordingSessionConfig): void {
    if (this.active) return;

    // Apply config overrides
    if (config) {
      this.config = {
        ...this.config,
        ...config,
      };
    }

    this.sessionId = generateId('session');
    this.startTime = Date.now();
    this.active = true;

    // Reset collected data
    this.captures = [];
    this.allFingerprints = new Map();
    this.elementIdToHash = new Map();
    this.hashToElementIds = new Map();
    this.interactions = [];
    this.transitions = [];
    this.variables = [];
    this.lastCaptureTime = 0;
    this.lastCaptureId = null;

    // Take initial fingerprint snapshot
    this.takeCapture('initial');

    // Start interaction interception
    this.interceptor = new InteractionInterceptor(
      this.registry,
      (event) => this.onInteraction(event),
      {
        filterUnregistered: this.config.filterUnregistered,
        keystrokeCoalesceMs: this.config.keystrokeCoalesceMs,
      }
    );
    this.interceptor.start();

    // Start periodic auto-save for crash recovery
    if (this.config.onAutoSave && this.config.autoSaveIntervalMs > 0) {
      this.autoSaveTimer = setInterval(() => {
        if (!this.active) return;
        try {
          const partialExport = this.buildExport();
          this.config.onAutoSave?.(partialExport);
        } catch {
          // Swallow errors in auto-save to avoid disrupting the recording
        }
      }, this.config.autoSaveIntervalMs);
    }
  }

  stop(): RecordingSessionResult {
    if (!this.active || !this.sessionId) {
      throw new Error('No active recording session');
    }

    // Stop interceptor
    this.interceptor?.stop();
    this.interceptor = null;

    // Clear auto-save interval
    if (this.autoSaveTimer !== null) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }

    // Cancel all pending settle timers
    for (const pending of this.pendingSettleTimers) {
      clearTimeout(pending.timer);
      pending.unsubscribe?.();
    }
    this.pendingSettleTimers = [];

    // Take final snapshot
    this.takeCapture('final');

    // Build export
    const exportData = this.buildExport();
    const duration = Date.now() - this.startTime;

    const result: RecordingSessionResult = {
      sessionId: this.sessionId,
      duration,
      exportData,
      variables: this.variables,
      interactionCount: this.interactions.length,
      captureCount: this.captures.length,
    };

    // Reset
    this.active = false;
    this.sessionId = null;

    return result;
  }

  getStatus(): RecordingStatus {
    return {
      active: this.active,
      sessionId: this.sessionId ?? undefined,
      duration: this.active ? Date.now() - this.startTime : 0,
      interactionCount: this.interactions.length,
      captureCount: this.captures.length,
    };
  }

  // ============================================================================
  // Interaction Handling
  // ============================================================================

  private onInteraction(event: InteractionEvent): void {
    if (!this.active) return;

    // Get "before" capture (use cached if recent)
    const beforeCaptureId = this.getOrTakeBeforeCapture();

    // Capture the event and beforeCaptureId in a closure — each interaction
    // gets its own settle timer so rapid sequences don't drop interactions.
    const capturedEvent = event;

    this.waitForSettle(() => {
      if (!this.active) return;

      // Take "after" capture
      const afterCaptureId = this.takeCapture('action');

      // Get fingerprint for the target element
      const targetFingerprint = this.elementIdToHash.get(capturedEvent.targetElementId) ?? null;

      // Compute appeared/disappeared fingerprints
      const beforeCapture = this.captures.find((c) => c.id === beforeCaptureId);
      const afterCapture = this.captures.find((c) => c.id === afterCaptureId);
      const beforeSet = new Set(beforeCapture?.fingerprintHashes ?? []);
      const afterSet = new Set(afterCapture?.fingerprintHashes ?? []);

      const appeared = [...afterSet].filter((h) => !beforeSet.has(h));
      const disappeared = [...beforeSet].filter((h) => !afterSet.has(h));

      // Build TransitionRecord
      const transitionRecord: TransitionRecordData = {
        actionId: generateId('action'),
        actionType: capturedEvent.actionType,
        targetFingerprint,
        beforeCaptureId,
        afterCaptureId,
        appearedFingerprints: appeared,
        disappearedFingerprints: disappeared,
        timestamp: capturedEvent.timestamp,
      };
      this.transitions.push(transitionRecord);

      // Build RecordedInteraction
      const recorded: RecordedInteraction = {
        id: transitionRecord.actionId,
        timestamp: capturedEvent.timestamp,
        actionType: capturedEvent.actionType,
        targetFingerprint,
        targetElementId: capturedEvent.targetElementId,
        beforeCaptureId,
        afterCaptureId,
        value: capturedEvent.value,
      };
      this.interactions.push(recorded);

      // Variable detection
      if (
        capturedEvent.value &&
        (capturedEvent.actionType === 'type' || capturedEvent.actionType === 'select')
      ) {
        this.detectVariable(capturedEvent, targetFingerprint);
      }
    });
  }

  private getOrTakeBeforeCapture(): string {
    const now = Date.now();
    // Use cached capture if less than 200ms old
    if (this.lastCaptureId && now - this.lastCaptureTime < 200) {
      return this.lastCaptureId;
    }
    return this.takeCapture('before-action');
  }

  /**
   * Wait for DOM to settle, then invoke callback.
   * Each call creates its own independent timer — no shared mutable state.
   */
  private waitForSettle(callback: () => void): void {
    if (this.changeObserver) {
      // Wait for ChangeObserver to report no changes for debounceMs
      let settleTimeout: ReturnType<typeof setTimeout>;
      let unsubscribe: (() => void) | undefined;
      const entry = { timer: settleTimeout!, unsubscribe: undefined as (() => void) | undefined };

      const complete = () => {
        unsubscribe?.();
        // Remove from pending list
        const idx = this.pendingSettleTimers.indexOf(entry);
        if (idx >= 0) this.pendingSettleTimers.splice(idx, 1);
        callback();
      };

      const resetSettle = () => {
        clearTimeout(settleTimeout);
        settleTimeout = setTimeout(complete, this.config.debounceMs);
        entry.timer = settleTimeout;
      };

      unsubscribe = this.changeObserver.subscribe(() => {
        resetSettle();
      });
      entry.unsubscribe = unsubscribe;

      this.pendingSettleTimers.push(entry);
      resetSettle();
    } else {
      // Fallback: simple timeout
      const timer = setTimeout(() => {
        const idx = this.pendingSettleTimers.findIndex((e) => e.timer === timer);
        if (idx >= 0) this.pendingSettleTimers.splice(idx, 1);
        callback();
      }, this.config.debounceMs);
      this.pendingSettleTimers.push({ timer });
    }
  }

  // ============================================================================
  // Fingerprint Snapshots
  // ============================================================================

  private takeCapture(_triggeredBy: string): string {
    if (this.captures.length >= this.config.maxCaptures) {
      // Evict oldest capture that is not referenced by any transition
      const referencedIds = new Set<string>();
      for (const t of this.transitions) {
        referencedIds.add(t.beforeCaptureId);
        referencedIds.add(t.afterCaptureId);
      }
      // Also keep first and most recent captures
      if (this.captures.length > 0) referencedIds.add(this.captures[0].id);
      if (this.captures.length > 1) referencedIds.add(this.captures[this.captures.length - 1].id);

      const evictIdx = this.captures.findIndex((c) => !referencedIds.has(c.id));
      if (evictIdx >= 0) {
        this.captures.splice(evictIdx, 1);
      } else if (this.captures.length > 1) {
        // All captures are referenced — evict second-oldest as last resort
        this.captures.splice(1, 1);
      }
    }

    const { fingerprints, hashToElementIds, elementIdToHash } = computeFingerprintsWithMapping(
      this.registry
    );

    // Merge into global fingerprint map
    for (const [hash, fp] of fingerprints) {
      if (!this.allFingerprints.has(hash)) {
        this.allFingerprints.set(hash, fp);
      }
    }

    // Update mappings
    for (const [hash, ids] of hashToElementIds) {
      this.hashToElementIds.set(hash, ids);
    }
    for (const [id, hash] of elementIdToHash) {
      this.elementIdToHash.set(id, hash);
    }

    const captureId = generateId('capture');
    const capture: CaptureSnapshot = {
      id: captureId,
      timestamp: Date.now(),
      url: window.location.href,
      title: document.title,
      fingerprintHashes: Array.from(fingerprints.keys()),
    };

    this.captures.push(capture);
    this.lastCaptureTime = capture.timestamp;
    this.lastCaptureId = captureId;

    return captureId;
  }

  // ============================================================================
  // Variable Detection
  // ============================================================================

  private detectVariable(event: InteractionEvent, fingerprint: string | null): void {
    if (!fingerprint || !event.value) return;

    // Don't add duplicate variables for the same element
    if (this.variables.some((v) => v.fingerprint === fingerprint)) {
      // Update the entered value to the latest
      const existing = this.variables.find((v) => v.fingerprint === fingerprint);
      if (existing) existing.enteredValue = event.value;
      return;
    }

    const el = event.targetElement;
    const inputType =
      el instanceof HTMLInputElement
        ? el.type
        : el instanceof HTMLSelectElement
          ? 'select'
          : el instanceof HTMLTextAreaElement
            ? 'textarea'
            : 'text';

    // Get label
    const label = this.getElementLabel(el);

    this.variables.push({
      fingerprint,
      elementId: event.targetElementId,
      inputType,
      enteredValue: event.value,
      label,
      suggestedParamName: labelToCamelCase(label),
    });
  }

  private getElementLabel(el: HTMLElement): string {
    // aria-label
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel;

    // Associated label element
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label?.textContent?.trim()) return label.textContent.trim();
    }
    const wrappingLabel = el.closest('label');
    if (wrappingLabel?.textContent?.trim()) return wrappingLabel.textContent.trim();

    // Placeholder
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      if (el.placeholder) return el.placeholder;
    }

    // data-testid as fallback
    const testId = el.getAttribute('data-testid');
    if (testId) return testId;

    // Name attribute
    const name = el.getAttribute('name');
    if (name) return name;

    return 'field';
  }

  // ============================================================================
  // Export Building
  // ============================================================================

  private buildExport(): CooccurrenceExportData {
    const allFingerprintHashes = Array.from(this.allFingerprints.keys());

    // Build fingerprint details
    const fingerprintDetails: Record<string, ElementFingerprintData> = {};
    for (const [hash, fp] of this.allFingerprints) {
      fingerprintDetails[hash] = fp;
    }

    // Build presence matrix
    const presenceMatrix: PresenceMatrixEntryData[] = this.captures.map((c) => ({
      captureId: c.id,
      url: c.url,
      fingerprints: c.fingerprintHashes,
    }));

    // Build co-occurrence counts
    const cooccurrenceCounts: Record<string, Record<string, number>> = {};
    for (const capture of this.captures) {
      const hashes = capture.fingerprintHashes;
      for (let i = 0; i < hashes.length; i++) {
        for (let j = i + 1; j < hashes.length; j++) {
          const a = hashes[i];
          const b = hashes[j];
          if (!cooccurrenceCounts[a]) cooccurrenceCounts[a] = {};
          if (!cooccurrenceCounts[b]) cooccurrenceCounts[b] = {};
          cooccurrenceCounts[a][b] = (cooccurrenceCounts[a][b] || 0) + 1;
          cooccurrenceCounts[b][a] = (cooccurrenceCounts[b][a] || 0) + 1;
        }
      }
    }

    // Build inverted index: fingerprint hash → list of captures containing it
    const hashToCaptureEntries = new Map<string, Array<{ id: string; timestamp: number }>>();
    for (const capture of this.captures) {
      const hashSet = new Set(capture.fingerprintHashes);
      for (const hash of hashSet) {
        let entries = hashToCaptureEntries.get(hash);
        if (!entries) {
          entries = [];
          hashToCaptureEntries.set(hash, entries);
        }
        entries.push({ id: capture.id, timestamp: capture.timestamp });
      }
    }

    // Build fingerprint stats using the inverted index (O(F) instead of O(F*C*H))
    const fingerprintStats: Record<string, FingerprintStatsData> = {};
    for (const hash of allFingerprintHashes) {
      const entries = hashToCaptureEntries.get(hash) ?? [];
      let firstSeen = Infinity;
      let lastSeen = 0;
      const captureIds: string[] = [];

      for (const entry of entries) {
        captureIds.push(entry.id);
        if (entry.timestamp < firstSeen) firstSeen = entry.timestamp;
        if (entry.timestamp > lastSeen) lastSeen = entry.timestamp;
      }

      fingerprintStats[hash] = {
        totalAppearances: captureIds.length,
        captureIds,
        firstSeen: firstSeen === Infinity ? 0 : firstSeen,
        lastSeen,
      };
    }

    // Build state candidates: group fingerprints by identical presence signature
    const stateCandidates = this.computeStateCandidates(allFingerprintHashes, hashToCaptureEntries);

    return {
      sessionId: this.sessionId!,
      exportedAt: Date.now(),
      allFingerprints: allFingerprintHashes,
      fingerprintDetails,
      presenceMatrix,
      cooccurrenceCounts,
      fingerprintStats,
      transitions: this.transitions,
      stateCandidates,
    };
  }

  private computeStateCandidates(
    allHashes: string[],
    hashToCaptureEntries: Map<string, Array<{ id: string; timestamp: number }>>
  ): StateCandidateData[] {
    // Group fingerprints by their presence signature (which captures they appear in)
    const signatureGroups = new Map<string, string[]>();

    for (const hash of allHashes) {
      // Build a signature from the inverted index (already computed)
      const entries = hashToCaptureEntries.get(hash) ?? [];
      const captureIds = entries.map((e) => e.id).sort();
      const signature = captureIds.join(',');

      const group = signatureGroups.get(signature) || [];
      group.push(hash);
      signatureGroups.set(signature, group);
    }

    // Only emit groups with 2+ fingerprints (single elements aren't useful states)
    const candidates: StateCandidateData[] = [];
    for (const [, group] of signatureGroups) {
      if (group.length < 2) continue;

      // Determine dominant position zone and landmark
      const zones = group
        .map((h) => this.allFingerprints.get(h)?.positionZone)
        .filter(Boolean) as string[];
      const landmarks = group
        .map((h) => this.allFingerprints.get(h)?.landmarkContext)
        .filter(Boolean) as string[];

      candidates.push({
        fingerprints: group.sort(),
        cooccurrenceRate: 1.0, // By definition — identical presence signature
        positionZone: mostFrequent(zones),
        landmarkContext: mostFrequent(landmarks),
      });
    }

    return candidates;
  }
}

// ============================================================================
// Utilities
// ============================================================================

let idCounter = 0;

function generateId(prefix: string): string {
  idCounter++;
  return `${prefix}-${Date.now()}-${idCounter}`;
}

function labelToCamelCase(label: string): string {
  return (
    label
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .trim()
      .split(/\s+/)
      .map((word, i) =>
        i === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      )
      .join('') || 'field'
  );
}

function mostFrequent(items: string[]): string | undefined {
  if (items.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item, (counts.get(item) || 0) + 1);
  }
  let best = items[0];
  let bestCount = 0;
  for (const [item, count] of counts) {
    if (count > bestCount) {
      best = item;
      bestCount = count;
    }
  }
  return best;
}
