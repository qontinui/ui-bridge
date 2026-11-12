/**
 * Device pairing: who may drive the app over its network port.
 *
 * A caller on the machine itself needs nothing. That covers `adb forward`, whose
 * peer was measured as `::ffff:127.0.0.1` on an Android 11 emulator on 2026-10-31;
 * physical phones are unmeasured. Anyone else signs each request with a token the
 * phone issued, so the token never crosses the network after pairing. A bearer
 * would not do: the device id is public in the mDNS record, so a spoofer announcing
 * it would be handed the bearer on the runner's next connect.
 *
 * This module holds the decisions and their state. `NativeUIBridgeServer`'s
 * network entry (`./http-server.ts`) applies them to requests. Nothing here may
 * log a token or a code, or the text of an error from a store that might carry
 * one: `console` feeds the ring buffer behind `/control/console-errors`.
 */

import { bytesToHex, constantTimeEqual, hmacSha256, sha256Hex, utf8Bytes } from '../core/sha256';
import type { HTTPRequest } from './http-server';

/** The request header carrying `<ts>.<nonce>.<sig>`. */
export const UI_BRIDGE_AUTH_HEADER = 'X-UI-Bridge-Auth';

/** How far a signature's timestamp may sit from the phone's clock, either way. */
export const SIGNATURE_WINDOW_MS = 300_000;

/** How long a tap in Settings keeps a code live. */
export const PAIRING_CODE_TTL_MS = 120_000;

/** Wrong codes allowed before the code is disarmed, globally and not per peer. */
export const PAIRING_CODE_MAX_ATTEMPTS = 5;

/**
 * The longest raw body a signature is checked over, in UTF-16 code units. A LAN
 * peer can force a hash of the body, the method and the target before proving
 * anything, and the hash is pure JS on the phone's JS thread, so all three are
 * capped. Routes taking free-form text, such as the `guide` of
 * `design/style-guide/load`, have no measured size, so this number is a
 * judgement, and a body over it gets `PAIRING_BODY_TOO_LARGE` rather than silence.
 * No caller on the machine is held to this: it hashes nothing.
 */
export const SIGNED_BODY_MAX_CHARS = 256 * 1024;

/** The longest method a signature is checked over. */
export const SIGNED_METHOD_MAX_CHARS = 16;

/** The longest `path?query` a signature is checked over. */
export const SIGNED_TARGET_MAX_CHARS = 8192;

/** A peer's first signature failure costs it this long before anything of its is hashed. */
export const SIGNATURE_BACKOFF_BASE_MS = 1_000;
/** The backoff doubles per further failure up to this. */
export const SIGNATURE_BACKOFF_MAX_MS = 30_000;
/** Peers remembered at once; past it the oldest entry is evicted. */
export const SIGNATURE_BACKOFF_PEERS_MAX = 256;

const TOKEN_BYTES = 32;
const NONCE_CACHE_MAX = 4096;
/** A hung secure store must not hang a request, or every later pairing call behind it. */
const STORE_TIMEOUT_MS = 10_000;
/** Attempts at one unbiased code before the random source is called broken. */
const CODE_SAMPLE_ATTEMPTS = 32;
/** The largest multiple of 1,000,000 that fits in 32 bits: drawing below it makes `% 1e6` uniform. */
const CODE_SAMPLE_LIMIT = Math.floor(0x100000000 / 1_000_000) * 1_000_000;
/** How far the wall clock may move against the monotonic one before that is a step. */
const CLOCK_STEP_TOLERANCE_MS = 5_000;

const SIGNATURE_HEADER_PATTERN = /^(\d{1,16})\.([A-Za-z0-9_-]{16,64})\.([0-9a-f]{64})$/;

/** A monotonic reading in ms, or null on a runtime with no `performance.now`. */
function monotonicNow(): number | null {
  const clock = (globalThis as { performance?: { now?: () => number } }).performance;
  return typeof clock?.now === 'function' ? clock.now() : null;
}

/**
 * Set by a wrapper that forwards to a store it does not own, such as the
 * provider's: it answers the object the app passes in now. Suspicion is kept
 * against that object as well as the wrapper, so it survives the wrapper being
 * rebuilt. A revoke clears it only for the object its successful store call
 * reached, and marks every other object it saw behind the wrapper. A
 * registered symbol, so every bundled copy of this module (each entry point,
 * CJS and ESM) agrees on it.
 */
export const PAIRING_STORE_IDENTITY: unique symbol = Symbol.for(
  '@qontinui/ui-bridge-native.pairing-store-identity'
);

/**
 * What the app implements: the token's persistence, and secure randomness,
 * because the SDK's only generator is `Math.random`.
 */
export interface PairingStore {
  /** For a forwarding wrapper only. See `PAIRING_STORE_IDENTITY`. */
  [PAIRING_STORE_IDENTITY]?: () => PairingStore | undefined;
  /**
   * The current token, or `null` when the store has loaded and holds none.
   * THROW or reject while the store has not loaded: `null` then would mint a
   * replacement over a token still on disk. Only a throw means "not loaded":
   * any value that resolves is taken as loaded, and a revoke overwrites it.
   */
  get(): string | null | Promise<string | null>;
  /** Persist `token`. Pairing answers only after this settles. */
  set(token: string): void | Promise<void>;
  /** Forget the token. */
  clear(): void | Promise<void>;
  /** `n` bytes from a cryptographically secure source. */
  randomBytes(n: number): Uint8Array | Promise<Uint8Array>;
}

/** Why a pairing operation refused, by the code a caller sees. */
export type PairingErrorCode = 'PAIRING_UNCONFIGURED' | 'PAIRING_UNAVAILABLE';

