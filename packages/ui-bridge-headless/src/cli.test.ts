import { describe, it, expect } from 'vitest';
import { parseArgs, HeadlessCliArgError } from './cli.js';

// These exercise the pure `parseArgs` — no browser is launched (the module's
// `void main()` is guarded behind an `isMain` check, so importing it is inert).

describe('parseArgs — happy path', () => {
  it('parses a bare --url', () => {
    const a = parseArgs(['--url', 'http://localhost:3001']);
    expect(a.url).toBe('http://localhost:3001');
    expect(a.headless).toBe(false);
  });

  it('parses url + ui-bridge + headless together (no swallow when values are real)', () => {
    const a = parseArgs([
      '--url',
      'http://x',
      '--ui-bridge',
      'http://x/api/ui-bridge',
      '--headless',
    ]);
    expect(a.url).toBe('http://x');
    expect(a.uiBridgeBase).toBe('http://x/api/ui-bridge');
    expect(a.headless).toBe(true);
  });

  it('parses --keep-alive as a positive integer', () => {
    expect(parseArgs(['--url', 'http://x', '--keep-alive', '300']).keepAliveSecs).toBe(300);
  });

  it('parses --viewport WxH', () => {
    const a = parseArgs(['--url', 'http://x', '--viewport', '800x600']);
    expect(a.viewportWidth).toBe(800);
    expect(a.viewportHeight).toBe(600);
  });

  it('parses --auth-token and --user-agent values', () => {
    const a = parseArgs([
      '--url',
      'http://x',
      '--auth-token',
      'tok123',
      '--user-agent',
      'Custom/1.0',
    ]);
    expect(a.authToken).toBe('tok123');
    expect(a.userAgent).toBe('Custom/1.0');
  });
});

describe('parseArgs — flag-shaped-value swallow guard', () => {
  // The defect this plan kills: a value-flag followed by another --flag must
  // error, not silently swallow the flag as its value.
  it('rejects --ui-bridge --headless (silent-swallow case with no downstream validation)', () => {
    expect(() => parseArgs(['--url', 'http://x', '--ui-bridge', '--headless'])).toThrow(
      HeadlessCliArgError
    );
  });

  it('rejects --auth-token --headless', () => {
    expect(() => parseArgs(['--url', 'http://x', '--auth-token', '--headless'])).toThrow(
      HeadlessCliArgError
    );
  });

  it('rejects --user-agent --headless', () => {
    expect(() => parseArgs(['--url', 'http://x', '--user-agent', '--headless'])).toThrow(
      HeadlessCliArgError
    );
  });

  it('rejects --url --headless with a flag-shaped error (not a bogus navigation)', () => {
    expect(() => parseArgs(['--url', '--headless'])).toThrow(HeadlessCliArgError);
  });

  it('rejects --wait-ms --headless', () => {
    expect(() => parseArgs(['--url', 'http://x', '--wait-ms', '--headless'])).toThrow(
      HeadlessCliArgError
    );
  });

  it('rejects --viewport --headless', () => {
    expect(() => parseArgs(['--url', 'http://x', '--viewport', '--headless'])).toThrow(
      HeadlessCliArgError
    );
  });
});

describe('parseArgs — negative-numeric discriminator (single dash is NOT flag-shaped)', () => {
  it('reads --keep-alive -1 as a value, then fails its own range check (not the swallow guard)', () => {
    let msg = '';
    try {
      parseArgs(['--url', 'http://x', '--keep-alive', '-1']);
    } catch (err) {
      msg = err instanceof Error ? err.message : String(err);
    }
    // It reached the positive-integer check, proving -1 was consumed as a value.
    expect(msg).toContain('positive integer');
    expect(msg).not.toContain('the flag');
  });
});

describe('parseArgs — validation', () => {
  it('requires --url', () => {
    expect(() => parseArgs([])).toThrow(/--url is required/);
  });

  it('rejects a non-http --url', () => {
    expect(() => parseArgs(['--url', 'ftp://x'])).toThrow(/must start with http/);
  });

  it('rejects an unknown flag', () => {
    expect(() => parseArgs(['--url', 'http://x', '--bogus'])).toThrow(/Unknown flag: --bogus/);
  });

  it('does not require --url when --help is present', () => {
    expect(parseArgs(['--help']).help).toBe(true);
  });
});
