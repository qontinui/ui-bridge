/**
 * A sub-install that throws must not leave the sub-modules installed before it
 * patched in place: install() undoes them and rethrows, and a later install()
 * starts from a clean slate instead of stacking a second set of patches.
 */

import { afterEach, expect, it, vi } from 'vitest';

const failNext = vi.hoisted(() => ({ value: true }));

vi.mock('./captures/web-vitals', () => ({
  installWebVitalsCapture: () => {
    if (failNext.value) throw new Error('web-vitals install failed');
    return () => {};
  },
}));

import { BrowserEventCapture } from './browser-capture';

afterEach(() => {
  failNext.value = true;
});

it('a throwing sub-install undoes the sub-installs before it and rethrows', () => {
  const originalFetch = window.fetch;
  const originalWarn = console.warn;
  const capture = new BrowserEventCapture({ console: true, network: true, webVitals: true });

  expect(() => capture.install()).toThrow('web-vitals install failed');
  expect(window.fetch).toBe(originalFetch);
  expect(console.warn).toBe(originalWarn);

  failNext.value = false;
  capture.install();
  expect(window.fetch).not.toBe(originalFetch);
  capture.uninstall();
  expect(window.fetch).toBe(originalFetch);
  expect(console.warn).toBe(originalWarn);
});
