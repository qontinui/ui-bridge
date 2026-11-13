/**
 * Reading a request body as JSON — the rules every adapter applies (the
 * standalone server's `parseBody`, the Express adapters' `jsonBody`, and
 * `readJsonBody` below for the Next.js adapter). What a read body MEANS is
 * `interpretJsonBody`, shared by all three; the size cap and the unreadable
 * stream are each reader's own, since each reads a different kind of stream:
 *
 * - An empty (or whitespace-only) body is no body.
 * - A body declared JSON, or declared as nothing, that does not parse is
 *   refused (400): the caller sent a request it believes is JSON and it is
 *   not, so answering as if it had sent `{}` would run the handler on an empty
 *   request.
 * - A body declared as another type that does not parse is no body, not a
 *   refusal: such a caller never claimed to send JSON.
 * - A body over `MAX_BODY_BYTES` is refused (413). A Node reader then
 *   discards the rest of the upload (`discardRest`) and, when it can, keeps
 *   the connection. When it cannot, it ends the connection only once the 413
 *   is out (a FIN after it, never ahead of an earlier pipelined response), and
 *   resets a client still uploading only `DISCARD_GRACE_MS` after that. So the
 *   413 is guaranteed to a client that reads while it uploads, or that
 *   finishes uploading within `DISCARD_MAX_MS` of the refusal (a declared
 *   length) or within `DISCARD_GRACE_MS` of the FIN (an undeclared one). That
 *   holds for a client that asked to close (`Connection: close`, HTTP/1.0)
 *   too, provided the 413 declares a `Content-Length`: an HTTP/1.0 response
 *   cannot be chunked, so without a length Node closes the connection after
 *   it regardless (see `discardRest`).
 * - No request pipelined behind the refused one on a connection being ended
 *   is dispatched to a UI Bridge handler (`dropIfConnectionEnded`). Through
 *   `createExpressRouter` that covers the router's own routes only, not a
 *   host's other routes.
 * - A body whose stream cannot be read (already consumed, aborted) is refused
 *   (400) rather than read as no body.
 */

import type { IncomingMessage, ServerResponse } from 'http';

/** Largest request body read, in bytes — the standalone server's limit. */
export const MAX_BODY_BYTES = 10 * 1024 * 1024;

/**
 * How much of an over-limit upload of undeclared length (chunked)
 * `discardRest` reads off before it gives up on the connection, counted from
 * the `discardRest` call (bytes the caller read before it are not counted):
 * twice the body limit, so an upload that overshoots the limit by up to the
 * limit again still keeps its connection. For a declared length it decides
 * only whether the connection is kept (see `discardRest`).
 */
export const DISCARD_MAX_BYTES = 2 * MAX_BODY_BYTES;

/** How long `discardRest` reads off an over-limit upload before it gives up. */
export const DISCARD_MAX_MS = 5000;

/**
 * How long a connection `discardRest` has given up on is still read off after
 * its FIN before it is destroyed, so a client finishing its upload sees the
 * FIN, and reads the 413 ahead of it, rather than a reset.
 */
export const DISCARD_GRACE_MS = 1000;

/**
 * Connections `discardRest` has decided to end. The FIN waits until the 413
 * owns the socket (an earlier pipelined response may still be pending), so
 * until then `writableEnded` alone does not say the connection is going.
 */
const endingConnections = new WeakSet<object>();

/**
 * Drop a request that arrived on a connection the server has ended, or that
 * `discardRest` has decided to end: its body is read off and thrown away, and
 * the caller must run no handler. Node keeps parsing such a connection, so a
 * request pipelined behind a refused upload is still dispatched; its handler
 * would run (side effects included) and its response would be lost on the
 * ended socket. Returns whether the request was dropped.
 */
export function dropIfConnectionEnded(req: IncomingMessage): boolean {
  const socket = req.socket;
  if (!socket || (!socket.writableEnded && !endingConnections.has(socket))) return false;
  req.resume();
  return true;
}

