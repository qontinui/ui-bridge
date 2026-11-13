/**
 * The context passthrough options — `recordHar`, `serviceWorkers` and
 * `initRouter` — against a fake Playwright.
 *
 * They exist for a capture worker that records a HAR per viewport context and
 * later replays it through its own router (plan
 * 2026-11-13-design-reference-library-stores-described-web-examples-for-any-project-to-query,
 * Phase 2). Pinned here: absent options leave `newContext` exactly as before;
 * present ones reach it unchanged; the init router runs before the first page
 * exists; and `close()` closes the CONTEXT before the browser, because that is
 * when Playwright writes the HAR. The sibling
 * `launcher.context-options.smoke.test.ts` reads the same off a real Chromium.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const recorded = vi.hoisted(() => ({
  contextOptions: [] as Record<string, unknown>[],
  /** Every step the launcher took, in order. */
  calls: [] as string[],
  contextCloseRejects: false,
  contexts: [] as unknown[],
}));

vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn(async () => ({
      newContext: vi.fn(async (opts: Record<string, unknown>) => {
        recorded.contextOptions.push(opts);
        recorded.calls.push('newContext');
        const context = {
          addInitScript: vi.fn(async () => {
            recorded.calls.push('addInitScript');
          }),
          route: vi.fn(async () => {
            recorded.calls.push('route');
          }),
          newPage: vi.fn(async () => {
            recorded.calls.push('newPage');
            return {
              on: vi.fn(),
              goto: vi.fn(async () => {
                recorded.calls.push('goto');
                return null;
              }),
              url: vi.fn(() => 'http://app.local/'),
              mainFrame: vi.fn(() => ({})),
            };
          }),
          close: vi.fn(async () => {
            recorded.calls.push('context.close');
            if (recorded.contextCloseRejects) throw new Error('fake context.close rejected');
          }),
        };
        recorded.contexts.push(context);
        return context;
      }),
      close: vi.fn(async () => {
        recorded.calls.push('browser.close');
      }),
    })),
  },
}));

// vitest hoists vi.mock above this import, so the launcher binds the fake.
import type { BrowserContext } from 'playwright';
import { launchHeadlessTab } from './launcher.js';

beforeEach(() => {
  recorded.contextOptions.length = 0;
  recorded.calls.length = 0;
  recorded.contextCloseRejects = false;
  recorded.contexts.length = 0;
});

describe('launchHeadlessTab — context passthrough options', () => {
  it('absent options leave the newContext arguments exactly as before', async () => {
    const tab = await launchHeadlessTab({
      url: 'http://app.local/',
      headless: true,
      forwardConsole: false,
    });
    await tab.close();

    expect(recorded.contextOptions).toEqual([
      { viewport: { width: 1280, height: 720 }, userAgent: undefined },
    ]);
    const opts = recorded.contextOptions[0]!;
    expect('recordHar' in opts).toBe(false);
    expect('serviceWorkers' in opts).toBe(false);
  });

  it('recordHar and serviceWorkers reach newContext unchanged', async () => {
    const recordHar = {
      path: '/tmp/capture.zip',
      content: 'attach' as const,
      mode: 'minimal' as const,
      urlFilter: /example\.com/,
    };
    const tab = await launchHeadlessTab({
      url: 'http://app.local/',
      headless: true,
      forwardConsole: false,
      recordHar,
      serviceWorkers: 'block',
    });
    await tab.close();

    const opts = recorded.contextOptions[0]!;
    expect(opts.recordHar).toBe(recordHar);
    expect(opts.serviceWorkers).toBe('block');
    expect(opts.viewport).toEqual({ width: 1280, height: 720 });
  });

  it('serviceWorkers "allow" is passed as given', async () => {
    const tab = await launchHeadlessTab({
      url: 'http://app.local/',
      headless: true,
      forwardConsole: false,
      serviceWorkers: 'allow',
    });
    await tab.close();
    expect(recorded.contextOptions[0]!.serviceWorkers).toBe('allow');
  });

  it('the init router receives the context, after the init scripts and before the first page', async () => {
    let received: BrowserContext | undefined;
    const tab = await launchHeadlessTab({
      url: 'http://app.local/',
      headless: true,
      forwardConsole: false,
      initScripts: ['window.__probe = 1;'],
      initRouter: async (context) => {
        received = context;
        recorded.calls.push('initRouter');
        await context.route('**/*', () => undefined);
      },
    });
    await tab.close();

    expect(received).toBe(recorded.contexts[0]);
    expect(received).toBe(tab.context);
    expect(recorded.calls).toEqual([
      'newContext',
      'addInitScript',
      'initRouter',
      'route',
      'newPage',
      'goto',
      'context.close',
      'browser.close',
    ]);
  });

  it('an init router that throws fails the launch with its error, and closes the browser', async () => {
    const boom = new Error('router install failed');
    await expect(
      launchHeadlessTab({
        url: 'http://app.local/',
        headless: true,
        forwardConsole: false,
        initRouter: () => {
          throw boom;
        },
      })
    ).rejects.toBe(boom);
    expect(recorded.calls).not.toContain('newPage');
    expect(recorded.calls.at(-1)).toBe('browser.close');
  });

  it('close() closes the context before the browser (Playwright writes the HAR on context close)', async () => {
    const tab = await launchHeadlessTab({
      url: 'http://app.local/',
      headless: true,
      forwardConsole: false,
      recordHar: { path: '/tmp/x.har' },
    });
    recorded.calls.length = 0;
    await tab.close();
    await tab.close();
    expect(recorded.calls).toEqual(['context.close', 'browser.close']);
  });

  it('a context close that fails is reported on stderr, and the browser is still closed', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const tab = await launchHeadlessTab({
        url: 'http://app.local/',
        headless: true,
        forwardConsole: false,
      });
      recorded.contextCloseRejects = true;
      recorded.calls.length = 0;
      await expect(tab.close()).resolves.toBeUndefined();

      expect(recorded.calls).toEqual(['context.close', 'browser.close']);
      const lines = stderr.mock.calls.map((c) => String(c[0]));
      expect(lines.some((l) => l.includes('fake context.close rejected'))).toBe(true);
    } finally {
      stderr.mockRestore();
    }
  });
});
