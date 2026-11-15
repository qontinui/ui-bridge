/**
 * The relay client's command-stream lifecycle: the current stream, the stream
 * a rotation is draining, the rotation scheduler, and the reopen floors.
 *
 * Split out of `relay-client.ts` with no change of behaviour. The wire
 * contract and the lifecycle rules are documented at the top of that file;
 * this module owns their implementation. It knows nothing of heartbeats,
 * result POSTs or command execution: those reach it as the callbacks in
 * {@link StreamLifecycleDeps}.
 */

// SSE reconnection delay after a FAST failure: a refused open, or a stream
// that ended before it was healthy (10s to avoid Next.js route recompilation
// cascades, which fail fast).
const SSE_RECONNECT_DELAY_MS = 10_000;

/**
 * How long a command stream must have lived after its `connected` event to
 * count as healthy. A healthy stream that ends is reopened at once (plus up to
 * `HEALTHY_REOPEN_JITTER_MS`), because a command sent into a 10s gap outlives
 * the relay's answer timeout.
 *
 * It is also the floor between the streams the client opens on its own. A
 * reopen after a stream ends, and the replacement a `rotate` frame asks for,
 * each come at least this long after the previous open, and a rotation also
 * waits until the stream it replaces has been connected this long (a `rotate`
 * frame that arrives before `connected` waits for it). So those opens are
 * capped at 6 per tab per minute, the cadence the relay's stream lane is
 * sized for, whatever the relay does. Two opens are not floored: a call to
 * `forceReconnect` (the heartbeat's `tabRegistered: false` recovery makes
 * one) and a tab coming back into view with no stream open.
 *
 * A numeric literal on purpose, so qontinui-web's bundledNumber can read it
 * out of the bundle (Phase 7 adds that read).
 */
export const HEALTHY_STREAM_MIN_MS = 10_000;

// The most a healthy reopen is delayed by, chosen at random per reopen, so the
// tabs whose streams one relay instance ends together do not reopen together.
const HEALTHY_REOPEN_JITTER_MS = 250;

// How long a replaced stream may still be read when its `rotate` frame names
// no grace. Like a named grace, it is counted from the frame's arrival, so the
// time spent waiting to rotate is part of it. Once it has run out and the
// stream's replacement has connected, the stream is aborted, so a relay that
// never ends it cannot keep it open past that. Until the replacement connects
// (or fails, which hands the tab back), the stream is held, however long ago
// the grace ran out.
const DRAINING_STREAM_DEADLINE_MS = 15_000;

// The longest grace a `rotate` frame can buy the stream it replaces; a longer
// one is held to this.
const MAX_DRAINING_GRACE_MS = 60_000;

// What every command stream declares: it follows a `rotate` frame, and it
// dedupes a redelivered command.
export const STREAM_CAPABILITIES = 'rotate,dedupe';

/**
 * Parse the `data:` payload out of a single SSE event block — the text
 * between `\n\n` delimiters. Returns the concatenated data string, or `null`
 * for blocks with no data field (e.g. `: heartbeat` keep-alive comments).
 * Mirrors the WhatWG SSE semantics for the fields the command stream uses:
 * `data:` lines are kept (one optional leading space stripped); `:` comment
 * lines and `event:`/`id:`/`retry:` lines are ignored.
 */
export function parseSSEDataBlock(block: string): string | null {
  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) continue;
    if (!line.startsWith('data:')) continue;
    let value = line.slice(5);
    if (value.startsWith(' ')) value = value.slice(1);
    dataLines.push(value);
  }
  return dataLines.length > 0 ? dataLines.join('\n') : null;
}

/** A parsed `data:` payload off the command stream: a control frame or a command. */
type StreamFrame = {
  type?: unknown;
  streamId?: unknown;
  graceMs?: unknown;
} & Partial<QueuedCommand>;

/**
 * Read an SSE body to its end, handing each event block's parsed `data:`
 * payload to `onFrame`. Stops early, releasing the body, when `onFrame`
 * returns `'end'`: the relay's own end frame is a normal EOF. A block that
 * does not parse, or whose handler throws, is reported and skipped. Rejects
 * when the read itself fails (an abort, a network drop).
 */
