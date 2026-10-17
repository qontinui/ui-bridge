/**
 * `--throttle` — emulate a slow network on the driven page.
 *
 * Plan 2026-10-13-image-generation-and-visual-judgment, Phase 18 step 3: the
 * `/visual-audit` image arm OPERATES a candidate asset under a slow network
 * (how long the slot sits empty, whether the placeholder holds the layout)
 * rather than inspecting it once loaded. Chromium's network emulation is the
 * CDP `Network.emulateNetworkConditions` command, issued on a CDP session
 * attached to the page target; it persists across navigations of that target,
 * so a `captureTimeline {"reload":true}` re-load runs throttled.
 *
 * WHAT IS STAMPED. CDP has no getter for the emulated conditions, so the only
 * honest record is "Chromium accepted these numbers": {@link NetworkEmulation}
 * carries the numbers sent and `applied: true` only after the command resolved.
 * A command that failed is a thrown error, never a silently unthrottled run.
 */

import { InjectCliArgError } from './inject-cli-errors.js';

/** A named or custom network profile, in the units people quote. */
export interface NetworkProfile {
  /** The preset name, or `custom`. */
  name: string;
  /** Added round-trip latency in ms. */
  latencyMs: number;
  /** Download throughput in kilobits per second. */
  downloadKbps: number;
  /** Upload throughput in kilobits per second. */
  uploadKbps: number;
}

/**
 * Presets, with Chrome DevTools' long-standing numbers (latency already
 * including DevTools' adjustment factors, throughput in kbit/s).
 */
export const NETWORK_PRESETS: Readonly<Record<string, NetworkProfile>> = {
  'slow-3g': { name: 'slow-3g', latencyMs: 2000, downloadKbps: 400, uploadKbps: 400 },
  'fast-3g': { name: 'fast-3g', latencyMs: 563, downloadKbps: 1475, uploadKbps: 675 },
};

/** Upper bounds, so a typo cannot ask for a 3-hour round trip. */
export const MAX_LATENCY_MS = 60_000;
export const MAX_THROUGHPUT_KBPS = 10_000_000;

function parsePositiveInt(raw: string, field: string, max: number, allowZero: boolean): number {
  const n = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isFinite(n) || n > max || (!allowZero && n === 0)) {
    throw new InjectCliArgError(
      `--throttle ${field} must be an integer in ${allowZero ? 0 : 1}..${max} (got ${raw})`
    );
  }
  return n;
}

/**
 * Parse a `--throttle` value: a preset (`slow-3g`, `fast-3g`) or
 * `latency=<ms>,down=<kbps>,up=<kbps>` (all three required).
 */
export function parseThrottle(raw: string): NetworkProfile {
  const preset = NETWORK_PRESETS[raw];
  if (preset) return { ...preset };
  if (!raw.includes('=')) {
    throw new InjectCliArgError(
      `--throttle expects ${Object.keys(NETWORK_PRESETS).join(' | ')} or ` +
        `latency=<ms>,down=<kbps>,up=<kbps> (got ${raw})`
    );
  }
  const fields = new Map<string, string>();
  for (const part of raw.split(',')) {
    const [k, v, ...rest] = part.split('=').map((s) => s.trim());
    if (!k || v === undefined || v === '' || rest.length > 0) {
      throw new InjectCliArgError(`--throttle has a malformed item ${JSON.stringify(part)}`);
    }
    if (!['latency', 'down', 'up'].includes(k)) {
      throw new InjectCliArgError(`--throttle has an unknown key ${JSON.stringify(k)}`);
    }
    if (fields.has(k)) throw new InjectCliArgError(`--throttle lists ${k} twice`);
    fields.set(k, v);
  }
  for (const k of ['latency', 'down', 'up']) {
    if (!fields.has(k)) {
      throw new InjectCliArgError(
        `--throttle custom profile needs latency, down and up (missing ${k})`
      );
    }
  }
  return {
    name: 'custom',
    latencyMs: parsePositiveInt(fields.get('latency')!, 'latency', MAX_LATENCY_MS, true),
    downloadKbps: parsePositiveInt(fields.get('down')!, 'down', MAX_THROUGHPUT_KBPS, false),
    uploadKbps: parsePositiveInt(fields.get('up')!, 'up', MAX_THROUGHPUT_KBPS, false),
  };
}

/** What was sent to Chromium, stamped wherever a frame or result depends on it. */
export interface NetworkEmulation extends NetworkProfile {
  /** True once `Network.emulateNetworkConditions` resolved. */
  applied: true;
  /** True when `--no-cache` also disabled the HTTP cache (`Network.setCacheDisabled`). */
  cacheDisabled: boolean;
}

/** The slice of a Playwright `Page` network emulation needs. */
export interface ThrottlePage {
  context(): {
    newCDPSession(page: unknown): Promise<{
      send(method: string, params?: Record<string, unknown>): Promise<unknown>;
    }>;
  };
}

/** The CDP parameters for a profile: throughput in BYTES per second. */
export function cdpConditions(profile: NetworkProfile): Record<string, unknown> {
  return {
    offline: false,
    latency: profile.latencyMs,
    downloadThroughput: Math.round((profile.downloadKbps * 1000) / 8),
    uploadThroughput: Math.round((profile.uploadKbps * 1000) / 8),
  };
}

/**
 * Apply `profile` (and, with `disableCache`, turn the HTTP cache off — a warm
 * cache would let a "slow network" reload paint instantly) to `page`.
 */
export async function applyNetworkEmulation(
  page: ThrottlePage,
  profile: NetworkProfile | null,
  disableCache: boolean
): Promise<NetworkEmulation | null> {
  if (profile === null && !disableCache) return null;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  if (disableCache) await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  const effective = profile ?? {
    name: 'unthrottled',
    latencyMs: 0,
    downloadKbps: 0,
    uploadKbps: 0,
  };
  if (profile !== null) await cdp.send('Network.emulateNetworkConditions', cdpConditions(profile));
  return { ...effective, applied: true, cacheDisabled: disableCache };
}