/** Thrown by the app-facing operations. Its message never carries a token or a code. */
export class PairingError extends Error {
  constructor(
    readonly code: PairingErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'PairingError';
  }
}

/** Why the code is no longer live. */
export type PairingDisarmReason =
  | 'consumed'
  | 'expired'
  | 'attempts_exhausted'
  | 'cancelled'
  | 'revoked';

/** What the app's Settings screen shows. Never carries the code or the token. */
export interface PairingState {
  /** A store is configured. */
  configured: boolean;
  /** A code is live right now. */
  armed: boolean;
  /** When the live code stops working, epoch ms. */
  expiresAt: number | null;
  /** Wrong codes left on the live code. */
  attemptsRemaining: number | null;
  /** Peer address that consumed the last code, so a wrong pairer is visible. */
  consumedBy: string | null;
  /** When it did, epoch ms. */
  consumedAt: number | null;
  /** Why the last code stopped being live. Null while armed, or before any arm. */
  disarmReason: PairingDisarmReason | null;
}

/** The code to show the user, returned only to the app that armed it. */
export interface ArmedPairingCode {
  code: string;
  expiresAt: number;
}

/**
 * The string a signature covers, encoded as UTF-8 and keyed by the token
 * string's own UTF-8 bytes (not its hex-decoded value):
 *
 *   METHOD \n path?query \n ts \n nonce \n sha256(body)
 *
 * - `METHOD`: as on the request line, uppercase.
 * - `path?query`: the request target exactly as sent, with its percent-encoding
 *   and parameter order untouched, and no `?` when there is no query.
 * - `ts`: decimal integer milliseconds since the epoch on the PHONE's clock, the
 *   unit of `serverTime` on open health. A signer adds the offset it learned.
 * - `nonce`: `[A-Za-z0-9_-]{16,64}`, fresh for each request.
 * - `sha256(body)`: lowercase hex of the raw body bytes, which is the digest of
 *   zero bytes for a request with no body.
 *
 * The separators are single `\n` bytes with none at the end. The header is
 * `X-UI-Bridge-Auth: <ts>.<nonce>.<sig>`, where `sig` is the HMAC-SHA256 tag in
 * lowercase hex.
 *
 * The runner's Rust signer (`qontinui-runner` `src-tauri/src/mcp/transport/pairing.rs`)
 * reproduces this byte for byte, and both it and `pairing.test.ts` pin the same
 * vector against an independent HMAC. Changing it would break every paired runner.
 */
export function canonicalSignatureInput(parts: {
  method: string;
  pathAndQuery: string;
  ts: string;
  nonce: string;
  bodySha256Hex: string;
}): string {
  return [parts.method, parts.pathAndQuery, parts.ts, parts.nonce, parts.bodySha256Hex].join('\n');
}

function signatureHex(
  token: string,
  parts: { method: string; pathAndQuery: string; ts: string; nonce: string; body: string }
): string {
  const input = canonicalSignatureInput({
    method: parts.method,
    pathAndQuery: parts.pathAndQuery,
    ts: parts.ts,
    nonce: parts.nonce,
    bodySha256Hex: sha256Hex(parts.body),
  });
  return bytesToHex(hmacSha256(utf8Bytes(token), utf8Bytes(input)));
}

/**
 * The `X-UI-Bridge-Auth` value for one request, for a JavaScript caller. A body
 * here is the exact string sent, and empty for a request with none.
 */
export function signUIBridgeRequest(
  token: string,
  request: { method: string; pathAndQuery: string; body?: string; ts: number; nonce: string }
): string {
  const ts = String(request.ts);
  const sig = signatureHex(token, {
    method: request.method,
    pathAndQuery: request.pathAndQuery,
    ts,
    nonce: request.nonce,
    body: request.body ?? '',
  });
  return `${ts}.${request.nonce}.${sig}`;
}

/**
 * Every value of a header, under any casing. More than one means an adapter kept
 * entries that differ only in case, so callers decide what a conflict means.
 */
export function headerValues(headers: Record<string, string> | undefined, name: string): string[] {
  if (!headers) return [];
  const wanted = name.toLowerCase();
  return Object.keys(headers)
    .filter((key) => key.toLowerCase() === wanted)
    .map((key) => headers[key]);
}

function ipv4Octets(address: string): number[] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (!match) return null;
  const octets = match.slice(1).map(Number);
  return octets.every((octet) => octet <= 255) ? octets : null;
}

function isLoopbackIpv4(address: string): boolean {
  return ipv4Octets(address)?.[0] === 127;
}

/** The eight 16-bit groups of an IPv6 address, or null when it is not one. */
function parseIpv6(address: string): number[] | null {
  if (!address.includes(':')) return null;
  let text = address;
  const trailing: number[] = [];
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(tail);
    if (!match) return null;
    const octets = match.slice(1).map(Number);
    if (octets.some((octet) => octet > 255)) return null;
    trailing.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
    text = text.slice(0, lastColon + 1);
    // Keep "::" intact, and drop the one colon that only separated the IPv4 part.
    if (!text.endsWith('::')) text = text.slice(0, -1);
  }

  const groupsOf = (part: string): number[] | null => {
    if (part === '') return [];
    const groups: number[] = [];
    for (const group of part.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
      groups.push(parseInt(group, 16));
    }
    return groups;
  };

  const gapAt = text.indexOf('::');
  if (gapAt !== text.lastIndexOf('::')) return null;
  const width = 8 - trailing.length;
  if (gapAt === -1) {
    const groups = groupsOf(text);
    return groups && groups.length === width ? [...groups, ...trailing] : null;
  }
  const head = groupsOf(text.slice(0, gapAt));
  const rest = groupsOf(text.slice(gapAt + 2));
  if (!head || !rest || head.length + rest.length >= width) return null;
  const zeros = new Array<number>(width - head.length - rest.length).fill(0);
  return [...head, ...zeros, ...rest, ...trailing];
}

