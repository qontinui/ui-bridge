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
import {
  getGlobalActionWindowRegistry,
  unanchoredBoundForTimeout,
} from './action-window-registry';
import type {
  ActionParams,
  EffectCause,
  EffectSignature,
  EffectVerification,
  ObservabilityScope,
  ObservedDelta,
  PredictedDelta,
} from './effect-types';

/** Monotonic counter for synthesizing a window id when no requestId is given. */
let synthSeq = 0;

/**
 * Dependencies the verifier needs from the host (supplied by the executor).
 */
export interface EffectVerifierDeps {
  /** Capture a semantic snapshot scoped to the given observability scope. */
  captureSnapshot: (scope: ObservabilityScope) => Promise<SemanticSnapshot>;
  /** Resolve after `settleMs` milliseconds. */
  settle: (settleMs: number) => Promise<void>;
  /**
   * Clock injection, so a test can pin the settle window's anchors without
   * faking `Date`. Every time `verifyAction` reads goes through it. Defaults
   * to `Date.now`.
   */
  now?: () => number;
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
  private readonly now: () => number;

  constructor(private deps: EffectVerifierDeps) {
    this.now = deps.now ?? Date.now;
  }

  /**
   * Run `executeFn` inside a predict-then-verify cycle. Returns both the
   * action result and the verification. Does NOT throw on a bad prediction
   * outcome; rethrows only if `executeFn` itself throws.
   *
   * `options.alsoPredict` (Phase 5) evaluates a SECOND signature against the
   * same `pre` snapshot and returns its prediction alongside, without
   * verifying against it. That is what makes a declared-vs-inferred
   * disagreement measurable: two predictions compared across two different
   * snapshots would report the world moving as if it were the arms
   * disagreeing. It costs one extra `predicts()` call and no extra capture.
   * Its failure is contained — a throwing second `predicts` must not sink the
   * action or the real verification, so it is caught and dropped.
   *
   * `options.timeoutMs` is the action's own timeout, when it has one. It sizes
   * the window's un-anchored bound ({@link unanchoredBoundForTimeout}) so a
   * legitimately long action keeps its window for as long as it may run. If the
   * window expires anyway before the settle starts, the cause is reported as
   * `'unknown'` (unless a concurrent observation was already seen: `'mixed'`).
   */
  async verifyAction<T>(
    params: ActionParams,
    signature: EffectSignature,
    executeFn: () => Promise<T>,
    options?: { alsoPredict?: EffectSignature; timeoutMs?: number },
  ): Promise<{
    result: T;
    verification: EffectVerification;
    alsoPredicted?: PredictedDelta;
  }> {
    const startTime = this.now();

    // Settle window length (override → per-action band → fallback). It sizes
    // the settle we await in step 5, and the window's end is anchored to that
    // same settle (start of settle + settleMs), never to when the window opened.
    const settleMs = settleMsForAction(params.action, signature.settleMs);

    // 1. Scoped pre-snapshot.
    const pre = await this.deps.captureSnapshot(signature.scope);

    // 2. Prediction.
    const predicted = signature.predicts(params, pre);

    // 2b. The second arm's prediction, against the SAME pre-snapshot.
    let alsoPredicted: PredictedDelta | undefined;
    if (options?.alsoPredict !== undefined) {
      try {
        alsoPredicted = options.alsoPredict.predicts(params, pre);
      } catch {
        // A second-arm prediction is diagnostic. Its author bug is not
        // allowed to change the outcome of the action under test.
        alsoPredicted = undefined;
      }
    }

    // 3. Open the settle window so concurrent background observations (flagged
    //    by the BackgroundObserver) can be attributed to this action. The
    //    window opens just before execution and closes after the post-snapshot.
    //    It opens with NO end: the settle does not start until the action
    //    returns, so its end is only knowable at step 5.
    const registry = getGlobalActionWindowRegistry();
    const requestId = params.requestId ?? `effect-${this.now()}-${synthSeq++}`;
    const windowHandle = registry.beginAction(
      requestId,
      params.action,
      this.now(),
      unanchoredBoundForTimeout(options?.timeoutMs),
    );

    try {
      // 4. Execute the real action (errors propagate by design — but we still
      //    close the window in `finally` so a thrown action never leaks a
      //    perpetually-open window into the registry).
      const result = await executeFn();

      // 5. Settle window. Anchor the window's end to the REAL settle start, so
      //    it covers [action start, settleStart + settleMs]. Anchoring it at
      //    open time instead (`open + settleMs`) expired it during any action
      //    slower than `settleMs`, dropping every observation from then on —
      //    the rest of the action and the whole settle (finding 736a7c2c). The
      //    settle duration itself is unchanged. `false` means the window
      //    outlived its un-anchored bound and was closed before the settle, so
      //    observations after the bound were not attributed (step 7).
      const anchored = registry.anchorSettle(windowHandle, this.now(), settleMs);
      await this.deps.settle(settleMs);

      // 6. Post-snapshot.
      const post = await this.deps.captureSnapshot(signature.scope);

      // 7. Attribution: if a significant background change landed in this
      //    window, the cause is 'mixed' (concurrent observational change
      //    alongside the causal one). If the window expired before the settle
      //    with no observation seen, attribution is 'unknown' — later
      //    observations were dropped, so a clean 'causal' would be a guess.
      //    Otherwise it is 'causal'. Read the flag BEFORE ending the window.
      const cause: EffectCause = registry.hadConcurrentObservation(windowHandle)
        ? 'mixed'
        : anchored
          ? 'causal'
          : 'unknown';

      // 8. Observed delta via the existing diff engine (reused, not reimplemented).
      const diff = computeDiff(pre, post);
      const observed: ObservedDelta = {
        appeared: diff.changes.appeared,
        disappeared: diff.changes.disappeared,
        modified: diff.changes.modified,
        navigatedTo: deriveNavigatedTo(pre, post),
        errorsAppeared: diff.changes.appeared.filter(isErrorChange).length,
      };

      // 9. Classify. `cause === 'mixed'` downgrades a clean Confirmed → Surprise
      //    inside computeVerification.
      const durationMs = this.now() - startTime;
      const verification = computeVerification(
        predicted,
        observed,
        pre,
        signature.scope,
        cause,
        durationMs,
      );

      return { result, verification, alsoPredicted };
    } finally {
      registry.end(windowHandle);
    }
  }
}
