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
];

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
