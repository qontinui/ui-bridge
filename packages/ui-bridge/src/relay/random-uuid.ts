/**
 * A random RFC 4122 version-4 UUID, on every page the relay client runs on.
 *
 * `crypto.randomUUID` is defined only in secure contexts (https, localhost),
 * and the injected runtime also runs on plain-http pages. There the same v4
 * shape is built from `crypto.getRandomValues`, which every context has. The
 * relay client mints its tab id (when nothing pins one) and its per-instance
 * `cid` here, so neither can throw it out of starting.
 */
export function randomUuid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
}
