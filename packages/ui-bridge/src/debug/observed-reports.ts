/**
 * Observed-failure reports, shared by the captures that see the same failure.
 *
 * The `network` capture (a fetch that answered `>= 400`) and the
 * `resource-errors` capture (an img/script/link `error` event) record each
 * failure they REPORT here. The `resource-status` capture consumes a matching
 * report instead of emitting a second event for the same failure, so every
 * consumer — sessions, snapshots, the event stream, health, impact — sees one
 * event per failure.
 *
 * A report matches a Resource Timing entry by failure identity (redacted
 * absolute URL plus status or element kind) and by the entry's interval: both
 * sides are on the Resource Timing clock (`performance.now()`), and a report
 * at `at` belongs to an entry when
 * `startTime - REPORT_START_SKEW_MS <= at <= responseEnd + LATE_REPORT_MS`.
 * - A fetch reports at its response headers, inside `[startTime, responseEnd]`
 *   however long the body takes.
 * - An element's `error` fires just after `responseEnd`, inside
 *   {@link LATE_REPORT_MS}.
 * - {@link REPORT_START_SKEW_MS} absorbs a coarsened Resource Timing clock and
 *   a report taken a hair before the entry's `startTime`.
 * Nothing is measured from when the entry is delivered, so a late observer
 * batch matches as well as a prompt one. A request that started after a
 * report was recorded never matches it, so a leftover report cannot absorb a
 * later request's failure.
 *
 * Module state: it lives and dies with the document. Bounded to
 * {@link OBSERVED_REPORT_LIMIT} entries, oldest evicted first: with more than
 * that many failures reported while one slow body is in flight, that body's
 * report is evicted and its failure is emitted twice (a bounded residual).
 */

import { redactRequestUrl } from '../network/redact-request-url';

export const OBSERVED_REPORT_LIMIT = 200;
/** How far before an entry's `startTime` its report may read (clock coarsening). */
export const REPORT_START_SKEW_MS = 100;
/** How long after an entry's `responseEnd` its report may come (an element's `error`). */
export const LATE_REPORT_MS = 5_000;

interface ObservedReport {
  key: string;
  /** `performance.now()` when the failure was reported. */
  at: number;
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

/** Record a failure a capture reported, at `at` on the Resource Timing clock. */
export function recordObservedReport(key: string, at = performance.now()): void {
  reports.push({ key, at });
  if (reports.length > OBSERVED_REPORT_LIMIT) reports.shift();
}

/**
 * Consume the first unconsumed report of `key` that falls in `entry`'s
 * interval (see the module doc). Returns whether one was found.
 */
export function consumeObservedReport(
  key: string,
  entry: { startTime: number; responseEnd: number }
): boolean {
  const earliest = entry.startTime - REPORT_START_SKEW_MS;
  const latest = entry.responseEnd + LATE_REPORT_MS;
  const i = reports.findIndex((r) => r.key === key && r.at >= earliest && r.at <= latest);
  if (i < 0) return false;
  reports.splice(i, 1);
  return true;
}

/** Test-only: simulate a new document. */
export function __resetObservedReportsForTest(): void {
  reports = [];
}
