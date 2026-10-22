/**
 * The in-package native executor (`@qontinui/ui-bridge/native`) answers an
 * unknown verb with the element's verbs and a "did you mean" drawn only from
 * them (plan
 * 2026-10-22-runner-ui-bridge-makes-an-agent-guess-its-own-vocabulary,
 * Phase 8). Before, it threw a bare `Unknown action: <verb>`.
 */

import { describe, it, expect } from 'vitest';
import { DefaultNativeActionExecutor } from './action-executor';
import { NativeUIBridgeRegistry } from '../core/registry';
import type { NativeStandardAction } from '../core/types';

function executorWith(id: string, actions: NativeStandardAction[]): DefaultNativeActionExecutor {
  const registry = new NativeUIBridgeRegistry();
  registry.registerElement(id, { current: null } as never, {
    type: 'button',
    actions,
    props: { onPress: () => undefined },
  });
  return new DefaultNativeActionExecutor(registry);
}

describe('native DefaultNativeActionExecutor (in-package) — unknown action', () => {
  it('`tap` suggests `press` and lists the element verbs', async () => {
    const res = await executorWith('save', ['focus', 'press']).executeAction('save', {
      action: 'tap',
    });
    expect(res.success).toBe(false);
    expect(res.code).toBe('UNKNOWN_ACTION');
    expect(res.didYouMean).toBe('press');
    expect(res.error).toBe(
      "Unknown action 'tap' for element 'save'. This element accepts: focus, press. " +
        "Did you mean 'press'?"
    );
  });

  it('never suggests an unadvertised verb, and omits the didYouMean key', async () => {
    const res = await executorWith('save', ['press']).executeAction('save', { action: 'fill' });
    expect(res.code).toBe('UNKNOWN_ACTION');
    expect('didYouMean' in res).toBe(false);
    expect(res.error).toBe(
      "Unknown action 'fill' for element 'save'. This element accepts: press."
    );
  });
});
