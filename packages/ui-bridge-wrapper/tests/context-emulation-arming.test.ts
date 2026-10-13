/**
 * The page a transport launches renders at the requested device pixel ratio
 * and colour scheme — entered exactly where every bin enters: `createTransport`.
 *
 * Playwright itself is replaced by a stand-in browser whose page answers
 * `devicePixelRatio` and `prefers-color-scheme` from the options its CONTEXT
 * was created with, the way Chromium does. Everything between the transport
 * factory and that context is the real code: the headless transport, the
 * optional `@qontinui/ui-bridge-headless` peer it imports at run time, and the
 * context it opens. So the reading moves only if the requested options really
 * reach the browser context — the property plan
 * 2026-10-13-image-generation-and-visual-judgment (Phase 9) depends on, and
 * the one a Chromium launch flag was measured NOT to deliver (Phase 1).
 *
 * No real browser is needed, so this runs everywhere the suite runs, CI included.
 */

import { describe, it, expect, vi } from 'vitest';
import { createTransport } from '../src/create-transport.js';

const opened = vi.hoisted(() => ({ contexts: [] as Record<string, unknown>[] }));

vi.mock('playwright', () => {
  const pageFor = (opts: Record<string, unknown>) => ({
    on: () => undefined,
    goto: async () => null,
    url: () => 'http://app.local/',
    mainFrame: () => ({}),
    // What Chromium reports for a context created with these options.
    evaluate: async () => ({
      dpr: typeof opts['deviceScaleFactor'] === 'number' ? opts['deviceScaleFactor'] : 1,
      dark: opts['colorScheme'] === 'dark',
    }),
  });
  return {
    chromium: {
      launch: async () => ({
        newContext: async (opts: Record<string, unknown>) => {
          opened.contexts.push(opts);
          return { addInitScript: async () => undefined, newPage: async () => pageFor(opts) };
        },
        close: async () => undefined,
      }),
    },
  };
});

describe('a transport renders the page at the requested ratio and scheme', () => {
  it('createTransport with deviceScaleFactor 2 and a dark scheme yields a page reading ratio 2, dark', async () => {
    const transport = createTransport({
      kind: 'headless',
      options: {
        targetUrl: 'http://app.local/',
        viewportWidth: 400,
        viewportHeight: 300,
        deviceScaleFactor: 2,
        colorScheme: 'dark',
        forwardConsole: false,
      },
    });
    transport.register('readRendering', (_params: unknown, ctx: unknown) =>
      (ctx as { page: { evaluate(fn: () => unknown): Promise<unknown> } }).page.evaluate(() => ({
        dpr: window.devicePixelRatio,
        dark: window.matchMedia('(prefers-color-scheme: dark)').matches,
      }))
    );
    try {
      await transport.ready();
      expect(await transport.dispatch('readRendering')).toEqual({ dpr: 2, dark: true });
      expect(opened.contexts.at(-1)).toMatchObject({
        viewport: { width: 400, height: 300 },
        deviceScaleFactor: 2,
        colorScheme: 'dark',
      });
    } finally {
      await transport.close();
    }
  });
});
