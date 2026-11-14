/**
 * The command stream lease: the relay ends every command stream itself (plan
 * 2026-11-09-a-dead-relay-tab-stays-the-operators-primary-and-a-command-sent-during-a-stream-reopen-is-lost,
 * D1). On the deployed platform a tab whose browser was killed kept its
 * listener for minutes: neither a `request.signal` abort nor a failing
 * `enqueue` arrived, and those were the only ends the relay listened for.
 *
 * - A client that declared `rotate` (`caps=rotate,…` on `GET
 *   <base>/commands/stream`) is sent a `rotate` frame at the lease, and the
 *   stream stays open: make-before-break. It ends `replaced` when the tab's next
 *   stream registers (`CommandRelay` calls the listener's `close`), or
 *   `rotate_unanswered` once the rotate grace has passed with none.
 * - Any other client is closed once, `lease`, at the legacy lease.
 * - An abort of the request, a consumer cancel, a failing enqueue and a
 *   consumer that stopped reading (`consumer_stalled`, checked on each ping) are
 *   ends the relay hears at once.
 *
 * What the relay does with an ended stream's listener is stream-slot.ts's
 * business. The frames mirror the `ping` the stream already sends, a named
 * event with a `data:` payload: the client keeps only `data:` lines and
 * dispatches on their `type` (`relay-client.ts`). Every end logs one
 * `stream.ended` line, which is how an operator learns which of these ends a
 * platform actually delivers.
 */

/** Why a command stream ended. */
export type StreamEndReason =
  | 'lease'
  | 'replaced'
  | 'rotate_unanswered'
  | 'abort'
  | 'cancel'
  | 'enqueue_failed'
  | 'consumer_stalled';

/**
 * The default lease of a stream whose client declared `rotate`, in ms. A
 * numeric literal on purpose: qontinui-web restates it beside its own copy of
 * the client's reconnect delay, reading the bundled `name = <literal>;`.
 */
export const STREAM_LEASE_MS = 50_000;

/** The default lease of any other stream: the platform's 300 s function limit, less 30 s. */
export const LEGACY_STREAM_LEASE_MS = 270_000;

/** How long a stream sent a `rotate` frame waits for its replacement, by default. */
export const ROTATE_GRACE_MS = 10_000;

/**
 * The shortest lease the relay runs: the client's reconnect delay
 * (`SSE_RECONNECT_DELAY_MS` in relay-client.ts). A shorter one would end
 * streams faster than a legacy client reopens them.
 */
export const STREAM_LEASE_FLOOR_MS = 10_000;

/**
 * The command stream's high-water mark, in chunks. The consumer-progress check
 * reads the controller's `desiredSize` as this less the chunks still queued.
 */
export const STREAM_HIGH_WATER_MARK = 1;

/** The lease timings in force (`CommandRelay#streamLeaseTimings`). */
export interface StreamLeaseTimings {
  /** When a rotate-capable stream is sent its `rotate` frame. */
  leaseMs: number;
  /** When any other stream is closed. */
  legacyLeaseMs: number;
  /** How long after its `rotate` frame a stream waits for its replacement. */
  rotateGraceMs: number;
}

/**
 * The lease timings for `options`, with the precedence `CommandRelay` gives
 * every threshold: an explicit option, then the env override `readEnv` reads,
 * then the default. Both leases are floored at {@link STREAM_LEASE_FLOOR_MS}.
 */
export function streamLeaseTimings(
  options: { streamLeaseMs?: number; legacyStreamLeaseMs?: number; rotateGraceMs?: number },
  readEnv: (name: string, fallback: number) => number
): StreamLeaseTimings {
  return {
    leaseMs: Math.max(
      STREAM_LEASE_FLOOR_MS,
      options.streamLeaseMs ?? readEnv('UI_BRIDGE_STREAM_LEASE_MS', STREAM_LEASE_MS)
    ),
    legacyLeaseMs: Math.max(
      STREAM_LEASE_FLOOR_MS,
      options.legacyStreamLeaseMs ??
        readEnv('UI_BRIDGE_LEGACY_STREAM_LEASE_MS', LEGACY_STREAM_LEASE_MS)
    ),
    rotateGraceMs: options.rotateGraceMs ?? readEnv('UI_BRIDGE_ROTATE_GRACE_MS', ROTATE_GRACE_MS),
  };
}

/**
 * What a stream's client declared in its query: the capabilities it has
 * (`caps`, comma-separated) and the page instance it runs in (`cid`).
 * Capability is negotiated per stream, never inferred from a version: the
 * relay and an injected client are versioned apart.
 */
export interface StreamClient {
  /** Each declared capability once, in order; unknown ones are kept and ignored. */
  caps: readonly string[];
  /** The page instance (`cid`), when one well-formed id was given. */
  clientInstanceId?: string;
}

const CAP_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
const MAX_CAPS = 16;
const CLIENT_INSTANCE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/** Read `caps` and `cid` from a stream request's query. A malformed value is dropped, not refused. */
export function readStreamClient(query: URLSearchParams): StreamClient {
  const caps: string[] = [];
  for (const cap of (query.get('caps') ?? '').split(',')) {
    const name = cap.trim();
    if (CAP_PATTERN.test(name) && !caps.includes(name) && caps.length < MAX_CAPS) caps.push(name);
  }
  const cid = query.get('cid')?.trim();
  return cid && CLIENT_INSTANCE_ID_PATTERN.test(cid) ? { caps, clientInstanceId: cid } : { caps };
}

/** The keep-alive ping, which is also the client's throttle-immune heartbeat clock. */
export function pingFrame(now: number): string {
  return `event: ping\ndata: ${JSON.stringify({ type: 'ping', timestamp: now })}\n\n`;
}

