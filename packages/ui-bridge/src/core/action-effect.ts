/**
 * Action effect defaults — the static verb→effect map, and the precedence rule
 * that lets a registration override it.
 *
 * Plan `2026-08-20-ui-bridge-action-declaration-shape`, Phase 4.
 *
 * `IREffect` ("read" | "write" | "destructive") has exactly one job: **exclude
 * destructive actions from automatic walks** (`react/ir-types.ts` documents
 * this for IR transitions; Phase 4 propagates the same vocabulary to SDK
 * actions so a walk over *actions* has something to exclude on).
 *
 * Two sources feed it, in this order:
 *
 *   1. `action.effect` — the author's explicit per-registration declaration.
 *   2. `STANDARD_ACTION_EFFECTS[action.id]` — the static default below, which
 *      applies only when the id is one of the 22 {@link StandardAction} verbs.
 *
 * **1 wins.** See `ComponentAction.effect` for why the override ships at all:
 * a static `click → write` map is wrong precisely on a delete button, and it
 * fails *open*.
 */

import type { IREffect, StandardAction } from './types';

/**
 * Static default effect for each of the 22 {@link StandardAction} verbs.
 *
 * Typed `Record<StandardAction, IREffect>` deliberately: adding a verb to the
 * union without classifying it here is a compile error, which is the only
 * mechanism that keeps a *map* from drifting away from the *union* it
 * describes. (This is the same drift class the plan exists to fix — do not
 * relax it to `Partial<Record<...>>`.)
 *
 * **No verb maps to `'destructive'`, and none ever should.** Destructiveness
 * is a property of what a control *does*, not of the verb used to reach it;
 * a static map can only ever produce it by accident. `'destructive'` is
 * reachable exclusively through an explicit `effect` on the registration.
 *
 * The non-obvious calls, justified:
 *
 * - **`rightClick` → `read`.** It reveals a context menu. Revealing options is
 *   not committing to one, and no persistent state changes; the *chosen* menu
 *   item is a separate action with its own effect.
 * - **`middleClick` → `write`.** Unlike `rightClick` it has no single
 *   convention — open-in-new-tab, autoscroll, X11 primary-selection paste,
 *   close-tab — and an app handler may bind it to anything. With no dominant
 *   read-only reading, it takes the more cautious classification.
 * - **`submit` → `write`, not `destructive`.** Submission is the standard verb
 *   closest to irreversible (it can send, charge or deploy). But defaulting it
 *   to `destructive` would exclude *every* form — searches, filters, logins —
 *   from automatic walks and gut the walker on the ordinary case. Per the rule
 *   above, the irreversible instance declares itself.
 * - **`reset` → `write`.** It discards unsaved input, which reads as
 *   destructive at a glance, but it restores a form's declared defaults and
 *   touches no persisted state. Reversible by re-entering the values.
 * - **`clear` → `write`** for the same reason: emptying a field is undone by
 *   typing again. A "Clear all data" control is a `destructive` override, not
 *   a reason to reclassify the verb.
 * - **`focus` / `blur` → `read`.** They move focus, which is UI state, not
 *   persistent state. Note this is a default about the *verb*: an
 *   `onBlur`-commits form is an app-level behaviour the author overrides.
 */
export const STANDARD_ACTION_EFFECTS: Record<StandardAction, IREffect> = {
  // --- Reads: reveal, observe, or move the viewport/focus. -----------------
  hover: 'read',
  scroll: 'read',
  scrollIntoView: 'read',
  focus: 'read',
  blur: 'read',
  rightClick: 'read',

  // --- Writes: activate a control or change a value. ----------------------
  click: 'write',
  hoverClick: 'write',
  doubleClick: 'write',
  middleClick: 'write',
  type: 'write',
  sendKeys: 'write',
  clear: 'write',
  select: 'write',
  check: 'write',
  uncheck: 'write',
  toggle: 'write',
  setValue: 'write',
  autocomplete: 'write',
  drag: 'write',
  submit: 'write',
  reset: 'write',
};

/**
 * The static default for an action id, or `undefined` when the id is not one
 * of the standard verbs (which is the normal case for a `ComponentAction`,
 * whose ids are free-form).
 *
 * `undefined` means **unknown**, not "safe" — a caller that walks unknown
 * actions is choosing to fail open and should say so.
 */
export function standardActionEffect(actionId: string): IREffect | undefined {
  return Object.prototype.hasOwnProperty.call(STANDARD_ACTION_EFFECTS, actionId)
    ? STANDARD_ACTION_EFFECTS[actionId as StandardAction]
    : undefined;
}

/**
 * Resolve the effective annotation for a declared action: **explicit
 * declaration first, static verb map second.**
 *
 * Accepts anything action-shaped (`ComponentAction`, `CustomAction`, a
 * `SerializedComponentAction` read back off the wire) so the same precedence
 * rule applies in-process and to a consumer parsing a response.
 */
export function resolveActionEffect(action: {
  id: string;
  effect?: IREffect;
}): IREffect | undefined {
  return action.effect ?? standardActionEffect(action.id);
}
