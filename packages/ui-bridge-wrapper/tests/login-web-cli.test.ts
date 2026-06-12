import { describe, it, expect, afterEach } from 'vitest';
import {
  parseArgs,
  validateArgs,
  LoginCliArgError,
  USAGE,
  waitForPostClickSettle,
  POST_CLICK_SETTLE_TIMEOUT_MS,
  type PostClickSettlePage,
} from '../src/login-web-cli.js';

// Importing the module MUST NOT spawn a browser or call main() — the isMain
// guard keys off process.argv[1] === this module's URL, which is false under
// vitest. If this import had side effects, the suite would hang.

const CREDS = ['--email', 'a@b.c', '--password', 'pw'];

afterEach(() => {
  delete process.env.UIB_LOGIN_EMAIL;
  delete process.env.UIB_LOGIN_PASSWORD;
});

describe('parseArgs', () => {
  it('defaults url/success/timeout and parses creds', () => {
    const args = parseArgs([...CREDS]);
    expect(args.url).toBe('https://qontinui.io/login');
    expect(args.success).toBe('/dashboard');
    expect(args.timeoutMs).toBe(60000);
    expect(args.email).toBe('a@b.c');
    expect(args.password).toBe('pw');
    expect(args.headed).toBe(false);
    expect(args.keepOpen).toBe(false);
    expect(args.postClick).toBeNull();
  });

  it('reads creds from env when flags absent', () => {
    process.env.UIB_LOGIN_EMAIL = 'env@b.c';
    process.env.UIB_LOGIN_PASSWORD = 'envpw';
    const args = parseArgs([]);
    expect(args.email).toBe('env@b.c');
    expect(args.password).toBe('envpw');
  });

  it('flag creds override env', () => {
    process.env.UIB_LOGIN_EMAIL = 'env@b.c';
    const args = parseArgs(['--email', 'flag@b.c', '--password', 'pw']);
    expect(args.email).toBe('flag@b.c');
  });

  it('parses --url / --success / --timeout / --headed / --keep-open / --post-login-click', () => {
    const args = parseArgs([
      ...CREDS,
      '--url',
      'https://qontinui.io/login?next=%2Fbuild%2Fworkflows',
      '--success',
      '/build/workflows',
      '--timeout',
      '90000',
      '--headed',
      '--keep-open',
      '--post-login-click',
      "[data-testid='co-pilot-consent-allow']",
    ]);
    expect(args.url).toBe('https://qontinui.io/login?next=%2Fbuild%2Fworkflows');
    expect(args.success).toBe('/build/workflows');
    expect(args.timeoutMs).toBe(90000);
    expect(args.headed).toBe(true);
    expect(args.keepOpen).toBe(true);
    expect(args.postClick).toBe("[data-testid='co-pilot-consent-allow']");
  });

  it('defaults the drive-harness flags (expectText empty, scroll/screenshot null)', () => {
    const args = parseArgs([...CREDS]);
    expect(args.expectText).toEqual([]);
    expect(args.scrollToText).toBeNull();
    expect(args.screenshotPath).toBeNull();
  });

  it('parses --expect-text into trimmed, non-empty tokens', () => {
    const args = parseArgs([...CREDS, '--expect-text', 'option2-actions-outage-drill, metric_threshold ,, ,fleet-gates']);
    expect(args.expectText).toEqual([
      'option2-actions-outage-drill',
      'metric_threshold',
      'fleet-gates',
    ]);
  });

  it('parses --scroll-to and --screenshot', () => {
    const args = parseArgs([...CREDS, '--scroll-to', 'Gates', '--screenshot', 'out.png']);
    expect(args.scrollToText).toBe('Gates');
    expect(args.screenshotPath).toBe('out.png');
  });

  it('throws on an unknown flag', () => {
    expect(() => parseArgs([...CREDS, '--bogus'])).toThrow(/Unknown flag/);
  });

  // Finding 3.2 — the confirmed value-swallow: `--success --headed` used to set
  // success = "--headed" (an unmatchable target → ok:false on a GOOD login).
  // It must now reject the flag-shaped value rather than swallow it.
  it('does NOT swallow a following flag as --success value (--success --headed)', () => {
    expect(() => parseArgs([...CREDS, '--success', '--headed'])).toThrow(LoginCliArgError);
    expect(() => parseArgs([...CREDS, '--success', '--headed'])).toThrow(
      /--success expects a value but got the flag '--headed'/
    );
  });

  it('still parses --success when its value is a real path followed by --headed', () => {
    const args = parseArgs([...CREDS, '--success', '/build/workflows', '--headed']);
    expect(args.success).toBe('/build/workflows');
    expect(args.headed).toBe(true);
  });

  // An EMPTY --success makes `landingPath.includes('')` true on ANY landing —
  // ok:true while parked on the login page (a false success, e.g. from
  // `--success "$VAR"` with $VAR unset). Present-but-empty must be rejected;
  // an ABSENT --success still gets the /dashboard default.
  it('rejects a present-but-empty --success value', () => {
    expect(() => parseArgs([...CREDS, '--success', ''])).toThrow(LoginCliArgError);
    expect(() => parseArgs([...CREDS, '--success', '  '])).toThrow(
      /--success was given an empty value/
    );
  });

  it('rejects a present-but-empty --url value', () => {
    expect(() => parseArgs([...CREDS, '--url', ''])).toThrow(
      /--url was given an empty value/
    );
  });

  it('parses --quiet', () => {
    expect(parseArgs([...CREDS, '--quiet']).quiet).toBe(true);
    expect(parseArgs([...CREDS]).quiet).toBe(false);
  });

  it('throws when creds are missing', () => {
    expect(() => parseArgs([])).toThrow(LoginCliArgError);
    expect(() => parseArgs([])).toThrow(/need --email\/--password/);
  });

  it('throws when --url is not http(s)', () => {
    expect(() => parseArgs([...CREDS, '--url', 'ftp://x'])).toThrow(/http:\/\/ or https:\/\//);
  });

  it('rejects a non-positive --timeout', () => {
    expect(() => parseArgs([...CREDS, '--timeout', '0'])).toThrow(LoginCliArgError);
  });

  it('treats --help as always valid (short-circuits validation)', () => {
    const args = parseArgs(['--help']);
    expect(args.help).toBe(true);
    expect(() => validateArgs(args)).not.toThrow();
  });

  it('exports a non-empty USAGE documenting the flags', () => {
    expect(USAGE).toContain('--url');
    expect(USAGE).toContain('--success');
    expect(USAGE).toContain('--post-login-click');
    expect(USAGE).toContain('--expect-text');
    expect(USAGE).toContain('--scroll-to');
    expect(USAGE).toContain('--screenshot');
  });
});

// Post-click settle wait — runs only after a SUCCESSFUL --post-login-click so
// the screenshot doesn't capture the dismissed dialog mid-fade. Exercised via
// the exported helper with a structural fake page (no browser).
describe('waitForPostClickSettle', () => {
  const SELECTOR = "[data-testid='co-pilot-consent-not-now']";

  /** Fake page whose locator(...).first().waitFor resolves/rejects per `outcome`, recording the call. */
  function fakePage(outcome: 'hidden' | 'timeout'): {
    page: PostClickSettlePage;
    calls: Array<{ selector: string; state: string; timeout: number }>;
  } {
    const calls: Array<{ selector: string; state: string; timeout: number }> = [];
    const page: PostClickSettlePage = {
      locator: (selector: string) => ({
        first: () => ({
          waitFor: (opts: { state: 'hidden'; timeout: number }) => {
            calls.push({ selector, state: opts.state, timeout: opts.timeout });
            return outcome === 'hidden'
              ? Promise.resolve()
              : Promise.reject(new Error(`Timeout ${opts.timeout}ms exceeded`));
          },
        }),
      }),
    };
    return { page, calls };
  }

  it('resolves true when the clicked element is dismissed (modal detaches/hides)', async () => {
    const { page, calls } = fakePage('hidden');
    const logs: string[] = [];
    await expect(waitForPostClickSettle(page, SELECTOR, (m) => logs.push(m))).resolves.toBe(true);
    // Waited on the CLICKED selector for the 'hidden' state with the bounded default budget.
    expect(calls).toEqual([
      { selector: SELECTOR, state: 'hidden', timeout: POST_CLICK_SETTLE_TIMEOUT_MS },
    ]);
    // Clean settle logs nothing — the wait is invisible on the happy path.
    expect(logs).toEqual([]);
  });

  it('is non-fatal on timeout (modal never detaches): resolves false, logs one line', async () => {
    const { page } = fakePage('timeout');
    const logs: string[] = [];
    // Must RESOLVE (false), never reject — the caller proceeds to the screenshot.
    await expect(waitForPostClickSettle(page, SELECTOR, (m) => logs.push(m))).resolves.toBe(false);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('non-fatal');
    expect(logs[0]).toContain(SELECTOR);
  });

  it('honors an explicit timeout override (bounded wait)', async () => {
    const { page, calls } = fakePage('hidden');
    await waitForPostClickSettle(page, SELECTOR, () => {}, 500);
    expect(calls[0]?.timeout).toBe(500);
  });

  it('defaults to a ~2s bound (never an unbounded wait before the screenshot)', () => {
    expect(POST_CLICK_SETTLE_TIMEOUT_MS).toBe(2000);
  });
});

// URL classifiers (isCognito/pathOf/isSuccessPath/isAppLoginPath) moved to
// tests/login-drive.test.ts — single home for URL classification.
