/**
 * Transport-specific sanity test — `live`.
 *
 * Doesn't open a real WebSocket — it would need a runner. Instead it
 * stubs `globalThis.WebSocket` with a no-op class, constructs the
 * transport, and confirms the handler registration is intact.
 */

import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { LiveSessionTransport } from '@qontinui/ui-bridge-wrapper';
import { registerHandlers } from '../src/handlers.js';

class NoopWebSocket {
  readyState = 0;
  send(): void {
    /* no-op */
  }
  close(): void {
    /* no-op */
  }
  addEventListener(): void {
    /* no-op */
  }
}

describe('{{PACKAGE_NAME}} (live transport wiring)', () => {
  let restore: (() => void) | null = null;

  beforeAll(() => {
    const g = globalThis as { WebSocket?: unknown };
    const prev = g.WebSocket;
    g.WebSocket = NoopWebSocket as unknown as typeof WebSocket;
    restore = () => {
      g.WebSocket = prev;
    };
  });

  afterAll(() => {
    restore?.();
  });

  it('registers the hello action on a live transport', () => {
    const transport = new LiveSessionTransport({
      kind: 'live',
      runnerUrl: 'ws://localhost:1420/ui-bridge/ws',
      appId: 'wrapper-{{NAME}}',
      appName: '{{DISPLAY_NAME}}',
    });
    registerHandlers(transport);
    expect(transport.handlerRegistry.has('hello')).toBe(true);
  });
});
