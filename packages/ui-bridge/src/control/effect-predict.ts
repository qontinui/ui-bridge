/**
 * D3 Effect Calculus — Query the twin before acting (Phase 6 of plan
 * `2026-09-04-effect-calculus-joins-the-component-action-registry`).
 *
 * `POST /control/component/:id/action/:actionId/predict` asks one question:
 * *if I invoked this action right now, what does the twin say would happen?*
 * It resolves the action's {@link EffectSignature}, evaluates
 * `predicts(params, omegaPre)` against a freshly captured pre-snapshot, and
 * returns the answer — **without invoking the handler**.
 *
 * The precedent is `composeSignatures` (`./effect-composition`), documented as
 * *"this composes predictions only; it captures NOTHING"*. This module is the
 * same discipline one action at a time: everything below is a pure function of
 * (declaration, signature arms, params, pre-snapshot). It never touches the
 * registry, never calls a handler, never writes the effect store, and never
 * opens a settle window. State-neutrality is a property of the code shape, not
 * of a promise in a doc comment — the only impure step in the whole route is
 * the read-only snapshot capture the executor does before calling in here.
 *
 * ## The honesty rules this file exists to enforce
 *
 * 1. **A prediction is never fabricated.** When no signature resolves,
 *    `predicted` is `null`. There is no "empty delta" fallback, because an
 *    empty delta is a positive claim — *"invoking this changes nothing"* — and
 *    nobody made it. (`./effect-signatures` opens with the same rule.)
 *
 * 2. **`null` must never read as "harmless"**
 *    [policy: unknown-must-not-render-as-a-default]. An action with no
 *    signature is UNCLASSIFIED, not safe. Three separate things in the payload
 *    say so rather than leaving it to be inferred from an absence:
 *      - {@link ComponentActionPrediction.status} is a word (`'unclassified'`),
 *        not the absence of a field;
 *      - {@link ComponentActionPrediction.coverageCaveat} is ALWAYS present and
 *        always non-empty, and in the unclassified arm it says in prose that
 *        this is not evidence of safety;
 *      - every facet a signature would have supplied is an explicit `null`
 *        rather than an omitted key, so a JSON consumer sees a stated unknown
 *        instead of a missing property. (`JSON.stringify` drops `undefined`;
 *        that is exactly how an unknown turns into a silent default.)
 */

import type { IREffect } from '../react/ir-types';
import type { SemanticSnapshot } from '../ai/types';
import type {
  ActionParams,
  EffectSignature,
  EffectSignatureId,
  ObservabilityScope,
  PredictedDelta,
  ReversibilityKind,
} from './effect-types';
import type { ComponentSignatureArms } from './effect-signatures';
import type { SignatureDisagreement } from './effect-authoring';
import {
  assertComponentActionEffectConsistency,
  describeSignatureDisagreement,
} from './effect-authoring';

/**
 * What a predict call was able to establish.
 *
 * Deliberately a closed word rather than a boolean or an absence: the three
 * cases below are three different states of knowledge, and collapsing the last
 * two into "no prediction" is what makes an unclassified action read as a safe
 * one.
 */
export type ComponentActionPredictionStatus =
  /** A signature resolved and produced a delta. `predicted` is that delta. */
  | 'predicted'
  /**
   * The component and the action both exist, and **no signature resolved** —
   * neither declared on the action nor inferred from recording history. The
   * action is UNCLASSIFIED. This is not a prediction that nothing happens; it
   * is the absence of anyone having said what happens.
   */
  | 'unclassified'
  /**
   * Nothing was evaluated: the component id or the action id did not resolve
   * against the registry. Distinct from `'unclassified'` because the answer to
   * "what does this action do" is *"there is no such action here"*, which is a
   * caller bug, not a coverage gap.
   */
  | 'unresolved';

/** Body of a `POST /control/component/:id/action/:actionId/predict` call. */
export interface ComponentActionPredictRequest {
  /**
   * The params the caller intends to invoke the action with. Fed to
   * `signature.predicts` verbatim — a signature may well predict different
   * deltas for different params (a `setLayout` action predicting different
   * element sets per `layoutId`), so predicting for the wrong bag answers a
   * question the caller did not ask.
   */
  params?: Record<string, unknown>;
  /** Echoed back on the response, for correlating with a later invocation. */
  requestId?: string;
}

