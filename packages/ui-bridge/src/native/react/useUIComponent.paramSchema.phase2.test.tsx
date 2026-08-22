/**
 * Phase 2 — `paramSchema` survives the NATIVE `useUIComponent` re-wrap.
 *
 * Plan: `2026-08-20-ui-bridge-action-declaration-shape.md`, Phase 2.
 *
 * `useUIComponent` does not hand the author's action objects to the registry;
 * it re-maps each one into a fresh object literal with a CLOSED field list.
 * Until Phase 2 that list omitted `paramSchema` — and so did
 * `registerComponent`'s literal — so a schema an author declared was dropped
 * twice on its way in, silently. The literal type-checks either way, which is
 * why this is a RUNTIME round-trip and not a type assertion.
 *
 * The registry is injected by mocking the provider hook: the point here is the
 * re-wrap literal, not the provider.
 *
 * Every expectation is a hand-written literal.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { NativeUIBridgeRegistry } from '../core/registry';

const registry = new NativeUIBridgeRegistry();

vi.mock('./UIBridgeNativeProvider', () => ({
  useUIBridgeNativeOptional: () => ({ registry }),
}));

// Imported AFTER the mock declaration so the hook picks it up.
const { useUIComponent } = await import('./useUIComponent');

function Harness(): React.ReactElement {
  useUIComponent({
    id: 'login-form',
    name: 'Login Form',
    actions: [
      {
        id: 'submit',
        label: 'Submit',
        paramSchema: {
          type: 'object',
          properties: { username: { type: 'string' } },
          required: ['username'],
        },
        handler: () => 'ok',
      },
      { id: 'clear', handler: () => 'cleared' },
    ],
  });
  return <div />;
}

describe('Phase 2 — native useUIComponent re-wrap', () => {
  it('carries paramSchema through to the registered component', () => {
    render(<Harness />);

    const stored = registry.getComponent('login-form');
    expect(stored?.actions.map((a) => a.id)).toEqual(['submit', 'clear']);
    expect(stored?.actions[0].paramSchema).toEqual({
      type: 'object',
      properties: { username: { type: 'string' } },
      required: ['username'],
    });
    // An action that declares none still declares none — not `{}`.
    expect(stored?.actions[1].paramSchema).toBeUndefined();
  });
});
