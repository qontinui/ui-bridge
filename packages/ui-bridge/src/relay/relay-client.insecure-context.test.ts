/**
 * The relay client on a page with no `crypto.randomUUID`.
 *
 * `crypto.randomUUID` is defined only in secure contexts, and the injected
 * runtime also runs on plain-http pages. `resolveTabId` used to call it
 * unguarded when nothing pinned a tab id, so on such a page it threw and the
 * relay client never started. Both of the client's UUIDs, the minted tab id
 * and the per-instance `cid`, are now v4 UUIDs on every page.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolveTabId, startRelayClient } from './relay-client';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TAB_ID_STORAGE_KEY = '__uiBridge_tabId';

type PinnedWindow = typeof globalThis & {
  __uiBridgeTabId?: string;
  __uiBridgeInjectedConfig?: { tabId?: string };
};

describe('relay client · a page with no crypto.randomUUID (a non-secure context)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    delete (window as PinnedWindow).__uiBridgeTabId;
    delete (window as PinnedWindow).__uiBridgeInjectedConfig;
    const getRandomValues = crypto.getRandomValues.bind(crypto);
    vi.stubGlobal('crypto', { getRandomValues });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it('resolveTabId mints a v4 UUID and persists it', () => {
    const tabId = resolveTabId();
    expect(tabId).toMatch(UUID_V4);
    expect(sessionStorage.getItem(TAB_ID_STORAGE_KEY)).toBe(tabId);
    expect(resolveTabId()).toBe(tabId);
  });

  it('startRelayClient starts, and its stream GET carries a v4 tab id and cid', () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', (input: unknown) => {
      urls.push(String(input));
      return new Promise<Response>(() => {});
    });
    const client = startRelayClient({
      basePath: '/api/ui-bridge',
      execute: async () => ({ success: true }),
      onError: () => {},
    });
    try {
      const stream = urls.find((url) => url.includes('/commands/stream'));
      const params = new URL(String(stream), 'https://relay.example').searchParams;
      expect(params.get('tabId')).toMatch(UUID_V4);
      expect(params.get('tabId')).toBe(client.tabId);
      expect(params.get('cid')).toMatch(UUID_V4);
    } finally {
      client.stop();
    }
  });
});
