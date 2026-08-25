/**
 * Resolution Stability — how an element id was turned back into a live element,
 * and how much that ought to be trusted.
 *
 * ## Why this exists
 *
 * Every path that resolves an element id runs a **fallback chain**: try the
 * exact thing, then progressively less precise things, first hit wins. There
 * are two such chains in the SDK — `core/stable-ref.ts` `resolveStableRef`
 * (registry id → `[data-ui-bridge-id]` → fingerprint → semantic path) and the
 * action executor's own (registry id → identifier query → CTR → discovery
 * cache → page sentinel). Both used to return a bare element and nothing else.
 *
 * That made an exact registry hit and a fourth-strategy CSS-path guess —
 * "some `button.primary` eight levels up from something that matched" —
 * literally indistinguishable to the caller. Acting on the second one is a
 * coin flip the agent does not know it is taking.
 *
 * This module is the ONE vocabulary both chains report in, so a consumer does
 * not have to learn two ladders.
 *
 * ## These are ORDINAL LABELS, not probabilities
 *
 * Read {@link ResolutionStabilityClass} and {@link ELEMENT_RESOLUTION_RANK} as
 * *"this strategy is a stronger kind of evidence than that one"* and nothing
 * more. They are **not** calibrated confidences: nobody measured how often a
 * `semantic-path` resolution picks the wrong element, `rank 2` is not "twice as
 * likely to be right" as `rank 1`, and a `weak` resolution is not "70% correct".
 *
 * The naming is deliberate. `stabilityRank` is an integer on an arbitrary
 * scale, not a `0..1` float, precisely so it cannot be quietly multiplied into
 * something that looks like a probability — and it is called *stability*, not
 * *confidence*, because what the class actually captures is how resistant the
 * strategy is to a re-render, not how likely the match is to be the element the
 * caller meant. Nothing in this SDK reports a calibrated selector confidence,
 * and this module does not start.
 */

// ============================================================================
// Strategies
// ============================================================================

/**
 * Which strategy actually produced the element. Spans both resolution chains;
 * a given chain only ever emits its own subset.
 */
export type ElementResolutionStrategy =
  /** Exact `registry.getElement(id)` hit on a mounted, connected element. */
  | 'registry-id'
  /** Virtual page target (`document` / `body` / `window`) for page-scoped actions. */
  | 'page-sentinel'
  /** `[data-ui-bridge-id="..."]` DOM query — a developer-stamped attribute. */
  | 'ui-bridge-id-attr'
  /** `findElementByIdentifier` — testid / aria / role+name query off the id. */
  | 'element-identifier'
  /** Central Target Registry self-healing selector chain. */
  | 'ctr-selector'
  /** A node cached by an earlier `find()` / `discover()`, still connected. */
  | 'discovery-cache'
  /** Content-fingerprint match across every registered element. */
  | 'fingerprint'
  /** `semanticPath` CSS traversal — the weakest strategy in either chain. */
  | 'semantic-path';

/**
 * The stability *class* of a strategy — the coarse bucket a caller should
 * branch on. Four values, deliberately few: a caller deciding "should I
 * re-verify before acting?" wants a bucket, not a spectrum.
 *
 * - `exact` — the identity the caller cited was found directly. No inference.
 * - `strong` — resolved via a developer-authored, re-render-surviving anchor
 *   (a stamped attribute, a testid, a declared CTR chain).
 * - `moderate` — resolved by matching *content or history* rather than
 *   identity. Right in practice, but a second element with the same content
 *   would be equally acceptable to the matcher.
 * - `weak` — resolved by structural guesswork. Verify before acting on
 *   anything destructive.
 */
export type ResolutionStabilityClass = 'exact' | 'strong' | 'moderate' | 'weak';

/**
 * Ordinal rank per strategy. Higher is more stable. The absolute values carry
 * no meaning beyond their order — see the module doc.
 *
 * The ordering is the one the plan fixed: registry id > `data-ui-bridge-id` >
 * fingerprint > semantic path, with the executor's own strategies slotted in by
 * class rather than given a second ladder.
 */
