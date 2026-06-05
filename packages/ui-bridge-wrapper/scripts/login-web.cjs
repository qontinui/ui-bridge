#!/usr/bin/env node
/**
 * login-web.cjs — automated web login via the UI Bridge **injected transport**
 * (Variant A, in-process). Logs into a Cognito-fronted web app by driving the
 * full OAuth redirect chain inside ONE headless Chromium tab: the injected
 * `@qontinui/ui-bridge` bundle re-injects on every navigation (via
 * `context.addInitScript`), so the app login page, the cross-origin Cognito
 * hosted UI, and the post-callback authed page are all the same driven session.
 *
 * No relay: relay mode (page -> localhost relay) is blocked by Chrome Local
 * Network Access against a public origin. Variant A drives via Playwright
 * (`ctx.page`, exposed by the injected transport) — no page->localhost fetch.
 *
 * MUST be run from the ui-bridge repo root so `@qontinui/ui-bridge` (the engine
 * bundle) resolves:
 *   cd D:/qontinui-root/ui-bridge
 *   node packages/ui-bridge-wrapper/scripts/login-web.cjs \
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
 */
const { createTransport } = require('../dist/index.cjs');

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
};
const flag = (name) => argv.includes(name);

const URL_ = arg('--url', 'https://qontinui.io/login');
const EMAIL = arg('--email', process.env.UIB_LOGIN_EMAIL);
const PASSWORD = arg('--password', process.env.UIB_LOGIN_PASSWORD);
const SUCCESS = arg('--success', '/dashboard'); // pathname substring the authed landing must contain (strict — query/fragment excluded)
const TIMEOUT = parseInt(arg('--timeout', '60000'), 10);
const HEADED = flag('--headed');
// Optional CSS selector to click ONCE on the authed landing page, e.g. the
// co-pilot session-consent button `[data-testid='co-pilot-consent-allow']` —
// granting that consent is what mounts the app's CommandRelayListener, so the
// tab registers with the SAME-ORIGIN relay (combine with --keep-open to hold
// the registered session for relay-driven /control/* calls). Non-fatal when
// the target never appears (consent already granted this session, account
// pref off) — the caller's relay connectedTabs poll is the real gate.
const POST_CLICK = arg('--post-login-click', null);

const log = (m) => process.stderr.write(`[login-web] ${m}\n`);

if (!EMAIL || !PASSWORD) {
  process.stderr.write('login-web: need --email/--password or env UIB_LOGIN_EMAIL / UIB_LOGIN_PASSWORD\n');
  process.exit(2);
}

// Cognito is identified by HOST (custom domain / raw Cognito domain) or the
// /oauth2/ endpoints — never by a bare `/login?` path match: the app's own
// login URL legitimately carries a query now (`--url …/login?next=%2Fco-pilot`
// is the recommended deterministic-landing form since web #439), and a path
// match would (a) misreport a bounced-back-to-login failure as
// `stillOnCognito` instead of `onAppLoginPage`, and (b) let the step-2
// waitForURL instant-match the app's own login page instead of waiting for
// the real hosted-UI hop.
const isCognito = (u) => /auth\.qontinui\.io|amazoncognito\.com|\/oauth2\//i.test(String(u));
// Strict success check: compare --success against the URL's PATHNAME only.
// Matching the whole URL let query params fake success (e.g. `state=…/co-pilot`
// on a stuck /auth/callback) — see the 2026-06-04 false positive.
const pathOf = (u) => {
  try {
    return new URL(typeof u === 'string' ? u : u.toString()).pathname;
  } catch {
    return '';
  }
};
const isSuccess = (u) => pathOf(u).includes(SUCCESS);
const isAppLogin = (u) => /\/login(\b|\/|$)/.test(pathOf(u)) && !isCognito(u);

(async () => {
  const transport = createTransport({
    kind: 'injected',
    options: { targetUrl: URL_, waitForSettle: false, readyTimeoutMs: 45000, headed: HEADED },
  });

  transport.register('drive', async (_p, ctx) => {
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
    await page.waitForURL((u) => isCognito(u.toString()) || isSuccess(u.toString()), {
      timeout: TIMEOUT,
    });

    if (isCognito(page.url())) {
      await page.waitForLoadState('domcontentloaded');
      log(`cognito ${page.url()}`);
      // 3) Fill the Cognito hosted-UI form. Try classic + managed-login selectors.
      // Classic Cognito hosted UI renders a hidden duplicate of the form (an
      // inline copy + a modal copy); pick the VISIBLE match, not just .first().
      const fillFirst = async (sels, val, what) => {
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
        ['#signInFormUsername', 'input[name="username"]', 'input[type="email"]', 'input[autocomplete="username"]'],
        EMAIL,
        'email'
      );
      await fillFirst(
        ['#signInFormPassword', 'input[name="password"]', 'input[type="password"]', 'input[autocomplete="current-password"]'],
        PASSWORD,
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
      await page.waitForURL((u) => isSuccess(u.toString()) || /\/auth\/callback/.test(u.toString()), {
        timeout: TIMEOUT,
      });
      if (/\/auth\/callback/.test(page.url())) {
        await page.waitForURL((u) => isSuccess(u.toString()), { timeout: TIMEOUT }).catch(() => {});
      }
    }

    await page.waitForLoadState('networkidle').catch(() => {});
    const finalUrl = page.url();
    log(`final ${finalUrl}`);

    // 5) Confirm via the UI Bridge runtime on the authed page (re-injected there).
    await page
      .waitForFunction(() => window.__uiBridgeInjected?.ready === true, { timeout: 15000 })
      .catch(() => {});
    let snap = null;
    try {
      snap = await ctx.snapshot();
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
    const ok = !isAppLogin(finalUrl) && !isCognito(finalUrl) && landingPath.includes(SUCCESS);

    // On failure, surface any visible error card so the result is
    // self-diagnosing (the oauth-state-mismatch repro required a separate
    // page read just to learn WHY the flow stalled).
    let errorText = null;
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
    let postLoginClicked = null;
    if (ok && POST_CLICK) {
      postLoginClicked = false;
      try {
        const target = page.locator(POST_CLICK).first();
        await target.waitFor({ state: 'visible', timeout: 20000 });
        await target.click();
        postLoginClicked = true;
        log(`post-login click: ${POST_CLICK}`);
      } catch {
        log(`post-login click target never visible (non-fatal): ${POST_CLICK}`);
      }
    }

    return {
      ok,
      finalUrl,
      landingPath,
      onAppLoginPage: isAppLogin(finalUrl),
      stillOnCognito: isCognito(finalUrl),
      errorText,
      uiBridgeRoute,
      uiBridgeRegistered: snap?.registration?.totalRegistered ?? null,
      postLoginClicked,
    };
  });

  let result;
  let code = 0;
  try {
    await transport.ready();
    result = await transport.dispatch('drive');
    code = result && result.ok ? 0 : 1;
  } catch (err) {
    result = { ok: false, error: err && err.message ? err.message : String(err) };
    code = 1;
  }

  process.stdout.write(JSON.stringify(result) + '\n');

  if (flag('--keep-open') && result && result.ok) {
    log('--keep-open: authed session parked; press Ctrl+C to exit');
    const stop = async () => {
      await transport.close().catch(() => {});
      process.exit(0);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    setInterval(() => {}, 1 << 30);
    return;
  }

  await transport.close().catch(() => {});
  process.exit(code);
})();
