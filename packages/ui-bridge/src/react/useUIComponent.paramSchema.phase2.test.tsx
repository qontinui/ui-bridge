/**
 * Phase 2 — `paramSchema` survives the WEB `useUIComponent` re-wrap, on BOTH
 * the register and the update path.
 *
 * Plan: `2026-08-20-ui-bridge-action-declaration-shape.md`, Phase 2.
 *
 * `useUIComponent` re-maps every action into a fresh object literal with a
 * CLOSED field list — twice, once for `registerComponent` and once for the
 * `updateComponent` effect — and `core/registry.ts` re-maps them a third and
 * fourth time. A field missing from any one of those literals is dropped
 * silently: the literal stays assignable, the serializer still runs, the field
 * is simply never there. This is the RUNTIME round-trip that catches it; a
 * type-check cannot.
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

const SCHEMA = {
  type: 'object',
  properties: { username: { type: 'string' }, remember: { type: 'boolean' } },
  required: ['username'],
  additionalProperties: false,
};

function Harness({ name }: { name: string }): React.ReactElement {
  useUIComponent({
    id: 'login-form',
    name,
    actions: [
      { id: 'submit', label: 'Submit', paramSchema: SCHEMA, handler: () => 'ok' },
      { id: 'clear', handler: () => 'cleared' },
    ],
  });
  return <div />;
}

describe('Phase 2 — web useUIComponent re-wrap', () => {
  it('carries paramSchema through registration AND through the update effect', () => {
    const { rerender } = render(<Harness name="Login Form" />);

    const afterRegister = registry.getComponent('login-form');
    expect(afterRegister?.actions.map((a) => a.id)).toEqual(['submit', 'clear']);
    expect(afterRegister?.actions[0].paramSchema).toEqual({
      type: 'object',
      properties: { username: { type: 'string' }, remember: { type: 'boolean' } },
      required: ['username'],
      additionalProperties: false,
    });
    expect(afterRegister?.actions[1].paramSchema).toBeUndefined();

    // Changing `name` re-keys the component and drives the update effect,
    // which re-wraps every action a SECOND time through a different literal.
    rerender(<Harness name="Sign-in Form" />);

    const afterUpdate = registry.getComponent('login-form');
    expect(afterUpdate?.name).toBe('Sign-in Form');
    expect(afterUpdate?.actions[0].paramSchema).toEqual({
      type: 'object',
      properties: { username: { type: 'string' }, remember: { type: 'boolean' } },
      required: ['username'],
      additionalProperties: false,
    });
  });
});
