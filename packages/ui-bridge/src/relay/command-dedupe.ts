/**
 * The relay client's memory of the commands it has executed, and, briefly, of
 * what each execution produced.
 *
 * A relay that a stream declared `dedupe` to may deliver one command to the
 * same page twice: once down a stream that is rotating, and again as a
 * redelivered alias (`redeliveryOf: <original id>`) down that stream's
 * replacement. The page must run it once, because a write run twice is a
 * destructive surprise. So the client keys every delivery on
 * {@link dedupeKeyOf} and runs a key only the first time it sees it.
 *
 * A later delivery is answered, under its own command id and on its own
 * stream, with the outcome of that one run, for as long as the outcome is
 * kept: {@link DEDUPE_RESULT_RETENTION_MS} after the run settles (a delivery
 * that arrives while the run is going is answered when it settles). A relay
 * redelivers because it may not have the first answer: the first result POST
 * can be lost, and the client does not retry it. Its redelivery comes within
 * its reconnect grace plus its answer timeout, well inside that window. After
 * it the outcome is released, because a result can be large, and a later
 * delivery is neither run nor answered.
 *
 * The keys are bounded separately: the last {@link MAX_KEYS} and nothing older
 * than {@link KEY_TTL_MS}, whichever bound is reached first. A key keeps
 * blocking a re-run after its outcome is released. The memory lives only as
 * long as the page instance, and a reloaded page has forgotten every key. That
 * is why the relay redelivers only to a stream that presents the same instance
 * id (`cid`) as the stream it replaces.
 */

/** The most commands one relay client remembers. */
const MAX_KEYS = 512;

/** How long a relay client remembers a command, from its first delivery. */
const KEY_TTL_MS = 10 * 60_000;

/** How long a run's outcome is kept, after the run settles, to answer a redelivery with. */
const DEDUPE_RESULT_RETENTION_MS = 60_000;

/** The fields of a delivered command that its dedupe key is read from. */
export interface DedupeKeyed {
  commandId: string;
  redeliveryOf?: unknown;
}

/**
 * The key one execution is deduped on: the ORIGINAL command's id. A
 * redelivered alias names its original in `redeliveryOf`. Any other command is
 * its own original.
 */
export function dedupeKeyOf(command: DedupeKeyed): string {
  const original = command.redeliveryOf;
  return typeof original === 'string' && original.length > 0 ? original : command.commandId;
}

/** A bounded memory of the commands one page instance has run, and their outcomes. */
export interface CommandDedupe<T> {
  /**
   * The outcome to answer a delivery of `key` with. Only the first delivery
   * of a key inside the window calls `run`. A later one gets the same promise
   * while the outcome is kept, and `null` once it has been released: that
   * delivery is neither run nor answered.
   */
  outcomeOf(key: string, run: () => Promise<T>): Promise<T> | null;
  /** Release every kept outcome now; each key still blocks a re-run. */
  releaseOutcomes(): void;
}

interface Remembered<T> {
  readonly firstSeenAt: number;
  /** The run's outcome while it is kept, and null once it is released. */
  outcome: Promise<T> | null;
  /** The timer that releases `outcome`, once the run has settled. */
  release?: ReturnType<typeof setTimeout>;
}

/** A fresh, empty command memory for one `startRelayClient` run. */
export function createCommandDedupe<T>(): CommandDedupe<T> {
  // Map iteration is insertion order, and a key is inserted once, at its
  // first delivery, so the first entry is always the oldest.
  const remembered = new Map<string, Remembered<T>>();

  const releaseOutcome = (entry: Remembered<T>) => {
    if (entry.release !== undefined) clearTimeout(entry.release);
    entry.release = undefined;
    entry.outcome = null;
  };

  const forget = (key: string, entry: Remembered<T>) => {
    releaseOutcome(entry);
    remembered.delete(key);
  };

  return {
    outcomeOf(key, run) {
      const now = Date.now();
      for (const [seenKey, entry] of remembered) {
        if (now - entry.firstSeenAt < KEY_TTL_MS) break;
        forget(seenKey, entry);
      }
      const seen = remembered.get(key);
      if (seen) return seen.outcome;

      const outcome = run();
      const entry: Remembered<T> = { firstSeenAt: now, outcome };
      remembered.set(key, entry);
      // Kept from the moment the run settles, unless it was released or
      // forgotten while the run was still going.
      const keepFromNow = () => {
        if (entry.outcome === null || remembered.get(key) !== entry) return;
        entry.release = setTimeout(() => releaseOutcome(entry), DEDUPE_RESULT_RETENTION_MS);
      };
      outcome.then(keepFromNow, keepFromNow);

      if (remembered.size > MAX_KEYS) {
        const oldest = remembered.entries().next().value;
        if (oldest) forget(oldest[0], oldest[1]);
      }
      return outcome;
    },

    releaseOutcomes() {
      for (const entry of remembered.values()) releaseOutcome(entry);
    },
  };
}
