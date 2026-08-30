/**
 * End-to-end smoke for the two manual-test-loop findings, in a real Chromium
 * against the real injected engine.
 *
 * The page ships ZERO UI Bridge code and mutates itself 1200ms after load —
 * comfortably AFTER the injected runtime's default 500ms settle window, so
 * `ready()` returns on a page that is already "settled" and the driver is in
 * exactly the position iteration 3 was in:
 *
 *   B1  a card's `aria-label` flips from "(0 accounts)" to "(2 accounts)".
 *       The engine cached the label at first discovery and served the phantom
 *       zero forever, including on an explicit `discover`.
 *   B2  a row arrives late. With no wait action between `--exec` steps there
 *       was no way to await it except re-invoking the whole CLI (a fresh
 *       browser, a fresh page load) or the one-shot `--expect-selector` gate.
 *
 * The run is the two-step exec the remediation calls for —
 * `waitForSelector` then `discover` — with NO `--expect-selector`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { createTransport } from '../src/create-transport.js';
import { buildTransportOptions, parseArgs, registerWaitActions } from '../src/inject-cli.js';

const PLAYWRIGHT_AVAILABLE = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

/** Milliseconds after load at which the page mutates itself. */
const MUTATE_AFTER_MS = 1200;

const PAGE_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Account Usage</title></head>
<body>
  <main>
    <h1>Account</h1>
    <button id="usage-card" aria-label="Section: Account Usage (0 accounts)">Account Usage</button>
    <ul id="accounts"></ul>
  </main>
  <script>
    setTimeout(function () {
      var list = document.getElementById('accounts');
      ['first', 'second'].forEach(function (name) {
        var li = document.createElement('li');
        li.setAttribute('data-account-row', name);
        var b = document.createElement('button');
        b.setAttribute('aria-label', 'Account row ' + name);
        b.textContent = name;
        li.appendChild(b);
        list.appendChild(li);
      });
      document
        .getElementById('usage-card')
        .setAttribute('aria-label', 'Section: Account Usage (2 accounts)');
    }, ${MUTATE_AFTER_MS});
  </script>
</body>
</html>`;

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE_HTML);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}/account`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe.skipIf(!PLAYWRIGHT_AVAILABLE)(
  'inject smoke — late-arriving row + a label that changed after discovery',
  () => {
    it(
      'a two-step exec (waitForSelector, discover) awaits the row and reads the CURRENT label',
      async () => {
        const args = parseArgs([
          '--url',
          baseUrl,
          '--exec',
          'waitForSelector {"selector":"[data-account-row]","timeoutMs":15000}',
          '--exec',
          'discover {}',
          '--ready-timeout',
          '30000',
        ]);
        // The whole point of B2: no one-shot gate is configured.
        expect(args.expectSelector).toBeNull();
        expect(buildTransportOptions(args).expectSelector).toBeUndefined();
        expect(args.execActions.map((a) => a.action)).toEqual(['waitForSelector', 'discover']);

        const transport = createTransport({
          kind: 'injected',
          options: buildTransportOptions(args),
        });
        registerWaitActions(transport);

        try {
          await transport.ready();

          // Step 1 — the CLI-side wait. Without it the next step races the
          // page's own 1200ms mutation.
          const waited = (await transport.dispatch('waitForSelector', args.execActions[0]!
            .payload)) as { waited: boolean; elapsedMs: number };
          expect(waited.waited).toBe(true);

          // Step 2 — the read, forwarded into the page exactly as the CLI does.
          transport.register('discover', (params: unknown, ctx: unknown) =>
            (ctx as { execute(a: string, p?: unknown): Promise<unknown> }).execute(
              'discover',
              params
            )
          );
          const found = (await transport.dispatch('discover', {})) as {
            elements: { id: string; label?: string; accessibleName?: string }[];
          };

          // B2: the late rows are present.
          const rows = found.elements.filter((e) => (e.label ?? '').startsWith('Account row'));
          expect(rows).toHaveLength(2);

          // B1: the card's label is the CURRENT aria-label, not the one cached
          // at first discovery.
          const card = found.elements.find((e) => (e.label ?? '').includes('Account Usage'));
          expect(card).toBeDefined();
          expect(card!.label).toBe('Section: Account Usage (2 accounts)');
          // ...and it agrees with the live-derived field beside it.
          expect(card!.accessibleName).toBe('Section: Account Usage (2 accounts)');
        } finally {
          await transport.close().catch(() => {});
        }
      },
      90_000
    );
  }
);
