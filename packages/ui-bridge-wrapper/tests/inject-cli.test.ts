import { describe, it, expect } from 'vitest';
import {
  parseArgs,
  buildTransportOptions,
  buildLaunchArgs,
  isLoopbackHost,
  LNA_DISABLE_FEATURES,
  selectMode,
  InjectCliArgError,
  USAGE,
} from '../src/inject-cli.js';

// Importing the module MUST NOT spawn a browser or call main() — the isMain
// guard keys off process.argv[1] === this module's URL, which is false under
// vitest. If this import had side effects, the suite would hang.

describe('parseArgs / buildTransportOptions', () => {
  it('maps --url to options.targetUrl', () => {
    const args = parseArgs(['--url', 'http://localhost:3000/login', '--exec', 'find {}']);
    expect(args.url).toBe('http://localhost:3000/login');
    const opts = buildTransportOptions(args);
    expect(opts.targetUrl).toBe('http://localhost:3000/login');
  });

  it('maps --relay to options.uiBridgeBase', () => {
    const args = parseArgs([
      '--url',
      'https://example.com',
      '--relay',
      'http://localhost:3001/api/ui-bridge',
    ]);
    expect(args.relay).toBe('http://localhost:3001/api/ui-bridge');
    expect(buildTransportOptions(args).uiBridgeBase).toBe('http://localhost:3001/api/ui-bridge');
  });

  it('maps --headed to options.headed = true', () => {
    const args = parseArgs(['--url', 'https://example.com', '--exec', 'find {}', '--headed']);
    expect(args.headed).toBe(true);
    expect(buildTransportOptions(args).headed).toBe(true);
  });

  it('omits headed when not given', () => {
    const args = parseArgs(['--url', 'https://example.com', '--exec', 'find {}']);
    expect('headed' in buildTransportOptions(args)).toBe(false);
  });

  it('parses --registration-metadata into {userId, sessionId}', () => {
    const args = parseArgs([
      '--url',
      'https://example.com',
      '--relay',
      'http://r',
      '--registration-metadata',
      '{"userId":"u","sessionId":"s"}',
    ]);
    expect(args.registrationMetadata).toEqual({ userId: 'u', sessionId: 's' });
    expect(buildTransportOptions(args).registrationMetadata).toEqual({
      userId: 'u',
      sessionId: 's',
    });
  });

  it('rejects --registration-metadata missing keys', () => {
    expect(() =>
      parseArgs([
        '--url',
        'https://example.com',
        '--relay',
        'http://r',
        '--registration-metadata',
        '{"userId":"u"}',
      ])
    ).toThrow(InjectCliArgError);
  });

  it('rejects malformed --registration-metadata JSON', () => {
    expect(() =>
      parseArgs([
        '--url',
        'https://example.com',
        '--relay',
        'http://r',
        '--registration-metadata',
        '{not json',
      ])
    ).toThrow(InjectCliArgError);
  });

  it('parses --ready-timeout as a positive int', () => {
    const args = parseArgs([
      '--url',
      'https://example.com',
      '--exec',
      'find {}',
      '--ready-timeout',
      '45000',
    ]);
    expect(args.readyTimeoutMs).toBe(45000);
    expect(buildTransportOptions(args).readyTimeoutMs).toBe(45000);
  });

  it('rejects a non-positive --ready-timeout', () => {
    expect(() =>
      parseArgs(['--url', 'https://example.com', '--exec', 'find {}', '--ready-timeout', '0'])
    ).toThrow(InjectCliArgError);
  });

  it('parses --viewport WxH', () => {
    const args = parseArgs([
      '--url',
      'https://example.com',
      '--exec',
      'find {}',
      '--viewport',
      '1440x900',
    ]);
    const opts = buildTransportOptions(args);
    expect(opts.viewportWidth).toBe(1440);
    expect(opts.viewportHeight).toBe(900);
  });

  it('parses an --exec value into action + JSON payload', () => {
    const args = parseArgs(['--url', 'https://example.com', '--exec', 'find {"text":"Sign in"}']);
    expect(args.execActions).toEqual([{ action: 'find', payload: { text: 'Sign in' } }]);
  });

  it('defaults an --exec payload to {} when omitted', () => {
    const args = parseArgs(['--url', 'https://example.com', '--exec', 'getControlSnapshot']);
    expect(args.execActions).toEqual([{ action: 'getControlSnapshot', payload: {} }]);
  });

  it('collects multiple --exec flags in order', () => {
    const args = parseArgs([
      '--url',
      'https://example.com',
      '--exec',
      'find {"text":"a"}',
      '--exec',
      'find {"text":"b"}',
    ]);
    expect(args.execActions.map((a) => a.payload)).toEqual([{ text: 'a' }, { text: 'b' }]);
  });

  it('passes optional relay metadata through to options', () => {
    const args = parseArgs([
      '--url',
      'https://example.com',
      '--relay',
      'http://r',
      '--auth-token',
      'tok',
      '--app-id',
      'aid',
      '--app-name',
      'My App',
      '--tab-id',
      'tab-1',
    ]);
    const opts = buildTransportOptions(args);
    expect(opts).toMatchObject({
      authToken: 'tok',
      appId: 'aid',
      appName: 'My App',
      tabId: 'tab-1',
    });
  });
});

