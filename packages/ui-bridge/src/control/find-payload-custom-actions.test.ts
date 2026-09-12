/**
 * Regression: every find/discover producer must advertise an element's
 * CUSTOM actions.
 *
 * A discover consumer decides what a pane can do by reading the payload. If
 * the payload omits the app-defined actions, the consumer concludes the pane
 * supports NOTHING — while the element dispatches all of them happily through
 * `POST /element/<id>/action`. Measured live against a runner consuming
 * `@qontinui/ui-bridge@0.24.0`, on a pane declaring five custom actions:
 *
 * ```text
 * discover    terminal-input-e59699cb…  actions=[]                customActions=null
 * discover    terminal-input-8d706c99…  actions=["focus","blur"]  customActions=null
 * getElement  terminal-input-e59699cb…  customActions=["focus","blur","sendKeys",
 *                                         "writeToTerminal","paste","pasteText",
 *                                         "getScrollback"]
 * ```
 *
 * Both rows are wrong, and they are wrong for the same reason — the field was
 * never emitted. The virtualized row is only the more VISIBLE half: its
 * `actions: []` makes the hole obvious, while the mounted row's
 * `["focus","blur"]` looks like a plausible complete answer and is not. A
 * payload that looks complete is the worse of the two.
 *
 * The SDK has four producers of this shape, and two of them omitted the field:
 *
 * | Producer | Path | Was |
 * |---|---|---|
 * | `serializeRegisteredElement` (`core/registry.ts`) | canonical snapshot | emitted it |
 * | `materializeElements` (`server/handlers.ts`) | server `/control/find` | emitted it |
 * | `DefaultActionExecutor.find()` | in-process SDK consumers | **omitted** |
 * | `elementToFindResult` (`react/commandHandlers.ts`) | injected / CDP relay | **omitted** |
 *
 * These tests assert AGREEMENT, not presence. Asserting only that the field
 * exists would pass on a producer that invented its own convention — merged
 * the custom ids into `actions`, or emitted `[]` where the canonical
 * serializer emits `undefined` — and a consumer diffing two payloads for the
 * same element would still see a difference that isn't there. So every
 * producer's projection is compared against the canonical serializer's for the
 * SAME element, and `actions` is pinned separately to prove nothing was merged
 * into it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  UIBridgeRegistry,
  getGlobalRegistry,
  serializeRegisteredElement,
  type RegisteredElement,
} from '../core/registry';
import { DefaultActionExecutor } from './action-executor';
import { materializeElements } from '../server/handlers';
import { executeCommand, type BridgeAccess } from '../react/commandHandlers';
import type { CustomAction, StandardAction } from '../core/types';
import type { DiscoveredElement, FindResponse } from './types';

/** The five app-defined actions from the live evidence above. */
const CUSTOM_ACTION_IDS = [
  'sendKeys',
  'writeToTerminal',
  'paste',
  'pasteText',
  'getScrollback',
] as const;

function makeCustomActions(): Record<string, CustomAction> {
  const entries: Record<string, CustomAction> = {};
  for (const id of CUSTOM_ACTION_IDS) {
    entries[id] = { id, label: id, handler: () => ({ ok: true }) };
  }
  return entries;
}

/**
 * The projection every producer is supposed to agree on: the two action
 * fields, read off whatever payload shape the producer returned.
 */
function actionProjection(el: Record<string, unknown> | undefined) {
  return {
    actions: el?.actions,
    customActions: el?.customActions,
  };
}

