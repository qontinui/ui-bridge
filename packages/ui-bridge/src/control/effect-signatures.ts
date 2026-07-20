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
 * Resolves an {@link EffectSignature} for an `(action, element, params)` tuple,
 * or `undefined` when no concrete prediction exists.
 */
export interface SignatureLookup {
  resolve(
    action: string,
    element: SignatureLookupElement | undefined,
    params?: Record<string, unknown>,
  ): EffectSignature | undefined;
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

class DefaultSignatureRegistry implements SignatureLookup {
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

/** Create the default Phase 1 signature registry. */
export function createDefaultSignatureRegistry(): SignatureLookup {
  return new DefaultSignatureRegistry();
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
function signatureFromInferredEntry(entry: InferredSignatureEntry): EffectSignature | undefined {
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
    predicts: (): PredictedDelta => delta,
    scope,
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
      return signatureFromInferredEntry(perTarget);
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
      return signatureFromInferredEntry(actionEntries[0]);
    }

    // 4. No declared signature and no unambiguous inferred entry → undefined.
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
