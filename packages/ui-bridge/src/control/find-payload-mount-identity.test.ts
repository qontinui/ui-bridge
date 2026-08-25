/**
 * Regression: every find/discover producer must emit the element's MOUNT.
 *
 * `generation` is the half of the snapshot signature that makes a same-shape
 * remount visible, and it is folded from one field: each element's
 * `registeredAt`. Nothing else in a find/discover payload can distinguish
 * "this subtree was rebuilt" from "nothing happened" — the registry preserves
 * element ids across a remount **on purpose**
 * (`preserveIdAcrossRemount` + the recently-removed fingerprint cache), and a
 * component destroyed and recreated in the same state renders byte-identical
 * text.
 *
 * The SDK has three producers of that payload, and two of them omitted
 * `registeredAt` entirely:
 *
 * | Producer | Path | Was |
 * |---|---|---|
 * | `materializeElements` (`server/handlers.ts`) | the runner's own frontend | emitted it |
 * | `DefaultActionExecutor.find()` | in-process SDK consumers | **omitted** |
 * | `elementToFindResult` (`react/commandHandlers.ts`) | injected / CDP relay (qontinui-web) | **omitted** (and `category` too) |
 *
 * So for every consumer except the runner's own frontend the generation fold
 * folded ids alone, a remount left it unchanged, and the freshness story
 * passed an action it should have refused — with a guarantee attached. A
 * spurious pass is worse than the original gap, because it is trusted.
 *
 * These tests assert the payload, not the plumbing: they fold what each
 * producer actually returns and check the remount is visible in it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UIBridgeRegistry, getGlobalRegistry } from '../core/registry';
import { DefaultActionExecutor } from './action-executor';
import { executeCommand, type BridgeAccess } from '../react/commandHandlers';
import {
  computeSnapshotSignature,
  generationComparable,
  snapshotRemountedFrom,
  snapshotUnchangedFrom,
  type SignatureElementLike,
} from '../core/snapshot-signature';
import type { FindResponse } from './types';

/** Fold a producer's payload the way an off-process driver would. */
function fold(elements: unknown[]) {
  return computeSnapshotSignature(elements as SignatureElementLike[]);
}

