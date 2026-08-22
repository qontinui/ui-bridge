/**
 * Action effect defaults for `@qontinui/ui-bridge-native`.
 *
 * Plan `2026-08-20-ui-bridge-action-declaration-shape`, Phase 4.
 *
 * `IREffect` ("read" | "write" | "destructive") has exactly one job: **exclude
 * destructive actions from automatic walks.** Two sources feed it, in order:
 *
 *   1. `action.effect` — the author's explicit per-registration declaration.
 *   2. `NATIVE_STANDARD_ACTION_EFFECTS[action.id]` — the static default below.
 *
 * **1 wins.** A static `press → write` map is wrong precisely on a delete
 * control — guaranteed wrong in the one case the annotation exists for — and it
 * fails *open*, so an unmarked destructive action gets walked.
 *
 * DUPLICATE of `@qontinui/ui-bridge` `src/core/action-effect.ts` +
 * `src/native/core/action-effect.ts`, and deliberately not a re-export:
 * `@qontinui/ui-bridge` is an OPTIONAL peer of this package, so a consumer may
 * install `@qontinui/ui-bridge-native` alone. Same constraint that keeps
 * `ActionHandler` / `ComponentAction` / `IREffect` duplicated in
 * `./types` — see the long note there. KEEP IN SYNC.
 */

import type { IREffect, NativeStandardAction } from './types';

/**
 * Static default effect for each {@link NativeStandardAction} verb.
 *
 * Typed `Record<NativeStandardAction, IREffect>` so adding a verb without
 * classifying it is a compile error — a *map* silently falling behind the
 * *union* it describes is exactly the drift class this plan exists to fix.
 *
 * **No verb maps to `'destructive'`, and none ever should.** Destructiveness
 * is a property of what a control does, not of the verb used to reach it;
 * `'destructive'` is reachable only through an explicit `effect`.
 *
 * The non-obvious calls, justified:
 *
 * - **`longPress` → `read`.** The touch analogue of a right-click: it reveals
 *   a context menu / selection affordance. Long-press is *associated* with
 *   delete on mobile, but it only surfaces the option — the delete is a
 *   separate press with its own effect.
 * - **`swipe` → `write`.** Genuinely ambiguous, and it resolves the other way
 *   from `longPress`: a swipe is sometimes just a scroll gesture (read), but
 *   swipe-to-delete / swipe-to-archive **commits on the gesture itself**, with
 *   nothing in the verb to tell the two apart. It takes the more cautious
 *   classification, and a swipe-to-delete row must still declare
 *   `effect: 'destructive'`.
 * - **`focus` / `blur` → `read`.** They move focus, which is UI state, not
 *   persistent state.
 *
 * Note this union carries `click` and `setValue` that the
 * `@qontinui/ui-bridge` `native/core` copy does not — a real divergence
 * between the two native unions, not a sync error.
 */
export const NATIVE_STANDARD_ACTION_EFFECTS: Record<NativeStandardAction, IREffect> = {
  // --- Reads ---------------------------------------------------------------
  focus: 'read',
  blur: 'read',
  scroll: 'read',
  longPress: 'read',

  // --- Writes --------------------------------------------------------------
  press: 'write',
  click: 'write',
  doubleTap: 'write',
  type: 'write',
  setValue: 'write',
  clear: 'write',
  swipe: 'write',
  toggle: 'write',
};

/**
 * The static default for a native action id, or `undefined` when the id is not
 * one of the native standard verbs (the normal case for a `ComponentAction`,
 * whose ids are free-form).
 *
 * `undefined` means **unknown**, not "safe" — a caller that walks unknown
 * actions is choosing to fail open and should say so.
 */
export function nativeStandardActionEffect(actionId: string): IREffect | undefined {
  return Object.prototype.hasOwnProperty.call(NATIVE_STANDARD_ACTION_EFFECTS, actionId)
    ? NATIVE_STANDARD_ACTION_EFFECTS[actionId as NativeStandardAction]
    : undefined;
}

/**
 * Resolve the effective annotation for a declared action: **explicit
 * declaration first, static verb map second.**
 */
export function resolveActionEffect(action: {
  id: string;
  effect?: IREffect;
}): IREffect | undefined {
  return action.effect ?? nativeStandardActionEffect(action.id);
}
