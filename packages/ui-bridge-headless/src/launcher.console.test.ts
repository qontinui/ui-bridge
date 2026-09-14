/**
 * Console forwarding output contract.
 *
 * `launchHeadlessTab` forwards page `console.*` messages by default. Callers
 * such as `ui-bridge-wrapper`'s inject-cli reserve stdout for machine output:
 * one `{action,result}` / `{action,error}` JSON line per action. Up to 0.4.1
 * every console type except `error` and `warning` was written to stdout, so a
 * page's `console.log` landed between those JSON lines and broke the consumer's
 * parse (`SyntaxError: Unexpected token 'b', "[browser.in"... is not valid
 * JSON`). The contract is now: every forwarded browser line goes to stderr.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Handler = (arg: unknown) => void;

/**
 * A fake Playwright `page` that records its listeners so the test can fire
 * `console` / `pageerror` events the way a real page would.
 */
function makeFakePage() {
  const handlers = new Map<string, Handler[]>();
  const mainFrame = {};
  const page = {
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return page;
    }),
    goto: vi.fn(async () => null),
    url: vi.fn(() => 'http://app.local/'),
    mainFrame: vi.fn(() => mainFrame),
  };
  const emit = (event: string, arg: unknown): void => {
    for (const handler of handlers.get(event) ?? []) handler(arg);
  };
  return { page, emit, handlers };
}

const fake = vi.hoisted(() => ({ page: null as unknown }));

vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn(async () => ({
      newContext: vi.fn(async () => ({
        addInitScript: vi.fn(async () => undefined),
        newPage: vi.fn(async () => fake.page),
      })),
      close: vi.fn(async () => undefined),
    })),
  },
}));

// vitest hoists vi.mock above this import, so the launcher binds the fake.
import { launchHeadlessTab } from './launcher.js';

/** A fake Playwright `ConsoleMessage`. */
const consoleMessage = (type: string, text: string) => ({
  type: () => type,
  text: () => text,
});

describe('launchHeadlessTab · console forwarding goes to stderr, never stdout', () => {
  let stdout: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;

  const written = (spy: ReturnType<typeof vi.spyOn>): string[] =>
    (spy.mock.calls as unknown as unknown[][]).map((c) => String(c[0]));

  beforeEach(() => {
    stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdout.mockRestore();
    stderr.mockRestore();
    vi.restoreAllMocks();
  });

  it('(n) log, info, debug, warning and error all reach stderr with their prefix; stdout stays empty', async () => {
    const { page, emit } = makeFakePage();
    fake.page = page;

    const tab = await launchHeadlessTab({ url: 'http://app.local/', headless: true });

    const types = ['log', 'info', 'debug', 'warning', 'error'];
    for (const type of types) emit('console', consoleMessage(type, `hello from ${type}`));

    expect(written(stdout)).toEqual([]);
    const errLines = written(stderr);
    for (const type of types) {
      expect(errLines).toContain(`[browser.${type}] hello from ${type}\n`);
    }
    expect(errLines).toHaveLength(types.length);

    await tab.close();
  });

  it('uncaught page errors also go to stderr', async () => {
    const { page, emit } = makeFakePage();
    fake.page = page;

    await launchHeadlessTab({ url: 'http://app.local/', headless: true });
    emit('pageerror', new Error('boom'));

    expect(written(stdout)).toEqual([]);
    expect(written(stderr)).toEqual(['[browser.pageerror] boom\n']);
  });

  it('forwardConsole: false registers no console listener at all', async () => {
    const { page, handlers } = makeFakePage();
    fake.page = page;

    await launchHeadlessTab({ url: 'http://app.local/', headless: true, forwardConsole: false });

    expect(handlers.has('console')).toBe(false);
    expect(handlers.has('pageerror')).toBe(false);
  });
});
