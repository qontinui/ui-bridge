import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createTransport } from '../src/create-transport.js';
import { buildTransportOptions, parseArgs } from '../src/inject-cli.js';

/**
 * Browser smoke for the injected-transport CLI flow (Variant A, in-process).
 *
 * We serve a tiny login page that ships ZERO UI Bridge code, then drive the
 * CLI's exported option-builder through a real injected transport (real
 * Chromium) and assert the email/password/submit controls surface via the
 * injected runtime — i.e. the goal is confirmed ON THE PAGE, not by an HTTP
 * status.
 *
 * We exercise the in-process flow (no dist dependency) for determinism. A full
 * Variant-B `/tabs` relay-registration smoke needs a running relay server and
 * is covered as Phase-4 manual validation, so it is intentionally NOT built here.
 */

const LOGIN_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Sign in</title></head>
<body>
  <main>
    <h1>Sign in</h1>
    <form id="login">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" autocomplete="username" />
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" />
      <button type="submit">Sign in</button>
    </form>
  </main>
</body>
</html>`;

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(LOGIN_HTML);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}/login`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('inject-cli smoke (real Chromium, injected runtime)', () => {
  it(
    'surfaces the login controls on a UI-Bridge-free page via the injected transport',
    async () => {
      // Build options exactly as the CLI would for a Variant-A exec run.
      const args = parseArgs([
        '--url',
        baseUrl,
        '--exec',
        'getControlSnapshot {}',
        '--ready-timeout',
        '30000',
      ]);
      const options = buildTransportOptions(args);
      expect(options.targetUrl).toBe(baseUrl);

      const transport = createTransport({ kind: 'injected', options });

      // Mirror the CLI's passthrough registration for exec actions.
      const passthrough = (action: string) => {
        if (!transport.handlerRegistry.has(action)) {
          transport.register(action, (params: unknown, ctx: unknown) =>
            (ctx as { execute(a: string, p?: unknown): Promise<unknown> }).execute(action, params)
          );
        }
      };

      try {
        await transport.ready();

        passthrough('getControlSnapshot');
        const snapshot = (await transport.dispatch('getControlSnapshot', {})) as unknown;
        const snapText = JSON.stringify(snapshot).toLowerCase();
        // The injected runtime should see the password field and the submit
        // control on the page (goal confirmed ON THE PAGE).
        expect(snapText).toContain('password');
        expect(snapText).toContain('sign in');

        passthrough('find');
        const found = (await transport.dispatch('find', { text: 'Sign in' })) as unknown;
        expect(JSON.stringify(found).toLowerCase()).toContain('sign in');
      } finally {
        await transport.close().catch(() => {});
      }
    },
    60_000
  );
});
