import { describe, it, expect } from 'vitest';
import { NativeUIBridgeRegistry } from '../../core/registry';
import { DefaultNativeActionExecutor } from '../../control/action-executor';
import type { NativeElementRef } from '../../core/types';
import { createServerHandlers } from '../handlers';
import type { FillFormResponse } from '../types';

/**
 * Tests for the `POST /ai/fill-form` handler.
 *
 * These exercise the real `DefaultNativeActionExecutor` against a real
 * registry rather than a stub — both to keep the contract end-to-end
 * honest and so a future change to the executor's `type` semantics
 * surfaces here.
 */

function makeInputRef(): React.RefObject<NativeElementRef> {
  return { current: {} as NativeElementRef };
}

/**
 * Register a TextInput-shaped element. The action executor maps the
 * `type` action to `props.onChangeText`, which writes through to a
 * captured `seen` record so tests can assert what value was applied.
 */
function registerInput(
  registry: NativeUIBridgeRegistry,
  id: string,
  seen: Record<string, string>
): void {
  registry.registerElement(id, makeInputRef(), {
    type: 'input',
    props: {
      onChangeText: (text: string) => {
        seen[id] = text;
      },
    },
  });
}

/** Minimal `HandlerContext` body wrapper to keep call sites compact. */
function ctx(body: unknown) {
  return { params: {}, query: {}, body };
}

describe('fillForm handler', () => {
  it('fills every field successfully and reports succeededCount', async () => {
    const registry = new NativeUIBridgeRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    const seen: Record<string, string> = {};
    registerInput(registry, 'first-name', seen);
    registerInput(registry, 'last-name', seen);
    registerInput(registry, 'email', seen);

    const handlers = createServerHandlers(registry, executor);
    const response = await handlers.fillForm(
      ctx({
        fields: [
          { elementId: 'first-name', value: 'Ada' },
          { elementId: 'last-name', value: 'Lovelace' },
          { elementId: 'email', value: 'ada@example.com' },
        ],
      })
    );

    expect(response.success).toBe(true);
    const data = response.data as FillFormResponse;
    expect(data.succeededCount).toBe(3);
    expect(data.failedCount).toBe(0);
    expect(data.results).toHaveLength(3);
    expect(data.results.every((r) => r.success && r.error === undefined)).toBe(true);
    expect(data.results.map((r) => r.elementId)).toEqual(['first-name', 'last-name', 'email']);
    // The values were actually written through to onChangeText.
    expect(seen).toEqual({
      'first-name': 'Ada',
      'last-name': 'Lovelace',
      email: 'ada@example.com',
    });
  });

  it('does not short-circuit when one element is missing — other fields still fill', async () => {
    const registry = new NativeUIBridgeRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    const seen: Record<string, string> = {};
    registerInput(registry, 'present-1', seen);
    registerInput(registry, 'present-2', seen);
    // 'missing' is intentionally not registered.

    const handlers = createServerHandlers(registry, executor);
    const response = await handlers.fillForm(
      ctx({
        fields: [
          { elementId: 'present-1', value: 'A' },
          { elementId: 'missing', value: 'X' },
          { elementId: 'present-2', value: 'B' },
        ],
      })
    );

    expect(response.success).toBe(true); // outer envelope: request was processed
    const data = response.data as FillFormResponse;
    expect(data.succeededCount).toBe(2);
    expect(data.failedCount).toBe(1);
    expect(data.results).toHaveLength(3);

    const byId = Object.fromEntries(data.results.map((r) => [r.elementId, r]));
    expect(byId['present-1'].success).toBe(true);
    expect(byId['present-2'].success).toBe(true);
    expect(byId['missing'].success).toBe(false);
    expect(byId['missing'].error).toContain('missing');
    // The successful fields were still applied even though one failed.
    expect(seen).toEqual({ 'present-1': 'A', 'present-2': 'B' });
  });

  it('returns an empty results array with zero counts when fields is []', async () => {
    const registry = new NativeUIBridgeRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    const handlers = createServerHandlers(registry, executor);

    const response = await handlers.fillForm(ctx({ fields: [] }));

    expect(response.success).toBe(true);
    const data = response.data as FillFormResponse;
    expect(data.results).toEqual([]);
    expect(data.succeededCount).toBe(0);
    expect(data.failedCount).toBe(0);
  });

  it('rejects a request with no "fields" array', async () => {
    const registry = new NativeUIBridgeRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    const handlers = createServerHandlers(registry, executor);

    const response = await handlers.fillForm(ctx({}));

    expect(response.success).toBe(false);
    expect(response.code).toBe('INVALID_REQUEST');
    expect(response.error).toBeDefined();
  });

  it('records a per-field failure for elements that lack a setValue-equivalent capability', async () => {
    // A pressable button has no `onChangeText` — the executor's `type`
    // action should fail with "No text change handler found on element"
    // and the handler must report that as a per-field failure (not a
    // top-level error).
    const registry = new NativeUIBridgeRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    registry.registerElement(
      'btn',
      { current: {} as NativeElementRef },
      {
        type: 'button',
        props: {
          onPress: () => {
            /* press handler only */
          },
        },
      }
    );
    const seen: Record<string, string> = {};
    registerInput(registry, 'real-input', seen);

    const handlers = createServerHandlers(registry, executor);
    const response = await handlers.fillForm(
      ctx({
        fields: [
          { elementId: 'btn', value: 'should-fail' },
          { elementId: 'real-input', value: 'ok' },
        ],
      })
    );

    expect(response.success).toBe(true);
    const data = response.data as FillFormResponse;
    expect(data.succeededCount).toBe(1);
    expect(data.failedCount).toBe(1);

    const byId = Object.fromEntries(data.results.map((r) => [r.elementId, r]));
    expect(byId['real-input'].success).toBe(true);
    expect(byId['btn'].success).toBe(false);
    // The exact error string is owned by the executor — capture whatever
    // it actually produces today; this assertion will tell us if the
    // contract drifts.
    expect(byId['btn'].error).toMatch(/text change handler|setValue/i);
    expect(seen).toEqual({ 'real-input': 'ok' });
  });

  it('flags fields with non-string elementId without crashing the rest', async () => {
    const registry = new NativeUIBridgeRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    const seen: Record<string, string> = {};
    registerInput(registry, 'good', seen);

    const handlers = createServerHandlers(registry, executor);
    const response = await handlers.fillForm(
      ctx({
        fields: [
          { elementId: 'good', value: 'ok' },
          { elementId: 42 as unknown as string, value: 'bad' },
          { elementId: 'no-value' },
        ],
      })
    );

    expect(response.success).toBe(true);
    const data = response.data as FillFormResponse;
    expect(data.succeededCount).toBe(1);
    expect(data.failedCount).toBe(2);
    expect(data.results.find((r) => r.elementId === 'good')?.success).toBe(true);
    expect(data.results[1].success).toBe(false);
    expect(data.results[1].error).toContain('elementId');
    expect(data.results[2].success).toBe(false);
    expect(data.results[2].error).toContain('value');
  });
});
