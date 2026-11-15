/**
 * `recordHar`, `serviceWorkers` and `initRouter` reach the launcher, and a
 * launcher that ignores them is refused.
 *
 * `@qontinui/ui-bridge-headless` is an optional peer resolved at run time. One
 * that predates the context passthrough (ui-bridge#381) accepts the three keys and
 * drops them: the caller would wait for a HAR that is never written and its
 * routes would never be installed. The transport always hands the launcher an
 * `initRouter` when any of the three is requested, and refuses with
 * CONTEXT_OPTIONS_NOT_APPLIED when the launch returns without calling it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const fake = vi.hoisted(() => ({
  /** When false, the fake behaves like a launcher that predates the passthrough. */
  callsInitRouter: true,
  closed: 0,
  launchArgs: [] as Record<string, unknown>[],
  context: { marker: 'context' } as Record<string, unknown>,
}));

vi.mock('@qontinui/ui-bridge-headless', () => ({
  launchHeadlessTab: vi.fn(async (args: Record<string, unknown>) => {
    fake.launchArgs.push(args);
    const initRouter = args['initRouter'] as ((c: unknown) => Promise<void>) | undefined;
    if (fake.callsInitRouter && initRouter) await initRouter(fake.context);
    return {
      browser: {},
      context: fake.context,
      page: { evaluate: async () => ({ dpr: 1, dark: false }) },
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
  fake.callsInitRouter = true;
  fake.closed = 0;
  fake.launchArgs.length = 0;
});

const transport = (options: Record<string, unknown>) =>
  new HeadlessTransport({
    kind: 'headless',
    options: { targetUrl: 'http://app.local/', ...options },
  });

const rejection = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e
  );

describe('HeadlessTransport context options passthrough', () => {
  it('passes recordHar and serviceWorkers unchanged and calls the caller router with the context', async () => {
    const recordHar = { path: '/tmp/x.zip', content: 'attach' as const, mode: 'minimal' as const };
    const seen: unknown[] = [];
    const t = transport({
      recordHar,
      serviceWorkers: 'block',
      initRouter: async (context: unknown) => {
        seen.push(context);
      },
    });
    await t.ready();
    expect(fake.launchArgs[0]).toMatchObject({ recordHar, serviceWorkers: 'block' });
    expect(typeof fake.launchArgs[0]!['initRouter']).toBe('function');
    expect(seen).toEqual([fake.context]);
    await t.close();
    expect(fake.closed).toBe(1);
  });

  it('passes a proof-of-application router even when only recordHar is requested', async () => {
    const t = transport({ recordHar: { path: '/tmp/x.har' } });
    await t.ready();
    expect(typeof fake.launchArgs[0]!['initRouter']).toBe('function');
    expect('serviceWorkers' in fake.launchArgs[0]!).toBe(false);
    await t.close();
  });

  it('refuses a launcher that never called initRouter, and closes the browser it opened', async () => {
    fake.callsInitRouter = false;
    const err = await rejection(transport({ recordHar: { path: '/tmp/x.zip' } }).ready());
    expect(err).toBeInstanceOf(WrapperTransportError);
    expect((err as WrapperTransportError).code).toBe('CONTEXT_OPTIONS_NOT_APPLIED');
    expect((err as WrapperTransportError).details).toEqual({
      requested: { recordHar: true, serviceWorkers: null, initRouter: false },
    });
    expect(fake.closed).toBe(1);
  });

  it('reports the dropped context options, not the emulation, when an old peer drops both', async () => {
    fake.callsInitRouter = false; // the fake page also reports DPR 1, so emulation would fail too
    const err = await rejection(
      transport({ deviceScaleFactor: 2, recordHar: { path: '/tmp/x.zip' } }).ready()
    );
    expect((err as WrapperTransportError).code).toBe('CONTEXT_OPTIONS_NOT_APPLIED');
    expect(fake.closed).toBe(1);
  });

  it("does not refuse an old peer when only serviceWorkers: 'allow' (Playwright's default) is set", async () => {
    fake.callsInitRouter = false;
    const t = transport({ serviceWorkers: 'allow' });
    await t.ready();
    expect(fake.launchArgs[0]).toMatchObject({ serviceWorkers: 'allow' });
    await t.close();
  });

  it('propagates a throwing caller router as a failed ready()', async () => {
    const err = await rejection(
      transport({
        initRouter: () => {
          throw new Error('route install failed');
        },
      }).ready()
    );
    expect((err as Error).message).toBe('route install failed');
  });

  it('sends none of the three keys when none was requested', async () => {
    const t = transport({});
    await t.ready();
    for (const key of ['recordHar', 'serviceWorkers', 'initRouter']) {
      expect(key in fake.launchArgs[0]!).toBe(false);
    }
    await t.close();
  });

  it.each([
    [{ recordHar: 'x.zip' }, /recordHar must be an object/],
    [{ recordHar: { path: '' } }, /recordHar must be an object/],
    [{ serviceWorkers: 'deny' }, /serviceWorkers must be 'allow' or 'block'/],
    [{ initRouter: 'not a function' }, /initRouter must be a function/],
  ])('refuses a malformed %j at construction', (options, message) => {
    let err: unknown = null;
    try {
      transport(options);
    } catch (e) {
      err = e;
    }
    expect((err as WrapperTransportError).code).toBe('INVALID_CONFIG');
    expect((err as Error).message).toMatch(message);
  });
});