function isLoopbackIpv6(address: string): boolean {
  const zone = address.indexOf('%');
  const groups = parseIpv6(zone === -1 ? address : address.slice(0, zone));
  if (!groups) return false;
  const leadingZeros = (count: number): boolean => groups.slice(0, count).every((g) => g === 0);
  if (leadingZeros(7) && groups[7] === 1) return true;
  return leadingZeros(5) && groups[5] === 0xffff && groups[6] >> 8 === 127;
}

/**
 * True for `127.0.0.0/8`, `::1` in any spelling, and an IPv4-mapped `::ffff:127.x`.
 * Parsed rather than prefix-matched, so `127.0.0.1.evil.example` is not loopback.
 */
export function isLoopbackAddress(address: string): boolean {
  return isLoopbackIpv4(address) || isLoopbackIpv6(address);
}

/**
 * True for a `Host` naming the machine itself, with or without a port, and with
 * an IPv6 literal in brackets. This is what closes DNS rebinding: a page that
 * rebinds its own name to 127.0.0.1 still sends that name here.
 */
export function isLoopbackHost(host: string): boolean {
  const value = host.trim().toLowerCase();
  const bracketed = /^\[([^\]]+)\](?::(\d{1,5}))?$/.exec(value);
  if (bracketed) {
    return isLoopbackIpv6(bracketed[1]) && isValidPort(bracketed[2]);
  }
  const plain = /^([^:]+)(?::(\d{1,5}))?$/.exec(value);
  if (!plain) return false;
  return (plain[1] === 'localhost' || isLoopbackIpv4(plain[1])) && isValidPort(plain[2]);
}

function isValidPort(port: string | undefined): boolean {
  return port === undefined || Number(port) <= 65535;
}

/**
 * True for a `Host` no page from outside this network can have rebound: an IP
 * literal, `localhost`, or an mDNS `.local` name. A page that rebinds its own
 * name to the phone still sends that name here, with no `Origin` on a same-origin
 * GET.
 */
export function isUnrebindableHost(host: string): boolean {
  const value = host.trim().toLowerCase();
  const bracketed = /^\[([^\]%]+)(?:%[^\]]*)?\](?::(\d{1,5}))?$/.exec(value);
  if (bracketed) return parseIpv6(bracketed[1]) !== null && isValidPort(bracketed[2]);
  const plain = /^([^:]+)(?::(\d{1,5}))?$/.exec(value);
  if (!plain) return false;
  const named =
    plain[1] === 'localhost' || plain[1].endsWith('.local') || ipv4Octets(plain[1]) !== null;
  return named && isValidPort(plain[2]);
}

/**
 * True for a request a web page sent. A CORS fetch carries `Origin`, but a no-cors
 * GET such as an `<img>` carries none, so that one shows as a `Sec-Fetch-Site`
 * other than `none` (which is a person typing the URL) or a `Referer`.
 */
export function carriesWebContext(request: HTTPRequest): boolean {
  const { headers } = request;
  if (headerValues(headers, 'origin').length > 0) return true;
  if (headerValues(headers, 'referer').length > 0) return true;
  return headerValues(headers, 'sec-fetch-site').some(
    (site) => site.trim().toLowerCase() !== 'none'
  );
}

/**
 * The loopback exemption: a loopback peer, no web context, and a loopback `Host`.
 *
 * The server sends `Access-Control-Allow-Origin: *` on an admitted route, so
 * without the web rule any page in the phone's browser could drive the app through
 * 127.0.0.1. A missing address is never loopback.
 */
export function isTrustedLoopbackRequest(request: HTTPRequest): boolean {
  if (!request.remoteAddress || !isLoopbackAddress(request.remoteAddress)) return false;
  if (carriesWebContext(request)) return false;
  const hosts = headerValues(request.headers, 'host');
  return hosts.length > 0 && hosts.every(isLoopbackHost);
}

/**
 * What `allowUnauthenticatedNetwork` still refuses. It trusts the network, and a
 * page in a browser on that network is not the network.
 */
export function isWebReachableRequest(request: HTTPRequest): boolean {
  if (carriesWebContext(request)) return true;
  const hosts = headerValues(request.headers, 'host');
  return hosts.length === 0 || !hosts.every(isUnrebindableHost);
}

/** Bound a store call, so a hung one reads as a failure rather than a hang. */
async function bounded<T>(work: () => T | Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('store call timed out')), STORE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** The result of checking a signature. */
export type SignatureVerdict =
  | 'valid'
  | 'refused'
  /** Outside the window or below the floor, which re-syncing cures and re-pairing does not. */
  | 'timestamp_refused'
  | 'body_too_large'
  | 'target_too_long'
  | 'store_unavailable'
  /** The store loaded but holds an empty or non-string value; a revoke replaces it. */
  | 'token_unusable'
  /** A revoke failed and none has succeeded since, so the old token may still be stored. */
  | 'pairing_suspended'
  /** This peer's last signature failed and its backoff has not ended. Nothing was hashed. */
  | 'peer_backoff';

/** The result of a pair call. */
export type PairOutcome =
  | { ok: true; token: string }
  | {
      ok: false;
      code:
        | 'PAIRING_NOT_ARMED'
        | 'PAIRING_CODE_REQUIRED'
        | 'PAIRING_CODE_INVALID'
        | 'PAIRING_UNAVAILABLE';
      error: string;
    };

