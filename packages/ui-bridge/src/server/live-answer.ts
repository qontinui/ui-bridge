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
 * cannot move a live failure into the cache arm. The not-delivered messages
 * are kept byte for byte, so a reader matching `SDK_DISCONNECTED` keeps
 * working; the `unanswered` timeout says what was observed, that no result
 * arrived ({@link noResultArrivedMessage}).
 *
 * Anything untyped (a routing refusal, an `OwnerMismatchError`, a destroyed
 * relay, an unforeseen error) classifies as a live answer. That fails closed:
 * it is answered as a failure, never from a cache.
 *
 * Types are recognised by `name` as well as by `instanceof`, like
 * `RelayDestroyedError`, so an error from a second copy of this module (a
 * duplicated bundle) still matches.
 */

import { RELAY_READ_ACTIONS } from './relay-read-actions';

/**
 * The `noAnswerCause` of a command evicted from a full pending queue. It is
 * `unanswered` (it may have been delivered) but no timer ran out, so the
 * HTTP layer tells it apart from a timeout by this cause.
 */
export const EVICTED_NO_ANSWER_CAUSE =
  'it was evicted from the pending queue under load before a tab answered';

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
 * answer names (`cacheFallbackMeta`). `noTransport` marks the
 * `SDK_DISCONNECTED` refusal: nothing was delivered because the relay had no
 * transport at all, the one state a wait for a reconnection can change
 * (`CommandRelay.queueCommand`'s retry reads it, never the message).
 * `evicted` marks a command the relay evicted from its full pending queue
 * under load: re-sending it would add load to that queue, so `mayFailOver`
 * never fails it over.
 */
export class NoLiveAnswer extends Error {
  readonly code = 'NO_LIVE_ANSWER' as const;
  readonly reason: NoLiveAnswerReason;
  readonly noAnswerCause: string;
  readonly noTransport: boolean;
  readonly evicted: boolean;

  constructor(
    message: string,
    reason: NoLiveAnswerReason,
    noAnswerCause?: string,
    options?: { noTransport?: boolean; evicted?: boolean }
  ) {
    super(message);
    this.name = 'NoLiveAnswer';
    this.reason = reason;
    this.noAnswerCause = noAnswerCause ?? DEFAULT_NO_ANSWER_CAUSE[reason];
    this.noTransport = options?.noTransport === true;
    this.evicted = options?.evicted === true;
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
 * May the relay re-send `action` to ANOTHER tab after its first tab failed
 * with `e`? Only when that tab provably did not run it, or, for a declared
 * read (`RELAY_READ_ACTIONS`), did not answer in time (plan
 * 2026-11-08-ui-bridge-relay-and-exec-mode-follow-ups-from-pr-329, D3):
 *
 *   - `NoLiveAnswer('not_delivered')`: nothing carried the command, so
 *     nothing ran;
 *   - the no-case {@link TabReportedFailure} for THIS action (the
 *     dispatcher's `Unknown command action: <action>`): the tab has no case
 *     for it, so it ran nothing;
 *   - `NoLiveAnswer('unanswered')` for an action in `RELAY_READ_ACTIONS`: the
 *     tab may have run it, which a read makes harmless. Except a command the
 *     relay evicted from its full pending queue (`evicted`): re-sending it
 *     adds load to the queue that just overflowed.
 *
 * False for everything else: any other failure a tab reported is that tab's
 * live answer, which a second tab must not overrule; a write that timed out
 * may have run; and anything untyped fails closed.
 */
export function mayFailOver(action: string, e: unknown): boolean {
  if (isNoLiveAnswer(e)) {
    if (e.evicted === true) return false;
    if (e.reason === 'not_delivered') return true;
    return e.reason === 'unanswered' && RELAY_READ_ACTIONS.has(action);
  }
  if (isTabReportedFailure(e)) return noLiveAnswerCause(action, e) !== undefined;
  return false;
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

/**
 * The message a relayed command's `unanswered` timeout carries (plan
 * 2026-11-08-ui-bridge-relay-client-drops-refused-results-and-heartbeats-silently,
 * D6). What the relay observed is that no result reached THIS instance — not
 * that the page is unresponsive: a tab may have run the command and had its
 * result refused, lost, or posted to another instance. `tabsSent` is how many
 * tabs this instance wrote the command to; omitted when it cannot know (a
 * command published on the bus for another instance to deliver).
 */
export function noResultArrivedMessage(
  action: string,
  timeoutMs: number,
  transport: string,
  tabsSent?: number
): string {
  const sent =
    tabsSent === undefined
      ? 'The command was published on the bus, so how many tab(s) were sent it is not known ' +
        'here; any that were may have run it'
      : `${tabsSent} tab(s) were sent the command and may have run it`;
  return (
    `Command ${action} timed out after ${timeoutMs}ms (${transport}): ` +
    `no result reached this relay instance. ${sent}; its result may have been refused ` +
    '(for example 429), lost, or posted to another instance.'
  );
}
