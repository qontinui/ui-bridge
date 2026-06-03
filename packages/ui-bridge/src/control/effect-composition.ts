/**
 * D3 Effect Calculus — Phase 3b: Workflow Composition
 *
 * A workflow is a sequence of actions, each of which carries its own
 * {@link EffectSignature}/{@link PredictedDelta}. This module composes the
 * per-step predictions into ONE workflow-level prediction:
 *
 *     Σ_steps  =  ⊕ predicted_i
 *
 * The workflow engine captures exactly one pre-snapshot (before the first
 * step) and one post-snapshot (after the last step), computes the end-to-end
 * observed delta, and verifies it against this composed prediction. This
 * catches the class of bug where every step was individually `Confirmed` yet
 * the workflow as a whole drifted (an extra unpredicted element appeared, a
 * navigation landed somewhere unexpected, etc.).
 *
 * Pure: no DOM access, no side effects. It only reads the supplied
 * pre-snapshot and the signature registry.
 */

import type { IRElementCriteria } from '../react/ir-types';
import type { ElementState } from '../core/types';
import type { ErrorSeverity } from '../debug/error-severity';
import type { SemanticSnapshot } from '../ai/types';
import { createDefaultSignatureRegistry } from './effect-signatures';
import type { SignatureLookup } from './effect-signatures';
import type {
  PredictedDelta,
  ObservabilityScope,
  ActionParams,
} from './effect-types';

// ---------------------------------------------------------------------------
// Step input shape
// ---------------------------------------------------------------------------

/**
 * The minimal per-step description {@link composeSignatures} needs. The
 * workflow engine maps each action step to this shape (reading the action
 * name, target element id + its `reveals`, and the resolved params).
 */
export interface CompositionStep {
  /** The action name (e.g. `click`, `navigate`, `type`). */
  action: string;
  /** The target element + its `reveals` glob list, when the action targets one. */
  element?: { id: string; reveals?: string[] };
  /** Resolved action params (text, value, url, state, …). */
  params?: Record<string, unknown>;
}

/** The composed workflow-level prediction plus its broadest scope. */
export interface ComposedPrediction {
  /** The unioned predicted delta across all signature-bearing steps. */
  predicted: PredictedDelta;
  /** The broadest scope across step scopes (whole-page if any step is). */
  scope: ObservabilityScope;
  /**
   * Count of steps that contributed a prediction. `0` means composition is a
   * no-op and the caller should SKIP composition verification entirely.
   */
  stepsWithSignatures: number;
}

// ---------------------------------------------------------------------------
// Dedupe helpers — identical entries are merged so the union does not grow a
// duplicate for every step that predicts the same change.
// ---------------------------------------------------------------------------

/** Stable structural key for an element criterion (order-independent). */
function criteriaKey(c: IRElementCriteria): string {
  return JSON.stringify(c, Object.keys(c).sort());
}

/** Concat `next` onto `acc`, dropping entries already present (by structural key). */
function mergeCriteria(
  acc: IRElementCriteria[] | undefined,
  next: IRElementCriteria[] | undefined,
): IRElementCriteria[] | undefined {
  if (!next || next.length === 0) return acc;
  const out = acc ? [...acc] : [];
  const seen = new Set(out.map(criteriaKey));
  for (const c of next) {
    const k = criteriaKey(c);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(c);
    }
  }
  return out;
}

/** Structural key for a modify prediction (criteria + expected keys). */
function modifyKey(m: { criteria: IRElementCriteria; expect: Partial<ElementState> }): string {
  return criteriaKey(m.criteria) + '|' + JSON.stringify(Object.keys(m.expect ?? {}).sort());
}

function mergeModify(
  acc: { criteria: IRElementCriteria; expect: Partial<ElementState> }[] | undefined,
  next: { criteria: IRElementCriteria; expect: Partial<ElementState> }[] | undefined,
): { criteria: IRElementCriteria; expect: Partial<ElementState> }[] | undefined {
  if (!next || next.length === 0) return acc;
  const out = acc ? [...acc] : [];
  const seen = new Set(out.map(modifyKey));
  for (const m of next) {
    const k = modifyKey(m);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(m);
    }
  }
  return out;
}