const UNAVAILABLE: PairOutcome = {
  ok: false,
  code: 'PAIRING_UNAVAILABLE',
  error: 'The pairing store is not available yet. Try again.',
};

/** Why pairing refuses while a failed revoke has the store suspect. */
export const PAIRING_SUSPENDED_MESSAGE =
  'Pairing is suspended until a revoke succeeds on the device.';

/** Why a revoke rejects when the app switched stores under it. */
export const PAIRING_STORE_CHANGED_MESSAGE =
  'The pairing store changed during the revoke, so the old token may remain. Revoke again.';

/**
 * Why pairing refuses while the store holds an empty or non-string value. Unlike
 * a store that has not loaded, waiting never cures this: a revoke does.
 */
export const PAIRING_TOKEN_UNUSABLE_MESSAGE =
  'The stored pairing token is unusable. Revoke pairing on the device to replace it.';

const TOKEN_UNUSABLE_OUTCOME: PairOutcome = {
  ok: false,
  code: 'PAIRING_UNAVAILABLE',
  error: PAIRING_TOKEN_UNUSABLE_MESSAGE,
};

const SUSPENDED: PairOutcome = {
  ok: false,
  code: 'PAIRING_UNAVAILABLE',
  error: PAIRING_SUSPENDED_MESSAGE,
};

const TOKEN_NOT_LOADED = Symbol('token-not-loaded');
/** The store loaded, but what it holds is empty or not a string, so it never verifies. */
const TOKEN_UNUSABLE = Symbol('token-unusable');
/** The store may still hold a token a revoke was asked to kill. */
const TOKEN_SUSPECT = Symbol('token-suspect');

const SUSPECT_STORES_KEY: unique symbol = Symbol.for(
  '@qontinui/ui-bridge-native.suspect-pairing-stores'
);

/**
 * Stores a revoke failed on, in a way that may have left the old token in place.
 * Keyed to the store, not the server: a provider rebuilds its server over the
 * same store object, and the rebuilt one must not trust the old token either.
 * Only a successful revoke clears an entry. A process restart clears them all.
 * Held on `globalThis`, because the build inlines this module into every entry
 * point, and a provider from one entry may drive a server from another.
 */
const suspectStores: WeakMap<object, true> = (() => {
  const registry = globalThis as typeof globalThis & { [SUSPECT_STORES_KEY]?: unknown };
  const existing = registry[SUSPECT_STORES_KEY];
  if (existing === undefined) {
    const created = new WeakMap<object, true>();
    registry[SUSPECT_STORES_KEY] = created;
    return created;
  }
  // Anything else under the key would make every suspicion check meaningless,
  // so refuse to load rather than trust or replace it.
  if (!(existing instanceof WeakMap)) {
    throw new Error(
      "@qontinui/ui-bridge-native: globalThis[Symbol.for('@qontinui/ui-bridge-native.suspect-pairing-stores')] " +
        'holds something other than a WeakMap, so failed revokes cannot be tracked. Refusing to load.'
    );
  }
  return existing as WeakMap<object, true>;
})();

/**
 * The objects a store's suspicion is kept against: the store itself and, for a
 * forwarding wrapper, the app's store behind it. Both, because each covers a
 * case the other misses: the wrapper outlives an app passing a fresh object on
 * every render, and the app's object outlives a remounted provider's wrapper.
 */
function suspicionKeys(store: PairingStore): object[] {
  let host: unknown;
  try {
    host = store[PAIRING_STORE_IDENTITY]?.();
  } catch {
    host = undefined;
  }
  // A primitive cannot key a WeakMap, and `set` would throw a TypeError in
  // place of the revoke's own PairingError.
  const usable = (typeof host === 'object' && host !== null) || typeof host === 'function';
  return usable && host !== store ? [store, host as object] : [store];
}

interface ArmedCode {
  code: string;
  expiresAt: number;
  /** The same moment on the monotonic clock, which a clock set back cannot move. */
  monotonicDeadline: number | null;
  wrongAttempts: number;
}

/**
 * The state behind one server's pairing: the live code, the nonce cache and the
 * lock over token writes. All of it is in memory, by design for the code.
 */
export class PairingAuthority {
  private armedCode: ArmedCode | null = null;
  /** A correct code waiting on the store step, restored if that step fails. */
  private heldCode: ArmedCode | null = null;
  private disarmReason: PairingDisarmReason | null = null;
  private consumedBy: string | null = null;
  private consumedAt: number | null = null;
  private lastWrite: Promise<unknown> = Promise.resolve();
  /** Nonce to its timestamp, oldest insertion first. */
  private nonces = new Map<string, number>();
  /**
   * The oldest timestamp still accepted. A nonce this process did not record
   * cannot be checked for a replay, so a signature from before it existed is
   * refused: otherwise an app restart, which empties the cache, would reopen
   * the whole window to a captured request. Eviction raises it for the same
   * reason. A clock step re-bases it to the new now, or a clock set back past it
   * would refuse every signature until the app restarted. That leaves one gap with
   * two arms: a request captured before a step back can replay once, if its
   * timestamp is at or above the new now and this process does not remember its
   * nonce, because it has forgotten it, or because the app restarted since and it
   * never recorded it. Without `performance.now` no step is seen, and the floor
   * holds until the clock passes it.
   */
  private oldestAcceptedTs = Date.now();
  /**
   * The wall clock minus the monotonic clock at the last re-base. It moves only
   * then, so small steps add up until they cross the tolerance, and a clock step
   * leaves the floor at most twice the tolerance ahead of the clock: the clock can
   * swing from just over the baseline to just under it without crossing it.
   */
  private clockOffset = this.readClockOffset();
  /** Moves when a revoke ends, so a read of the old token that spans one cannot admit. */
  private tokenGeneration = 0;
  /** Revokes under way. The old token may already be dying, so nothing verifies. */
  private revokesInFlight = 0;
  /** Peer to its failure count and the instant its backoff ends, oldest insertion first. */
  private backoff = new Map<string, { failures: number; until: number }>();

