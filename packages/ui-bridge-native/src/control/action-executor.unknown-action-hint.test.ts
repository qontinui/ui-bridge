/**
 * The native executor's unknown-action refusal names the element's verbs and a
 * "did you mean" (plan
 * 2026-10-22-runner-ui-bridge-makes-an-agent-guess-its-own-vocabulary,
 * Phase 8). Before, it threw a bare `Unknown action: <verb>`.
 */

import { describe, it, expect } from 'vitest';
import { DefaultNativeActionExecutor } from './action-executor';
import { NativeUIBridgeRegistry } from '../core/registry';
import type { NativeElementRef, NativeStandardAction } from '../core/types';

function executorWith(id: string, actions: NativeStandardAction[]): DefaultNativeActionExecutor {
  const registry = new NativeUIBridgeRegistry();
  registry.registerElement(
    id,
    { current: {} as unknown as NativeElementRef },
    { type: 'button', props: { onPress: () => undefined }, actions }
  );
  return new DefaultNativeActionExecutor(registry);
}

describe('DefaultNativeActionExecutor — unknown action', () => {
  it('`tap` on a pressable suggests `press` and lists its verbs', async () => {
    const executor = executorWith('save', ['focus', 'blur', 'press', 'longPress']);
    const res = await executor.executeAction('save', { action: 'tap' });

    expect(res.success).toBe(false);
    expect(res.code).toBe('UNKNOWN_ACTION');
    expect(res.didYouMean).toBe('press');
    expect(res.error).toBe(
      "Unknown action 'tap' for element 'save'. " +
        "This element accepts: focus, blur, press, longPress. Did you mean 'press'?"
    );
  });

  it('`fill` suggests `type` from the executable verbs when the element does not advertise it', async () => {
    const executor = executorWith('name', ['focus', 'press']);
    const res = await executor.executeAction('name', { action: 'fill' });
    expect(res.code).toBe('UNKNOWN_ACTION');
    expect(res.didYouMean).toBe('type');
  });

  it('a verb with no plausible match carries no suggestion', async () => {
    const executor = executorWith('save', ['press']);
    const res = await executor.executeAction('save', { action: 'frobnicate' });
    expect(res.code).toBe('UNKNOWN_ACTION');
    expect(res.didYouMean).toBeUndefined();
    expect(res.error).toBe(
      "Unknown action 'frobnicate' for element 'save'. This element accepts: press."
    );
  });
});