/**
 * The twin's answer for one component action.
 *
 * Every facet a signature would supply is `T | null`, never `T | undefined`:
 * see rule 2 in the module header.
 */
export interface ComponentActionPrediction {
  componentId: string;
  actionId: string;
  /** What this call established. Read this BEFORE reading `predicted`. */
  status: ComponentActionPredictionStatus;
  /**
   * The coarse safety class the author declared on the action, echoed
   * verbatim. `undefined` here means the action carries no annotation at all —
   * never defaulted through a verb map, for the same reason no projection
   * defaults it. Read {@link effectDeclared} rather than testing for absence.
   */
  effect?: IREffect;
  /**
   * `false` when the action carries no `effect` annotation. Distinct from
   * `effect === 'read'`: one is "the author says this is safe", the other is
   * "nobody has looked". A boolean is here because the difference between the
   * two is invisible to a consumer that only sees an omitted key.
   */
  effectDeclared: boolean;
  /**
   * The predicted delta, or `null` when no signature resolved.
   *
   * **`null` is not an empty delta.** An empty `PredictedDelta` (`{}`) is a
   * signature asserting that nothing observable changes; `null` is nobody
   * having asserted anything.
   */
  predicted: PredictedDelta | null;
  /** The winning signature's reversibility claim; `null` when none resolved. */
  reversibility: ReversibilityKind | null;
  /** Where the winning signature came from; `null` when none resolved. */
  provenance: 'declared' | 'inferred' | null;
  /**
   * The winning signature's measured confidence. `null` both when no signature
   * resolved AND when a *declared* signature carries none — a hand-authored
   * signature has no measurement behind it, and inventing a `1.0` would dress
   * an assertion up as a measurement.
   */
  confidence: number | null;
  /** The winning signature's id; `null` when none resolved. */
  signatureId: EffectSignatureId | null;
  /**
   * What the winning signature observes. `null` when none resolved.
   *
   * An empty `elementIds` list or an omitted one means whole-page; anything
   * outside the scope is simply not looked at, which is why
   * {@link coverageCaveat} names it.
   */
  scope: ObservabilityScope | null;
  /**
   * **Always present, always non-empty.** Prose stating what this answer does
   * NOT establish. The unclassified arm says explicitly that a `null`
   * prediction is not evidence of safety
   * [policy: unknown-must-not-render-as-a-default]; the predicted arm says the
   * handler was not invoked, so nothing here was observed.
   */
  coverageCaveat: string;
  /**
   * Authoring-lint messages from
   * {@link assertComponentActionEffectConsistency} — a caller sees a
   * declaration its own signature contradicts.
   *
   * Empty when the two agree, and empty when there is no signature to
   * contradict. It is NOT the place the unclassified state is reported: that
   * is `status` + `coverageCaveat`, so an empty `consistency` never has to be
   * read as "all good".
   */
  consistency: string[];
  /**
   * Present when BOTH arms resolved and predicted different things against the
   * one pre-snapshot. Signal, never an error — the same reading as
   * `EffectRecordEntry.disagreement`.
   */
  disagreement?: SignatureDisagreement;
  /**
   * Always `false`, and stated rather than implied. This route never invokes
   * the handler; a consumer that mixes predict and execute responses can tell
   * them apart from the payload alone.
   */
  handlerInvoked: false;
  /**
   * `timestamp` of the pre-snapshot the prediction was computed against, or
   * `null` when none was captured (the unclassified and unresolved arms skip
   * the capture — there is nothing to predict against).
   */
  predictedAgainstSnapshotAt: number | null;
  /** Echoed from the request. */
  requestId?: string;
  /** When this answer was produced (epoch ms). */
  timestamp: number;
}

/** Wire response for the predict route. */
export interface ComponentActionPredictResponse extends ComponentActionPrediction {
  /**
   * `false` only for `status: 'unresolved'` and for an internal failure —
   * never for `'unclassified'`, which is a successful answer of "nobody has
   * described this action".
   */
  success: boolean;
  /** Human-readable failure reason; present iff `success === false`. */
  error?: string;
  /** Machine code for the failure; present iff `success === false`. */
  code?: string;
  /** Wall time spent producing the answer, including the snapshot capture. */
  durationMs: number;
}

