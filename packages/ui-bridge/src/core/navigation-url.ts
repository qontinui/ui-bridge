/**
 * The one navigation URL gate (plan 2026-11-08-relayed-ui-bridge-actions-have-no-browser-case, D3).
 *
 * Every site that navigates a tab to a caller-supplied URL asks this first:
 * the relay and the page, for both `pageNavigate` and `navigateByAdapter`. A
 * `javascript:` (or `data:` / `blob:` / `vbscript:`) URL handed to the page
 * runs script in it, so a `/control/page/evaluate` block buys nothing while
 * navigation can carry one.
 *
 * Pure and browser-safe: no DOM, no Node API beyond the WHATWG `URL` both
 * runtimes ship.
 *
 * What it decides, and only that: `url` resolved against `base` must parse,
 * and its scheme must be `http:` or `https:`. Relative forms (`/a`, `a`,
 * `?q`, `#h`) inherit `base`'s scheme and pass. A caller that has a stricter
 * FORMAT rule of its own (the relay `pageNavigate`, which refuses a bare
 * `settings`) keeps it at its own call site.
 */

/** The codes a refusal carries; `diagnostics` maps both to `UB-VALIDATION-ERROR`. */
export type NavigationUrlRefusalCode = 'INVALID_URL_PROTOCOL' | 'INVALID_URL_FORMAT';

export type NavigationUrlVerdict =
  | { ok: true }
  | { ok: false; code: NavigationUrlRefusalCode; message: string };

/** Schemes that execute script or embed a document in the navigated tab. */
const DANGEROUS_PROTOCOLS: readonly string[] = ['javascript:', 'data:', 'blob:', 'vbscript:'];

const ALLOWED_PROTOCOLS: readonly string[] = ['http:', 'https:'];

/**
 * The base the relay resolves against: it has no page, and only the scheme of
 * the resolved URL matters to the verdict.
 */
export const RELAY_NAVIGATION_BASE = 'http://relay.invalid/';

/** Decide whether a tab may be navigated to `url`, resolved against `base`. */
export function checkNavigationUrl(url: string, base: string): NavigationUrlVerdict {
  let parsed: URL;
  try {
    parsed = new URL(url, base);
  } catch {
    return {
      ok: false,
      code: 'INVALID_URL_FORMAT',
      message: `Invalid URL format: "${url}" does not parse as a URL.`,
    };
  }
  if (DANGEROUS_PROTOCOLS.includes(parsed.protocol)) {
    return {
      ok: false,
      code: 'INVALID_URL_PROTOCOL',
      message: `Dangerous URL protocol rejected: "${parsed.protocol}". Only http, https, and relative paths are allowed.`,
    };
  }
  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
    return {
      ok: false,
      code: 'INVALID_URL_PROTOCOL',
      message: `Invalid URL protocol "${parsed.protocol}". Only http, https, and relative paths are allowed.`,
    };
  }
  return { ok: true };
}
