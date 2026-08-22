/**
 * Action effect defaults for the React Native channel.
 *
 * Plan `2026-08-20-ui-bridge-action-declaration-shape`, Phase 4.
 *
 * The *precedence rule* is the same one the web core states — explicit
 * declaration beats static default — but the **verb table it falls back to is
 * not**: `NativeStandardAction` is a different, smaller union than the web
 * `StandardAction` (there is no `rightClick` on a touch screen, and `press` /
 * `longPress` / `doubleTap` / `swipe` have no web counterpart). So
 * `resolveActionEffect` is declared here against the NATIVE map rather than
 * re-exported from `../../core/action-effect`: re-exporting it would resolve a
 * native `press` against the web table, find nothing, and return `undefined` —
 * a silent wrong answer under a name that reads correct.
 *
 * The web map is re-exported under its own name for callers that genuinely
 * need the DOM verb table.
 */

import type { IREffect } from '../../core/types';
import type { NativeStandardAction } from './types';

export { STANDARD_ACTION_EFFECTS, standardActionEffect } from '../../core/action-effect';

/**
 * Static default effect for each {@link NativeStandardAction} verb.
 *
 * Typed `Record<NativeStandardAction, IREffect>` so adding a verb without
 * classifying it is a compile error. **No verb maps to `'destructive'`** — see
 * `core/action-effect.ts` for why that is structural, not an oversight.
 *
 * The non-obvious calls, justified:
 *
 * - **`longPress` → `read`.** The touch analogue of a right-click: it reveals
 *   a context menu / selection affordance. Long-press is *associated* with
 *   delete on mobile, but the long-press itself only surfaces the option —
 *   the delete is a separate press with its own effect.
 * - **`swipe` → `write`.** Genuinely ambiguous, and it resolves the other way
 *   from `longPress`: a swipe is sometimes just a scroll gesture (read), but
 *   swipe-to-delete / swipe-to-archive **commits on the gesture itself**, with
 *   nothing in the verb to tell the two apart. It takes the more cautious
 *   classification, and a swipe-to-delete row must still declare
 *   `effect: 'destructive'` explicitly.
 * - **`toggle` → `write`** and **`clear` → `write`**: reversible value changes,
 *   same reading as the web map.
 */
export const NATIVE_STANDARD_ACTION_EFFECTS: Record<NativeStandardAction, IREffect> = {
  // --- Reads ---------------------------------------------------------------
  focus: 'read',
  blur: 'read',
  scroll: 'read',
  longPress: 'read',

  // --- Writes --------------------------------------------------------------
  press: 'write',
  doubleTap: 'write',
  type: 'write',
  clear: 'write',
  swipe: 'write',
  toggle: 'write',
};

/**
 * The static default for a native action id, or `undefined` when the id is not
 * one of the native standard verbs. `undefined` means **unknown**, not "safe".
 */
export function nativeStandardActionEffect(actionId: string): IREffect | undefined {
  return Object.prototype.hasOwnProperty.call(NATIVE_STANDARD_ACTION_EFFECTS, actionId)
    ? NATIVE_STANDARD_ACTION_EFFECTS[actionId as NativeStandardAction]
    : undefined;
}

/**
 * Resolve the effective annotation for a declared native action: **explicit
 * declaration first, NATIVE verb map second.**
 *
 * Same precedence rule as the web core's function of this name, against the
 * native verb table.
 */
export function resolveActionEffect(action: {
  id: string;
  effect?: IREffect;
}): IREffect | undefined {
  return action.effect ?? nativeStandardActionEffect(action.id);
}
