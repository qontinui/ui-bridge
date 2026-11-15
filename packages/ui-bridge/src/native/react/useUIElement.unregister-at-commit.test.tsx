/**
 * @vitest-environment jsdom
 */
/**
 * Native `useUIElement` (in @qontinui/ui-bridge) unregisters AT COMMIT on
 * unmount: an element listing sampled from a MutationObserver callback, before
 * the passive-effect flush, no longer returns the element. `act` is not used,
 * since it would flush passive effects. Every expectation is a hand-written
 * literal.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { NativeUIBridgeRegistry } from '../core/registry';

vi.mock('react-native', () => ({
  StyleSheet: { flatten: (style: unknown) => style ?? undefined },
  PixelRatio: { get: () => 1 },
}));

let registry = new NativeUIBridgeRegistry();

vi.mock('./UIBridgeNativeProvider', () => ({
  useUIBridgeNativeOptional: () => ({ registry, getCurrentRoute: () => undefined }),
}));

// Imported AFTER the mock declaration so the hook picks it up.
const { useUIElement } = await import('./useUIElement');

const g = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean };
let savedAct: boolean | undefined;
beforeAll(() => {
  savedAct = g.IS_REACT_ACT_ENVIRONMENT;
  g.IS_REACT_ACT_ENVIRONMENT = false;
});
afterAll(() => {
  g.IS_REACT_ACT_ENVIRONMENT = savedAct;
});

// A PRECONDITION wait: `act` is off, so passive effects (registration) and the
// non-discrete re-render flush on React's own schedule, which a fixed sleep
// cannot bound on a loaded box. Poll until the precondition holds; time out
// loudly if it never does. Never used for the property under test.
const until = (pred: () => boolean, what: string) =>
  vi.waitFor(
    () => {
      if (!pred()) throw new Error(`timed out waiting for: ${what}`);
    },
    // Under vitest's 5 s test timeout, so a precondition that never holds
    // fails with its own name rather than a generic test timeout.
    { timeout: 2000, interval: 10 }
  );

function Btn({ id }: { id: string }) {
  useUIElement({ id, type: 'view', label: 'Go' });
  return React.createElement('div');
}

function Parent({ show, id }: { show: boolean; id: string }) {
  return React.createElement('section', null, show ? React.createElement(Btn, { id }) : null);
}

describe('native useUIElement unregister-at-commit', () => {
  it('is absent from the element listing when the DOM removal is first observable', async () => {
    registry = new NativeUIBridgeRegistry();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const samples: boolean[] = [];

    root.render(React.createElement(Parent, { show: true, id: 'gap-native-el' }));
    await until(
      () => registry.getAllElements().some((e) => e.id === 'gap-native-el'),
      'gap-native-el registered'
    );
    expect(registry.getAllElements().some((e) => e.id === 'gap-native-el')).toBe(true);

    const observer = new MutationObserver(() =>
      samples.push(registry.getAllElements().some((e) => e.id === 'gap-native-el'))
    );
    observer.observe(container, { childList: true, subtree: true });

    await Promise.resolve();
    root.render(React.createElement(Parent, { show: false, id: 'gap-native-el' }));
    await until(() => samples.length > 0, 'the DOM removal to be observed');
    observer.disconnect();

    expect(samples[0]).toBe(false);
    root.unmount();
    container.remove();
  });
});
