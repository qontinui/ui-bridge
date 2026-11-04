/**
 * ARMING — plan 2026-11-02-text-over-image-contrast-cannot-see-what-the-snapshot-left-out,
 * Phase 1.
 *
 * Enters where the injected population enters: the injected runtime's bootstrap
 * (`injected/bootstrap.ts`, built to `dist/injected/bundle.global.js` and added
 * to a page by inject-cli / the headless transports). Loading it installs
 * `window.__uiBridgeInjected`, and a driver reads the page through that api's
 * `execute('getControlSnapshot')` after `whenSettled()`. This test does exactly
 * that over a page past the seeder's 500-row content cap, and asserts the served
 * `registration.contentDropped` is the exact number of rows refused.
 *
 * Nothing but layout is mocked (jsdom lays nothing out).
 */

import { it, expect, beforeAll, afterAll, vi } from 'vitest';

beforeAll(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    width: 100,
    height: 20,
    top: 0,
    left: 0,
    right: 100,
    bottom: 20,
    toJSON: () => ({}),
  });
});

afterAll(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

// Seeding past 500 cells under jsdom is slow on a loaded CI runner.
it('the injected bootstrap serves registration.contentDropped = 11 for 510 cells and a heading', async () => {
  // 511 registrable elements against the seeder's cap of 500.
  const cells = Array.from({ length: 510 }, (_, i) => `<td>Cell ${i}</td>`).join('');
  document.body.innerHTML = `<table><tr>${cells}</tr></table><h1>Hero heading</h1>`;

  // Loading the bundle's entry module is what injecting it does: it boots.
  await import('./bootstrap');
  const runtime = window.__uiBridgeInjected!;
  expect(runtime.ready).toBe(true);
  await runtime.whenSettled(30_000);

  const snapshot = (await runtime.execute('getControlSnapshot', {})) as {
    registration: { contentDropped?: number };
    elements: Array<{ category?: string }>;
  };
  expect(snapshot.elements.filter((e) => e.category === 'content')).toHaveLength(500);
  expect(snapshot.registration.contentDropped).toBe(11);
}, 120_000);
