/**
 * sessionStorage parity for the Playwright `storageState` artifact.
 *
 * Playwright's native `storageState` captures only **cookies + localStorage** —
 * it has no sessionStorage support. Apps that keep their auth token in
 * sessionStorage (qontinui-web stores `auth_bearer_access_token` there) are
 * therefore NOT authenticated when a cold `ui-bridge-inject --storage-state`
 * seeds a fresh context: the artifact carries no sessionStorage, so the app
 * boots tokenless and bounces to `/login`.
 *
 * To close that gap we extend the artifact with a custom top-level key,
 * `__sessionStorage`, mapping `origin -> { key: value }`. This is purely
 * additive and backward-compatible: an artifact WITHOUT `__sessionStorage`
 * deserializes + restores exactly as before.
 *
 * Two pure helpers live here so they can be unit-tested without a browser:
 *   - {@link mergeSessionStorageIntoArtifact} — capture side (login-web-cli):
 *     fold a captured `{ key: value }` map for the landing origin into the
 *     storageState JSON that Playwright just wrote.
 *   - {@link splitSessionStorageArtifact} — restore side (launcher): pull the
 *     `__sessionStorage` map out and hand back a CLEANED storageState object
 *     safe to pass to `browser.newContext({ storageState })` (Playwright
 *     validates the schema and rejects unknown top-level keys).
 */

/** A single origin's sessionStorage as a flat key→value map. */
export type SessionStorageKV = Record<string, string>;

/** origin → its sessionStorage key→value map. */
export type SessionStorageMap = Record<string, SessionStorageKV>;

/**
 * A Playwright `storageState` artifact, possibly extended with the custom
 * `__sessionStorage` key. Modelled loosely (`unknown`-ish) because we only ever
 * read/write the one extra key — the rest is round-tripped verbatim.
 */
export interface StorageStateArtifact {
  cookies?: unknown;
  origins?: unknown;
  /** Custom extension: origin → sessionStorage map. Absent on legacy artifacts. */
  __sessionStorage?: SessionStorageMap;
  [key: string]: unknown;
}

/** The custom top-level key under which sessionStorage rides in the artifact. */
export const SESSION_STORAGE_KEY = '__sessionStorage';

/**
 * Capture side. Fold a captured sessionStorage map for `origin` into the parsed
 * storageState `artifact`, returning the SAME object (mutated) for convenience.
 *
 * Only the supplied origin's entry is set/overwritten; any sessionStorage
 * already recorded for OTHER origins is preserved. An empty `kv` still records
 * the origin (an empty map is a meaningful "this origin had no sessionStorage"
 * — distinct from "we never captured this origin").
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

/**
 * Restore side. Split a parsed storageState `artifact` into:
 *   - `storageState`: a CLEANED copy with `__sessionStorage` removed — safe to
 *     pass to `browser.newContext({ storageState })` (Playwright rejects the
 *     custom key, and passing the raw object/path would smuggle it through).
 *   - `sessionStorage`: the origin→KV map (or `null` when the artifact carried
 *     none — the legacy case, where the caller keeps its current behavior).
 *
 * The input is not mutated; a shallow clone is returned with the key deleted.
 */
export function splitSessionStorageArtifact(artifact: StorageStateArtifact): {
  storageState: Record<string, unknown>;
  sessionStorage: SessionStorageMap | null;
} {
  const raw = artifact.__sessionStorage;
  const sessionStorage =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as SessionStorageMap) : null;
  const cleaned: Record<string, unknown> = { ...artifact };
  delete cleaned[SESSION_STORAGE_KEY];
  return { storageState: cleaned, sessionStorage };
}

/**
 * The init-script body (as a function) that restores sessionStorage per-origin.
 * Registered via `context.addInitScript(restoreSessionStorageInitScript, map)`
 * so it runs in the page realm BEFORE any of the page's own scripts on EVERY
 * navigation — exactly when the app first reads its token. Per-origin because
 * sessionStorage is origin-scoped; idempotent `setItem`; cross-origin / sandboxed
 * frames that throw on `sessionStorage` access are ignored.
 */
export function restoreSessionStorageInitScript(map: SessionStorageMap): void {
  try {
    const kv = map[location.origin];
    if (kv) {
      for (const k in kv) {
        sessionStorage.setItem(k, kv[k]);
      }
    }
  } catch {
    /* cross-origin / restricted frame — ignore */
  }
}