/** Asks the client to open its next stream now; this one stays open for `graceMs`. */
export function rotateFrame(streamId: string, graceMs: number): string {
  return `event: rotate\ndata: ${JSON.stringify({ type: 'rotate', streamId, graceMs })}\n\n`;
}

/** Tells the client why the server is closing this stream; for the client, a normal end. */
export function endFrame(reason: StreamEndReason): string {
  return `event: end\ndata: ${JSON.stringify({ type: 'end', reason })}\n\n`;
}

/** The ends the server makes itself, and so tells the client about with an `end` frame. */
const SERVER_ENDS: ReadonlySet<StreamEndReason> = new Set([
  'lease',
  'replaced',
  'rotate_unanswered',
  'consumer_stalled',
]);

/** Log one structured `stream.ended` line: a single-line JSON payload, as `tab.pruned` is. */
export function logStreamEnded(
  tabId: string | undefined,
  reason: StreamEndReason,
  ageMs: number
): void {
  console.log(
    `[ui-bridge] ${JSON.stringify({
      event: 'stream.ended',
      ...(tabId ? { id: tabId } : {}),
      reason,
      age_ms: ageMs,
    })}`
  );
}

/** Where a {@link CommandStreamLease} writes, and what it reads back. */
export interface CommandStreamSink {
  /** Put one frame on the stream. Throws when the stream can take no more. */
  enqueue(frame: string): void;
  /** The stream controller's `desiredSize`; null while there is none, or once it errored. */
  desiredSize(): number | null;
  /** Close the stream. May throw when it is closed already. */
  close(): void;
}

export interface CommandStreamLeaseOptions {
  /** The tab the stream serves, for the `stream.ended` line. */
  tabId?: string;
  /** Whether the client declared `rotate`. */
  rotate: boolean;
  timings: StreamLeaseTimings;
  /** The keep-alive cadence. */
  pingIntervalMs: number;
  sink: CommandStreamSink;
  /**
   * The relay's half of the end, run once, after the stream is closed. Whether
   * that parks the tab's slot or removes its listener is stream-slot.ts's
   * `slotActionForEnd`.
   */
  onEnd: (reason: StreamEndReason) => void;
}

/**
 * One command stream's lifecycle on the server: its writes, its keep-alive, its
 * lease, and its single end.
 */
export class CommandStreamLease {
  /** The id the relay gave this stream. The `rotate` frame names it. */
  streamId = '';
  private readonly openedAt = Date.now();
  private endedFor: StreamEndReason | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private leaseTimer: ReturnType<typeof setTimeout> | null = null;
  /** Chunks put on the stream so far. */
  private written = 0;
  /** How many chunks the consumer had taken when the last ping went out; null before the first. */
  private takenAtLastPing: number | null = null;

  constructor(private readonly options: CommandStreamLeaseOptions) {}

  /** Why the stream ended, or null while it is open. */
  get endReason(): StreamEndReason | null {
    return this.endedFor;
  }

  /** Start the keep-alive and the lease. Call once the stream's controller exists. */
  start(): void {
    if (this.endedFor !== null) return;
    const { leaseMs, legacyLeaseMs, rotateGraceMs } = this.options.timings;
    this.pingTimer = setInterval(() => this.ping(), this.options.pingIntervalMs);
    this.leaseTimer = this.options.rotate
      ? setTimeout(() => this.rotate(rotateGraceMs), leaseMs)
      : setTimeout(() => this.end('lease'), legacyLeaseMs);
  }

  /** Put `frame` on the stream. False when the stream has ended, or when the write ended it. */
  write(frame: string): boolean {
    if (this.endedFor !== null) return false;
    try {
      this.options.sink.enqueue(frame);
    } catch {
      this.end('enqueue_failed');
      return false;
    }
    this.written++;
    return true;
  }

  /**
   * End the stream for `reason`, once: whatever ends it afterwards changes
   * nothing. A server-made end is announced with an `end` frame first.
   */
  end(reason: StreamEndReason): void {
    if (this.endedFor !== null) return;
    this.endedFor = reason;
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.leaseTimer) clearTimeout(this.leaseTimer);
    this.pingTimer = null;
    this.leaseTimer = null;
    logStreamEnded(this.options.tabId, reason, Date.now() - this.openedAt);
    if (SERVER_ENDS.has(reason)) {
      try {
        this.options.sink.enqueue(endFrame(reason));
      } catch {
        /* the consumer is gone; the end is the server's either way */
      }
    }
    try {
      this.options.sink.close();
    } catch {
      /* already closed, or cancelled by the consumer */
    }
    this.options.onEnd(reason);
  }

  /**
   * One keep-alive. The consumer-progress check (D1 O4) runs first: when a
   * chunk is still waiting (`desiredSize <= 0`) and the consumer has taken
   * nothing since the last ping, it stopped reading, and the stream ends
   * `consumer_stalled`. The first ping only sets the mark, so a consumer is
   * judged on a whole ping interval.
   */
  private ping(): void {
    if (this.endedFor !== null) return;
    const desiredSize = this.options.sink.desiredSize();
    const taken =
      desiredSize === null ? null : this.written - (STREAM_HIGH_WATER_MARK - desiredSize);
    if (
      this.takenAtLastPing !== null &&
      desiredSize !== null &&
      desiredSize <= 0 &&
      taken === this.takenAtLastPing
    ) {
      this.end('consumer_stalled');
      return;
    }
    this.takenAtLastPing = taken;
    this.write(pingFrame(Date.now()));
  }

  /** The lease ran out: ask the client to open its next stream, and wait for it. */
  private rotate(graceMs: number): void {
    if (!this.write(rotateFrame(this.streamId, graceMs))) return;
    this.leaseTimer = setTimeout(() => this.end('rotate_unanswered'), graceMs);
  }
}
