/**
 * Registry Snapshot Identity Tests
 *
 * Every snapshot-shaped payload must carry an identity, and it must be the
 * SAME identity regardless of which builder produced it. `createSnapshot`,
 * `createSnapshotAsync` and the relay's hand-built shape all funnel through
 * `runSnapshotEnrichers`, which is where the stamp lives — the same funnel that
 * exists so the canonical enriched fields cannot drift between channels (memory
 * note `proj_issue_snapshot_two_channel_drift.md`). These tests pin that.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { UIBridgeRegistry } from './registry';
import { computeSnapshotIdentity, parseSnapshotId } from './snapshot-signature';
import type { BridgeSnapshot } from './types';

describe('BridgeSnapshot identity', () => {
  let registry: UIBridgeRegistry;
  let container: HTMLDivElement;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  function addButton(id: string, text: string): HTMLButtonElement {
    const el = document.createElement('button');
    el.textContent = text;
    container.appendChild(el);
    registry.registerElement(id, el, { type: 'button' });
    return el;
  }

  it('stamps a spec-v1 id on createSnapshot', () => {
    addButton('btn_save', 'Save');
    const snapshot = registry.createSnapshot();

    expect(snapshot.snapshotId).toMatch(/^ubs1_[0-9a-z]+_[0-9a-f]{16}_[0-9a-f]{16}$/);
    expect(snapshot.signature.count).toBe(snapshot.elements.length);
    expect(parseSnapshotId(snapshot.snapshotId)).toEqual(snapshot.signature);
  });

  it('stamps the fold OVER ITS OWN elements array', () => {
    addButton('a', 'A');
    addButton('b', 'B');
    const snapshot = registry.createSnapshot();
    // The id must be derivable from what the caller received. If it were
    // computed from anything else, a consumer could not verify it.
    expect(snapshot.snapshotId).toBe(computeSnapshotIdentity(snapshot.elements).snapshotId);
  });

  it('stamps createSnapshotAsync identically', async () => {
    addButton('a', 'A');
    addButton('b', 'B');
    const sync = registry.createSnapshot();
    const async = await registry.createSnapshotAsync(1);
    expect(async.snapshotId).toBe(sync.snapshotId);
  });

  it('gives an empty registry the fold over zero elements', () => {
    const snapshot = registry.createSnapshot();
    expect(snapshot.signature).toEqual({
      count: 0,
      content: 'cbf29ce484222325',
      generation: 'cbf29ce484222325',
    });
  });

  it('stamps a relay-built snapshot shape through runSnapshotEnrichers', () => {
    // The relay (`react/commandHandlers.ts getControlSnapshot`) builds its own
    // richer shape and then calls the enricher funnel. It must come out with an
    // identity too, or the two channels disagree about what a snapshot is.
    addButton('btn_save', 'Save');
    const canonical = registry.createSnapshot();
    const relayShape = {
      timestamp: Date.now(),
      snapshotTakenAtMs: Date.now(),
      registration: canonical.registration,
      elements: canonical.elements,
      components: [],
      workflows: [],
      activeRuns: [],
    } as unknown as BridgeSnapshot;

    registry.runSnapshotEnrichers(relayShape);
    expect(relayShape.snapshotId).toBe(canonical.snapshotId);
  });

  it('records the most recent stamped identity', () => {
    expect(registry.getLastSnapshotIdentity()).toBeNull();
    const first = registry.createSnapshot();
    expect(registry.getLastSnapshotIdentity()?.snapshotId).toBe(first.snapshotId);

    addButton('later', 'Later');
    const second = registry.createSnapshot();
    expect(second.snapshotId).not.toBe(first.snapshotId);
    expect(registry.getLastSnapshotIdentity()?.snapshotId).toBe(second.snapshotId);
  });

  it('clear() drops the stamped identity back to UNKNOWN', () => {
    addButton('btn', 'Go');
    registry.createSnapshot();
    expect(registry.getLastSnapshotIdentity()).not.toBeNull();
    registry.clear();
    // Not "an empty snapshot's identity" — no snapshot has been taken of the
    // cleared registry, and the action path must not read absence as freshness.
    expect(registry.getLastSnapshotIdentity()).toBeNull();
  });

  it('moves the id when an element is added', () => {
    addButton('a', 'A');
    const before = registry.createSnapshot().snapshotId;
    addButton('b', 'B');
    const after = registry.createSnapshot().snapshotId;
    expect(after).not.toBe(before);
    expect(parseSnapshotId(after)!.count).toBe(parseSnapshotId(before)!.count + 1);
  });

  it('keeps content and moves generation across a remount', () => {
    // The case the whole plan turns on: same element id, same visible content,
    // different mount. `registeredAt` is millisecond-resolution, so the test
    // sets it explicitly rather than racing the clock — see the residual
    // documented in `snapshot-signature.ts`.
    addButton('btn_save', 'Save');
    const before = registry.createSnapshot();

    registry.unregisterElement('btn_save');
    container.innerHTML = '';
    addButton('btn_save', 'Save');
    registry.getElement('btn_save')!.registeredAt = Date.now() + 10_000;

    const after = registry.createSnapshot();
    expect(after.signature.count).toBe(before.signature.count);
    expect(after.signature.content).toBe(before.signature.content);
    expect(after.signature.generation).not.toBe(before.signature.generation);
    expect(after.snapshotId).not.toBe(before.snapshotId);
  });

  it('computeLiveMountFold reproduces the stamped generation when nothing moved', () => {
    addButton('a', 'A');
    addButton('b', 'B');
    const snapshot = registry.createSnapshot();
    const live = registry.computeLiveMountFold();
    // The cheap arm the action path uses must agree with the stamped snapshot,
    // or every opt-in freshness check is a false rejection.
    expect(live.count).toBe(snapshot.signature.count);
    expect(live.generation).toBe(snapshot.signature.generation);
  });

  it('computeLiveMountFold moves when an element remounts', () => {
    addButton('btn', 'Go');
    const snapshot = registry.createSnapshot();
    registry.getElement('btn')!.registeredAt = Date.now() + 10_000;
    expect(registry.computeLiveMountFold().generation).not.toBe(snapshot.signature.generation);
  });
});
