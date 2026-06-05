/**
 * `ui-bridge-login-web` — automated web login via the UI Bridge **injected
 * transport** (Variant A, in-process). Logs into a Cognito-fronted web app by
 * driving the full OAuth redirect chain inside ONE headless Chromium tab: the
 * injected `@qontinui/ui-bridge` bundle re-injects on every navigation (via
 * `context.addInitScript`), so the app login page, the cross-origin Cognito
 * hosted UI, and the post-callback authed page are all the same driven session.
 *
 * No relay: relay mode (page -> localhost relay) is blocked by Chrome Local
 * Network Access against a public origin. Variant A drives via Playwright
 * (`ctx.page`, exposed by the injected transport) — no page->localhost fetch.
 *
 * This is a packaged bin (mirrors `ui-bridge-inject`): it resolves the engine
 * bundle from the wrapper package's own module tree via the injected
 * transport's `createRequire(import.meta.url)` resolution, so it runs from ANY
 * directory once installed — there is NO "must run from the ui-bridge repo
 * root" coupling. It does require the optional `@qontinui/ui-bridge-headless`
 * peer to be installed and a one-time `npx playwright install chromium` (or
 * `PLAYWRIGHT_BROWSERS_PATH`) so Chromium is available. See README.
 *
 *   ui-bridge-login-web \
 *     --url "https://qontinui.io/login?next=%2Fbuild%2Fworkflows" \
 *     [--email <e> --password <p>]   (or env UIB_LOGIN_EMAIL / UIB_LOGIN_PASSWORD) \
 *     [--success /dashboard] [--headed] [--timeout 60000] [--keep-open] \
 *     [--post-login-click "<css>"]   (click once on the authed landing — e.g. the
 *       co-pilot consent button [data-testid='co-pilot-consent-allow'], which
 *       mounts the CommandRelayListener so the tab registers with the
 *       same-origin relay; pair with --keep-open for relay-driven sessions)
 *
 * Prefer a `?next=<urlencoded-path>`-bearing --url: the authed landing is then
 * DETERMINISTIC (the app honors `next` instead of situationally picking
 * /dashboard or /build/workflows), so --success can assert the exact page.
 * Safe since web #439 (`311dd963`) base64url-packed the OAuth state — pre-#439
 * any `%xx`-bearing state failed "OAuth state mismatch" on the email return.
 *
 * `--success` matches against the landing page PATHNAME only (preferring the
 * injected bridge's route report over the raw URL) — never the query/fragment.
 * (Git Bash callers: run with MSYS_NO_PATHCONV=1 or the shell rewrites
 * `--success /build` into a Windows path before the script ever sees it.)
 * A `state=`/`next=` query param echoing the target path can NOT fake success
 * (the 2026-06-04 oauth-state-mismatch repro false-positived exactly that way:
 * stuck on /auth/callback with ok:true because the old check accepted any
 * non-Cognito URL).
 *
 * Prints ONE JSON result line to stdout: {ok, finalUrl, uiBridgeRoute, errorText, ...}. Exit 0 = login confirmed.
 * With --keep-open it does NOT close the browser and instead prints the result then
 * parks until SIGTERM (so a caller can keep driving the authed session in-process —
 * extend `drive` for that). Default closes after confirming the authed landing.
 *
 * The arg parsing, validation, and URL classifiers are exported pure functions
 * so they can be unit-tested without spawning a browser or calling `main()`.
 */

import { fileURLToPath } from 'node:url';
import { createTransport } from './create-transport.js';
import type { InjectedContext } from './transports/injected.js';

