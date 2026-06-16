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
import { readFileSync, writeFileSync } from 'node:fs';
import { createTransport } from './create-transport.js';
import {
  buildMultiOriginSessionStorageMap,
  mergeMultiOriginSessionStorageIntoArtifact,
  type FrameSessionStorage,
} from './session-storage-capture.js';
import { ArgReader, COMMON_FLAGS, makeLogger, rejectEmptyValue } from './cli-args.js';
import type { InjectedContext } from './transports/injected.js';
import {
  isCognito,
  pathOf,
  isSuccessPath,
  isAppLoginPath,
  loginDrive,
  scrapeErrorCard,
} from './login-drive.js';

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
  --expect-text <comma-list>     Assert the authed page's body text contains EVERY
                                 comma-separated entry. Missing entries fail the
                                 exit code; the result JSON lists expectFound /
                                 expectMissing. Matched case-sensitively.
  --scroll-to <text>             Before screenshotting, scroll the first element
                                 containing this text into view (non-fatal if absent).
  --screenshot <path>            Write a full-page PNG of the authed landing to
                                 <path> (captured BEFORE the --expect-text check, so
                                 a failing assertion still leaves a diagnostic image).
  --storage-state-out <path>     On a confirmed-authed landing, write a Playwright
                                 storageState JSON (cookies + localStorage) to <path>,
                                 PLUS a custom __sessionStorage key (origin → kv) so
                                 cold replays land authed on apps that keep their
                                 token in sessionStorage (e.g. qontinui-web).
                                 Feed it to 'ui-bridge-inject --storage-state <path>'
                                 to drive a login-walled page MANY times without
                                 re-driving the hosted-UI login each run.
  --keep-open                    On success, park the authed session until SIGINT/
                                 SIGTERM instead of closing the browser.
  --quiet                        Suppress human-readable stderr logs (the JSON
                                 result line still prints).
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
  ui-bridge-login-web --url "https://qontinui.io/login?next=%2Foperations" \\
    --success /operations --expect-text "option2-actions-outage-drill,metric_threshold" \\
    --screenshot out.png
  # Capture a reusable auth artifact, then drive a login-walled page with it:
  ui-bridge-login-web --url "https://qontinui.io/login?next=%2Fadmin%2Fcoord%2Fonboarding" \\
    --success /admin/coord/onboarding --storage-state-out auth.json
  ui-bridge-inject --url https://qontinui.io/admin/coord/onboarding \\
    --storage-state auth.json --exec 'getControlSnapshot {}'
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
  /** Tokens (parsed from a comma-list) the authed page's body text must all contain; `[]` when not asked. */
  expectText: string[];
  /** Optional text to scroll into view before screenshotting (non-fatal if absent). */
  scrollToText: string | null;
  /** Optional path to write a full-page screenshot of the authed landing. */
  screenshotPath: string | null;
  /** Optional path to write a Playwright storageState JSON of the authed context. */
  storageStateOut: string | null;
  keepOpen: boolean;
  /** Suppress human-readable stderr logs (the JSON result line still prints). */
  quiet: boolean;
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
 * Parse `argv` (already sliced past `node script`) into validated args.
 * Throws {@link LoginCliArgError} on bad input (no `process.exit` — testable).
 * Credentials fall back to env UIB_LOGIN_EMAIL / UIB_LOGIN_PASSWORD.
 */