async function readSSEFrames(
  body: ReadableStream<Uint8Array>,
  onFrame: (frame: StreamFrame) => 'end' | void,
  onError: (message: string, error?: unknown) => void
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const data = parseSSEDataBlock(block);
      if (data == null) continue;
      let verdict: 'end' | void;
      try {
        verdict = onFrame(JSON.parse(data));
      } catch (e) {
        onError('[UIBridge] Failed to parse SSE message:', e);
        continue;
      }
      if (verdict === 'end') {
        reader.cancel().catch(() => {});
        return;
      }
    }
  }
}

/** Command frame as delivered over the SSE stream. */
export interface QueuedCommand {
  commandId: string;
  action: string;
  payload: unknown;
  timestamp?: number;
  /** On a relay's redelivered alias: the id of the command it re-sends. */
  redeliveryOf?: string;
}

/** One command stream a client opened, and what it has learned about itself. */
export interface CommandStream {
  readonly controller: AbortController;
  /** Whether a `rotate` frame opened it, to replace the stream now draining. */
  readonly replacing: boolean;
  /** Its id, from its own `connected` event. */
  id?: string;
  /** When its `connected` event arrived. */
  connectedAt?: number;
  /**
   * Its relay's request to replace it: when the `rotate` frame arrived, and
   * the grace it named. Set from that frame on: while the rotation waits,
   * and still while the stream drains after its replacement opens. Cleared
   * only when a failed replacement hands the stream back. While it is set and
   * the stream is current, an end of this stream is its relay's own close,
   * not a failure.
   */
  rotation?: { requestedAt: number; graceMs: number };
}

/**
 * How long a stream a `rotate` frame replaces may still be read, counted from
 * the frame: the `graceMs` it names (at most `MAX_DRAINING_GRACE_MS`), or
 * `DRAINING_STREAM_DEADLINE_MS` when it names none usable.
 */
function drainingGraceMs(graceMs: unknown): number {
  if (typeof graceMs !== 'number' || !Number.isFinite(graceMs) || graceMs < 0) {
    return DRAINING_STREAM_DEADLINE_MS;
  }
  return Math.min(graceMs, MAX_DRAINING_GRACE_MS);
}

/** What the stream lifecycle needs from the client that owns it. */
export interface StreamLifecycleDeps {
  /** The full stream GET url (base path, tab id, caps, client instance id). */
  streamUrl: string;
  /** Extra request headers on the stream GET (the loopback tab key). */
  tabKeyHeader: Record<string, string>;
  /** The current bearer token, or null: read fresh at every open. */
  resolveToken: () => string | null;
  onError: (message: string, error?: unknown) => void;
  /** Whether the client has been stopped. */
  isStopped: () => boolean;
  /** Whether this is an opaque-origin document, which opens no stream. */
  isOpaqueOrigin: () => boolean;
  /** A command frame was read off the stream with this id. */
  onCommand: (command: QueuedCommand, fromStream: string | undefined) => void;
  /** A `ping` frame arrived. */
  onPing: () => void;
}

export interface StreamLifecycle {
  /** Open a command stream and make it current. `'rotate'` keeps the old one draining. */
  connect: (mode: 'replace' | 'rotate') => CommandStream | null;
  /** Abort every open stream: the current one and a replaced one still read. */
  closeStreams: () => void;
  /** Cancel a scheduled reconnect. */
  cancelReconnect: () => void;
  /** Whether a current stream exists. */
  hasCurrent: () => boolean;
  /** The id of the current stream, from its own `connected` event. */
  currentStreamId: () => string | undefined;
}

