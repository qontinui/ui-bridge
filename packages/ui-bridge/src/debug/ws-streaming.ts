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

import type { AnyCapturedEvent } from './browser-capture-types';
import type { ErrorSeverity } from './error-severity';
import { classifyEvent, SEVERITY_RANK } from './error-severity';
import { computeFingerprint } from './error-fingerprint';
import { getEventStack } from './shared-utils';

// ---------------------------------------------------------------------------
// Helper: extract source location from stack (inline to avoid circular dep)
// ---------------------------------------------------------------------------

/**
 * Quick extraction of "file:line" from a stack trace's first app-level frame.
 * Delegates to the stack string directly — a lightweight version of
 * `extractSourceLocation` from error-fingerprint (imported there for
 * fingerprinting, but we keep this self-contained to avoid coupling).
 */
function extractSourceLocationFromStack(stack?: string): string | undefined {
  if (!stack) return undefined;

  const V8_FRAME_RE = /^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/;
  const SPIDERMONKEY_FRAME_RE = /^(.+?)@(.+?):(\d+):(\d+)$/;

  const SKIP_PATTERNS = [
    /node_modules/,
    /react-dom/,
    /react\.development/,
    /react\.production/,
    /webpack-internal/,
    /chrome-extension:\/\//,
    /moz-extension:\/\//,
  ];

  const lines = stack.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    const v8 = trimmed.match(V8_FRAME_RE);
    const frame = v8
      ? { file: v8[2], line: v8[3] }
      : (() => {
          const sm = trimmed.match(SPIDERMONKEY_FRAME_RE);
          return sm ? { file: sm[2], line: sm[3] } : null;
        })();

    if (frame && !SKIP_PATTERNS.some((p) => p.test(frame.file))) {
      // Strip protocol + host, keep last meaningful segments
      let clean = frame.file.split('?')[0].split('#')[0];
      clean = clean.replace(/^https?:\/\/[^/]+/, '');
      const parts = clean.split('/').filter(Boolean);
      const filename = parts.length > 3 ? parts.slice(-3).join('/') : parts.join('/');
      return `${filename}:${frame.line}`;
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Message sent to subscribers when an event passes their filters.
 */
export interface BrowserEventStreamMessage {
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
export interface StreamSubscription {
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
export interface StreamConfig {
  /** Maximum number of concurrent subscriptions (default: 10) */
  maxSubscriptions?: number;
  /** Maximum recent fingerprints to track per subscription for dedup LRU (default: 200) */
  maxRecentFingerprints?: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_MAX_SUBSCRIPTIONS = 10;
const DEFAULT_MAX_RECENT_FINGERPRINTS = 200;

// ---------------------------------------------------------------------------
// LRU fingerprint set
// ---------------------------------------------------------------------------

/**
 * Simple LRU set that evicts the oldest entry when full.
 * Used for per-subscription fingerprint deduplication.
 */
class LruFingerprintSet {
  private set = new Set<string>();
  private order: string[] = [];
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  /** Returns true if the fingerprint was already in the set. */
  has(fingerprint: string): boolean {
    return this.set.has(fingerprint);
  }

  /** Add a fingerprint. Returns true if it was new (not already present). */
  add(fingerprint: string): boolean {
    if (this.set.has(fingerprint)) {
      return false; // already seen
    }

    // Evict oldest if at capacity
    if (this.order.length >= this.maxSize) {
      const oldest = this.order.shift()!;
      this.set.delete(oldest);
    }

    this.set.add(fingerprint);
    this.order.push(fingerprint);
    return true;
  }

  /** Clear all entries. */
  clear(): void {
    this.set.clear();
    this.order = [];
  }
}

// ---------------------------------------------------------------------------
// BrowserEventStream
// ---------------------------------------------------------------------------

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
export class BrowserEventStream {
  private subscriptions = new Map<string, StreamSubscription>();
  private dedupSets = new Map<string, LruFingerprintSet>();
  private maxSubscriptions: number;
  private maxRecentFingerprints: number;

  constructor(config?: StreamConfig) {
    this.maxSubscriptions = config?.maxSubscriptions ?? DEFAULT_MAX_SUBSCRIPTIONS;
    this.maxRecentFingerprints = config?.maxRecentFingerprints ?? DEFAULT_MAX_RECENT_FINGERPRINTS;
  }

  // -----------------------------------------------------------------------
  // Subscription management
  // -----------------------------------------------------------------------

  /**
   * Create a new subscription with optional filters.
   *
   * Returns the full subscription object with an auto-generated `id`.
   * Throws if the maximum number of subscriptions has been reached.
   */
  subscribe(options?: Partial<Omit<StreamSubscription, 'id'>>): StreamSubscription {
    if (this.subscriptions.size >= this.maxSubscriptions) {
      throw new Error(
        `Maximum subscriptions reached (${this.maxSubscriptions}). ` +
          'Unsubscribe from an existing subscription first.'
      );
    }

    const id = `stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const subscription: StreamSubscription = {
      id,
      ...options,
    };

    this.subscriptions.set(id, subscription);

    // Initialize dedup LRU set if deduplication is enabled
    if (subscription.deduplicate) {
      this.dedupSets.set(id, new LruFingerprintSet(this.maxRecentFingerprints));
    }

    return subscription;
  }

  /**
   * Remove a subscription by ID.
   *
   * Returns true if the subscription existed and was removed.
   */
  unsubscribe(id: string): boolean {
    const existed = this.subscriptions.delete(id);
    this.dedupSets.delete(id);
    return existed;
  }

  /**
   * Get all active subscriptions.
   */
  getSubscriptions(): StreamSubscription[] {
    return Array.from(this.subscriptions.values());
  }

  // -----------------------------------------------------------------------
  // Event processing
  // -----------------------------------------------------------------------

  /**
   * Process a single browser event through all subscriptions.
   *
   * Classifies the event, computes its fingerprint, and checks each
   * subscription's filters. Returns a map of subscription-id to message
   * for only those subscriptions that should receive this event.
   *
   * The caller is responsible for sending the messages over WebSocket.
   */
  processEvent(event: AnyCapturedEvent): Map<string, BrowserEventStreamMessage> {
    const { severity, reason } = classifyEvent(event);
    const fingerprint = computeFingerprint(event);
    const sourceLocation = extractSourceLocationFromStack(getEventStack(event));

    const message: BrowserEventStreamMessage = {
      event,
      severity,
      reason,
      fingerprint,
      ...(sourceLocation !== undefined ? { sourceLocation } : {}),
    };

    const results = new Map<string, BrowserEventStreamMessage>();

    for (const [id, subscription] of this.subscriptions) {
      if (!this.shouldDeliver(subscription, event, severity, fingerprint)) {
        continue;
      }

      results.set(id, message);
    }

    return results;
  }

  /**
   * Process a batch of browser events through all subscriptions.
   *
   * Returns a map of subscription-id to an array of messages. Only
   * subscriptions that receive at least one event appear in the map.
   */
  processEvents(events: AnyCapturedEvent[]): Map<string, BrowserEventStreamMessage[]> {
    const results = new Map<string, BrowserEventStreamMessage[]>();

    for (const event of events) {
      const perEvent = this.processEvent(event);

      for (const [subId, message] of perEvent) {
        let messages = results.get(subId);
        if (!messages) {
          messages = [];
          results.set(subId, messages);
        }
        messages.push(message);
      }
    }

    return results;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Check whether a subscription should receive a specific event.
   *
   * Evaluates in order:
   * 1. Severity filter (minSeverity)
   * 2. Event type filter (eventTypes)
   * 3. Deduplication (fingerprint LRU)
   */
  private shouldDeliver(
    subscription: StreamSubscription,
    event: AnyCapturedEvent,
    severity: ErrorSeverity,
    fingerprint: string
  ): boolean {
    // 1. Severity filter: event must be at or above the minimum severity
    if (subscription.minSeverity) {
      if (!this.meetsMinSeverity(severity, subscription.minSeverity)) {
        return false;
      }
    }

    // 2. Event type filter: event type must be in the allowed list
    if (subscription.eventTypes && subscription.eventTypes.length > 0) {
      if (!subscription.eventTypes.includes(event.type)) {
        return false;
      }
    }

    // 3. Deduplication: suppress events with already-seen fingerprints
    if (subscription.deduplicate) {
      const dedupSet = this.dedupSets.get(subscription.id);
      if (dedupSet) {
        const isNew = dedupSet.add(fingerprint);
        if (!isNew) {
          return false; // already seen this fingerprint
        }
      }
    }

    return true;
  }

  /**
   * Check if an event's severity meets the minimum severity threshold.
   *
   * A lower rank number means more severe. "minSeverity: 'warning'"
   * means crash (0), error (1), and warning (2) pass, but noise (3) does not.
   */
  private meetsMinSeverity(eventSeverity: ErrorSeverity, minSeverity: ErrorSeverity): boolean {
    return SEVERITY_RANK[eventSeverity] <= SEVERITY_RANK[minSeverity];
  }
}
