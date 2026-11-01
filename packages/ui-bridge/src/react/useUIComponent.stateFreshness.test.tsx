/**
 * `useUIComponent` hands the registry a stable `getState` that reads the LATEST
 * `state` option, not the closure captured at registration.
 *
 * The registry stores whatever function it receives at register/update time and
 * calls it on every snapshot (`component.getState?.() ?? {}`). A consumer that
 * passes a fresh inline `state: () => ({ open })` each render used to be read
 * through its FIRST render's closure forever: every later state change was
 * invisible to `/control/component/:id` and to snapshots.
 *
 * Every expectation is a hand-written literal.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { UIBridgeRegistry } from '../core/registry';

const registry = new UIBridgeRegistry();
// ONE bridge object for every render, like the real provider's context value.
// A fresh `{ registry }` per call would change the hook's `bridge` dependency
// on every render and re-run its update effect each time, which masks the very
// staleness this file pins.
const bridge = { registry };

vi.mock('./UIBridgeProvider', () => ({
  useUIBridgeOptional: () => bridge,
}));

// Imported AFTER the mock declaration so the hook picks it up.
const { useUIComponent } = await import('./useUIComponent');

function Harness({
  id,
  open,
  withState = true,
}: {
  id: string;
  open: boolean;
  withState?: boolean;
}) {
  useUIComponent({
    id,
    name: 'Panel',
    ...(withState ? { state: () => ({ open }) } : {}),
  });
  return <div />;
}

function readState(id: string): Record<string, unknown> | undefined {
  return registry.getComponent(id)?.getState?.();
}

describe('useUIComponent state freshness', () => {
  it('reads the state closure of the LATEST render, not the first', () => {
    const { rerender } = render(<Harness id="panel-fresh" open={false} />);
    expect(readState('panel-fresh')).toEqual({ open: false });

    // Same id and name: no component-key churn, so no updateComponent call —
    // only the stable delegating getter can see the new closure.
    rerender(<Harness id="panel-fresh" open={true} />);
    expect(readState('panel-fresh')).toEqual({ open: true });

    rerender(<Harness id="panel-fresh" open={false} />);
    expect(readState('panel-fresh')).toEqual({ open: false });
  });

  it('registers no getState when no state option was given', () => {
    render(<Harness id="panel-stateless" open={false} withState={false} />);
    expect(registry.getComponent('panel-stateless')?.getState).toBeUndefined();
  });

  it('reads as an empty state (never a stale one) once the state option is dropped', () => {
    const { rerender } = render(<Harness id="panel-dropped" open={true} />);
    expect(readState('panel-dropped')).toEqual({ open: true });

    rerender(<Harness id="panel-dropped" open={true} withState={false} />);
    // The registry reads `getState?.() ?? {}`; an absent getter or the delegating
    // one answering `{}` are both correct. A stale `{ open: true }` is not.
    expect(readState('panel-dropped') ?? {}).toEqual({});
  });
});
