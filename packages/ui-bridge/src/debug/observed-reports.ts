/**
 * Observed-failure reports, shared by the captures that see the same failure.
 *
 * The `network` capture (a fetch that answered `>= 400`) and the
 * `resource-errors` capture (an img/script/link `error` event) record each
 * failure they REPORT here. The `resource-status` capture consumes a matching
 * report instead of emitting a second event for the same failure, so every
 * consumer — sessions, snapshots, the event stream, health, impact — sees one
 * event per failure. Matching is by failure identity (redacted absolute URL
 * plus status or element kind) and by observation time (`Date.now()` on both
 * sides), never by Resource Timing time.
 *
 * Module state: it lives and dies with the document. Bounded to
 * {@link OBSERVED_REPORT_LIMIT} entries; a report older than
 * {@link OBSERVED_REPORT_TTL_MS} matches nothing.
 */

import { redactRequestUrl } from '../network/redact-request-url';

export const OBSERVED_REPORT_LIMIT = 200;
export const OBSERVED_REPORT_TTL_MS = 30_000;

interface ObservedReport {
  key: string;
  observedAt: number;
}

let reports: ObservedReport[] = [];

/** Identity of a failure reported with an HTTP status (the network capture). */
export function statusReportKey(url: string, status: number): string {
  return `status|${redactRequestUrl(url).url}|${status}`;
}

/** Identity of a failed element load (the resource-errors capture), by tag/initiator kind. */
export function elementReportKey(url: string, kind: string): string {
  return `element|${redactRequestUrl(url).url}|${kind.toLowerCase()}`;
}

/** Record a failure a capture reported. */
export function recordObservedReport(key: string, observedAt = Date.now()): void {
  reports.push({ key, observedAt });
  if (reports.length > OBSERVED_REPORT_LIMIT) reports.shift();
}

/**
 * Consume one unconsumed report of `key` observed within the TTL of `now`.
 * Returns whether one was found.
 */
export function consumeObservedReport(key: string, now = Date.now()): boolean {
  reports = reports.filter((r) => now - r.observedAt <= OBSERVED_REPORT_TTL_MS);
  const i = reports.findIndex((r) => r.key === key);
  if (i < 0) return false;
  reports.splice(i, 1);
  return true;
}

/** Test-only: simulate a new document. */
export function __resetObservedReportsForTest(): void {
  reports = [];
}
