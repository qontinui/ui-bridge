/**
 * The registry's own `data-ui-bridge-id` stamp is bookkeeping, not a page
 * change. `registerElement` writes it on every registration that carries no
 * stamp, so the relay's change buffer must not record it, and `waitForChange`
 * must not wake on it.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { executeCommand, type BridgeAccess } from './commandHandlers';
import { UIBridgeRegistry } from '../core/registry';

const emptyBridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
};

/** One macrotask: MutationObserver callbacks are delivered before it ends. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(async () => {
  await executeCommand('disableChangeBuffer', {}, emptyBridge);
  await executeCommand('drainChangeBuffer', {}, emptyBridge);
  document.body.innerHTML = '';
});

describe('relay: the registry stamp is not a page change', () => {
  it('the change buffer records an attribute change but not the stamp registerElement writes', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    await executeCommand('enableChangeBuffer', {}, emptyBridge);
    await flush();
    await executeCommand('drainChangeBuffer', {}, emptyBridge);

    new UIBridgeRegistry().registerElement('stamped-node', el, { type: 'generic' });
    expect(el.getAttribute('data-ui-bridge-id')).toBe('stamped-node');
    el.setAttribute('data-state', 'open');
    await flush();

    const drained = (await executeCommand('drainChangeBuffer', {}, emptyBridge)) as {
      changes: Array<{ detail: { attributeName: string | null } }>;
    };
    expect(drained.changes.map((c) => c.detail.attributeName)).toEqual(['data-state']);
  });

  it('waitForChange does not wake on the stamp alone', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const wait = executeCommand('waitForChange', { timeout: 50 }, emptyBridge);
    // Let the command attach its observer before the registration stamps.
    await flush();

    new UIBridgeRegistry().registerElement('stamped-node', el, { type: 'generic' });
    expect(el.getAttribute('data-ui-bridge-id')).toBe('stamped-node');

    await expect(wait).resolves.toMatchObject({ changed: false, timedOut: true });
  });

  it('waitForChange still wakes on a real attribute change', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const wait = executeCommand('waitForChange', { timeout: 1000 }, emptyBridge);
    await flush();

    el.setAttribute('data-state', 'open');

    await expect(wait).resolves.toMatchObject({ changed: true });
  });
});
