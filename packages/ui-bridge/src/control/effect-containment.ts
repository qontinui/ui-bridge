/**
 * D3 Effect Calculus — Containment Logic (the load-bearing pure core)
 *
 * A single pure function, {@link computeVerification}, that takes a predicted
 * delta and an observed delta and classifies the cycle into one of five
 * {@link EffectOutcome}s via two independent set-containments. No DOM access,
 * fully unit-testable.
 *
 * The two containments:
 *   - P ⊆ O (`predictedSubsetObserved`): every predicted change is present in
 *     the observed delta.
 *   - O ⊆ P (`observedSubsetPredicted`): every observed change was predicted
 *     (nothing extra appeared).
 *
 * See the plan §3.4 (outcome table) and §6.3 (active-negation edge case).
 */

import type { IRElementCriteria } from '../react/ir-types';
import type {
  SemanticSnapshot,
  ElementChange,
  ElementModification,
} from '../ai/types';
import type {
  PredictedDelta,
  ObservedDelta,
  ObservabilityScope,
  EffectCause,
  EffectOutcome,
  EffectVerification,
} from './effect-types';

// ---------------------------------------------------------------------------
// Element-id matching (supports exact OR glob, since `reveals` uses globs)
// ---------------------------------------------------------------------------

/**
 * Compile a `reveals`-style id pattern (exact id or `prefix-*` glob) into a
 * matcher. Globs use `*` (any run) and `?` (single char); all other regex
 * metacharacters are escaped.
 */
function idMatches(pattern: string, candidate: string): boolean {
  if (pattern === candidate) return true;
  if (!pattern.includes('*') && !pattern.includes('?')) return false;
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regexSource = '^' + escaped.replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
  return new RegExp(regexSource).test(candidate);
}

/**
 * Does an {@link IRElementCriteria} match an {@link ElementChange}? Every
 * present criterion must hold (conjunction). Matches by id (exact or glob),
 * role/type, and text (exact + contains, case-insensitive on the description).
 */
function criteriaMatchesChange(criteria: IRElementCriteria, change: ElementChange): boolean {
  if (criteria.id !== undefined && !idMatches(criteria.id, change.elementId)) {
    return false;
  }
  // `role` is matched against the change's `type`/`semanticType` (the diff
  // does not surface ARIA role on appeared/disappeared changes).
  if (criteria.role !== undefined) {
    const role = criteria.role.toLowerCase();
    const type = change.type?.toLowerCase() ?? '';
    const semanticType = change.semanticType?.toLowerCase() ?? '';
    if (type !== role && semanticType !== role) return false;
  }
  if (criteria.text !== undefined) {
    if ((change.description ?? '') !== criteria.text) return false;
  }
  if (criteria.textContains !== undefined) {
    const desc = (change.description ?? '').toLowerCase();
    if (!desc.includes(criteria.textContains.toLowerCase())) return false;
  }
  if (criteria.ariaLabel !== undefined) {
    const desc = (change.description ?? '').toLowerCase();
    if (!desc.includes(criteria.ariaLabel.toLowerCase())) return false;
  }
  return true;
}

/** Does any change in the list satisfy the criterion? */
function someChangeMatches(criteria: IRElementCriteria, changes: ElementChange[]): boolean {
  return changes.some((c) => criteriaMatchesChange(criteria, c));
}

/**
 * Does an {@link IRElementCriteria} match an {@link ElementModification}? Used
 * for `elementsModify` predictions. Matches by id (exact or glob) and by the
 * modified `property` against the expected partial-state keys.
 */
