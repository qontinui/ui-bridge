/**
 * Phase 5 — end-to-end effect verification through `executeComponentAction`.
 *
 * Plan: `2026-09-04-effect-calculus-joins-the-component-action-registry`,
 * Phase 5.
 *
 * `ComponentActionResponse` had no verification field at all before this, so
 * the component surface was outside the calculus no matter what an author
 * declared. These tests drive the real executor and assert on what comes back
 * and what lands in the effect store.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UIBridgeRegistry } from '../core/registry';
import { DefaultActionExecutor } from './action-executor';
import {
  createDefaultSignatureRegistry,
  createInferredSignatureRegistry,
} from './effect-signatures';
import {
  getGlobalActionWindowRegistry,
  resetGlobalActionWindowRegistry,
} from './action-window-registry';
import { resetGlobalEffectStore, getGlobalEffectStore } from './effect-store';
import type { EffectSignature, PredictedDelta } from './effect-types';
import type { InferredSignatureEntry, InferredSignatureTable } from './effect-inference';

describe('Phase 5 — component-action effect verification', () => {
  let registry: UIBridgeRegistry;
  let container: HTMLDivElement;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    container = document.createElement('div');
    document.body.appendChild(container);
    resetGlobalActionWindowRegistry();
    resetGlobalEffectStore();
  });

  afterEach(() => {
    document.body.removeChild(container);
    resetGlobalActionWindowRegistry();
    resetGlobalEffectStore();
  });

  /** A handler that makes `revealId` appear and registers it. */
  function reveal(revealId: string): () => string {
    return () => {
      const el = document.createElement('div');
      el.setAttribute('data-testid', revealId);
      container.appendChild(el);
      registry.registerElement(revealId, el, { type: 'menu', label: revealId });
      return 'done';
    };
  }

  function appearSignature(id: string, overrides: Partial<EffectSignature> = {}): EffectSignature {
    return {
      predicts: (): PredictedDelta => ({ elementsAppear: [{ id }] }),
      scope: { elementIds: [id] },
      reversibility: 'reversible',
      settleMs: 0,
      ...overrides,
    };
  }

  it('no signature, flag off — no verification, behaviour unchanged', async () => {
    const executor = new DefaultActionExecutor(registry);
    registry.registerComponent('drawer', {
      name: 'Drawer',
      actions: [{ id: 'open', handler: reveal('panel-none') }],
    });

    const res = await executor.executeComponentAction('drawer', { action: 'open' });

    expect(res.success).toBe(true);
    expect(res.result).toBe('done');
    expect(res.effectVerification).toBeUndefined();
    expect(getGlobalEffectStore().size).toBe(0);
  });

  it('a DECLARED signature verifies with no server-wide switch flipped', async () => {
    // [policy: capability-ships-enabled] — a prediction nobody verifies is not
    // a prediction. Declaring one is itself the opt-in.
    const executor = new DefaultActionExecutor(registry);
    registry.registerComponent('drawer', {
      name: 'Drawer',
      actions: [
        {
          id: 'open',
          effect: 'write',
          signature: appearSignature('panel-declared'),
          handler: reveal('panel-declared'),
        },
      ],
    });

    const res = await executor.executeComponentAction('drawer', { action: 'open' });

    expect(res.success).toBe(true);
    expect(res.effectVerification).toBeDefined();
    expect(res.effectVerification?.outcome).toBe('Confirmed');
  });

  it('verifyEffect: false declines the cost even for a declared signature', async () => {
    const executor = new DefaultActionExecutor(registry);
    registry.registerComponent('drawer', {
      name: 'Drawer',
      actions: [
        {
          id: 'open',
          signature: appearSignature('panel-declined'),
          handler: reveal('panel-declined'),
        },
      ],
    });

    const res = await executor.executeComponentAction('drawer', {
      action: 'open',
      verifyEffect: false,
    });

    expect(res.success).toBe(true);
    expect(res.effectVerification).toBeUndefined();
  });

  it('a wrong prediction is DATA, not a failure — the action still succeeds', async () => {
    const executor = new DefaultActionExecutor(registry);
    registry.registerComponent('drawer', {
      name: 'Drawer',
      actions: [
        {
          id: 'open',
          // Predicts an element that never appears.
          signature: appearSignature('never-appears'),
          handler: reveal('panel-other'),
        },
      ],
    });

    const res = await executor.executeComponentAction('drawer', { action: 'open' });

    expect(res.success).toBe(true);
    expect(res.result).toBe('done');
    expect(res.effectVerification?.outcome).not.toBe('Confirmed');
  });

  it('the record carries componentId and the coarse effect, and no elementId', async () => {
    const executor = new DefaultActionExecutor(registry);
    registry.registerComponent('invoice-row', {
      name: 'Invoice Row',
      actions: [
        {
          id: 'delete',
          effect: 'destructive',
          signature: appearSignature('deleted-toast'),
          handler: reveal('deleted-toast'),
        },
      ],
    });

    await executor.executeComponentAction('invoice-row', {
      action: 'delete',
      requestId: 'req-7',
    });

    const [record] = getGlobalEffectStore().getRecent();
    expect(record.componentId).toBe('invoice-row');
    expect(record.elementId).toBeUndefined();
    expect(record.action).toBe('delete');
    expect(record.effect).toBe('destructive');
    expect(record.requestId).toBe('req-7');
    expect(record.disagreement).toBeUndefined();
  });

  it('an UNANNOTATED action records effect as undefined — never verb-mapped', async () => {
    const executor = new DefaultActionExecutor(registry);
    registry.registerComponent('drawer', {
      name: 'Drawer',
      // `click` IS one of the standard verbs the verb map knows. The record
      // must still say `undefined`: "nobody classified this" is load-bearing.
      actions: [
        { id: 'click', signature: appearSignature('panel-unannotated'), handler: reveal('panel-unannotated') },
      ],
    });

    await executor.executeComponentAction('drawer', { action: 'click' });

    const [record] = getGlobalEffectStore().getRecent();
    expect(record.effect).toBeUndefined();
  });

  it('the executor-wide switch drives the component path too, via the inferred arm', async () => {
    const table = inferredTableFor('open', 'drawer', 'Panel');
    const executor = new DefaultActionExecutor(registry, undefined, {
      enableEffectVerification: true,
      signatureRegistry: createInferredSignatureRegistry(table, createDefaultSignatureRegistry()),
    });
    registry.registerComponent('drawer', {
      name: 'Drawer',
      // No declared signature at all — the inferred arm is the only one.
      actions: [{ id: 'open', handler: reveal('panel-inferred') }],
    });

    const res = await executor.executeComponentAction('drawer', { action: 'open' });

    expect(res.effectVerification).toBeDefined();
    const [record] = getGlobalEffectStore().getRecent();
    expect(record.verification.predicted).toEqual({
      elementsAppear: [{ textContains: 'Panel' }],
    });
  });

  it('records a DISAGREEMENT when both arms resolve and predict differently', async () => {
    const table = inferredTableFor('open', 'drawer', 'Something Else');
    const executor = new DefaultActionExecutor(registry, undefined, {
      signatureRegistry: createInferredSignatureRegistry(
        table,
        createDefaultSignatureRegistry({
          declaredComponentSignature: (c, a) =>
            c === 'drawer' && a === 'open' ? appearSignature('panel-disagree') : undefined,
        })
      ),
    });
    registry.registerComponent('drawer', {
      name: 'Drawer',
      actions: [
        {
          id: 'open',
          signature: appearSignature('panel-disagree'),
          handler: reveal('panel-disagree'),
        },
      ],
    });

    const res = await executor.executeComponentAction('drawer', { action: 'open' });

    // A disagreement is SIGNAL — it never sinks the action that produced it.
    expect(res.success).toBe(true);

    const [record] = getGlobalEffectStore().getRecent();
    expect(record.disagreement).toBeDefined();
    expect(record.disagreement?.declared.provenance).toBe('declared');
    expect(record.disagreement?.declared.id).toBe('drawer.open');
    expect(record.disagreement?.inferred.provenance).toBe('inferred');
    expect(record.disagreement?.inferred.id).toBe('open drawer');
    expect(record.disagreement?.messages.some((m) => m.includes('elementsAppear differs'))).toBe(
      true
    );
    // The DECLARED arm is the one that was verified against.
    expect(record.verification.predicted).toEqual({
      elementsAppear: [{ id: 'panel-disagree' }],
    });
  });

  it('no disagreement when the two arms agree', async () => {
    // Both arms predict the same appearance, so there is nothing to report.
    const sameSig = (): EffectSignature => ({
      predicts: (): PredictedDelta => ({ elementsAppear: [{ textContains: 'Panel' }] }),
      scope: {},
      reversibility: 'reversible',
      settleMs: 0,
    });
    const table = inferredTableFor('open', 'drawer', 'Panel');
    const executor = new DefaultActionExecutor(registry, undefined, {
      signatureRegistry: createInferredSignatureRegistry(
        table,
        createDefaultSignatureRegistry({ declaredComponentSignature: () => sameSig() })
      ),
    });
    registry.registerComponent('drawer', {
      name: 'Drawer',
      actions: [{ id: 'open', signature: sameSig(), handler: reveal('panel-agree') }],
    });

    await executor.executeComponentAction('drawer', { action: 'open' });

    const [record] = getGlobalEffectStore().getRecent();
    expect(record.disagreement).toBeUndefined();
  });

  it('an unknown component still fails cleanly with no verification', async () => {
    const executor = new DefaultActionExecutor(registry, undefined, {
      enableEffectVerification: true,
    });
    const res = await executor.executeComponentAction('nope', { action: 'open' });
    expect(res.success).toBe(false);
    expect(res.effectVerification).toBeUndefined();
  });

  it('closes the settle window even when the handler throws', async () => {
    const executor = new DefaultActionExecutor(registry);
    registry.registerComponent('drawer', {
      name: 'Drawer',
      actions: [
        {
          id: 'open',
          signature: appearSignature('panel-throws'),
          handler: () => {
            throw new Error('boom');
          },
        },
      ],
    });

    const res = await executor.executeComponentAction('drawer', {
      action: 'open',
      requestId: 'req-throw',
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain('boom');
    expect(getGlobalActionWindowRegistry().hadConcurrentObservation('req-throw')).toBe(false);
  });
});

/**
 * A hand-built inference table with one entry keyed `(action, componentId)` —
 * the shape the component arm probes first.
 */
function inferredTableFor(
  action: string,
  componentId: string,
  appearText: string
): InferredSignatureTable {
  const keyFor = (a: string, t: string | null): string => `${a} ${t ?? 'null'}`;
  const e: InferredSignatureEntry = {
    action,
    targetFingerprint: componentId,
    support: 4,
    facts: [{ criteria: { textContains: appearText }, confidence: 0.9, kind: 'appear' }],
  };
  return { bySignatureKey: new Map([[keyFor(action, componentId), e]]), keyFor };
}
