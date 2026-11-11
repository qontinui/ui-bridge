/**
 * A component action call arriving after a NON-DISCRETE update commits and
 * before its passive effects flush runs the NEW render's handler.
 *
 * `act()` flushes every effect before returning, so an act-wrapped test cannot
 * see the gap. This one turns the act environment off, flips state from a
 * resolved promise and calls the registered action from a MutationObserver
 * callback, which runs as a microtask after the DOM commit and before the
 * passive flush. It also pins `updateActions` from a passive effect in the same
 * commit as a new declared list: the installed handler wins.
 */

import React, { useEffect, useState } from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { NativeUIBridgeRegistry } from '../core/registry';

const registry = new NativeUIBridgeRegistry();

vi.mock('./UIBridgeNativeProvider', () => {
  let cached: { registry: NativeUIBridgeRegistry } | undefined;
  return {
    useUIBridgeNativeOptional: () => (cached ??= { registry }),
  };
});

const { useUIComponent } = await import('./useUIComponent');

const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
const previousActEnv = g.IS_REACT_ACT_ENVIRONMENT;

afterEach(() => {
  cleanup();
  g.IS_REACT_ACT_ENVIRONMENT = previousActEnv;
});

let flip: () => void;

function Toggle({ id }: { id: string }) {
  const [on, setOn] = useState(true);
  flip = () => setOn((v) => !v);
  useUIComponent({
    id,
    name: 'Toggle',
    actions: [{ id: 'read', handler: () => (on ? 'on' : 'off') }],
  });
  return <div>{on ? 'on' : 'off'}</div>;
}

describe('native useUIComponent runs the committed render handler in the passive-flush gap', () => {
  it('calls the new render handler from a post-commit observer', async () => {
    g.IS_REACT_ACT_ENVIRONMENT = false;
    const { container } = render(<Toggle id="at-commit" />);
    await new Promise((r) => setTimeout(r, 20));

    const dom = container.firstElementChild as HTMLElement;
    const sampled = new Promise<unknown>((resolve) => {
      const observer = new MutationObserver(() => {
        if (dom.textContent !== 'off') return;
        observer.disconnect();
        resolve(registry.getComponent('at-commit')?.actions[0]?.handler());
      });
      observer.observe(dom, { childList: true, characterData: true, subtree: true });
    });
    await Promise.resolve().then(() => flip());

    expect(await sampled).toBe('off');
  });

  it('keeps an updateActions handler installed in the same commit as a new declared list', () => {
    const installed = vi.fn(() => 'installed');
    function Edge({ tick }: { tick: number }) {
      const h = useUIComponent({
        id: 'edge',
        name: 'Edge',
        actions: [{ id: 'go', handler: () => 'declared' }],
      });
      useEffect(() => {
        if (tick === 2) h.updateActions([{ id: 'go', handler: installed }]);
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [tick]);
      return <div />;
    }
    const { rerender } = render(<Edge tick={0} />);
    rerender(<Edge tick={1} />);
    rerender(<Edge tick={2} />);

    expect(registry.getComponent('edge')?.actions[0]?.handler()).toBe('installed');
    expect(installed).toHaveBeenCalledTimes(1);
  });
});