/** Bounds on `discardRest`; each defaults to the constant of the same name. */
export interface DiscardLimits {
  /**
   * Bytes of an undeclared-length upload read off after the call before the
   * connection is given up; for a declared length, the most still to come
   * for which the connection is kept.
   */
  maxBytes?: number;
  /** Milliseconds after the call before the connection is given up. */
  maxMs?: number;
  /** Milliseconds a given-up connection is read off after its FIN before it is destroyed. */
  graceMs?: number;
  /**
   * Body bytes the caller already read before the call (default 0). Only a
   * declared `Content-Length` minus these is still to come.
   */
  alreadyRead?: number;
}

/**
 * Refuse the rest of an over-limit upload without losing the 413: let it
 * arrive and be thrown away, keeping the connection when the rest is bounded
 * — what `body-parser` does after its own limit error. Call it BEFORE the 413
 * is written (it may change the response's keep-alive, see below), with the
 * response the 413 is written to.
 *
 * Neither alternative delivers the 413 reliably. Closing the connection
 * (`Connection: close`) while request bytes are still unread makes the
 * server's TCP stack answer with a reset, and on Windows a reset discards the
 * 413 the client had not yet read: `fetch` fails with `ECONNRESET` instead.
 * Pausing the request and keeping the connection leaves a client that is
 * still uploading blocked on a request the server will never read, so the
 * connection never goes idle and `server.close()` never finishes.
 *
 * The read-off is bounded, and giving up is never a bare destroy, which with
 * upload bytes still arriving is a reset. The connection is given up:
 * - for a declared length (`Content-Length` minus `alreadyRead`) past
 *   `maxBytes`, at once: it is ended (FIN after the 413) and read off until
 *   the declared body is in or the client closes, or, failing that, `maxMs`
 *   after the call, `graceMs` after which it is destroyed. The declared length
 *   bounds the bytes and `maxMs` the time; a client that reads the 413 and
 *   stops costs less.
 * - for an undeclared length, once more than `maxBytes` have been discarded
 *   or `maxMs` have passed: it is ended, read off for `graceMs` more, then
 *   destroyed.
 * - for a declared length within `maxBytes`, only once `maxMs` have passed,
 *   as for an undeclared one; otherwise the body is read off to its end and
 *   the connection kept.
 * A client still uploading when the connection is destroyed is reset and may
 * lose the 413: the 413 is guaranteed only to a client that reads while it
 * uploads, or finishes uploading before that.
 *
 * The FIN, and any destroy after it, waits until this request's response has
 * finished (`res` 'finish'): when an earlier response on the connection is
 * still pending, the 413 is queued behind it, and ending the socket at once
 * would cut both. Until then a declared body is still read off; an upload
 * that has tripped a cap is paused instead (no more bandwidth is spent on it),
 * and resumed for the grace period once the FIN is out.
 *
 * A client that asked to close (`Connection: close`, or HTTP/1.0) would have
 * its 413 marked last, and Node then destroys the socket as soon as the 413
 * is flushed: a reset while upload bytes still arrive. So when the 413's head
 * is not yet written, this sets the response's `shouldKeepAlive` (a public,
 * if undocumented, `OutgoingMessage` property Node's server itself sets from
 * the request) to true: the 413 then advertises keep-alive and Node leaves the
 * socket open, and this function ends it itself once the upload is read off
 * (or given up as above), honouring the close. Node keeps the socket only for
 * a response it can delimit, so the caller's 413 must carry a
 * `Content-Length`: to an HTTP/1.0 client, which cannot be sent a chunked
 * body, a 413 without one is still marked last and the socket destroyed.
 *
 * Discarded bytes are never buffered, so the cost is bandwidth, not memory.
 */