describe('find/discover payloads advertise custom actions', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    getGlobalRegistry().clear();
  });

  function makePane(text: string): HTMLButtonElement {
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

  // ---------------------------------------------------------------------
  // The in-process producer — `DefaultActionExecutor.find()`
  // ---------------------------------------------------------------------
  describe('DefaultActionExecutor.find() — the in-process producer', () => {
    let registry: UIBridgeRegistry;
    let executor: DefaultActionExecutor;

    beforeEach(() => {
      registry = new UIBridgeRegistry();
      executor = new DefaultActionExecutor(registry);
    });

    async function findOne(id: string): Promise<DiscoveredElement | undefined> {
      const response = await executor.find({ includeHidden: true });
      return response.elements.find((e) => e.id === id);
    }

    it('advertises the custom actions of a MOUNTED pane', async () => {
      registry.registerElement('pane-mounted', makePane('Terminal'), {
        type: 'input',
        actions: ['focus', 'blur'] as StandardAction[],
        customActions: makeCustomActions(),
      });

      const element = await findOne('pane-mounted');
      expect(element).toBeDefined();
      // The live defect: this read `null`/absent while the element dispatched
      // all five.
      expect(element!.customActions).toEqual([...CUSTOM_ACTION_IDS]);
    });

    it('advertises the custom actions of a VIRTUALIZED pane (actions: [])', async () => {
      // The `actions=[]` row from the live evidence. `[]` is truthy, so the
      // built-in list is taken as-is rather than inferred — which is correct,
      // and which is exactly why the custom ids are the ONLY thing that can
      // tell a consumer this pane is controllable at all.
      registry.registerElement('pane-virtualized', makePane('Terminal (offscreen)'), {
        type: 'input',
        actions: [] as StandardAction[],
        customActions: makeCustomActions(),
      });

      const element = await findOne('pane-virtualized');
      expect(element).toBeDefined();
      expect(element!.actions).toEqual([]);
      expect(element!.customActions).toEqual([...CUSTOM_ACTION_IDS]);
    });

    it('keeps custom actions SEPARATE — never merged into `actions`', async () => {
      registry.registerElement('pane-mounted', makePane('Terminal'), {
        type: 'input',
        actions: ['focus', 'blur'] as StandardAction[],
        customActions: makeCustomActions(),
      });

      const element = await findOne('pane-mounted');
      // The canonical split `getSnapshot()` was deliberately moved onto the
      // shared serializer to get. A consumer wanting one flat list folds the
      // two itself; one that has been handed a merged list cannot un-merge it.
      expect(element!.actions).toEqual(['focus', 'blur']);
      for (const id of CUSTOM_ACTION_IDS) {
        expect(element!.actions).not.toContain(id);
      }
    });

    it('agrees EXACTLY with serializeRegisteredElement for the same element', async () => {
      registry.registerElement('pane-mounted', makePane('Terminal'), {
        type: 'input',
        actions: ['focus', 'blur'] as StandardAction[],
        customActions: makeCustomActions(),
      });

      const found = await findOne('pane-mounted');
      const canonical = serializeRegisteredElement(
        registry.getElement('pane-mounted') as RegisteredElement
      ) as unknown as Record<string, unknown>;

      // The load-bearing assertion: not "the field is there" but "the two
      // paths say the same thing". A producer that merged the ids into
      // `actions`, or emitted them in a different order, or emitted `[]`
      // instead of `undefined`, fails here.
      expect(actionProjection(found as unknown as Record<string, unknown>)).toEqual(
        actionProjection(canonical)
      );
    });

    it('emits undefined — not [] — for an element with NO custom actions', async () => {
      registry.registerElement('plain', makePane('Plain'), {
        type: 'button',
        actions: ['click'] as StandardAction[],
      });

      const found = await findOne('plain');
      const canonical = serializeRegisteredElement(
        registry.getElement('plain') as RegisteredElement
      ) as unknown as Record<string, unknown>;

      // Matching the serializer's undefined-vs-empty convention is what lets a
      // consumer compare the two payloads at all. `[]` here would read as
      // "asked and there are none" on one path and "never asked" on the other.
      expect(found!.customActions).toBeUndefined();
      expect(canonical.customActions).toBeUndefined();
      expect(actionProjection(found as unknown as Record<string, unknown>)).toEqual(
        actionProjection(canonical)
      );
    });

    it('leaves customActions ABSENT for an unregistered DOM-scanned node', async () => {
      // A DOM-scanned node has no registration, so it has nothing to carry
      // custom actions — same reasoning as `registeredAt`.
      makePane('Unregistered');
      const response = await executor.find({ includeHidden: true });
      const scanned = response.elements.filter((e) => !e.registered);
      expect(scanned.length).toBeGreaterThan(0);
      for (const e of scanned) {
        expect(e.customActions).toBeUndefined();
      }
    });
  });

  // ---------------------------------------------------------------------
  // The injected / relay producer — `elementToFindResult`
  // ---------------------------------------------------------------------
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

    it('advertises custom actions and agrees with serializeRegisteredElement', async () => {
      const registry = getGlobalRegistry();
      registry.registerElement('pane-mounted', makePane('Terminal'), {
        type: 'input',
        actions: ['focus', 'blur'] as StandardAction[],
        customActions: makeCustomActions(),
      });

      const response = await relayFind();
      const element = response.elements.find((e) => e.id === 'pane-mounted');
      expect(element).toBeDefined();
      expect(element!.customActions).toEqual([...CUSTOM_ACTION_IDS]);
      expect(element!.actions).toEqual(['focus', 'blur']);

      const canonical = serializeRegisteredElement(
        registry.getElement('pane-mounted') as RegisteredElement
      ) as unknown as Record<string, unknown>;
      expect(actionProjection(element as unknown as Record<string, unknown>)).toEqual(
        actionProjection(canonical)
      );
    });

    it('emits undefined — not [] — for an element with NO custom actions', async () => {
      const registry = getGlobalRegistry();
      registry.registerElement('plain', makePane('Plain'), {
        type: 'button',
        actions: ['click'] as StandardAction[],
      });

      const response = await relayFind();
      const element = response.elements.find((e) => e.id === 'plain');
      expect(element).toBeDefined();
      expect(element!.customActions).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------
  // All producers, one element, one answer
  // ---------------------------------------------------------------------
  describe('every producer answers identically for the same element', () => {
    it('find(), the relay, materializeElements and the canonical serializer agree', async () => {
      const registry = getGlobalRegistry();
      const executor = new DefaultActionExecutor(registry);
      registry.registerElement('pane-mounted', makePane('Terminal'), {
        type: 'input',
        actions: ['focus', 'blur'] as StandardAction[],
        customActions: makeCustomActions(),
      });
      const registered = registry.getElement('pane-mounted') as RegisteredElement;

      const fromFind = (await executor.find({ includeHidden: true })).elements.find(
        (e) => e.id === 'pane-mounted'
      );

      const fromRelay = (
        (await executeCommand(
          'find',
          { include_hidden: true },
          {
            elements: registry.getAllElements(),
            getElement: () => undefined,
            components: [],
            workflows: [],
          } as BridgeAccess
        )) as unknown as FindResponse
      ).elements.find((e) => e.id === 'pane-mounted');

      const fromMaterialize = materializeElements([registered]).find(
        (e) => e.id === 'pane-mounted'
      );

      const fromCanonical = serializeRegisteredElement(registered);

      const expected = {
        actions: ['focus', 'blur'],
        customActions: [...CUSTOM_ACTION_IDS],
      };

      // Every producer, pinned to the same literal AND to each other. Pinning
      // to each other alone would let all four drift together; pinning to the
      // literal alone would not catch a producer that agrees with the literal
      // in a different field order. Both, so neither escape is open.
      for (const [name, payload] of [
        ['find()', fromFind],
        ['relay', fromRelay],
        ['materializeElements', fromMaterialize],
        ['serializeRegisteredElement', fromCanonical],
      ] as const) {
        expect(
          actionProjection(payload as unknown as Record<string, unknown>),
          `${name} must advertise the same actions as every other producer`
        ).toEqual(expected);
      }
    });
  });
});
