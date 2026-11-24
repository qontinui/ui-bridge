/**
 * The injected seeder builds no element state — plan
 * `2026-11-23-ui-bridge-element-state-collapse-follow-ups`, review round 5
 * (plan-library follow-up 9f92655c).
 *
 * `seedRegistryFromDom` re-runs on every debounced re-seed and reads only each
 * scanned element's id, label and live ref, so it uses the ref-only scan
 * (`scanDOMForInteractiveElementRefs`). Registration computes an element's
 * state lazily, through `getState`, so seeding a page of buttons must not call
 * the one `ElementState` reader at all. The reader is wrapped in a counting
 * mock that calls through to the real function.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const calls = vi.hoisted(() => ({ getElementState: 0 }));

vi.mock('../core/element-state', async (importOriginal) => {
  const real = await importOriginal<typeof import('../core/element-state')>();
  return {
    ...real,
    getElementState: (...args: Parameters<typeof real.getElementState>) => {
      calls.getElementState++;
      return real.getElementState(...args);
    },
  };
});

const { UIBridgeRegistry } = await import('../core/registry');
const { seedRegistryFromDom } = await import('./seed-registry');

beforeEach(() => {
  // Buttons only: nothing here is a media or content match.
  document.body.innerHTML = `
    <button type="button">Save</button>
    <button type="button" aria-label="Close">x</button>
    <button type="button" data-testid="submit">Submit</button>
  `;
  calls.getElementState = 0;
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('seedRegistryFromDom', () => {
  it('seeding builds no element state for scanned elements', () => {
    const registry = new UIBridgeRegistry();
    const result = seedRegistryFromDom(registry, document.body);

    expect(result.registered).toBe(3);
    expect(calls.getElementState).toBe(0);

    // The reader is really wired through the mock: a state read counts.
    registry.getAllElements()[0].getState();
    expect(calls.getElementState).toBe(1);
  });
});
