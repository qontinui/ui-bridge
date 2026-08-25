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
import { computeSnapshotIdentity } from '../core/snapshot-signature';

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

  /**
   * A well-formed snapshot id minted somewhere OTHER than this registry — the
   * content-addressed id is process-independent by design, so this is a legal
   * citation. `content` is arbitrary (this registry never stamped one to
   * compare against); `count`, `generation` and the mount-evidence count are
   * taken from the live fold so the remount arm has something real to judge.
   */
  function foreignIdFor(live: {
    count: number;
    generation: string;
    mountEvidence: number;
  }): string {
    return [
      'ubs2',
      live.count.toString(36),
      live.mountEvidence.toString(36),
      '0123456789abcdef',
      live.generation,
    ].join('_');
  }

  it('omitting fromSnapshotId preserves current behaviour exactly', async () => {
    addButton('btn');
    const snapshot = registry.createSnapshot();
    remount('btn');

    // The world moved, but the caller did not opt in — the action runs.
    const result = await executor.executeAction('btn', { action: 'click' });
    expect(result.success).toBe(true);
    expect(result.failureDetails).toBeUndefined();
    // No opt-in, no verdict — the response shape is byte-identical to pre-plan.
    expect(result.snapshotFreshness).toBeUndefined();
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
    // Checked AND current — the only verdict that is an actual guarantee.
    expect(result.snapshotFreshness?.verdict).toBe('fresh');
    expect(result.snapshotFreshness?.blindTo).toBeUndefined();
    expect(result.snapshotFreshness?.citedSnapshotId).toBe(snapshot.snapshotId);
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
    expect(result.snapshotFreshness?.verdict).toBe('superseded');
    expect(result.snapshotFreshness?.supersededBy).toBe('remount');
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
    // But it must not read as a PASS either. Fail-open, not fail-open-silently.
    expect(result.snapshotFreshness?.verdict).toBe('indeterminate');
    expect(result.snapshotFreshness?.blindTo).toEqual(['unparseable-snapshot-id']);
    expect(result.snapshotFreshness?.detail).toMatch(/NOT verified/);
  });

  it('does not reject when this registry has never stamped a snapshot', async () => {
    addButton('btn');
    // A content-addressed id can legitimately come from another process. With
    // no stamped identity here, the content arm has nothing to say — but the
    // live mount fold still does, so cite an id that matches it.
    const live = registry.computeLiveMountFold();
    const foreignId = foreignIdFor(live);

    const result = await executor.executeAction('btn', {
      action: 'click',
      fromSnapshotId: foreignId,
    });
    expect(registry.getLastSnapshotIdentity()).toBeNull();
    expect(result.success).toBe(true);
    // Not approved — the content arm had nothing to say, and that is reported
    // rather than swallowed.
    expect(result.snapshotFreshness?.verdict).toBe('indeterminate');
    expect(result.snapshotFreshness?.blindTo).toContain('no-stamped-snapshot');
  });

  it('still catches a remount against a foreign, never-stamped snapshot id', async () => {
    addButton('btn');
    const live = registry.computeLiveMountFold();
    const foreignId = foreignIdFor(live);
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

/**
 * "Cannot judge" is not "fresh".
 *
 * Even with both find/discover producers emitting `registeredAt`, a driver can
 * still be holding an id minted somewhere that did not — an older deployed
 * build, most obviously. Its `generation` was folded over ids alone, so it
 * could never have moved on a remount. Comparing it is not a weaker check, it
 * is a meaningless one: equal proves nothing, and unequal would accuse a
 * current snapshot of a remount it did not have.
 *
 * The gate must therefore refuse to draw a conclusion, execute the action
 * anyway (fail-open on unknown is the right direction — the caller asked for a
 * check, not for a ban), and SAY that it could not judge. Silence here is the
 * defect: a `success: true` with no comment is indistinguishable from a
 * verified pass, and it ships with a guarantee attached.
 */
describe('DefaultActionExecutor — the freshness gate reports what it could not judge', () => {
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
   * The id an OLDER build would have minted for this exact UI: same ids, same
   * content, and no `registeredAt` on any element because its serializer never
   * emitted one. `mountEvidence` therefore comes out zero, and the id carries
   * that fact across the wire.
   */
  function evidenceFreeIdForLiveElements(): string {
    const elements = registry.getAllElements().map((e) => ({
      id: e.id,
      category: e.category,
      state: e.getState(),
    }));
    return computeSnapshotIdentity(elements).snapshotId;
  }

  it('does NOT approve a same-shape remount when the cited payload had no registeredAt', async () => {
    // THE regression. Before `mountEvidence`, this returned `success: true`
    // with nothing to indicate the remount arm had been blind — the caller
    // read that as "checked, and current".
    const el = addButton('btn');
    const citedId = evidenceFreeIdForLiveElements();
    expect(registry.getLastSnapshotIdentity()).toBeNull();

    // Same id, same rendered text, a new mount.
    registry.unregisterElement('btn');
    el.remove();
    const previous = Date.now();
    addButton('btn');
    registry.getElement('btn')!.registeredAt = previous + 10_000;

    const result = await executor.executeAction('btn', {
      action: 'click',
      fromSnapshotId: citedId,
    });

    // Fail-OPEN: the action still runs. Refusing on "cannot judge" would fail
    // closed on the wrong axis.
    expect(result.success).toBe(true);
    // But NOT approved. This is the assertion the defect was about.
    expect(result.snapshotFreshness?.verdict).not.toBe('fresh');
    expect(result.snapshotFreshness?.verdict).toBe('indeterminate');
    expect(result.snapshotFreshness?.blindTo).toContain('cited-snapshot-has-no-mount-evidence');
    expect(result.snapshotFreshness?.detail).toMatch(/cannot judge/i);
  });

  it('does not spuriously REFUSE an evidence-free citation either', async () => {
    // The mirror-image failure. An ids-only generation will never match a
    // generation that folded registration times, so a gate comparing them
    // regardless would refuse a perfectly current snapshot. Nothing here has
    // moved, and it must still not be called superseded.
    addButton('btn');
    const citedId = evidenceFreeIdForLiveElements();

    const result = await executor.executeAction('btn', {
      action: 'click',
      fromSnapshotId: citedId,
    });

    expect(result.success).toBe(true);
    expect(result.snapshotFreshness?.verdict).toBe('indeterminate');
    expect(result.snapshotFreshness?.supersededBy).toBeUndefined();
  });

  it('still catches an element-set change through an evidence-free citation', async () => {
    // Blind on ONE arm is not blind on all of them: `count` is still folded,
    // so element-set churn is still provable and still refused.
    addButton('btn');
    const citedId = evidenceFreeIdForLiveElements();
    addButton('btn2', 'Cancel');

    const result = await executor.executeAction('btn', {
      action: 'click',
      fromSnapshotId: citedId,
    });

    expect(result.success).toBe(false);
    expect(result.snapshotFreshness?.verdict).toBe('superseded');
    expect(result.snapshotFreshness?.supersededBy).toBe('element-set');
  });

  it('reports an empty registry as "cannot judge", not as unchanged', async () => {
    // Zero elements on both sides folds to the bare offset basis, which
    // compares equal to itself forever. There is no world to compare.
    const citedId = computeSnapshotIdentity([]).snapshotId;
    addButton('btn');
    registry.unregisterElement('btn');

    const result = await executor.executeAction('btn', {
      action: 'click',
      fromSnapshotId: citedId,
    });

    expect(result.snapshotFreshness?.verdict).toBe('indeterminate');
    expect(result.snapshotFreshness?.blindTo).toContain('empty-element-set');
  });

  it('names every blind arm, not just the first', async () => {
    const citedId = computeSnapshotIdentity([]).snapshotId;
    addButton('btn');
    registry.unregisterElement('btn');

    const result = await executor.executeAction('btn', {
      action: 'click',
      fromSnapshotId: citedId,
    });

    // Both the mount arm and the content arm were mute here; a caller
    // diagnosing "why did nothing check my snapshot?" needs both.
    expect(result.snapshotFreshness?.blindTo).toEqual(['empty-element-set', 'no-stamped-snapshot']);
  });

  it('reports `fresh` ONLY when every arm actually ran', async () => {
    addButton('btn');
    const snapshot = registry.createSnapshot();
    expect(snapshot.signature.mountEvidence).toBeGreaterThan(0);

    const result = await executor.executeAction('btn', {
      action: 'click',
      fromSnapshotId: snapshot.snapshotId,
    });

    expect(result.snapshotFreshness?.verdict).toBe('fresh');
    expect(result.snapshotFreshness?.blindTo).toBeUndefined();
    expect(result.snapshotFreshness?.currentSnapshotId).toBe(snapshot.snapshotId);
  });
});
