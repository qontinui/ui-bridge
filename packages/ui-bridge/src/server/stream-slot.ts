/**
 * A tab's SSE listener slot on one relay instance (plan
 * 2026-11-09-a-dead-relay-tab-stays-the-operators-primary-and-a-command-sent-during-a-stream-reopen-is-lost,
 * D2): open → dead → flushed or expired.
 *
 * When the relay hears a stream die mid-life (stream-lease.ts: `abort`,
 * `cancel`, `enqueue_failed`, `consumer_stalled`), it does not delete the
 * tab's listener at once. It marks the listener `dead` and keeps it for
 * `reconnectGraceMs`, as a {@link DeadSlot}:
 *
 * - a command dispatched to the tab is parked on the slot, never written;
 * - the tab's next stream registering flushes the parked commands down it;
 * - at grace expiry the slot is removed, and every parked command is rejected
 *   at once with the relay's not-delivered message ({@link notDeliveredMessage}),
 *   unless the tab now streams on another instance: then it goes over the bus.
 *
 * A stream the server closed at its lease is not parked: its tab is awaited
 * instead ({@link slotActionForEnd}).
 *
 * A dead slot is not a connected transport ({@link isOpenListener}), and it
 * gives up its cross-instance bus membership at death, not at expiry, so an
 * instance that holds the tab's newer stream is the one the fleet routes to.
 * Its presence stays only while a WebSocket client of the tab is connected
 * to the same instance, which still holds the tab through it.
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
  /**
   * The server closed the stream at its lease (`lease`, `rotate_unanswered`):
   * its listener goes, and the tab keeps its place for its return.
   */
  closedAtLease: (reason: StreamEndReason) => void;
  /**
   * The stream was sent its `rotate` frame. Its replacement may land on
   * another instance, so from now on it delivers a bus command only when no
   * other instance holds the tab; a newer stream for the tab closes it
   * whatever page it names.
   */
  rotated: () => void;
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
 * What an ended stream leaves of its tab's listener.
 *
 * - `park`: a death mid-life. The page may be reopening now, so the slot holds
 *   the tab's commands for its next stream.
 * - `await-return`: the server closed the stream at its lease, a legacy close
 *   or a rotate nobody answered. The listener goes at once, but the tab keeps
 *   its tombstone, standing and owner for `LEASE_RETURN_GRACE_MS`
 *   (stream-lease.ts), so its reopen returns the same tab. A command for it
 *   meanwhile is refused at once, never parked: a legacy client waits 10 s, so
 *   holding it could only delay its typed not-delivered answer.
 * - `remove`: a replaced stream, whose listener is the replacement's already.
 */
export function slotActionForEnd(reason: StreamEndReason): 'park' | 'await-return' | 'remove' {
  if (reason === 'replaced') return 'remove';
  if (reason === 'lease' || reason === 'rotate_unanswered') return 'await-return';
  return 'park';
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
