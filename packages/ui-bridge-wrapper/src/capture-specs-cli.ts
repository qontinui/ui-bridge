/**
 * `ui-bridge-capture-specs` — log into a qontinui-web origin (injected
 * transport) and capture live getControlSnapshots of authed pages, in-process.
 * Mirrors `ui-bridge-login-web`'s Variant-A injected login (drives the Cognito
 * OAuth chain), then `ctx.page.goto`s each target authed page and snapshots the
 * re-injected runtime. Writes one snapshot JSON per page (input for spec authoring).
 *
 * The login deep-links through the FIRST same-origin target via `?next=`, so
 * the authed landing is deterministic (that target itself) instead of the
 * app's situational /dashboard-vs-/build pick. Safe since web #439
 * (`311dd963`) base64url-packed the OAuth state — pre-#439, any `%xx`-bearing
 * state failed "OAuth state mismatch" on the email return path.
 *
 * This is a packaged bin (mirrors `ui-bridge-inject`): the engine bundle
 * resolves from the wrapper package's own module tree, so it runs from ANY
 * directory once installed — no "run from the ui-bridge repo root" coupling. It
 * does require the optional `@qontinui/ui-bridge-headless` peer plus a one-time
 * `npx playwright install chromium` (or `PLAYWRIGHT_BROWSERS_PATH`). See README.
 *
 *   ui-bridge-capture-specs --out D:/qontinui-root/spec-capture
 *   (creds via env UIB_LOGIN_EMAIL/PASSWORD or --email/--password)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from 'playwright';
import { createTransport } from './create-transport.js';
import type { InjectedContext } from './transports/injected.js';

export const USAGE = `ui-bridge-capture-specs — log in and snapshot authed pages via the injected transport

Required (one of):
  --email <e> / --password <p>   Credentials. Falls back to env
                                 UIB_LOGIN_EMAIL / UIB_LOGIN_PASSWORD.

Options:
  --out <dir>                    Output dir for <slug>.snapshot.json files
                                 (default D:/qontinui-root/spec-capture).
  --origin <url>                 App origin (default https://qontinui.io).
  --pages "slug=path,slug=path"  Pages to capture (paths joined to --origin;
                                 absolute http(s) URLs used verbatim). Default =
                                 the two admin coord pages.
  --device <id>                  device_id query for the default trees page.
  --timeout <ms>                 Per-hop wait budget (default 70000).
  --help, -h                     Print this help and exit.

Prerequisites (packaged bin): the optional @qontinui/ui-bridge-headless peer must
be installed AND Chromium available (run \`npx playwright install chromium\` once,
or set PLAYWRIGHT_BROWSERS_PATH).

Exits non-zero if any capture bounced to login or errored.
`;

const DEFAULT_OUT = 'D:/qontinui-root/spec-capture';
const DEFAULT_ORIGIN = 'https://qontinui.io';
// spaceship: gives the trees page real cards.
const DEFAULT_DEVICE = 'c79a07d5-7e40-49b4-87fa-554c749f9644';

/** A page to capture: a display slug + the absolute URL to navigate to. */
export interface PageTarget {
  slug: string;
  url: string;
}

/** Parsed, validated CLI arguments. */
export interface CaptureCliArgs {
  email: string;
  password: string;
  out: string;
  origin: string;
  device: string;
  timeoutMs: number;
  /** Explicit page set from --pages, or null to use the default coord pages. */
  pages: PageTarget[] | null;
  help: boolean;
}

/** Error raised by `parseArgs`/validation (no `process.exit` — testable). */
export class CaptureCliArgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaptureCliArgError';
  }
}

/**
 * Parse a `--pages` spec ("slug=path,slug=path") into targets. Paths are joined
 * to `origin`; absolute http(s) URLs are used verbatim. Makes this a general
 * "log in + snapshot these authed pages" capture tool, not coord-only.
 */
