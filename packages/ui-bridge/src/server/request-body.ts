/**
 * Reading a fetch `Request` body as JSON, for the Next.js adapter.
 *
 * The same rules the standalone server's `parseBody` applies:
 *
 * - An empty (or whitespace-only) body is no body.
 * - A body declared JSON, or declared as nothing, that does not parse is
 *   refused (400): the caller sent a request it believes is JSON and it is
 *   not, so answering as if it had sent `{}` would run the handler on an empty
 *   request.
 * - A body declared as another type that does not parse is no body, not a
 *   refusal: such a caller never claimed to send JSON.
 * - A body over `MAX_BODY_BYTES` is refused (413).
 * - A body whose stream cannot be read (already consumed, aborted) is refused
 *   (400) rather than read as no body.
 */

/** Largest request body read, in bytes — the standalone server's limit. */
export const MAX_BODY_BYTES = 10 * 1024 * 1024;

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

  const text = new TextDecoder().decode(bytes);
  if (!text.trim()) return { ok: true, body: undefined };
  try {
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    const type = request.headers.get('content-type');
    if (type && !JSON_CONTENT_TYPE.test(type)) return { ok: true, body: undefined };
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