/** Concat string lists, dropping duplicates. */
function mergeStrings(
  acc: string[] | undefined,
  next: string[] | undefined,
): string[] | undefined {
  if (!next || next.length === 0) return acc;
  const out = acc ? [...acc] : [];
  const seen = new Set(out);
  for (const s of next) {
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

/**
 * Severity ordinal for `{ severityAtMost }` strictness comparison. Lower =
 * stricter ceiling. Keyed by the {@link ErrorSeverity} union members; an
 * unrecognized severity falls back to the least-strict rank via the lookup.
 */
const SEVERITY_ORDER: Record<ErrorSeverity, number> = {
  noise: 0,
  warning: 1,
  error: 2,
  crash: 3,
};

/**
 * Merge two `errorsAppear` predictions, keeping the STRICTEST. `'none'`
 * (no error of any severity allowed) is the strictest and always wins. Between
 * two `{ severityAtMost }` bounds, the lower (stricter) ceiling wins.
 */
function mergeErrors(
  acc: PredictedDelta['errorsAppear'],
  next: PredictedDelta['errorsAppear'],
): PredictedDelta['errorsAppear'] {
  if (next === undefined) return acc;
  if (acc === undefined) return next;
  if (acc === 'none' || next === 'none') return 'none';
  // Both are { severityAtMost }: keep the lower ceiling (stricter).
  const accRank = SEVERITY_ORDER[acc.severityAtMost] ?? 0;
  const nextRank = SEVERITY_ORDER[next.severityAtMost] ?? 0;
  return accRank <= nextRank ? acc : next;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Union the per-step predicted deltas into one workflow-level prediction.
 *
 * Merge semantics (plan §3.6 "Σ_steps = ⊕ predicted"):
 *   - `elementsAppear` / `elementsDisappear` — concatenated, identical entries
 *     deduped (a glob predicted by two steps is one criterion).
 *   - `elementsModify` — concatenated + deduped by (criteria, expected keys).
 *   - `stateActivates` / `stateDeactivates` — string union, deduped.
 *   - `navigationTo` — the LAST non-undefined wins (the workflow's final
 *     destination, not an intermediate hop).
 *   - `errorsAppear` — the STRICTEST wins (`'none'` beats any bound; a lower
 *     `severityAtMost` ceiling beats a higher one).
 *
 * The composed scope is the BROADEST across step scopes: the union of every
 * step's `elementIds`, EXCEPT that if any contributing step is whole-page
 * (no `elementIds`), the composed scope is whole-page (`elementIds` omitted).
 * `unchangedFromPrevious` is never set at the workflow level — the workflow
 * always captures a fresh pre-snapshot.
 *
 * §6.4 hot-loop note: this composes predictions only; it captures NOTHING. The
 * workflow engine captures exactly ONE pre- and ONE post-snapshot for the whole
 * run (instead of N per-step captures), which IS the §6.4 snapshot-reuse
 * mitigation at the workflow granularity.
 *
 * @param steps    The action steps, in execution order.
 * @param pre      The workflow-level pre-snapshot (passed to each
 *                 `signature.predicts` so a prediction can read pre-state).
 * @param registry Signature lookup; defaults to the Phase 1 registry.
 */
export function composeSignatures(
  steps: CompositionStep[],
  pre: SemanticSnapshot,
  registry: SignatureLookup = createDefaultSignatureRegistry(),
): ComposedPrediction {
  const predicted: PredictedDelta = {};
  let stepsWithSignatures = 0;

  // Scope accumulation: collect every id, but flip to whole-page the moment a
  // signature-bearing step has a whole-page scope.
  let wholePage = false;
  const scopeIds: string[] = [];
  const seenScopeIds = new Set<string>();

  for (const step of steps) {
    const signature = registry.resolve(step.action, step.element, step.params);
    if (!signature) continue;

    const params: ActionParams = {
      action: step.action,
      elementId: step.element?.id,
      params: step.params,
    };
    const stepPredicted = signature.predicts(params, pre);
    stepsWithSignatures += 1;

    // Merge the predicted delta.
    predicted.elementsAppear = mergeCriteria(
      predicted.elementsAppear,
      stepPredicted.elementsAppear,
    );
    predicted.elementsDisappear = mergeCriteria(
      predicted.elementsDisappear,
      stepPredicted.elementsDisappear,
    );
    predicted.elementsModify = mergeModify(
      predicted.elementsModify,
      stepPredicted.elementsModify,
    );
    predicted.stateActivates = mergeStrings(
      predicted.stateActivates,
      stepPredicted.stateActivates,
    );
    predicted.stateDeactivates = mergeStrings(
      predicted.stateDeactivates,
      stepPredicted.stateDeactivates,
    );
    if (stepPredicted.navigationTo !== undefined) {
      // Last non-undefined wins — the workflow's final destination.
      predicted.navigationTo = stepPredicted.navigationTo;
    }
    predicted.errorsAppear = mergeErrors(predicted.errorsAppear, stepPredicted.errorsAppear);

    // Merge the scope (broadest).
    const stepScope = signature.scope;
    if (!stepScope.elementIds || stepScope.elementIds.length === 0) {
      wholePage = true;
    } else if (!wholePage) {
      for (const id of stepScope.elementIds) {
        if (!seenScopeIds.has(id)) {
          seenScopeIds.add(id);
          scopeIds.push(id);
        }
      }
    }
  }

  // `unchangedFromPrevious` is intentionally never set at the workflow level.
  const scope: ObservabilityScope = wholePage ? {} : { elementIds: scopeIds };

  return { predicted, scope, stepsWithSignatures };
}