export function parsePages(spec: string, origin: string): PageTarget[] {
  return spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq === -1) {
        throw new CaptureCliArgError(`--pages entry must be 'slug=path' (got ${pair})`);
      }
      const slug = pair.slice(0, eq).trim();
      const ref = pair.slice(eq + 1).trim();
      if (!slug || !ref) {
        throw new CaptureCliArgError(`--pages entry must be 'slug=path' (got ${pair})`);
      }
      const url = /^https?:\/\//i.test(ref)
        ? ref
        : `${origin}${ref.startsWith('/') ? '' : '/'}${ref}`;
      return { slug, url };
    });
}

/** The default coord page set (used when --pages is absent). */
export function defaultTargets(origin: string, device: string): PageTarget[] {
  return [
    { slug: 'admin-coord-trees', url: `${origin}/admin/coord/trees?device_id=${device}` },
    { slug: 'admin-coord-pull-decisions', url: `${origin}/admin/coord/pull-decisions` },
  ];
}

/**
 * Cognito is identified by HOST (custom domain / raw Cognito domain) or the
 * /oauth2/ endpoints — never by a bare `/login?` path match: the app's own
 * login URL now legitimately carries a query (`/login?next=…`), and a path
 * match would misclassify it as Cognito, silently disabling the
 * bounced-back-to-login detection below.
 */
export const isCognito = (u: string): boolean =>
  /auth\.qontinui\.io|amazoncognito\.com|\/oauth2\//i.test(u);

/** Extract a URL's pathname; '' for an unparseable value. */
export const pathOf = (u: string): string => {
  try {
    return new URL(u).pathname;
  } catch {
    return '';
  }
};

/**
 * Strict URL checks compare PATHNAMES, never the whole URL — a query param
 * echoing a path (state=…%2Fco-pilot) must not fake a match. Same fix as
 * login-web (#81). True when the URL is the app's OWN /login page.
 */
export const isLoginPath = (u: string): boolean =>
  /\/login(\b|\/|$)/.test(pathOf(u)) && !isCognito(u);

/**
 * Deep-link the login through the first same-origin target (`?next=`) so the
 * post-login landing is the target itself. Cross-origin first targets (absolute
 * --pages URLs) can't ride `next` — the callback's open-redirect guard only
 * honors same-origin "/" paths — so those fall back to bare /login.
 *
 * Returns the login URL plus the resolved `firstNext` (the same-origin
 * path+search deep-linked to, or null when none applies).
 */
export function computeLoginUrl(
  targets: PageTarget[],
  origin: string
): { loginUrl: string; firstNext: string | null } {
  let firstNext: string | null = null;
  try {
    const u = new URL(targets[0]!.url);
    if (u.origin === new URL(origin).origin) firstNext = u.pathname + u.search;
  } catch {
    /* fall through to bare /login */
  }
  const loginUrl = firstNext
    ? `${origin}/login?next=${encodeURIComponent(firstNext)}`
    : `${origin}/login`;
  return { loginUrl, firstNext };
}

/**
 * Parse `argv` (already sliced past `node script`) into validated args.
 * Throws {@link CaptureCliArgError} on bad input. Credentials fall back to env
 * UIB_LOGIN_EMAIL / UIB_LOGIN_PASSWORD.
 */
export function parseArgs(argv: string[]): CaptureCliArgs {
  const valueOf = (name: string): string | null => {
    const i = argv.indexOf(name);
    return i >= 0 && i + 1 < argv.length ? (argv[i + 1] ?? null) : null;
  };
  const has = (name: string): boolean => argv.includes(name);

  for (const arg of argv) {
    if (arg.startsWith('--') && !KNOWN_FLAGS.has(arg)) {
      throw new CaptureCliArgError(`Unknown flag: ${arg}`);
    }
  }

  const help = has('--help') || has('-h');
  const origin = valueOf('--origin') ?? DEFAULT_ORIGIN;
  const device = valueOf('--device') ?? DEFAULT_DEVICE;
  const timeoutRaw = valueOf('--timeout');
  const timeoutMs = timeoutRaw === null ? 70000 : Number.parseInt(timeoutRaw, 10);
  if (!help && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    throw new CaptureCliArgError(`--timeout expects a positive integer (got ${timeoutRaw})`);
  }
  const pagesSpec = valueOf('--pages');

  const args: CaptureCliArgs = {
    email: valueOf('--email') ?? process.env.UIB_LOGIN_EMAIL ?? '',
    password: valueOf('--password') ?? process.env.UIB_LOGIN_PASSWORD ?? '',
    out: valueOf('--out') ?? DEFAULT_OUT,
    origin,
    device,
    timeoutMs,
    pages: pagesSpec ? parsePages(pagesSpec, origin) : null,
    help,
  };

  validateArgs(args);
  return args;
}

