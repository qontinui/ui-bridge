/**
 * A bridge read or action call that arrives after a NON-DISCRETE update commits
 * and before its passive effects flush must see that commit's state and handler.
 *
 * `act()` flushes every effect before returning, so an act-wrapped test cannot see
 * the gap. These tests turn the act environment off, flip state from a resolved
 * promise (a non-discrete update) and sample inside a MutationObserver callback,
 * which runs as a microtask after the DOM commit and before the passive flush.
 */

import React, { useEffect, useState } from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { UIBridgeRegistry } from '../../core/registry';
import type { UseUIComponentReturn } from '../useUIComponent';

const registry = new UIBridgeRegistry();
const bridge = { registry };

vi.mock('../UIBridgeProvider', () => ({
  useUIBridgeOptional: () => bridge,
}));

const { useUIComponent } = await import('../useUIComponent');

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
    state: () => ({ on }),
  });
  return <div data-testid="dom">{on ? 'on' : 'off'}</div>;
}

/** Resolve the first sample taken once the DOM text reads `off`. */
function sampleAtCommit(
  dom: HTMLElement,
  id: string
): Promise<{ state: unknown; handler: unknown }> {
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (dom.textContent !== 'off') return;
      observer.disconnect();
      resolve({
        state: registry.getComponentState(id)?.state,
        handler: registry.getComponent(id)?.actions[0]?.handler(),
      });
    });
    observer.observe(dom, { childList: true, characterData: true, subtree: true });
  });
}

describe('useUIComponent serves the committed render in the passive-flush gap', () => {
  it('reads the new render state and runs the new render handler', async () => {
    g.IS_REACT_ACT_ENVIRONMENT = false;
    const { container } = render(<Toggle id="at-commit" />);
    await new Promise((r) => setTimeout(r, 20));

    const sampled = sampleAtCommit(container.firstElementChild as HTMLElement, 'at-commit');
    await Promise.resolve().then(() => flip());
    const { state, handler } = await sampled;

    expect(state).toEqual({ on: false });
    expect(handler).toBe('off');
  });
});

describe('updateActions from a passive effect in the same commit as a new declared list', () => {
  it('runs the installed handler until the next render supplies a new array', async () => {
    let hook!: UseUIComponentReturn;
    const installed = vi.fn(() => 'installed');
    function Edge({ tick }: { tick: number }) {
      const h = useUIComponent({
        id: 'edge',
        name: 'Edge',
        actions: [{ id: 'go', handler: () => 'declared' }],
      });
      hook = h;
      useEffect(() => {
        if (tick === 2) h.updateActions([{ id: 'go', handler: installed }]);
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [tick]);
      return <div />;
    }
    const { rerender } = render(<Edge tick={0} />);
    rerender(<Edge tick={1} />);
    rerender(<Edge tick={2} />);

    expect(hook).toBeDefined();
    expect(registry.getComponent('edge')?.actions[0]?.handler()).toBe('installed');
    expect(installed).toHaveBeenCalledTimes(1);
  });
});
