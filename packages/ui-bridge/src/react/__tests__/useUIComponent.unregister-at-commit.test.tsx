/**
 * @vitest-environment jsdom
 */
/**
 * `useUIComponent` unregisters AT COMMIT on unmount.
 *
 * A passive cleanup runs in a later task for a non-discrete unmount, so until
 * then the registry kept listing the component and answering its state although
 * its DOM was gone. This file samples the registry from a MutationObserver
 * callback on the parent, which fires after the DOM removal and before React's
 * passive-effect flush. React's `act` would flush passive effects, so it is NOT
 * used: IS_REACT_ACT_ENVIRONMENT is false for the whole file.
 *
 * Every expectation is a hand-written literal.
 */

import React, { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { UIBridgeRegistry } from '../../core/registry';

let registry = new UIBridgeRegistry();
let bridge = { registry };

vi.mock('../UIBridgeProvider', () => ({
  useUIBridgeOptional: () => bridge,
}));

// Imported AFTER the mock declaration so the hook picks it up.
const { useUIComponent } = await import('../useUIComponent');

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

function Panel({ id }: { id: string }) {
  useUIComponent({ id, name: 'Panel', state: () => ({ v: 'live' }) });
  return <div data-panel={id} />;
}

function Parent({ show, id }: { show: boolean; id: string }) {
  return <section>{show ? <Panel id={id} /> : null}</section>;
}

interface GapSample {
  listed: boolean;
  component: boolean;
  state: unknown;
}

function sampleNow(id: string): GapSample {
  return {
    listed: registry.getAllComponents().some((c) => c.id === id),
    component: registry.getComponent(id) !== undefined,
    state: registry.getComponentState(id),
  };
}

function mountPoint() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return { container, root: createRoot(container) };
}

describe('useUIComponent unregister-at-commit', () => {
  it('is absent from the registry when the DOM removal is first observable', async () => {
    registry = new UIBridgeRegistry();
    bridge = { registry };
    const { container, root } = mountPoint();
    const samples: GapSample[] = [];

    root.render(<Parent show id="gap-panel" />);
    await tick();
    expect(sampleNow('gap-panel').listed).toBe(true);

    const observer = new MutationObserver(() => samples.push(sampleNow('gap-panel')));
    observer.observe(container, { childList: true, subtree: true });

    // A resolved-promise update is a default-lane (non-discrete) render.
    await Promise.resolve();
    root.render(<Parent show={false} id="gap-panel" />);
    await tick();
    observer.disconnect();

    expect(samples.length > 0).toBe(true);
    expect(samples[0]).toEqual({ listed: false, component: false, state: null });
    root.unmount();
    container.remove();
  });

  it('stays registered under StrictMode double-mount', async () => {
    registry = new UIBridgeRegistry();
    bridge = { registry };
    const { container, root } = mountPoint();

    root.render(
      <StrictMode>
        <Panel id="strict-panel" />
      </StrictMode>
    );
    await tick();

    expect(registry.getComponent('strict-panel')?.id).toBe('strict-panel');
    expect(registry.getComponentState('strict-panel')?.state).toEqual({ v: 'live' });

    root.unmount();
    await tick();
    expect(registry.getComponent('strict-panel')).toBeUndefined();
    container.remove();
  });

  it('stays registered across renders of a provider whose bridge object churns', async () => {
    registry = new UIBridgeRegistry();
    const { container, root } = mountPoint();

    for (let i = 0; i < 3; i++) {
      bridge = { registry }; // a NEW bridge object each render
      root.render(<Parent show id="churn-panel" />);
      await tick();
      expect(registry.getComponent('churn-panel')?.id).toBe('churn-panel');
    }
    expect(registry.getAllComponents().filter((c) => c.id === 'churn-panel').length).toBe(1);

    root.unmount();
    await tick();
    container.remove();
  });

  it('keeps a same-id remount (key change) registered after the flush', async () => {
    registry = new UIBridgeRegistry();
    bridge = { registry };
    const { container, root } = mountPoint();

    root.render(<Panel key="a" id="remount-panel" />);
    await tick();
    root.render(<Panel key="b" id="remount-panel" />);
    await tick();

    expect(registry.getComponent('remount-panel')?.id).toBe('remount-panel');
    root.unmount();
    await tick();
    container.remove();
  });

  it('is put back when a Suspense boundary re-suspends and then reveals it', async () => {
    registry = new UIBridgeRegistry();
    bridge = { registry };
    const { container, root } = mountPoint();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let suspended = false;
    function Gate() {
      if (suspended) throw gate;
      return null;
    }

    root.render(
      <Suspense fallback={<i />}>
        <Panel id="suspense-panel" />
        <Gate />
      </Suspense>
    );
    await tick();
    expect(registry.getComponent('suspense-panel')?.id).toBe('suspense-panel');

    suspended = true;
    root.render(
      <Suspense fallback={<i />}>
        <Panel id="suspense-panel" />
        <Gate />
      </Suspense>
    );
    await tick();
    suspended = false;
    release();
    for (let i = 0; i < 6; i++) await tick();

    expect(registry.getComponent('suspense-panel')?.id).toBe('suspense-panel');
    root.unmount();
    await tick();
    container.remove();
  });
});
