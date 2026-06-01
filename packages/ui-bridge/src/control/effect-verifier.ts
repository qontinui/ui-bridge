/**
 * D3 Effect Calculus — Verifier (orchestrator)
 *
 * Wraps an action's execution in a predict-then-verify cycle:
 *   1. capture a scoped pre-snapshot,
 *   2. compute the predicted delta,
 *   3. run the action,
 *   4. await the settle window,
 *   5. capture the post-snapshot,
 *   6. compute the observed delta (via the existing {@link computeDiff}),
 *   7. classify via {@link computeVerification}.
 *
 * This is the single integration entrypoint the action executor will call
 * (`EffectVerifier.verifyAction`). It is additive — it never alters action
 * behaviour, and it never throws on a failed prediction (a bad outcome is
 * returned as data). If the wrapped action itself throws, the error propagates.
 */

import { computeDiff } from '../ai/semantic-diff';
import type { SemanticSnapshot, ElementChange } from '../ai/types';
import { computeVerification } from './effect-containment';
import { settleMsForAction } from './settle-windows';
import type {
  ActionParams,
  EffectSignature,
  EffectVerification,
  ObservabilityScope,
  ObservedDelta,
} from './effect-types';

/**
 * Dependencies the verifier needs from the host (supplied by the executor).
 */
export interface EffectVerifierDeps {
  /** Capture a semantic snapshot scoped to the given observability scope. */
  captureSnapshot: (scope: ObservabilityScope) => Promise<SemanticSnapshot>;
  /** Resolve after `settleMs` milliseconds. */
  settle: (settleMs: number) => Promise<void>;
}

/** An appeared element is "error-like" by the same heuristic the diff uses. */
function isErrorChange(change: ElementChange): boolean {
  return change.semanticType?.includes('error') === true || change.type === 'alert';
}

/**
 * Derive the navigated-to route from the pre/post page context. Returns the
 * post route only when it actually differs from the pre route.
 */
function deriveNavigatedTo(
  pre: SemanticSnapshot,
  post: SemanticSnapshot,
): string | undefined {
  const preRoute = pre.page.pathname ?? pre.page.url;
  const postRoute = post.page.pathname ?? post.page.url;
  if (postRoute !== undefined && postRoute !== preRoute) return postRoute;
  return undefined;
}

export class EffectVerifier {
  constructor(private deps: EffectVerifierDeps) {}

  /**
   * Run `executeFn` inside a predict-then-verify cycle. Returns both the
   * action result and the verification. Does NOT throw on a bad prediction
   * outcome; rethrows only if `executeFn` itself throws.
   */
  async verifyAction<T>(
    params: ActionParams,
    signature: EffectSignature,
    executeFn: () => Promise<T>,
  ): Promise<{ result: T; verification: EffectVerification }> {
    const startTime = Date.now();

    // 1. Scoped pre-snapshot.
    const pre = await this.deps.captureSnapshot(signature.scope);

    // 2. Prediction.
    const predicted = signature.predicts(params, pre);

    // 3. Execute the real action (errors propagate by design).
    const result = await executeFn();

    // 4. Settle window (override → per-action band → fallback).
    const settleMs = settleMsForAction(params.action, signature.settleMs);
    await this.deps.settle(settleMs);

    // 5. Post-snapshot.
    const post = await this.deps.captureSnapshot(signature.scope);

    // 6. Observed delta via the existing diff engine (reused, not reimplemented).
    const diff = computeDiff(pre, post);
    const observed: ObservedDelta = {
      appeared: diff.changes.appeared,
      disappeared: diff.changes.disappeared,
      modified: diff.changes.modified,
      navigatedTo: deriveNavigatedTo(pre, post),
      errorsAppeared: diff.changes.appeared.filter(isErrorChange).length,
    };

    // 7. Classify. Phase 1 single-action path attributes the delta as 'causal';
    // the field is plumbed for Phase 2's settle-window attribution.
    const durationMs = Date.now() - startTime;
    const verification = computeVerification(
      predicted,
      observed,
      pre,
      signature.scope,
      'causal',
      durationMs,
    );

    return { result, verification };
  }
}
