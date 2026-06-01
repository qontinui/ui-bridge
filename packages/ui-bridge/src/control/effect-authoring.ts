/**
 * D3 Effect Calculus — Authoring Consistency Lint (plan Phase 1 §4)
 *
 * A lint helper that checks an `IrTransition.effect` declaration against the
 * effect signature it carries, surfacing authoring bugs. It RETURNS messages
 * (empty = OK); it never throws.
 */

import type { IREffect } from '../react/ir-types';
import type { SemanticSnapshot } from '../ai/types';
import type { ActionParams, EffectSignature, PredictedDelta } from './effect-types';

/** Does the predicted delta predict any kind of mutation? */
function predictsMutation(predicted: PredictedDelta): boolean {
  return (
    (predicted.elementsModify?.length ?? 0) > 0 ||
    predicted.navigationTo !== undefined ||
    (predicted.stateActivates?.length ?? 0) > 0 ||
    (predicted.stateDeactivates?.length ?? 0) > 0
  );
}

/**
 * Check that a transition's declared `effect` is consistent with its effect
 * signature. Returns an array of authoring-bug messages (empty = consistent).
 *
 * Rules:
 *   - `read` transition that predicts a mutation
 *     (`elementsModify` / `navigationTo` / `stateActivates` / `stateDeactivates`)
 *     → "read-effect transition predicts a mutation".
 *   - `destructive` transition whose signature is not `reversibility: 'one-way'`
 *     → "destructive transition must declare reversibility: 'one-way'".
 */
export function assertSignatureEffectConsistency(
  effect: IREffect | undefined,
  sig: EffectSignature,
  params: ActionParams,
  pre: SemanticSnapshot,
): string[] {
  const messages: string[] = [];

  if (effect === 'read') {
    const predicted = sig.predicts(params, pre);
    if (predictsMutation(predicted)) {
      messages.push('read-effect transition predicts a mutation');
    }
  }

  if (effect === 'destructive' && sig.reversibility !== 'one-way') {
    messages.push("destructive transition must declare reversibility: 'one-way'");
  }

  return messages;
}
