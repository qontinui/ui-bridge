/**
 * The relay's own traffic — the exact endpoints a relay client talks to under
 * its base path (`relay-client.ts`):
 *
 *   GET  `{basePath}/commands/stream`  (SSE connect)
 *   POST `{basePath}/commands`         (result envelope)
 *   POST `{basePath}/heartbeat`
 *
 * The relay dispatcher's network adapters (its interaction timeline and its
 * idle detector) drop requests {@link isRelayOwnTraffic} matches, so the
 * transport carrying a command never shows up as the page's network activity
 * nor holds the idle detector busy. The match is an EXACT endpoint predicate
 * — same origin and one of those three pathnames — never a substring, so an
 * app route that merely contains the base path is still recorded.
 *
 * globalThis-backed so every bundle copy of this module (and an HMR reload)
 * shares one registry.
 */

interface RelayTrafficStore {
  bases: Set<string>;
}

function store(): RelayTrafficStore {
  const g = globalThis as unknown as { __UI_BRIDGE_RELAY_TRAFFIC__?: RelayTrafficStore };
  if (!g.__UI_BRIDGE_RELAY_TRAFFIC__) g.__UI_BRIDGE_RELAY_TRAFFIC__ = { bases: new Set() };
  return g.__UI_BRIDGE_RELAY_TRAFFIC__;
}

/** The endpoint suffixes `relay-client.ts` uses under its base path. */
const RELAY_ENDPOINTS = ['/commands/stream', '/commands', '/heartbeat'] as const;

/** Record a base path (relative or absolute) a relay client sends to. Idempotent. */
export function registerRelayTrafficBase(base: string): void {
  if (typeof base !== 'string' || base.length === 0) return;
  store().bases.add(base);
}

/** Every relay base registered so far. */
export function getRelayTrafficBases(): string[] {
  return [...store().bases];
}

function resolve(url: string): URL | null {
  try {
    const href =
      typeof location !== 'undefined' && typeof location.href === 'string' && location.href
        ? location.href
        : undefined;
    return href ? new URL(url, href) : new URL(url);
  } catch {
    return null;
  }
}

/**
 * Whether `url` is one of a registered relay client's own endpoints: same
 * origin as the resolved base, and a pathname of exactly
 * `{base}/commands/stream`, `{base}/commands` or `{base}/heartbeat`. The
 * query string is ignored (the SSE connect carries `?tabId=`).
 */
export function isRelayOwnTraffic(url: string): boolean {
  const bases = store().bases;
  if (bases.size === 0) return false;
  const req = resolve(url);
  if (!req) return false;
  for (const base of bases) {
    const b = resolve(base);
    if (!b || b.origin !== req.origin) continue;
    const prefix = b.pathname.replace(/\/+$/, '');
    if (RELAY_ENDPOINTS.some((endpoint) => req.pathname === `${prefix}${endpoint}`)) return true;
  }
  return false;
}

/** Test-only: forget every registered base. */
export function __clearRelayTrafficForTest(): void {
  store().bases.clear();
}
