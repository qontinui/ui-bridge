/**
 * The one navigation URL gate (plan 2026-11-08-relayed-ui-bridge-actions-have-no-browser-case,
 * Phase 3, D3), and every site that asks it.
 *
 * One table, run against:
 *   - `checkNavigationUrl` itself (the relay's placeholder base);
 *   - the relay `pageNavigate`, which keeps its own relay-only FORMAT rule (a
 *     bare `settings` is refused there: the relay has no page to resolve it
 *     against) — so `settings` has two expected rows;
 *   - the relay `navigateByAdapter`, which refuses before anything reaches a tab;
 *   - the page's `navigateByAdapter` case (exec mode,
 *     `window.__uiBridgeInjected.execute`), and the in-process
 *     `createHandlers(…).navigateByAdapter`.
 *
 * A refusal carries `INVALID_URL_PROTOCOL` / `INVALID_URL_FORMAT`; on an
 * envelope both map to `UB-VALIDATION-ERROR` (the most security-relevant
 * refusal used to arrive as `UB-UNKNOWN-ERROR`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkNavigationTarget,
  checkNavigationUrl,
  isBareRouteName,
  navigationPathForm,
  adapterNavigationTarget,
  originRoot,
  sameOriginPathOf,
  softNavigationPath,
  softResolutionBase,
  RELAY_NAVIGATION_BASE,
} from './navigation-url';
import { mapInternalErrorCode } from '../diagnostics';
import { CommandRelay } from '../server/command-relay';
import { createRelayHandlers } from '../server/relay-handlers';
import { createHandlers, type RegistryLike } from '../server/handlers';
import { UIBridgeRegistry, setGlobalRegistry } from './registry';
import { DefaultActionExecutor } from '../control/action-executor';
import { WindowLocationAdapter, type NavigationAdapter } from '../navigation/navigation-adapter';

type Verdict = 'ok' | 'INVALID_URL_PROTOCOL' | 'INVALID_URL_FORMAT';

const DANGEROUS = (p: string) =>
  `Dangerous URL protocol rejected: "${p}". Only http, https, and relative paths are allowed.`;
const NOT_HTTP = (p: string) =>
  `Invalid URL protocol "${p}". Only http, https, and relative paths are allowed.`;
const UNPARSEABLE = (u: string) => `Invalid URL format: "${u}" does not parse as a URL.`;
const RELAY_FORMAT =
  'Invalid URL format. Only http, https, and relative paths starting with "/" are allowed.';

interface Row {
  url: string;
  /** The gate's (and `navigateByAdapter`'s, on every side) verdict. */
  gate: Verdict;
  gateMessage?: string;
  /** The relay `pageNavigate`'s verdict, where its relay-only FORMAT rule differs. */
  relayPageNavigate: Verdict;
  relayPageNavigateMessage?: string;
  /**
   * `navigateByAdapter`'s verdict WITH an adapter, where it differs from the
   * gate's: an adapter is a soft navigator, so another origin is refused.
   */
  withAdapter?: Verdict;
}

const TABLE: Row[] = [
  {
    url: 'javascript:alert(1)',
    gate: 'INVALID_URL_PROTOCOL',
    gateMessage: DANGEROUS('javascript:'),
    relayPageNavigate: 'INVALID_URL_PROTOCOL',
    relayPageNavigateMessage: DANGEROUS('javascript:'),
  },
  {
    url: 'data:text/html,x',
    gate: 'INVALID_URL_PROTOCOL',
    gateMessage: DANGEROUS('data:'),
    relayPageNavigate: 'INVALID_URL_PROTOCOL',
    relayPageNavigateMessage: DANGEROUS('data:'),
  },
  {
    url: 'blob:x',
    gate: 'INVALID_URL_PROTOCOL',
    gateMessage: DANGEROUS('blob:'),
    relayPageNavigate: 'INVALID_URL_PROTOCOL',
    relayPageNavigateMessage: DANGEROUS('blob:'),
  },
  {
    url: 'vbscript:x',
    gate: 'INVALID_URL_PROTOCOL',
    gateMessage: DANGEROUS('vbscript:'),
    relayPageNavigate: 'INVALID_URL_PROTOCOL',
    relayPageNavigateMessage: DANGEROUS('vbscript:'),
  },
  {
    url: 'ftp://x',
    gate: 'INVALID_URL_PROTOCOL',
    gateMessage: NOT_HTTP('ftp:'),
    relayPageNavigate: 'INVALID_URL_PROTOCOL',
    relayPageNavigateMessage: NOT_HTTP('ftp:'),
  },
  {
    url: 'https://example.test/a',
    gate: 'ok',
    relayPageNavigate: 'ok',
    withAdapter: 'INVALID_URL_FORMAT',
  },
  { url: '/a?b#c', gate: 'ok', relayPageNavigate: 'ok' },
  // The two rows of a bare page name: refused by the relay `pageNavigate`'s
  // own FORMAT rule, allowed by the gate and so by `navigateByAdapter`.
  {
    url: 'settings',
    gate: 'ok',
    relayPageNavigate: 'INVALID_URL_FORMAT',
    relayPageNavigateMessage: RELAY_FORMAT,
  },
  {
    url: 'http://[',
    gate: 'INVALID_URL_FORMAT',
    gateMessage: UNPARSEABLE('http://['),
    relayPageNavigate: 'INVALID_URL_FORMAT',
    relayPageNavigateMessage: RELAY_FORMAT,
  },
  // Spellings the URL parser normalizes: a leading space and mixed case, a tab
  // inside the scheme. Both are still `javascript:`.
  {
    url: ' JavaScript:alert(1)',
    gate: 'INVALID_URL_PROTOCOL',
    gateMessage: DANGEROUS('javascript:'),
    relayPageNavigate: 'INVALID_URL_PROTOCOL',
    relayPageNavigateMessage: DANGEROUS('javascript:'),
  },
  {
    url: 'java\tscript:x',
    gate: 'INVALID_URL_PROTOCOL',
    gateMessage: DANGEROUS('javascript:'),
    relayPageNavigate: 'INVALID_URL_PROTOCOL',
    relayPageNavigateMessage: DANGEROUS('javascript:'),
  },
  {
    url: 'JAVASCRIPT:alert(1)\n',
    gate: 'INVALID_URL_PROTOCOL',
    gateMessage: DANGEROUS('javascript:'),
    relayPageNavigate: 'INVALID_URL_PROTOCOL',
    relayPageNavigateMessage: DANGEROUS('javascript:'),
  },
  // A percent-encoded colon is not a scheme separator: this is a relative PATH
  // named `javascript%3Aalert(1)` on the page's own (http) origin, which runs
  // nothing. The relay's own FORMAT rule still refuses it (no leading `/`).
  {
    url: 'javascript%3Aalert(1)',
    gate: 'ok',
    relayPageNavigate: 'INVALID_URL_FORMAT',
    relayPageNavigateMessage: RELAY_FORMAT,
  },
  // A control character before a root-relative path is stripped by the parser,
  // so the gate reads it as the path it is; the relay's FORMAT rule (a literal
  // leading `/`) refuses it.
  {
    url: ' /settings',
    gate: 'ok',
    relayPageNavigate: 'INVALID_URL_FORMAT',
    relayPageNavigateMessage: RELAY_FORMAT,
  },
];

/** The page bases a root-relative path must pass on, whatever their scheme. */
const NON_HTTP_BASES = ['tauri://localhost/', 'file:///x', 'about:blank'];

