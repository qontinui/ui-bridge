/**
 * Readers for a media row's {@link MediaObservation} — the envelope
 * `captureMediaMetadata` produces and every find / snapshot surface carries as
 * `mediaMetadata`.
 *
 * Pure and DOM-free on purpose: the canonical find filter runs these in the
 * page (executor, server handler, live relay) AND server-side over a relay's
 * cached snapshot, where the rows are plain JSON.
 */

import { isUnknownCode, type UnknownCode } from '../observation/observation';
import type { MediaFacts, MediaFactsDimension, MediaObservation } from './types';

/**
 * Is `value` an observation envelope — a `status` the envelope defines plus a
 * provenance block? A bare legacy `MediaMetadata` object (an SDK build that
 * predates the envelope) is NOT, which is how a reader tells "this producer
 * cannot answer media questions" apart from "this image measured nothing".
 */
export function isMediaObservation(value: unknown): value is MediaObservation {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as { status?: unknown; provenance?: unknown };
  return (
    (v.status === 'measured' || v.status === 'absent' || v.status === 'unknown') &&
    v.provenance !== null &&
    typeof v.provenance === 'object'
  );
}

/**
 * The facts a `measured` media observation carries, or `undefined` when the
 * observation is `unknown` / `absent` or is not an envelope at all. Callers
 * that must distinguish those cases read {@link isMediaObservation} first.
 */
export function mediaFactsOf(value: unknown): MediaFacts | undefined {
  if (!isMediaObservation(value) || value.status !== 'measured') return undefined;
  return value.value;
}

/**
 * The code recorded for `dimension` in the observation's
 * `coverage.unmeasured`, or `undefined` when the producer did not list it —
 * i.e. the field was measured, or does not apply to this media type.
 */
export function unmeasuredMediaDimension(
  obs: MediaObservation,
  dimension: MediaFactsDimension
): UnknownCode | undefined {
  const entry = obs.provenance.coverage.unmeasured.find((u) => u.dimension === dimension);
  return entry && isUnknownCode(entry.code) ? entry.code : undefined;
}
