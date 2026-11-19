/**
 * The relay's fleet-wide command registry, as `CommandRelay` uses it (plan
 * 2026-11-08-ui-bridge-relay-client-drops-refused-results-and-heartbeats-silently,
 * D2).
 *
 * A tab's result POST can land on an instance that holds no pending command
 * for it: on a multi-instance deployment that is the normal cross-instance
 * case, and that instance forwards the result over the bus. It forwards only
 * a result SOME instance awaits. The dispatching instance registers every
 * command it delivers or publishes (`RelayBus.registerCommand`) and forgets it
 * on settle; an instance with nothing pending asks `isCommandKnown` first.
 * A registry that cannot be read does not cost a result: the result is
 * forwarded as before, and the line {@link RESULT_FORWARD_UNVERIFIED} names it.
 */
import type { RelayBus } from './relay-bus';

/**
 * What became of a result the browser posted:
 * - `settled` — this instance held the command and took the result;
 * - `forwarded` — published on the bus for the instance that awaits it;
 * - `unknown` — no instance awaits the command (the HTTP layer answers 404
 *   `COMMAND_UNKNOWN`), so nothing was published;
 * - `refused` — the responder may not settle the command (wrong tab, stream
 *   or owner); nothing was published.
 */
export type CommandResultOutcome = 'settled' | 'forwarded' | 'unknown' | 'refused';

/** The log token for a result forwarded although the registry could not be read. */
export const RESULT_FORWARD_UNVERIFIED = 'result_forward_unverified';

/** How long the registry holds a command: its timeout plus the grace window, in whole seconds. */
export function commandRegistryTtlSeconds(timeoutMs: number, graceMs: number): number {
  return Math.max(1, Math.ceil((timeoutMs + graceMs) / 1000));
}

/**
 * Should a result this instance holds no pending command for be published?
 * `true` when some instance awaits the command, `false` when none does, and
 * `true` (logged) when the registry read failed or threw.
 */
export async function someInstanceAwaits(bus: RelayBus, commandId: string): Promise<boolean> {
  let known: boolean | null;
  try {
    known = await bus.isCommandKnown(commandId);
  } catch {
    known = null;
  }
  if (known === null) {
    console.warn(
      `[ui-bridge] ${RESULT_FORWARD_UNVERIFIED} commandId=${commandId}: ` +
        'the command registry could not be read; forwarding the result over the bus'
    );
    return true;
  }
  return known;
}

/** Run a fire-and-forget registry write; a bus that throws is logged, never propagated. */
export function registryWrite(what: string, write: () => void): void {
  try {
    write();
  } catch (err) {
    console.error(`[ui-bridge] ${what} in the command registry failed:`, err);
  }
}
