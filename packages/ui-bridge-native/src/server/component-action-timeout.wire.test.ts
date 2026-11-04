/**
 * The native HTTP entry point must forward `timeoutMs` (pre-PR review #1,
 * qontinui/ui-bridge#163).
 *
 * Plan: `2026-08-20-ui-bridge-action-declaration-shape.md`, Phase 3.
 *
 * `executeComponentAction` read only `body.params` and rebuilt a closed
 * `{ action, params }` literal, so a React Native app's HTTP caller had no way
 * to abandon a hung handler at all — an `AbortSignal` cannot be serialized, so
 * `timeoutMs` is the only cancellation this transport has.
 *
 * This package carries its own copy of the handler (it cannot import
 * `@qontinui/ui-bridge`, an OPTIONAL peer). The twin that used to live in
 * `@qontinui/ui-bridge/native` was removed in `@qontinui/ui-bridge` 0.41.0,
 * which publishes no native server, so this is the only copy left to pin.
 *
 * Every expectation is a hand-written literal.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createServerHandlers } from './handlers';
import { NativeUIBridgeRegistry } from '../core/registry';

let seen: Array<Record<string, unknown>>;

function recordingExecutor() {
  return {
    executeAction: async () => ({ success: true, durationMs: 0, timestamp: 0 }),
    executeComponentAction: async (id: string, request: Record<string, unknown>) => {
      seen.push({ id, ...request });
      return { success: true, result: 'ok', durationMs: 0, timestamp: 0 };
    },
  };
}

function handlers() {
  return createServerHandlers(new NativeUIBridgeRegistry(), recordingExecutor() as never);
}

beforeEach(() => {
  seen = [];
});

describe('native executeComponentAction handler', () => {
  it('forwards timeoutMs from the request body', async () => {
    await handlers().executeComponentAction({
      params: { id: 'login-form', actionId: 'submit' },
      query: {},
      body: { params: { user: 'ada' }, timeoutMs: 3000 },
    } as never);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      id: 'login-form',
      action: 'submit',
      params: { user: 'ada' },
      timeoutMs: 3000,
    });
  });

  it('leaves timeoutMs undefined when the body omits it', async () => {
    await handlers().executeComponentAction({
      params: { id: 'login-form', actionId: 'submit' },
      query: {},
      body: { params: {} },
    } as never);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      id: 'login-form',
      action: 'submit',
      params: {},
      timeoutMs: undefined,
    });
  });
});
