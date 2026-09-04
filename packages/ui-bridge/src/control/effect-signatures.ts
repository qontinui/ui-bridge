/**
 * D3 Effect Calculus — Per-Handler Effect Signatures + Registry
 *
 * Declares the concrete Phase 1 effect signatures (the plan §3 "concrete
 * cases") and a registry that resolves an {@link EffectSignature} for a given
 * `(action, element, params)`. Where there is no concrete predictable delta,
 * resolving `undefined` (no signature → no verification) is the correct,
 * honest behaviour — predictions are never fabricated.
 */

import type { IRElementCriteria } from '../react/ir-types';
import type {
  EffectSignature,
  EffectSignatureId,
  PredictedDelta,
  ActionParams,
} from './effect-types';
import type { InferredSignatureTable, InferredSignatureEntry } from './effect-inference';
import { trustDeveloperContent } from '../core/redaction';

/**
 * The element shape the registry needs to resolve a signature. `reveals` is the
 * glob-or-id list a control unhides when activated (read from
 * `useUIElement`'s `reveals?: string[]`).
 */
export interface SignatureLookupElement {
  id: string;
  reveals?: string[];
}

/**
 * Both arms of a component-action signature resolution.
 *
 * The winner is on `signature`; `declared` and `inferred` are BOTH reported
 * even when only one of them won. That is the point: a declared signature that
 * wins while an inferred one also resolved and predicts something else is a
 * measurable disagreement between what the author says the action does and what
 * the recordings say it does — signal, not an error. See
 * `describeSignatureDisagreement` in `./effect-authoring`.
 */
export interface ComponentSignatureArms {
  /** The signature that won: declared beats inferred. */
  signature?: EffectSignature;
  /** The hand-declared arm — `ComponentAction.signature`, normalized. */
  declared?: EffectSignature;
  /** The inferred arm, synthesized from the recording history. */
  inferred?: EffectSignature;
}

/**
 * Where a lookup finds the signature an author declared on a
 * {@link ../core/types#ComponentAction}. Injected rather than imported so the
 * signature layer never has to reach into the component registry (which would
 * make `control/` depend on `core/`'s live registry instance, not just its
 * types).
 */
export type DeclaredComponentSignatureSource = (
  componentId: string,
  actionId: string,
) => EffectSignature | undefined;

/**
 * Resolves an {@link EffectSignature} for an `(action, element, params)` tuple,
 * or `undefined` when no concrete prediction exists.
 */
export interface SignatureLookup {
  resolve(
    action: string,
    element: SignatureLookupElement | undefined,
    params?: Record<string, unknown>,
  ): EffectSignature | undefined;

  /**
   * Resolve a signature for a COMPONENT action (Phase 5 of plan
   * `2026-09-04-effect-calculus-joins-the-component-action-registry`).
   *
   * `resolve()` above switches on seven element-level verbs; a component
   * action's id is free-form, so it fell through to `default: undefined` and
   * the whole component surface was invisible to the calculus. This is that
   * arm, on the same interface rather than in a parallel lookup — one door,
   * so a caller cannot get a signature from one resolver and a verification
   * from another.
   *
   * Order: the action's declared `signature` first, then the inferred table
   * keyed on the component action, then `undefined`. `undefined` is the
   * honest answer when nothing resolves — a prediction is never fabricated.
   */
  resolveComponentSignature(
    componentId: string,
    actionId: string,
    params?: Record<string, unknown>,
  ): EffectSignature | undefined;

  /**
   * Report BOTH arms instead of just the winner. Optional: a custom lookup
   * that only ever has one arm has nothing to disagree with, and callers fall
   * back to {@link SignatureLookup.resolveComponentSignature}. Both registries
   * shipped here implement it.
   */
  resolveComponentSignatureArms?(
    componentId: string,
    actionId: string,
    params?: Record<string, unknown>,
  ): ComponentSignatureArms;
}

// ---------------------------------------------------------------------------
// Signature identity (Phase 5)
// ---------------------------------------------------------------------------