export function parseArgs(argv: string[]): LoginCliArgs {
  const mkError = (m: string): LoginCliArgError => new LoginCliArgError(m);
  // Rejects unknown flags up front AND rejects a flag-shaped value for any
  // value-flag (so `--success --headed` no longer swallows `--headed`).
  const reader = new ArgReader(argv, KNOWN_FLAGS, mkError);
  const valueOf = (name: string): string | null => reader.value(name);
  const has = (name: string): boolean => reader.has(name);

  const help = has('--help') || has('-h');
  const timeoutRaw = valueOf('--timeout');
  const timeoutMs = timeoutRaw === null ? 60000 : Number.parseInt(timeoutRaw, 10);
  if (!help && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    throw new LoginCliArgError(`--timeout expects a positive integer (got ${timeoutRaw})`);
  }

  const args: LoginCliArgs = {
    url: rejectEmptyValue('--url', valueOf('--url'), mkError) ?? 'https://qontinui.io/login',
    email: valueOf('--email') ?? process.env.UIB_LOGIN_EMAIL ?? '',
    password: valueOf('--password') ?? process.env.UIB_LOGIN_PASSWORD ?? '',
    // An EMPTY --success would make `landingPath.includes('')` true on any
    // landing — ok:true while parked on the login page. Reject it.
    success: rejectEmptyValue('--success', valueOf('--success'), mkError) ?? '/dashboard',
    timeoutMs,
    headed: has('--headed'),
    postClick: valueOf('--post-login-click'),
    expectText: (valueOf('--expect-text') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    scrollToText: valueOf('--scroll-to'),
    screenshotPath: valueOf('--screenshot'),
    storageStateOut: valueOf('--storage-state-out'),
    keepOpen: has('--keep-open'),
    quiet: has('--quiet'),
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
  '--expect-text',
  '--scroll-to',
  '--screenshot',
  '--storage-state-out',
  '--keep-open',
  ...COMMON_FLAGS,
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
  /** --expect-text tokens found in the authed page body (present only when --expect-text was given). */
  expectFound?: string[];
  /** --expect-text tokens NOT found (non-empty ⇒ ok:false / exit 1). */
  expectMissing?: string[];
  /** Path the screenshot was written to, or null (present only when --screenshot was given). */
  screenshotPath?: string | null;
  /** Path the storageState artifact was written to, or null (present only when --storage-state-out was given). */
  storageStatePath?: string | null;
  error?: string;
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

  const {
    url,
    email,
    password,
    success,
    timeoutMs,
    headed,
    postClick,
    expectText,
    scrollToText,
    screenshotPath,
    storageStateOut,
  } = args;
  const log = makeLogger('[login-web]', args.quiet);

  const transport = createTransport({
    kind: 'injected',
    options: { targetUrl: url, waitForSettle: false, readyTimeoutMs: 45000, headed },
  });

  transport.register<unknown, LoginResult, InjectedContext>('drive', async (_p, ctx) => {
    const page = ctx.page;

    // 1) Drive the shared Cognito login flow up to a generic authed landing.
    const r = await loginDrive(page, { email, password, timeoutMs, log });

    // 2) Bounded caller-side success wait BEFORE the strict assertion. The shared
    //    helper lands on a *generic* authed page; this CLI's --success demands a
    //    SPECIFIC pathname, which may only resolve after a client-side redirect.
    //    Without this the strict check can sample the URL mid-redirect.
    if (r.ok && !isSuccessPath(page.url(), success)) {
      await page
        .waitForURL((u) => isSuccessPath(u.toString(), success), { timeout: 10000 })
        .catch(() => {});
    }

    const finalUrl = page.url();
    log(`final ${finalUrl}`);

    // 3) Confirm via the UI Bridge runtime on the authed page (re-injected there).
    await page
      .waitForFunction(
        () =>
          (window as { __uiBridgeInjected?: { ready?: boolean } }).__uiBridgeInjected?.ready ===
          true,
        {
          timeout: 15000,
        }
      )
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
    // the landing page); fall back to the helper's landingPath, then the raw
    // URL's pathname. "Not on Cognito anymore" is NOT success — see the
    // 2026-06-04 /auth/callback false positive.
    const uiBridgeRoute = snap?.route ?? null;
    // The helper's landingPath is stale if the bounded wait above rode a
    // client-side redirect past it — trust it only while the URL is unchanged.
    const landingPath =
      uiBridgeRoute ?? (finalUrl === r.finalUrl ? r.landingPath : pathOf(finalUrl));
    // Derive the two URL classifications ONCE and reuse them for both the `ok`
    // verdict and the emitted result, so the success decision is structurally
    // single-sourced (they read the same finalUrl, so they could never disagree
    // — but compute-once makes that a guarantee, not a coincidence).
    const onAppLoginPage = isAppLoginPath(finalUrl);
    const stillOnCognito = isCognito(finalUrl);
    const ok = !onAppLoginPage && !stillOnCognito && landingPath.includes(success);

    // On failure, surface any visible error card so the result is
    // self-diagnosing. Prefer the helper's scrape; re-scrape here only if the
    // success assertion flipped ok false after the helper reported a clean
    // landing (so r.errorText is null but we now need a diagnostic).
    let errorText: string | null = r.errorText;
    if (!ok && !errorText) {
      errorText = await scrapeErrorCard(page);
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
        // The click typically dismisses a dialog/modal that fades out; a
        // screenshot taken immediately races that fade. Wait (bounded) for the
        // clicked element to detach or become hidden — Playwright's 'hidden'
        // state covers both — before the scroll-to/screenshot steps. Timeout
        // is non-fatal: proceed with a warning.
        await target
          .waitFor({ state: 'hidden', timeout: 2000 })
          .catch(() =>
            log(`post-login click target still visible after 2s (non-fatal): ${postClick}`)
          );
      } catch {
        log(`post-login click target never visible (non-fatal): ${postClick}`);
      }
    }

    // 7) Optional screenshot (--screenshot, + --scroll-to). Runs on a
    //    confirmed-authed landing, BEFORE the --expect-text assertion so a
    //    failing assertion still leaves a diagnostic image. Scroll is
    //    best-effort: a missing scroll target must not abort the capture.
    let screenshotWritten: string | null = null;
    if (ok && screenshotPath) {
      try {
        if (scrollToText) {
          await page
            .getByText(scrollToText)
            .first()
            .scrollIntoViewIfNeeded({ timeout: 5000 })
            .catch(() => log(`scroll-to target not found (non-fatal): ${scrollToText}`));
        }
        await page.screenshot({ path: screenshotPath, fullPage: true });
        screenshotWritten = screenshotPath;
        log(`screenshot written: ${screenshotPath}`);
      } catch (err) {
        log(`screenshot failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 7.5) Optional storageState export (--storage-state-out). Runs on a
    //    confirmed-authed landing: serialize the authed context's cookies +
    //    localStorage to a JSON artifact that `ui-bridge-inject --storage-state`
    //    can replay to drive a login-walled page WITHOUT re-driving the
    //    hosted-UI login. Best-effort: a write failure is non-fatal (it must not
    //    flip an otherwise-good login to ok:false) but is surfaced in the log.
    let storageStateWritten: string | null = null;
    if (ok && storageStateOut) {
      try {
        await ctx.browserContext.storageState({ path: storageStateOut });
        storageStateWritten = storageStateOut;
        log(`storage-state written: ${storageStateOut}`);

        // sessionStorage parity, multi-origin. Playwright's storageState above
        // carries ONLY cookies + localStorage — never sessionStorage. Apps that
        // keep their bearer in sessionStorage (qontinui-web:
        // `auth_bearer_access_token`) would replay tokenless on a cold inject and
        // bounce to /login. So capture sessionStorage from ALL frames of the
        // authed page (main frame + iframes), each keyed by its OWN origin, and
        // fold the multi-origin `{ origin -> kv }` map into the artifact under the
        // custom `__sessionStorage` key; the launcher strips that key before
        // newContext and replays each origin's map per-frame via an init-script.
        // Per-frame try/catch: cross-origin / sandboxed frames throw on
        // sessionStorage access and are skipped gracefully. Best-effort overall:
        // a failure here must not flip an otherwise-good login.
        try {
          const frames: FrameSessionStorage[] = [];
          for (const frame of page.frames()) {
            let kv: Record<string, string> | null = null;
            try {
              kv = await frame.evaluate(() => {
                const o: Record<string, string> = {};
                for (let i = 0; i < sessionStorage.length; i++) {
                  const k = sessionStorage.key(i);
                  if (k !== null) o[k] = sessionStorage.getItem(k) ?? '';
                }
                return o;
              });
            } catch {
              // cross-origin / restricted / detached frame — skip its capture.
              kv = null;
            }
            frames.push({ url: frame.url(), kv });
          }
          const map = buildMultiOriginSessionStorageMap(frames);
          const artifact = JSON.parse(readFileSync(storageStateOut, 'utf8'));
          mergeMultiOriginSessionStorageIntoArtifact(artifact, map);
          writeFileSync(storageStateOut, JSON.stringify(artifact));
          const origins = Object.keys(map);
          const keyCount = origins.reduce((n, o) => n + Object.keys(map[o]).length, 0);
          log(
            `sessionStorage captured across ${origins.length} origin(s) [${origins.join(', ')}]: ${keyCount} key(s) total`
          );
        } catch (err) {
          log(
            `sessionStorage capture failed (non-fatal, storageState still written): ${err instanceof Error ? err.message : String(err)}`
          );
        }
      } catch (err) {
        log(
          `storage-state export failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // 8) Optional on-page text assertion (--expect-text). Runs on a
    //    confirmed-authed landing; a missing token flips the final ok to false
    //    so the exit code is a usable CI gate. Case-sensitive substring match —
    //    phase names / metric keys are exact tokens.
    let expectFound: string[] | undefined;
    let expectMissing: string[] | undefined;
    if (ok && expectText.length > 0) {
      const body = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
      expectFound = expectText.filter((t) => body.includes(t));
      expectMissing = expectText.filter((t) => !body.includes(t));
      if (expectMissing.length > 0) log(`expect-text missing: ${expectMissing.join(', ')}`);
    }

    const finalOk = ok && (expectMissing?.length ?? 0) === 0;

    return {
      ok: finalOk,
      finalUrl,
      landingPath,
      onAppLoginPage,
      stillOnCognito,
      errorText,
      uiBridgeRoute,
      uiBridgeRegistered: snap?.registration?.totalRegistered ?? null,
      postLoginClicked,
      expectFound,
      expectMissing,
      screenshotPath: screenshotPath ? screenshotWritten : undefined,
      storageStatePath: storageStateOut ? storageStateWritten : undefined,
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
