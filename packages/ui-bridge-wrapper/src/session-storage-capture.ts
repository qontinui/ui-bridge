/**
 * sessionStorage capture-side helper for `ui-bridge-login-web --storage-state-out`.
 *
 * Playwright's `storageState` captures only cookies + localStorage — never
 * sessionStorage. Apps that keep their auth token in sessionStorage
 * (qontinui-web stores `auth_bearer_access_token` there) therefore lose auth on
 * a cold `ui-bridge-inject --storage-state` replay. To close the gap we fold the
 * authed page's sessionStorage into the artifact under a custom top-level
 * `__sessionStorage` key (origin → key/value map). The launcher
 * (@qontinui/ui-bridge-headless) strips that key before `newContext` and
 * replays it via an init-script.
 *
 * This merge helper is local to the wrapper (rather than imported from the
 * optional `@qontinui/ui-bridge-headless` peer) so it carries NO static
 * dependency on that peer — a `--help` invocation of the bin must not eagerly
 * resolve a package an api-only consumer never installed. It is a pure function
 * so it is unit-tested without a browser. The launcher owns the symmetric
 * restore-side `splitSessionStorageArtifact`.
 */

/** A single origin's sessionStorage as a flat key→value map. */
export type SessionStorageKV = Record<string, string>;

/** origin → its sessionStorage key→value map. */
export type SessionStorageMap = Record<string, SessionStorageKV>;

/** The custom top-level key under which sessionStorage rides in the artifact. */
export const SESSION_STORAGE_KEY = '__sessionStorage';

/** A Playwright `storageState` artifact, possibly extended with `__sessionStorage`. */
export interface StorageStateArtifact {
  cookies?: unknown;
  origins?: unknown;
  __sessionStorage?: SessionStorageMap;
  [key: string]: unknown;
}

/**
 * Fold a captured sessionStorage map for `origin` into the parsed storageState
 * `artifact`, returning the SAME object (mutated) for convenience. Only the
 * supplied origin's entry is set/overwritten; sessionStorage already recorded
 * for OTHER origins is preserved. Backward-compatible: a legacy artifact gains
 * the new key without disturbing cookies/origins.
 */
export function mergeSessionStorageIntoArtifact(
  artifact: StorageStateArtifact,
  origin: string,
  kv: SessionStorageKV
): StorageStateArtifact {
  const existing =
    artifact.__sessionStorage && typeof artifact.__sessionStorage === 'object'
      ? artifact.__sessionStorage
      : {};
  artifact.__sessionStorage = { ...existing, [origin]: { ...kv } };
  return artifact;
}

/** True for a usable, network-scheme origin we can key a sessionStorage map by. */
function isCapturableOrigin(origin: string | null | undefined): origin is string {
  // `new URL('about:blank').origin === 'null'`; data:/blob:/sandboxed frames are
  // likewise opaque (the string 'null') or empty. sessionStorage is partitioned
  // by origin, so an opaque origin can never be the target of a restore lookup —
  // skip it.
  return typeof origin === 'string' && origin.length > 0 && origin !== 'null';
}

/**
 * Derive the origin to key a frame's sessionStorage by from its URL. Returns
 * `null` for `about:blank`, opaque (`data:`/`blob:`/sandboxed), or unparseable
 * URLs — callers skip those frames.
 */
export function frameOrigin(frameUrl: string): string | null {
  try {
    const origin = new URL(frameUrl).origin;
    return isCapturableOrigin(origin) ? origin : null;
  } catch {
    return null;
  }
}

/** One frame's capture: its URL plus the sessionStorage it yielded (or null when access threw). */
export interface FrameSessionStorage {
  url: string;
  /** The frame's sessionStorage, or `null` when the `evaluate` threw (cross-origin/restricted). */
  kv: SessionStorageKV | null;
}

/**
 * Build a multi-origin `{ origin -> kv }` map from per-frame captures (the
 * result of iterating `page.frames()` and reading each frame's sessionStorage).
 *
 * Rules — keep these consistent with the restore side (`location.origin` lookup):
 *   - Frames whose origin is opaque/empty/`about:blank`, or whose capture threw
 *     (`kv === null`), are skipped.
 *   - Multiple frames sharing one origin are MERGED into that origin's single
 *     entry. Merge order follows input order and **LATER frames' keys win** on a
 *     key collision (last-write-wins) — same-origin frames share one
 *     sessionStorage partition in the browser, so collisions should carry the
 *     same value anyway; last-write-wins is the deterministic tie-break.
 *
 * Pure + browser-free so it is unit-tested directly.
 */
export function buildMultiOriginSessionStorageMap(
  frames: readonly FrameSessionStorage[]
): SessionStorageMap {
  const out: SessionStorageMap = {};
  for (const frame of frames) {
    if (frame.kv === null) continue; // capture threw — skip
    const origin = frameOrigin(frame.url);
    if (origin === null) continue; // opaque/about:blank — skip
    out[origin] = { ...(out[origin] ?? {}), ...frame.kv }; // last-write-wins per key
  }
  return out;
}

/**
 * Fold a whole multi-origin sessionStorage map into the artifact, preserving any
 * origins already recorded that are NOT present in `map`. For each origin in
 * `map`, that origin's entry is set/overwritten (same per-origin semantics as
 * {@link mergeSessionStorageIntoArtifact}, applied for each origin). Returns the
 * SAME (mutated) object. Backward-compatible: the `__sessionStorage` shape is
 * unchanged (origin → kv) — a single-origin map yields exactly the legacy shape.
 */
export function mergeMultiOriginSessionStorageIntoArtifact(
  artifact: StorageStateArtifact,
  map: SessionStorageMap
): StorageStateArtifact {
  const existing =
    artifact.__sessionStorage && typeof artifact.__sessionStorage === 'object'
      ? artifact.__sessionStorage
      : {};
  const merged: SessionStorageMap = { ...existing };
  for (const origin of Object.keys(map)) {
    merged[origin] = { ...map[origin] };
  }
  artifact.__sessionStorage = merged;
  return artifact;
}
