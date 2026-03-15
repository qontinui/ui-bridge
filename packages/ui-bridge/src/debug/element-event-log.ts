/**
 * Element Event Log
 *
 * Query/projection layer over the bridge event stream, scoped by element ID.
 * Uses a single shared ring buffer to avoid per-element memory allocation.
 */

import type {
  BridgeEvent,
  BridgeEventType,
  ElementLogLevel,
  ElementLogEntry,
  ElementHistoryOptions,
  ElementEventLogConfig,
} from '../core/types';

/**
 * Numeric ranking for log levels. Lower = more severe.
 * An entry is captured when classifiedRank <= effectiveRank.
 */
const LEVEL_RANK: Record<ElementLogLevel, number> = {
  silent: 0,
  error: 1,
  info: 2,
  debug: 3,
};

/**
 * Event types classified as errors
 */
const ERROR_EVENTS: Set<BridgeEventType> = new Set([
  'action:failed',
  'workflow:failed',
  'error',
  'browser:error',
  'browser:crash',
]);

/**
 * Event types classified as info
 */
const INFO_EVENTS: Set<BridgeEventType> = new Set([
  'action:started',
  'action:completed',
  'element:stateChanged',
  'workflow:started',
  'workflow:stepCompleted',
  'workflow:completed',
]);

let entryCounter = 0;

/**
 * Classify a bridge event type into a log level.
 */
function classifyLevel(eventType: BridgeEventType): ElementLogLevel {
  if (ERROR_EVENTS.has(eventType)) return 'error';
  if (INFO_EVENTS.has(eventType)) return 'info';
  return 'debug';
}

/**
 * Extract an element ID from event data, or undefined if not element-scoped.
 */
function extractElementId(eventType: BridgeEventType, data: unknown): string | undefined {
  if (data == null || typeof data !== 'object') return undefined;
  const d = data as Record<string, unknown>;

  // element:registered / element:unregistered → data.id
  if (eventType === 'element:registered' || eventType === 'element:unregistered') {
    return typeof d.id === 'string' ? d.id : undefined;
  }

  // All others → data.elementId
  return typeof d.elementId === 'string' ? d.elementId : undefined;
}

/**
 * Build a human-readable message for the log entry.
 */
function buildMessage(eventType: BridgeEventType, elementId: string, data: unknown): string {
  const d = data as Record<string, unknown> | null;
  switch (eventType) {
    case 'action:failed':
      return `Action failed on ${elementId}: ${d?.error ?? 'unknown error'}`;
    case 'action:started':
      return `Action started on ${elementId}: ${d?.action ?? ''}`;
    case 'action:completed':
      return `Action completed on ${elementId}: ${d?.action ?? ''}`;
    case 'element:registered':
      return `Element registered: ${elementId}`;
    case 'element:unregistered':
      return `Element unregistered: ${elementId}`;
    case 'element:stateChanged':
      return `State changed: ${elementId}`;
    default:
      return `${eventType} on ${elementId}`;
  }
}

export { type ElementEventLogConfig };

/**
 * Element Event Log
 *
 * Ingests bridge events, tags them by element ID, and stores them in a shared
 * ring buffer. Provides per-element history queries with filtering.
 */
export class ElementEventLog {
  private buffer: ElementLogEntry[] = [];
  private maxEntries: number;
  private defaultLevel: ElementLogLevel;
  private levelOverrides = new Map<string, ElementLogLevel>();

  constructor(config: ElementEventLogConfig = {}) {
    this.maxEntries = config.maxEntries ?? 2000;
    this.defaultLevel = config.defaultLogLevel ?? 'error';
  }

  /**
   * Ingest a bridge event. Extracts element ID, classifies level,
   * gates against the effective level, and appends to the shared buffer.
   */
  ingest(event: BridgeEvent): void {
    const elementId = extractElementId(event.type, event.data);
    if (!elementId) return;

    const level = classifyLevel(event.type);
    const effectiveLevel = this.getElementLogLevel(elementId);
    if (LEVEL_RANK[level] > LEVEL_RANK[effectiveLevel]) return;

    const entry: ElementLogEntry = {
      id: `eel-${++entryCounter}`,
      elementId,
      eventType: event.type,
      level,
      timestamp: event.timestamp,
      message: buildMessage(event.type, elementId, event.data),
      data: event.data,
    };

    this.buffer.push(entry);
    while (this.buffer.length > this.maxEntries) {
      this.buffer.shift();
    }
  }

  /**
   * Query the history for a specific element.
   */
  getHistory(elementId: string, options: ElementHistoryOptions = {}): ElementLogEntry[] {
    const { eventTypes, minLevel, since, limit, order = 'asc' } = options;
    const minRank = minLevel ? LEVEL_RANK[minLevel] : 0;

    let results: ElementLogEntry[] = [];

    for (const entry of this.buffer) {
      if (entry.elementId !== elementId) continue;
      if (since !== undefined && entry.timestamp < since) continue;
      if (eventTypes && !eventTypes.includes(entry.eventType)) continue;
      if (minLevel && LEVEL_RANK[entry.level] > minRank) continue;
      results.push(entry);
    }

    if (order === 'desc') {
      results.reverse();
    }

    if (limit !== undefined && results.length > limit) {
      results = results.slice(0, limit);
    }

    return results;
  }

  /**
   * Set a per-element log level override.
   */
  setElementLogLevel(elementId: string, level: ElementLogLevel): void {
    this.levelOverrides.set(elementId, level);
  }

  /**
   * Get the effective log level for an element.
   */
  getElementLogLevel(elementId: string): ElementLogLevel {
    return this.levelOverrides.get(elementId) ?? this.defaultLevel;
  }

  /**
   * Remove per-element override and clean up. Entries age out via FIFO.
   */
  removeElement(elementId: string): void {
    this.levelOverrides.delete(elementId);
  }

  /**
   * Clear all entries and overrides.
   */
  clear(): void {
    this.buffer.length = 0;
    this.levelOverrides.clear();
  }

  /**
   * Get stats about the current buffer.
   */
  getStats(): { totalEntries: number; uniqueElements: number; oldestTimestamp: number | null } {
    const uniqueElements = new Set<string>();
    for (const entry of this.buffer) {
      uniqueElements.add(entry.elementId);
    }
    return {
      totalEntries: this.buffer.length,
      uniqueElements: uniqueElements.size,
      oldestTimestamp: this.buffer.length > 0 ? this.buffer[0].timestamp : null,
    };
  }
}
