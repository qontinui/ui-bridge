/**
 * Phase 4 — `effect` survives the WEB `useUIComponent` re-wrap, on BOTH the
 * register and the update path.
 *
 * Plan: `2026-08-20-ui-bridge-action-declaration-shape.md`, Phase 4.
 *
 * `useUIComponent` re-maps every action into a fresh object literal with a
 * CLOSED field list — twice, once for `registerComponent` and once for the
 * `updateComponent` effect — and `core/registry.ts` re-maps them a third and
 * fourth time. A field missing from any one of those four literals is dropped
 * silently: the literal stays assignable, the serializer still runs, the field
 * is simply never there. This is the RUNTIME round-trip that catches it.
 *
 * Every expectation is a hand-written literal.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { UIBridgeRegistry } from '../core/registry';

const registry = new UIBridgeRegistry();

vi.mock('./UIBridgeProvider', () => ({
  useUIBridgeOptional: () => ({ registry }),
}));

// Imported AFTER the mock declaration so the hook picks it up.
const { useUIComponent } = await import('./useUIComponent');

function Harness({ name, deleteEffect }: { name: string; deleteEffect: 'write' | 'destructive' }) {
  useUIComponent({
    id: 'invoice-row',
    name,
    actions: [
      { id: 'click', label: 'Delete', effect: deleteEffect, handler: () => 'deleted' },
      { id: 'preview', label: 'Preview', effect: 'read', handler: () => 'previewed' },
      { id: 'rename', label: 'Rename', handler: () => 'renamed' },
    ],
  });
  return <div />;
}

describe('Phase 4 — web useUIComponent re-wrap', () => {
  it('carries effect through registration AND through the update effect', () => {
    const { rerender } = render(<Harness name="Invoice Row" deleteEffect="destructive" />);

    const afterRegister = registry.getComponent('invoice-row');
    expect(afterRegister?.actions.map((a) => a.id)).toEqual(['click', 'preview', 'rename']);
    expect(afterRegister?.actions[0].effect).toBe('destructive');
    expect(afterRegister?.actions[1].effect).toBe('read');
    expect(afterRegister?.actions[2].effect).toBeUndefined();

    // Changing `name` churns the component key, which drives the in-place
    // `updateComponent` sync — the SECOND closed literal.
    rerender(<Harness name="Invoice Row (renamed)" deleteEffect="write" />);

    const afterUpdate = registry.getComponent('invoice-row');
    expect(afterUpdate?.name).toBe('Invoice Row (renamed)');
    expect(afterUpdate?.actions[0].effect).toBe('write');
    expect(afterUpdate?.actions[1].effect).toBe('read');
    expect(afterUpdate?.actions[2].effect).toBeUndefined();
  });

  it('leaves the handler callable after the re-wrap', async () => {
    render(<Harness name="Invoice Row 2" deleteEffect="destructive" />);
    const action = registry.getComponent('invoice-row')?.actions[0];
    expect(await action?.handler()).toBe('deleted');
  });
});
