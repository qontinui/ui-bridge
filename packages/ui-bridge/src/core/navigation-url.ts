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
 * What it decides, and only that:
 *   - A ROOT-RELATIVE path (`/settings`, `/a?b#c` — one `/` not followed by
 *     another `/` or a `\`, after the trimming the URL parser itself does)
 *     is a path on the page's own origin and always passes, whatever `base`'s
 *     scheme: it cannot name a scheme of its own, and it is what an app served
 *     from `tauri://localhost`, `file://` or an `about:blank` frame navigates
 *     with. Resolving it against such a base would refuse it (or throw).
 *   - Anything else is resolved against `base`: it must parse, and its scheme
 *     must be `http:` or `https:`. Other relative forms (`a`, `?q`, `#h`)
 *     inherit `base`'s scheme, so they pass on an http(s) page and are refused
 *     on any other.
 * A caller that has a stricter FORMAT rule of its own (the relay
 * `pageNavigate`, which refuses a bare `settings`) keeps it at its own call
 * site.
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

/**
 * `url` as the WHATWG URL parser sees it before parsing: leading and trailing
 * C0 controls and spaces stripped, every tab and newline removed. Without it
 * `" /\t/evil.test"` would look root-relative here and parse as `//evil.test`.
 */
function parserNormalized(url: string): string {
  let start = 0;
  let end = url.length;
  while (start < end && url.charCodeAt(start) <= 0x20) start++;
  while (end > start && url.charCodeAt(end - 1) <= 0x20) end--;
  let out = '';
  for (let i = start; i < end; i++) {
    const c = url.charCodeAt(i);
    if (c !== 0x09 && c !== 0x0a && c !== 0x0d) out += url[i];
  }
  return out;
}

/** A path on the page's own origin: `/` not followed by `/` or `\`. */
function isRootRelativePath(url: string): boolean {
  const normalized = parserNormalized(url);
  return normalized.startsWith('/') && normalized[1] !== '/' && normalized[1] !== '\\';
}

/** Decide whether a tab may be navigated to `url`, resolved against `base`. */
export function checkNavigationUrl(url: string, base: string): NavigationUrlVerdict {
  if (isRootRelativePath(url)) return { ok: true };
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