  constructor(private readonly store: PairingStore) {}

  /**
   * The stored token, `null` when there is none, `TOKEN_NOT_LOADED`,
   * `TOKEN_UNUSABLE`, or `TOKEN_SUSPECT` while a failed revoke has the store
   * suspect. Only `readStore` tells the first four apart: an empty or
   * non-string value is never a token, because an empty key would verify
   * anything signed with it.
   */
  private async readToken(): Promise<
    string | null | typeof TOKEN_NOT_LOADED | typeof TOKEN_UNUSABLE | typeof TOKEN_SUSPECT
  > {
    // A failed revoke elsewhere can land during the read, so each caller checks
    // again at the point it admits.
    return this.isSuspect() ? TOKEN_SUSPECT : this.readStore();
  }

  /** Whether a failed revoke, on this server or another over the same store, stands. */
  private isSuspect(): boolean {
    return suspicionKeys(this.store).some((key) => suspectStores.has(key));
  }

  /**
   * Only a `get` that throws means not loaded. A value that resolved but is empty
   * or not a string is `TOKEN_UNUSABLE`: it never verifies, and a revoke is what
   * replaces it, so callers say so instead of "try again".
   */
  private async readStore(): Promise<
    string | null | typeof TOKEN_NOT_LOADED | typeof TOKEN_UNUSABLE
  > {
    let token: unknown;
    try {
      token = await bounded(() => this.store.get());
    } catch {
      return TOKEN_NOT_LOADED;
    }
    if (token === null) return null;
    return typeof token === 'string' && token.length > 0 ? token : TOKEN_UNUSABLE;
  }

  private async randomBytes(n: number): Promise<Uint8Array> {
    const unusable = new PairingError(
      'PAIRING_UNAVAILABLE',
      'The secure random source returned no usable bytes.'
    );
    let bytes: Uint8Array;
    try {
      bytes = await bounded(() => this.store.randomBytes(n));
    } catch {
      throw unusable;
    }
    if (!ArrayBuffer.isView(bytes) || bytes.length !== n || bytes.every((byte) => byte === 0)) {
      throw unusable;
    }
    return bytes;
  }

  /**
   * Mint and persist a token. `onWrite` gets the suspicion keys resolved inside
   * the store call, the moment a forwarding wrapper picks the store it writes to.
   */
  private async mintAndStoreToken(onWrite?: (keys: object[]) => void): Promise<string> {
    const token = bytesToHex(await this.randomBytes(TOKEN_BYTES));
    await bounded(() => {
      onWrite?.(suspicionKeys(this.store));
      return this.store.set(token);
    });
    return token;
  }