export const USAGE = `ui-bridge-login-web — automated web login via the UI Bridge injected transport

Required (one of):
  --email <e> / --password <p>   Credentials. Falls back to env
                                 UIB_LOGIN_EMAIL / UIB_LOGIN_PASSWORD.

Options:
  --url <pageUrl>                App login URL (default https://qontinui.io/login).
                                 Prefer a ?next=<urlencoded-path> form so the
                                 authed landing is deterministic.
  --success <pathSubstring>      Pathname substring the authed landing must
                                 contain (default /dashboard). Matched against the
                                 PATHNAME only — query/fragment excluded.
  --timeout <ms>                 Per-redirect-hop wait budget (default 60000).
  --headed                       Launch a visible window (default headless).
  --post-login-click <css>       Click this selector ONCE on the authed landing
                                 (e.g. [data-testid='co-pilot-consent-allow']).
                                 Non-fatal when the target never appears.
  --keep-open                    On success, park the authed session until SIGINT/
                                 SIGTERM instead of closing the browser.
  --help, -h                     Print this help and exit.

Prerequisites (packaged bin): the optional @qontinui/ui-bridge-headless peer must
be installed AND Chromium available (run \`npx playwright install chromium\` once,
or set PLAYWRIGHT_BROWSERS_PATH). Git Bash callers: prefix MSYS_NO_PATHCONV=1 so
a leading-slash --success value is not rewritten into a Windows path.

Examples:
  ui-bridge-login-web --url "https://qontinui.io/login?next=%2Fbuild%2Fworkflows" \\
    --success /build/workflows
  ui-bridge-login-web --url "https://qontinui.io/login?next=%2Fco-pilot" \\
    --success /co-pilot --post-login-click "[data-testid='co-pilot-consent-allow']" --keep-open
`;

/** Parsed, validated CLI arguments. */
export interface LoginCliArgs {
  url: string;
  email: string;
  password: string;
  /** Pathname substring the authed landing must contain (strict — query/fragment excluded). */
  success: string;
  timeoutMs: number;
  headed: boolean;
  /** Optional CSS selector clicked once on the authed landing (non-fatal). */
  postClick: string | null;
  keepOpen: boolean;
  help: boolean;
}

/**
 * Error raised by `parseArgs`/validation. The thin CLI wrapper catches this and
 * calls `die()`; tests assert on it WITHOUT triggering `process.exit`.
 */
export class LoginCliArgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoginCliArgError';
  }
}

/**
 * Cognito is identified by HOST (custom domain / raw Cognito domain) or the
 * /oauth2/ endpoints — never by a bare `/login?` path match: the app's own
 * login URL legitimately carries a query now (`--url …/login?next=%2Fco-pilot`
 * is the recommended deterministic-landing form since web #439), and a path
 * match would (a) misreport a bounced-back-to-login failure as `stillOnCognito`
 * instead of `onAppLoginPage`, and (b) let the step-2 waitForURL instant-match
 * the app's own login page instead of waiting for the real hosted-UI hop.
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
 * Strict success check: compare `success` against the URL's PATHNAME only.
 * Matching the whole URL let query params fake success (e.g. `state=…/co-pilot`
 * on a stuck /auth/callback) — see the 2026-06-04 false positive.
 */
export const isSuccessPath = (u: string, success: string): boolean =>
  pathOf(u).includes(success);

/** True when the URL is the app's OWN /login page (not the Cognito hosted UI). */
export const isAppLoginPath = (u: string): boolean =>
  /\/login(\b|\/|$)/.test(pathOf(u)) && !isCognito(u);

/**
 * Parse `argv` (already sliced past `node script`) into validated args.
 * Throws {@link LoginCliArgError} on bad input (no `process.exit` — testable).
 * Credentials fall back to env UIB_LOGIN_EMAIL / UIB_LOGIN_PASSWORD.
 */
export function parseArgs(argv: string[]): LoginCliArgs {
  const valueOf = (name: string): string | null => {
    const i = argv.indexOf(name);
    return i >= 0 && i + 1 < argv.length ? (argv[i + 1] ?? null) : null;
  };
  const has = (name: string): boolean => argv.includes(name);

  // Reject unknown flags up front (mirrors inject-cli).
  for (const arg of argv) {
    if (arg.startsWith('--') && !KNOWN_FLAGS.has(arg)) {
      throw new LoginCliArgError(`Unknown flag: ${arg}`);
    }
  }

  const help = has('--help') || has('-h');
  const timeoutRaw = valueOf('--timeout');
  const timeoutMs = timeoutRaw === null ? 60000 : Number.parseInt(timeoutRaw, 10);
  if (!help && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    throw new LoginCliArgError(`--timeout expects a positive integer (got ${timeoutRaw})`);
  }

  const args: LoginCliArgs = {
    url: valueOf('--url') ?? 'https://qontinui.io/login',
    email: valueOf('--email') ?? process.env.UIB_LOGIN_EMAIL ?? '',
    password: valueOf('--password') ?? process.env.UIB_LOGIN_PASSWORD ?? '',
    success: valueOf('--success') ?? '/dashboard',
    timeoutMs,
    headed: has('--headed'),
    postClick: valueOf('--post-login-click'),
    keepOpen: has('--keep-open'),
    help,
  };

  validateArgs(args);
  return args;
}

