/**
 * WSStreamAdapter Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { createWSStreamBroadcast, WSStreamAdapter } from './ws-stream-adapter';
import { BrowserEventStream } from '../debug/ws-streaming';
import type { BridgeEvent } from '../core';
import type { UIBridgeWSHandler } from './websocket-handler';
import type { ConsoleCapturedEvent } from '../debug/browser-capture-types';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makeConsoleError(message: string): ConsoleCapturedEvent {
  return {
    type: 'console',
    level: 'error',
    message,
    timestamp: Date.now(),
    url: 'http://localhost:3000',
  };
}

function makeConsoleWarn(message: string): ConsoleCapturedEvent {
  return {
    type: 'console',
    level: 'warn',
    message,
    timestamp: Date.now(),
    url: 'http://localhost:3000',
  };
}

function _makeConsoleLog(message: string): ConsoleCapturedEvent {
  return {
    type: 'console',
    level: 'log',
    message,
    timestamp: Date.now(),
    url: 'http://localhost:3000',
  };
}

function mockWSHandler(clientCount = 1): UIBridgeWSHandler {
  return {
    broadcastEvent: vi.fn(),
    get clientCount() {
      return clientCount;
    },
  } as unknown as UIBridgeWSHandler;
}

// ---------------------------------------------------------------------------
// createWSStreamBroadcast
// ---------------------------------------------------------------------------

describe('createWSStreamBroadcast', () => {
  it('returns a function that calls broadcastEvent', () => {
    const handler = mockWSHandler(1);
    const callback = createWSStreamBroadcast(handler);

    const event: BridgeEvent = {
      type: 'browser:error',
      timestamp: Date.now(),
      data: { severity: 'error' },
    };

    callback(event);
    expect(handler.broadcastEvent).toHaveBeenCalledWith(event);
  });

  it('skips broadcast when no WS clients are connected', () => {
    const handler = mockWSHandler(0);
    const callback = createWSStreamBroadcast(handler);

    const event: BridgeEvent = {
      type: 'browser:error',
      timestamp: Date.now(),
      data: { severity: 'error' },
    };

    callback(event);
    expect(handler.broadcastEvent).not.toHaveBeenCalled();
  });

  it('calls log when provided', () => {
    const handler = mockWSHandler(2);
    const log = vi.fn();
    const callback = createWSStreamBroadcast(handler, { log });

    callback({
      type: 'browser:warning',
      timestamp: Date.now(),
      data: {},
    });

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('Broadcasting browser:warning to 2 client(s)')
    );
  });
});

// ---------------------------------------------------------------------------
// WSStreamAdapter
// ---------------------------------------------------------------------------

describe('WSStreamAdapter', () => {
  describe('attach / detach lifecycle', () => {
    it('creates a subscription on attach', () => {
      const stream = new BrowserEventStream();
      const broadcast = vi.fn();
      const adapter = new WSStreamAdapter(stream, { broadcast });

      expect(adapter.isAttached).toBe(false);
      const sub = adapter.attach();

      expect(adapter.isAttached).toBe(true);
      expect(sub.id).toBeTruthy();
      expect(stream.getSubscriptions()).toHaveLength(1);
    });

    it('attach is idempotent', () => {
      const stream = new BrowserEventStream();
      const adapter = new WSStreamAdapter(stream, { broadcast: vi.fn() });

      const sub1 = adapter.attach();
      const sub2 = adapter.attach();

      expect(sub1.id).toBe(sub2.id);
      expect(stream.getSubscriptions()).toHaveLength(1);
    });

    it('detach removes the subscription', () => {
      const stream = new BrowserEventStream();
      const adapter = new WSStreamAdapter(stream, { broadcast: vi.fn() });

      adapter.attach();
      expect(stream.getSubscriptions()).toHaveLength(1);

      adapter.detach();
      expect(adapter.isAttached).toBe(false);
      expect(stream.getSubscriptions()).toHaveLength(0);
    });

    it('detach is safe to call when not attached', () => {
      const stream = new BrowserEventStream();
      const adapter = new WSStreamAdapter(stream, { broadcast: vi.fn() });

      // Should not throw
      adapter.detach();
      expect(adapter.isAttached).toBe(false);
    });
  });

  describe('notifyClientChange', () => {
    it('attaches when first client connects', () => {
      const stream = new BrowserEventStream();
      const adapter = new WSStreamAdapter(stream, { broadcast: vi.fn() });

      adapter.notifyClientChange(1);
      expect(adapter.isAttached).toBe(true);
    });

    it('stays attached when additional clients connect', () => {
      const stream = new BrowserEventStream();
      const adapter = new WSStreamAdapter(stream, { broadcast: vi.fn() });

      adapter.notifyClientChange(1);
      const subId = adapter.subscriptionId;

      adapter.notifyClientChange(3);
      expect(adapter.isAttached).toBe(true);
      expect(adapter.subscriptionId).toBe(subId);
    });

    it('detaches when last client disconnects', () => {
      const stream = new BrowserEventStream();
      const adapter = new WSStreamAdapter(stream, { broadcast: vi.fn() });

      adapter.notifyClientChange(2);
      expect(adapter.isAttached).toBe(true);

      adapter.notifyClientChange(0);
      expect(adapter.isAttached).toBe(false);
    });

    it('does nothing when 0 clients and already detached', () => {
      const stream = new BrowserEventStream();
      const adapter = new WSStreamAdapter(stream, { broadcast: vi.fn() });

      adapter.notifyClientChange(0);
      expect(adapter.isAttached).toBe(false);
    });
  });

  describe('processAndBroadcast', () => {
    it('broadcasts error events that pass the filter', () => {
      const stream = new BrowserEventStream();
      const broadcast = vi.fn();
      const adapter = new WSStreamAdapter(stream, { broadcast, minSeverity: 'warning' });

      adapter.attach();

      const event = makeConsoleError('Something broke');
      adapter.processAndBroadcast(event);

      expect(broadcast).toHaveBeenCalledTimes(1);
      const bridgeEvent: BridgeEvent = broadcast.mock.calls[0][0];
      expect(bridgeEvent.type).toBe('browser:error');
      expect(bridgeEvent.data).toHaveProperty('severity', 'error');
      expect(bridgeEvent.data).toHaveProperty('event', event);
      expect(bridgeEvent.data).toHaveProperty('fingerprint');
    });

    it('broadcasts warning events that pass the filter', () => {
      const stream = new BrowserEventStream();
      const broadcast = vi.fn();
      const adapter = new WSStreamAdapter(stream, { broadcast, minSeverity: 'warning' });

      adapter.attach();
      adapter.processAndBroadcast(makeConsoleWarn('Deprecation notice'));

      expect(broadcast).toHaveBeenCalledTimes(1);
      const bridgeEvent: BridgeEvent = broadcast.mock.calls[0][0];
      expect(bridgeEvent.type).toBe('browser:warning');
    });

    it('does not broadcast events below minSeverity', () => {
      const stream = new BrowserEventStream();
      const broadcast = vi.fn();
      const adapter = new WSStreamAdapter(stream, { broadcast, minSeverity: 'error' });

      adapter.attach();
      adapter.processAndBroadcast(makeConsoleWarn('Just a warning'));

      expect(broadcast).not.toHaveBeenCalled();
    });

    it('does not broadcast when not attached', () => {
      const stream = new BrowserEventStream();
      const broadcast = vi.fn();
      const adapter = new WSStreamAdapter(stream, { broadcast });

      // Not attached — should be a no-op
      adapter.processAndBroadcast(makeConsoleError('Boom'));

      expect(broadcast).not.toHaveBeenCalled();
    });

    it('deduplicates by default', () => {
      const stream = new BrowserEventStream();
      const broadcast = vi.fn();
      const adapter = new WSStreamAdapter(stream, { broadcast });

      adapter.attach();

      const event = makeConsoleError('Same error');
      adapter.processAndBroadcast(event);
      adapter.processAndBroadcast(event);

      // Only first should get through (deduplicate defaults to true)
      expect(broadcast).toHaveBeenCalledTimes(1);
    });

    it('allows duplicates when deduplicate is false', () => {
      const stream = new BrowserEventStream();
      const broadcast = vi.fn();
      const adapter = new WSStreamAdapter(stream, { broadcast, deduplicate: false });

      adapter.attach();

      const event = makeConsoleError('Same error');
      adapter.processAndBroadcast(event);
      adapter.processAndBroadcast(event);

      expect(broadcast).toHaveBeenCalledTimes(2);
    });
  });

  describe('subscriptionId', () => {
    it('returns null when not attached', () => {
      const stream = new BrowserEventStream();
      const adapter = new WSStreamAdapter(stream, { broadcast: vi.fn() });
      expect(adapter.subscriptionId).toBeNull();
    });

    it('returns the subscription ID when attached', () => {
      const stream = new BrowserEventStream();
      const adapter = new WSStreamAdapter(stream, { broadcast: vi.fn() });
      const sub = adapter.attach();
      expect(adapter.subscriptionId).toBe(sub.id);
    });
  });
});
