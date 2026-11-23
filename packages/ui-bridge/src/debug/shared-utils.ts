/**
 * Shared utilities for the debug module.
 *
 * Common helpers extracted to avoid duplication across debug sub-modules.
 */

import type { AnyCapturedEvent, ResourceStatusCapturedEvent } from './browser-capture-types';
import { redactRequestUrl } from '../network/redact-request-url';

/**
 * Extract the stack trace from an event, if the event carries one.
 */
export function getEventStack(event: AnyCapturedEvent): string | undefined {
  if ('stack' in event) return event.stack;
  return undefined;
}

/**
 * Describe a `resource-status` event in one line.
 */
export function describeResourceStatus(event: ResourceStatusCapturedEvent): string {
  switch (event.kind) {
    case 'status':
      return `${event.initiatorType} ${event.resourceUrl} → ${event.responseStatus ?? 'status unknown'}`;
    case 'observer-unavailable':
      return 'Resource statuses unobservable in this webview';
    case 'buffer-full':
      return `Resource timing buffer full (${event.resourceEntryCount} entries): earlier statuses may be missing`;
    case 'unknown-status-capped':
      return `Over ${event.budget} resources with an unreported status`;
  }
}

/** How far apart (ms) a resource-status event and the report it duplicates may be. */
export const OBSERVED_DUPLICATE_WINDOW_MS = 5_000;

/**
 * Drop each `resource-status` event that duplicates a failure another capture
 * OBSERVED and reported: a `network` event for the same absolute redacted URL
 * and status, or a `resource-error` event for the same URL and element kind
 * (`IMG` ↔ initiator `img`), within {@link OBSERVED_DUPLICATE_WINDOW_MS}. Each
 * report absorbs at most one resource-status event, so two failures stay two.
 * A resource-status event nothing else reported — a request before install, a
 * URL the network capture ignores, an XHR, a detached `new Image()` — keeps
 * full weight. A previous document's event is never matched: its reports left
 * with that document. Use wherever issues are COUNTED.
 */
export function withoutObservedDuplicates(events: AnyCapturedEvent[]): AnyCapturedEvent[] {
  const reports = new Map<string, number[]>();
  const addReport = (key: string, timestamp: number) => {
    const list = reports.get(key);
    if (list) list.push(timestamp);
    else reports.set(key, [timestamp]);
  };
  for (const e of events) {
    if (e.type === 'network' && e.status !== undefined) {
      addReport(`status|${redactRequestUrl(e.requestUrl).url}|${e.status}`, e.timestamp);
    } else if (e.type === 'resource-error') {
      addReport(
        `element|${redactRequestUrl(e.resourceUrl).url}|${e.tagName.toLowerCase()}`,
        e.timestamp
      );
    }
  }
  if (reports.size === 0) return events;

  const absorb = (key: string, timestamp: number): boolean => {
    const list = reports.get(key);
    const i = list?.findIndex((t) => Math.abs(t - timestamp) <= OBSERVED_DUPLICATE_WINDOW_MS) ?? -1;
    if (i < 0) return false;
    list!.splice(i, 1);
    return true;
  };
  return events.filter((e) => {
    if (e.type !== 'resource-status' || e.kind !== 'status' || e.fromPreviousDocument) return true;
    if (e.responseStatus === null) return true;
    const duplicate =
      absorb(`status|${e.resourceUrl}|${e.responseStatus}`, e.timestamp) ||
      absorb(`element|${e.resourceUrl}|${e.initiatorType}`, e.timestamp);
    return !duplicate;
  });
}