  /** Run token writes one at a time, so two first pairs cannot mint two tokens. */
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = this.lastWrite.then(work, work);
    this.lastWrite = run.catch(() => undefined);
    return run;
  }

  /** Check a `<ts>.<nonce>.<sig>` value against this request and the stored token. */
  async verifySignature(request: HTTPRequest, header: string): Promise<SignatureVerdict> {
    // No address means no peer to back off: a shared key would let one bad request
    // lock out every signed client.
    const peer = request.remoteAddress ? request.remoteAddress : null;
    // First of all: a peer that just failed a signature is not hashed again until
    // its backoff ends, so this costs it nothing but a map read.
    if (peer !== null && this.backoffRemainingMs(peer) > 0) return 'peer_backoff';
    // Everything before the store read is free for this phone, and comes first
    // because a peer that has proved nothing can reach all of it.
    const match = SIGNATURE_HEADER_PATTERN.exec(header);
    if (!match) return 'refused';
    const [, ts, nonce, sig] = match;
    const tsMs = Number(ts);
    this.noticeClockStep();
    if (Math.abs(Date.now() - tsMs) > SIGNATURE_WINDOW_MS) return 'timestamp_refused';
    if (tsMs < this.oldestAcceptedTs) return 'timestamp_refused';

    const pathAndQuery = signedTarget(request);
    const body = signedBody(request);
    if (pathAndQuery === null || body === null) return 'refused';
    if (body.length > SIGNED_BODY_MAX_CHARS) return 'body_too_large';
    if (request.method.length > SIGNED_METHOD_MAX_CHARS) return 'target_too_long';
    if (pathAndQuery.length > SIGNED_TARGET_MAX_CHARS) return 'target_too_long';

    const generation = this.tokenGeneration;
    const token = await this.readToken();
    // The read yielded, so requests that were all in flight together passed the
    // check above before any of them failed. Looking again is what stops the
    // queued ones hashing once the first has recorded its failure.
    if (peer !== null && this.backoffRemainingMs(peer) > 0) return 'peer_backoff';
    if (this.revokesInFlight > 0) return 'refused';
    if (token === TOKEN_SUSPECT) return 'pairing_suspended';
    if (token === TOKEN_NOT_LOADED) return 'store_unavailable';
    if (token === TOKEN_UNUSABLE) return 'token_unusable';
    if (token === null) return 'refused';

    const expected = signatureHex(token, { method: request.method, pathAndQuery, ts, nonce, body });
    if (!constantTimeEqual(expected, sig)) {
      if (peer !== null) this.recordSignatureFailure(peer);
      return 'refused';
    }

    // Checked with no await before the insert, so a revoke that finished during
    // the read wins, and two copies of one request arriving together cannot both
    // pass.
    if (generation !== this.tokenGeneration) return 'refused';
    // The generation is this server's; a revoke that failed on another server
    // over the same store during the read shows only here.
    if (this.isSuspect()) return 'pairing_suspended';
    if (this.nonces.has(nonce)) return 'refused';
    this.rememberNonce(nonce, tsMs);
    if (peer !== null) this.backoff.delete(peer);
    return 'valid';
  }

  /**
   * The header checks that need no body, token or store, for a refusal before the
   * body is read. `null` means "read the body and ask `verifySignature`", never
   * "admitted": nothing here looks at the token.
   */
  preflightSignature(
    peerAddress: string | undefined,
    header: string,
    declaredBodyBytes: number | undefined
  ): SignatureVerdict | null {
    if (peerAddress && this.backoffRemainingMs(peerAddress) > 0) return 'peer_backoff';
    const match = SIGNATURE_HEADER_PATTERN.exec(header);
    if (!match) return 'refused';
    const tsMs = Number(match[1]);
    this.noticeClockStep();
    if (Math.abs(Date.now() - tsMs) > SIGNATURE_WINDOW_MS) return 'timestamp_refused';
    if (tsMs < this.oldestAcceptedTs) return 'timestamp_refused';
    // The header counts bytes and the cap counts UTF-16 units, which take one to
    // three bytes each in UTF-8: only a count past three bytes a unit is sure to
    // be over the cap. Anything between waits for the body.
    if (declaredBodyBytes !== undefined && declaredBodyBytes > SIGNED_BODY_MAX_CHARS * 3) {
      return 'body_too_large';
    }
    return null;
  }

  /** Whole seconds, rounded up, until this peer may be hashed again; 0 when it is not backed off. */
  backoffRetryAfterSeconds(peerAddress: string | undefined): number {
    return peerAddress ? Math.ceil(this.backoffRemainingMs(peerAddress) / 1000) : 0;
  }

  private backoffRemainingMs(peer: string): number {
    const entry = this.backoff.get(peer);
    if (!entry) return 0;
    const remaining = entry.until - Date.now();
    // A clock set back would stretch the wait; no wait is longer than the cap.
    return remaining > SIGNATURE_BACKOFF_MAX_MS ? SIGNATURE_BACKOFF_MAX_MS : Math.max(0, remaining);
  }

  /** The signature was well formed and in the window, and wrong. */
  private recordSignatureFailure(peer: string): void {
    const now = Date.now();
    const previous = this.backoff.get(peer);
    // A peer quiet for several caps starts over rather than inheriting a long wait.
    const stale = previous !== undefined && now - previous.until > SIGNATURE_BACKOFF_MAX_MS * 10;
    const failures = previous === undefined || stale ? 1 : previous.failures + 1;
    const wait = Math.min(
      SIGNATURE_BACKOFF_BASE_MS * 2 ** Math.min(failures - 1, 16),
      SIGNATURE_BACKOFF_MAX_MS
    );
    // Delete first so the entry moves to the newest end of the insertion order.
    this.backoff.delete(peer);
    this.backoff.set(peer, { failures, until: now + wait });
    while (this.backoff.size > SIGNATURE_BACKOFF_PEERS_MAX) {
      const oldest = this.backoff.keys().next().value as string;
      this.backoff.delete(oldest);
    }
  }

  private readClockOffset(): number | null {
    const monotonic = monotonicNow();
    return monotonic === null ? null : Date.now() - monotonic;
  }

  /**
   * Re-base the floor when the wall clock has stepped against the monotonic one.
   * A nonce remembered from above the new now is clamped to just below the new
   * floor. Left as it is, forgetting it later would raise the floor back to a time
   * before the step, and the lockout would return when the cache overflowed.
   */
  private noticeClockStep(): void {
    const offset = this.readClockOffset();
    if (offset === null || this.clockOffset === null) return;
    if (Math.abs(offset - this.clockOffset) > CLOCK_STEP_TOLERANCE_MS) {
      this.clockOffset = offset;
      this.oldestAcceptedTs = Date.now();
      for (const [nonce, tsMs] of this.nonces) {
        if (tsMs >= this.oldestAcceptedTs) this.nonces.set(nonce, this.oldestAcceptedTs - 1);
      }
    }
  }

  private rememberNonce(nonce: string, tsMs: number): void {
    if (this.nonces.size >= NONCE_CACHE_MAX) {
      const now = Date.now();
      for (const [seen, seenTs] of this.nonces) {
        if (seenTs + SIGNATURE_WINDOW_MS < now) this.forgetNonce(seen, seenTs);
      }
    }
    while (this.nonces.size >= NONCE_CACHE_MAX) {
      const [seen, seenTs] = this.nonces.entries().next().value as [string, number];
      this.forgetNonce(seen, seenTs);
    }
    this.nonces.set(nonce, tsMs);
  }

  /** Forgetting a nonce must not readmit it, so its timestamp stops being accepted. */
  private forgetNonce(nonce: string, tsMs: number): void {
    this.nonces.delete(nonce);
    this.oldestAcceptedTs = Math.max(this.oldestAcceptedTs, tsMs + 1);
  }

  /**
   * The route's decision. A trusted loopback caller needs no code. Anyone else
   * spends the armed code, and an unarmed one refuses without comparing.
   */
  async pair(input: {
    trustedLoopback: boolean;
    peer: string | undefined;
    body: unknown;
  }): Promise<PairOutcome> {
    if (!input.trustedLoopback) {
      const refusal = this.spendCode(input.body);
      if (refusal) return refusal;
    }
    const spent = input.trustedLoopback ? null : this.heldCode;
    let outcome = await this.exclusive(async (): Promise<PairOutcome> => {
      const existing = await this.readToken();
      if (existing === TOKEN_SUSPECT) return SUSPENDED;
      if (existing === TOKEN_NOT_LOADED) return UNAVAILABLE;
      if (existing === TOKEN_UNUSABLE) return TOKEN_UNUSABLE_OUTCOME;
      if (existing !== null) return { ok: true, token: existing };
      try {
        return { ok: true, token: await this.mintAndStoreToken() };
      } catch {
        return this.isSuspect() ? SUSPENDED : UNAVAILABLE;
      }
    });
    // A revoke on another server over the same store may have failed during the
    // read or the mint; the token is then not ours to hand out.
    if (outcome.ok && this.isSuspect()) outcome = SUSPENDED;
    // A peer that has just paired holds a fresh token, so its old failures are moot.
    // A cable pair is the owner at the phone: every address's failures are moot,
    // since a runner re-paired that way signs from an address that never paired itself.
    if (outcome.ok) {
      if (input.trustedLoopback) this.backoff.clear();
      else if (input.peer) this.backoff.delete(input.peer);
    }
    if (spent) this.settleSpentCode(spent, outcome.ok, input.peer);
    return outcome;
  }

  /**
   * The store step has answered. A failure gives the code back, since the user
   * typed the right one and the phone let them down, unless the app has since
   * cancelled it or armed another.
   */
  private settleSpentCode(spent: ArmedCode, paired: boolean, peer: string | undefined): void {
    const stillHeld = this.heldCode === spent;
    if (stillHeld) this.heldCode = null;
    if (paired) {
      if (stillHeld) this.disarmReason = 'consumed';
      this.consumedBy = peer ?? 'unknown';
      this.consumedAt = Date.now();
    } else if (stillHeld) {
      // Every read of the code checks its expiry first, so one that ran out stays out.
      this.armedCode = spent;
    }
  }

  /** No await in here: the attempt count has to move with the comparison. */
  private spendCode(body: unknown): PairOutcome | null {
    this.expireCode();
    const armed = this.armedCode;
    if (!armed) {
      return {
        ok: false,
        code: 'PAIRING_NOT_ARMED',
        error: 'No pairing code is armed. Arm one in the app, or pair over a cable.',
      };
    }
    const code = (body as { code?: unknown } | null | undefined)?.code;
    // A malformed value cannot be a guess, so it spends nothing.
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      return {
        ok: false,
        code: 'PAIRING_CODE_REQUIRED',
        error: 'Send the 6-digit code shown in the app, as { "code": "123456" }.',
      };
    }
    if (constantTimeEqual(armed.code, code)) {
      this.armedCode = null;
      this.heldCode = armed;
      return null;
    }
    armed.wrongAttempts += 1;
    if (armed.wrongAttempts >= PAIRING_CODE_MAX_ATTEMPTS) {
      this.armedCode = null;
      this.disarmReason = 'attempts_exhausted';
    }
    return { ok: false, code: 'PAIRING_CODE_INVALID', error: 'That code is not correct.' };
  }

  /** Either clock ends the code, so a clock set back cannot extend it. */
  private expireCode(): void {
    if (!this.armedCode) return;
    const { expiresAt, monotonicDeadline } = this.armedCode;
    const monotonic = monotonicNow();
    const monotonicExpired =
      monotonic !== null && monotonicDeadline !== null && monotonic >= monotonicDeadline;
    if (Date.now() >= expiresAt || monotonicExpired) {
      this.armedCode = null;
      this.disarmReason = 'expired';
    }
  }

  /** Arm a fresh code, replacing any live one. */
  async arm(): Promise<ArmedPairingCode> {
    const stored = await this.readToken();
    if (stored === TOKEN_SUSPECT) {
      throw new PairingError('PAIRING_UNAVAILABLE', PAIRING_SUSPENDED_MESSAGE);
    }
    if (stored === TOKEN_NOT_LOADED) {
      throw new PairingError('PAIRING_UNAVAILABLE', 'The pairing store is not available yet.');
    }
    if (stored === TOKEN_UNUSABLE) {
      throw new PairingError('PAIRING_UNAVAILABLE', PAIRING_TOKEN_UNUSABLE_MESSAGE);
    }
    const code = await this.drawCode();
    // A revoke on another server over the same store may have failed during the
    // read or the draw.
    if (this.isSuspect()) {
      throw new PairingError('PAIRING_UNAVAILABLE', PAIRING_SUSPENDED_MESSAGE);
    }
    const expiresAt = Date.now() + PAIRING_CODE_TTL_MS;
    const monotonic = monotonicNow();
    this.armedCode = {
      code,
      expiresAt,
      monotonicDeadline: monotonic === null ? null : monotonic + PAIRING_CODE_TTL_MS,
      wrongAttempts: 0,
    };
    this.heldCode = null;
    this.disarmReason = null;
    this.consumedBy = null;
    this.consumedAt = null;
    return { code, expiresAt };
  }

  /** A uniform 6-digit code, by rejection sampling so that no digit is favoured. */
  private async drawCode(): Promise<string> {
    for (let attempt = 0; attempt < CODE_SAMPLE_ATTEMPTS; attempt++) {
      const bytes = await this.randomBytes(4);
      const value = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0);
      if (value < CODE_SAMPLE_LIMIT) return String(value % 1_000_000).padStart(6, '0');
    }
    throw new PairingError(
      'PAIRING_UNAVAILABLE',
      'The secure random source returned no usable bytes.'
    );
  }

  /** Cancel a live code. */
  disarm(): void {
    this.dropCode('cancelled');
  }

  private dropCode(reason: PairingDisarmReason): void {
    if (this.armedCode || this.heldCode) {
      this.armedCode = null;
      this.heldCode = null;
      this.disarmReason = reason;
    }
  }

  /**
   * Replace the token, so every signature made with the old one stops verifying.
   * If it cannot be replaced it is cleared. If that fails too, or the store
   * cannot even be read, signatures and pairing stay refused until a revoke
   * succeeds: the user asked for the old token to die, and a store that would
   * not say so cannot be trusted to have done it. The refusal is kept per store
   * (and per app store behind a provider's wrapper), so a rebuilt server or a
   * remounted provider over the same store keeps it.
   *
   * Behind a wrapper, the app can switch stores while this runs. Only the store
   * the successful store call reached is cleared; every other one seen behind
   * the wrapper (at the start, at each store call, at the end) is marked, since
   * its old token was never replaced. If any key of the store this forwards to
   * when it ends is still suspect after that, this rejects, so the app is not
   * told a revoke worked while pairing stays suspended. Usually that means the
   * app changed stores during the revoke; it can also be a failed revoke on
   * another server over the same store.
   *
   * A stored value that is empty or not a string never verifies, but the store
   * that returned it has loaded: only a `get` that throws means it has not. So a
   * revoke over such a value replaces it like any other token, and that is how
   * a store left holding one recovers.
   *
   * Nothing verifies from the moment this starts until it ends. The generation
   * moves when it ends, whichever way, so a check that read the old token before
   * then cannot admit its request afterwards. A request a check has already
   * admitted runs to its end.
   */
  async revoke(): Promise<void> {
    // Keys are resolved inside each store call, where a forwarding wrapper picks
    // its target, never before or after it: the app may switch stores while the
    // call is pending. A failure marks every key the revoke saw. A store call
    // that succeeds clears exactly the keys it reached and marks every other key
    // the revoke saw, since the old token there was never replaced.
    const startKeys = suspicionKeys(this.store);
    const touched: object[] = [];
    let reached: object[] = [];
    const atStoreCall = (keys: object[]) => {
      touched.push(...keys);
      reached = keys;
    };
    /** Behind the wrapper at the start, at each store call, and now. */
    const everyKeySeen = () => [...startKeys, ...touched, ...suspicionKeys(this.store)];
    const markSuspect = () => everyKeySeen().forEach((key) => suspectStores.set(key, true));
    const settle = () => {
      reached.forEach((key) => suspectStores.delete(key));
      everyKeySeen()
        .filter((key) => !reached.includes(key))
        .forEach((key) => suspectStores.set(key, true));
    };
    this.revokesInFlight += 1;
    this.dropCode('revoked');
    try {
      await this.exclusive(async () => {
        // `readStore`, not `readToken`: a revoke is how a suspect store recovers.
        // Only not-loaded stops it; an unusable value is replaced below.
        if ((await this.readStore()) === TOKEN_NOT_LOADED) {
          // The app is told the revoke failed, so the old token must not verify
          // once reads recover. Writing anyway is no fix: what a write made before
          // the store loads does is not in the contract, and could be undone.
          markSuspect();
          throw new PairingError('PAIRING_UNAVAILABLE', 'The pairing store is not available yet.');
        }
        let replaced = true;
        try {
          await this.mintAndStoreToken(atStoreCall);
        } catch {
          replaced = false;
          try {
            await bounded(() => {
              atStoreCall(suspicionKeys(this.store));
              return this.store.clear();
            });
          } catch {
            markSuspect();
            throw new PairingError(
              'PAIRING_UNAVAILABLE',
              'The pairing token could not be replaced.'
            );
          }
        }
        settle();
        if (this.isSuspect()) {
          throw new PairingError('PAIRING_UNAVAILABLE', PAIRING_STORE_CHANGED_MESSAGE);
        }
        if (!replaced) {
          throw new PairingError('PAIRING_UNAVAILABLE', 'The pairing token could not be replaced.');
        }
      });
    } finally {
      this.revokesInFlight -= 1;
      this.tokenGeneration += 1;
    }
  }

  /** What Settings shows. */
  getState(): PairingState {
    this.expireCode();
    return {
      configured: true,
      armed: this.armedCode !== null,
      expiresAt: this.armedCode?.expiresAt ?? null,
      attemptsRemaining: this.armedCode
        ? PAIRING_CODE_MAX_ATTEMPTS - this.armedCode.wrongAttempts
        : null,
      consumedBy: this.consumedBy,
      consumedAt: this.consumedAt,
      disarmReason: this.disarmReason,
    };
  }
}

/** The state of a server with no store. */
export const UNCONFIGURED_PAIRING_STATE: PairingState = {
  configured: false,
  armed: false,
  expiresAt: null,
  attemptsRemaining: null,
  consumedBy: null,
  consumedAt: null,
  disarmReason: null,
};

/**
 * The request target the signature covers, or null when it cannot be told or
 * disagrees with the path being routed. Rebuilding it from a parsed query would
 * not reproduce the signer's bytes, so only a target with no query can be
 * inferred.
 */
function signedTarget(request: HTTPRequest): string | null {
  if (request.rawTarget === undefined) {
    return Object.keys(request.query ?? {}).length === 0 ? request.path : null;
  }
  const queryAt = request.rawTarget.indexOf('?');
  const path = queryAt === -1 ? request.rawTarget : request.rawTarget.slice(0, queryAt);
  return path === request.path ? request.rawTarget : null;
}

/** The body bytes the signature covers, or null when a parsed body has no raw form to check. */
function signedBody(request: HTTPRequest): string | null {
  if (request.rawBody !== undefined) return request.rawBody;
  return request.body === undefined ? '' : null;
}
