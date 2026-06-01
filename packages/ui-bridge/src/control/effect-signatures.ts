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
      elementsModify: [{ criteria: { id: targetId }, expect: { value: '' } }],
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
      elementsModify: [{ criteria: { id: targetId }, expect: { value: '' } }],
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
        expect: { value: '' },
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
