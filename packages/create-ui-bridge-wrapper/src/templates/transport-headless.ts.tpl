/**
 * Transport-specific sanity test — `headless`.
 *
 * Verifies the scaffolded `hello` action registers cleanly under the
 * headless transport. Doesn't actually launch Chromium (that requires
 * `playwright install`) — it constructs the transport, checks
 * registration, and closes. Replace with a real e2e once Playwright
 * is installed.
 */

import { describe, it, expect } from 'vitest';
import { HeadlessTransport } from '@qontinui/ui-bridge-wrapper';
import { registerHandlers } from '../src/handlers.js';

describe('{{PACKAGE_NAME}} (headless transport wiring)', () => {
  it('registers the hello action on a headless transport', () => {
    const transport = new HeadlessTransport({
      kind: 'headless',
      options: { targetUrl: 'about:blank' },
    });
    registerHandlers(transport);
    expect(transport.handlerRegistry.has('hello')).toBe(true);
  });
});
