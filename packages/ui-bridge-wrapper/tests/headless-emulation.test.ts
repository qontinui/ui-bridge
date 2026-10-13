/**
 * A requested device scale factor / colour scheme is VERIFIED on the page.
 *
 * `@qontinui/ui-bridge-headless` is an optional peer resolved at run time. One
 * that predates `deviceScaleFactor` / `colorScheme` (<= 0.5.0) accepts the
 * extra keys and silently ignores them, and the page renders at DPR 1 while
 * the caller believes it asked for 2 — the same silent shape Phase 1 of plan
 * 2026-10-13-image-generation-and-visual-judgment measured for a Chromium
 * launch flag. The transport therefore reads the values back from the page
 * and refuses with EMULATION_NOT_APPLIED rather than letting a frame be
 * stamped with an emulation that never happened.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const fake = vi.hoisted(() => ({
  pageReports: { dpr: 1, dark: false },
  closed: 0,
  launchArgs: [] as Record<string, unknown>[],
}));

vi.mock('@qontinui/ui-bridge-headless', () => ({
  launchHeadlessTab: vi.fn(async (args: Record<string, unknown>) => {
    fake.launchArgs.push(args);
    return {
      browser: {},
      context: {},
      page: { evaluate: async () => fake.pageReports },
      uiBridgeRegistered: false,
      tabId: null,
      close: async () => {
        fake.closed += 1;
      },
    };
  }),
}));

import { HeadlessTransport } from '../src/transports/headless.js';
import { WrapperTransportError } from '../src/types.js';

beforeEach(() => {
  fake.pageReports = { dpr: 1, dark: false };
  fake.closed = 0;
  fake.launchArgs.length = 0;
});

const transport = (options: Record<string, unknown>) =>
  new HeadlessTransport({
    kind: 'headless',
    options: { targetUrl: 'http://app.local/', ...options },
  });

describe('HeadlessTransport emulation read-back', () => {
  it('passes deviceScaleFactor and colorScheme to the launcher', async () => {
    fake.pageReports = { dpr: 2, dark: true };
    const t = transport({ deviceScaleFactor: 2, colorScheme: 'dark' });
    await t.ready();
    expect(fake.launchArgs[0]).toMatchObject({ deviceScaleFactor: 2, colorScheme: 'dark' });
    await t.close();
  });

  it('refuses a page that reports a different devicePixelRatio, and closes the browser it opened', async () => {
    fake.pageReports = { dpr: 1, dark: false }; // an older launcher ignored the option
    const t = transport({ deviceScaleFactor: 2 });
    const err = await t.ready().then(
      () => null,
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(WrapperTransportError);
    expect((err as WrapperTransportError).code).toBe('EMULATION_NOT_APPLIED');
    expect((err as WrapperTransportError).message).toMatch(/devicePixelRatio 1 \(requested 2\)/);
    expect(fake.closed).toBe(1);
  });

  it('refuses a page that reports the other colour scheme', async () => {
    fake.pageReports = { dpr: 1, dark: false };
    const err = await transport({ colorScheme: 'dark' })
      .ready()
      .then(
        () => null,
        (e: unknown) => e
      );
    expect((err as WrapperTransportError).code).toBe('EMULATION_NOT_APPLIED');
    expect((err as WrapperTransportError).message).toMatch(
      /prefers-color-scheme light \(requested dark\)/
    );
  });

  it('reads nothing back, and sends neither key, when neither was requested', async () => {
    const t = transport({});
    await t.ready();
    expect('deviceScaleFactor' in fake.launchArgs[0]!).toBe(false);
    expect('colorScheme' in fake.launchArgs[0]!).toBe(false);
    await t.close();
  });
});
