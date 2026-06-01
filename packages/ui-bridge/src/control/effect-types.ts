/**
 * D3 Effect Calculus — Type Vocabulary
 *
 * A predict-then-verify subsystem for GUI actions. An action handler declares
 * an {@link EffectSignature} (what it predicts will change). Around execution
 * the engine captures a scoped pre-snapshot, runs the action, awaits a settle
 * window, captures a post-snapshot, computes the observed delta, and runs two
 * independent set-containments to produce one of five {@link EffectOutcome}s.
 *
 * This module is purely the type vocabulary — the load-bearing logic lives in
 * {@link ./effect-containment}. It is additive: it never changes existing
 * action behaviour.
 */

import type { IRElementCriteria } from '../react/ir-types';
import type { ElementState } from '../core/types';
import type { ErrorSeverity } from '../debug/error-severity';
import type {
  SemanticSnapshot,
  ElementChange,
  ElementModification,
} from '../ai/types';

// ---------------------------------------------------------------------------
// Outcome / classification enums
// ---------------------------------------------------------------------------

/**
 * The five terminal classifications of a predict-then-verify cycle.
 *
 * - `Confirmed`     — prediction exactly matched observation (P ⊆ O ∧ O ⊆ P).
 * - `Surprise`      — prediction held but extra unpredicted changes occurred.
 * - `Failure`       — a predicted change simply did not happen (no active negation).
 * - `Contradiction` — a predicted change was met by its opposite (active negation).
 * - `Partial`       — part of the predicted scope was unobservable (coverage < 1).
 */
export type EffectOutcome =
  | 'Confirmed'
  | 'Surprise'
  | 'Failure'
  | 'Contradiction'
  | 'Partial';

/**
 * Reversibility classification of an action's effect (drives counterfactual
 * gating downstream — see {@link ../react/ir-types#IREffect}).
 */
export type ReversibilityKind = 'idempotent' | 'reversible' | 'one-way';

/**
 * Attribution of an observed delta to the action under test.
 *
 * - `causal`        — the change was caused by this action.
 * - `observational` — the change happened concurrently (not caused by us).
 * - `mixed`         — both causal and concurrent changes occurred in the window.
 */
export type EffectCause = 'causal' | 'observational' | 'mixed';

// ---------------------------------------------------------------------------
// Predicted delta — what a signature predicts will change
// ---------------------------------------------------------------------------

/**
 * The declarative prediction an {@link EffectSignature} emits. Each field is a
 * set of criteria; an empty/omitted field predicts "no change of that kind".
 *
 * Element criteria reuse {@link IRElementCriteria} — the IR's canonical
 * element-matching shape — rather than a parallel type.
 */
export interface PredictedDelta {
  /** Elements predicted to appear. */
  elementsAppear?: IRElementCriteria[];
  /** Elements predicted to disappear. */
  elementsDisappear?: IRElementCriteria[];
  /** Elements predicted to be modified, with the expected partial state. */
  elementsModify?: { criteria: IRElementCriteria; expect: Partial<ElementState> }[];
  /** A navigation predicted to a target route (exact string or RegExp). */
  navigationTo?: string | RegExp;
  /**
   * Error prediction. `'none'` asserts no error of any severity appears;
   * `{ severityAtMost }` asserts at most the given severity.
   */
  errorsAppear?: 'none' | { severityAtMost: ErrorSeverity };
  /** Named app states predicted to activate (e.g. modal/route/flag ids). */
  stateActivates?: string[];
  /** Named app states predicted to deactivate. */
  stateDeactivates?: string[];
}

// ---------------------------------------------------------------------------
// Observability scope
// ---------------------------------------------------------------------------

/**
 * Constrains which part of the page a signature observes. Omitting
 * {@link elementIds} means whole-page observation.
 */
export interface ObservabilityScope {
  /** Element ids / globs this signature constrains; omit = whole page. */
  elementIds?: string[];
  /**
   * When true, reuse the previous step's post-snapshot as this pre-snapshot
   * (hot-loop optimisation, plan §6.4). The verifier may honour this; the
   * containment logic does not read it.
   */
  unchangedFromPrevious?: boolean;
}

// ---------------------------------------------------------------------------
// Action parameter bag
// ---------------------------------------------------------------------------

/**
 * The minimal action-parameter shape handlers receive. `ActionRequest` in
 * `core/types` carries no top-level `elementId`, so this small bag is defined
 * here rather than reused.
 */
export interface ActionParams {
  /** The action name (e.g. `click`, `navigate`, `type`). */
  action: string;
  /** The target element id, when the action targets an element. */
  elementId?: string;
  /** Free-form parameter bag (text, value, url, state, …). */
  params?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Effect signature — what a handler declares
// ---------------------------------------------------------------------------

/**
 * A hand-authored (Phase 1) declaration of an action's predicted effect.
 */
export interface EffectSignature {
  /** Produces the predicted delta from the params and the pre-snapshot. */
  predicts: (params: ActionParams, omegaPre: SemanticSnapshot) => PredictedDelta;
  /** Which part of the page this signature observes. */
  scope: ObservabilityScope;
  /** Settle window override (ms). When omitted, the per-action band is used. */
  settleMs?: number;
  /** Reversibility classification of the effect. */
  reversibility: ReversibilityKind;
  /** `'declared'` for hand-authored (Phase 1); `'inferred'` reserved for Phase 4. */
  provenance?: 'declared' | 'inferred';
}

// ---------------------------------------------------------------------------
// Observed delta — what actually changed
// ---------------------------------------------------------------------------

/**
 * The observed delta, distilled from a {@link ../ai/types#SemanticDiff}.
 */
export interface ObservedDelta {
  /** Elements that appeared. */
  appeared: ElementChange[];
  /** Elements that disappeared. */
  disappeared: ElementChange[];
  /** Elements that were modified. */
  modified: ElementModification[];
  /** The route navigated to, if navigation occurred. */
  navigatedTo?: string;
  /** Count of error-like elements that appeared. */
  errorsAppeared: number;
}

// ---------------------------------------------------------------------------
// Verification result
// ---------------------------------------------------------------------------

/**
 * The full result of a predict-then-verify cycle. Attached to
 * `ActionResponse.effectVerification` when a signature resolved.
 */
export interface EffectVerification {
  /** The terminal classification. */
  outcome: EffectOutcome;
  /** The prediction that was evaluated. */
  predicted: PredictedDelta;
  /** The observation that was evaluated. */
  observed: ObservedDelta;
  /** The two independent containment results plus coverage. */
  containment: {
    /** P ⊆ O — every predicted change is present in observed. */
    predictedSubsetObserved: boolean;
    /** O ⊆ P — every observed change was predicted (nothing extra). */
    observedSubsetPredicted: boolean;
    /** A predicted change was met by its opposite (see plan §6.3). */
    activeNegation: boolean;
    /** Fraction of the predicted scope that was observable, 0..1. */
    coverage: number;
  };
  /** Attribution of the observed delta to this action. */
  cause: EffectCause;
  /** Wall-clock duration of the verify cycle, ms. */
  durationMs: number;
}