export function discardRest(
  req: IncomingMessage,
  res: ServerResponse,
  limits: DiscardLimits = {}
): void {
  const maxBytes = limits.maxBytes ?? DISCARD_MAX_BYTES;
  const maxMs = limits.maxMs ?? DISCARD_MAX_MS;
  const graceMs = limits.graceMs ?? DISCARD_GRACE_MS;
  const alreadyRead = limits.alreadyRead ?? 0;
  // Already read to its end, or already torn down: nothing is left, and a
  // timer would only cut a reusable connection.
  if (req.readableEnded || req.destroyed) return;
  const socket = req.socket;
  const closeAsked = !res.shouldKeepAlive;
  if (closeAsked && !res.headersSent) res.shouldKeepAlive = true;
  const declared = Number(req.headers['content-length']);
  const declaredLength = Number.isFinite(declared);
  let discarded = 0;
  // Whether the response owns the socket (has finished); whether the
  // connection is to be ended (FIN); whether a client still uploading is then
  // destroyed after the grace period.
  let owned = res.writableFinished;
  let endWanted = false;
  let cutWanted = false;
  let ended = false;
  let cut = false;
  const act = () => {
    if (!owned) return;
    if (endWanted && !ended) {
      ended = true;
      socket.end();
    }
    if (cutWanted && !cut) {
      cut = true;
      req.resume();
      setTimeout(() => socket.destroy(), graceMs).unref?.();
    }
  };
  const giveUp = (withCut: boolean) => {
    endWanted = true;
    if (withCut) cutWanted = true;
    endingConnections.add(socket);
    act();
  };
  const stop = () => {
    clearTimeout(timer);
    req.removeListener('data', onData);
    req.removeListener('end', onEnd);
    req.removeListener('close', stop);
  };
  const trip = () => {
    stop();
    // Spend no more on an upload already given up, until the FIN can go out.
    if (!owned) req.pause();
    giveUp(true);
  };
  const onData = (chunk: Buffer | string) => {
    discarded += chunk.length;
    if (!declaredLength && discarded > maxBytes) trip();
  };
  const onEnd = () => {
    stop();
    // The upload is in: the connection is kept, unless the client asked to
    // close (Node would have closed it; with keep-alive advertised, we do).
    if (closeAsked) giveUp(false);
  };
  const timer = setTimeout(trip, maxMs);
  timer.unref?.();
  req.on('data', onData);
  req.once('end', onEnd);
  req.once('close', stop);
  if (!owned) {
    res.once('finish', () => {
      owned = true;
      act();
    });
  }
  if (declaredLength && declared - alreadyRead > maxBytes) giveUp(false);
  req.resume();
}

/** What reading the body found. `body` is `undefined` when there is none. */
export type JsonBodyRead =
  | { ok: true; body: unknown }
  | { ok: false; status: 400 | 413; message: string };

/** A content type that declares JSON: `application/json`, `application/x+json`, … */
const JSON_CONTENT_TYPE = /[/+]json\b/i;

const TOO_LARGE = {
  ok: false,
  status: 413,
  message: 'Request body too large',
} as const satisfies JsonBodyRead;

export async function readJsonBody(request: Request): Promise<JsonBodyRead> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return TOO_LARGE;

  // Read chunk by chunk and stop at the cap, so a body sent without (or
  // understating) its Content-Length is never buffered whole.
  let bytes: Uint8Array;
  try {
    const read = await readCapped(request);
    if (read === null) return TOO_LARGE;
    bytes = read;
  } catch {
    return { ok: false, status: 400, message: 'Request body could not be read' };
  }

  return interpretJsonBody(new TextDecoder().decode(bytes), request.headers.get('content-type'));
}

/**
 * What a fully-read, UTF-8-decoded body means: no body when empty or
 * whitespace-only, the parsed value when it is JSON (top-level primitives
 * included), and otherwise a 400 when it was declared JSON or declared as
 * nothing, or no body when it was declared as another type. Every adapter's
 * reader ends here, so the rule exists once.
 */
export function interpretJsonBody(
  text: string,
  contentType: string | null | undefined
): JsonBodyRead {
  if (!text.trim()) return { ok: true, body: undefined };
  try {
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    if (contentType && !JSON_CONTENT_TYPE.test(contentType)) return { ok: true, body: undefined };
    return { ok: false, status: 400, message: 'Request body is not valid JSON' };
  }
}

/** The body's bytes, or `null` once they pass `MAX_BODY_BYTES`. Throws when unreadable. */
async function readCapped(request: Request): Promise<Uint8Array | null> {
  if (request.bodyUsed) throw new TypeError('Body has already been read');
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