describe('selectMode', () => {
  it("returns 'exec' when --exec is present", () => {
    const args = parseArgs(['--url', 'https://example.com', '--exec', 'find {}']);
    expect(selectMode(args)).toBe('exec');
  });

  it("returns 'exec' when --exec-stdin is present", () => {
    const args = parseArgs(['--url', 'https://example.com', '--exec-stdin']);
    expect(selectMode(args)).toBe('exec');
  });

  it("returns 'relay' (default) when no exec actions", () => {
    const args = parseArgs(['--url', 'https://example.com', '--relay', 'http://r']);
    expect(selectMode(args)).toBe('relay');
  });
});

describe('validation error paths', () => {
  it('throws when --url is missing', () => {
    expect(() => parseArgs(['--relay', 'http://r'])).toThrow(InjectCliArgError);
    expect(() => parseArgs(['--relay', 'http://r'])).toThrow(/--url is required/);
  });

  it('throws when --url is not http(s)', () => {
    expect(() => parseArgs(['--url', 'ftp://example.com', '--relay', 'http://r'])).toThrow(
      /http:\/\/ or https:\/\//
    );
  });

  it('throws in relay mode (default) when --relay is missing', () => {
    expect(() => parseArgs(['--url', 'https://example.com'])).toThrow(InjectCliArgError);
    expect(() => parseArgs(['--url', 'https://example.com'])).toThrow(/requires --relay/);
  });

  it('does NOT require --relay in exec mode', () => {
    expect(() =>
      parseArgs(['--url', 'https://example.com', '--exec', 'find {}'])
    ).not.toThrow();
  });

  it('throws on an unknown flag', () => {
    expect(() => parseArgs(['--url', 'https://example.com', '--bogus'])).toThrow(/Unknown flag/);
  });

  // Finding 3.2 — the switch parser's `argv[++i]` had the same flag-shaped
  // swallow: `--url --headed` captured `--headed` as the url. It must now error.
  it('does NOT swallow a following flag as a string value-flag value (--url --headed)', () => {
    expect(() => parseArgs(['--url', '--headed', '--exec', 'find {}'])).toThrow(InjectCliArgError);
    expect(() => parseArgs(['--url', '--headed', '--exec', 'find {}'])).toThrow(
      /--url expects a value but got the flag '--headed'/
    );
  });

  it('rejects a flag-shaped --relay value', () => {
    expect(() => parseArgs(['--url', 'https://x', '--relay', '--headed'])).toThrow(
      /--relay expects a value but got the flag '--headed'/
    );
  });

  // Round-2 completion: the swallow guard now also covers the non-string
  // value-flags the first pass missed. `--exec --headed` used to parse an exec
  // action literally named '--headed' (failing far downstream at dispatch);
  // `--expect-selector --headed` accepted '--headed' as a CSS selector.
  it('does NOT swallow a following flag as the --exec value', () => {
    expect(() => parseArgs(['--url', 'https://x', '--exec', '--headed'])).toThrow(
      /--exec expects a value but got the flag '--headed'/
    );
  });

  it('does NOT swallow a following flag as the --expect-selector value', () => {
    expect(() =>
      parseArgs(['--url', 'https://x', '--exec', 'find {}', '--expect-selector', '--headed'])
    ).toThrow(/--expect-selector expects a value but got the flag '--headed'/);
  });

  it('does NOT swallow a following flag as a numeric flag value (--ready-timeout --headed)', () => {
    expect(() =>
      parseArgs(['--url', 'https://x', '--exec', 'find {}', '--ready-timeout', '--headed'])
    ).toThrow(/--ready-timeout expects a value but got the flag '--headed'/);
  });

  it('still accepts a negative numeric token as a value (single dash is not flag-shaped)', () => {
    // -1 fails the range check, NOT the swallow guard — proving single-dash
    // tokens still read as values.
    expect(() =>
      parseArgs(['--url', 'https://x', '--exec', 'find {}', '--settle-timeout', '-1'])
    ).toThrow(/--settle-timeout expects a positive integer/);
  });

  it('treats --help as always valid (short-circuits validation)', () => {
    const args = parseArgs(['--help']);
    expect(args.help).toBe(true);
  });

  it('exports a non-empty USAGE string documenting the flags', () => {
    expect(USAGE).toContain('--url');
    expect(USAGE).toContain('--relay');
    expect(USAGE).toContain('--exec');
  });
});

