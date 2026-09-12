/**
 * The ONE wire projection for an element's custom actions.
 *
 * Plan `2026-09-04-effect-calculus-joins-the-component-action-registry`,
 * Design decision 4 step 3.
 *
 * Until 2026-09-11 every projection of `RegisteredElement.customActions` spelled
 * `el.customActions ? Object.keys(el.customActions) : undefined` inline, in
 * eight places across two packages, plus a ninth in `qontinui-runner` that
 * flattened the names into `actions` and was on nobody's list. Eight copies of
 * one expression is how a safety annotation goes missing from one surface and
 * nobody notices; this module exists so there is a single place to change and a
 * single place to test.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES NOT DO: default the effect
 * ---------------------------------------------------------------------------
 *
 * `effect` is carried through **verbatim and undefaulted**. An action whose
 * author declared nothing is emitted with `effect` absent, never with a
 * manufactured `'read'`. This is the same rule `core/action-effect.ts` states
 * for the component verb map, and it is load-bearing rather than stylistic:
 *
 * > a default rendered as a declaration is a fail-open lie on exactly the
 * > surface the annotation exists to protect.
 *
 * **Absent means UNCLASSIFIED, not safe.** A walker that reads `effect:
 * 'write'` on an action nobody judged will fire it; one that reads nothing at
 * all can fail closed, which is what served policy `operating-rules`
 * `what-makes-an-action-destructive` requires of an unestablished effect.
 *
 * So: do NOT "helpfully" call `resolveActionEffect` from here. A consumer that
 * wants the verb-map default can apply it itself, and then it *knows* it is
 * defaulting.
 */

import type { CustomAction, SerializedElementAction } from './types';

/**
 * The registration-side shape this projection reads.
 *
 * Deliberately structural rather than `Record<string, CustomAction>`: the two
 * native packages alias `CustomAction` under their own names
 * (`NativeCustomAction`), and `@qontinui/ui-bridge-native` duplicates the
 * declaration outright because it may not import from this package. Keying on
 * the fields actually read lets every one of them pass its own record in
 * without a cast.
 */
type ProjectableCustomActions = Record<
  string,
  Pick<CustomAction, 'label' | 'description' | 'effect'> | undefined
>;

/**
 * Project `RegisteredElement.customActions` to its wire shape.
 *
 * - `undefined` in → `undefined` out. An element that registered no custom
 *   actions must not start emitting an empty array: `JSON.stringify` keeps
 *   `[]` but drops `undefined`, and the difference is a wire-shape change on
 *   every element in every snapshot.
 * - An empty record in → `[]` out, which is what `Object.keys({})` gave before
 *   and what the canonical `Option<Vec<_>>` round-trips.
 *
 * **The emitted `id` is the RECORD KEY.** The executor dispatches by key
 * (`owner.customActions[action]`), so the key is the name a caller must send;
 * an entry's own `id` field is not consulted here, because a wire `id` a caller
 * could not invoke would be worse than useless. The two are the same string for
 * every in-tree registration.
 *
 * Keys whose value is nullish are skipped rather than emitted as a bare `{id}`:
 * such an entry cannot be dispatched (the executor would find no `handler`), so
 * advertising it would be advertising a capability that does not exist.
 */
export function serializeElementCustomActions(
  customActions: ProjectableCustomActions | undefined
): SerializedElementAction[] | undefined {
  if (!customActions) return undefined;

  const out: SerializedElementAction[] = [];
  for (const [id, action] of Object.entries(customActions)) {
    if (!action) continue;
    const entry: SerializedElementAction = { id };
    if (action.label !== undefined) entry.label = action.label;
    if (action.description !== undefined) entry.description = action.description;
    // Undefaulted — see the module header. `undefined` stays `undefined`.
    if (action.effect !== undefined) entry.effect = action.effect;
    out.push(entry);
  }
  return out;
}
