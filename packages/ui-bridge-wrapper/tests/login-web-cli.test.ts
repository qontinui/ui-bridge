import { describe, it, expect, afterEach } from 'vitest';
import {
  parseArgs,
  validateArgs,
  isCognito,
  pathOf,
  isSuccessPath,
  isAppLoginPath,
  LoginCliArgError,
  USAGE,
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

  it('throws on an unknown flag', () => {
    expect(() => parseArgs([...CREDS, '--bogus'])).toThrow(/Unknown flag/);
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
  });
});

// The #85 diagnostic fix: Cognito is host/oauth2-based, NEVER a bare /login? path.
describe('isCognito (host-based, not path-based — #85)', () => {
  it('matches the Cognito custom domain and raw cognito domain', () => {
    expect(isCognito('https://auth.qontinui.io/login?foo=1')).toBe(true);
    expect(isCognito('https://x.auth.eu-central-1.amazoncognito.com/login')).toBe(true);
  });
  it('matches /oauth2/ endpoints', () => {
    expect(isCognito('https://qontinui.io/oauth2/authorize')).toBe(true);
  });
  it('does NOT match the app own /login?next= page', () => {
    expect(isCognito('https://qontinui.io/login?next=%2Fbuild%2Fworkflows')).toBe(false);
  });
});

describe('pathOf', () => {
  it('returns the pathname only, never the query', () => {
    expect(pathOf('https://qontinui.io/build/workflows?x=1#h')).toBe('/build/workflows');
  });
  it('returns empty string for an unparseable value', () => {
    expect(pathOf('not a url')).toBe('');
  });
});

describe('isSuccessPath (pathname-only — query cannot fake success, #81)', () => {
  it('matches when the pathname contains the success substring', () => {
    expect(isSuccessPath('https://qontinui.io/build/workflows', '/build/workflows')).toBe(true);
  });
  it('does NOT match a query param echoing the path on a stuck callback', () => {
    expect(isSuccessPath('https://qontinui.io/auth/callback?state=%2Fbuild', '/build')).toBe(false);
  });
});

describe('isAppLoginPath (own login page, not Cognito)', () => {
  it('true for the app own /login?next= page (failure bounce)', () => {
    expect(isAppLoginPath('https://qontinui.io/login?next=%2Fbuild')).toBe(true);
  });
  it('false for the Cognito hosted UI', () => {
    expect(isAppLoginPath('https://auth.qontinui.io/login')).toBe(false);
  });
  it('false for an authed landing', () => {
    expect(isAppLoginPath('https://qontinui.io/build/workflows')).toBe(false);
  });
});