export function createStreamLifecycle(deps: StreamLifecycleDeps): StreamLifecycle {
  const { streamUrl, tabKeyHeader, resolveToken, onError, isStopped, isOpaqueOrigin } = deps;
  // The newest stream: the one a rotation or a reconnect replaces, and whose
  // id the handle reports. A command's result never reads it: each result
  // carries the id of the stream its command arrived on, so the relay can hold
  // the result to that stream.
  let current: CommandStream | null = null;
  // The stream a rotation replaced, still read to its EOF; the stream that
  // replaced it; whether its grace has run out; and the timer that records
  // that and aborts it then, if its relay never ends it and its replacement
  // has connected. There is at most one. While the replacement neither
  // connects nor fails, the hold is bounded by the relay (which ends a
  // stream it replaced) and the platform, not by this client.
  let draining: {
    stream: CommandStream;
    replacement: CommandStream;
    graceSpent: boolean;
    deadline: ReturnType<typeof setTimeout>;
  } | null = null;
  // A rotation the relay asked for before the current stream was healthy,
  // waiting until it is.
  let pendingRotation: ReturnType<typeof setTimeout> | null = null;
  // When the newest stream was opened: the floor every scheduled open waits on.
  let lastOpenAt: number | undefined;
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  const cancelReconnect = () => {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
  };

  const cancelPendingRotation = () => {
    if (pendingRotation) {
      clearTimeout(pendingRotation);
      pendingRotation = null;
    }
  };

  /** Stop reading the stream a rotation replaced, if one is still open. */
  const endDraining = () => {
    if (!draining) return;
    clearTimeout(draining.deadline);
    draining.stream.controller.abort();
    draining = null;
  };

  /** Abort every open stream: the current one and a replaced one still read. */
  const closeStreams = () => {
    cancelPendingRotation();
    endDraining();
    current?.controller.abort();
    current = null;
  };

  /** How long until the next scheduled open: HEALTHY_STREAM_MIN_MS after the last one. */
  const untilOpenFloor = () =>
    lastOpenAt === undefined ? 0 : Math.max(0, lastOpenAt + HEALTHY_STREAM_MIN_MS - Date.now());

  const scheduleReconnect = (delayMs: number) => {
    if (isStopped()) return;
    if (reconnectTimeout) return; // already scheduled
    reconnectTimeout = setTimeout(
      () => {
        reconnectTimeout = null;
        if (!isStopped()) connect('replace');
      },
      Math.max(delayMs, untilOpenFloor())
    );
  };

  /**
   * Open the replacement `stream`'s relay asked for (`stream.rotation`), make-
   * before-break. `stream` then drains: it is read to its EOF, or aborted once
   * its replacement has connected and the grace its relay named, counted from
   * the `rotate` frame, has run out. A stream still draining from an earlier
   * rotation is aborted first, so a relay that rotates without ending streams
   * holds at most two open.
   */
  const replace = (stream: CommandStream) => {
    const rotation = stream.rotation;
    if (isStopped() || current !== stream || !rotation) return;
    endDraining();
    const replacement = connect('rotate');
    if (!replacement) return;
    // The deadline records that the grace is spent; that record, not the
    // clock, is what the replacement's `connected` reads. Make-before-break
    // even when the grace is already spent: the stream is held until its
    // replacement connects (whose `connected` then ends it) or fails (which
    // hands the tab back to it).
    const deadline = setTimeout(
      () => {
        if (draining?.stream !== stream) return;
        draining.graceSpent = true;
        if (replacement.connectedAt !== undefined) endDraining();
      },
      Math.max(0, rotation.requestedAt + rotation.graceMs - Date.now())
    );
    draining = { stream, replacement, graceSpent: false, deadline };
  };

  /**
   * Schedule the replacement the current `stream`'s relay asked for. It waits
   * until `stream` has been connected HEALTHY_STREAM_MIN_MS, and until that
   * long after the last open. A request that came before `stream`'s
   * `connected` waits for it: the `connected` branch calls this again.
   */
  const scheduleRotation = (stream: CommandStream) => {
    if (pendingRotation || !stream.rotation || stream.connectedAt === undefined) return;
    const wait = Math.max(
      untilOpenFloor(),
      stream.connectedAt + HEALTHY_STREAM_MIN_MS - Date.now()
    );
    if (wait > 0) {
      pendingRotation = setTimeout(() => {
        pendingRotation = null;
        replace(stream);
      }, wait);
    } else {
      replace(stream);
    }
  };

  /**
   * Open a command stream and make it the current one, returning it (null
   * when none is opened). `'rotate'` leaves the current stream open (it is
   * draining by then); `'replace'` aborts it.
   */
  const connect = (mode: 'replace' | 'rotate'): CommandStream | null => {
    if (isStopped()) return null;
    // An opaque-origin document is refused by the runner and is about to be
    // replaced by the navigation; the real document starts its own client.
    if (isOpaqueOrigin()) return null;
    cancelReconnect();
    cancelPendingRotation();
    if (mode === 'replace') current?.controller.abort();
    // This stream's own id and age. A command read off it is answered with
    // `stream.id`, whichever stream is current by then.
    const stream: CommandStream = {
      controller: new AbortController(),
      replacing: mode === 'rotate',
    };
    current = stream;
    lastOpenAt = Date.now();

    const onFrame = (frame: StreamFrame): 'end' | void => {
      if (frame.type === 'connected') {
        stream.id = typeof frame.streamId === 'string' ? frame.streamId : undefined;
        stream.connectedAt = Date.now();
        // The stream this one replaced was held for it; if its deadline has
        // recorded the grace as spent, it goes now.
        if (draining?.replacement === stream && draining.graceSpent) endDraining();
        // A rotation its relay asked for before this, counted from now.
        if (current === stream) scheduleRotation(stream);
        return;
      }
      // Throttle-immune heartbeat clock: arriving bytes are not subject to the
      // background-tab timer clamp, so a hidden tab stays registered on the
      // strength of these alone.
      if (frame.type === 'ping') {
        deps.onPing();
        return;
      }
      // The relay is about to end this stream: open its replacement and keep
      // reading this one. Only the current stream rotates, once per request,
      // so a frame on a stream already replaced, or a repeat, opens nothing.
      if (frame.type === 'rotate') {
        if (current === stream && !stream.rotation) {
          stream.rotation = { requestedAt: Date.now(), graceMs: drainingGraceMs(frame.graceMs) };
          scheduleRotation(stream);
        }
        return;
      }
      // The relay's own close, sent just before it ends the stream: an EOF.
      if (frame.type === 'end') return 'end';
      if (frame.commandId && frame.action) {
        deps.onCommand(frame as QueuedCommand, stream.id);
      }
    };

    // However the stream ended: EOF, an end frame, a refused open, a dropped
    // connection, or an abort.
    const onEnded = () => {
      // A replaced stream ending completes its rotation: its replacement is
      // already open, so nothing reconnects.
      if (draining?.stream === stream) {
        clearTimeout(draining.deadline);
        draining = null;
        return;
      }
      if (current !== stream) return;
      current = null;
      cancelPendingRotation();
      if (isStopped() || stream.controller.signal.aborted) return;
      // A replacement that failed before its relay announced it hands the tab
      // back to the stream it was replacing, which that relay still holds.
      // The `draining?.replacement === stream` test is defensive: a replacing
      // stream is opened only by `replace()`, which records it as the
      // replacement of the one draining stream at once, and while it is
      // current and unconnected nothing else can replace that record (a
      // rotation of it waits for its `connected`; every other open aborts it
      // first). So `draining`, when set here, is always its own; the test
      // keeps the hand-back to the stream it replaced if that ever changes.
      if (
        stream.replacing &&
        stream.connectedAt === undefined &&
        draining?.replacement === stream
      ) {
        current = draining.stream;
        current.rotation = undefined;
        clearTimeout(draining.deadline);
        draining = null;
        return;
      }
      const healthy =
        stream.connectedAt !== undefined &&
        Date.now() - stream.connectedAt >= HEALTHY_STREAM_MIN_MS;
      // A stream whose relay asked to replace it and then ended it was closed
      // by that relay on purpose, so its end is not a failure, however young
      // the stream: it reopens as soon as the open floor allows.
      const closedByItsRelay = stream.rotation !== undefined;
      scheduleReconnect(
        healthy || closedByItsRelay
          ? Math.floor(Math.random() * (HEALTHY_REOPEN_JITTER_MS + 1))
          : SSE_RECONNECT_DELAY_MS
      );
    };

    const headers: Record<string, string> = { Accept: 'text/event-stream', ...tabKeyHeader };
    const token = resolveToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    fetch(streamUrl, {
      method: 'GET',
      headers,
      signal: stream.controller.signal,
      cache: 'no-store',
    })
      .then((resp) => {
        if (!resp.ok || !resp.body) return;
        return readSSEFrames(resp.body, onFrame, onError);
      })
      .catch(() => {
        /* stream read aborted or network drop — fall through to reconnect */
      })
      .then(onEnded);
    return stream;
  };

  return {
    connect,
    closeStreams,
    cancelReconnect,
    hasCurrent: () => current !== null,
    currentStreamId: () => current?.id,
  };
}
