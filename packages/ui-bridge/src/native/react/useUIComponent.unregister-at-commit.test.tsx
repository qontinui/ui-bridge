/**
 * @vitest-environment jsdom
 */
/**
 * Native `useUIComponent` (in @qontinui/ui-bridge) unregisters AT COMMIT on
 * unmount: an action call sampled from a MutationObserver callback, before the
 * passive-effect flush, is refused as not registered. `act` is not used, since
 * it would flush passive effects. Every expectation is a hand-written literal.
 */

import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { NativeUIBridgeRegistry } from '../core/registry';
import { createNativeActionExecutor } from '../control/action-executor';

let registry = new NativeUIBridgeRegistry();

vi.mock('./UIBridgeNativeProvider', () => ({
  useUIBridgeNativeOptional: () => ({ registry }),
}));

// Imported AFTER the mock declaration so the hook picks it up.
const { useUIComponent } = await import('./useUIComponent');

const g = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean };
let savedAct: boolean | undefined;
beforeAll(() => {
  savedAct = g.IS_REACT_ACT_ENVIRONMENT;
  g.IS_REACT_ACT_ENVIRONMENT = false;
});
afterAll(() => {
  g.IS_REACT_ACT_ENVIRONMENT = savedAct;
});

const tick = () => new Promise<void>((r) => setTimeout(r, 50));

function Panel({ id, onPress }: { id: string; onPress: () => string }) {
  useUIComponent({
    id,
    name: 'Panel',
    actions: [{ id: 'press', label: 'Press', handler: onPress }],
  });
  return React.createElement('div');
}

function Parent({ show, id, onPress }: { show: boolean; id: string; onPress: () => string }) {
  return React.createElement(
    'section',
    null,
    show ? React.createElement(Panel, { id, onPress }) : null
  );
}

describe('native useUIComponent unregister-at-commit', () => {
  it('refuses an action in the gap after a non-discrete unmount', async () => {
    registry = new NativeUIBridgeRegistry();
    const executor = createNativeActionExecutor(registry);
    const handler = vi.fn(() => 'ran');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    root.render(React.createElement(Parent, { show: true, id: 'gap-native', onPress: handler }));
    await tick();
    expect(registry.getComponent('gap-native')?.id).toBe('gap-native');

    const results: Array<{ success: boolean; error?: string }> = [];
    const pending: Array<Promise<void>> = [];
    const observer = new MutationObserver(() => {
      pending.push(
        executor
          .executeComponentAction('gap-native', { action: 'press' })
          .then((r) => void results.push({ success: r.success, error: r.error }))
      );
    });
    observer.observe(container, { childList: true, subtree: true });

    await Promise.resolve();
    root.render(React.createElement(Parent, { show: false, id: 'gap-native', onPress: handler }));
    await tick();
    await Promise.all(pending);
    observer.disconnect();

    expect(results[0]).toEqual({ success: false, error: 'Component not found: gap-native' });
    expect(handler).not.toHaveBeenCalled();
    root.unmount();
    container.remove();
  });

  it('stays registered under StrictMode double-mount', async () => {
    registry = new NativeUIBridgeRegistry();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    root.render(
      React.createElement(
        StrictMode,
        null,
        React.createElement(Panel, { id: 'strict-native', onPress: () => 'ok' })
      )
    );
    await tick();

    expect(registry.getComponent('strict-native')?.id).toBe('strict-native');
    root.unmount();
    await tick();
    expect(registry.getComponent('strict-native')).toBeUndefined();
    container.remove();
  });
});
