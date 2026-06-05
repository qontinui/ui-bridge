#!/usr/bin/env node
/**
 * capture-coord-specs.cjs — log into qontinui-web (injected transport) and
 * capture live getControlSnapshots of the admin coord pages, in-process.
 * Extends login-web.cjs: same Variant-A injected login (drives the Cognito
 * OAuth chain), then `ctx.page.goto`s each target authed page and snapshots the
 * re-injected runtime. Writes one snapshot JSON per page (input for spec authoring).
 *
 * The login deep-links through the FIRST same-origin target via `?next=`, so
 * the authed landing is deterministic (that target itself) instead of the
 * app's situational /dashboard-vs-/build pick. Safe since web #439
 * (`311dd963`) base64url-packed the OAuth state — pre-#439, any `%xx`-bearing
 * state failed "OAuth state mismatch" on the email return path.
 *
 * Run from the ui-bridge repo root; creds via env UIB_LOGIN_EMAIL/PASSWORD or --email/--password.
 *   node packages/ui-bridge-wrapper/scripts/capture-coord-specs.cjs --out D:/qontinui-root/spec-capture
 */
const fs = require('fs');
const path = require('path');
const { createTransport } = require('../dist/index.cjs');

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const EMAIL = arg('--email', process.env.UIB_LOGIN_EMAIL);
const PASSWORD = arg('--password', process.env.UIB_LOGIN_PASSWORD);
const OUT = arg('--out', 'D:/qontinui-root/spec-capture');
const ORIGIN = arg('--origin', 'https://qontinui.io');
const DEVICE = arg('--device', 'c79a07d5-7e40-49b4-87fa-554c749f9644'); // spaceship: gives the trees page real cards
const TIMEOUT = parseInt(arg('--timeout', '70000'), 10);
const log = (m) => process.stderr.write(`[capture] ${m}\n`);

if (!EMAIL || !PASSWORD) { process.stderr.write('need creds (UIB_LOGIN_EMAIL/PASSWORD)\n'); process.exit(2); }

// Pages to capture. Default = the two admin coord pages, but any authed page
// set can be supplied via `--pages "slug=path,slug=path"` (paths are joined to
// --origin; absolute http(s) URLs are used verbatim). This makes the script a
// general "log in + snapshot these authed pages" capture tool, not coord-only.
function parsePages(spec) {
  return spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf('=');
      const slug = pair.slice(0, eq).trim();
      const ref = pair.slice(eq + 1).trim();
      const url = /^https?:\/\//i.test(ref) ? ref : `${ORIGIN}${ref.startsWith('/') ? '' : '/'}${ref}`;
      return { slug, url };
    });
}
const PAGES_ARG = arg('--pages', null);
const TARGETS = PAGES_ARG
  ? parsePages(PAGES_ARG)
  : [
      { slug: 'admin-coord-trees', url: `${ORIGIN}/admin/coord/trees?device_id=${DEVICE}` },
      { slug: 'admin-coord-pull-decisions', url: `${ORIGIN}/admin/coord/pull-decisions` },
    ];

// Cognito is identified by HOST (custom domain / raw Cognito domain) or the
// /oauth2/ endpoints — never by a bare `/login?` path match: the app's own
// login URL now legitimately carries a query (`/login?next=…`), and a path
// match would misclassify it as Cognito, silently disabling the
// bounced-back-to-login detection below.
const isCognito = (u) => /auth\.qontinui\.io|amazoncognito\.com|\/oauth2\//i.test(String(u));
// Strict URL checks compare PATHNAMES, never the whole URL — a query param
// echoing a path (state=…%2Fco-pilot) must not fake a match. Same fix as
// login-web.cjs (#81).
const pathOf = (u) => {
  try {
    return new URL(typeof u === 'string' ? u : u.toString()).pathname;
  } catch {
    return '';
  }
};
const isLoginPath = (u) => /\/login(\b|\/|$)/.test(pathOf(u)) && !isCognito(typeof u === 'string' ? u : u.toString());

async function fillVisible(page, sels, val, what) {
  for (const s of sels) {
    const loc = page.locator(s); const n = await loc.count().catch(() => 0);
    for (let i = 0; i < n; i++) { const el = loc.nth(i); if (await el.isVisible().catch(() => false)) { await el.fill(val, { timeout: 10000 }); return; } }
  }
  throw new Error(`Cognito ${what} field not found`);
}

