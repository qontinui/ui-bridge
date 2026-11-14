/**
 * A tab's SSE listener slot on one relay instance (plan
 * 2026-11-09-a-dead-relay-tab-stays-the-operators-primary-and-a-command-sent-during-a-stream-reopen-is-lost,
 * D2): open → dead → flushed or expired.
 *
 * When the relay hears a stream end (stream-lease.ts: `abort`, `cancel`,
 * `enqueue_failed`, `consumer_stalled`, `rotate_unanswered`), it does not
 * delete the tab's listener at once. It marks the listener `dead` and keeps it
 * for `reconnectGraceMs`, as a {@link DeadSlot}:
 *
 * - a command dispatched to the tab is parked on the slot, never written;
 * - the tab's next stream registering flushes the parked commands down it;
 * - at grace expiry the slot is removed, and every parked command is rejected
 *   at once with the relay's not-delivered message ({@link notDeliveredMessage}).
 *
 * A dead slot is not a connected transport ({@link isOpenListener}), and it
 * gives up its cross-instance bus membership at death, not at expiry, so an
 * instance that holds the tab's newer stream is the one the fleet routes to.
 * `CommandRelay` (command-relay.ts) runs the transitions; this module holds
 * what they share.
 */

import type { QueuedCommand } from './command-relay';
import type { StreamEndReason } from './stream-lease';

/** Whether a listener's stream can still be written: `dead` once the relay heard it end. */
export type ListenerState = 'open' | 'dead';

/** What the stream behind a listener declares about itself (stream-lease.ts). */
export interface CommandStreamOptions {
  /** Ends the stream from the relay's side; called when a newer stream for its tab replaces it. */
  close?: () => void;
  /** The page instance that opened the stream (the client's `cid`). */
  clientInstanceId?: string;
  /** The capabilities the client declared (`caps`). */
  caps?: readonly string[];
}

/** A command stream the relay opened (`CommandRelay.openCommandStream`). */
export interface CommandStreamHandle {
  streamId: string;
  /** Forget the stream's listener now: a lease close, a replacement, an unsubscribe. */
  unsubscribe: () => void;
  /**
   * The stream ended for `reason` and the relay heard it: its listener becomes
   * a dead slot holding the tab's commands for its next stream.
   */
  park: (reason: StreamEndReason) => void;
}

/**
 * THE predicate for "this listener is a connected command transport". Every
 * reader of the relay's listeners that answers "connected" asks it; only
 * dispatch, which parks on a dead slot, sees past it.
 */
export function isOpenListener(listener: { readonly state: ListenerState }): boolean {
  return listener.state !== 'dead';
}

/**
 * What an ended stream leaves of its tab's listener. A known death parks the
 * slot for the tab's next stream. A legacy-lease close removes it at once: a
 * legacy client waits 10 s before reopening, longer than the grace, so a parked
 * slot could only delay its typed not-delivered answer. A replaced stream's
 * listener is already the replacement's.
 */
export function slotActionForEnd(reason: StreamEndReason): 'park' | 'remove' {
  return reason === 'lease' || reason === 'replaced' ? 'remove' : 'park';
}

/** A command dispatched to a dead slot, held for the tab's next stream. */
export interface ParkedCommand {
  command: QueuedCommand;
  /** Resolved on delivery rather than on the page's answer (`pageNavigate`, `pageRefresh`). */
  fireAndForget: boolean;
  /** The caller the command was dispatched for, when scoped. */
  senderUserId?: string;
}

/** A dead listener's held commands, and the timer that expires it. */
export class DeadSlot {
  private readonly parked: ParkedCommand[] = [];

  constructor(
    /** How the stream ended. */
    readonly reason: StreamEndReason,
    /** Fires at grace expiry; disarmed when a new stream flushes the slot. */
    readonly expiry: ReturnType<typeof setTimeout>
  ) {}

  /** Hold `command` for the tab's next stream. */
  park(command: ParkedCommand): void {
    this.parked.push(command);
  }

  /** Every held command, oldest first, leaving none: for a flush or an expiry. */
  drain(): ParkedCommand[] {
    return this.parked.splice(0);
  }
}

/**
 * The relay's not-delivered message, `why` naming the cause. Its prefix is the
 * one `noLiveAnswerCause` (relay-handlers.ts) classifies as no live answer, so
 * a caller may fail over and re-send it, writes included: nothing was written.
 */
export function notDeliveredMessage(action: string, why: string): string {
  return (
    `No active UI Bridge SDK client received the ${action} command. ${why} ` +
    'Ensure the web app is open in a browser tab with the UI Bridge SDK loaded.'
  );
}
