import { describe, it, expect, vi } from 'vitest';
import type { Page } from 'playwright';
import {
  isCognito,
  pathOf,
  isSuccessPath,
  isAppLoginPath,
  loginDrive,
} from '../src/login-drive.js';

// ── URL classifiers (single home — moved here from both CLI test files) ──────

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
    expect(isCognito('https://qontinui.io/login?next=%2Fadmin')).toBe(false);
  });
});

describe('pathOf', () => {
  it('returns the pathname only, never the query', () => {
    expect(pathOf('https://qontinui.io/build/workflows?x=1#h')).toBe('/build/workflows');
    expect(pathOf('https://qontinui.io/admin/coord/trees?device_id=d')).toBe('/admin/coord/trees');
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
    expect(isAppLoginPath('https://qontinui.io/login?next=%2Fadmin')).toBe(true);
  });
  it('false for the Cognito hosted UI', () => {
    expect(isAppLoginPath('https://auth.qontinui.io/login')).toBe(false);
  });
  it('false for an authed landing', () => {
    expect(isAppLoginPath('https://qontinui.io/build/workflows')).toBe(false);
    expect(isAppLoginPath('https://qontinui.io/admin/coord/trees')).toBe(false);
  });
});

// ── loginDrive (selector-walk logic against a mocked Page) ───────────────────

/** A mock Playwright Locator. Only the surface loginDrive touches. */
interface MockLocator {
  count: () => Promise<number>;
  nth: (i: number) => MockLocator;
  first: () => MockLocator;
  isVisible: () => Promise<boolean>;
  fill: (val: string, opts?: unknown) => Promise<void>;
  click: (opts?: unknown) => Promise<void>;
  innerText: () => Promise<string>;
  waitFor: (opts?: unknown) => Promise<void>;
  or: (other: MockLocator) => MockLocator;
}

const noopLocator = (overrides: Partial<MockLocator> = {}): MockLocator => {
  const base: MockLocator = {
    count: async () => 0,
    nth: () => base,
    first: () => base,
    isVisible: async () => false,
    fill: async () => {},
    click: async () => {},
    innerText: async () => '',
    waitFor: async () => {},
    or: () => base,
    ...overrides,
  };
  return base;
};

/** Build a single element-locator (one row in a multi-match list). */
const elementLocator = (visible: boolean, calls: { fills: string[]; clicks: number }, text = ''): MockLocator =>
  noopLocator({
    isVisible: async () => visible,
    fill: async (val: string) => {
      calls.fills.push(val);
    },
    click: async () => {
      calls.clicks += 1;
    },
    innerText: async () => text,
  });

/** A locator that exposes `count` matches, each from `rows[i]`. */
const listLocator = (rows: MockLocator[]): MockLocator =>
  noopLocator({
    count: async () => rows.length,
    nth: (i: number) => rows[i] ?? noopLocator(),
    first: () => rows[0] ?? noopLocator(),
  });

interface MockPageOpts {
  /** URLs returned by page.url() in sequence; the last value sticks. */
  urls: string[];
  /** Map of selector string -> locator factory. */
  locators?: Record<string, () => MockLocator>;
  /** continue-with-email button locator (getByRole/getByText). */
  emailBtn?: MockLocator;
  /** Make waitForURL reject (timeout) the Nth time it's called. */
  rejectWaitForURLAt?: number;
  calls: { fills: string[]; clicks: number };
}

function makeMockPage(opts: MockPageOpts): Page {
  // `urls` are the SETTLED states in order. page.url() returns the current
  // settled state (stable between waits); each successful waitForURL advances
  // to the next state. A rejected waitForURL does NOT advance.
  let urlIdx = 0;
  let waitForURLCalls = 0;
  const emailBtn = opts.emailBtn ?? elementLocator(true, opts.calls);

  const page = {
    url: () => opts.urls[Math.min(urlIdx, opts.urls.length - 1)]!,
    getByRole: () => emailBtn,
    getByText: () => emailBtn,
    locator: (sel: string) => opts.locators?.[sel]?.() ?? noopLocator(),
    waitForURL: async (pred: (u: { toString(): string }) => boolean) => {
      waitForURLCalls += 1;
      // The page navigates to the next settled state regardless; a rejecting
      // wait means the predicate was never satisfied there (e.g. stuck on
      // /auth/callback), so we advance THEN throw.
      if (urlIdx < opts.urls.length - 1) urlIdx += 1;
      if (opts.rejectWaitForURLAt === waitForURLCalls) throw new Error('timeout');
      // exercise the predicate against the new url (result unused by the mock)
      pred({ toString: () => opts.urls[Math.min(urlIdx, opts.urls.length - 1)]! });
    },
    waitForLoadState: async () => {},
    waitForFunction: async () => {},
    evaluate: async () => pathOf(opts.urls[Math.min(urlIdx, opts.urls.length - 1)]!),
  } as unknown as Page;
  return page;
}

