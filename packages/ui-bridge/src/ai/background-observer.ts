/**
 * Background Observer — Continuous background capture for white-box UI Bridge apps.
 *
 * Inspired by screenpipe's continuous capture, adapted for UI Bridge's rich observation.
 * Periodically captures semantic snapshots and emits them when significant changes are
 * detected. Results are intended for the activity timeline (searchable capture history).
 *
 * Unlike ChangeTracker (which is action-integrated), BackgroundObserver runs independently
 * and captures changes as they happen — even when no automation is running.
 *
 * @example
 * ```ts
 * const observer = new BackgroundObserver({
 *   snapshotManager,
 *   createControlSnapshot: () => registry.captureSnapshot(),
 *   onCapture: async (payload) => {
 *     await fetch('/api/activity-timeline', { method: 'POST', body: JSON.stringify(payload) });
 *   },
 * });
 * observer.start();
 * // ... later ...
 * observer.stop();
 * ```
 */

import { computeDiff, hasSignificantChanges } from './semantic-diff';
import type { SemanticSnapshotManager } from './semantic-snapshot';
import type { ControlSnapshot } from '../control/types';
import type { SemanticSnapshot } from './types';

/**
 * Payload emitted when a background capture detects meaningful changes.
 * Matches the ActivityTimelineInput structure on the Rust side.
 */
export interface TimelineCapturePayload {
  /** Concatenated text from all visible elements. */
  textContent: string;
  /** SHA-256 of normalized textContent for deduplication. */
  contentHash: string;
  /** Always 'ui_bridge' for BackgroundObserver. */
  sourceType: 'ui_bridge';
  /** Always 'white_box' for UI Bridge apps. */
  captureMode: 'white_box';
  /** Application name (from page context). */
  appName: string;
  /** Window/page title. */
  windowTitle: string;
  /** Page URL. */
  url: string;
  /** Number of elements in snapshot. */
  elementCount: number;
  /** Metadata JSON (page type, form count, modal count, change summary). */
  metadataJson: string;
}

export interface BackgroundObserverConfig {
  /** Minimum interval between captures in ms. Default: 5000. */
  minCaptureIntervalMs?: number;
  /** Maximum interval before forcing a capture in ms. Default: 60000. */
  maxCaptureIntervalMs?: number;
  /** Max consecutive tick failures before auto-stopping. Default: 10. */
  maxConsecutiveErrors?: number;
}

export interface BackgroundObserverDeps {
  /** Snapshot manager for creating semantic snapshots. */
  snapshotManager: SemanticSnapshotManager;
  /** Factory for creating control snapshots from the registry. */
  createControlSnapshot: () => ControlSnapshot;
  /** Callback invoked when a meaningful capture is detected. */
  onCapture: (payload: TimelineCapturePayload) => Promise<void>;
}

const DEFAULT_CONFIG: Required<BackgroundObserverConfig> = {
  minCaptureIntervalMs: 5000,
  maxCaptureIntervalMs: 60000,
  maxConsecutiveErrors: 10,
};

/**
 * Continuous background observer that captures UI state changes
 * and emits them as timeline entries for the activity timeline.
 */
export class BackgroundObserver {
  private readonly config: Required<BackgroundObserverConfig>;
  private readonly deps: BackgroundObserverDeps;

  private intervalId: ReturnType<typeof setInterval> | null = null;
  private lastSnapshot: SemanticSnapshot | null = null;
  private lastContentHash: string | null = null;
  private lastCaptureTime: number = 0;
  private running = false;
  private consecutiveErrors = 0;

  constructor(deps: BackgroundObserverDeps, config: BackgroundObserverConfig = {}) {
    this.deps = deps;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Start background observation. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastCaptureTime = Date.now();

    // Take initial snapshot immediately
    void this.tick();

    // Poll at minCaptureInterval
    this.intervalId = setInterval(() => {
      void this.tick();
    }, this.config.minCaptureIntervalMs);
  }

