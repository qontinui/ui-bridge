/**
 * The relay's own traffic — the base paths a relay client talks to (SSE
 * connect, result POST, heartbeat). A NetworkRequestTracker the relay
 * dispatcher creates for itself ignores them, so the transport carrying a
 * command never shows up as the page's network activity in that command's
 * interaction timeline, nor holds its idle detector busy.
 *
 * globalThis-backed so every bundle copy of this module (and an HMR reload)
 * shares one registry.
 */

interface RelayTrafficStore {
  bases: Set<string>;
  listeners: Set<(base: string) => void>;
}

function store(): RelayTrafficStore {
  const g = globalThis as unknown as { __UI_BRIDGE_RELAY_TRAFFIC__?: RelayTrafficStore };
  if (!g.__UI_BRIDGE_RELAY_TRAFFIC__) {
    g.__UI_BRIDGE_RELAY_TRAFFIC__ = { bases: new Set(), listeners: new Set() };
  }
  return g.__UI_BRIDGE_RELAY_TRAFFIC__;
}

/** Record a base path (relative or absolute) the relay client sends to. Idempotent. */
export function registerRelayTrafficBase(base: string): void {
  if (typeof base !== 'string' || base.length === 0) return;
  const s = store();
  if (s.bases.has(base)) return;
  s.bases.add(base);
  for (const listener of s.listeners) listener(base);
}

/** Every relay base registered so far. */
export function getRelayTrafficBases(): string[] {
  return [...store().bases];
}

/**
 * Call `listener` for every base already registered and for each one
 * registered later; returns an unsubscribe function.
 */
export function onRelayTrafficBase(listener: (base: string) => void): () => void {
  const s = store();
  for (const base of s.bases) listener(base);
  s.listeners.add(listener);
  return () => s.listeners.delete(listener);
}
