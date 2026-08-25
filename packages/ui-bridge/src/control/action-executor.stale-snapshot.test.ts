/**
 * Action Executor Tests — opt-in stale-snapshot rejection.
 *
 * The pre-existing `UB-STALE-ELEMENT` arms all answer *"this element is gone"*,
 * discovered by failing to resolve anything. This suite is about the different
 * question the plan named: *"your snapshot is old"* — an element that resolves
 * perfectly well, looks identical, and is nonetheless not the node the caller
 * reasoned about.
 *
 * The opt-in boundary is load-bearing. Omitting `fromSnapshotId` must preserve
 * today's behaviour exactly; supplying it buys a hard, cheap-to-recover failure
 * instead of a blind click.
 *
 * `registeredAt` is millisecond-resolution, so these tests set it explicitly
 * rather than racing the clock. That is the documented residual, not a test
 * shortcut: a remount completed inside one millisecond really is invisible to
 * the fold, and pretending otherwise in a test would hide it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UIBridgeRegistry } from '../core/registry';
import { DefaultActionExecutor } from './action-executor';

describe('DefaultActionExecutor — stale-snapshot rejection', () => {
  let registry: UIBridgeRegistry;
  let executor: DefaultActionExecutor;
  let container: HTMLDivElement;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    executor = new DefaultActionExecutor(registry);
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  function addButton(id: string, text = 'Save'): HTMLButtonElement {
    const el = document.createElement('button');
    el.textContent = text;
    container.appendChild(el);
    registry.registerElement(id, el, { type: 'button' });
    return el;
  }

  /**
   * Replace `id`'s registration with a brand-new DOM node showing exactly the
   * same thing, on a later mount. Same count, same content, different
   * generation — `remounted_from` in the runner's vocabulary.
   */
  function remount(id: string, text = 'Save'): HTMLButtonElement {
    const previous = registry.getElement(id)!.registeredAt;
    registry.unregisterElement(id);
    const el = addButton(id, text);
    registry.getElement(id)!.registeredAt = previous + 10_000;
    return el;
  }

  it('omitting fromSnapshotId preserves current behaviour exactly', async () => {
    addButton('btn');
    const snapshot = registry.createSnapshot();
    remount('btn');

    // The world moved, but the caller did not opt in — the action runs.
    const result = await executor.executeAction('btn', { action: 'click' });
    expect(result.success).toBe(true);
    expect(result.failureDetails).toBeUndefined();
    // And the snapshot it would have been judged against really is superseded.
    expect(registry.computeLiveMountFold().generation).not.toBe(snapshot.signature.generation);
  });

  it('accepts an action citing the current snapshot', async () => {
    addButton('btn');
    const snapshot = registry.createSnapshot();

    const result = await executor.executeAction('btn', {
      action: 'click',
      fromSnapshotId: snapshot.snapshotId,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an element that STILL RESOLVES but is a different element', async () => {
    // This is the case the whole plan exists for. The target is live, its id is
    // unchanged, and its rendered content is byte-identical — only the mount
    // moved. Nothing in the pre-plan SDK could refuse this.
    addButton('btn');
    const snapshot = registry.createSnapshot();
    remount('btn');

    // Precondition: the element resolves, and the content fold is unchanged.
    expect(registry.getElement('btn')?.element.isConnected).toBe(true);
    const after = registry.createSnapshot();
    expect(after.signature.content).toBe(snapshot.signature.content);
    expect(after.signature.count).toBe(snapshot.signature.count);
    expect(after.signature.generation).not.toBe(snapshot.signature.generation);

    const result = await executor.executeAction('btn', {
      action: 'click',
      fromSnapshotId: snapshot.snapshotId,
    });

    expect(result.success).toBe(false);
    expect(result.failureDetails?.errorCode).toBe('UB-STALE-ELEMENT');
    expect(result.failureDetails?.staleReason).toBe('snapshot-superseded');
    expect(result.failureDetails?.context?.supersededBy).toBe('remount');
    expect(result.failureDetails?.context?.citedSnapshotId).toBe(snapshot.snapshotId);
  });

  it('names re-snapshot as the recovery, ahead of the catalog re-find advice', async () => {
    addButton('btn');
    const snapshot = registry.createSnapshot();
    remount('btn');

    const result = await executor.executeAction('btn', {
      action: 'click',
      fromSnapshotId: snapshot.snapshotId,
    });

    expect(result.error).toMatch(/fresh snapshot/i);
    const suggestions = result.failureDetails!.suggestedActions;
    // Re-FINDING the same id would succeed here and click the wrong thing, so
    // the re-snapshot suggestion has to come first.
    expect(suggestions[0].suggestion).toMatch(/fresh snapshot/i);
    expect(suggestions[0].retryable).toBe(true);
  });

  it('refuses BEFORE the action runs', async () => {
    const el = addButton('btn');
    let clicks = 0;
    el.addEventListener('click', () => {
      clicks++;
    });
    const snapshot = registry.createSnapshot();
    remount('btn').addEventListener('click', () => {
      clicks++;
    });

    const result = await executor.executeAction('btn', {
      action: 'click',
      fromSnapshotId: snapshot.snapshotId,
    });
    expect(result.success).toBe(false);
    expect(clicks).toBe(0);
    // Refused before resolution, so there is no resolution to report.
    expect(result.elementResolution).toBeUndefined();
  });

  it('rejects when the element set changed', async () => {
    addButton('btn');
    const snapshot = registry.createSnapshot();
    addButton('btn2', 'Cancel');

    const result = await executor.executeAction('btn', {
      action: 'click',
      fromSnapshotId: snapshot.snapshotId,
    });
    expect(result.success).toBe(false);
    expect(result.failureDetails?.context?.supersededBy).toBe('element-set');
  });

  it('rejects when a newer snapshot shows different content', async () => {
    // Same elements, same mounts — but the label changed and a newer snapshot
    // observed it. Caught by the second arm, not the live mount fold.
    const el = addButton('btn', 'Save');
    const snapshot = registry.createSnapshot();
    el.textContent = 'Saving…';
    const newer = registry.createSnapshot();
    expect(newer.signature.generation).toBe(snapshot.signature.generation);
    expect(newer.signature.content).not.toBe(snapshot.signature.content);

    const result = await executor.executeAction('btn', {
      action: 'click',
      fromSnapshotId: snapshot.snapshotId,
    });
    expect(result.success).toBe(false);
    expect(result.failureDetails?.context?.supersededBy).toBe('content');
    expect(result.failureDetails?.context?.currentSnapshotId).toBe(newer.snapshotId);
  });

  it('treats an unparseable snapshot id as unknown, not as stale', async () => {
    addButton('btn');
    registry.createSnapshot();

    const result = await executor.executeAction('btn', {
      action: 'click',
      fromSnapshotId: 'definitely-not-a-snapshot-id',
    });
    // Refusing on "cannot judge" would fail closed on the wrong axis: the
    // caller opted into a freshness check, not into a ban on actions this SDK
    // has no opinion about.
    expect(result.success).toBe(true);
  });

  it('does not reject when this registry has never stamped a snapshot', async () => {
    addButton('btn');
    // A content-addressed id can legitimately come from another process. With
    // no stamped identity here, the content arm has nothing to say — but the
    // live mount fold still does, so cite an id that matches it.
    const live = registry.computeLiveMountFold();
    const foreignId = `ubs1_${live.count.toString(36)}_0123456789abcdef_${live.generation}`;

    const result = await executor.executeAction('btn', {
      action: 'click',
      fromSnapshotId: foreignId,
    });
    expect(registry.getLastSnapshotIdentity()).toBeNull();
    expect(result.success).toBe(true);
  });

  it('still catches a remount against a foreign, never-stamped snapshot id', async () => {
    addButton('btn');
    const live = registry.computeLiveMountFold();
    const foreignId = `ubs1_${live.count.toString(36)}_0123456789abcdef_${live.generation}`;
    remount('btn');

    const result = await executor.executeAction('btn', {
      action: 'click',
      fromSnapshotId: foreignId,
    });
    expect(result.success).toBe(false);
    expect(result.failureDetails?.staleReason).toBe('snapshot-superseded');
    expect(result.failureDetails?.context?.supersededBy).toBe('remount');
  });

  it('keeps the pre-existing element-gone arms untouched', async () => {
    // `unmounted` still means what it always meant — the new discriminator is
    // an addition, not a reinterpretation.
    const el = addButton('btn');
    registry.createSnapshot();
    el.remove();

    const result = await executor.executeAction('btn', { action: 'click' });
    expect(result.success).toBe(false);
    expect(result.failureDetails?.errorCode).toBe('UB-STALE-ELEMENT');
    expect(result.failureDetails?.staleReason).toBe('unmounted');
  });
});
