/**
 * Tab-id resolution (U3).
 *
 * `sessionStorage` is partitioned PER-ORIGIN, so it cannot carry a tab id
 * across a cross-origin navigation (an OAuth hop). Before the fix,
 * `resolveTabId()` consulted only `sessionStorage` — so on the new origin it
 * minted a FRESH uuid, silently invalidating the id a caller had pinned with
 * `ui-bridge-inject --tab-id <id>` (and had been addressing the tab by).
 *
 * The caller-owned pin is republished on EVERY document (the wrapper registers
 * it via Playwright's `BrowserContext.addInitScript`, which re-runs on every
 * navigation in the context, cross-origin included), so honouring the pin FIRST
 * is what makes the id stable across the hop.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveTabId } from './relay-client';

const TAB_ID_STORAGE_KEY = '__uiBridge_tabId';

type PinnedWindow = typeof globalThis & {
  __uiBridgeTabId?: string;
  __uiBridgeInjectedConfig?: { tabId?: string };
};

/**
 * Simulate a cross-origin navigation: `sessionStorage` is a fresh, empty
 * partition on the new origin, while anything the driver injects per-document
 * (the pin) is republished.
 */
function crossOriginNavigate(): void {
  sessionStorage.clear();
}

describe('resolveTabId · caller-owned pin (U3)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    delete (window as PinnedWindow).__uiBridgeTabId;
    delete (window as PinnedWindow).__uiBridgeInjectedConfig;
  });

  afterEach(() => {
    sessionStorage.clear();
    delete (window as PinnedWindow).__uiBridgeTabId;
    delete (window as PinnedWindow).__uiBridgeInjectedConfig;
  });

  it('with no pin, mints a uuid and persists it (unchanged behaviour)', () => {
    const first = resolveTabId();
    expect(first).toMatch(/[0-9a-f-]{36}/);
    expect(sessionStorage.getItem(TAB_ID_STORAGE_KEY)).toBe(first);
    // Same origin, same document → stable.
    expect(resolveTabId()).toBe(first);
  });

  it('REGRESSION: an unpinned id is NOT stable across a cross-origin hop', () => {
    const before = resolveTabId();
    crossOriginNavigate();
    // This is the unavoidable per-origin behaviour that motivates the pin.
    expect(resolveTabId()).not.toBe(before);
  });

  it('honours the injected-config pin (--tab-id) over minting a fresh id', () => {
    (window as PinnedWindow).__uiBridgeInjectedConfig = { tabId: 'pinned-tab-1' };
    expect(resolveTabId()).toBe('pinned-tab-1');
    // Republished into this origin's sessionStorage so a late-starting embedded
    // hook in the same document adopts it rather than minting a competitor.
    expect(sessionStorage.getItem(TAB_ID_STORAGE_KEY)).toBe('pinned-tab-1');
  });

  it('THE FIX: a pinned tabId survives a cross-origin (OAuth) navigation', () => {
    (window as PinnedWindow).__uiBridgeInjectedConfig = { tabId: 'pinned-tab-1' };
    const beforeHop = resolveTabId();

    // …the OAuth hop. New origin → empty sessionStorage partition. The driver's
    // init script republishes the pin on the new document.
    crossOriginNavigate();

    const afterHop = resolveTabId();
    expect(afterHop).toBe(beforeHop);
    expect(afterHop).toBe('pinned-tab-1');
  });

  it('the pin WINS over a stale per-origin sessionStorage id', () => {
    // An id was minted before the driver's pin landed (e.g. the app's own hook
    // ran first on a previous visit to this origin).
    sessionStorage.setItem(TAB_ID_STORAGE_KEY, 'stale-origin-local-id');
    (window as PinnedWindow).__uiBridgeInjectedConfig = { tabId: 'pinned-tab-1' };

    expect(resolveTabId()).toBe('pinned-tab-1');
    expect(sessionStorage.getItem(TAB_ID_STORAGE_KEY)).toBe('pinned-tab-1');
  });

  it('window.__uiBridgeTabId is the framework-agnostic pin and takes precedence', () => {
    (window as PinnedWindow).__uiBridgeTabId = 'explicit-pin';
    (window as PinnedWindow).__uiBridgeInjectedConfig = { tabId: 'injected-pin' };
    expect(resolveTabId()).toBe('explicit-pin');
  });

  it('an empty / non-string pin is ignored (falls through to mint)', () => {
    (window as PinnedWindow).__uiBridgeInjectedConfig = { tabId: '' };
    const id = resolveTabId();
    expect(id).not.toBe('');
    expect(id).toMatch(/[0-9a-f-]{36}/);
  });
});
