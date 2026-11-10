/**
 * Real-Chromium read-back: a launch whose first navigation fails leaves no
 * connected browser behind.
 *
 * `launcher.failed-launch.test.ts` pins the cleanup against a fake Playwright.
 * This reads it off a real Chromium. A failed launch returns no handle, so the
 * test spies `chromium.launch` to capture the Browser the launcher spawned,
 * navigates to a loopback port nothing listens on, and then asks that browser
 * whether it is still connected. Up to 0.7.0 it was: the rejection left
 * Chromium running with nothing for the caller to close (coord finding
 * 45a8ff13; plan
 * 2026-11-10-ui-bridge-relay-and-assert-batch-drop-fields-and-headless-leaks-chromium,
 * Phase 2).
 *
 * Gated on a Playwright Chromium being installed, the same convention as
 * `launcher.emulation.smoke.test.ts`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createServer, type AddressInfo } from 'node:net';
import { chromium, type Browser } from 'playwright';
import { launchHeadlessTab } from './launcher.js';
import { chromiumAvailable } from '../../../test-support/chromium-gate.mjs';

const PLAYWRIGHT_AVAILABLE = chromiumAvailable();

/** A loopback port that was free a moment ago and has nothing listening on it now. */
async function closedLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
  return port;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe.skipIf(!PLAYWRIGHT_AVAILABLE)(
  'launchHeadlessTab whose first navigation fails (real Chromium)',
  () => {
    it('rejects with the navigation error, and the browser it launched is no longer connected', async () => {
      const launched: Browser[] = [];
      const realLaunch = chromium.launch.bind(chromium);
      vi.spyOn(chromium, 'launch').mockImplementation(async (options) => {
        const browser = await realLaunch(options);
        launched.push(browser);
        return browser;
      });
      const url = `http://127.0.0.1:${await closedLoopbackPort()}/`;

      try {
        await expect(
          launchHeadlessTab({ url, headless: true, forwardConsole: false })
        ).rejects.toThrow(/net::ERR_CONNECTION_REFUSED/);
        expect(launched).toHaveLength(1);
        expect(launched[0]!.isConnected()).toBe(false);
      } finally {
        // On a launcher that leaks (the recorded red run) the browser is still
        // connected here; close it so the test itself never leaks a Chromium.
        await Promise.all(launched.map((browser) => browser.close().catch(() => undefined)));
      }
    }, 60_000);
  }
);
