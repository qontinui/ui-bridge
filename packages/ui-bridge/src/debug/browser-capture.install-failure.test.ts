/**
 * A sub-install that throws must not leave the sub-modules installed before it
 * patched in place: install() undoes them and rethrows, and a later install()
 * starts from a clean slate instead of stacking a second set of patches. A
 * cleanup that throws does not stop the cleanups after it.
 */

import { afterEach, expect, it, vi } from 'vitest';

const mode = vi.hoisted(() => ({ installThrows: true, cleanupThrows: false, hmrThrows: false }));

vi.mock('./captures/web-vitals', () => ({
  installWebVitalsCapture: () => {
    if (mode.installThrows) throw new Error('web-vitals install failed');
    return () => {
      if (mode.cleanupThrows) throw new Error('web-vitals cleanup failed');
    };
  },
}));

vi.mock('./captures/hmr', () => ({
  installHmrCapture: () => {
    if (mode.hmrThrows) throw new Error('hmr install failed');
    return () => {};
  },
}));

import { BrowserEventCapture } from './browser-capture';

afterEach(() => {
  mode.installThrows = true;
  mode.cleanupThrows = false;
  mode.hmrThrows = false;
  vi.restoreAllMocks();
});

const config = { console: true, network: true, navigation: true, webVitals: true };

it('a throwing sub-install undoes the sub-installs before it and rethrows', () => {
  const originalFetch = window.fetch;
  const originalWarn = console.warn;
  const originalPushState = history.pushState;
  const capture = new BrowserEventCapture(config);

  expect(() => capture.install()).toThrow('web-vitals install failed');
  expect(window.fetch).toBe(originalFetch);
  expect(console.warn).toBe(originalWarn);
  expect(history.pushState).toBe(originalPushState);

  mode.installThrows = false;
  capture.install();
  expect(window.fetch).not.toBe(originalFetch);
  expect(history.pushState).not.toBe(originalPushState);
  capture.uninstall();
  expect(window.fetch).toBe(originalFetch);
  expect(console.warn).toBe(originalWarn);
  expect(history.pushState).toBe(originalPushState);
});

it('a throwing cleanup does not stop the others, and is reported to the restored console', () => {
  const originalFetch = window.fetch;
  const originalPushState = history.pushState;
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  mode.installThrows = false;
  mode.cleanupThrows = true;
  const capture = new BrowserEventCapture(config);
  const onEvent = vi.fn();
  capture.setOnEvent(onEvent);
  capture.install();

  capture.uninstall();
  expect(window.fetch).toBe(originalFetch);
  expect(history.pushState).toBe(originalPushState);
  expect(warn).toHaveBeenCalledWith('[ui-bridge] capture cleanup failed', expect.any(Error));
  expect(onEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'console' }));
});

it('a rollback whose cleanup also throws still rethrows the install error', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const originalFetch = window.fetch;
  mode.installThrows = false;
  mode.cleanupThrows = true;
  mode.hmrThrows = true;
  const capture = new BrowserEventCapture({ ...config, hmr: true });

  expect(() => capture.install()).toThrow('hmr install failed');
  expect(window.fetch).toBe(originalFetch);
});
