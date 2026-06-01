import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { createTransport } from '../src/create-transport.js';
import type { InjectedContext } from '../src/transports/injected.js';

/**
 * Settle smoke for the injected transport (real Chromium).
 *
 * Proves the hydration fix: against a client-rendered page that injects its
 * login form only AFTER a delay (no UI Bridge code), `ready()` with the default
 * settle-gating resolves only once the deferred content has painted — so the
 * first snapshot taken immediately after `ready()` already sees the form, with
 * NO caller-side polling. The companion `--no-settle` path is asserted to expose
 * the pre-fix behavior (ready resolves before the form exists).
 */

const PLAYWRIGHT_AVAILABLE = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

// The form is appended ~600ms after load — longer than the 500ms default quiet
// window's first arming, so a naive ready-only gate would miss it.
const DEFERRED_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Sign in</title></head>
<body>
  <main><h1>Loading…</h1></main>
  <script>
    setTimeout(function () {
      var main = document.querySelector('main');
      main.innerHTML =
        '<h1>Sign in</h1>' +
        '<form id="login">' +
        '<label for="email">Email</label>' +
        '<input id="email" name="email" type="email" />' +
        '<label for="password">Password</label>' +
        '<input id="password" name="password" type="password" />' +
        '<button type="submit">Sign in</button>' +
        '</form>';
    }, 600);
  </script>
</body>
</html>`;

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(DEFERRED_HTML);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}/login`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe.skipIf(!PLAYWRIGHT_AVAILABLE)('inject settle smoke (deferred render)', () => {
  it(
    'ready() waits for deferred content to settle, so the first snapshot sees the form',
    async () => {
      const transport = createTransport({
        kind: 'injected',
        options: {
          targetUrl: baseUrl,
          readyTimeoutMs: 30_000,
          settleQuietMs: 400,
          settleTimeoutMs: 20_000,
        },
      });
      transport.register('getControlSnapshot', (p: unknown, ctx: unknown) =>
        (ctx as InjectedContext).execute('getControlSnapshot', p)
      );

      try {
        await transport.ready(); // gated on settled by default

        const snapshot = (await transport.dispatch('getControlSnapshot', {})) as unknown;
        const snapText = JSON.stringify(snapshot).toLowerCase();
        // The deferred form is present at the FIRST snapshot — no polling.
        expect(snapText).toContain('password');
        expect(snapText).toContain('sign in');
        expect(snapText).not.toContain('loading');
      } finally {
        await transport.close().catch(() => {});
      }
    },
    60_000
  );

  it(
    'exposes settleState()/whenSettled() on the context, reporting elementCount',
    async () => {
      const transport = createTransport({
        kind: 'injected',
        options: { targetUrl: baseUrl, readyTimeoutMs: 30_000, settleQuietMs: 400 },
      });
      let captured: InjectedContext | null = null;
      transport.register('__ctx', (_p: unknown, ctx: unknown) => {
        captured = ctx as InjectedContext;
        return true;
      });

      try {
        await transport.ready();
        await transport.dispatch('__ctx');
        expect(captured).not.toBeNull();
        const state = await captured!.settleState();
        expect(state.settled).toBe(true);
        // The deferred form contributes interactive controls (2 inputs + button).
        expect(state.elementCount).toBeGreaterThanOrEqual(3);
      } finally {
        await transport.close().catch(() => {});
      }
    },
    60_000
  );

  it(
    'with waitForSettle=false, ready() can resolve before the deferred form paints',
    async () => {
      const transport = createTransport({
        kind: 'injected',
        options: { targetUrl: baseUrl, readyTimeoutMs: 30_000, waitForSettle: false },
      });
      transport.register('getControlSnapshot', (p: unknown, ctx: unknown) =>
        (ctx as InjectedContext).execute('getControlSnapshot', p)
      );

      try {
        await transport.ready(); // ready-only: returns at DOM-ready, pre-deferred-render
        const snapshot = (await transport.dispatch('getControlSnapshot', {})) as {
          registration?: { totalRegistered?: number };
        };
        // Pre-fix behavior: the form isn't there yet at ready-only time. This
        // documents WHY settle-gating is the default. (We assert the registry is
        // empty rather than racing the 600ms timer for the form's absence.)
        expect(snapshot.registration?.totalRegistered ?? 0).toBe(0);
      } finally {
        await transport.close().catch(() => {});
      }
    },
    60_000
  );
});

/**
 * Expected-selector gate (Gap 1): chrome paints first and goes quiet, THEN the
 * login form mounts ~1.2s later — past the quiet window. The plain settle gate
 * fires on the chrome (form absent); `expectSelector: '#login'` waits for the
 * form. And when the gated control never appears, `ready()` throws a structured
 * BLOCKED error instead of returning a control-less page.
 */
