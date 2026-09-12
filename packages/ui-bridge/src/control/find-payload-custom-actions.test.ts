/**
 * Regression: every find/discover producer must advertise an element's
 * CUSTOM actions, in the CANONICAL SHAPE.
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
 * ---------------------------------------------------------------------------
 * THE SHAPE MOVED UNDERNEATH THIS TEST — and that is what it is for
 * ---------------------------------------------------------------------------
 *
 * The `getElement` row above shows the shape this file was first written
 * against: bare NAMES. On 2026-09-11 plan
 * `2026-09-04-effect-calculus-joins-the-component-action-registry` (Design
 * decision 4 step 3) widened the canonical projection to
 * `SerializedElementAction` OBJECTS — the twin of
 * `qontinui-types::ui_bridge::ElementActionInfo` — so an action's `effect`
 * safety class finally reaches a consumer instead of being discarded with
 * everything but the name.
 *
 * This test caught the divergence the moment the two changes met: it compares
 * each producer against the canonical serializer's own output, so a producer
 * still spelling `Object.keys(...)` fails even though it emits the right ids.
 * That is why the assertions below name `serializeRegisteredElement` rather
 * than re-deriving a projection of their own — a second copy of the projection
 * is exactly the drift this file exists to end.
 *
 * The SDK has four producers of this shape:
 *
 * | Producer | Path |
 * |---|---|
 * | `serializeRegisteredElement` (`core/registry.ts`) | canonical snapshot |
 * | `materializeElements` (`server/handlers.ts`) | server `/control/find` |
 * | `DefaultActionExecutor.find()` | in-process SDK consumers |
 * | `elementToFindResult` (`react/commandHandlers.ts`) | injected / CDP relay |
 *
 * These tests assert AGREEMENT, not presence. Asserting only that the field
 * exists would pass on a producer that invented its own convention — merged
 * the custom ids into `actions`, emitted `[]` where the canonical serializer
 * emits `undefined`, or emitted the ids as bare strings — and a consumer
 * diffing two payloads for the same element would still see a difference that
 * isn't there. So every producer's projection is compared against the
 * canonical serializer's for the SAME element, and `actions` is pinned
 * separately to prove nothing was merged into it.
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
import { SearchEngine } from '../ai/search-engine';
import type { CustomAction, SerializedElementAction, StandardAction } from '../core/types';
import type { DiscoveredElement, FindResponse } from './types';

/** The five app-defined actions from the live evidence above. */
const CUSTOM_ACTION_IDS = [
  'sendKeys',
  'writeToTerminal',
  'paste',
  'pasteText',
  'getScrollback',
] as const;

/**
 * What each of the five DECLARES — deliberately uneven.
 *
 * Every entry differs from its neighbours in which optional fields it carries,
 * because the widened shape admits a divergence the old one could not express:
 * a producer can emit exactly the right five ids and still be wrong about what
 * each one IS. `getScrollback` declares nothing at all, which is the case that
 * pins the undefaulted rule — an un-annotated action must arrive with `effect`
 * ABSENT, never with a manufactured `'read'`.
 */
const CUSTOM_ACTION_DECLARATIONS: Record<
  (typeof CUSTOM_ACTION_IDS)[number],
  Pick<CustomAction, 'label' | 'description' | 'effect'>
> = {
  sendKeys: { label: 'Send keys', description: 'Type into the focused pane', effect: 'write' },
  writeToTerminal: { label: 'Write to terminal', effect: 'destructive' },
  paste: { effect: 'write' },
  pasteText: { label: 'Paste text', description: 'Paste the clipboard contents' },
  getScrollback: {},
};

/** The canonical wire projection of `CUSTOM_ACTION_DECLARATIONS`. */
const EXPECTED_CUSTOM_ACTIONS: SerializedElementAction[] = [
  {
    id: 'sendKeys',
    label: 'Send keys',
    description: 'Type into the focused pane',
    effect: 'write',
  },
  { id: 'writeToTerminal', label: 'Write to terminal', effect: 'destructive' },
  { id: 'paste', effect: 'write' },
  { id: 'pasteText', label: 'Paste text', description: 'Paste the clipboard contents' },
  { id: 'getScrollback' },
];

