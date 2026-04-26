import { E as ErrorSeverity, i as AnyCapturedEvent } from './types-svkOxfrJ.js';

/**
 * WebSocket Real-Time Streaming for Browser Events
 *
 * Transport-agnostic streaming layer that handles filtering, classification,
 * and deduplication of browser events for real-time subscribers. The caller
 * (server adapter) is responsible for sending messages over the actual
 * WebSocket connection.
 *
 * Phase 4.13 from the console capture plan.
 */

/**
 * Message sent to subscribers when an event passes their filters.
 */
interface BrowserEventStreamMessage {
    event: AnyCapturedEvent;
    severity: ErrorSeverity;
    /** Short reason for the severity classification */
    reason: string;
    /** Stable fingerprint hash for deduplication / grouping */
    fingerprint: string;
    /** Source location (file:line) extracted from the event's stack trace */
    sourceLocation?: string;
}
/**
 * Configuration for a single subscriber.
 */
interface StreamSubscription {
    /** Auto-generated unique identifier */
    id: string;
    /** Filter: only stream events at or above this severity (default: all) */
    minSeverity?: ErrorSeverity;
    /** Filter: only stream events of these types (default: all) */
    eventTypes?: string[];
    /** Suppress events with already-seen fingerprints (default: false) */
    deduplicate?: boolean;
}
/**
 * Configuration for the BrowserEventStream.
 */
interface StreamConfig {
    /** Maximum number of concurrent subscriptions (default: 10) */
    maxSubscriptions?: number;
    /** Maximum recent fingerprints to track per subscription for dedup LRU (default: 200) */
    maxRecentFingerprints?: number;
}
/**
 * Transport-agnostic browser event streaming layer.
 *
 * Handles severity classification, subscription-based filtering, and
 * fingerprint deduplication. Does NOT manage WebSocket connections or
 * send messages — the caller (server adapter) is responsible for that.
 *
 * Usage:
 * ```ts
 * const stream = new BrowserEventStream();
 * const sub = stream.subscribe({ minSeverity: 'warning', deduplicate: true });
 *
 * // When a browser event is captured:
 * const messages = stream.processEvent(event);
 * for (const [subId, message] of messages) {
 *   wsSend(subId, message); // caller sends over WebSocket
 * }
 * ```
 */
declare class BrowserEventStream {
    private subscriptions;
    private dedupSets;
    private maxSubscriptions;
    private maxRecentFingerprints;
    constructor(config?: StreamConfig);
    /**
     * Create a new subscription with optional filters.
     *
     * Returns the full subscription object with an auto-generated `id`.
     * Throws if the maximum number of subscriptions has been reached.
     */
    subscribe(options?: Partial<Omit<StreamSubscription, 'id'>>): StreamSubscription;
    /**
     * Remove a subscription by ID.
     *
     * Returns true if the subscription existed and was removed.
     */
    unsubscribe(id: string): boolean;
    /**
     * Get all active subscriptions.
     */
    getSubscriptions(): StreamSubscription[];
    /**
     * Process a single browser event through all subscriptions.
     *
     * Classifies the event, computes its fingerprint, and checks each
     * subscription's filters. Returns a map of subscription-id to message
     * for only those subscriptions that should receive this event.
     *
     * The caller is responsible for sending the messages over WebSocket.
     */
    processEvent(event: AnyCapturedEvent): Map<string, BrowserEventStreamMessage>;
    /**
     * Process a batch of browser events through all subscriptions.
     *
     * Returns a map of subscription-id to an array of messages. Only
     * subscriptions that receive at least one event appear in the map.
     */
    processEvents(events: AnyCapturedEvent[]): Map<string, BrowserEventStreamMessage[]>;
    /**
     * Check whether a subscription should receive a specific event.
     *
     * Evaluates in order:
     * 1. Severity filter (minSeverity)
     * 2. Event type filter (eventTypes)
     * 3. Deduplication (fingerprint LRU)
     */
    private shouldDeliver;
    /**
     * Check if an event's severity meets the minimum severity threshold.
     *
     * A lower rank number means more severe. "minSeverity: 'warning'"
     * means crash (0), error (1), and warning (2) pass, but noise (3) does not.
     */
    private meetsMinSeverity;
}

export { BrowserEventStream as B, type StreamSubscription as S, type BrowserEventStreamMessage as a, type StreamConfig as b };
