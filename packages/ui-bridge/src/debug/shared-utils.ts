/**
 * Shared utilities for the debug module.
 *
 * Common helpers extracted to avoid duplication across debug sub-modules.
 */

import type { AnyCapturedEvent, ResourceStatusCapturedEvent } from './browser-capture-types';

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
