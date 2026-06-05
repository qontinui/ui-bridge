/**
 * Shared Cognito login drive + URL classifiers for the browser-driving package
 * bins (`ui-bridge-login-web`, `ui-bridge-capture-specs`). Both CLIs used to
 * carry their own (drifted) copies of this logic; this is the single home.
 *
 * The drive takes a Playwright {@link Page} directly (type-only import — the
 * `playwright` package is a tsup EXTERNAL + a devDep, so nothing here couples to
 * the transport / CLI layer or `InjectedContext`). It performs the OAuth chain
 * from the app login page up to a *generic authed landing* and returns a
 * structured {@link LoginDriveResult} — it never throws on a non-authed landing.
 */

import type { Page } from 'playwright';

/**
 * Cognito is identified by HOST (custom domain / raw Cognito domain) or the
 * /oauth2/ endpoints — never by a bare `/login?` path match: the app's own
 * login URL legitimately carries a query now (`--url …/login?next=%2Fco-pilot`
 * is the recommended deterministic-landing form since web #439), and a path
 * match would (a) misreport a bounced-back-to-login failure as `stillOnCognito`
 * instead of `onAppLoginPage`, and (b) let the step-2 waitForURL instant-match
 * the app's own login page instead of waiting for the real hosted-UI hop (#85).
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
 * on a stuck /auth/callback) — see the 2026-06-04 false positive (#81).
 */
export const isSuccessPath = (u: string, success: string): boolean =>
  pathOf(u).includes(success);

/**
 * True when the URL is the app's OWN /login page (not the Cognito hosted UI).
 * Strict URL checks compare PATHNAMES, never the whole URL — a query param
 * echoing a path (state=…%2Fco-pilot) must not fake a match (#81).
 */
export const isAppLoginPath = (u: string): boolean =>
  /\/login(\b|\/|$)/.test(pathOf(u)) && !isCognito(u);

/** Outcome of {@link loginDrive}. `ok` ⇒ landed on a generic authed page. */
export interface LoginDriveResult {
  ok: boolean;
  finalUrl: string;
  landingPath: string;
  errorText: string | null;
}

/** Options for {@link loginDrive}. */
export interface LoginDriveOptions {
  email: string;
  password: string;
  /** Per-redirect-hop wait budget (ms). */
  timeoutMs: number;
  /** Optional stderr logger (each CLI passes its own prefixed logger). */
  log?: (m: string) => void;
}

/**
 * Scrape the first visible error card on the page into a <=500-char string, or
 * null. Best-effort: a missing/empty card just yields null. Exported so callers
 * that apply their own stricter post-drive assertions (login-web's `--success`)
 * can reuse the same walk when THEIR check fails on a clean drive landing.
 */
export async function scrapeErrorCard(page: Page): Promise<string | null> {
  try {
    const alerts = page.locator(
      '[role="alert"], #loginErrorMessage, .error-message, [class*="error" i], [data-testid*="error" i]'
    );
    const an = await alerts.count();
    for (let i = 0; i < an; i++) {
      const el = alerts.nth(i);
      if (await el.isVisible().catch(() => false)) {
        const t = (await el.innerText().catch(() => '')).trim();
        if (t) return t.slice(0, 500);
      }
    }
  } catch {
    /* best-effort */
  }
  return null;
}

/**
 * Drive the Cognito hosted-UI login flow from the app login page (already loaded
 * in `page`) up to a generic authed landing (left Cognito AND not on
 * `/auth/callback` AND not bounced back to the app login page).
 *
 * Returns a {@link LoginDriveResult}; it does NOT throw on a non-authed landing.
 * Selector-walk failures inside the flow (e.g. "Cognito email field (visible)
 * not found") still throw — those are real "the page isn't what we expected"
 * conditions, not landing outcomes, and match both prior copies' behavior.
 */
export async function loginDrive(
  page: Page,
  { email, password, timeoutMs, log = () => {} }: LoginDriveOptions
): Promise<LoginDriveResult> {
  // 1) App login landing (qontinui.io/login). Buttons aren't SDK-registered, so
  //    locate by visible text via Playwright.
  log(`landed ${page.url()}`);
  const emailBtn = page
    .getByRole('button', { name: /continue with email/i })
    .or(page.getByText(/continue with email/i));
  await emailBtn.first().waitFor({ state: 'visible', timeout: 15000 });
  await emailBtn.first().click();

  // 2) Wait for EITHER the Cognito hosted UI (form to fill) OR an already-authed
  //    landing (a live Cognito SSO session can skip the form). Generic predicate:
  //    "hit the hosted UI, or already landed authed somewhere (not the app login,
  //    not the callback)".
  await page.waitForURL(
    (u) => {
      const s = u.toString();
      return isCognito(s) || (!isAppLoginPath(s) && !/\/auth\/callback/.test(pathOf(s)));
    },
    { timeout: timeoutMs }
  );

  if (isCognito(page.url())) {
    await page.waitForLoadState('domcontentloaded');
    log(`cognito ${page.url()}`);

    // 3) Fill the Cognito hosted-UI form. Classic Cognito renders a hidden
    //    duplicate of the form (an inline copy + a modal copy); pick the VISIBLE
    //    match, not just .first().
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

    // Click the VISIBLE submit (same hidden-duplicate caveat), role fallback.
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

    // 4) Cognito -> /auth/callback (PKCE exchange) -> authed landing. "Not on
    //    Cognito anymore" is NOT authed — /auth/callback can be stuck on an
    //    error card (the 2026-06-04 state-mismatch false positive). Wait for the
    //    redirect chain to LEAVE both Cognito and /auth/callback. On timeout,
    //    DON'T throw — scrape the error card and return ok:false.
    try {
      await page.waitForURL(
        (u) => {
          const s = u.toString();
          return !isCognito(s) && !/\/auth\/callback/.test(pathOf(s));
        },
        { timeout: timeoutMs }
      );
    } catch {
      const errorText = await scrapeErrorCard(page);
      const finalUrl = page.url();
      log(`final ${finalUrl} (stalled)`);
      return { ok: false, finalUrl, landingPath: pathOf(finalUrl), errorText };
    }
  }

  // 5) Generic authed landing. An in-page evaluate proves JS executes on the
  //    landing (the helper deliberately has no ctx.snapshot()).
  await page.waitForLoadState('networkidle').catch(() => {});
  await page
    .waitForFunction(
      () => (window as { __uiBridgeInjected?: { ready?: boolean } }).__uiBridgeInjected?.ready === true,
      { timeout: 15000 }
    )
    .catch(() => {});

  const finalUrl = page.url();
  log(`final ${finalUrl}`);
  const landingPath = await page
    .evaluate(() => location.pathname)
    .catch(() => pathOf(finalUrl));

  const ok =
    !isAppLoginPath(finalUrl) &&
    !isCognito(finalUrl) &&
    !/\/auth\/callback/.test(pathOf(finalUrl));

  const errorText = ok ? null : await scrapeErrorCard(page);
  return { ok, finalUrl, landingPath, errorText };
}
