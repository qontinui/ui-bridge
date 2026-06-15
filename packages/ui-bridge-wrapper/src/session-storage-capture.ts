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