function makeCustomActions(): Record<string, CustomAction> {
  const entries: Record<string, CustomAction> = {};
  for (const id of CUSTOM_ACTION_IDS) {
    entries[id] = { id, ...CUSTOM_ACTION_DECLARATIONS[id], handler: () => ({ ok: true }) };
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

/**
 * `toEqual` treats an absent key and an explicit `undefined` as the same
 * thing, so it cannot see a projection that materializes `effect: undefined`.
 * On the wire that is benign (`JSON.stringify` drops it), but a producer that
 * DEFAULTS the field is the fail-open failure the annotation exists to
 * prevent, and the two spellings are one keystroke apart. So assert on the key
 * itself, for the one action that declared nothing.
 */
function expectUndefaultedEffect(customActions: SerializedElementAction[] | undefined): void {
  const unannotated = customActions?.find((a) => a.id === 'getScrollback');
  expect(unannotated).toBeDefined();
  expect(Object.prototype.hasOwnProperty.call(unannotated!, 'effect')).toBe(false);
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

  /**
   * A NON-interactive node, for the content/media cases.
   *
   * `find()` scans the DOM for interactive elements before it walks the
   * registry's content and media lists, so a registered `<button>` comes back
   * from the interactive block no matter what `category` it was registered
   * under — and the content/media push sites would never be exercised. A bare
   * `<div>` matches no interactive selector, so the only entry for it is the
   * one the category block produced.
   */
  function makeNode(text: string): HTMLDivElement {
    const el = document.createElement('div');
    el.textContent = text;
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
      expect(element!.customActions).toEqual(EXPECTED_CUSTOM_ACTIONS);
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
      expect(element!.customActions).toEqual(EXPECTED_CUSTOM_ACTIONS);
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

    it('carries per-action label/description/effect VERBATIM and undefaulted', async () => {
      // The divergence the old keys-only assertions could not see: a producer
      // emitting exactly the right five ids while dropping — or inventing —
      // the per-action fields. `writeToTerminal` is declared `destructive`,
      // the one annotation an autonomous walk must never fire past, so it is
      // the field whose loss matters most.
      registry.registerElement('pane-mounted', makePane('Terminal'), {
        type: 'input',
        actions: ['focus', 'blur'] as StandardAction[],
        customActions: makeCustomActions(),
      });

      const element = await findOne('pane-mounted');
      const byId = new Map((element!.customActions ?? []).map((a) => [a.id, a]));

      expect(byId.get('writeToTerminal')).toEqual({
        id: 'writeToTerminal',
        label: 'Write to terminal',
        effect: 'destructive',
      });
      expect(byId.get('sendKeys')?.description).toBe('Type into the focused pane');
      // Declared two other fields but no `effect` — the class is UNKNOWN, and
      // nothing on the way out may turn that into `'read'`.
      expect(byId.get('pasteText')?.effect).toBeUndefined();
      expectUndefaultedEffect(element!.customActions);
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
      // `actions`, emitted them as bare strings, emitted them in a different
      // order, or emitted `[]` instead of `undefined`, fails here.
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

    // `find()` builds its payload in THREE separate push sites — one per
    // category — and each one projects `customActions` on its own line. The
    // interactive block above is the one the live defect was measured on; the
    // other two were fixed blind, so they get their own coverage rather than
    // inheriting the interactive block's. A mutation to either is otherwise
    // invisible: nothing else in this suite registers a content or media
    // element.

    it('advertises the custom actions of a CONTENT element', async () => {
      registry.registerElement('pane-content', makeNode('Scrollback'), {
        type: 'generic',
        category: 'content',
        customActions: makeCustomActions(),
      });

      const response = await executor.find({ includeHidden: true, includeContent: true });
      const element = response.elements.find((e) => e.id === 'pane-content');
      expect(element).toBeDefined();
      // A content element has no BUILT-IN actions, so the custom ones are the
      // only thing that can tell a consumer it is controllable at all.
      expect(element!.actions).toEqual([]);
      expect(element!.customActions).toEqual(EXPECTED_CUSTOM_ACTIONS);
      expectUndefaultedEffect(element!.customActions);

      const canonical = serializeRegisteredElement(
        registry.getElement('pane-content') as RegisteredElement
      ) as unknown as Record<string, unknown>;
      expect(element!.customActions).toEqual(canonical.customActions);
    });

    it('advertises the custom actions of a MEDIA element', async () => {
      registry.registerElement('pane-media', makeNode('Preview'), {
        type: 'image',
        category: 'media',
        customActions: makeCustomActions(),
      });

      const response = await executor.find({ includeHidden: true, includeMedia: true });
      const element = response.elements.find((e) => e.id === 'pane-media');
      expect(element).toBeDefined();
      expect(element!.actions).toEqual([]);
      expect(element!.customActions).toEqual(EXPECTED_CUSTOM_ACTIONS);
      expectUndefaultedEffect(element!.customActions);

      const canonical = serializeRegisteredElement(
        registry.getElement('pane-media') as RegisteredElement
      ) as unknown as Record<string, unknown>;
      expect(element!.customActions).toEqual(canonical.customActions);
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
      expect(element!.customActions).toEqual(EXPECTED_CUSTOM_ACTIONS);
      expect(element!.actions).toEqual(['focus', 'blur']);
      expectUndefaultedEffect(element!.customActions);

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
  // The AI search producer — `SearchEngine.toAIDiscoveredElement`
  // ---------------------------------------------------------------------
  describe('SearchEngine.toAIDiscoveredElement — the AI search producer', () => {
    /**
     * This producer has TWO arms over one type. Fed a `DiscoveredElement` it
     * passes the payload straight through; fed a `RegisteredElement` it builds
     * a `DiscoveredElement` by hand. So the same element, reached two ways,
     * used to advertise different action sets — and after 2026-09-11 the
     * hand-built arm was additionally the wrong SHAPE, because it open-coded
     * `Object.keys(...)` while `AIDiscoveredElement.customActions` had already
     * been widened to `SerializedElementAction[]`.
     */
    it('registry arm agrees with serializeRegisteredElement', () => {
      const registry = getGlobalRegistry();
      registry.registerElement('pane-mounted', makePane('Terminal'), {
        type: 'input',
        actions: ['focus', 'blur'] as StandardAction[],
        customActions: makeCustomActions(),
      });

      const engine = new SearchEngine({ includeHidden: true });
      const response = engine.search({ idPattern: 'pane-mounted' }, registry.getAllElements());
      const hit = response.results.find((r) => r.element.id === 'pane-mounted');
      expect(hit).toBeDefined();

      const canonical = serializeRegisteredElement(
        registry.getElement('pane-mounted') as RegisteredElement
      ) as unknown as Record<string, unknown>;

      expect(hit!.element.customActions).toEqual(EXPECTED_CUSTOM_ACTIONS);
      expect(hit!.element.customActions).toEqual(canonical.customActions);
      expect(hit!.element.actions).toEqual(['focus', 'blur']);
      expectUndefaultedEffect(hit!.element.customActions);
    });

    it('both arms of the ternary answer identically for the same element', async () => {
      const registry = getGlobalRegistry();
      registry.registerElement('pane-mounted', makePane('Terminal'), {
        type: 'input',
        actions: ['focus', 'blur'] as StandardAction[],
        customActions: makeCustomActions(),
      });

      // Arm A: built by hand from the registry record.
      const fromRegistryArm = new SearchEngine({ includeHidden: true }).search(
        { idPattern: 'pane-mounted' },
        registry.getAllElements()
      ).results[0]?.element;

      // Arm B: a `DiscoveredElement` from `find()`, passed straight through.
      const found = (
        await new DefaultActionExecutor(registry).find({ includeHidden: true })
      ).elements.find((e) => e.id === 'pane-mounted');
      const fromPassthroughArm = new SearchEngine({ includeHidden: true }).search(
        { idPattern: 'pane-mounted' },
        [found!]
      ).results[0]?.element;

      expect(fromRegistryArm).toBeDefined();
      expect(fromPassthroughArm).toBeDefined();
      expect(actionProjection(fromRegistryArm as unknown as Record<string, unknown>)).toEqual(
        actionProjection(fromPassthroughArm as unknown as Record<string, unknown>)
      );
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
        (await executeCommand('find', { include_hidden: true }, {
          elements: registry.getAllElements(),
          getElement: () => undefined,
          components: [],
          workflows: [],
        } as BridgeAccess)) as unknown as FindResponse
      ).elements.find((e) => e.id === 'pane-mounted');

      const fromMaterialize = materializeElements([registered]).find(
        (e) => e.id === 'pane-mounted'
      );

      const fromCanonical = serializeRegisteredElement(registered);

      const expected = {
        actions: ['focus', 'blur'],
        customActions: EXPECTED_CUSTOM_ACTIONS,
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
        // …and none of them may manufacture the safety class the author did
        // not declare. The `toEqual` above cannot see an explicit `undefined`.
        expectUndefaultedEffect(
          (payload as unknown as { customActions?: SerializedElementAction[] }).customActions
        );
      }
    });
  });
});
