import { describe, it, expect } from 'vitest';
import {
  parseArgs,
  buildTransportOptions,
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