/**
 * The default {@link EffectSignatureId} for a signature declared on a component
 * action: `` `${componentId}.${actionId}` ``.
 */
export function componentSignatureId(componentId: string, actionId: string): EffectSignatureId {
  return `${componentId}.${actionId}`;
}

/**
 * Normalize an author-declared component-action signature for use by the
 * calculus: stamp the default {@link EffectSignatureId} and
 * `provenance: 'declared'` when the author left them off.
 *
 * Returns a NEW object — the author's literal is never mutated, because it is
 * very often a module-level constant shared by every mount of the component.
 * An author-supplied `id` or `provenance` is preserved verbatim; the defaults
 * only fill absences.
 */
export function normalizeDeclaredComponentSignature(
  signature: EffectSignature | undefined,
  componentId: string,
  actionId: string,
): EffectSignature | undefined {
  if (!signature) return undefined;
  if (signature.id !== undefined && signature.provenance !== undefined) return signature;
  return {
    ...signature,
    id: signature.id ?? componentSignatureId(componentId, actionId),
    provenance: signature.provenance ?? 'declared',
  };
}

// ---------------------------------------------------------------------------
// Param readers
// ---------------------------------------------------------------------------

function readString(params: Record<string, unknown> | undefined, key: string): string | undefined {
  const v = params?.[key];
  return typeof v === 'string' ? v : undefined;
}

// ---------------------------------------------------------------------------
// Concrete signature builders
// ---------------------------------------------------------------------------

/**
 * click on an element with `reveals: [...]` → predicts those ids appear. With
 * no `reveals`, there is no concrete prediction → undefined.
 */
function clickSignature(element: SignatureLookupElement | undefined): EffectSignature | undefined {
  const reveals = element?.reveals;
  if (!reveals || reveals.length === 0) return undefined;
  return {
    predicts: (): PredictedDelta => ({
      elementsAppear: reveals.map((id) => ({ id }) as IRElementCriteria),
    }),
    scope: { elementIds: [...reveals] },
    reversibility: 'reversible',
    provenance: 'declared',
  };
}

/** navigate(url) → predicts navigation to the target url. Whole-page scope. */
function navigateSignature(
  params: Record<string, unknown> | undefined,
): EffectSignature | undefined {
  const url = readString(params, 'url') ?? readString(params, 'route') ?? readString(params, 'to');
  if (url === undefined) return undefined;
  return {
    predicts: (): PredictedDelta => ({ navigationTo: url }),
    scope: {},
    reversibility: 'reversible',
    provenance: 'declared',
  };
}

/** wait with a `state` param → predicts that state activates. */
function waitSignature(params: Record<string, unknown> | undefined): EffectSignature | undefined {
  const state = readString(params, 'state');
  if (state === undefined) return undefined;
  return {
    predicts: (): PredictedDelta => ({ stateActivates: [state] }),
    scope: { elementIds: [state] },
    settleMs: 0,
    reversibility: 'idempotent',
    provenance: 'declared',
  };
}

/**
 * type(text) on the target input → predicts the focused/target element is
 * modified (its `value` changes). Honest: predicts modification of the target.
 */
function typeSignature(
  element: SignatureLookupElement | undefined,
  pre: { focusedElement?: string } | undefined,
): EffectSignature | undefined {
  const targetId = element?.id ?? pre?.focusedElement;
  if (targetId === undefined) return undefined;
  return {
    predicts: (): PredictedDelta => ({
      elementsModify: [{ criteria: { id: targetId }, expect: { value: trustDeveloperContent('') } }],
    }),
    scope: { elementIds: [targetId] },
    reversibility: 'reversible',
    provenance: 'declared',
  };
}

/** select on a target → predicts the target's `value` changes. */
function selectSignature(element: SignatureLookupElement | undefined): EffectSignature | undefined {
  const targetId = element?.id;
  if (targetId === undefined) return undefined;
  return {
    predicts: (): PredictedDelta => ({
      elementsModify: [{ criteria: { id: targetId }, expect: { value: trustDeveloperContent('') } }],
    }),
    scope: { elementIds: [targetId] },
    reversibility: 'reversible',
    provenance: 'declared',
  };
}

