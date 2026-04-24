/**
 * F1 — Soft-navigate mode.
 *
 * Unit tests for the `pageNavigate` handler in `executeCommand`.
 *
 * Back-compat contract:
 *   - Omitted `mode` keeps the legacy behaviour (registered navigate-handler,
 *     else `window.location.href = url`).
 *   - `mode: "hard"` forces the legacy behaviour.
 *
 * New `mode: "soft"` contract:
 *   - Calls `history.pushState` so `location.pathname` flips to the new URL.
 *   - Dispatches a synthetic `popstate` event so React Router v6 picks up
 *     the change.
 *   - Dispatches `ui-bridge:navigate` so non-router listeners can observe.
 *   - Does NOT wipe `window.<custom-globals>` (the whole point of F1).
 *   - Returns `{ hard: false, mode: "soft" }` in the result.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeCommand, type BridgeAccess } from './commandHandlers';

const emptyBridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
};

describe('executeCommand · pageNavigate · F1 soft-mode', () => {
  const originalPathname = window.location.pathname;

  beforeEach(() => {
    // Reset history to a known path so each test sees `/` first.
    window.history.pushState(null, '', '/');
    // Clear any global nav handler between runs.
    const g = (window as unknown as { __UI_BRIDGE__?: { navigateHandler?: unknown } })
      .__UI_BRIDGE__;
    if (g) delete g.navigateHandler;
  });

  afterEach(() => {
    window.history.pushState(null, '', originalPathname);
    // Drop any sentinel globals we set.
    delete (window as unknown as Record<string, unknown>).__test_token;
  });

  it('omitted mode falls back to hard navigation (back-compat)', async () => {
    // jsdom does not support assigning `window.location.href` to a path, so
    // we stub the setter to observe the assignment rather than letting it
    // throw.
    const hrefSetter = vi.fn();
    const locationProxy = new Proxy(window.location, {
      set(target, prop, value) {
        if (prop === 'href') {
          hrefSetter(value);
          return true;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (target as any)[prop] = value;
        return true;
      },
    });
    const origDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: locationProxy,
    });

    try {
      const result = (await executeCommand('pageNavigate', { url: '/fleet' }, emptyBridge)) as {
        success: boolean;
        hard?: boolean;
        mode?: string;
      };
      expect(result.success).toBe(true);
      // Legacy body (no `hard`, no `navigateHandler`) should fall through to
      // the location.href branch.
      expect(hrefSetter).toHaveBeenCalledWith('/fleet');
      expect(result.hard).toBe(true);
      expect(result.mode).toBe('hard');
    } finally {
      if (origDescriptor) {
        Object.defineProperty(window, 'location', origDescriptor);
      }
    }
  });

  it('mode: "soft" calls pushState and fires popstate + ui-bridge:navigate', async () => {
    const popHandler = vi.fn();
    const bridgeHandler = vi.fn();
    window.addEventListener('popstate', popHandler);
    window.addEventListener('ui-bridge:navigate', bridgeHandler as EventListener);

    try {
      const pushSpy = vi.spyOn(window.history, 'pushState');
      const result = (await executeCommand(
        'pageNavigate',
        { url: '/fleet', mode: 'soft' },
        emptyBridge
      )) as {
        success: boolean;
        hard?: boolean;
        mode?: string;
        url?: string;
        clientSideNavigation?: boolean;
      };

      expect(result.success).toBe(true);
      expect(result.hard).toBe(false);
      expect(result.mode).toBe('soft');
      expect(result.clientSideNavigation).toBe(true);
      expect(pushSpy).toHaveBeenCalledWith(null, '', '/fleet');
      expect(popHandler).toHaveBeenCalledTimes(1);
      expect(bridgeHandler).toHaveBeenCalledTimes(1);
      // The observed location.pathname must match what React Router would see.
      expect(window.location.pathname).toBe('/fleet');
    } finally {
      window.removeEventListener('popstate', popHandler);
      window.removeEventListener('ui-bridge:navigate', bridgeHandler as EventListener);
    }
  });

  it('mode: "soft" preserves window.<custom-globals> (no wipe)', async () => {
    (window as unknown as Record<string, unknown>).__test_token = 'abc';
    expect((window as unknown as Record<string, string>).__test_token).toBe('abc');

    const result = (await executeCommand(
      'pageNavigate',
      { url: '/fleet', mode: 'soft' },
      emptyBridge
    )) as { success: boolean };

    expect(result.success).toBe(true);
    // The whole point of F1: injected window state must survive soft navigate.
    expect((window as unknown as Record<string, string>).__test_token).toBe('abc');
  });

  it('mode: "soft" with absolute same-origin URL still pushes the pathname', async () => {
    const result = (await executeCommand(
      'pageNavigate',
      { url: `${window.location.origin}/fleet?x=1#hash`, mode: 'soft' },
      emptyBridge
    )) as { success: boolean; url?: string };

    expect(result.success).toBe(true);
    expect(result.url).toBe('/fleet?x=1#hash');
    expect(window.location.pathname).toBe('/fleet');
    expect(window.location.search).toBe('?x=1');
    expect(window.location.hash).toBe('#hash');
  });

  it('invalid mode string is rejected', async () => {
    const result = (await executeCommand(
      'pageNavigate',
      { url: '/fleet', mode: 'spa' },
      emptyBridge
    )) as { success: boolean; error?: string };

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid mode/i);
  });
});
