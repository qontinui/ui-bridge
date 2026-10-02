/**
 * The injector's tab key (relay-binding Phase 2b).
 *
 * A pinned tab (`--tab-id`) spans origins by design, so the runner cannot bind
 * it to an origin. It binds it to a key the injector generates and publishes
 * beside the pin instead. These tests pin that the key always travels with
 * the pin, never without it, and that the registration poll is told which tab
 * is this launch's.
 */

import { describe, it, expect } from 'vitest';
import { InjectedTransport } from '../src/transports/injected.js';

type Inspectable = {
  injectedConfig(): Record<string, unknown> | null;
  pinnedTabId(): string | undefined;
};

function transport(options: Record<string, unknown>): Inspectable {
  return new InjectedTransport({
    kind: 'injected',
    options: { targetUrl: 'https://app.example/login', ...options },
  }) as unknown as Inspectable;
}

describe('InjectedTransport · tab key', () => {
  it('carries tabKey whenever it carries tabId (relay base or not)', () => {
    for (const extra of [{}, { uiBridgeBase: 'http://127.0.0.1:9876/ui-bridge' }]) {
      const cfg = transport({ tabId: 't1', ...extra }).injectedConfig();
      expect(cfg?.tabId).toBe('t1');
      expect(typeof cfg?.tabKey).toBe('string');
      // 32 random bytes, base64url, no padding.
      expect(cfg?.tabKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });

  it('emits no tabKey without a pinned tabId', () => {
    const cfg = transport({ uiBridgeBase: 'http://127.0.0.1:9876/ui-bridge' }).injectedConfig();
    expect(cfg).not.toBeNull();
    expect(cfg).not.toHaveProperty('tabKey');
  });

  it('keeps one key per launch: every document gets the same key', () => {
    const t = transport({ tabId: 't1' });
    expect(t.injectedConfig()?.tabKey).toBe(t.injectedConfig()?.tabKey);
  });

  it('two launches never share a key', () => {
    const a = transport({ tabId: 't1' }).injectedConfig()?.tabKey;
    const b = transport({ tabId: 't1' }).injectedConfig()?.tabKey;
    expect(a).not.toBe(b);
  });

  it('hands the pinned id to the registration poll', () => {
    expect(transport({ tabId: 't1' }).pinnedTabId()).toBe('t1');
    expect(transport({}).pinnedTabId()).toBeUndefined();
  });
});
