/**
 * The relay round trip that the component-action tests drive, kept in one place.
 *
 * `createRelayHandlers` (the server half of the relay) hands every command to
 * `CommandRelay.queueCommand`, which is where a real relay queues the command
 * for a browser tab. These helpers replace that one method. So a change to
 * `CommandRelay`'s dispatch API is made here once, not in every test file that
 * crosses the relay.
 */

import { executeCommand, type BridgeAccess } from '../commandHandlers';
import { createRelayHandlers } from '../../server/relay-handlers';
import { CommandRelay } from '../../server/command-relay';
import { COMPONENT_ACTION_REQUEST_FIELDS } from '../../server/component-action-invocation';

/** The wire is JSON. Whatever survives this round trip is what a caller sees. */
export function overTheWire<T>(value: T): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

const emptyBridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
};

/** The browser tab's answer to one command: the listener's `executeCommand`, as JSON. */
export async function listener(
  action: string,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  return overTheWire(await executeCommand(action, payload as never, emptyBridge));
}

/** Relay handlers whose dispatch boundary calls `dispatch` instead of queueing for a tab. */
export function relayDispatchingTo(
  dispatch: (action: string, payload: Record<string, unknown>) => Promise<unknown>
): ReturnType<typeof createRelayHandlers> {
  const relay = new CommandRelay({
    globalPrefix: `__uiBridgeRelayTest_${Math.random().toString(36).slice(2, 10)}`,
  });
  relay.queueCommand = dispatch as typeof relay.queueCommand;
  return createRelayHandlers(relay);
}

/**
 * Relay handlers whose dispatch boundary hands each command straight to the
 * listener's `executeCommand`, JSON round-tripped both ways, exactly as the
 * browser tab would receive and answer it.
 */
export function relayIntoListener(): ReturnType<typeof createRelayHandlers> {
  return relayDispatchingTo((action, payload) => listener(action, overTheWire(payload)));
}

/**
 * Run `run` as if `name` were a field of `ComponentActionRequest`.
 *
 * A real new field is added to the interface, and the compiler then refuses
 * `COMPONENT_ACTION_REQUEST_FIELDS` until the field is listed there too. Nothing
 * else is edited. This adds the field to the list for the duration of `run`, so
 * a test can show that every hop after the list carries the field without an
 * edit of its own.
 */
export async function asIfARequestField<T>(name: string, run: () => Promise<T>): Promise<T> {
  const fields = COMPONENT_ACTION_REQUEST_FIELDS as Record<string, true>;
  fields[name] = true;
  try {
    return await run();
  } finally {
    delete fields[name];
  }
}
