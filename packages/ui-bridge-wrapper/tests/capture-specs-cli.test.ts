import { describe, it, expect, afterEach } from 'vitest';
import {
  parseArgs,
  validateArgs,
  parsePages,
  defaultTargets,
  computeLoginUrl,
  CaptureCliArgError,
  USAGE,
} from '../src/capture-specs-cli.js';

const CREDS = ['--email', 'a@b.c', '--password', 'pw'];
const ORIGIN = 'https://qontinui.io';

afterEach(() => {
  delete process.env.UIB_LOGIN_EMAIL;
  delete process.env.UIB_LOGIN_PASSWORD;
});

describe('parseArgs', () => {
  it('defaults out/origin/timeout and parses creds', () => {
    const args = parseArgs([...CREDS]);
    expect(args.out).toBe('D:/qontinui-root/spec-capture');
    expect(args.origin).toBe(ORIGIN);
    expect(args.timeoutMs).toBe(70000);
    expect(args.pages).toBeNull();
  });

  it('reads creds from env when flags absent', () => {
    process.env.UIB_LOGIN_EMAIL = 'env@b.c';
    process.env.UIB_LOGIN_PASSWORD = 'envpw';
    const args = parseArgs([]);
    expect(args.email).toBe('env@b.c');
    expect(args.password).toBe('envpw');
  });

  it('parses --pages into targets joined to origin', () => {
    const args = parseArgs([...CREDS, '--pages', 'a=/x, b=/y']);
    expect(args.pages).toEqual([
      { slug: 'a', url: `${ORIGIN}/x` },
      { slug: 'b', url: `${ORIGIN}/y` },
    ]);
  });

  it('throws on missing creds and unknown flags', () => {
    expect(() => parseArgs([])).toThrow(CaptureCliArgError);
    expect(() => parseArgs([...CREDS, '--bogus'])).toThrow(/Unknown flag/);
  });

  it('rejects a non-positive --timeout', () => {
    expect(() => parseArgs([...CREDS, '--timeout', '0'])).toThrow(CaptureCliArgError);
  });

  // Finding 3.3 — a PRESENT-but-empty --pages parses to [] and used to exit 0
  // with an empty --out dir (the false-success class #83). It must now error.
  it('rejects a present-but-empty --pages spec (whitespace) with exit-2 error', () => {
    expect(() => parseArgs([...CREDS, '--pages', '  '])).toThrow(CaptureCliArgError);
    expect(() => parseArgs([...CREDS, '--pages', '  '])).toThrow(/parsed to zero targets/);
  });

  it('rejects an empty-string --pages spec', () => {
    expect(() => parseArgs([...CREDS, '--pages', ''])).toThrow(/parsed to zero targets/);
  });

  it('keeps an ABSENT --pages as null (defaultTargets path, not an error)', () => {
    expect(parseArgs([...CREDS]).pages).toBeNull();
  });

  // Finding 3.2 — a value-flag must not swallow a following flag as its value.
  it('rejects a flag-shaped value for --pages (swallow fix)', () => {
    expect(() => parseArgs([...CREDS, '--pages', '--device'])).toThrow(
      /--pages expects a value but got the flag '--device'/
    );
  });

  it('parses --quiet', () => {
    expect(parseArgs([...CREDS, '--quiet']).quiet).toBe(true);
    expect(parseArgs([...CREDS]).quiet).toBe(false);
  });

  it('treats --help as always valid', () => {
    const args = parseArgs(['--help']);
    expect(args.help).toBe(true);
    expect(() => validateArgs(args)).not.toThrow();
  });

  it('exports a non-empty USAGE', () => {
    expect(USAGE).toContain('--pages');
    expect(USAGE).toContain('--out');
  });
});

describe('parsePages', () => {
  it('uses absolute http(s) URLs verbatim', () => {
    expect(parsePages('ext=https://other.io/z', ORIGIN)).toEqual([
      { slug: 'ext', url: 'https://other.io/z' },
    ]);
  });
  it('joins a leading-slash-less path correctly', () => {
    expect(parsePages('a=x', ORIGIN)).toEqual([{ slug: 'a', url: `${ORIGIN}/x` }]);
  });
  it('throws on a malformed entry (no =)', () => {
    expect(() => parsePages('bogus', ORIGIN)).toThrow(CaptureCliArgError);
  });
});

describe('defaultTargets', () => {
  it('builds the two admin coord pages with the device id', () => {
    const t = defaultTargets(ORIGIN, 'dev-1');
    expect(t[0]).toEqual({ slug: 'admin-coord-trees', url: `${ORIGIN}/admin/coord/trees?device_id=dev-1` });
    expect(t[1]!.slug).toBe('admin-coord-pull-decisions');
  });
});

describe('computeLoginUrl (deep-link via ?next=)', () => {
  it('deep-links through the first same-origin target', () => {
    const targets = [{ slug: 't', url: `${ORIGIN}/admin/coord/trees?device_id=d` }];
    const { loginUrl, firstNext } = computeLoginUrl(targets, ORIGIN);
    expect(firstNext).toBe('/admin/coord/trees?device_id=d');
    expect(loginUrl).toBe(
      `${ORIGIN}/login?next=${encodeURIComponent('/admin/coord/trees?device_id=d')}`
    );
  });

  it('falls back to bare /login for a cross-origin first target', () => {
    const targets = [{ slug: 't', url: 'https://other.io/z' }];
    const { loginUrl, firstNext } = computeLoginUrl(targets, ORIGIN);
    expect(firstNext).toBeNull();
    expect(loginUrl).toBe(`${ORIGIN}/login`);
  });
});

// URL classifiers (isCognito / isAppLoginPath / pathOf) moved to
// tests/login-drive.test.ts — single home for URL classification. The cases
// that used to live here (isCognito on /login?next=, the isLoginPath→
// isAppLoginPath bounce/authed cases, pathOf query-strip) are folded in there.