describe('settle flags', () => {
  const base = ['--url', 'https://x.test/login', '--exec', 'find {}'];

  it('defaults to settle-gating — no settle keys emitted', () => {
    const opts = buildTransportOptions(parseArgs([...base]));
    expect(opts.waitForSettle).toBeUndefined();
    expect(opts.settleQuietMs).toBeUndefined();
    expect(opts.settleTimeoutMs).toBeUndefined();
  });

  it('--no-settle emits waitForSettle:false', () => {
    const opts = buildTransportOptions(parseArgs([...base, '--no-settle']));
    expect(opts.waitForSettle).toBe(false);
  });

  it('--settle-quiet / --settle-timeout map to numeric options', () => {
    const opts = buildTransportOptions(
      parseArgs([...base, '--settle-quiet', '250', '--settle-timeout', '8000'])
    );
    expect(opts.settleQuietMs).toBe(250);
    expect(opts.settleTimeoutMs).toBe(8000);
  });

  it('--settle-quiet accepts 0 (no quiet window) but rejects negatives', () => {
    expect(buildTransportOptions(parseArgs([...base, '--settle-quiet', '0'])).settleQuietMs).toBe(0);
    expect(() => parseArgs([...base, '--settle-quiet', '-1'])).toThrow(InjectCliArgError);
  });

  it('--settle-timeout rejects non-positive values', () => {
    expect(() => parseArgs([...base, '--settle-timeout', '0'])).toThrow(InjectCliArgError);
  });

  it('--expect-selector maps to options.expectSelector', () => {
    const opts = buildTransportOptions(parseArgs([...base, '--expect-selector', '#login']));
    expect(opts.expectSelector).toBe('#login');
  });

  it('--expect-selector rejects an empty value', () => {
    expect(() => parseArgs([...base, '--expect-selector', ''])).toThrow(InjectCliArgError);
  });

  it('omits expectSelector when not given', () => {
    expect(buildTransportOptions(parseArgs([...base])).expectSelector).toBeUndefined();
  });
});