/**
 * The one sentence that stops a `null` prediction reading as a clean bill of
 * health. Exported so a consumer can recognise it, and so a test can pin the
 * words rather than the mere presence of a string
 * [policy: unknown-must-not-render-as-a-default].
 */
export const UNCLASSIFIED_CAVEAT_PREFIX = 'UNCLASSIFIED';

/** Render a scope for the caveat prose. */
function describeScope(scope: ObservabilityScope): string {
  const ids = scope.elementIds;
  if (!ids || ids.length === 0) return 'the whole page';
  return `${ids.length} element${ids.length === 1 ? '' : 's'} (${ids.join(', ')})`;
}

/** Build the caveat for the arm where nothing resolved. */
function unclassifiedCaveat(
  componentId: string,
  actionId: string,
  effect: IREffect | undefined,
): string {
  const annotation =
    effect === undefined
      ? 'It carries no coarse `effect` annotation either, so nothing at all is known about it.'
      : `Its coarse \`effect\` annotation says '${effect}', which is a safety class, not a ` +
        'prediction — it says nothing about WHAT would change.';
  return (
    `${UNCLASSIFIED_CAVEAT_PREFIX}: no effect signature resolved for component action ` +
    `"${componentId}.${actionId}", so nothing was predicted. This is NOT a prediction that ` +
    'the action changes nothing, and NOT evidence that it is safe to invoke — it means ' +
    'nobody has described what this action does. ' +
    annotation +
    ' Declare `ComponentAction.signature` on the action, or record enough history for the ' +
    'inference table to key on it, and ask again.'
  );
}

/** Build the caveat for the arm where a signature did resolve. */
function predictedCaveat(signature: EffectSignature): string {
  const provenance = signature.provenance ?? 'declared';
  const base =
    `PREDICTION ONLY: computed from the ${provenance} signature ` +
    `${signature.id === undefined ? '(unnamed)' : `"${signature.id}"`} against a pre-snapshot ` +
    'captured for this call. The handler was NOT invoked and nothing was observed, so this ' +
    'is a claim about the future, not a measurement. ' +
    `The signature observes ${describeScope(signature.scope)}; anything outside that scope ` +
    'is unobserved by construction, and a prediction being empty inside the scope does not ' +
    'mean nothing happens outside it.';
  if (provenance !== 'inferred') return base;
  const confidence =
    signature.confidence === undefined
      ? 'The inferred arm reports no confidence.'
      : `Its confidence is ${signature.confidence}, measured over recorded history — a ` +
        'frequency, not a guarantee.';
  return (
    `${base} Inference cannot observe irreversibility, so its ` +
    `reversibility: '${signature.reversibility}' is the absence of evidence rather than ` +
    `evidence of reversibility. ${confidence}`
  );
}

/** Inputs to {@link buildComponentActionPrediction}. */
export interface ComponentActionPredictionInputs {
  componentId: string;
  actionId: string;
  /** The action's declared coarse effect; `undefined` = unannotated. */
  effect?: IREffect;
  /**
   * Both arms of the signature resolution. `undefined`, or an object whose
   * `signature` is `undefined`, is the unclassified arm.
   */
  arms?: ComponentSignatureArms;
  /** Params the caller intends to invoke with. */
  params?: Record<string, unknown>;
  requestId?: string;
  /**
   * The pre-snapshot to predict against. Required whenever `arms.signature` is
   * set — the executor captures it only in that case, because capturing one to
   * throw away is pure cost. Passing `undefined` alongside a resolved
   * signature is a programming error and throws rather than silently
   * degrading to `null`.
   */
  pre?: SemanticSnapshot;
  /** Clock injection, so a test can pin `timestamp` without faking Date. */
  now?: () => number;
}

/**
 * Build the twin's answer. **Pure** — no capture, no handler, no store write.
 *
 * Both arms of the signature resolution are predicted against the SAME `pre`,
 * exactly as `EffectVerifier.verifyAction`'s `alsoPredict` does, so a reported
 * disagreement is the arms disagreeing rather than the world moving between
 * two captures.
 */
