/**
 * Regression: the stale-snapshot gate must exist on the INJECTED/RELAY path.
 *
 * `executeCommand('executeElementAction', …)` is a wholly separate DOM
 * implementation from `DefaultActionExecutor.executeAction` — it resolves the
 * element and dispatches the events itself and never calls the executor. That
 * is the path qontinui-web and every CDP-driven page take.
 *
 * So a guarantee added to the executor is, by default, absent here. The
 * snapshot-freshness precondition shipped exactly that way: an opt-in caller
 * reaching the SDK through the relay got no check at all and a `success: true`
 * that looked identical to a verified one. These tests pin the gate onto this
 * transport, and pin it to the SAME shared evaluator the executor uses — two
 * implementations of "is this snapshot current?" would drift, and a driver
 * cannot pattern-match a failure whose behaviour depends on which transport it
 * happened to reach.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { executeCommand, type BridgeAccess } from './commandHandlers';
import { getGlobalRegistry } from '../core/registry';
import { computeSnapshotIdentity } from '../core/snapshot-signature';
import type { ControlActionResponse } from '../control/types';

const emptyBridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
};

describe('relay executeElementAction — stale-snapshot precondition', () => {
  let host: HTMLButtonElement;

  beforeEach(() => {
    host = makeButton('Save');
  });

  afterEach(() => {
    document.body.innerHTML = '';
    getGlobalRegistry().clear();
  });

  function makeButton(text: string): HTMLButtonElement {
    const el = document.createElement('button');
    el.textContent = text;
    // jsdom has no layout, so `offsetParent` is null for everything and the
    // relay's own visibility gate would reject the element first.
    Object.defineProperty(el, 'offsetParent', {
      configurable: true,
      get: () => document.body,
    });
    document.body.appendChild(el);
    return el;
  }

  async function act(request: Record<string, unknown>): Promise<ControlActionResponse> {
    return (await executeCommand(
      'executeElementAction',
      { id: 'btn', request },
      emptyBridge
    )) as unknown as ControlActionResponse;
  }

  it('refuses a same-shape remount BEFORE dispatching anything', async () => {
    const registry = getGlobalRegistry();
    registry.registerElement('btn', host, { type: 'button' });
    const snapshot = registry.createSnapshot();

    let clicks = 0;
    registry.unregisterElement('btn');
    host.remove();
    const replacement = makeButton('Save');
    replacement.addEventListener('click', () => {
      clicks++;
    });
    registry.registerElement('btn', replacement, { type: 'button' });
    registry.getElement('btn')!.registeredAt += 10_000;

    const result = await act({ action: 'click', fromSnapshotId: snapshot.snapshotId });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/superseded/i);
    expect(result.failureDetails?.staleReason).toBe('snapshot-superseded');
    expect(result.snapshotFreshness?.verdict).toBe('superseded');
    expect(result.snapshotFreshness?.supersededBy).toBe('remount');
    // The whole value of a precondition: nothing was dispatched.
    expect(clicks).toBe(0);
    // Re-finding the same id would succeed and click the wrong thing, so the
    // re-snapshot recovery has to lead.
    expect(result.failureDetails!.suggestedActions[0].suggestion).toMatch(/fresh snapshot/i);
  });

  it('allows and reports `fresh` when the cited snapshot is current', async () => {
    const registry = getGlobalRegistry();
    registry.registerElement('btn', host, { type: 'button' });
    const snapshot = registry.createSnapshot();

    let clicks = 0;
    host.addEventListener('click', () => {
      clicks++;
    });

    const result = await act({ action: 'click', fromSnapshotId: snapshot.snapshotId });

    expect(result.success).toBe(true);
    expect(clicks).toBe(1);
    expect(result.snapshotFreshness?.verdict).toBe('fresh');
  });

  it('reports "cannot judge" — not fresh — for a citation with no mount evidence', async () => {
    const registry = getGlobalRegistry();
    registry.registerElement('btn', host, { type: 'button' });
    // The id an older build would have minted: same ids, same content, no
    // `registeredAt` anywhere, so its generation could never move on a remount.
    const citedId = computeSnapshotIdentity([
      { id: 'btn', category: registry.getElement('btn')!.category, state: { textContent: 'Save' } },
    ]).snapshotId;

    const result = await act({ action: 'click', fromSnapshotId: citedId });

    expect(result.success).toBe(true);
    expect(result.snapshotFreshness?.verdict).toBe('indeterminate');
    expect(result.snapshotFreshness?.blindTo).toContain('cited-snapshot-has-no-mount-evidence');
  });

  it('omitting fromSnapshotId leaves the relay response shape untouched', async () => {
    getGlobalRegistry().registerElement('btn', host, { type: 'button' });
    const result = await act({ action: 'click' });
    expect(result.success).toBe(true);
    expect(result.snapshotFreshness).toBeUndefined();
  });
});