const KNOWN_FLAGS = new Set([
  '--email',
  '--password',
  '--out',
  '--origin',
  '--pages',
  '--device',
  '--timeout',
  '--help',
  '-h',
]);

/** Validate cross-flag invariants. `--help` short-circuits (always valid). */
export function validateArgs(args: CaptureCliArgs): void {
  if (args.help) return;
  if (!args.email || !args.password) {
    throw new CaptureCliArgError('need creds (UIB_LOGIN_EMAIL/PASSWORD or --email/--password)');
  }
}

/** Subset of the control snapshot this CLI reads. */
interface CaptureSnapshot {
  route?: string | null;
  registration?: { totalRegistered?: number | null } | null;
}

interface CaptureRow {
  slug: string;
  requestedUrl: string;
  finalUrl: string;
  onLogin: boolean;
  error: string | null;
  route: string | null;
  totalRegistered: number | null;
  snapshot: unknown;
}

function log(m: string): void {
  process.stderr.write(`[capture] ${m}\n`);
}

async function fillVisible(page: Page, sels: string[], val: string, what: string): Promise<void> {
  for (const s of sels) {
    const loc = page.locator(s);
    const n = await loc.count().catch(() => 0);
    for (let i = 0; i < n; i++) {
      const el = loc.nth(i);
      if (await el.isVisible().catch(() => false)) {
        await el.fill(val, { timeout: 10000 });
        return;
      }
    }
  }
  throw new Error(`Cognito ${what} field not found`);
}