describe('loginDrive', () => {
  it('(a) hidden-duplicate pick — fills the VISIBLE match, not the first', async () => {
    const calls = { fills: [] as string[], clicks: 0 };
    const hiddenEmail = elementLocator(false, calls);
    const visibleEmail = elementLocator(true, calls);
    const visiblePassword = elementLocator(true, calls);
    const visibleSubmit = elementLocator(true, calls);
    const page = makeMockPage({
      // login page -> cognito (form) -> authed landing
      urls: ['https://qontinui.io/login', 'https://auth.qontinui.io/login', 'https://qontinui.io/build/workflows'],
      calls,
      locators: {
        '#signInFormUsername': () => listLocator([hiddenEmail, visibleEmail]),
        '#signInFormPassword': () => listLocator([visiblePassword]),
        'input[name="signInSubmitButton"], button[type="submit"], input[type="submit"], [name="signInSubmitButton"]':
          () => listLocator([visibleSubmit]),
      },
    });
    const r = await loginDrive(page, { email: 'e@x.io', password: 'pw', timeoutMs: 1000 });
    expect(r.ok).toBe(true);
    expect(calls.fills).toEqual(['e@x.io', 'pw']); // filled exactly once each, visible only
    expect(calls.clicks).toBeGreaterThanOrEqual(2); // email button + submit
  });

  it('(b) submit fallback — no visible submit in the walk → role-fallback click fires', async () => {
    const calls = { fills: [] as string[], clicks: 0 };
    const roleFallback = elementLocator(true, calls);
    let roleCalls = 0;
    const page = makeMockPage({
      urls: ['https://qontinui.io/login', 'https://auth.qontinui.io/login', 'https://qontinui.io/dashboard'],
      calls,
      emailBtn: elementLocator(true, calls),
      locators: {
        '#signInFormUsername': () => listLocator([elementLocator(true, calls)]),
        '#signInFormPassword': () => listLocator([elementLocator(true, calls)]),
        // submit walk: a single INVISIBLE match → no click in the loop
        'input[name="signInSubmitButton"], button[type="submit"], input[type="submit"], [name="signInSubmitButton"]':
          () => listLocator([elementLocator(false, calls)]),
      },
    });
    // Override getByRole so the role fallback is observable: the email button
    // (continue-with-email) and the submit role fallback both go through getByRole.
    (page as unknown as { getByRole: (o?: unknown) => MockLocator }).getByRole = () => {
      roleCalls += 1;
      return roleFallback;
    };
    const r = await loginDrive(page, { email: 'e@x.io', password: 'pw', timeoutMs: 1000 });
    expect(r.ok).toBe(true);
    // email button click + role-fallback submit click both fired via roleFallback
    expect(roleCalls).toBeGreaterThanOrEqual(2);
    expect(calls.clicks).toBeGreaterThanOrEqual(2);
  });

  it('(c) stalled callback → ok:false + errorText scraped from a visible alert', async () => {
    const calls = { fills: [] as string[], clicks: 0 };
    const page = makeMockPage({
      // login -> cognito -> stuck on /auth/callback (post-submit wait rejects)
      urls: ['https://qontinui.io/login', 'https://auth.qontinui.io/login', 'https://qontinui.io/auth/callback'],
      calls,
      // 2nd waitForURL (the post-submit "leave callback" wait) times out
      rejectWaitForURLAt: 2,
      locators: {
        '#signInFormUsername': () => listLocator([elementLocator(true, calls)]),
        '#signInFormPassword': () => listLocator([elementLocator(true, calls)]),
        'input[name="signInSubmitButton"], button[type="submit"], input[type="submit"], [name="signInSubmitButton"]':
          () => listLocator([elementLocator(true, calls)]),
        '[role="alert"], #loginErrorMessage, .error-message, [class*="error" i], [data-testid*="error" i]':
          () => listLocator([elementLocator(true, calls, 'OAuth state mismatch')]),
      },
    });
    const r = await loginDrive(page, { email: 'e@x.io', password: 'pw', timeoutMs: 1000 });
    expect(r.ok).toBe(false);
    expect(r.errorText).toBe('OAuth state mismatch');
    expect(pathOf(r.finalUrl)).toBe('/auth/callback');
  });

  it('(d) SSO-skip path — never on Cognito → ok:true without filling', async () => {
    const calls = { fills: [] as string[], clicks: 0 };
    const page = makeMockPage({
      // login page -> straight to an authed landing (live SSO session)
      urls: ['https://qontinui.io/login', 'https://qontinui.io/build/workflows'],
      calls,
    });
    const r = await loginDrive(page, { email: 'e@x.io', password: 'pw', timeoutMs: 1000 });
    expect(r.ok).toBe(true);
    expect(calls.fills).toEqual([]); // form was never filled
    expect(r.landingPath).toBe('/build/workflows');
  });

  it('(e) bounce-back-to-login → ok:false', async () => {
    const calls = { fills: [] as string[], clicks: 0 };
    const page = makeMockPage({
      // login -> cognito -> bounced back to the app /login page
      urls: ['https://qontinui.io/login', 'https://auth.qontinui.io/login', 'https://qontinui.io/login?next=%2Fbuild'],
      calls,
      locators: {
        '#signInFormUsername': () => listLocator([elementLocator(true, calls)]),
        '#signInFormPassword': () => listLocator([elementLocator(true, calls)]),
        'input[name="signInSubmitButton"], button[type="submit"], input[type="submit"], [name="signInSubmitButton"]':
          () => listLocator([elementLocator(true, calls)]),
      },
    });
    const r = await loginDrive(page, { email: 'e@x.io', password: 'pw', timeoutMs: 1000 });
    expect(r.ok).toBe(false);
    expect(isAppLoginPath(r.finalUrl)).toBe(true);
  });

  it('passes a log hook that receives diagnostic lines', async () => {
    const calls = { fills: [] as string[], clicks: 0 };
    const log = vi.fn();
    const page = makeMockPage({
      urls: ['https://qontinui.io/login', 'https://qontinui.io/dashboard'],
      calls,
    });
    await loginDrive(page, { email: 'e@x.io', password: 'pw', timeoutMs: 1000, log });
    expect(log).toHaveBeenCalled();
    expect(log.mock.calls.some((c) => String(c[0]).startsWith('landed'))).toBe(true);
  });
});
