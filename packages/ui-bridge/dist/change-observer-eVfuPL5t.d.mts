import { D as DOMChangeEvent } from './types-CokKlT7J.mjs';

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

interface ChangeObserverConfig {
    /** Max events in the ring buffer before drop-oldest (default: 5000) */
    bufferCapacity: number;
    /** Batching interval in ms — aggregate mutations within this window (default: 16) */
    batchIntervalMs: number;
}
declare class ChangeObserver {
    private config;
    private buffer;
    private subscribers;
    private pendingAdded;
    private pendingRemoved;
    private pendingModified;
    private batchTimer;
    constructor(config?: Partial<ChangeObserverConfig>);
    /** An element was registered (appeared in the DOM). */
    onElementAdded(elementId: string): void;
    /** An element was unregistered (removed from the DOM). */
    onElementRemoved(elementId: string): void;
    /** An element's state changed (value, visibility, etc.). */
    onElementModified(elementId: string): void;
    /** Subscribe to batched change events. Returns an unsubscribe function. */
    subscribe(callback: (event: DOMChangeEvent) => void): () => void;
    /** Number of active subscribers. */
    get subscriberCount(): number;
    /** Get buffered events since a timestamp. */
    getEventsSince(since: number, limit?: number): DOMChangeEvent[];
    /** Current buffer size. */
    get bufferSize(): number;
    /** Stop all timers and clear state. */
    destroy(): void;
    private scheduleBatchFlush;
    private flushBatch;
}

export { ChangeObserver as C, type ChangeObserverConfig as a };
