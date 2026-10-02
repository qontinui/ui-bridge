/**
 * The registration poll picks THIS launch's tab (relay-binding Phase 2b).
 *
 * Every tab in the operator's browser can register on the same runner, so
 * the poll's old `tabs[0]` could hand a launch someone else's tab — which an
 * agent would then drive. A pinned launch takes its pinned tab only; an
 * unpinned one takes the tab the runner verified for the navigated origin,
 * and falls back to `tabs[0]` only when the relay serves no `verifiedOrigin`.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { selectOwnTab, waitForUiBridgeRegistration } from './launcher.js';

const BASE = 'http://127.0.0.1:9876/ui-bridge';

function relayServing(tabs: unknown[]) {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: { tabs } }),
  })) as unknown as typeof fetch;
}

const foreign = { tabId: 'foreign', verifiedOrigin: 'https://mail.example' };
const own = { tabId: 'own', verifiedOrigin: 'https://app.example' };

describe('waitForUiBridgeRegistration · own tab', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('an unpinned launch returns the tab verified for its origin, not tabs[0]', async () => {
    relayServing([foreign, own]);
    const result = await waitForUiBridgeRegistration(BASE, 2_000, undefined, {
      expectedOrigin: 'https://app.example',
    });
    expect(result).toEqual({ tabId: 'own', ok: true });
  });

  it('a pinned launch returns the pinned tab only', async () => {
    relayServing([foreign, { tabId: 'pinned', verifiedOrigin: null }]);
    const result = await waitForUiBridgeRegistration(BASE, 2_000, undefined, {
      pinnedTabId: 'pinned',
      expectedOrigin: 'https://app.example',
    });
    expect(result).toEqual({ tabId: 'pinned', ok: true });
  });

  it('only foreign tabs registered: keeps waiting, never adopts one', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    relayServing([foreign]);
    const result = await waitForUiBridgeRegistration(BASE, 600, undefined, {
      expectedOrigin: 'https://app.example',
    });
    expect(result).toEqual({ tabId: null, ok: false });
  });
});

describe('selectOwnTab', () => {
  it('falls back to tabs[0] when the relay serves no verifiedOrigin', () => {
    expect(
      selectOwnTab([{ tabId: 'a' }, { tabId: 'b' }], { expectedOrigin: 'https://x.example' })
    ).toEqual({ tabId: 'a' });
  });

  it('treats loopback spellings of one port as the same origin', () => {
    const tab = { tabId: 'dev', verifiedOrigin: 'http://localhost:3000' };
    expect(selectOwnTab([tab], { expectedOrigin: 'http://127.0.0.1:3000' })).toBe(tab);
    expect(selectOwnTab([tab], { expectedOrigin: 'http://127.0.0.1:3001' })).toBeNull();
  });

  it('a pinned launch never falls back to another tab', () => {
    expect(selectOwnTab([{ tabId: 'a' }], { pinnedTabId: 'p' })).toBeNull();
  });

  it('with no selection, behaves as before (tabs[0])', () => {
    expect(selectOwnTab([foreign, own])).toBe(foreign);
  });
});
