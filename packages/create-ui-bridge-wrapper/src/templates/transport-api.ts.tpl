/**
 * Transport-specific sanity test — `api`.
 *
 * Uses the lightest transport (no browser, no WebSocket) to round-trip
 * the scaffolded `hello` action through `registerHandlers`. This proves
 * the action registration plumbing is intact; add richer tests as your
 * wrapper grows.
 */

import { describe, it, expect } from 'vitest';
import { ApiTransport } from '@qontinui/ui-bridge-wrapper';
import { registerHandlers } from '../src/handlers.js';

describe('{{PACKAGE_NAME}} (api transport)', () => {
  it('round-trips the hello action through the handler registry', async () => {
    const transport = new ApiTransport({ kind: 'api' });
    registerHandlers(transport);

    const result = await transport.dispatch<{ message: string; transport: string }>(
      'hello',
      { name: '{{NAME}}' }
    );
    expect(result.message).toBe('hello, {{NAME}}');
    expect(result.transport).toBe('api');

    await transport.close();
  });
});