describe('Chromium launch args + LNA auto-disable (plan 2026-06-12 item 2)', () => {
  const LNA_FLAG =
    '--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults';

  it('exports the three LNA feature names', () => {
    expect([...LNA_DISABLE_FEATURES]).toEqual([
      'LocalNetworkAccessChecks',
      'PrivateNetworkAccessSendPreflights',
      'PrivateNetworkAccessRespectPreflightResults',
    ]);
  });

  it('https url + 127.0.0.1 loopback relay → auto-appends the LNA disable flags', () => {
    const args = parseArgs([
      '--url',
      'https://qontinui.io/login',
      '--relay',
      'http://127.0.0.1:9877/ui-bridge',
    ]);
    const { launchArgs, lnaAutoAppended } = buildLaunchArgs(args);
    expect(lnaAutoAppended).toBe(true);
    expect(launchArgs).toEqual([LNA_FLAG]);
    expect(buildTransportOptions(args).launchArgs).toEqual([LNA_FLAG]);
  });

  it('https url + localhost relay → auto-appends', () => {
    const args = parseArgs([
      '--url',
      'https://qontinui.io/login',
      '--relay',
      'http://localhost:3001/api/ui-bridge',
    ]);
    expect(buildLaunchArgs(args).lnaAutoAppended).toBe(true);
  });

  it('https url + [::1] relay → auto-appends', () => {
    const args = parseArgs([
      '--url',
      'https://qontinui.io/login',
      '--relay',
      'http://[::1]:9877/ui-bridge',
    ]);
    expect(buildLaunchArgs(args).lnaAutoAppended).toBe(true);
  });

  it('http (non-https) url + loopback relay → NOT appended (no LNA block applies)', () => {
    const args = parseArgs([
      '--url',
      'http://localhost:3000/login',
      '--relay',
      'http://127.0.0.1:9877/ui-bridge',
    ]);
    const { launchArgs, lnaAutoAppended } = buildLaunchArgs(args);
    expect(lnaAutoAppended).toBe(false);
    expect(launchArgs).toEqual([]);
    expect('launchArgs' in buildTransportOptions(args)).toBe(false);
  });

  it('https url + non-loopback relay → NOT appended', () => {
    const args = parseArgs([
      '--url',
      'https://qontinui.io/login',
      '--relay',
      'https://qontinui.io/api/ui-bridge',
    ]);
    expect(buildLaunchArgs(args).lnaAutoAppended).toBe(false);
  });

  it('--launch-arg values pass through (order preserved) and combine with the auto-append', () => {
    const args = parseArgs([
      '--url',
      'https://qontinui.io/login',
      '--relay',
      'http://127.0.0.1:9877/ui-bridge',
      '--launch-arg',
      '--no-sandbox',
      '--launch-arg',
      '--lang=en-US',
    ]);
    expect(args.launchArgs).toEqual(['--no-sandbox', '--lang=en-US']);
    const { launchArgs } = buildLaunchArgs(args);
    expect(launchArgs).toEqual(['--no-sandbox', '--lang=en-US', LNA_FLAG]);
  });

  it('merges the LNA features into a user-supplied --disable-features instead of duplicating the flag', () => {
    const args = parseArgs([
      '--url',
      'https://qontinui.io/login',
      '--relay',
      'http://127.0.0.1:9877/ui-bridge',
      '--launch-arg',
      '--disable-features=Translate',
    ]);
    const { launchArgs, lnaAutoAppended } = buildLaunchArgs(args);
    expect(lnaAutoAppended).toBe(true);
    expect(launchArgs).toEqual([
      '--disable-features=Translate,LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults',
    ]);
  });

  it('does not re-append when the user already disabled the LNA features', () => {
    const args = parseArgs([
      '--url',
      'https://qontinui.io/login',
      '--relay',
      'http://127.0.0.1:9877/ui-bridge',
      '--launch-arg',
      LNA_FLAG,
    ]);
    const { launchArgs, lnaAutoAppended } = buildLaunchArgs(args);
    expect(lnaAutoAppended).toBe(false);
    expect(launchArgs).toEqual([LNA_FLAG]);
  });

  it('--launch-arg without a value errors', () => {
    expect(() =>
      parseArgs(['--url', 'https://x.io', '--exec', 'find {}', '--launch-arg'])
    ).toThrow(InjectCliArgError);
  });

  it('isLoopbackHost classifies hosts correctly', () => {
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('app.localhost')).toBe(true);
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('127.1.2.3')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('[::1]')).toBe(true);
    expect(isLoopbackHost('qontinui.io')).toBe(false);
    expect(isLoopbackHost('192.168.1.10')).toBe(false);
  });
});