export function buildComponentActionPrediction(
  inputs: ComponentActionPredictionInputs,
): ComponentActionPrediction {
  const { componentId, actionId, effect, arms, params, requestId } = inputs;
  const now = inputs.now ?? (() => Date.now());
  const signature = arms?.signature;

  if (!signature) {
    return {
      componentId,
      actionId,
      status: 'unclassified',
      effect,
      effectDeclared: effect !== undefined,
      predicted: null,
      reversibility: null,
      provenance: null,
      confidence: null,
      signatureId: null,
      scope: null,
      coverageCaveat: unclassifiedCaveat(componentId, actionId, effect),
      consistency: [],
      handlerInvoked: false,
      predictedAgainstSnapshotAt: null,
      requestId,
      timestamp: now(),
    };
  }

  const pre = inputs.pre;
  if (!pre) {
    // Fail loudly rather than emitting a `null` prediction that a caller would
    // read as "unclassified" — a resolved signature with no snapshot is a wiring
    // bug in the caller, and disguising it as a coverage gap would hide it.
    throw new Error(
      `buildComponentActionPrediction: a signature resolved for "${componentId}.${actionId}" ` +
        'but no pre-snapshot was supplied — the caller must capture one before predicting.',
    );
  }

  const actionParams: ActionParams = {
    // A component action has no element, so `elementId` stays absent — the
    // same shape `executeComponentAction` builds for the verifier.
    action: actionId,
    params,
    requestId,
  };

  const predicted = signature.predicts(actionParams, pre);

  // The second arm, against the SAME snapshot. Its failure is contained: a
  // throwing `predicts` on a diagnostic arm must not sink the answer the
  // caller actually asked for (same containment as `verifyAction`).
  const otherArm =
    arms.declared !== undefined && arms.inferred !== undefined && signature === arms.declared
      ? arms.inferred
      : undefined;
  let disagreement: SignatureDisagreement | undefined;
  if (otherArm) {
    try {
      const otherPredicted = otherArm.predicts(actionParams, pre);
      disagreement = describeSignatureDisagreement(
        { signature, predicted },
        { signature: otherArm, predicted: otherPredicted },
      );
    } catch {
      disagreement = undefined;
    }
  }

  // Phase 5's lint, run against the arm that won. Messages, never a throw —
  // an inconsistent annotation is an authoring bug to surface, not a reason to
  // refuse to answer.
  let consistency: string[];
  try {
    consistency = assertComponentActionEffectConsistency(
      effect,
      signature,
      actionParams,
      pre,
      componentId,
      actionId,
    );
  } catch {
    consistency = [];
  }

  return {
    componentId,
    actionId,
    status: 'predicted',
    effect,
    effectDeclared: effect !== undefined,
    predicted,
    reversibility: signature.reversibility,
    provenance: signature.provenance ?? null,
    confidence: signature.confidence ?? null,
    signatureId: signature.id ?? null,
    scope: signature.scope,
    coverageCaveat: predictedCaveat(signature),
    consistency,
    disagreement,
    handlerInvoked: false,
    predictedAgainstSnapshotAt: pre.timestamp,
    requestId,
    timestamp: now(),
  };
}

/**
 * The answer for a component id or action id that does not resolve.
 *
 * A separate builder rather than a flag on the one above, because nothing
 * about it is a prediction: there is no declaration to echo and no signature to
 * describe, and the caveat has to say *"there is no such action"* rather than
 * *"nobody described this action"*.
 */
export function unresolvedComponentActionPrediction(
  componentId: string,
  actionId: string,
  reason: string,
  requestId?: string,
  now: () => number = () => Date.now(),
): ComponentActionPrediction {
  return {
    componentId,
    actionId,
    status: 'unresolved',
    effectDeclared: false,
    predicted: null,
    reversibility: null,
    provenance: null,
    confidence: null,
    signatureId: null,
    scope: null,
    coverageCaveat:
      `UNRESOLVED: ${reason} Nothing was evaluated, so the absence of a prediction here says ` +
      'nothing whatsoever about any action — least of all that one is safe.',
    consistency: [],
    handlerInvoked: false,
    predictedAgainstSnapshotAt: null,
    requestId,
    timestamp: now(),
  };
}