describe('checkNavigationUrl on a non-http base', () => {
  it.each(NON_HTTP_BASES)('%s: a root-relative path passes', (base) => {
    for (const url of ['/settings', '/a?b#c', '/', ' /settings', '/sub\tpath']) {
      expect(checkNavigationUrl(url, base)).toEqual({ ok: true });
    }
  });

  it.each(NON_HTTP_BASES)('%s: a script scheme is still refused', (base) => {
    for (const url of ['javascript:alert(1)', ' JavaScript:alert(1)', 'java\tscript:x']) {
      expect(checkNavigationUrl(url, base)).toEqual({
        ok: false,
        code: 'INVALID_URL_PROTOCOL',
        message: DANGEROUS('javascript:'),
      });
    }
  });

  it('a protocol-relative `//host` (or `/\\host`) is not a path: it takes the base scheme', () => {
    expect(checkNavigationUrl('//evil.test/x', 'tauri://localhost/')).toEqual({
      ok: false,
      code: 'INVALID_URL_PROTOCOL',
      message: NOT_HTTP('tauri:'),
    });
    expect(checkNavigationUrl('/\\evil.test/x', 'tauri://localhost/')).toEqual({
      ok: false,
      code: 'INVALID_URL_PROTOCOL',
      message: NOT_HTTP('tauri:'),
    });
    expect(checkNavigationUrl('/\t/evil.test/x', 'tauri://localhost/')).toEqual({
      ok: false,
      code: 'INVALID_URL_PROTOCOL',
      message: NOT_HTTP('tauri:'),
    });
    expect(checkNavigationUrl('//evil.test/x', 'about:blank')).toEqual({
      ok: false,
      code: 'INVALID_URL_FORMAT',
      message: UNPARSEABLE('//evil.test/x'),
    });
  });

  it('a bare name inherits the base scheme: refused on tauri, unparseable on about:blank', () => {
    expect(checkNavigationUrl('settings', 'tauri://localhost/')).toEqual({
      ok: false,
      code: 'INVALID_URL_PROTOCOL',
      message: NOT_HTTP('tauri:'),
    });
    expect(checkNavigationUrl('settings', 'about:blank')).toEqual({
      ok: false,
      code: 'INVALID_URL_FORMAT',
      message: UNPARSEABLE('settings'),
    });
  });
});

describe('checkNavigationUrl', () => {
  it.each(TABLE)('$url → $gate', ({ url, gate, gateMessage }) => {
    const verdict = checkNavigationUrl(url, RELAY_NAVIGATION_BASE);
    if (gate === 'ok') {
      expect(verdict).toEqual({ ok: true });
    } else {
      expect(verdict).toEqual({ ok: false, code: gate, message: gateMessage });
    }
  });

  it('a page base admits the same rows as the relay base', () => {
    for (const { url, gate } of TABLE) {
      const verdict = checkNavigationUrl(url, 'http://localhost:3000/some/page?x=1');
      expect(verdict.ok ? 'ok' : verdict.code).toBe(gate);
    }
  });

  it('both refusal codes map to UB-VALIDATION-ERROR on an envelope', () => {
    expect(mapInternalErrorCode('INVALID_URL_PROTOCOL', DANGEROUS('javascript:'))).toBe(
      'UB-VALIDATION-ERROR'
    );
    expect(mapInternalErrorCode('INVALID_URL_FORMAT', UNPARSEABLE('http://['))).toBe(
      'UB-VALIDATION-ERROR'
    );
  });
});

// ---------------------------------------------------------------------------
// The relay sites
// ---------------------------------------------------------------------------

const relays: CommandRelay[] = [];

function freshRelay(): CommandRelay {
  const prefix = `__uiBridgeTest_${Math.random().toString(36).slice(2, 10)}`;
  const relay = new CommandRelay({ globalPrefix: prefix, proactiveSnapshot: false });
  relays.push(relay);
  return relay;
}

/** A tab answering every command with `answer`, recording what it was sent. */
function tab(relay: CommandRelay, answer: unknown) {
  const seen: Array<{ action: string; payload: unknown }> = [];
  relay.subscribeToCommands((cmd) => {
    seen.push({ action: cmd.action, payload: cmd.payload });
    setTimeout(() => relay.resolveCommand(cmd.commandId, answer, 'tab-a'), 0);
  }, 'tab-a');
  return seen;
}

const NAVIGATED = { navigated: true, route: { name: 'Settings', path: '/settings' } };

describe('the relay pageNavigate (its relay-only FORMAT rule kept)', () => {
  afterEach(() => {
    for (const relay of relays.splice(0)) relay.destroy();
  });

  it.each(TABLE)(
    '$url → $relayPageNavigate',
    async ({ url, relayPageNavigate, relayPageNavigateMessage }) => {
      const relay = freshRelay();
      const seen = tab(relay, { success: true, url });
      const result = await createRelayHandlers(relay).pageNavigate({ url });
      if (relayPageNavigate === 'ok') {
        expect(result.success).toBe(true);
        expect(seen).toEqual([{ action: 'pageNavigate', payload: { url } }]);
      } else {
        expect(result).toMatchObject({
          success: false,
          error: relayPageNavigateMessage,
          code: 'UB-VALIDATION-ERROR',
        });
        expect(seen).toEqual([]);
      }
    }
  );
});

