/**
 * Transport-specific sanity test — `headed`.
 *
 * Construction-only test. Launching a headed browser in CI is usually
 * undesirable; use this as the starting point for a manual e2e.
 */

import { describe, it, expect } from 'vitest';
import { HeadedTransport } from '@qontinui/ui-bridge-wrapper';
import { registerHandlers } from '../src/handlers.js';

describe('{{PACKAGE_NAME}} (headed transport wiring)', () => {
  it('registers the hello action on a headed transport', () => {
    const transport = new HeadedTransport({
      kind: 'headed',
      options: { targetUrl: 'about:blank' },
    });
    registerHandlers(transport);
    expect(transport.handlerRegistry.has('hello')).toBe(true);
  });
});