async function main(): Promise<void> {
  let args: CaptureCliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof CaptureCliArgError) {
      process.stderr.write(`${err.message}\n\n${USAGE}`);
      process.exit(2);
    }
    throw err;
  }

  if (args.help) {
    process.stdout.write(USAGE);
    process.exit(0);
  }

  const { email, password, out, origin, device, timeoutMs } = args;
  const targets = args.pages ?? defaultTargets(origin, device);
  const { loginUrl, firstNext } = computeLoginUrl(targets, origin);

  // What the post-login landing should look like: the first target's pathname
  // when deep-linking, else the app's situational /dashboard-or-/build pick.
  const landedAuthed = (u: string): boolean =>
    firstNext
      ? pathOf(u) === pathOf(`${origin}${firstNext}`)
      : pathOf(u).includes('/dashboard') || pathOf(u).includes('/build');

  const transport = createTransport({
    kind: 'injected',
    options: { targetUrl: loginUrl, waitForSettle: false, readyTimeoutMs: 45000 },
  });

  transport.register<unknown, CaptureRow[], InjectedContext>('run', async (_p, ctx) => {
    const page = ctx.page;
    // --- login (same flow as login-web) ---
    log(`login: ${page.url()}`);
    await page
      .getByRole('button', { name: /continue with email/i })
      .or(page.getByText(/continue with email/i))
      .first()
      .click({ timeout: 20000 });
    await page.waitForURL((u) => isCognito(u.toString()) || landedAuthed(u.toString()), {
      timeout: timeoutMs,
    });
    if (isCognito(page.url())) {
      await page.waitForLoadState('domcontentloaded');
      await fillVisible(
        page,
        ['#signInFormUsername', 'input[name="username"]', 'input[type="email"]'],
        email,
        'email'
      );
      await fillVisible(
        page,
        ['#signInFormPassword', 'input[name="password"]', 'input[type="password"]'],
        password,
        'password'
      );
      const sub = page.locator(
        'input[name="signInSubmitButton"], button[type="submit"], input[type="submit"]'
      );
      const sn = await sub.count();
      let done = false;
      for (let i = 0; i < sn; i++) {
        if (await sub.nth(i).isVisible().catch(() => false)) {
          await sub.nth(i).click();
          done = true;
          break;
        }
      }
      if (!done) await page.getByRole('button', { name: /sign in|continue/i }).first().click();
      // "Not on Cognito anymore" is NOT authed — /auth/callback can be stuck
      // on an error card (the 2026-06-04 state-mismatch false positive). Wait
      // for the redirect chain to LEAVE the callback; on timeout, surface the
      // visible error card so the failure is self-diagnosing.
      try {
        await page.waitForURL(
          (u) => !isCognito(u.toString()) && !/^\/auth\/callback/.test(pathOf(u.toString())),
          { timeout: timeoutMs }
        );
      } catch {
        let errorText: string | null = null;
        try {
          const alerts = page.locator(
            '[role="alert"], #loginErrorMessage, .error-message, [class*="error" i], [data-testid*="error" i]'
          );
          const an = await alerts.count();
          for (let i = 0; i < an && !errorText; i++) {
            const el = alerts.nth(i);
            if (await el.isVisible().catch(() => false)) {
              const t = (await el.innerText().catch(() => '')).trim();
              if (t) errorText = t.slice(0, 500);
            }
          }
        } catch {
          /* best-effort */
        }
        throw new Error(
          `login stalled on ${pathOf(page.url())}${errorText ? ` — ${errorText}` : ''}`
        );
      }
    }
    await page.waitForLoadState('networkidle').catch(() => {});
    if (isLoginPath(page.url())) {
      throw new Error(`login failed — bounced back to ${pathOf(page.url())}`);
    }
    log(`authed: ${page.url()}`);

    // --- capture each page ---
    const out: CaptureRow[] = [];
    for (const t of targets) {
      log(`navigate ${t.url}`);
      await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      await page
        .waitForFunction(
          () => (window as { __uiBridgeInjected?: { ready?: boolean } }).__uiBridgeInjected?.ready === true,
          { timeout: 20000 }
        )
        .catch(() => {});
      // give the page's 10s poll + data fetch time to populate, then settle
      await ctx.whenSettled(12000).catch(() => {});
      await page.waitForTimeout(2500); // let the coord data-fetch + render land
      let snap: CaptureSnapshot | null = null;
      let err: string | null = null;
      try {
        snap = (await ctx.snapshot()) as CaptureSnapshot;
      } catch (e) {
        err = e instanceof Error ? e.message : String(e);
      }
      const finalUrl = page.url();
      const onLogin = isLoginPath(finalUrl);
      out.push({
        slug: t.slug,
        requestedUrl: t.url,
        finalUrl,
        onLogin,
        error: err,
        route: snap?.route ?? null,
        totalRegistered: snap?.registration?.totalRegistered ?? null,
        snapshot: snap,
      });
      log(`  -> route=${snap?.route} registered=${snap?.registration?.totalRegistered} onLogin=${onLogin}`);
    }
    return out;
  });

  let result: CaptureRow[] | { error: string };
  let code = 0;
  try {
    await transport.ready();
    result = await transport.dispatch('run');
  } catch (e) {
    result = { error: e instanceof Error ? e.message : String(e) };
    code = 1;
  } finally {
    await transport.close().catch(() => {});
  }

  if (Array.isArray(result)) {
    fs.mkdirSync(out, { recursive: true });
    for (const r of result) {
      const f = path.join(out, `${r.slug}.snapshot.json`);
      fs.writeFileSync(f, JSON.stringify(r.snapshot ?? { error: r.error }, null, 2));
      process.stdout.write(
        JSON.stringify({
          slug: r.slug,
          finalUrl: r.finalUrl,
          route: r.route,
          totalRegistered: r.totalRegistered,
          onLogin: r.onLogin,
          file: f,
        }) + '\n'
      );
    }
    // Exit non-zero if any capture failed — a snapshot of a login bounce or an
    // errored page is not a capture. (Previously a fully failed run could still
    // exit 0 with garbage snapshot files.)
    if (result.some((r) => r.onLogin || r.error)) code = 1;
  } else {
    process.stdout.write(JSON.stringify(result) + '\n');
  }
  process.exit(code);
}

const isMain = (() => {
  try {
    return process.argv[1] === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isMain) {
  void main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[capture] fatal: ${msg}\n`);
    process.exit(1);
  });
}