function criteriaMatchesModification(
  criteria: IRElementCriteria,
  expectKeys: string[],
  mod: ElementModification,
): boolean {
  if (criteria.id !== undefined && !idMatches(criteria.id, mod.elementId)) {
    return false;
  }
  if (criteria.textContains !== undefined) {
    const desc = (mod.description ?? '').toLowerCase();
    if (!desc.includes(criteria.textContains.toLowerCase())) return false;
  }
  // If the prediction names specific properties (e.g. `value`, `focused`),
  // require the observed modification to touch one of them.
  if (expectKeys.length > 0 && !expectKeys.includes(mod.property)) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Snapshot membership (for the §6.3 active-negation edge case)
// ---------------------------------------------------------------------------

/** Was a predicted-appear criterion's target already present in the pre-snapshot? */
function targetPresentInPre(criteria: IRElementCriteria, omegaPre: SemanticSnapshot): boolean {
  if (criteria.id === undefined) return false;
  return omegaPre.elements.some((el) => idMatches(criteria.id as string, el.id));
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

/**
 * Collect every element-id criterion the prediction constrains (appear,
 * disappear, modify). Criteria without an `id` contribute to the criteria
 * count but are always considered in-scope (they cannot fall outside the
 * id-scoped capture).
 */
function predictedCriteria(predicted: PredictedDelta): IRElementCriteria[] {
  const out: IRElementCriteria[] = [];
  for (const c of predicted.elementsAppear ?? []) out.push(c);
  for (const c of predicted.elementsDisappear ?? []) out.push(c);
  for (const m of predicted.elementsModify ?? []) out.push(m.criteria);
  return out;
}

/** Total count of distinct predicted facts (used as the coverage denominator). */
function predictedFactCount(predicted: PredictedDelta): number {
  let n = 0;
  n += (predicted.elementsAppear ?? []).length;
  n += (predicted.elementsDisappear ?? []).length;
  n += (predicted.elementsModify ?? []).length;
  n += (predicted.stateActivates ?? []).length;
  n += (predicted.stateDeactivates ?? []).length;
  if (predicted.navigationTo !== undefined) n += 1;
  if (predicted.errorsAppear !== undefined) n += 1;
  return n;
}

/**
 * Is a predicted element-criterion within the captured observation scope? A
 * whole-page scope (no `elementIds`) covers everything. An id-scoped capture
 * covers a criterion iff the criterion's id matches one of the scope globs.
 * Criteria without an id are always in scope (state/nav-style predictions).
 */
function criterionInScope(criteria: IRElementCriteria, scope: ObservabilityScope): boolean {
  if (!scope.elementIds || scope.elementIds.length === 0) return true;
  if (criteria.id === undefined) return true;
  return scope.elementIds.some(
    (s) => idMatches(s, criteria.id as string) || idMatches(criteria.id as string, s),
  );
}

/**
 * Coverage = fraction of predicted element-criteria whose target id is within
 * the captured scope. Non-element predictions (nav, state, errors) and a
 * whole-page scope always count as fully covered. Empty prediction → 1.0.
 */
function computeCoverage(predicted: PredictedDelta, scope: ObservabilityScope): number {
  const elementCriteria = predictedCriteria(predicted);
  const totalFacts = predictedFactCount(predicted);
  if (totalFacts === 0) return 1;

  // Non-element facts (nav/state/errors) are always observable in their scope.
  const nonElementFacts = totalFacts - elementCriteria.length;
  let inScope = nonElementFacts;
  for (const c of elementCriteria) {
    if (criterionInScope(c, scope)) inScope += 1;
  }
  return inScope / totalFacts;
}

// ---------------------------------------------------------------------------
// P ⊆ O — every predicted change present in observed
// ---------------------------------------------------------------------------

function predictedSubsetOfObserved(predicted: PredictedDelta, observed: ObservedDelta): boolean {
  for (const c of predicted.elementsAppear ?? []) {
    if (!someChangeMatches(c, observed.appeared)) return false;
  }
  for (const c of predicted.elementsDisappear ?? []) {
    if (!someChangeMatches(c, observed.disappeared)) return false;
  }
  for (const m of predicted.elementsModify ?? []) {
    const expectKeys = Object.keys(m.expect ?? {});
    if (!observed.modified.some((mod) => criteriaMatchesModification(m.criteria, expectKeys, mod))) {
      return false;
    }
  }
  if (predicted.navigationTo !== undefined) {
    if (!navigationSatisfied(predicted.navigationTo, observed.navigatedTo)) return false;
  }
  if (predicted.errorsAppear !== undefined) {
    if (predicted.errorsAppear === 'none') {
      if (observed.errorsAppeared !== 0) return false;
    }
    // `{ severityAtMost }`: the observed delta does not carry per-error
    // severity, so we treat any appeared error as satisfying a non-'none'
    // bound (the bound is a ceiling, not a requirement that errors appear).
  }
  // state activations/deactivations: a state activates iff an element keyed by
  // that state id appeared (or modified to active); deactivates iff disappeared.
  for (const state of predicted.stateActivates ?? []) {
    if (!stateActivatedInObserved(state, observed)) return false;
  }
  for (const state of predicted.stateDeactivates ?? []) {
    if (!stateDeactivatedInObserved(state, observed)) return false;
  }
  return true;
}

function navigationSatisfied(target: string | RegExp, navigatedTo: string | undefined): boolean {
  if (navigatedTo === undefined) return false;
  if (typeof target === 'string') return navigatedTo === target;
  return target.test(navigatedTo);
}

/** A named state "activates" when an element identified by it appears. */
function stateActivatedInObserved(state: string, observed: ObservedDelta): boolean {
  return (
    observed.appeared.some((c) => idMatches(state, c.elementId)) ||
    observed.modified.some((m) => idMatches(state, m.elementId))
  );
}

/** A named state "deactivates" when an element identified by it disappears. */
function stateDeactivatedInObserved(state: string, observed: ObservedDelta): boolean {
  return (
    observed.disappeared.some((c) => idMatches(state, c.elementId)) ||
    observed.modified.some((m) => idMatches(state, m.elementId))
  );
}

// ---------------------------------------------------------------------------
// O ⊆ P — every observed change was predicted (nothing extra)
// ---------------------------------------------------------------------------

function observedSubsetOfPredicted(predicted: PredictedDelta, observed: ObservedDelta): boolean {
  const appearCriteria = predicted.elementsAppear ?? [];
  const stateActivates = predicted.stateActivates ?? [];
  for (const change of observed.appeared) {
    const predictedByAppear = appearCriteria.some((c) => criteriaMatchesChange(c, change));
    const predictedByState = stateActivates.some((s) => idMatches(s, change.elementId));
    // An appeared error is covered iff the prediction allows errors (non-'none').
    const isError = change.semanticType?.includes('error') || change.type === 'alert';
    const predictedByError =
      isError && predicted.errorsAppear !== undefined && predicted.errorsAppear !== 'none';
    if (!predictedByAppear && !predictedByState && !predictedByError) return false;
  }

  const disappearCriteria = predicted.elementsDisappear ?? [];
  const stateDeactivates = predicted.stateDeactivates ?? [];
  for (const change of observed.disappeared) {
    const predictedByDisappear = disappearCriteria.some((c) => criteriaMatchesChange(c, change));
    const predictedByState = stateDeactivates.some((s) => idMatches(s, change.elementId));
    if (!predictedByDisappear && !predictedByState) return false;
  }

  const modifyPredictions = predicted.elementsModify ?? [];
  for (const mod of observed.modified) {
    const covered = modifyPredictions.some((m) =>
      criteriaMatchesModification(m.criteria, Object.keys(m.expect ?? {}), mod),
    );
    // A modification can also realise a predicted state (de)activation.
    const coveredByState =
      stateActivates.some((s) => idMatches(s, mod.elementId)) ||
      stateDeactivates.some((s) => idMatches(s, mod.elementId));
    if (!covered && !coveredByState) return false;
  }

  if (observed.navigatedTo !== undefined) {
    if (predicted.navigationTo === undefined) return false;
    if (!navigationSatisfied(predicted.navigationTo, observed.navigatedTo)) return false;
  }

  if (observed.errorsAppeared > 0) {
    // Errors are extra unless the prediction explicitly allows them.
    if (predicted.errorsAppear === undefined || predicted.errorsAppear === 'none') return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Active negation (plan §6.3)
// ---------------------------------------------------------------------------

/**
 * A predicted change was met by its OPPOSITE:
 *   - a predicted appearance whose target instead DISAPPEARED, or
 *   - a predicted disappearance whose target instead APPEARED.
 *
 * §6.3 edge case: if the predicted-appear element was ALREADY present in the
 * pre-snapshot, an empty/absent observed delta is SIMPLE ABSENCE → Failure,
 * NOT active negation. So an appear-prediction only counts as active negation
 * when the pre-snapshot shows the element was ABSENT (in the opposite state)
 * and the observed delta shows it moved the wrong way (it disappeared).
 */
function detectActiveNegation(
  predicted: PredictedDelta,
  observed: ObservedDelta,
  omegaPre: SemanticSnapshot,
): boolean {
  for (const c of predicted.elementsAppear ?? []) {
    // Predicted to appear, but observed it disappear → wrong direction.
    if (someChangeMatches(c, observed.disappeared)) {
      // Only active negation if it was ABSENT pre (so "appear" was a real
      // expectation). If it was already present, this is handled as absence.
      if (!targetPresentInPre(c, omegaPre)) {
        return true;
      }
      // It was present pre and disappeared: it moved the wrong way from a
      // present state — still a contradiction of "it should appear/persist".
      return true;
    }
  }
  for (const c of predicted.elementsDisappear ?? []) {
    // Predicted to disappear, but observed it appear → wrong direction.
    if (someChangeMatches(c, observed.appeared)) {
      return true;
    }
  }
  for (const state of predicted.stateActivates ?? []) {
    if (observed.disappeared.some((ch) => idMatches(state, ch.elementId))) return true;
  }
  for (const state of predicted.stateDeactivates ?? []) {
    if (observed.appeared.some((ch) => idMatches(state, ch.elementId))) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify a predict-then-verify cycle. Pure: no DOM, no side effects.
 *
 * Outcome table (plan §3.4):
 *   - coverage < 1 → `Partial` (OVERRIDES everything else).
 *   - else P⊆O ∧ O⊆P → `Confirmed`.
 *   - else P⊆O ∧ ¬O⊆P → `Surprise`.
 *   - else ¬P⊆O ∧ activeNegation → `Contradiction`.
 *   - else (¬P⊆O ∧ ¬activeNegation) → `Failure`.
 *
 * Mixed-cause downgrade: if `cause === 'mixed'` and the outcome would be
 * `Confirmed`, it is downgraded to `Surprise` (a concurrent observational
 * change happened alongside the causal one).
 */
export function computeVerification(
  predicted: PredictedDelta,
  observed: ObservedDelta,
  omegaPre: SemanticSnapshot,
  scope: ObservabilityScope,
  cause: EffectCause,
  durationMs: number,
): EffectVerification {
  const predictedSubsetObserved = predictedSubsetOfObserved(predicted, observed);
  const observedSubsetPredicted = observedSubsetOfPredicted(predicted, observed);
  const activeNegation = detectActiveNegation(predicted, observed, omegaPre);
  const coverage = computeCoverage(predicted, scope);

  let outcome: EffectOutcome;
  if (coverage < 1) {
    outcome = 'Partial';
  } else if (predictedSubsetObserved && observedSubsetPredicted) {
    outcome = 'Confirmed';
  } else if (predictedSubsetObserved && !observedSubsetPredicted) {
    outcome = 'Surprise';
  } else if (!predictedSubsetObserved && activeNegation) {
    outcome = 'Contradiction';
  } else {
    outcome = 'Failure';
  }

  // Mixed-cause downgrade: a concurrent observational change muddies a clean
  // confirmation.
  if (cause === 'mixed' && outcome === 'Confirmed') {
    outcome = 'Surprise';
  }

  return {
    outcome,
    predicted,
    observed,
    containment: {
      predictedSubsetObserved,
      observedSubsetPredicted,
      activeNegation,
      coverage,
    },
    cause,
    durationMs,
  };
}
