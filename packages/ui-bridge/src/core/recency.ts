/**
 * Recency Model for Snapshot Freshness Control
 *
 * Inspired by folk-js/allio's Recency enum. Lets callers specify freshness
 * requirements per-request instead of relying on a flat TTL.
 *
 * - `Any`        — accept any cached value (zero-latency hot path)
 * - `Current`    — always fetch fresh from the browser
 * - `MaxAge(ms)` — accept cache if younger than `ms`, otherwise fetch
 */

// ============================================================================
// Types
// ============================================================================

export type Recency =
  | { readonly kind: 'any' }
  | { readonly kind: 'current' }
  | { readonly kind: 'maxAge'; readonly ms: number };

// ============================================================================
// Constructors
// ============================================================================

/** Accept any cached value — no relay command issued. */
const Any: Recency = Object.freeze({ kind: 'any' as const });

/** Always fetch fresh from the browser. */
const Current: Recency = Object.freeze({ kind: 'current' as const });

/** Accept cache if younger than `ms` milliseconds, otherwise fetch. */
function MaxAge(ms: number): Recency {
  return Object.freeze({ kind: 'maxAge' as const, ms });
}

/** Backward-compatible default — equivalent to the previous flat 5 s TTL. */
const Default: Recency = MaxAge(5000);

export const Recency = { Any, Current, MaxAge, Default } as const;

// ============================================================================
// Utilities
// ============================================================================

/** Does the cached value (aged `ageMs`) satisfy this recency requirement? */
export function isSatisfiedBy(recency: Recency, ageMs: number): boolean {
  switch (recency.kind) {
    case 'any':
      return true;
    case 'current':
      return false;
    case 'maxAge':
      return ageMs <= recency.ms;
  }
}

/** Will this recency *always* require a fetch (i.e. `Current`)? */
export function requiresFetch(recency: Recency): boolean {
  return recency.kind === 'current';
}

/** Could this recency require a fetch depending on cache age? */
export function mightRequireFetch(recency: Recency): boolean {
  return recency.kind !== 'any';
}

// ============================================================================
// Parsing
// ============================================================================

/**
 * Parse a Recency value from HTTP query params or request body.
 *
 * Accepted formats:
 *   - `"any"`     → Recency.Any
 *   - `"current"` → Recency.Current
 *   - `"2000"`    → Recency.MaxAge(2000)
 *   - absent/null → Recency.Default  (MaxAge 5000 — backward-compatible)
 */
export function parseRecency(value: string | number | undefined | null): Recency {
  if (value === undefined || value === null) return Recency.Default;
  if (value === 'any') return Recency.Any;
  if (value === 'current') return Recency.Current;
  const ms = typeof value === 'number' ? value : parseInt(value, 10);
  if (!isNaN(ms) && ms > 0) return Recency.MaxAge(ms);
  return Recency.Default;
}
