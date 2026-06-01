/**
 * D3 Effect Calculus — Settle Windows
 *
 * Default per-action settle bands. After an action executes the verifier waits
 * this long before capturing the post-snapshot, giving async UI effects
 * (navigation, reveals, validation) time to land before the observed delta is
 * computed.
 */

/**
 * Default settle window (ms) per standard action. Tuned so synchronous DOM
 * mutations (type/focus) settle fast while navigation/fill — which may trigger
 * async route transitions or network round-trips — wait longer.
 */
export const DEFAULT_SETTLE_MS: Record<string, number> = {
  click: 150,
  navigate: 400,
  type: 50,
  select: 150,
  wait: 0,
  evaluate: 0,
  scroll: 100,
  fill: 200,
  focus: 50,
};

/** Fallback settle window (ms) for actions with no declared band. */
export const FALLBACK_SETTLE_MS = 100;

/**
 * Resolve the settle window for an action: an explicit `override` wins, else
 * the per-action band, else {@link FALLBACK_SETTLE_MS}.
 */
export function settleMsForAction(action: string, override?: number): number {
  if (override !== undefined) return override;
  const band = DEFAULT_SETTLE_MS[action];
  if (band !== undefined) return band;
  return FALLBACK_SETTLE_MS;
}
