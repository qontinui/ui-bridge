/**
 * Device-pixel-ratio and colour-scheme emulation reach the browser CONTEXT.
 *
 * `deviceScaleFactor` must be a `newContext` option: a Chromium launch flag
 * (`--force-device-scale-factor`) is overridden by Playwright's viewport
 * emulation, which this launcher always applies, so it never reaches
 * `window.devicePixelRatio` (measured 2026-10-13, plan
 * 2026-10-13-image-generation-and-visual-judgment, Phase 1 item 5). These cases
 * pin the context options with a fake Playwright; the sibling
 * `launcher.emulation.smoke.test.ts` reads the values back from a real page.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const recorded = vi.hoisted(() => ({
  contextOptions: [] as Record<string, unknown>[],
  launches: 0,
}));

vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn(async () => {
      recorded.launches += 1;
      return {
        newContext: vi.fn(async (opts: Record<string, unknown>) => {
          recorded.contextOptions.push(opts);
          return {
            addInitScript: vi.fn(async () => undefined),
            newPage: vi.fn(async () => ({
              on: vi.fn(),
              goto: vi.fn(async () => null),
              url: vi.fn(() => 'http://app.local/'),
              mainFrame: vi.fn(() => ({})),
            })),
          };
        }),
        close: vi.fn(async () => undefined),
      };
    }),
  },
}));

// vitest hoists vi.mock above this import, so the launcher binds the fake.
import { launchHeadlessTab, validateDeviceScaleFactor } from './launcher.js';

beforeEach(() => {
  recorded.contextOptions.length = 0;
  recorded.launches = 0;
});

describe('launchHeadlessTab — context emulation options', () => {
  it('passes deviceScaleFactor and colorScheme to newContext beside the viewport', async () => {
    const tab = await launchHeadlessTab({
      url: 'http://app.local/',
      headless: true,
      viewportWidth: 400,
      viewportHeight: 300,
      deviceScaleFactor: 2,
      colorScheme: 'dark',
      forwardConsole: false,
    });
    await tab.close();

    expect(recorded.contextOptions).toHaveLength(1);
    const opts = recorded.contextOptions[0]!;
    expect(opts.viewport).toEqual({ width: 400, height: 300 });
    expect(opts.deviceScaleFactor).toBe(2);
    expect(opts.colorScheme).toBe('dark');
  });

  it('passes a fractional device scale factor through unrounded', async () => {
    const tab = await launchHeadlessTab({
      url: 'http://app.local/',
      headless: true,
      deviceScaleFactor: 2.625,
      forwardConsole: false,
    });
    await tab.close();
    expect(recorded.contextOptions[0]!.deviceScaleFactor).toBe(2.625);
  });

  it('sets neither key when the caller asks for neither, so the defaults are unchanged', async () => {
    const tab = await launchHeadlessTab({
      url: 'http://app.local/',
      headless: true,
      forwardConsole: false,
    });
    await tab.close();
    const opts = recorded.contextOptions[0]!;
    expect('deviceScaleFactor' in opts).toBe(false);
    expect('colorScheme' in opts).toBe(false);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses deviceScaleFactor %s BEFORE launching a browser',
    async (bad) => {
      await expect(
        launchHeadlessTab({ url: 'http://app.local/', headless: true, deviceScaleFactor: bad })
      ).rejects.toThrow(/deviceScaleFactor must be a positive finite number/);
      expect(recorded.launches).toBe(0);
    }
  );

  it('refuses a colour scheme other than light or dark BEFORE launching a browser', async () => {
    await expect(
      launchHeadlessTab({
        url: 'http://app.local/',
        headless: true,
        colorScheme: 'sepia' as unknown as 'dark',
      })
    ).rejects.toThrow(/colorScheme must be 'light' or 'dark'/);
    expect(recorded.launches).toBe(0);
  });
});

describe('validateDeviceScaleFactor', () => {
  it('returns a positive finite value unchanged', () => {
    expect(validateDeviceScaleFactor(1)).toBe(1);
    expect(validateDeviceScaleFactor(1.5)).toBe(1.5);
  });

  it('rejects zero, negatives and non-finite values', () => {
    for (const bad of [0, -2, Number.NaN, Number.NEGATIVE_INFINITY]) {
      expect(() => validateDeviceScaleFactor(bad)).toThrow(/positive finite/);
    }
  });
});