const KNOWN_FLAGS = new Set([
  '--url',
  '--email',
  '--password',
  '--success',
  '--timeout',
  '--headed',
  '--post-login-click',
  '--keep-open',
  '--help',
  '-h',
]);

/** Validate cross-flag invariants. `--help` short-circuits (always valid). */
export function validateArgs(args: LoginCliArgs): void {
  if (args.help) return;
  if (!/^https?:\/\//i.test(args.url)) {
    throw new LoginCliArgError(`--url must start with http:// or https:// (got ${args.url})`);
  }
  if (!args.email || !args.password) {
    throw new LoginCliArgError(
      'need --email/--password or env UIB_LOGIN_EMAIL / UIB_LOGIN_PASSWORD'
    );
  }
}

/** Subset of the control snapshot this CLI reads. */
interface DriveSnapshot {
  route?: string | null;
  registration?: { totalRegistered?: number | null } | null;
}

/** Result line printed to stdout. */
export interface LoginResult {
  ok: boolean;
  finalUrl?: string;
  landingPath?: string;
  onAppLoginPage?: boolean;
  stillOnCognito?: boolean;
  errorText?: string | null;
  uiBridgeRoute?: string | null;
  uiBridgeRegistered?: number | null;
  postLoginClicked?: boolean | null;
  error?: string;
}

function log(m: string): void {
  process.stderr.write(`[login-web] ${m}\n`);
}