describe('the relay navigateByAdapter (refuses before relaying)', () => {
  afterEach(() => {
    for (const relay of relays.splice(0)) relay.destroy();
  });

  it.each(TABLE)('$url → $gate', async ({ url, gate, gateMessage }) => {
    const relay = freshRelay();
    const seen = tab(relay, NAVIGATED);
    const result = await createRelayHandlers(relay).navigateByAdapter({ page: url });
    if (gate === 'ok') {
      expect(result).toMatchObject({ success: true, data: NAVIGATED });
      expect(seen).toEqual([{ action: 'navigateByAdapter', payload: { page: url } }]);
    } else {
      expect(result).toMatchObject({
        success: false,
        error: gateMessage,
        code: 'UB-VALIDATION-ERROR',
      });
      expect(seen).toEqual([]);
    }
  });

  it('a missing page is INVALID_REQUEST, and nothing is relayed', async () => {
    const relay = freshRelay();
    const seen = tab(relay, NAVIGATED);
    const result = await createRelayHandlers(relay).navigateByAdapter(
      {} as unknown as { page: string }
    );
    expect(result).toMatchObject({
      success: false,
      error: 'navigateByAdapter: "page" must be a non-empty string',
      code: 'UB-VALIDATION-ERROR',
    });
    expect(seen).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The page's case and the in-process handler
// ---------------------------------------------------------------------------

function stubAdapter() {
  const navigate = vi.fn(async (_target: string) => {});
  const adapter: NavigationAdapter = {
    getRoutes: () => [{ name: 'Settings', path: '/settings' }],
    navigate,
    getCurrentRoute: () => ({ name: 'Settings', path: '/settings' }),
  };
  return { adapter, navigate };
}

describe("the page's navigateByAdapter (exec mode) and the in-process handler", () => {
  beforeEach(() => {
    delete window.__uiBridgeInjected;
    delete window.__uiBridgeInjectedConfig;
  });

  afterEach(() => {
    delete window.__uiBridgeInjected;
    delete (window as unknown as { __UI_BRIDGE__?: unknown }).__UI_BRIDGE__;
    setGlobalRegistry(new UIBridgeRegistry());
  });

  it.each(TABLE)(
    'page: $url → $gate',
    async ({ url, gate, gateMessage, withAdapter }) => {
      const { adapter, navigate } = stubAdapter();
      (window as unknown as { __UI_BRIDGE__?: unknown }).__UI_BRIDGE__ = {
        navigationAdapter: adapter,
      };
      vi.resetModules();
      await import('../injected/bootstrap');
      const answer = await window.__uiBridgeInjected!.execute('navigateByAdapter', { page: url });
      if (withAdapter !== undefined) {
        expect(answer).toMatchObject({
          success: false,
          failureDetails: { errorCode: withAdapter },
        });
        expect(navigate).not.toHaveBeenCalled();
      } else if (gate === 'ok') {
        expect(answer).toEqual(NAVIGATED);
        expect(navigate).toHaveBeenCalledWith(url.trim()); // cleaned as gated, unprefixed
      } else {
        expect(answer).toMatchObject({
          success: false,
          error: gateMessage,
          failureDetails: { errorCode: gate, message: gateMessage },
        });
        expect(navigate).not.toHaveBeenCalled();
      }
    },
    30_000
  );

  it.each(TABLE)('in-process: $url → $gate', async ({ url, gate, gateMessage, withAdapter }) => {
    const { adapter, navigate } = stubAdapter();
    const registry = new UIBridgeRegistry();
    const handlers = createHandlers(
      registry as unknown as RegistryLike,
      new DefaultActionExecutor(registry) as never,
      { navigationAdapter: adapter }
    );
    const result = await handlers.navigateByAdapter({ page: url });
    if (withAdapter !== undefined) {
      expect(result).toMatchObject({
        success: false,
        code: 'UB-VALIDATION-ERROR',
        data: { failureDetails: { errorCode: withAdapter } },
      });
      expect(navigate).not.toHaveBeenCalled();
    } else if (gate === 'ok') {
      expect(result).toMatchObject({ success: true, data: NAVIGATED });
      expect(navigate).toHaveBeenCalledWith(url.trim()); // cleaned as gated, unprefixed
    } else {
      expect(result).toMatchObject({
        success: false,
        error: gateMessage,
        code: 'UB-VALIDATION-ERROR',
        data: { failureDetails: { errorCode: gate, message: gateMessage } },
      });
      expect(navigate).not.toHaveBeenCalled();
    }
  });
});

// ---------------------------------------------------------------------------
// pageNavigate on the page (exec mode) and in-process
// ---------------------------------------------------------------------------

/**
 * Swap `window.location` for a proxy that records `href` assignments (jsdom
 * cannot navigate) and, when `href` is given, reports that as the page URL.
 */
function stubLocation(href?: string) {
  const assigned: string[] = [];
  const real = window.location;
  const proxy = new Proxy(real, {
    get(target, prop) {
      if (prop === 'href' && href !== undefined) return href;
      const value = (target as unknown as Record<PropertyKey, unknown>)[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(target, prop, value) {
      if (prop === 'href') {
        assigned.push(value as string);
        return true;
      }
      (target as unknown as Record<PropertyKey, unknown>)[prop] = value;
      return true;
    },
  });
  const original = Object.getOwnPropertyDescriptor(window, 'location')!;
  Object.defineProperty(window, 'location', { configurable: true, value: proxy });
  return {
    assigned,
    restore: () => Object.defineProperty(window, 'location', original),
  };
}

describe('pageNavigate on the page (exec mode) and in-process: one gate', () => {
  let location: ReturnType<typeof stubLocation> | undefined;

  beforeEach(() => {
    delete window.__uiBridgeInjected;
    delete window.__uiBridgeInjectedConfig;
  });

  afterEach(() => {
    location?.restore();
    location = undefined;
    delete window.__uiBridgeInjected;
    delete (window as unknown as { __UI_BRIDGE__?: unknown }).__UI_BRIDGE__;
    setGlobalRegistry(new UIBridgeRegistry());
  });

  async function pageExecute(url: string) {
    vi.resetModules();
    await import('../injected/bootstrap');
    return window.__uiBridgeInjected!.execute('pageNavigate', { url });
  }

  function inProcess() {
    const registry = new UIBridgeRegistry();
    return createHandlers(
      registry as unknown as RegistryLike,
      new DefaultActionExecutor(registry) as never
    );
  }

  it.each(TABLE)(
    'page: $url → $gate',
    async ({ url, gate, gateMessage }) => {
      location = stubLocation();
      const answer = await pageExecute(url);
      if (gate === 'ok') {
        expect(answer).toMatchObject({ success: true, hard: true, mode: 'hard' });
        // A bare name as its root-relative path form, anything else cleaned.
        expect(location.assigned).toEqual([navigationPathForm(url)]);
      } else {
        expect(answer).toMatchObject({
          success: false,
          error: gateMessage,
          failureDetails: { errorCode: gate, message: gateMessage },
        });
        expect(location.assigned).toEqual([]);
      }
    },
    30_000
  );

  it.each(TABLE)('in-process: $url → $gate', async ({ url, gate, gateMessage }) => {
    location = stubLocation();
    const result = await inProcess().pageNavigate({ url });
    if (gate === 'ok') {
      expect(result).toMatchObject({ success: true, data: { success: true, url, mode: 'hard' } });
    } else {
      expect(result).toMatchObject({
        success: false,
        error: gateMessage,
        code: 'UB-VALIDATION-ERROR',
        data: { failureDetails: { errorCode: gate, message: gateMessage } },
      });
      expect(location.assigned).toEqual([]);
    }
  });

  it.each(NON_HTTP_BASES)(
    'page on %s: /settings navigates, javascript: is refused',
    async (base) => {
      location = stubLocation(base);
      expect(await pageExecute('/settings')).toMatchObject({ success: true, hard: true });
      expect(location.assigned).toEqual(['/settings']);
      expect(
        await window.__uiBridgeInjected!.execute('pageNavigate', { url: 'javascript:alert(1)' })
      ).toMatchObject({
        success: false,
        failureDetails: { errorCode: 'INVALID_URL_PROTOCOL', message: DANGEROUS('javascript:') },
      });
      expect(location.assigned).toEqual(['/settings']);
    },
    30_000
  );

  it.each(NON_HTTP_BASES)(
    'in-process on %s: /settings navigates, javascript: is refused',
    async (base) => {
      location = stubLocation(base);
      const handlers = inProcess();
      expect(await handlers.pageNavigate({ url: '/settings' })).toMatchObject({
        success: true,
        data: { url: '/settings', hard: true },
      });
      expect(location.assigned).toEqual(['/settings']);
      expect(await handlers.pageNavigate({ url: 'javascript:alert(1)' })).toMatchObject({
        success: false,
        code: 'UB-VALIDATION-ERROR',
        data: { failureDetails: { errorCode: 'INVALID_URL_PROTOCOL' } },
      });
      expect(location.assigned).toEqual(['/settings']);
    }
  );

  it('in-process: a missing url is still INVALID_REQUEST', async () => {
    const result = await inProcess().pageNavigate({ url: '' });
    expect(result).toMatchObject({ success: false, error: 'URL is required' });
  });
});

// ---------------------------------------------------------------------------
// navigateByAdapter: a bare route name is gated as its path form (plan D3)
// ---------------------------------------------------------------------------

describe('isBareRouteName', () => {
  it.each([
    ['settings', true],
    ['fleet/runs', true],
    [' settings', true],
    ['javascript%3Aalert(1)', true],
    ['/settings', false],
    ['//evil.test/x', false],
    ['/\\evil.test/x', false],
    ['\\evil.test', false],
    ['javascript:x', false],
    [' JavaScript:alert(1)', false],
    ['java\tscript:x', false],
    ['https://example.test/a', false],
    ['', false],
    // Relative references keep their relative meaning: never prefixed.
    ['?q=1', false],
    ['#section', false],
    ['./x', false],
    ['../x', false],
    [' ', false],
  ])('%j → %s', (page, expected) => {
    expect(isBareRouteName(page)).toBe(expected);
  });
});

describe('checkNavigationTarget on a non-http base', () => {
  it.each(NON_HTTP_BASES)('%s: a bare route name passes (as its path form)', (base) => {
    for (const page of ['settings', 'fleet/runs', ' settings']) {
      expect(checkNavigationTarget(page, base)).toEqual({ ok: true });
    }
  });

  it.each(NON_HTTP_BASES)(
    '%s: a real scheme is still refused, as checkNavigationUrl refuses it',
    (base) => {
      for (const page of ['javascript:x', ' JavaScript:alert(1)', 'java\tscript:x']) {
        expect(checkNavigationTarget(page, base)).toEqual(checkNavigationUrl(page, base));
        expect(checkNavigationTarget(page, base)).toMatchObject({
          ok: false,
          code: 'INVALID_URL_PROTOCOL',
        });
      }
    }
  );

  it('`//host` and `/\\host` stay protocol-relative', () => {
    for (const page of ['//evil.test/x', '/\\evil.test/x']) {
      expect(checkNavigationTarget(page, 'tauri://localhost/')).toEqual({
        ok: false,
        code: 'INVALID_URL_PROTOCOL',
        message: NOT_HTTP('tauri:'),
      });
    }
  });

  it('on the relay base every table row keeps its gate verdict', () => {
    for (const { url, gate } of TABLE) {
      const verdict = checkNavigationTarget(url, RELAY_NAVIGATION_BASE);
      expect(verdict.ok ? 'ok' : verdict.code).toBe(gate);
    }
  });
});

describe('navigateByAdapter with no adapter, on a non-http base', () => {
  let location: ReturnType<typeof stubLocation> | undefined;

  beforeEach(() => {
    delete window.__uiBridgeInjected;
    delete window.__uiBridgeInjectedConfig;
    delete (window as unknown as { __UI_BRIDGE__?: unknown }).__UI_BRIDGE__;
  });

  afterEach(() => {
    location?.restore();
    location = undefined;
    delete window.__uiBridgeInjected;
    delete (window as unknown as { __UI_BRIDGE__?: unknown }).__UI_BRIDGE__;
    setGlobalRegistry(new UIBridgeRegistry());
  });

  it.each(NON_HTTP_BASES)(
    'page on %s: "settings" navigates to /settings; javascript:x is refused',
    async (base) => {
      location = stubLocation(base);
      vi.resetModules();
      await import('../injected/bootstrap');
      const api = window.__uiBridgeInjected!;
      expect(await api.execute('navigateByAdapter', { page: 'settings' })).toMatchObject({
        navigated: true,
      });
      expect(location.assigned).toEqual(['/settings']);
      expect(await api.execute('navigateByAdapter', { page: 'javascript:x' })).toMatchObject({
        success: false,
        failureDetails: { errorCode: 'INVALID_URL_PROTOCOL' },
      });
      expect(location.assigned).toEqual(['/settings']);
    },
    30_000
  );

  it.each(NON_HTTP_BASES)(
    'in-process on %s: "settings" navigates to /settings; javascript:x is refused',
    async (base) => {
      location = stubLocation(base);
      const registry = new UIBridgeRegistry();
      const handlers = createHandlers(
        registry as unknown as RegistryLike,
        new DefaultActionExecutor(registry) as never
      );
      expect(await handlers.navigateByAdapter({ page: 'settings' })).toMatchObject({
        success: true,
        data: { navigated: true },
      });
      expect(location.assigned).toEqual(['/settings']);
      expect(await handlers.navigateByAdapter({ page: 'javascript:x' })).toMatchObject({
        success: false,
        code: 'UB-VALIDATION-ERROR',
        data: { failureDetails: { errorCode: 'INVALID_URL_PROTOCOL' } },
      });
      expect(location.assigned).toEqual(['/settings']);
    }
  );

  it.each(NON_HTTP_BASES)(
    'a route NAMED httpbin on %s navigates to /httpbin (page and in-process)',
    async (base) => {
      location = stubLocation(base);
      vi.resetModules();
      await import('../injected/bootstrap');
      expect(
        await window.__uiBridgeInjected!.execute('navigateByAdapter', { page: 'httpbin' })
      ).toMatchObject({ navigated: true });
      const registry = new UIBridgeRegistry();
      const handlers = createHandlers(
        registry as unknown as RegistryLike,
        new DefaultActionExecutor(registry) as never
      );
      expect(await handlers.navigateByAdapter({ page: 'httpbin' })).toMatchObject({
        success: true,
        data: { navigated: true },
      });
      expect(location.assigned).toEqual(['/httpbin', '/httpbin']);
    },
    30_000
  );

  it.each([...NON_HTTP_BASES, 'http://localhost:3000/some/page'])(
    'on %s the navigated string is the one the gate approved (page and in-process)',
    async (base) => {
      location = stubLocation(base);
      vi.resetModules();
      await import('../injected/bootstrap');
      const registry = new UIBridgeRegistry();
      const handlers = createHandlers(
        registry as unknown as RegistryLike,
        new DefaultActionExecutor(registry) as never
      );
      for (const page of ['\t/evil.test/x', ' /settings']) {
        expect(
          await window.__uiBridgeInjected!.execute('navigateByAdapter', { page })
        ).toMatchObject({ navigated: true });
        expect(await handlers.navigateByAdapter({ page })).toMatchObject({ success: true });
      }
      // A same-origin path each time — never `//evil.test/x`, never `/%20/settings`.
      expect(location.assigned).toEqual(['/evil.test/x', '/evil.test/x', '/settings', '/settings']);
    },
    30_000
  );

  it.each(NON_HTTP_BASES)(
    'with an adapter on %s: navigate gets "settings" unprefixed; javascript:x never reaches it',
    async (base) => {
      location = stubLocation(base);
      const { adapter, navigate } = stubAdapter();
      (window as unknown as { __UI_BRIDGE__?: unknown }).__UI_BRIDGE__ = {
        navigationAdapter: adapter,
      };
      vi.resetModules();
      await import('../injected/bootstrap');
      const api = window.__uiBridgeInjected!;
      expect(await api.execute('navigateByAdapter', { page: 'settings' })).toEqual(NAVIGATED);
      expect(await api.execute('navigateByAdapter', { page: 'javascript:x' })).toMatchObject({
        success: false,
        failureDetails: { errorCode: 'INVALID_URL_PROTOCOL' },
      });
      const registry = new UIBridgeRegistry();
      const handlers = createHandlers(
        registry as unknown as RegistryLike,
        new DefaultActionExecutor(registry) as never,
        { navigationAdapter: adapter }
      );
      expect(await handlers.navigateByAdapter({ page: 'settings' })).toMatchObject({
        success: true,
        data: NAVIGATED,
      });
      expect(await handlers.navigateByAdapter({ page: 'javascript:x' })).toMatchObject({
        success: false,
        code: 'UB-VALIDATION-ERROR',
      });
      expect(navigate.mock.calls).toEqual([['settings'], ['settings']]);
      expect(location.assigned).toEqual([]);
    },
    30_000
  );

  it('the relay pre-check relays a bare name, and refuses a real scheme before any tab sees it', async () => {
    const relay = freshRelay();
    const seen = tab(relay, NAVIGATED);
    const handlers = createRelayHandlers(relay);
    expect(await handlers.navigateByAdapter({ page: 'settings' })).toMatchObject({ success: true });
    expect(await handlers.navigateByAdapter({ page: 'javascript:x' })).toMatchObject({
      success: false,
      code: 'UB-VALIDATION-ERROR',
    });
    expect(seen).toEqual([{ action: 'navigateByAdapter', payload: { page: 'settings' } }]);
    relay.destroy();
  });
});

// ---------------------------------------------------------------------------
// Review round 7: a page that names nothing; a derived path that changes origin
// ---------------------------------------------------------------------------

const TAB = String.fromCharCode(9);
const PAGE_REFUSAL = 'navigateByAdapter: "page" must be a non-empty string';

describe('navigateByAdapter: a whitespace-only page is the payload error, on every site', () => {
  const pages = [' ', '   ', TAB, ` ${TAB} `];

  afterEach(() => {
    delete window.__uiBridgeInjected;
    delete (window as unknown as { __UI_BRIDGE__?: unknown }).__UI_BRIDGE__;
    setGlobalRegistry(new UIBridgeRegistry());
    for (const relay of relays.splice(0)) relay.destroy();
  });

  it.each(pages)(
    'page (exec mode): %j',
    async (page) => {
      vi.resetModules();
      await import('../injected/bootstrap');
      expect(await window.__uiBridgeInjected!.execute('navigateByAdapter', { page })).toMatchObject(
        {
          success: false,
          error: PAGE_REFUSAL,
          failureDetails: { errorCode: 'INVALID_REQUEST', message: PAGE_REFUSAL },
        }
      );
    },
    30_000
  );

  it.each(pages)('in-process: %j', async (page) => {
    const registry = new UIBridgeRegistry();
    const handlers = createHandlers(
      registry as unknown as RegistryLike,
      new DefaultActionExecutor(registry) as never
    );
    expect(await handlers.navigateByAdapter({ page })).toMatchObject({
      success: false,
      error: PAGE_REFUSAL,
      code: 'UB-VALIDATION-ERROR',
    });
  });

  it.each(pages)('relay pre-check: %j, and nothing is relayed', async (page) => {
    const relay = freshRelay();
    const seen = tab(relay, NAVIGATED);
    expect(await createRelayHandlers(relay).navigateByAdapter({ page })).toMatchObject({
      success: false,
      error: PAGE_REFUSAL,
      code: 'UB-VALIDATION-ERROR',
    });
    expect(seen).toEqual([]);
  });
});

describe('sameOriginPathOf', () => {
  const base = 'http://localhost:3000/app/page';
  it.each([
    ['/settings?x=1#h', '/settings?x=1#h'],
    ['?q=1', '/app/page?q=1'],
    ['#h', '/app/page#h'],
    ['../x', '/x'],
    ['/a/../b', '/b'],
  ])('%j → %j', (url, expected) => {
    expect(sameOriginPathOf(url, base)).toBe(expected);
  });

  it('a different origin is undefined (handed on unchanged, as before)', () => {
    expect(sameOriginPathOf('https://example.test/a', base)).toBeUndefined();
  });

  it.each(['/x/..//evil.test/p', '/x/../' + String.fromCharCode(92) + 'evil.test/p'])(
    'a same-origin URL whose path collapses to a protocol-relative form is null: %j',
    (url) => {
      expect(sameOriginPathOf(url, base)).toBeNull();
    }
  );
});

describe('pageNavigate never hands on a derived path that changes origin', () => {
  const EVIL = '/x/..//evil.test/p';
  let location: ReturnType<typeof stubLocation> | undefined;

  afterEach(() => {
    location?.restore();
    location = undefined;
    delete window.__uiBridgeInjected;
    delete (window as unknown as { __UI_BRIDGE__?: unknown }).__UI_BRIDGE__;
    setGlobalRegistry(new UIBridgeRegistry());
  });

  async function boot(navigateHandler?: (path: string) => void) {
    if (navigateHandler) {
      (window as unknown as { __UI_BRIDGE__?: unknown }).__UI_BRIDGE__ = { navigateHandler };
    }
    vi.resetModules();
    await import('../injected/bootstrap');
    return window.__uiBridgeInjected!;
  }

  it('page, through a registered navigateHandler: refused, the handler never called', async () => {
    location = stubLocation();
    const handler = vi.fn();
    const api = await boot(handler);
    expect(await api.execute('pageNavigate', { url: EVIL })).toMatchObject({
      success: false,
      failureDetails: { errorCode: 'INVALID_URL_FORMAT' },
    });
    expect(handler).not.toHaveBeenCalled();
    expect(location.assigned).toEqual([]);
    // A plain same-origin path still reaches the handler exactly as approved.
    expect(await api.execute('pageNavigate', { url: '/a/../settings?x=1' })).toMatchObject({
      success: true,
      clientSideNavigation: true,
    });
    expect(handler.mock.calls).toEqual([['/settings?x=1']]);
  }, 30_000);

  it('page, soft mode: refused, nothing pushed', async () => {
    const handler = vi.fn();
    const api = await boot(handler);
    const pushState = vi.spyOn(window.history, 'pushState');
    try {
      expect(await api.execute('pageNavigate', { url: EVIL, mode: 'soft' })).toMatchObject({
        success: false,
        failureDetails: { errorCode: 'INVALID_URL_FORMAT' },
      });
      expect(handler).not.toHaveBeenCalled();
      expect(pushState).not.toHaveBeenCalled();
    } finally {
      pushState.mockRestore();
    }
  }, 30_000);

  it('in-process, soft mode: refused, nothing pushed', async () => {
    const registry = new UIBridgeRegistry();
    const handlers = createHandlers(
      registry as unknown as RegistryLike,
      new DefaultActionExecutor(registry) as never
    );
    const pushState = vi.spyOn(window.history, 'pushState');
    try {
      expect(await handlers.pageNavigate({ url: EVIL, mode: 'soft' })).toMatchObject({
        success: false,
        code: 'UB-VALIDATION-ERROR',
        data: { failureDetails: { errorCode: 'INVALID_URL_FORMAT' } },
      });
      expect(pushState).not.toHaveBeenCalled();
    } finally {
      pushState.mockRestore();
    }
  });

  it('a hard navigation with no handler is not refused: location resolves the URL itself', async () => {
    location = stubLocation();
    const api = await boot();
    expect(await api.execute('pageNavigate', { url: EVIL })).toMatchObject({ success: true });
    expect(location.assigned).toEqual([EVIL]);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Review round 8
// ---------------------------------------------------------------------------

describe('WindowLocationAdapter.navigate runs the gate', () => {
  let location: ReturnType<typeof stubLocation> | undefined;
  afterEach(() => {
    location?.restore();
    location = undefined;
  });

  it.each(['javascript:x', ' JavaScript:alert(1)', 'data:text/html,x', 'mailto:a@b.test'])(
    '%j throws and assigns nothing',
    async (target) => {
      location = stubLocation('http://localhost:3000/');
      await expect(new WindowLocationAdapter().navigate(target)).rejects.toThrow(/protocol/i);
      expect(location.assigned).toEqual([]);
    }
  );

  it.each(NON_HTTP_BASES)('on %s a bare name and a path still navigate', async (base) => {
    location = stubLocation(base);
    await new WindowLocationAdapter().navigate('settings');
    await new WindowLocationAdapter().navigate(' /fleet');
    expect(location.assigned).toEqual(['/settings', '/fleet']);
  });
});

describe('the adapter gets the target as gated: cleaned, unprefixed', () => {
  afterEach(() => {
    delete window.__uiBridgeInjected;
    delete (window as unknown as { __UI_BRIDGE__?: unknown }).__UI_BRIDGE__;
    setGlobalRegistry(new UIBridgeRegistry());
  });

  it('page and in-process', async () => {
    const page = ' settings' + TAB;
    const { adapter, navigate } = stubAdapter();
    (window as unknown as { __UI_BRIDGE__?: unknown }).__UI_BRIDGE__ = {
      navigationAdapter: adapter,
    };
    vi.resetModules();
    await import('../injected/bootstrap');
    await window.__uiBridgeInjected!.execute('navigateByAdapter', { page });
    const registry = new UIBridgeRegistry();
    await createHandlers(
      registry as unknown as RegistryLike,
      new DefaultActionExecutor(registry) as never,
      { navigationAdapter: adapter }
    ).navigateByAdapter({ page });
    expect(navigate.mock.calls).toEqual([['settings'], ['settings']]);
  }, 30_000);
});

describe('softNavigationPath', () => {
  const base = 'http://localhost:3000/app/page';
  it('a same-origin URL hands on its path', () => {
    expect(softNavigationPath('/a/../settings?x=1', base)).toEqual({
      ok: true,
      path: '/settings?x=1',
    });
  });
  it('another origin is refused', () => {
    expect(softNavigationPath('https://example.test/a', base)).toMatchObject({
      ok: false,
      code: 'INVALID_URL_FORMAT',
    });
  });
  it('an origin-changing derived path is refused', () => {
    expect(softNavigationPath('/x/..//evil.test/p', base)).toMatchObject({ ok: false });
  });
  it('a URL that cannot be resolved against the base is handed on as given', () => {
    expect(softNavigationPath('/x', 'about:blank')).toEqual({ ok: true, path: '/x' });
  });
});

describe('soft pageNavigate refuses another origin (page and in-process)', () => {
  const CROSS = 'https://example.test/a';
  afterEach(() => {
    delete window.__uiBridgeInjected;
    delete (window as unknown as { __UI_BRIDGE__?: unknown }).__UI_BRIDGE__;
    setGlobalRegistry(new UIBridgeRegistry());
  });

  it('page: neither the handler nor pushState sees it', async () => {
    const handler = vi.fn();
    (window as unknown as { __UI_BRIDGE__?: unknown }).__UI_BRIDGE__ = { navigateHandler: handler };
    vi.resetModules();
    await import('../injected/bootstrap');
    const pushState = vi.spyOn(window.history, 'pushState');
    try {
      expect(
        await window.__uiBridgeInjected!.execute('pageNavigate', { url: CROSS, mode: 'soft' })
      ).toMatchObject({ success: false, failureDetails: { errorCode: 'INVALID_URL_FORMAT' } });
      expect(handler).not.toHaveBeenCalled();
      expect(pushState).not.toHaveBeenCalled();
    } finally {
      pushState.mockRestore();
    }
  }, 30_000);

  it('in-process: nothing pushed', async () => {
    const registry = new UIBridgeRegistry();
    const handlers = createHandlers(
      registry as unknown as RegistryLike,
      new DefaultActionExecutor(registry) as never
    );
    const pushState = vi.spyOn(window.history, 'pushState');
    try {
      expect(await handlers.pageNavigate({ url: CROSS, mode: 'soft' })).toMatchObject({
        success: false,
        code: 'UB-VALIDATION-ERROR',
        data: { failureDetails: { errorCode: 'INVALID_URL_FORMAT' } },
      });
      expect(pushState).not.toHaveBeenCalled();
    } finally {
      pushState.mockRestore();
    }
  });
});

describe('pageNavigate: a whitespace-only url is INVALID_REQUEST (page and in-process)', () => {
  const urls = [' ', TAB, ` ${TAB} `];
  let location: ReturnType<typeof stubLocation> | undefined;
  afterEach(() => {
    location?.restore();
    location = undefined;
    delete window.__uiBridgeInjected;
    setGlobalRegistry(new UIBridgeRegistry());
  });

  it.each(urls)(
    'page: %j',
    async (url) => {
      location = stubLocation();
      vi.resetModules();
      await import('../injected/bootstrap');
      expect(await window.__uiBridgeInjected!.execute('pageNavigate', { url })).toMatchObject({
        success: false,
        failureDetails: { errorCode: 'INVALID_REQUEST' },
      });
      expect(location.assigned).toEqual([]);
    },
    30_000
  );

  it.each(urls)('in-process: %j', async (url) => {
    location = stubLocation();
    const registry = new UIBridgeRegistry();
    const result = await createHandlers(
      registry as unknown as RegistryLike,
      new DefaultActionExecutor(registry) as never
    ).pageNavigate({ url });
    expect(result).toMatchObject({ success: false, error: 'URL is required' });
    expect(location.assigned).toEqual([]);
  });
});

describe('in-process hard pageNavigate decides on the normalized form', () => {
  let location: ReturnType<typeof stubLocation> | undefined;
  afterEach(() => {
    location?.restore();
    location = undefined;
  });

  it.each([
    [' /settings', ['/settings']],
    [TAB + '/fleet', ['/fleet']],
    [' https://example.test/a', ['https://example.test/a']],
    // A bare name is a tab ID (the ui-bridge-navigate event), never a relative URL.
    ['httpbin', []],
    ['activity-timeline', []],
  ])('%j assigns %j', async (url, assigned) => {
    location = stubLocation();
    const registry = new UIBridgeRegistry();
    const result = await createHandlers(
      registry as unknown as RegistryLike,
      new DefaultActionExecutor(registry) as never
    ).pageNavigate({ url });
    expect(result).toMatchObject({ success: true });
    expect(location.assigned).toEqual(assigned);
  });
});

// ---------------------------------------------------------------------------
// Review round 9
// ---------------------------------------------------------------------------

const ADAPTER_REFUSED = [
  '//evil.test/x',
  '/\\evil.test',
  'https://evil.test/a',
  '/x/..//evil.test/p',
  // A bare name and a relative reference whose page-relative reading collapses.
  'x/../..//evil.test/p',
  '..//evil.test/p',
  // Fine page-relative on /app/page (/app//evil.test/p), but its root-relative
  // form /x/..//evil.test/p collapses to //evil.test/p.
  'x/..//evil.test/p',
];

describe('an adapter is a soft navigator: only a same-origin path (or a bare name) reaches it', () => {
  let location: ReturnType<typeof stubLocation> | undefined;
  afterEach(() => {
    location?.restore();
    location = undefined;
    delete window.__uiBridgeInjected;
    delete (window as unknown as { __UI_BRIDGE__?: unknown }).__UI_BRIDGE__;
    setGlobalRegistry(new UIBridgeRegistry());
  });

  /** The two adapter kinds: a router stub, and the window-location adapter registered as one. */
  function adapters() {
    const stub = stubAdapter();
    const windowAdapter = new WindowLocationAdapter();
    const windowNavigate = vi.spyOn(windowAdapter, 'navigate');
    return [
      { kind: 'router stub', adapter: stub.adapter, navigate: stub.navigate },
      {
        kind: 'WindowLocationAdapter',
        adapter: windowAdapter as NavigationAdapter,
        navigate: windowNavigate,
      },
    ];
  }

  it.each(ADAPTER_REFUSED)(
    '%j is refused with INVALID_URL_FORMAT, page and in-process, both adapter kinds',
    async (page) => {
      location = stubLocation('http://localhost:3000/app/page');
      for (const { adapter, navigate } of adapters()) {
        (window as unknown as { __UI_BRIDGE__?: unknown }).__UI_BRIDGE__ = {
          navigationAdapter: adapter,
        };
        vi.resetModules();
        await import('../injected/bootstrap');
        expect(
          await window.__uiBridgeInjected!.execute('navigateByAdapter', { page })
        ).toMatchObject({
          success: false,
          failureDetails: { errorCode: 'INVALID_URL_FORMAT' },
        });
        const registry = new UIBridgeRegistry();
        expect(
          await createHandlers(
            registry as unknown as RegistryLike,
            new DefaultActionExecutor(registry) as never,
            { navigationAdapter: adapter }
          ).navigateByAdapter({ page })
        ).toMatchObject({
          success: false,
          code: 'UB-VALIDATION-ERROR',
          data: { failureDetails: { errorCode: 'INVALID_URL_FORMAT' } },
        });
        expect(navigate).not.toHaveBeenCalled();
        delete window.__uiBridgeInjected;
      }
      expect(location.assigned).toEqual([]);
    },
    30_000
  );

  it('a bare name still reaches each adapter unprefixed; a same-origin path as its path', async () => {
    location = stubLocation('http://localhost:3000/app/page');
    for (const { adapter, navigate } of adapters()) {
      (window as unknown as { __UI_BRIDGE__?: unknown }).__UI_BRIDGE__ = {
        navigationAdapter: adapter,
      };
      vi.resetModules();
      await import('../injected/bootstrap');
      await window.__uiBridgeInjected!.execute('navigateByAdapter', { page: 'settings' });
      await window.__uiBridgeInjected!.execute('navigateByAdapter', { page: '/a/../fleet' });
      expect(navigate.mock.calls).toEqual([['settings'], ['/fleet']]);
      delete window.__uiBridgeInjected;
    }
  }, 30_000);
});

describe('soft navigation resolves against the origin root', () => {
  const original = window.location.pathname;
  afterEach(() => {
    window.history.pushState(null, '', original);
    delete window.__uiBridgeInjected;
    delete (window as unknown as { __UI_BRIDGE__?: unknown }).__UI_BRIDGE__;
    setGlobalRegistry(new UIBridgeRegistry());
  });

  it('originRoot', () => {
    expect(originRoot('http://localhost:3000/app/page?x=1')).toBe('http://localhost:3000/');
    expect(originRoot('tauri://localhost/app/page')).toBe('tauri://localhost/');
    expect(originRoot('file:///x/y')).toBe('file:///');
    expect(originRoot('about:blank')).toBeUndefined();
  });

  it('page, soft mode on /app/page: "settings" is handed to the router as /settings', async () => {
    window.history.pushState(null, '', '/app/page');
    const handler = vi.fn();
    (window as unknown as { __UI_BRIDGE__?: unknown }).__UI_BRIDGE__ = { navigateHandler: handler };
    vi.resetModules();
    await import('../injected/bootstrap');
    expect(
      await window.__uiBridgeInjected!.execute('pageNavigate', { url: 'settings', mode: 'soft' })
    ).toMatchObject({ success: true, url: '/settings' });
    expect(handler.mock.calls).toEqual([['/settings']]);
  }, 30_000);

  it('page, handler (non-hard) mode on /app/page: "settings" → /settings', async () => {
    window.history.pushState(null, '', '/app/page');
    const handler = vi.fn();
    (window as unknown as { __UI_BRIDGE__?: unknown }).__UI_BRIDGE__ = { navigateHandler: handler };
    vi.resetModules();
    await import('../injected/bootstrap');
    await window.__uiBridgeInjected!.execute('pageNavigate', { url: 'settings' });
    expect(handler.mock.calls).toEqual([['/settings']]);
  }, 30_000);

  it('in-process, soft mode on /app/page: "settings" is pushed as /settings', async () => {
    window.history.pushState(null, '', '/app/page');
    const registry = new UIBridgeRegistry();
    const handlers = createHandlers(
      registry as unknown as RegistryLike,
      new DefaultActionExecutor(registry) as never
    );
    const pushState = vi.spyOn(window.history, 'pushState');
    try {
      expect(await handlers.pageNavigate({ url: 'settings', mode: 'soft' })).toMatchObject({
        success: true,
        data: { url: '/settings' },
      });
      expect(pushState.mock.calls).toEqual([[null, '', '/settings']]);
    } finally {
      pushState.mockRestore();
    }
  });
});

describe('in-process hard pageNavigate: a tab ID is decided before the URL gate', () => {
  let location: ReturnType<typeof stubLocation> | undefined;
  afterEach(() => {
    location?.restore();
    location = undefined;
  });

  it.each(['tauri://localhost/', 'file:///x'])(
    'on %s, "activity-timeline" fires the tab-ID event, assigns nothing, is not refused',
    async (base) => {
      location = stubLocation(base);
      const events: unknown[] = [];
      const listener = (e: Event) => events.push((e as CustomEvent).detail);
      window.addEventListener('ui-bridge-navigate', listener);
      try {
        const registry = new UIBridgeRegistry();
        const result = await createHandlers(
          registry as unknown as RegistryLike,
          new DefaultActionExecutor(registry) as never
        ).pageNavigate({ url: 'activity-timeline' });
        expect(result).toMatchObject({
          success: true,
          data: { url: 'activity-timeline', hard: true },
        });
        expect(events).toEqual([{ page: 'activity-timeline', url: 'activity-timeline' }]);
        expect(location.assigned).toEqual([]);
      } finally {
        window.removeEventListener('ui-bridge-navigate', listener);
      }
    }
  );
});

describe('softNavigationPath on a page that cannot be a base (about:blank)', () => {
  it.each([
    ['/x/..//evil.test/p', false],
    ['//evil.test/x', false],
    ['settings', false],
    ['https://evil.test/a', false],
    [' /settings', '/settings'],
    ['/a/b?c#d', '/a/b?c#d'],
  ])('%j → %j', (url, expected) => {
    const verdict = softNavigationPath(url, 'about:blank');
    if (expected === false) {
      expect(verdict).toMatchObject({ ok: false, code: 'INVALID_URL_FORMAT' });
    } else {
      expect(verdict).toEqual({ ok: true, path: expected });
    }
  });
});

describe('an opaque origin is never "the same origin" by its serialization', () => {
  it('sameOriginPathOf("//evil.test/x", "tauri://localhost/") is not same-origin', () => {
    expect(sameOriginPathOf('//evil.test/x', 'tauri://localhost/')).toBeUndefined();
    expect(sameOriginPathOf('/x', 'tauri://localhost/')).toBe('/x');
  });

  it('softNavigationPath on tauri://localhost/app/page', () => {
    const base = 'tauri://localhost/app/page';
    expect(softNavigationPath('//evil.test/x', base)).toMatchObject({ ok: false });
    expect(softNavigationPath('settings', base)).toEqual({ ok: true, path: '/settings' });
  });
});

// ---------------------------------------------------------------------------
// Review round 10: an adapter keeps page-relative meaning
// ---------------------------------------------------------------------------

describe('adapterNavigationTarget', () => {
  const base = 'http://localhost:3000/app/page';
  it.each([
    ['settings', 'settings'],
    [' settings ', 'settings'],
    ['?q=1', '?q=1'],
    ['#section', '#section'],
    ['./x', './x'],
    ['../x', '../x'],
    ['/a/../fleet', '/fleet'],
  ])('%j reaches the adapter as %j', (page, expected) => {
    expect(adapterNavigationTarget(page, base)).toEqual({ ok: true, path: expected });
  });

  it.each(ADAPTER_REFUSED)('%j is refused', (page) => {
    expect(adapterNavigationTarget(page, base)).toMatchObject({
      ok: false,
      code: 'INVALID_URL_FORMAT',
    });
  });

  it('on about:blank a bare name still passes, a collapsing one does not', () => {
    expect(adapterNavigationTarget('settings', 'about:blank')).toEqual({
      ok: true,
      path: 'settings',
    });
    expect(adapterNavigationTarget('x/../..//evil.test/p', 'about:blank')).toMatchObject({
      ok: false,
    });
  });
});

describe('a router adapter gets relative references unchanged (page and in-process)', () => {
  let location: ReturnType<typeof stubLocation> | undefined;
  afterEach(() => {
    location?.restore();
    location = undefined;
    delete window.__uiBridgeInjected;
    delete (window as unknown as { __UI_BRIDGE__?: unknown }).__UI_BRIDGE__;
    setGlobalRegistry(new UIBridgeRegistry());
  });

  it('on /app/page: ?q=1, #section, ./x', async () => {
    location = stubLocation('http://localhost:3000/app/page');
    const { adapter, navigate } = stubAdapter();
    (window as unknown as { __UI_BRIDGE__?: unknown }).__UI_BRIDGE__ = {
      navigationAdapter: adapter,
    };
    vi.resetModules();
    await import('../injected/bootstrap');
    const registry = new UIBridgeRegistry();
    const handlers = createHandlers(
      registry as unknown as RegistryLike,
      new DefaultActionExecutor(registry) as never,
      { navigationAdapter: adapter }
    );
    for (const page of ['?q=1', '#section', ' ./x']) {
      expect(await window.__uiBridgeInjected!.execute('navigateByAdapter', { page })).toEqual(
        NAVIGATED
      );
      expect(await handlers.navigateByAdapter({ page })).toMatchObject({ success: true });
    }
    expect(navigate.mock.calls).toEqual([
      ['?q=1'],
      ['?q=1'],
      ['#section'],
      ['#section'],
      ['./x'],
      ['./x'],
    ]);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Review round 11: an empty path segment is refused at any depth
// ---------------------------------------------------------------------------

const DEEP_REFUSED: Array<[string, string]> = [
  ['http://localhost:3000/app/page', './/evil.test/p'],
  ['http://localhost:3000/a/b/c', '..//evil.test/p'],
  ['http://localhost:3000/a/b/c', './..//evil.test/p'],
  ['http://localhost:3000/a/b/c', '././/evil.test'],
  ['http://localhost:3000/a/b/c', 'x/\\evil.test'],
  ['http://localhost:3000/a/b/c', './\\/evil.test'],
];

describe('an adapter target with an empty path segment is refused at any depth', () => {
  let location: ReturnType<typeof stubLocation> | undefined;
  afterEach(() => {
    location?.restore();
    location = undefined;
    delete window.__uiBridgeInjected;
    delete (window as unknown as { __UI_BRIDGE__?: unknown }).__UI_BRIDGE__;
    setGlobalRegistry(new UIBridgeRegistry());
  });

  function bothAdapterKinds() {
    const stub = stubAdapter();
    const windowAdapter = new WindowLocationAdapter();
    return [
      { adapter: stub.adapter, navigate: stub.navigate },
      {
        adapter: windowAdapter as NavigationAdapter,
        navigate: vi.spyOn(windowAdapter, 'navigate'),
      },
    ];
  }

  it.each(DEEP_REFUSED)(
    'on %s, %j: refused, page and in-process, router stub and WindowLocationAdapter',
    async (base, page) => {
      expect(adapterNavigationTarget(page, base)).toMatchObject({
        ok: false,
        code: 'INVALID_URL_FORMAT',
      });
      location = stubLocation(base);
      for (const { adapter, navigate } of bothAdapterKinds()) {
        (window as unknown as { __UI_BRIDGE__?: unknown }).__UI_BRIDGE__ = {
          navigationAdapter: adapter,
        };
        vi.resetModules();
        await import('../injected/bootstrap');
        expect(
          await window.__uiBridgeInjected!.execute('navigateByAdapter', { page })
        ).toMatchObject({
          success: false,
          failureDetails: { errorCode: 'INVALID_URL_FORMAT' },
        });
        const registry = new UIBridgeRegistry();
        expect(
          await createHandlers(
            registry as unknown as RegistryLike,
            new DefaultActionExecutor(registry) as never,
            { navigationAdapter: adapter }
          ).navigateByAdapter({ page })
        ).toMatchObject({
          success: false,
          data: { failureDetails: { errorCode: 'INVALID_URL_FORMAT' } },
        });
        expect(navigate).not.toHaveBeenCalled();
        delete window.__uiBridgeInjected;
      }
      expect(location.assigned).toEqual([]);
    },
    30_000
  );

  it('on /a/b/c, ../x, ./x and ?q=1 still reach the router unchanged (page and in-process)', async () => {
    location = stubLocation('http://localhost:3000/a/b/c');
    const { adapter, navigate } = stubAdapter();
    (window as unknown as { __UI_BRIDGE__?: unknown }).__UI_BRIDGE__ = {
      navigationAdapter: adapter,
    };
    vi.resetModules();
    await import('../injected/bootstrap');
    const registry = new UIBridgeRegistry();
    const handlers = createHandlers(
      registry as unknown as RegistryLike,
      new DefaultActionExecutor(registry) as never,
      { navigationAdapter: adapter }
    );
    for (const page of ['../x', './x', '?q=1']) {
      expect(await window.__uiBridgeInjected!.execute('navigateByAdapter', { page })).toEqual(
        NAVIGATED
      );
      expect(await handlers.navigateByAdapter({ page })).toMatchObject({ success: true });
    }
    expect(navigate.mock.calls).toEqual([['../x'], ['../x'], ['./x'], ['./x'], ['?q=1'], ['?q=1']]);
  }, 30_000);

  it('only the path part counts: a query or fragment may hold //', () => {
    const base = 'http://localhost:3000/a/b/c';
    expect(adapterNavigationTarget('?next=//x', base)).toEqual({ ok: true, path: '?next=//x' });
    expect(adapterNavigationTarget('settings#//x', base)).toEqual({
      ok: true,
      path: 'settings#//x',
    });
  });
});

// ---------------------------------------------------------------------------
// Review round 12: in-process hard navigation assigns relative references
// ---------------------------------------------------------------------------

describe('in-process, no adapter, on /app/page: a relative reference navigates', () => {
  const BASE = 'http://localhost:3000/app/page';
  let location: ReturnType<typeof stubLocation> | undefined;
  afterEach(() => {
    location?.restore();
    location = undefined;
  });

  function inProcessHandlers() {
    const registry = new UIBridgeRegistry();
    return createHandlers(
      registry as unknown as RegistryLike,
      new DefaultActionExecutor(registry) as never
    );
  }

  /** Where the browser would go: the assigned string resolved against the page. */
  function landed(assigned: string): string {
    const u = new URL(assigned, BASE);
    return u.pathname + u.search + u.hash;
  }

  const CASES: Array<[string, string, string]> = [
    ['?q=1', '?q=1', '/app/page?q=1'],
    ['#h', '#h', '/app/page#h'],
    ['./x', './x', '/app/x'],
    ['../x', '../x', '/x'],
    [' ../x ', '../x', '/x'],
  ];

  it.each(CASES)('navigateByAdapter %j assigns %j (→ %s)', async (page, assigned, lands) => {
    location = stubLocation(BASE);
    expect(await inProcessHandlers().navigateByAdapter({ page })).toMatchObject({
      success: true,
      data: { navigated: true },
    });
    expect(location.assigned).toEqual([assigned]);
    expect(landed(location.assigned[0])).toBe(lands);
  });

  it.each(CASES)('pageNavigate %j assigns %j (→ %s)', async (url, assigned, lands) => {
    location = stubLocation(BASE);
    expect(await inProcessHandlers().pageNavigate({ url })).toMatchObject({
      success: true,
      data: { hard: true },
    });
    expect(location.assigned).toEqual([assigned]);
    expect(landed(location.assigned[0])).toBe(lands);
  });

  it('a bare name stays a tab ID: nothing assigned', async () => {
    location = stubLocation(BASE);
    await inProcessHandlers().pageNavigate({ url: 'activity-timeline' });
    expect(location.assigned).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Review round 13: a router handler resolves non-bare targets page-relative
// ---------------------------------------------------------------------------

describe('with a navigateHandler on /app/page, non-bare targets resolve against the page', () => {
  const original = window.location.pathname;
  const EXPECTED: Array<[string, string]> = [
    ['./x', '/app/x'],
    ['?q=1', '/app/page?q=1'],
    ['#h', '/app/page#h'],
    ['../x', '/x'],
    ['settings', '/settings'],
  ];

  afterEach(() => {
    window.history.pushState(null, '', original);
    delete window.__uiBridgeInjected;
    delete (window as unknown as { __UI_BRIDGE__?: unknown }).__UI_BRIDGE__;
    setGlobalRegistry(new UIBridgeRegistry());
  });

  async function bootWithHandler() {
    window.history.pushState(null, '', '/app/page');
    const handler = vi.fn();
    (window as unknown as { __UI_BRIDGE__?: unknown }).__UI_BRIDGE__ = { navigateHandler: handler };
    vi.resetModules();
    await import('../injected/bootstrap');
    return { api: window.__uiBridgeInjected!, handler };
  }

  it('via navigateByAdapter (no adapter → the handler branch)', async () => {
    const { api, handler } = await bootWithHandler();
    for (const [page] of EXPECTED) {
      expect(await api.execute('navigateByAdapter', { page })).toMatchObject({ navigated: true });
    }
    expect(handler.mock.calls).toEqual(EXPECTED.map(([, path]) => [path]));
  }, 30_000);

  it('via pageNavigate soft', async () => {
    const { api, handler } = await bootWithHandler();
    for (const [url] of EXPECTED) {
      expect(await api.execute('pageNavigate', { url, mode: 'soft' })).toMatchObject({
        success: true,
      });
    }
    expect(handler.mock.calls).toEqual(EXPECTED.map(([, path]) => [path]));
  }, 30_000);

  it('in-process pageNavigate soft pushes the same paths', async () => {
    window.history.pushState(null, '', '/app/page');
    const registry = new UIBridgeRegistry();
    const handlers = createHandlers(
      registry as unknown as RegistryLike,
      new DefaultActionExecutor(registry) as never
    );
    const pushState = vi.spyOn(window.history, 'pushState').mockImplementation(() => {});
    try {
      for (const [url] of EXPECTED) {
        expect(await handlers.pageNavigate({ url, mode: 'soft' })).toMatchObject({ success: true });
      }
      expect(pushState.mock.calls.map((c) => c[2])).toEqual(EXPECTED.map(([, path]) => path));
    } finally {
      pushState.mockRestore();
    }
  });

  it('softResolutionBase', () => {
    const page = 'http://localhost:3000/app/page';
    expect(softResolutionBase('settings', page)).toBe('http://localhost:3000/');
    expect(softResolutionBase('./x', page)).toBe(page);
    expect(softResolutionBase('?q=1', page)).toBe(page);
    expect(softResolutionBase('/a', page)).toBe(page);
    expect(softResolutionBase('settings', 'about:blank')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Review round 14: page hard navigation with no handler resolves like the rest
// ---------------------------------------------------------------------------

describe('page pageNavigate, hard, no navigateHandler, on /app/page', () => {
  let location: ReturnType<typeof stubLocation> | undefined;
  afterEach(() => {
    location?.restore();
    location = undefined;
    delete window.__uiBridgeInjected;
    delete (window as unknown as { __UI_BRIDGE__?: unknown }).__UI_BRIDGE__;
    setGlobalRegistry(new UIBridgeRegistry());
  });

  it.each([
    ['settings', '/settings'],
    [' settings ', '/settings'],
    ['./x', './x'],
    ['?q=1', '?q=1'],
    ['#h', '#h'],
    [' /fleet', '/fleet'],
  ])(
    '%j assigns %j',
    async (url, assigned) => {
      location = stubLocation('http://localhost:3000/app/page');
      vi.resetModules();
      await import('../injected/bootstrap');
      expect(await window.__uiBridgeInjected!.execute('pageNavigate', { url })).toMatchObject({
        success: true,
        hard: true,
      });
      expect(location.assigned).toEqual([assigned]);
    },
    30_000
  );

  it('where they land against /app/page', () => {
    const land = (a: string) => {
      const u = new URL(a, 'http://localhost:3000/app/page');
      return u.pathname + u.search;
    };
    expect(land('/settings')).toBe('/settings');
    expect(land('./x')).toBe('/app/x');
    expect(land('?q=1')).toBe('/app/page?q=1');
  });
});