describe('find/discover payloads carry mount identity', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    getGlobalRegistry().clear();
  });

  function makeButton(text: string): HTMLButtonElement {
    const el = document.createElement('button');
    el.textContent = text;
    // jsdom has no layout, so `offsetParent` is null for everything and the
    // relay's visibility gate would drop the element before it is serialized.
    Object.defineProperty(el, 'offsetParent', {
      configurable: true,
      get: () => document.body,
    });
    container.appendChild(el);
    return el;
  }

  describe('DefaultActionExecutor.find() — the in-process producer', () => {
    let registry: UIBridgeRegistry;
    let executor: DefaultActionExecutor;

    beforeEach(() => {
      registry = new UIBridgeRegistry();
      executor = new DefaultActionExecutor(registry);
    });

    it('emits registeredAt for registered elements', async () => {
      registry.registerElement('btn', makeButton('Save'), { type: 'button' });
      const response = await executor.find({ includeHidden: true });
      const element = response.elements.find((e) => e.id === 'btn');
      expect(element).toBeDefined();
      expect(element!.registeredAt).toBe(registry.getElement('btn')!.registeredAt);
    });

    it('makes a same-shape remount visible in the folded payload', async () => {
      const el = makeButton('Save');
      registry.registerElement('btn', el, { type: 'button' });
      const before = fold((await executor.find({ includeHidden: true })).elements);

      // Destroy and rebuild, rendering exactly the same thing. `registeredAt`
      // is millisecond-resolution, so the new mount time is set explicitly
      // rather than raced — that residual is documented, not worked around.
      registry.unregisterElement('btn');
      el.remove();
      registry.registerElement('btn', makeButton('Save'), { type: 'button' });
      registry.getElement('btn')!.registeredAt += 10_000;

      const after = fold((await executor.find({ includeHidden: true })).elements);

      expect(after.count).toBe(before.count);
      expect(after.content).toBe(before.content);
      expect(after.generation).not.toBe(before.generation);
      expect(after.mountEvidence).toBeGreaterThan(0);
      expect(snapshotRemountedFrom(after, before)).toBe(true);
      expect(snapshotUnchangedFrom(after, before)).toBe(false);
    });

    it('stamps the fold on the response itself, over the array it returned', async () => {
      registry.registerElement('btn', makeButton('Save'), { type: 'button' });
      const response: FindResponse = await executor.find({ includeHidden: true });
      expect(response.signature).toEqual(fold(response.elements));
      expect(response.signature!.mountEvidence).toBe(response.elements.length);
    });

    it('leaves registeredAt ABSENT for an unregistered DOM-scanned node', async () => {
      // Synthesizing "now" would move the generation fold on every single
      // call, turning a blind detector into a lying one. Absent contributes no
      // bytes, by the fold's own spec.
      makeButton('Unregistered');
      const response = await executor.find({ includeHidden: true });
      const scanned = response.elements.filter((e) => !e.registered);
      expect(scanned.length).toBeGreaterThan(0);
      for (const e of scanned) {
        expect(e.registeredAt).toBeUndefined();
      }
    });
  });

  describe('elementToFindResult — the injected / relay producer', () => {
    const bridge: BridgeAccess = {
      elements: [],
      getElement: () => undefined,
      components: [],
      workflows: [],
    };

    async function relayFind(): Promise<FindResponse> {
      const registry = getGlobalRegistry();
      return (await executeCommand(
        'find',
        { include_hidden: true },
        { ...bridge, elements: registry.getAllElements() }
      )) as unknown as FindResponse;
    }

    it('emits registeredAt AND category', async () => {
      const registry = getGlobalRegistry();
      registry.registerElement('btn', makeButton('Save'), { type: 'button' });
      const response = await relayFind();
      const element = response.elements.find((e) => e.id === 'btn');
      expect(element).toBeDefined();
      expect(element!.registeredAt).toBe(registry.getElement('btn')!.registeredAt);
      // `category` is part of the CONTENT half of the same fold — and the
      // discriminator every interactive/content/media filter reads.
      expect(element!.category).toBe(registry.getElement('btn')!.category);
    });

    it('makes a same-shape remount visible in the folded payload', async () => {
      const registry = getGlobalRegistry();
      const el = makeButton('Save');
      registry.registerElement('btn', el, { type: 'button' });
      const before = fold((await relayFind()).elements);

      registry.unregisterElement('btn');
      el.remove();
      registry.registerElement('btn', makeButton('Save'), { type: 'button' });
      registry.getElement('btn')!.registeredAt += 10_000;

      const after = fold((await relayFind()).elements);

      expect(after.content).toBe(before.content);
      expect(after.generation).not.toBe(before.generation);
      expect(snapshotRemountedFrom(after, before)).toBe(true);
    });

    it('stamps the fold on the response itself', async () => {
      getGlobalRegistry().registerElement('btn', makeButton('Save'), { type: 'button' });
      const response = await relayFind();
      expect(response.signature).toEqual(fold(response.elements));
      expect(response.signature!.mountEvidence).toBe(1);
    });
  });

  describe('what the fold reports when the mount is missing', () => {
    it('a payload with no registeredAt cannot see a remount — and SAYS so', async () => {
      // The older-deployed-app shape, reconstructed by hand: same ids, same
      // content, a mount that changed, and no `registeredAt` anywhere. This is
      // what BOTH producers used to emit.
      const before = fold([{ id: 'btn', category: 'interactive', state: { textContent: 'Save' } }]);
      const after = fold([{ id: 'btn', category: 'interactive', state: { textContent: 'Save' } }]);

      // The remount is invisible: the two folds are identical.
      expect(after.generation).toBe(before.generation);
      expect(snapshotUnchangedFrom(after, before)).toBe(true);

      // …which is exactly why `mountEvidence` exists. Zero is the payload
      // admitting the generation half never had standing to testify, so a
      // consumer can tell "nothing remounted" from "I could not have seen it".
      expect(before.mountEvidence).toBe(0);
      expect(after.mountEvidence).toBe(0);
      expect(generationComparable(after, before)).toBe(false);
    });
  });
});
