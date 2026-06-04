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
 *     --url https://qontinui.io/login \
 *     [--email <e> --password <p>]   (or env UIB_LOGIN_EMAIL / UIB_LOGIN_PASSWORD) \
 *     [--success /dashboard] [--headed] [--timeout 60000] [--keep-open]
 *
 * Prints ONE JSON result line to stdout: {ok, finalUrl, route, ...}. Exit 0 = login confirmed.
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
const SUCCESS = arg('--success', '/dashboard'); // substring the authed final URL should contain
const TIMEOUT = parseInt(arg('--timeout', '60000'), 10);
const HEADED = flag('--headed');

const log = (m) => process.stderr.write(`[login-web] ${m}\n`);

if (!EMAIL || !PASSWORD) {
  process.stderr.write('login-web: need --email/--password or env UIB_LOGIN_EMAIL / UIB_LOGIN_PASSWORD\n');
  process.exit(2);
}

const isCognito = (u) => /auth\.qontinui\.io|amazoncognito\.com|\/oauth2\/|\/login\?/i.test(u);
const isSuccess = (u) => u.includes(SUCCESS);
const isAppLogin = (u) => /\/login(\b|\/|\?|$)/.test(u) && !isCognito(u);

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

    const ok = !isAppLogin(finalUrl) && (isSuccess(finalUrl) || !isCognito(finalUrl));
    return {
      ok,
      finalUrl,
      onAppLoginPage: isAppLogin(finalUrl),
      stillOnCognito: isCognito(finalUrl),
      uiBridgeRoute: snap?.route ?? null,
      uiBridgeRegistered: snap?.registration?.totalRegistered ?? null,
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
