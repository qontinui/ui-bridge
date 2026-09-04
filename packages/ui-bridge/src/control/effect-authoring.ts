/**
 * D3 Effect Calculus — Authoring Consistency Lint (plan Phase 1 §4, extended
 * by Phase 5 of `2026-09-04-effect-calculus-joins-the-component-action-registry`)
 *
 * Lint helpers that check a coarse `effect` declaration (`read | write |
 * destructive`) against the fine {@link EffectSignature} it travels with, plus
 * a describer for the case where the DECLARED and INFERRED arms of a component
 * action resolve and disagree.
 *
 * Everything here RETURNS messages (empty = OK); nothing throws. A
 * disagreement in particular is **signal, never an error**: it means the
 * inference twin caught a mismatch between what the author says an action does
 * and what the recordings say it does, and the correct response is to record
 * it where someone can read it — not to suppress it, and not to sink the
 * action that produced it.
 */

import type { IREffect } from '../react/ir-types';
import type { SemanticSnapshot } from '../ai/types';
import type {
  ActionParams,
  EffectSignature,
  EffectSignatureId,
  PredictedDelta,
  ReversibilityKind,
} from './effect-types';

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
 * Rule 2, shared by both lints — and the fix for the contradiction the
 * original inherited.
 *
 * A `destructive` declaration is supposed to travel with
 * `reversibility: 'one-way'`. But an INFERRED signature hard-codes
 * `reversibility: 'reversible'` (`signatureFromInferredEntry` in
 * `./effect-signatures`), because inference observes which consequences follow
 * an action and never whether they can be undone. Applying Rule 2 to an
 * inferred signature therefore fires on **every** inferred signature by
 * construction, and — far worse — reports the author's `'destructive'` as the
 * bug when the missing evidence is on the inference side. The declaration is
 * the stronger claim and it stands; what gets reported is the limit of the
 * inference.
 *
 * A signature with no `provenance` at all is treated as declared: inference
 * always stamps `'inferred'`, so an unstamped signature is hand-authored, and
 * skipping the rule for it would silently drop the check on exactly the
 * signatures a human wrote.
 */
function destructiveReversibilityMessages(sig: EffectSignature, subject: string): string[] {
  if (sig.provenance === 'inferred') {
    return [
      `${subject} declares effect 'destructive' but its signature is inferred; ` +
        `inference cannot establish irreversibility, so its reversibility: 'reversible' ` +
        `is the absence of evidence and does NOT contradict the declaration. ` +
        `Declare a signature with reversibility: 'one-way' to state it explicitly.`,
    ];
  }
  if (sig.reversibility !== 'one-way') {
    return [`${subject} must declare reversibility: 'one-way'`];
  }
  return [];
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
 *     → "destructive transition must declare reversibility: 'one-way'" — see
 *     {@link destructiveReversibilityMessages} for why an inferred signature
 *     gets a different message instead.
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

  if (effect === 'destructive') {
    messages.push(...destructiveReversibilityMessages(sig, 'destructive transition'));
  }

  return messages;
}

/**
 * The component-action twin of {@link assertSignatureEffectConsistency}
 * (Phase 5). Same shape — returns `string[]`, never throws — because these are
 * authoring bugs surfaced to whoever is looking, not runtime failures: an
 * inconsistent annotation must not stop an action that otherwise works.
 *
 * Rules:
 *   - `effect: 'read'` on an action whose signature predicts a mutation
 *     → the annotation says "safe to walk" while the prediction says otherwise.
 *   - `effect: 'destructive'` with a declared signature that is not
 *     `reversibility: 'one-way'` → the two halves of the same claim disagree.
 *   - `effect: 'destructive'` with an INFERRED signature → a distinct message
 *     saying inference cannot establish irreversibility. It never contradicts
 *     the declaration.
 *
 * `componentId` / `actionId` are used only to name the subject in the message,
 * so a consumer reading a list of messages knows which action each is about.
 */
export function assertComponentActionEffectConsistency(
  effect: IREffect | undefined,
  sig: EffectSignature,
  params: ActionParams,
  pre: SemanticSnapshot,
  componentId: string,
  actionId: string,
): string[] {
  const subject = `component action "${componentId}.${actionId}"`;
  const messages: string[] = [];

  if (effect === 'read') {
    const predicted = sig.predicts(params, pre);
    if (predictsMutation(predicted)) {
      messages.push(`read-effect ${subject} predicts a mutation`);
    }
  }

  if (effect === 'destructive') {
    messages.push(...destructiveReversibilityMessages(sig, subject));
  }

  return messages;
}

// ---------------------------------------------------------------------------
// Two-arm disagreement (Phase 5)
// ---------------------------------------------------------------------------

/** One arm of a disagreement, reduced to the facets that can be compared. */
export interface SignatureArmSummary {
  /** The signature's id, when it has one. */
  id?: EffectSignatureId;
  /** `'declared'` or `'inferred'` — whichever the arm carried. */
  provenance?: 'declared' | 'inferred';
  /** The arm's reversibility claim. */
  reversibility: ReversibilityKind;
  /** Measured confidence, present on inferred arms only. */
  confidence?: number;
  /** What the arm predicted, against the SAME pre-snapshot as its twin. */
  predicted: PredictedDelta;
}

