/**
 * Shared utilities for the debug module.
 *
 * Common helpers extracted to avoid duplication across debug sub-modules.
 */

import type { AnyCapturedEvent } from './browser-capture-types';

/**
 * Extract the stack trace from an event, if the event carries one.
 */
export function getEventStack(event: AnyCapturedEvent): string | undefined {
  if ('stack' in event) return event.stack;
  return undefined;
}
