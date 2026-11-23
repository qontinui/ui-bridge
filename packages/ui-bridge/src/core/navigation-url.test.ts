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
import { checkNavigationUrl, RELAY_NAVIGATION_BASE } from './navigation-url';
import { mapInternalErrorCode } from '../diagnostics';
import { CommandRelay } from '../server/command-relay';
import { createRelayHandlers } from '../server/relay-handlers';
import { createHandlers, type RegistryLike } from '../server/handlers';
import { UIBridgeRegistry, setGlobalRegistry } from './registry';
import { DefaultActionExecutor } from '../control/action-executor';
import type { NavigationAdapter } from '../navigation/navigation-adapter';

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
  { url: 'https://example.test/a', gate: 'ok', relayPageNavigate: 'ok' },
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
    async ({ url, gate, gateMessage }) => {
      const { adapter, navigate } = stubAdapter();
      (window as unknown as { __UI_BRIDGE__?: unknown }).__UI_BRIDGE__ = {
        navigationAdapter: adapter,
      };
      vi.resetModules();
      await import('../injected/bootstrap');
      const answer = await window.__uiBridgeInjected!.execute('navigateByAdapter', { page: url });
      if (gate === 'ok') {
        expect(answer).toEqual(NAVIGATED);
        expect(navigate).toHaveBeenCalledWith(url);
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

  it.each(TABLE)('in-process: $url → $gate', async ({ url, gate, gateMessage }) => {
    const { adapter, navigate } = stubAdapter();
    const registry = new UIBridgeRegistry();
    const handlers = createHandlers(
      registry as unknown as RegistryLike,
      new DefaultActionExecutor(registry) as never,
      { navigationAdapter: adapter }
    );
    const result = await handlers.navigateByAdapter({ page: url });
    if (gate === 'ok') {
      expect(result).toMatchObject({ success: true, data: NAVIGATED });
      expect(navigate).toHaveBeenCalledWith(url);
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
        expect(location.assigned).toEqual([url]);
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