const CHROME_THEN_FORM_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>App</title></head>
<body>
  <header><nav><button type="button">Menu</button></nav></header>
  <main><p>Welcome</p></main>
  <script>
    // The login form mounts well AFTER the chrome has gone quiet (1200ms >
    // the 400ms settle quiet window), so a plain settle gate settles on the
    // chrome — only an expectSelector gate waits for #login.
    setTimeout(function () {
      var main = document.querySelector('main');
      main.innerHTML =
        '<form id="login">' +
        '<label for="email">Email</label>' +
        '<input id="email" name="email" type="email" />' +
        '<label for="password">Password</label>' +
        '<input id="password" name="password" type="password" />' +
        '<button type="submit">Sign in</button>' +
        '</form>';
    }, 1200);
  </script>
</body>
</html>`;

const CHROME_ONLY_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>App</title></head>
<body>
  <header><nav><button type="button">Menu</button></nav></header>
  <main><p>Welcome</p></main>
</body>
</html>`;

let chromeServer: Server;
let chromeUrl: string;
let chromeOnlyServer: Server;
let chromeOnlyUrl: string;

beforeAll(async () => {
  chromeServer = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(CHROME_THEN_FORM_HTML);
  });
  await new Promise<void>((resolve) => chromeServer.listen(0, '127.0.0.1', resolve));
  chromeUrl = `http://127.0.0.1:${(chromeServer.address() as AddressInfo).port}/login`;

  chromeOnlyServer = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(CHROME_ONLY_HTML);
  });
  await new Promise<void>((resolve) => chromeOnlyServer.listen(0, '127.0.0.1', resolve));
  chromeOnlyUrl = `http://127.0.0.1:${(chromeOnlyServer.address() as AddressInfo).port}/login`;
});

afterAll(async () => {
  if (chromeServer) await new Promise<void>((resolve) => chromeServer.close(() => resolve()));
  if (chromeOnlyServer)
    await new Promise<void>((resolve) => chromeOnlyServer.close(() => resolve()));
});

describe.skipIf(!PLAYWRIGHT_AVAILABLE)('inject settle smoke (expectSelector gate)', () => {
  it(
    'expectSelector waits for the lazily-mounted form past the quiet window',
    async () => {
      const transport = createTransport({
        kind: 'injected',
        options: {
          targetUrl: chromeUrl,
          readyTimeoutMs: 30_000,
          settleQuietMs: 400,
          settleTimeoutMs: 20_000,
          expectSelector: '#login',
        },
      });
      transport.register('getControlSnapshot', (p: unknown, ctx: unknown) =>
        (ctx as InjectedContext).execute('getControlSnapshot', p)
      );

      try {
        await transport.ready(); // gated on #login, not the chrome
        const snapshot = (await transport.dispatch('getControlSnapshot', {})) as unknown;
        const snapText = JSON.stringify(snapshot).toLowerCase();
        // The lazily-mounted form is present at the first snapshot.
        expect(snapText).toContain('password');
        expect(snapText).toContain('sign in');
      } finally {
        await transport.close().catch(() => {});
      }
    },
    60_000
  );

  it(
    'ready() throws INJECTED_EXPECT_SELECTOR_UNMET when the gated control never appears',
    async () => {
      const transport = createTransport({
        kind: 'injected',
        options: {
          targetUrl: chromeOnlyUrl,
          readyTimeoutMs: 30_000,
          settleQuietMs: 300,
          settleTimeoutMs: 1_500, // short cap: #login never mounts here
          expectSelector: '#login',
        },
      });

      try {
        await expect(transport.ready()).rejects.toMatchObject({
          code: 'INJECTED_EXPECT_SELECTOR_UNMET',
        });
      } finally {
        await transport.close().catch(() => {});
      }
    },
    60_000
  );

  it(
    'settleState reports settledByTimeout + expectSatisfied=false on the unmet page (no-settle escape)',
    async () => {
      // With waitForSettle=false ready() does not throw, so a driver can still
      // inspect the state machine's verdict directly.
      const transport = createTransport({
        kind: 'injected',
        options: {
          targetUrl: chromeOnlyUrl,
          readyTimeoutMs: 30_000,
          settleQuietMs: 300,
          settleTimeoutMs: 1_500,
          expectSelector: '#login',
          waitForSettle: false,
        },
      });
      let captured: InjectedContext | null = null;
      transport.register('__ctx', (_p: unknown, ctx: unknown) => {
        captured = ctx as InjectedContext;
        return true;
      });

      try {
        await transport.ready();
        await transport.dispatch('__ctx');
        const state = await captured!.whenSettled(5_000);
        expect(state.settled).toBe(true);
        expect(state.settledByTimeout).toBe(true);
        expect(state.expectSatisfied).toBe(false);
      } finally {
        await transport.close().catch(() => {});
      }
    },
    60_000
  );
});