export const ELEMENT_RESOLUTION_RANK: Readonly<Record<ElementResolutionStrategy, number>> = {
  'registry-id': 7,
  'page-sentinel': 6,
  'ui-bridge-id-attr': 5,
  'element-identifier': 4,
  'ctr-selector': 3,
  'discovery-cache': 2,
  fingerprint: 1,
  'semantic-path': 0,
};

/** Class per strategy. See {@link ResolutionStabilityClass} for what each means. */
export const ELEMENT_RESOLUTION_CLASS: Readonly<
  Record<ElementResolutionStrategy, ResolutionStabilityClass>
> = {
  'registry-id': 'exact',
  'page-sentinel': 'exact',
  'ui-bridge-id-attr': 'strong',
  'element-identifier': 'strong',
  'ctr-selector': 'strong',
  'discovery-cache': 'moderate',
  fingerprint: 'moderate',
  'semantic-path': 'weak',
};

/** One strategy scored — the unit both the winner and each alternate use. */
export interface ElementResolutionCandidate {
  /** Which strategy this candidate is. */
  strategy: ElementResolutionStrategy;
  /** Coarse bucket. Branch on this. */
  stabilityClass: ResolutionStabilityClass;
  /** Ordinal rank, higher = more stable. NOT a probability — see the module doc. */
  stabilityRank: number;
  /**
   * The element id this strategy resolved to. On the winner this equals the
   * resolved element's id; on an alternate it may differ from the winner's,
   * which is exactly the signal a caller falling down the list wants to see.
   */
  elementId: string;
}

/**
 * How an element id was resolved on this call.
 *
 * Follows the `effectVerification` precedent: **one optional nested object,
 * present only when a resolution actually happened**. It is never a parallel
 * channel and its fields are never flattened onto the response.
 */
export interface ElementResolution {
  /** The strategy that won. First hit in the chain, so this is the strongest available. */
  strategy: ElementResolutionStrategy;
  /** The winner's coarse bucket. */
  stabilityClass: ResolutionStabilityClass;
  /** The winner's ordinal rank. NOT a probability. */
  stabilityRank: number;
  /**
   * Every *other* strategy that would also have resolved something, ranked
   * strongest-first — so a caller whose action fails can fall down the list
   * instead of failing on one brittle match.
   *
   * **Opt-in, and a REQUEST parameter rather than a config setting.** Building
   * it means running the whole chain instead of stopping at the first hit,
   * which is `O(elements × candidates)` on the hottest payload in the SDK; and
   * a config toggle would make the same call return different shapes on
   * different machines. Absent unless the call asked for it — which is
   * distinguishable from "asked, and there were none": that returns `[]`.
   */
  alternates?: ElementResolutionCandidate[];
}

/**
 * Score a strategy into the full candidate shape. The one place the rank and
 * class tables are read, so a new strategy cannot be added to one and missed in
 * the other.
 */
export function scoreResolution(
  strategy: ElementResolutionStrategy,
  elementId: string
): ElementResolutionCandidate {
  return {
    strategy,
    stabilityClass: ELEMENT_RESOLUTION_CLASS[strategy],
    stabilityRank: ELEMENT_RESOLUTION_RANK[strategy],
    elementId,
  };
}

/**
 * Assemble the reported resolution from the winning strategy plus, when the
 * caller asked for them, the alternates.
 *
 * `alternates` are sorted strongest-first and the winner is excluded — it is
 * already the top-level fields, and repeating it would invite a consumer to
 * read `alternates[0]` as "the best option" when it is in fact "the best
 * *fallback*".
 */
export function buildElementResolution(
  winner: ElementResolutionCandidate,
  alternates?: ElementResolutionCandidate[]
): ElementResolution {
  const resolution: ElementResolution = {
    strategy: winner.strategy,
    stabilityClass: winner.stabilityClass,
    stabilityRank: winner.stabilityRank,
  };
  if (alternates) {
    resolution.alternates = alternates
      .filter((candidate) => candidate.strategy !== winner.strategy)
      .sort((a, b) => b.stabilityRank - a.stabilityRank);
  }
  return resolution;
}