/** focus on a target → predicts the target becomes focused. */
function focusSignature(element: SignatureLookupElement | undefined): EffectSignature | undefined {
  const targetId = element?.id;
  if (targetId === undefined) return undefined;
  return {
    predicts: (): PredictedDelta => ({
      elementsModify: [{ criteria: { id: targetId }, expect: { focused: true } }],
    }),
    scope: { elementIds: [targetId] },
    settleMs: 50,
    reversibility: 'idempotent',
    provenance: 'declared',
  };
}

/**
 * fill → predicts each filled field is modified. The `fields` param maps field
 * id → value; each resolvable field id yields a `value` modification.
 */
function fillSignature(params: Record<string, unknown> | undefined): EffectSignature | undefined {
  const fields = params?.['fields'];
  if (typeof fields !== 'object' || fields === null) return undefined;
  const fieldIds = Object.keys(fields as Record<string, unknown>);
  if (fieldIds.length === 0) return undefined;
  return {
    predicts: (): PredictedDelta => ({
      elementsModify: fieldIds.map((id) => ({
        criteria: { id } as IRElementCriteria,
        expect: { value: trustDeveloperContent('') },
      })),
    }),
    scope: { elementIds: [...fieldIds] },
    reversibility: 'reversible',
    provenance: 'declared',
  };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** Options for {@link createDefaultSignatureRegistry}. */
export interface DefaultSignatureRegistryOptions {
  /**
   * How to find the signature an author declared on a component action. Without
   * it the default registry has no declared arm for the component surface and
   * `resolveComponentSignature` always answers `undefined` — which is honest,
   * not broken: nothing told it where the declarations live.
   */
  declaredComponentSignature?: DeclaredComponentSignatureSource;
}

class DefaultSignatureRegistry implements SignatureLookup {
  constructor(private readonly options?: DefaultSignatureRegistryOptions) {}

  resolveComponentSignature(
    componentId: string,
    actionId: string,
  ): EffectSignature | undefined {
    return normalizeDeclaredComponentSignature(
      this.options?.declaredComponentSignature?.(componentId, actionId),
      componentId,
      actionId,
    );
  }

  resolveComponentSignatureArms(
    componentId: string,
    actionId: string,
  ): ComponentSignatureArms {
    // No inference table at this layer, so there is exactly one arm and
    // nothing to disagree with.
    const declared = this.resolveComponentSignature(componentId, actionId);
    return { signature: declared, declared };
  }

  resolve(
    action: string,
    element: SignatureLookupElement | undefined,
    params?: Record<string, unknown>,
  ): EffectSignature | undefined {
    switch (action) {
      case 'click':
        return clickSignature(element);
      case 'navigate':
        return navigateSignature(params);
      case 'wait':
        return waitSignature(params);
      case 'type':
        // `focusedElement` may be threaded via params for the focused-input case.
        return typeSignature(element, {
          focusedElement: readString(params, 'focusedElement'),
        });
      case 'select':
        return selectSignature(element);
      case 'focus':
        return focusSignature(element);
      case 'fill':
        return fillSignature(params);
      // No concrete predictable delta — honest `undefined` (no verification).
      case 'scroll':
      case 'evaluate':
      default:
        return undefined;
    }
  }
}

/**
 * Create the default Phase 1 signature registry.
 *
 * Pass `declaredComponentSignature` to give it a component-action arm — the
 * action executor wires it to its own component registry, so an author's
 * `ComponentAction.signature` resolves without the calculus importing the
 * registry.
 */
export function createDefaultSignatureRegistry(
  options?: DefaultSignatureRegistryOptions,
): SignatureLookup {
  return new DefaultSignatureRegistry(options);
}

/**
 * Convenience: resolve a signature given a full {@link ActionParams} bag. The
 * registry is stateless, so this constructs one on the fly.
 */
export function resolveSignature(
  params: ActionParams,
  element: SignatureLookupElement | undefined,
): EffectSignature | undefined {
  return createDefaultSignatureRegistry().resolve(params.action, element, params.params);
}

// ---------------------------------------------------------------------------
// Phase 4 — declared-first, inferred-fallback registry
// ---------------------------------------------------------------------------

export interface InferredRegistryOptions {
  /**
   * Resolve a live element id → its recording fingerprint, if known. Lets the
   * inferred table be looked up per-target; when absent (or returning
   * `undefined`), the registry falls back to an action-level aggregate when one
   * exists unambiguously.
   */
  fingerprintOf?: (elementId: string) => string | undefined;
}

/**
 * Build a static {@link EffectSignature} from an inferred table entry. The
 * `predicts` callback ignores the live pre-snapshot: an inferred entry is a
 * *static aggregate* (a measured tendency), not a per-snapshot computation. That
 * is honest — the prediction is "this consequence tends to follow this action",
 * and the live snapshot is what verification compares it against, not what
 * shapes it.
 */
function signatureFromInferredEntry(
  entry: InferredSignatureEntry,
  id: EffectSignatureId,
): EffectSignature | undefined {
  if (entry.facts.length === 0) return undefined;

  const elementsAppear = entry.facts.filter((f) => f.kind === 'appear').map((f) => f.criteria);
  const elementsDisappear = entry.facts
    .filter((f) => f.kind === 'disappear')
    .map((f) => f.criteria);

  const delta: PredictedDelta = {};
  if (elementsAppear.length > 0) delta.elementsAppear = elementsAppear;
  if (elementsDisappear.length > 0) delta.elementsDisappear = elementsDisappear;

  const meanConfidence =
    entry.facts.reduce((sum, f) => sum + f.confidence, 0) / entry.facts.length;

  // Scope: id-scope only when EVERY kept criterion carries an id (rare for
  // inferred facts, which are role/text-based). Otherwise whole-page so the
  // role/text consequences remain in the captured observation window.
  const allHaveIds =
    entry.facts.length > 0 && entry.facts.every((f) => f.criteria.id !== undefined);
  const scope = allHaveIds
    ? { elementIds: entry.facts.map((f) => f.criteria.id as string) }
    : {};

  return {
    // Phase 5: an inferred signature is named by the very key the table found
    // it under (`keyFor(action, targetFingerprint)`), so a downstream consumer
    // — the predict route, a disagreement record — can say WHICH aggregate
    // produced a prediction rather than pointing at an anonymous closure.
    id,
    predicts: (): PredictedDelta => delta,
    scope,
    // ⚠ HARD-CODED, and load-bearing for the authoring lint. Inference cannot
    // observe irreversibility: it sees which consequences followed an action,
    // never whether they could be undone. `'reversible'` here is the absence
    // of evidence, not evidence of reversibility — which is exactly why
    // `assertComponentActionEffectConsistency` refuses to read it as a
    // contradiction of a declared `'destructive'`.
    reversibility: 'reversible',
    provenance: 'inferred',
    confidence: meanConfidence,
  };
}

class InferredSignatureRegistry implements SignatureLookup {
  constructor(
    private readonly table: InferredSignatureTable,
    private readonly base: SignatureLookup,
    private readonly options: InferredRegistryOptions | undefined,
  ) {}

  resolve(
    action: string,
    element: SignatureLookupElement | undefined,
    params?: Record<string, unknown>,
  ): EffectSignature | undefined {
    // 1. Declared-first: a hand-authored signature always wins.
    const declared = this.base.resolve(action, element, params);
    if (declared) return declared;

    // 2. Per-target inferred lookup: map the live element id → its recording
    //    fingerprint (when known) and key the table by it.
    const fingerprint = this.options?.fingerprintOf?.(element?.id ?? '') ?? null;
    const perTargetKey = this.table.keyFor(action, fingerprint);
    const perTarget = this.table.bySignatureKey.get(perTargetKey);
    if (perTarget) {
      return signatureFromInferredEntry(perTarget, perTargetKey);
    }

    // 3. Action-level fallback: when the per-target lookup misses (no
    //    fingerprint mapping, or the recorded target differs), use an
    //    action-level aggregate ONLY when exactly one inferred entry exists for
    //    this action. Ambiguity (multiple targets recorded for the action) is
    //    resolved to no inference rather than guessing which target applies.
    const actionEntries: InferredSignatureEntry[] = [];
    for (const entry of this.table.bySignatureKey.values()) {
      if (entry.action === action) actionEntries.push(entry);
    }
    if (actionEntries.length === 1) {
      const only = actionEntries[0];
      return signatureFromInferredEntry(
        only,
        this.table.keyFor(only.action, only.targetFingerprint),
      );
    }

    // 4. No declared signature and no unambiguous inferred entry → undefined.
    return undefined;
  }

  /**
   * Component-action arm (Phase 5). Declared-first, then the inferred table.
   *
   * **The inferred probe never falls back to the bare action id.** The element
   * arm's step-3 action-level aggregate is safe there because the action name
   * IS the element verb; here it is not. Component action ids are free-form and
   * a component may well name one `click`, so an aggregate keyed on the bare
   * id would hand an element `click` recording to a component action that
   * merely shares its name — a fabricated prediction wearing a measurement's
   * confidence. Every probe below therefore carries the component identity.
   */
  resolveComponentSignature(
    componentId: string,
    actionId: string,
    params?: Record<string, unknown>,
  ): EffectSignature | undefined {
    return this.resolveComponentSignatureArms(componentId, actionId, params).signature;
  }

  resolveComponentSignatureArms(
    componentId: string,
    actionId: string,
    params?: Record<string, unknown>,
  ): ComponentSignatureArms {
    const declared = this.base.resolveComponentSignature(componentId, actionId, params);
    const inferred = this.inferredComponentSignature(componentId, actionId);
    return { signature: declared ?? inferred, declared, inferred };
  }

  private inferredComponentSignature(
    componentId: string,
    actionId: string,
  ): EffectSignature | undefined {
    const qualified = componentSignatureId(componentId, actionId);

    // 1. Recorded as `(actionId, componentId)` — the component in the target
    //    slot, mirroring how an element recording carries its target.
    const perComponentKey = this.table.keyFor(actionId, componentId);
    const perComponent = this.table.bySignatureKey.get(perComponentKey);
    if (perComponent) return signatureFromInferredEntry(perComponent, perComponentKey);

    // 2. Recorded under the qualified name with no target.
    const qualifiedKey = this.table.keyFor(qualified, null);
    const qualifiedEntry = this.table.bySignatureKey.get(qualifiedKey);
    if (qualifiedEntry) return signatureFromInferredEntry(qualifiedEntry, qualifiedKey);

    // 3. Exactly one entry recorded under the QUALIFIED name against some
    //    other target. Ambiguity resolves to no inference, never to a guess.
    const qualifiedEntries: InferredSignatureEntry[] = [];
    for (const entry of this.table.bySignatureKey.values()) {
      if (entry.action === qualified) qualifiedEntries.push(entry);
    }
    if (qualifiedEntries.length === 1) {
      const only = qualifiedEntries[0];
      return signatureFromInferredEntry(
        only,
        this.table.keyFor(only.action, only.targetFingerprint),
      );
    }

    return undefined;
  }
}

/**
 * Declared-first, inferred-fallback registry. `resolve()` returns the
 * hand-authored signature when one exists; otherwise an inferred signature
 * (`provenance: 'inferred'`, `confidence` set) synthesized from `table`;
 * otherwise `undefined`.
 *
 * Action-level fallback (step 3 in {@link InferredSignatureRegistry.resolve}):
 * when no per-target entry is found, an action-level aggregate is used *only* if
 * exactly one inferred entry exists for that action — this keeps the fallback
 * honest (no guessing among multiple recorded targets).
 */
export function createInferredSignatureRegistry(
  table: InferredSignatureTable,
  base?: SignatureLookup,
  options?: InferredRegistryOptions,
): SignatureLookup {
  return new InferredSignatureRegistry(table, base ?? createDefaultSignatureRegistry(), options);
}
