/**
 * Transport-agnostic handler test for `{{PACKAGE_NAME}}`.
 *
 * Proves that `registerHandlers` wires every action onto the supplied
 * transport's registry. Uses `ApiTransport` because it has no browser
 * or socket requirements.
 */

import { describe, it, expect } from 'vitest';
import { ApiTransport } from '@qontinui/ui-bridge-wrapper';
import { registerHandlers } from '../src/handlers.js';

describe('{{PACKAGE_NAME}} handlers', () => {
  it('registers the hello action', () => {
    const transport = new ApiTransport({ kind: 'api' });
    registerHandlers(transport);
    expect(transport.handlerRegistry.has('hello')).toBe(true);
    expect(transport.handlerRegistry.list()).toContain('hello');
  });
});