/**
 * A measured disagreement between the declared and inferred arms of one
 * component action.
 */
export interface SignatureDisagreement {
  declared: SignatureArmSummary;
  inferred: SignatureArmSummary;
  /** One human-readable line per facet that differs. Never empty. */
  messages: string[];
}

/**
 * Stable, order-insensitive rendering of one predicted-delta facet, so that two
 * predictions differing only in the order they list criteria are NOT reported
 * as a disagreement. A false disagreement is worse than none: it trains the
 * reader to ignore the field.
 */
function renderSet(values: unknown[] | undefined): string[] {
  if (!values || values.length === 0) return [];
  return values.map((v) => JSON.stringify(v) ?? String(v)).sort();
}

function sameSet(a: unknown[] | undefined, b: unknown[] | undefined): boolean {
  const ra = renderSet(a);
  const rb = renderSet(b);
  return ra.length === rb.length && ra.every((v, i) => v === rb[i]);
}

/** A `RegExp` has no useful JSON form, so render navigation targets by source. */
function renderNavigation(nav: string | RegExp | undefined): string | undefined {
  if (nav === undefined) return undefined;
  return typeof nav === 'string' ? nav : String(nav);
}

/**
 * Compare the two arms of a component-action signature resolution and describe
 * how they differ. Returns `undefined` when they agree on every compared facet.
 *
 * **Both predictions must have been produced against the SAME pre-snapshot** —
 * otherwise the difference reported could be the world moving rather than the
 * arms disagreeing. `EffectVerifier.verifyAction` takes an `alsoPredict`
 * signature for exactly this reason: it evaluates both against the one `pre` it
 * captured.
 *
 * The compared facets are the ones both arms can actually express: the
 * predicted delta, and `reversibility`. `settleMs`, `scope` and `confidence`
 * are reported on the summaries but not compared — inference does not set a
 * settle band at all, and scope is an observation budget rather than a claim
 * about the world, so differing there is not a disagreement about what the
 * action does.
 */
export function describeSignatureDisagreement(
  declared: { signature: EffectSignature; predicted: PredictedDelta },
  inferred: { signature: EffectSignature; predicted: PredictedDelta },
): SignatureDisagreement | undefined {
  const messages: string[] = [];
  const d = declared.predicted;
  const i = inferred.predicted;

  if (!sameSet(d.elementsAppear, i.elementsAppear)) {
    messages.push(
      `elementsAppear differs — declared ${JSON.stringify(renderSet(d.elementsAppear))}, ` +
        `inferred ${JSON.stringify(renderSet(i.elementsAppear))}`,
    );
  }
  if (!sameSet(d.elementsDisappear, i.elementsDisappear)) {
    messages.push(
      `elementsDisappear differs — declared ${JSON.stringify(renderSet(d.elementsDisappear))}, ` +
        `inferred ${JSON.stringify(renderSet(i.elementsDisappear))}`,
    );
  }
  if (!sameSet(d.elementsModify, i.elementsModify)) {
    messages.push(
      `elementsModify differs — declared ${JSON.stringify(renderSet(d.elementsModify))}, ` +
        `inferred ${JSON.stringify(renderSet(i.elementsModify))}`,
    );
  }
  if (!sameSet(d.stateActivates, i.stateActivates)) {
    messages.push(
      `stateActivates differs — declared ${JSON.stringify(renderSet(d.stateActivates))}, ` +
        `inferred ${JSON.stringify(renderSet(i.stateActivates))}`,
    );
  }
  if (!sameSet(d.stateDeactivates, i.stateDeactivates)) {
    messages.push(
      `stateDeactivates differs — declared ${JSON.stringify(renderSet(d.stateDeactivates))}, ` +
        `inferred ${JSON.stringify(renderSet(i.stateDeactivates))}`,
    );
  }
  const dNav = renderNavigation(d.navigationTo);
  const iNav = renderNavigation(i.navigationTo);
  if (dNav !== iNav) {
    messages.push(
      `navigationTo differs — declared ${dNav === undefined ? 'none' : `"${dNav}"`}, ` +
        `inferred ${iNav === undefined ? 'none' : `"${iNav}"`}`,
    );
  }
  if (declared.signature.reversibility !== inferred.signature.reversibility) {
    messages.push(
      `reversibility differs — declared '${declared.signature.reversibility}', ` +
        `inferred '${inferred.signature.reversibility}' (inference always says ` +
        `'reversible'; it cannot observe irreversibility, so this line is a note, ` +
        `not a refutation of the declaration)`,
    );
  }

  if (messages.length === 0) return undefined;

  return {
    declared: {
      id: declared.signature.id,
      provenance: declared.signature.provenance,
      reversibility: declared.signature.reversibility,
      confidence: declared.signature.confidence,
      predicted: d,
    },
    inferred: {
      id: inferred.signature.id,
      provenance: inferred.signature.provenance,
      reversibility: inferred.signature.reversibility,
      confidence: inferred.signature.confidence,
      predicted: i,
    },
    messages,
  };
}
