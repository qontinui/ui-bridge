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
export function parserNormalized(url: string): string {
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

/**
 * `^scheme:` — RFC 3986's scheme grammar, read on the parser-normalized form
 * (so ` JavaScript:x` and `java<TAB>script:x` are schemes too).
 */
const SCHEME_PREFIX = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/**
 * Is `page` a BARE ROUTE NAME — `settings`, `fleet/runs` — rather than a URL?
 * True when, after the parser's own trimming, it names no scheme and does not
 * start with `/` or `\` (a path, or a protocol-relative `//host` / `/\host`), nor
 * with `?`, `#` or `.` (a relative reference: `?q`, `#h`, `./x`, `../x`).
 * A name like that is what `navigateByAdapter` hands an adapter, and what
 * `windowLocationPath` turns into `/<name>` when there is none.
 */
export function isBareRouteName(page: string): boolean {
  const normalized = parserNormalized(page);
  if (normalized.length === 0) return false;
  if (normalized[0] === '/' || normalized[0] === '\\') return false;
  // A relative REFERENCE keeps its relative meaning: `?q` (this page, another
  // query), `#h` (this page, a fragment), `./x` / `../x` (relative paths).
  // Prefixing them would rewrite where they point; they are resolved against
  // the base by the gate as any other non-bare target is.
  if (normalized[0] === '?' || normalized[0] === '#' || normalized[0] === '.') return false;
  return !SCHEME_PREFIX.test(normalized);
}

/**
 * The PATH FORM of a navigation target — the exact string a no-adapter
 * navigation assigns (`windowLocationPath`), and the exact string
 * {@link checkNavigationTarget} gates, so the verdict and the navigation agree
 * by construction. The target is first normalized as the URL parser itself
 * would (outer C0 controls and spaces stripped, tabs and newlines removed);
 * then a bare route name ({@link isBareRouteName}) becomes `/<name>`, and
 * anything else — a path, a protocol-relative `//host`, an absolute URL of any
 * scheme — is that normalized string unchanged (a non-http scheme such as
 * `mailto:` or `javascript:` passes through here and is refused by the gate).
 *
 * `" /settings"` → `/settings`; `"\t/evil.test/x"` → `/evil.test/x` (a
 * same-origin path, never `//evil.test/x`); `httpbin` → `/httpbin`.
 */
export function navigationPathForm(target: string): string {
  const normalized = parserNormalized(target);
  return isBareRouteName(normalized) ? `/${normalized}` : normalized;
}

/**
 * The gate for a `navigateByAdapter` target (plan D3): it checks the target's
 * {@link navigationPathForm} — exactly the string the no-adapter path
 * navigates to (`windowLocationPath`). For a bare route name that is
 * `/<name>`, the one form a name can take on a page whose
 * own base is not http(s) (`tauri://localhost`, `file://`, `about:blank`),
 * where resolving the bare name against the base would refuse it. Every other
 * target — a scheme (`javascript:x`), a path, a protocol-relative `//host` —
 * is checked exactly as {@link checkNavigationUrl} checks it. The relay's
 * pre-check and the page's command use this one function, so the relay never
 * refuses a name the page would accept.
 */
export function checkNavigationTarget(page: string, base: string): NavigationUrlVerdict {
  return checkNavigationUrl(navigationPathForm(page), base);
}

/**
 * The root of the page's origin (`scheme://host/`) — the base a SOFT
 * navigation resolves against, as `new URL(x, window.location.origin)` did,
 * so `settings` on `/app/page` is `/settings`, not `/app/settings`. Works for
 * an opaque-origin page too (`tauri://localhost/` → `tauri://localhost/`,
 * `file:///x` → `file:///`); `undefined` when the page URL cannot be a base
 * (`about:blank`).
 */
export function originRoot(pageUrl: string): string | undefined {
  try {
    return new URL('/', pageUrl).href;
  } catch {
    return undefined;
  }
}

/**
 * The same-origin `pathname + search + hash` of `url` against `base`, for the
 * callers that hand a path on (a framework `navigateHandler`, `pushState`) —
 * or `undefined` when `url` is not on `base`'s origin (same SCHEME and HOST:
 * an opaque origin such as `tauri:`'s serializes as `"null"` for every host,
 * so `tauri://evil.test/x` is never "the same origin" as `tauri://localhost/`
 * here), and `null` when its
 * derived path would NOT be a root-relative path: the URL parser collapses
 * `/x/..//evil.test/p` to the pathname `//evil.test/p`, which a router or
 * `pushState` reads as protocol-relative, i.e. another origin. A caller refuses
 * on `null`; the approved URL is never handed on in a form that changes origin.
 */
export function sameOriginPathOf(url: string, base: string): string | null | undefined {
  let target: URL;
  let origin: URL;
  try {
    target = new URL(url, base);
    origin = new URL(base);
  } catch {
    return undefined;
  }
  if (target.protocol !== origin.protocol || target.host !== origin.host) return undefined;
  const path = target.pathname + target.search + target.hash;
  return isRootRelativePath(path) ? path : null;
}

/** The refusal for a same-origin URL whose derived path would change origin. */
export function originChangingPathMessage(url: string): string {
  return `Invalid URL format: "${url}" resolves to a path that would be read as another origin.`;
}

/** What a SOFT navigation (a router's `navigateHandler`, `pushState`) may hand on. */
export type SoftNavigationPath =
  | { ok: true; path: string }
  | { ok: false; code: 'INVALID_URL_FORMAT'; message: string };

/**
 * The base a SOFT navigation (a router's `navigateHandler`, `pushState`)
 * resolves `url` against on a page at `pageUrl`: a BARE ROUTE NAME
 * (`settings`) against the page's {@link originRoot} — it names a route, so
 * `settings` on `/app/page` is `/settings` — and anything else (a relative
 * reference `?q`, `#h`, `./x`, `../x`, or a path) against the full page URL,
 * as the browser and the hard path resolve it (`./x` on `/app/page` is
 * `/app/x`, `?q=1` is `/app/page?q=1`). `undefined` when the page cannot be a
 * base (`about:blank`).
 */
export function softResolutionBase(url: string, pageUrl: string): string | undefined {
  const root = originRoot(pageUrl);
  if (root === undefined) return undefined;
  return isBareRouteName(url) ? root : pageUrl;
}

/** A base that only exists to collapse a path's dot-segments for a check. */
const COLLAPSE_PROBE_BASE = 'http://collapse-probe.invalid/';

/**
 * The string a soft navigation (a router's `navigateHandler`, `pushState`, a
 * registered navigation adapter) hands on for `url` on a page at `pageUrl`.
 * `url` is resolved against {@link softResolutionBase} — the origin root for a
 * bare route name, the full page URL otherwise — and the result is the
 * same-origin path
 * ({@link sameOriginPathOf}). Refused (INVALID_URL_FORMAT): a URL on another
 * origin — a soft navigation cannot leave it (`pushState` throws; a router
 * would read it as a path) — and a path the parser collapses to `//host/…`.
 *
 * When the page cannot be a base at all (`about:blank`), `url` is handed on
 * normalized ({@link parserNormalized}) only if it is a root-relative path
 * whose dot-segments do not collapse into `//host/…`; anything else is
 * refused.
 */
export function softNavigationPath(url: string, pageUrl: string): SoftNavigationPath {
  const root = softResolutionBase(url, pageUrl);
  if (root === undefined) {
    const normalized = parserNormalized(url);
    const collapsed = isRootRelativePath(normalized)
      ? sameOriginPathOf(normalized, COLLAPSE_PROBE_BASE)
      : null;
    if (typeof collapsed === 'string') return { ok: true, path: normalized };
    return {
      ok: false,
      code: 'INVALID_URL_FORMAT',
      message: `Invalid URL format: "${url}" is not a root-relative path, and this page has no origin to resolve it against.`,
    };
  }
  const same = sameOriginPathOf(url, root);
  if (same === null) {
    return { ok: false, code: 'INVALID_URL_FORMAT', message: originChangingPathMessage(url) };
  }
  if (typeof same === 'string') return { ok: true, path: same };
  return {
    ok: false,
    code: 'INVALID_URL_FORMAT',
    message: `Invalid URL format: "${url}" is on another origin; a soft navigation stays on this page's origin (use mode "hard").`,
  };
}

/** Two path separators in a row (`/` or `\\`, which special schemes read as `/`). */
const EMPTY_PATH_SEGMENT = /[/\\]{2}/;

/** Is `normalized` a relative reference (`?q`, `#h`, `./x`, `../x`)? */
function isRelativeReference(normalized: string): boolean {
  return normalized[0] === '?' || normalized[0] === '#' || normalized[0] === '.';
}

/**
 * The target a navigation ADAPTER (a router: a soft navigator) gets for
 * `page` on a page at `pageUrl`.
 *
 * - A bare route name or a relative reference keeps its meaning and is handed
 *   on CLEANED ({@link parserNormalized}) and otherwise unchanged (`settings`,
 *   `?q=1`, `#section`, `./x`), after checking that every form a router could
 *   read it as stays on the page's origin and does not collapse into
 *   `//host/…`: it may hold no empty path segment at all (`//`, `/\`,
 *   `\/`, `\\` before any `?`/`#`) — a router may resolve it against any
 *   directory, and such a segment collapses to `//host` from some depth — and
 *   both its PAGE-relative resolution and its root-relative form `/<ref>`
 *   must stay same-origin. So `x/../..//evil.test/p`, `..//evil.test/p`,
 *   `.//evil.test/p` and `./..//evil.test/p` are refused at any depth.
 * - Anything else is a URL or a path, and is handed on only as the
 *   same-origin path {@link softNavigationPath} derives (origin-relative).
 *
 * On a page that cannot be a base (`about:blank`) the checks run against a
 * probe base, which still catches a collapse.
 */
export function adapterNavigationTarget(page: string, pageUrl: string): SoftNavigationPath {
  const cleaned = parserNormalized(page);
  const bare = isBareRouteName(cleaned);
  if (!bare && !isRelativeReference(cleaned)) return softNavigationPath(cleaned, pageUrl);
  // Depth-independent: a router may resolve the reference against ANY
  // directory, and an empty path segment (`//`, `/\`, `\/`, `\\`)
  // collapses to `//host/…` from some depth (`.//evil.test/p`,
  // `./..//evil.test/p`). Only the path part counts: `?next=//x` is a query.
  if (EMPTY_PATH_SEGMENT.test(cleaned.split(/[?#]/, 1)[0])) {
    return { ok: false, code: 'INVALID_URL_FORMAT', message: originChangingPathMessage(page) };
  }
  const base = originRoot(pageUrl) !== undefined ? pageUrl : COLLAPSE_PROBE_BASE;
  for (const form of [cleaned, `/${cleaned}`]) {
    const same = sameOriginPathOf(form, base);
    if (typeof same === 'string') continue;
    return {
      ok: false,
      code: 'INVALID_URL_FORMAT',
      message:
        same === null
          ? originChangingPathMessage(page)
          : `Invalid URL format: "${page}" resolves to another origin; a navigation adapter stays on this page's origin.`,
    };
  }
  return { ok: true, path: cleaned };
}
