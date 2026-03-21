/**
 * Push-Based Change Observer
 *
 * Inspired by folk-js/allio's hybrid push-pull observation model.
 * Hooks into the existing registry's element events and batches them
 * into DOMChangeEvent objects for efficient downstream consumption.
 *
 * Rather than polling for changes, consumers subscribe to batched
 * subtree-change events that aggregate mutations within a configurable
 * batching window (default: 16ms — one animation frame).
 */

import type { DOMChangeEvent } from '../server/types';

// Re-export for convenience
export type { DOMChangeEvent } from '../server/types';

// ============================================================================
// Configuration
// ============================================================================

export interface ChangeObserverConfig {
  /** Max events in the ring buffer before drop-oldest (default: 5000) */
  bufferCapacity: number;
  /** Batching interval in ms — aggregate mutations within this window (default: 16) */
  batchIntervalMs: number;
}

const DEFAULT_CONFIG: ChangeObserverConfig = {
  bufferCapacity: 5000,
  batchIntervalMs: 16,
};

// ============================================================================
// ChangeObserver
// ============================================================================

export class ChangeObserver {
  private config: ChangeObserverConfig;
  private buffer: DOMChangeEvent[] = [];
  private subscribers = new Set<(event: DOMChangeEvent) => void>();

  // Pending batch accumulation
  private pendingAdded = new Set<string>();
  private pendingRemoved = new Set<string>();
  private pendingModified = new Set<string>();
  private batchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config?: Partial<ChangeObserverConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ==========================================================================
  // Event Ingestion — called by the registry or DOM observers
  // ==========================================================================

  /** An element was registered (appeared in the DOM). */
  onElementAdded(elementId: string): void {
    this.pendingAdded.add(elementId);
    // If something was added that was previously pending removal, cancel the removal
    this.pendingRemoved.delete(elementId);
    this.scheduleBatchFlush();
  }

  /** An element was unregistered (removed from the DOM). */
  onElementRemoved(elementId: string): void {
    this.pendingRemoved.add(elementId);
    // If something was removed that was pending addition, cancel both
    if (this.pendingAdded.delete(elementId)) {
      this.pendingRemoved.delete(elementId);
    }
    this.scheduleBatchFlush();
  }

  /** An element's state changed (value, visibility, etc.). */
  onElementModified(elementId: string): void {
    // Don't track modifications for elements in the add/remove sets
    if (!this.pendingAdded.has(elementId) && !this.pendingRemoved.has(elementId)) {
      this.pendingModified.add(elementId);
    }
    this.scheduleBatchFlush();
  }

  // ==========================================================================
  // Subscription
  // ==========================================================================

  /** Subscribe to batched change events. Returns an unsubscribe function. */
  subscribe(callback: (event: DOMChangeEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /** Number of active subscribers. */
  get subscriberCount(): number {
    return this.subscribers.size;
  }

  // ==========================================================================
  // Buffer Access
  // ==========================================================================

  /** Get buffered events since a timestamp. */
  getEventsSince(since: number, limit = 100): DOMChangeEvent[] {
    return this.buffer.filter((e) => e.timestamp > since).slice(-limit);
  }

  /** Current buffer size. */
  get bufferSize(): number {
    return this.buffer.length;
  }

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  /** Stop all timers and clear state. */
  destroy(): void {
    if (this.batchTimer !== null) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    this.pendingAdded.clear();
    this.pendingRemoved.clear();
    this.pendingModified.clear();
    this.subscribers.clear();
    this.buffer.length = 0;
  }

  // ==========================================================================
  // Internal
  // ==========================================================================

  private scheduleBatchFlush(): void {
    if (this.batchTimer !== null) return; // already scheduled
    this.batchTimer = setTimeout(() => {
      this.batchTimer = null;
      this.flushBatch();
    }, this.config.batchIntervalMs);
  }

  private flushBatch(): void {
    const added = Array.from(this.pendingAdded);
    const removed = Array.from(this.pendingRemoved);
    const modified = Array.from(this.pendingModified);

    this.pendingAdded.clear();
    this.pendingRemoved.clear();
    this.pendingModified.clear();

    // Nothing to emit
    if (added.length === 0 && removed.length === 0 && modified.length === 0) return;

    const event: DOMChangeEvent = {
      type: 'subtreeChanged',
      timestamp: Date.now(),
      added,
      removed,
      modified,
    };

    // Add to ring buffer
    this.buffer.push(event);
    if (this.buffer.length > this.config.bufferCapacity) {
      this.buffer.splice(0, this.buffer.length - this.config.bufferCapacity);
    }

    // Notify subscribers
    for (const sub of this.subscribers) {
      try {
        sub(event);
      } catch {
        // Subscriber errors are non-fatal
      }
    }
  }
}