  /** Stop background observation. */
  stop(): void {
    this.running = false;
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /** Whether the observer is currently running. */
  get isRunning(): boolean {
    return this.running;
  }

  private async tick(): Promise<void> {
    if (!this.running) return;

    try {
      const controlSnapshot = this.deps.createControlSnapshot();
      const snapshot = this.deps.snapshotManager.createSnapshot(controlSnapshot);

      const now = Date.now();
      const timeSinceLastCapture = now - this.lastCaptureTime;
      const forceCapture = timeSinceLastCapture >= this.config.maxCaptureIntervalMs;

      // Check for significant changes
      let isSignificant = false;
      if (this.lastSnapshot) {
        const diff = computeDiff(this.lastSnapshot, snapshot);
        isSignificant = hasSignificantChanges(diff);
      } else {
        // First snapshot is always significant
        isSignificant = true;
      }

      if (!isSignificant && !forceCapture) {
        return;
      }

      // Serialize snapshot to text for FTS indexing
      const textContent = this.serializeSnapshotText(snapshot);
      const contentHash = await this.computeHash(textContent);

      // Content-level dedup (skip if hash matches previous)
      if (contentHash === this.lastContentHash && !forceCapture) {
        return;
      }

      // Build payload
      const payload: TimelineCapturePayload = {
        textContent,
        contentHash,
        sourceType: 'ui_bridge',
        captureMode: 'white_box',
        appName: snapshot.page.title || 'Unknown',
        windowTitle: snapshot.page.title || '',
        url: snapshot.page.url || '',
        elementCount: snapshot.elements.length,
        metadataJson: JSON.stringify({
          pageType: snapshot.page.pageType,
          formCount: snapshot.forms?.length || 0,
          modalCount: snapshot.activeModals?.length || 0,
          elementCounts: snapshot.elementCounts,
          snapshotId: snapshot.snapshotId,
        }),
      };

      // Emit
      await this.deps.onCapture(payload);

      // Update state
      this.lastSnapshot = snapshot;
      this.lastContentHash = contentHash;
      this.lastCaptureTime = now;
      this.consecutiveErrors = 0;
    } catch (err) {
      this.consecutiveErrors++;
      console.warn(`[BackgroundObserver] Capture failed (${this.consecutiveErrors}):`, err);
      if (this.consecutiveErrors >= this.config.maxConsecutiveErrors) {
        console.error('[BackgroundObserver] Too many consecutive errors, stopping.');
        this.stop();
      }
    }
  }

  /**
   * Serialize a semantic snapshot's visible text for full-text search indexing.
   * Concatenates element descriptions, text content, form labels, and modal content.
   */
  private serializeSnapshotText(snapshot: SemanticSnapshot): string {
    const parts: string[] = [];

    // Page context
    if (snapshot.page?.title) parts.push(snapshot.page.title);
    if (snapshot.page?.url) parts.push(snapshot.page.url);

    // Element text (descriptions + textContent)
    for (const el of snapshot.elements) {
      if (el.description) parts.push(el.description);
      if (el.state?.textContent) parts.push(el.state.textContent);
      if (el.state?.value) parts.push(el.state.value);
    }

    // Form labels
    for (const form of snapshot.forms || []) {
      for (const field of form.fields || []) {
        if (field.label) parts.push(field.label);
        if (field.value) parts.push(String(field.value));
      }
    }

    // Modal content
    for (const modal of snapshot.activeModals || []) {
      if (modal.title) parts.push(modal.title);
    }

    return parts.join(' ');
  }

  /**
   * Compute SHA-256 hash of normalized text.
   * Uses crypto.subtle when available (secure contexts), falls back to a
   * simple string hash for HTTP dev environments. The fallback is not
   * cryptographically secure but sufficient for deduplication.
   */
  private async computeHash(text: string): Promise<string> {
    const normalized = text.trim().toLowerCase();

    // crypto.subtle is only available in secure contexts (HTTPS/localhost)
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const encoder = new TextEncoder();
      const data = encoder.encode(normalized);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    }

    // Fallback: FNV-1a-like hash (not cryptographic, but good for dedup)
    let hash = 0x811c9dc5;
    for (let i = 0; i < normalized.length; i++) {
      hash ^= normalized.charCodeAt(i);
      hash = (hash * 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  }
}
