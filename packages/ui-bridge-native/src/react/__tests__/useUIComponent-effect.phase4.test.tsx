/**
 * @vitest-environment jsdom
 */
/**
 * Phase 4 — `effect` survives the `useUIComponent` re-wrap in
 * `@qontinui/ui-bridge-native`.
 *
 * Plan: `2026-08-20-ui-bridge-action-declaration-shape.md`, Phase 4.
 *
 * The hook re-maps every action into a fresh object literal with a CLOSED
 * field list, and `registerComponent` re-maps it again. A field missing from
 * either is dropped silently — the literal stays assignable, so a type-check
 * cannot see it. This is the RUNTIME round-trip.
 *
 * Every expectation is a hand-written literal.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { NativeUIBridgeRegistry } from '../../core/registry';

const registry = new NativeUIBridgeRegistry();

vi.mock('../UIBridgeNativeProvider', () => ({
  useUIBridgeNativeOptional: () => ({ registry }),
}));

// Imported AFTER the mock declaration so the hook picks it up.
const { useUIComponent } = await import('../useUIComponent');

function Harness(): React.ReactElement {
  useUIComponent({
    id: 'invoice-row',
    name: 'Invoice Row',
    actions: [
      { id: 'press', label: 'Delete', effect: 'destructive', handler: () => 'deleted' },
      { id: 'preview', label: 'Preview', effect: 'read', handler: () => 'previewed' },
      { id: 'rename', label: 'Rename', handler: () => 'renamed' },
    ],
  });
  return React.createElement('div');
}

describe('Phase 4 — ui-bridge-native useUIComponent re-wrap', () => {
  it('carries effect through the re-wrap and the registry literal', () => {
    render(React.createElement(Harness));

    const registered = registry.getComponent('invoice-row');
    expect(registered?.actions.map((a) => a.id)).toEqual(['press', 'preview', 'rename']);
    expect(registered?.actions[0].effect).toBe('destructive');
    expect(registered?.actions[1].effect).toBe('read');
    expect(registered?.actions[2].effect).toBeUndefined();
  });
});
