/**
 * The interaction states `captureStateVariations` can apply, and the request
 * check every `getElementStateStyles` door runs against them.
 *
 * DOM-free on purpose: the relay server validates a request here before it
 * queues the command to a tab, so a caller's mistake is answered even when no
 * tab is connected, or the tab runs an SDK that predates the check.
 */

import type { InteractionStateName } from '../core/types';

/**
 * Interaction states to cycle through for state variation capture
 */
export const INTERACTION_STATES: readonly InteractionStateName[] = [
  'hover',
  'focus',
  'focus-visible',
  'active',
  'disabled',
];

/**
 * The entries of a caller's `states` list that name no interaction state.
 *
 * `captureStateVariations` applies nothing for an unknown name, so without
 * this check a typo such as `focus_visible` comes back as the DEFAULT styles
 * labelled with the typo, which reads like a real state measurement. Every
 * `getElementStateStyles` door refuses a request that has any, naming the
 * accepted states. `'default'` is accepted: it is always read, and a list
 * that names it is not wrong.
 */
export function unknownInteractionStates(states: readonly unknown[]): string[] {
  return states
    .filter(
      (s) =>
        s !== 'default' &&
        !(typeof s === 'string' && (INTERACTION_STATES as readonly string[]).includes(s))
    )
    .map((s) => (typeof s === 'string' ? s : (JSON.stringify(s) ?? String(s))));
}

/**
 * The refusal message for a bad `states` value, or `null` when it is
 * acceptable. Omitted and `null` both mean "the door's default states".
 */
export function invalidStatesMessage(states: unknown): string | null {
  if (states === undefined || states === null) return null;
  const accepted = ['default', ...INTERACTION_STATES].join(', ');
  if (!Array.isArray(states)) return `'states' must be an array of: ${accepted}`;
  const unknown = unknownInteractionStates(states);
  if (unknown.length === 0) return null;
  return `Unknown interaction state(s): ${unknown.join(', ')}. Accepted: ${accepted}`;
}