// Deep-link the login through the first same-origin target (`?next=`) so the
// post-login landing is the target itself. Cross-origin first targets
// (absolute --pages URLs) can't ride `next` — the callback's open-redirect
// guard only honors same-origin "/" paths — so those fall back to bare /login.
const firstNext = (() => {
  try {
    const u = new URL(TARGETS[0].url);
    if (u.origin === new URL(ORIGIN).origin) return u.pathname + u.search;
  } catch { /* fall through to bare /login */ }
  return null;
})();
const LOGIN_URL = firstNext ? `${ORIGIN}/login?next=${encodeURIComponent(firstNext)}` : `${ORIGIN}/login`;
// What the post-login landing should look like: the first target's pathname
// when deep-linking, else the app's situational /dashboard-or-/build pick.
const landedAuthed = (u) => (firstNext
  ? pathOf(u) === pathOf(`${ORIGIN}${firstNext}`)
  : (pathOf(u).includes('/dashboard') || pathOf(u).includes('/build')));

(async () => {
  const transport = createTransport({
    kind: 'injected',
    options: { targetUrl: LOGIN_URL, waitForSettle: false, readyTimeoutMs: 45000 },
  });

  transport.register('run', async (_p, ctx) => {
    const page = ctx.page;
    // --- login (same flow as login-web.cjs) ---
    log(`login: ${page.url()}`);
    await page.getByRole('button', { name: /continue with email/i }).or(page.getByText(/continue with email/i)).first()
      .click({ timeout: 20000 });
    await page.waitForURL((u) => isCognito(u.toString()) || landedAuthed(u), { timeout: TIMEOUT });
    if (isCognito(page.url())) {
      await page.waitForLoadState('domcontentloaded');
      await fillVisible(page, ['#signInFormUsername', 'input[name="username"]', 'input[type="email"]'], EMAIL, 'email');
      await fillVisible(page, ['#signInFormPassword', 'input[name="password"]', 'input[type="password"]'], PASSWORD, 'password');
      const sub = page.locator('input[name="signInSubmitButton"], button[type="submit"], input[type="submit"]');
      const sn = await sub.count(); let done = false;
      for (let i = 0; i < sn; i++) { if (await sub.nth(i).isVisible().catch(() => false)) { await sub.nth(i).click(); done = true; break; } }
      if (!done) await page.getByRole('button', { name: /sign in|continue/i }).first().click();
      // "Not on Cognito anymore" is NOT authed — /auth/callback can be stuck
      // on an error card (the 2026-06-04 state-mismatch false positive). Wait
      // for the redirect chain to LEAVE the callback; on timeout, surface the
      // visible error card so the failure is self-diagnosing.
      try {
        await page.waitForURL(
          (u) => !isCognito(u.toString()) && !/^\/auth\/callback/.test(pathOf(u)),
          { timeout: TIMEOUT }
        );
      } catch (e) {
        let errorText = null;
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

    // --- capture each coord page ---
    const out = [];
    for (const t of TARGETS) {
      log(`navigate ${t.url}`);
      await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
      await page.waitForFunction(() => window.__uiBridgeInjected?.ready === true, { timeout: 20000 }).catch(() => {});
      // give the page's 10s poll + data fetch time to populate, then settle
      await ctx.whenSettled(12000).catch(() => {});
      await page.waitForTimeout(2500); // let the coord data-fetch + render land
      let snap = null, err = null;
      try { snap = await ctx.snapshot(); } catch (e) { err = e && e.message ? e.message : String(e); }
      const finalUrl = page.url();
      const onLogin = isLoginPath(finalUrl);
      out.push({ slug: t.slug, requestedUrl: t.url, finalUrl, onLogin, error: err,
        route: snap?.route ?? null, totalRegistered: snap?.registration?.totalRegistered ?? null, snapshot: snap });
      log(`  -> route=${snap?.route} registered=${snap?.registration?.totalRegistered} onLogin=${onLogin}`);
    }
    return out;
  });

  let result, code = 0;
  try { await transport.ready(); result = await transport.dispatch('run'); }
  catch (e) { result = { error: e && e.message ? e.message : String(e) }; code = 1; }
  finally { await transport.close().catch(() => {}); }

  if (Array.isArray(result)) {
    fs.mkdirSync(OUT, { recursive: true });
    for (const r of result) {
      const f = path.join(OUT, `${r.slug}.snapshot.json`);
      fs.writeFileSync(f, JSON.stringify(r.snapshot ?? { error: r.error }, null, 2));
      process.stdout.write(JSON.stringify({ slug: r.slug, finalUrl: r.finalUrl, route: r.route, totalRegistered: r.totalRegistered, onLogin: r.onLogin, file: f }) + '\n');
    }
    // Exit non-zero if any capture failed — a snapshot of a login bounce or
    // an errored page is not a capture. (Previously a fully failed run could
    // still exit 0 with garbage snapshot files.)
    if (result.some((r) => r.onLogin || r.error)) code = 1;
  } else {
    process.stdout.write(JSON.stringify(result) + '\n');
  }
  process.exit(code);
})();
