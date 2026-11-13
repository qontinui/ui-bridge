/**
 * `useUIElement` unregisters AT COMMIT on unmount: a registry listing sampled
 * from a MutationObserver callback (after the DOM removal, before React's
 * passive-effect flush) no longer returns the element. `act` is not used, since
 * it would flush passive effects. Every expectation is a hand-written literal.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { UIBridgeRegistry } from '../../core/registry';

let registry = new UIBridgeRegistry();

vi.mock('../UIBridgeProvider', () => ({
  useUIBridgeOptional: () => ({ registry }),
}));

// Imported AFTER the mock declaration so the hook picks it up.
const { useUIElement } = await import('../useUIElement');

const g = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean };
let savedAct: boolean | undefined;
// jsdom's `closest` throws in some installs; the registry only needs `null` here.
const realClosest = HTMLElement.prototype.closest;
beforeAll(() => {
  HTMLElement.prototype.closest = (() => null) as unknown as typeof realClosest;
  savedAct = g.IS_REACT_ACT_ENVIRONMENT;
  g.IS_REACT_ACT_ENVIRONMENT = false;
});
afterAll(() => {
  HTMLElement.prototype.closest = realClosest;
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
  const { ref } = useUIElement({ id, type: 'button', label: 'Go' });
  return <button ref={ref as React.RefObject<HTMLButtonElement>}>Go</button>;
}

function Parent({ show, id }: { show: boolean; id: string }) {
  return <section>{show ? <Btn id={id} /> : null}</section>;
}

describe('useUIElement unregister-at-commit', () => {
  it('is absent from the element listing when the DOM removal is first observable', async () => {
    registry = new UIBridgeRegistry();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const samples: boolean[] = [];

    root.render(<Parent show id="gap-btn" />);
    await until(
      () => registry.getAllElements().some((e) => e.id === 'gap-btn'),
      'gap-btn registered'
    );
    expect(registry.getAllElements().some((e) => e.id === 'gap-btn')).toBe(true);

    const observer = new MutationObserver(() =>
      samples.push(registry.getAllElements().some((e) => e.id === 'gap-btn'))
    );
    observer.observe(container, { childList: true, subtree: true });

    await Promise.resolve();
    root.render(<Parent show={false} id="gap-btn" />);
    await until(() => samples.length > 0, 'the DOM removal to be observed');
    observer.disconnect();

    expect(samples[0]).toBe(false);
    root.unmount();
    container.remove();
  });
});
