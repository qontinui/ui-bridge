/**
 * Did a relayed command get a LIVE answer? The typed errors the relay rejects
 * with, and the one classifier that reads them.
 *
 * A rejection from `CommandRelay.queueCommand` is one of two things:
 *
 *   - **A tab answered with a failure** ({@link TabReportedFailure}). The
 *     in-page relay client posts the dispatcher's `{ success: false, … }` back
 *     as `success: false`; the adapter settles it with `rejectCommand(…,
 *     result)` (`./nextjs.ts`), and across instances the bus carries `result`
 *     on `ok: false` (`./command-relay.ts`, `dispatchViaBus`). The tab's own
 *     verdict (its typed code, its `failureDetails`) rides along as `result`.
 *   - **No tab answered at all** ({@link NoLiveAnswer}), raised by the relay
 *     itself: nothing could carry the command (`not_delivered`), or it was
 *     delivered and nobody answered in time (`unanswered`, whose effect is
 *     unknown).
 *
 * The classifier reads the TYPE, never the message, so a reworded message
 * cannot move a live failure into the cache arm. Each relay-raised message is
 * kept byte for byte, so a reader matching `SDK_DISCONNECTED` keeps working.
 *
 * Anything untyped (a routing refusal, an `OwnerMismatchError`, a destroyed
 * relay, an unforeseen error) classifies as a live answer. That fails closed:
 * it is answered as a failure, never from a cache.
 *
 * Types are recognised by `name` as well as by `instanceof`, like
 * `RelayDestroyedError`, so an error from a second copy of this module (a
 * duplicated bundle) still matches.
 */

/** Why the relay got no live answer: nothing carried it, or nobody answered. */
export type NoLiveAnswerReason = 'not_delivered' | 'unanswered';

/** The human cause each {@link NoLiveAnswerReason} names by default. */
const DEFAULT_NO_ANSWER_CAUSE: Record<NoLiveAnswerReason, string> = {
  not_delivered: 'no browser tab is connected to receive it',
  unanswered: 'no tab answered it in time',
};

/**
 * A tab ran the command and reported a failure. `result` is what the tab
 * posted (the dispatcher's `{ success: false, … }` envelope), when it posted
 * one; `tabId` is the tab that answered, when it named itself.
 */
export class TabReportedFailure extends Error {
  readonly code = 'TAB_REPORTED_FAILURE' as const;
  readonly result: unknown;
  readonly tabId: string | undefined;

  constructor(message: string, result?: unknown, tabId?: string) {
    super(message);
    this.name = 'TabReportedFailure';
    this.result = result;
    this.tabId = tabId;
  }
}

/**
 * The relay got no live answer: `not_delivered` (nothing could carry the
 * command, so nothing ran) or `unanswered` (delivered, and no tab answered in
 * time: its effect is unknown). `noAnswerCause` is the human cause a cache
 * answer names (`cacheFallbackMeta`).
 */
export class NoLiveAnswer extends Error {
  readonly code = 'NO_LIVE_ANSWER' as const;
  readonly reason: NoLiveAnswerReason;
  readonly noAnswerCause: string;

  constructor(message: string, reason: NoLiveAnswerReason, noAnswerCause?: string) {
    super(message);
    this.name = 'NoLiveAnswer';
    this.reason = reason;
    this.noAnswerCause = noAnswerCause ?? DEFAULT_NO_ANSWER_CAUSE[reason];
  }
}

/** Is `e` a {@link TabReportedFailure} (from this module or a copy of it)? */
export function isTabReportedFailure(e: unknown): e is TabReportedFailure {
  if (e instanceof TabReportedFailure) return true;
  const named = e as { name?: unknown; code?: unknown } | null;
  return (
    e instanceof Error &&
    named?.name === 'TabReportedFailure' &&
    named.code === 'TAB_REPORTED_FAILURE'
  );
}

/** Is `e` a {@link NoLiveAnswer} (from this module or a copy of it)? */
export function isNoLiveAnswer(e: unknown): e is NoLiveAnswer {
  if (e instanceof NoLiveAnswer) return true;
  const named = e as { name?: unknown; code?: unknown; noAnswerCause?: unknown } | null;
  return (
    e instanceof Error &&
    named?.name === 'NoLiveAnswer' &&
    named.code === 'NO_LIVE_ANSWER' &&
    typeof named.noAnswerCause === 'string'
  );
}

/**
 * Why a relayed `action` got NO live answer, or `undefined` when a tab did
 * answer it.
 *
 *   - a {@link NoLiveAnswer}: its cause (no connected tab, a timeout, …);
 *   - a {@link TabReportedFailure}: a live answer, except the dispatcher's own
 *     `Unknown command action: <action>` for THIS action, which the in-page
 *     dispatcher's `default:` arm throws and which proves the tab has no case
 *     for it (another action's no-case is that tab's failure, not this one's);
 *   - anything else: a live answer (fails closed).
 */
export function noLiveAnswerCause(action: string, e: unknown): string | undefined {
  if (isNoLiveAnswer(e)) return e.noAnswerCause;
  if (isTabReportedFailure(e)) {
    const noCase = `Unknown command action: ${action}`;
    if (e.message.startsWith(noCase) && !/^[\w$]/.test(e.message.slice(noCase.length))) {
      return `the tab's UI Bridge SDK has no ${action} case`;
    }
  }
  return undefined;
}

/**
 * The `_meta` of an answer a relay read took from a cache because there was
 * no live answer (`noLiveAnswerCause`): the `{ fallback, reason }` marker
 * `relayWithFallback` puts on its default, with the cause named.
 * `answeredFrom` names the cache; its default is the cached snapshot.
 */
export function cacheFallbackMeta(
  action: string,
  cause: string,
  answeredFrom = 'the cached snapshot'
): { fallback: true; reason: string } {
  return {
    fallback: true,
    reason: `Relay command '${action}' got no live answer (${cause}) — answered from ${answeredFrom}, which can be stale or another tab's.`,
  };
}
