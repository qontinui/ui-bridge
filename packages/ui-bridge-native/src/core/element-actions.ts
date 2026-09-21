/**
 * The ONE wire projection for an element's custom actions.
 *
 * Plan `2026-09-04-effect-calculus-joins-the-component-action-registry`,
 * Design decision 4 step 3.
 *
 * DUPLICATE of `@qontinui/ui-bridge` `src/core/element-actions.ts`, for the same
 * reason the types beside it are duplicated: this package must not import from
 * `@qontinui/ui-bridge` (an optional peer). KEEP IN SYNC — a divergence here is
 * a divergence in what the two channels advertise about the same annotation.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES NOT DO: default the effect
 * ---------------------------------------------------------------------------
 *
 * `effect` is carried through **verbatim and undefaulted**. An action whose
 * author declared nothing is emitted with `effect` absent, never with a
 * manufactured `'read'` — a default rendered as a declaration is a fail-open lie
 * on exactly the surface the annotation exists to protect. **Absent means
 * UNCLASSIFIED, not safe**, which is what served policy `operating-rules`
 * `what-makes-an-action-destructive` requires of an unestablished effect.
 */

import type { CustomAction, SerializedElementAction } from './types';

type ProjectableCustomActions = Record<
  string,
  Pick<CustomAction, 'label' | 'description' | 'effect'> | undefined
>;

/**
 * Project `RegisteredNativeElement.customActions` to its wire shape.
 *
 * - `undefined` in → `undefined` out (an element with no custom actions must not
 *   start emitting `[]`; `JSON.stringify` keeps `[]` and drops `undefined`).
 * - An empty record in → `[]` out, matching what `Object.keys({})` gave before.
 *
 * The emitted `id` is the RECORD KEY — the executor dispatches by key, so the
 * key is the name a caller must send. Nullish entries are skipped: they carry no
 * handler, so advertising them would advertise a capability that does not exist.
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
