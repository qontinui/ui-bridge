/**
 * The direct transport's control-action `catch` classifies a thrown error by
 * its `code`, never by its message (plan
 * 2026-11-21-ui-bridge-relay-follow-ups-from-434-438 Phase 2).
 */

import { describe, expect, it } from 'vitest';
import { createHandlers, type RegistryLike } from './handlers';
import { UIBridgeRegistry } from '../core/registry';

async function codeWhenExecutorThrows(thrown: unknown): Promise<string | undefined> {
  const registry = new UIBridgeRegistry();
  const executor = {
    executeAction: async () => {
      throw thrown;
    },
  };
  const handlers = createHandlers(registry as unknown as RegistryLike, executor as never);
  const result = await handlers.executeElementAction('el', { action: 'click' });
  expect(result.success).toBe(false);
  return result.code;
}

describe('executeElementAction thrown-error arm', () => {
  it.each([
    ['ELEMENT_NOT_FOUND', 'UB-ELEM-NOT-FOUND'],
    ['TIMEOUT', 'UB-ACTION-TIMEOUT'],
    ['VALIDATION_ERROR', 'UB-VALIDATION-ERROR'],
    ['UNSUPPORTED_ACTION', 'UB-UNSUPPORTED-ACTION'],
    ['NETWORK_ERROR', 'UB-NET-ERROR'],
  ])('code %s answers %s whatever the wording', async (code, expected) => {
    expect(
      await codeWhenExecutorThrows(Object.assign(new Error('reworded entirely'), { code }))
    ).toBe(expected);
  });

  it('a message that reads like a cause but carries no code is UB-UNKNOWN-ERROR', async () => {
    expect(await codeWhenExecutorThrows(new Error('element not found: timeout'))).toBe(
      'UB-UNKNOWN-ERROR'
    );
  });

  it('a thrown fetch failure stays UB-NET-ERROR', async () => {
    expect(await codeWhenExecutorThrows(new TypeError('Failed to fetch'))).toBe('UB-NET-ERROR');
  });
});