async function main(): Promise<void> {
  let args: LoginCliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof LoginCliArgError) {
      process.stderr.write(`${err.message}\n\n${USAGE}`);
      process.exit(2);
    }
    throw err;
  }

  if (args.help) {
    process.stdout.write(USAGE);
    process.exit(0);
  }

  const { url, email, password, success, timeoutMs, headed, postClick } = args;

  const transport = createTransport({
    kind: 'injected',
    options: { targetUrl: url, waitForSettle: false, readyTimeoutMs: 45000, headed },
  });

  transport.register<unknown, LoginResult, InjectedContext>('drive', async (_p, ctx) => {
    const page = ctx.page;

    // 1) App login landing (qontinui.io/login). Buttons aren't SDK-registered,
    //    so locate by visible text via Playwright (the injected bundle is present
    //    but `getControlSnapshot` is empty on this page).
    log(`landed ${page.url()}`);
    const emailBtn = page
      .getByRole('button', { name: /continue with email/i })
      .or(page.getByText(/continue with email/i));
    await emailBtn.first().waitFor({ state: 'visible', timeout: 15000 });
    await emailBtn.first().click();

    // 2) Wait for EITHER the Cognito hosted UI (form to fill) OR an already-authed
    //    landing (live Cognito SSO session can skip the form).
    await page.waitForURL((u) => isCognito(u.toString()) || isSuccessPath(u.toString(), success), {
      timeout: timeoutMs,
    });

    if (isCognito(page.url())) {
      await page.waitForLoadState('domcontentloaded');
      log(`cognito ${page.url()}`);
      // 3) Fill the Cognito hosted-UI form. Try classic + managed-login selectors.
      // Classic Cognito hosted UI renders a hidden duplicate of the form (an
      // inline copy + a modal copy); pick the VISIBLE match, not just .first().
      const fillFirst = async (sels: string[], val: string, what: string): Promise<void> => {
        for (const s of sels) {
          const loc = page.locator(s);
          const n = await loc.count().catch(() => 0);
          for (let i = 0; i < n; i++) {
            const el = loc.nth(i);
            if (await el.isVisible().catch(() => false)) {
              await el.fill(val, { timeout: 10000 });
              log(`filled ${what} via ${s} [visible #${i}]`);
              return;
            }
          }
        }
        throw new Error(`Cognito ${what} field (visible) not found (selectors: ${sels.join(', ')})`);
      };
      await fillFirst(
        [
          '#signInFormUsername',
          'input[name="username"]',
          'input[type="email"]',
          'input[autocomplete="username"]',
        ],
        email,
        'email'
      );
      await fillFirst(
        [
          '#signInFormPassword',
          'input[name="password"]',
          'input[type="password"]',
          'input[autocomplete="current-password"]',
        ],
        password,
        'password'
      );
      // Click the VISIBLE submit (same hidden-duplicate caveat).
      const submitLoc = page.locator(
        'input[name="signInSubmitButton"], button[type="submit"], input[type="submit"], [name="signInSubmitButton"]'
      );
      let clicked = false;
      const sn = await submitLoc.count().catch(() => 0);
      for (let i = 0; i < sn; i++) {
        const el = submitLoc.nth(i);
        if (await el.isVisible().catch(() => false)) {
          await el.click();
          clicked = true;
          log(`clicked submit [visible #${i}]`);
          break;
        }
      }
      if (!clicked) {
        await page.getByRole('button', { name: /sign in|log in|continue|submit/i }).first().click();
        log('clicked submit [role fallback]');
      }

      // 4) Cognito -> /auth/callback (PKCE exchange) -> SUCCESS landing.
      await page.waitForURL(
        (u) => isSuccessPath(u.toString(), success) || /\/auth\/callback/.test(u.toString()),
        { timeout: timeoutMs }
      );
      if (/\/auth\/callback/.test(page.url())) {
        await page
          .waitForURL((u) => isSuccessPath(u.toString(), success), { timeout: timeoutMs })
          .catch(() => {});
      }
    }

    await page.waitForLoadState('networkidle').catch(() => {});
    const finalUrl = page.url();
    log(`final ${finalUrl}`);

    // 5) Confirm via the UI Bridge runtime on the authed page (re-injected there).
    await page
      .waitForFunction(() => (window as { __uiBridgeInjected?: { ready?: boolean } }).__uiBridgeInjected?.ready === true, {
        timeout: 15000,
      })
      .catch(() => {});
    let snap: DriveSnapshot | null = null;
    try {
      snap = (await ctx.snapshot()) as DriveSnapshot;
    } catch {
      /* registry may be empty on some pages */
    }

    // Strict success: the landing PATHNAME must match --success. Prefer the
    // injected bridge's route report (window.location.pathname captured
    // in-page by getControlSnapshot — proves the bridge runtime executed on
    // the landing page); fall back to the raw URL's pathname. "Not on Cognito
    // anymore" is NOT success — the old `|| !isCognito(finalUrl)` disjunct
    // reported ok:true for a flow stuck on /auth/callback (2026-06-04).
    const uiBridgeRoute = snap?.route ?? null;
    const landingPath = uiBridgeRoute ?? pathOf(finalUrl);
    const ok = !isAppLoginPath(finalUrl) && !isCognito(finalUrl) && landingPath.includes(success);

    // On failure, surface any visible error card so the result is
    // self-diagnosing (the oauth-state-mismatch repro required a separate
    // page read just to learn WHY the flow stalled).
    let errorText: string | null = null;
    if (!ok) {
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
    }

    // 6) Optional post-login click (--post-login-click). Runs only on a
    //    confirmed-authed landing. `true` = clicked, `false` = target never
    //    became visible (non-fatal — see the flag comment), `null` = not asked.
    let postLoginClicked: boolean | null = null;
    if (ok && postClick) {
      postLoginClicked = false;
      try {
        const target = page.locator(postClick).first();
        await target.waitFor({ state: 'visible', timeout: 20000 });
        await target.click();
        postLoginClicked = true;
        log(`post-login click: ${postClick}`);
      } catch {
        log(`post-login click target never visible (non-fatal): ${postClick}`);
      }
    }

    return {
      ok,
      finalUrl,
      landingPath,
      onAppLoginPage: isAppLoginPath(finalUrl),
      stillOnCognito: isCognito(finalUrl),
      errorText,
      uiBridgeRoute,
      uiBridgeRegistered: snap?.registration?.totalRegistered ?? null,
      postLoginClicked,
    };
  });

  let result: LoginResult;
  let code: number;
  try {
    await transport.ready();
    result = await transport.dispatch('drive');
    code = result && result.ok ? 0 : 1;
  } catch (err) {
    result = { ok: false, error: err instanceof Error ? err.message : String(err) };
    code = 1;
  }

  process.stdout.write(JSON.stringify(result) + '\n');

  if (args.keepOpen && result && result.ok) {
    log('--keep-open: authed session parked; press Ctrl+C to exit');
    const stop = async (): Promise<void> => {
      await transport.close().catch(() => {});
      process.exit(0);
    };
    process.on('SIGINT', () => void stop());
    process.on('SIGTERM', () => void stop());
    setInterval(() => {}, 1 << 30);
    return;
  }

  await transport.close().catch(() => {});
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
    process.stderr.write(`[login-web] fatal: ${msg}\n`);
    process.exit(1);
  });
}
