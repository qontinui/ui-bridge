/**
 * Regression: a DOM-scraped `label` must not be frozen at first discovery.
 *
 * ## The defect this pins
 *
 * `RegisteredElement.label` is a value copied out of the DOM by whichever
 * scanner discovered the element, and every scanner is idempotent by element
 * identity — the injected seeder skips nodes already in its `tracked` map
 * (`injected/seed-registry.ts`), `useAutoRegister` returns early on
 * `registeredElementsRef.has(element)`. Nothing ever re-read it, so an
 * `aria-label` that changed after first discovery left the registry serving
 * the FIRST value forever, including on an explicit `discover`. Meanwhile
 * `ariaLabel` and `accessibleName` in the SAME snapshot entry
 * (`serializeRegisteredElement`) were being re-derived live — so one snapshot
 * could carry `label: "Section: Account Usage (0 accounts)"` beside
 * `ariaLabel: "Section: Account Usage (2 accounts)"`.
 *
 * That is the failure mode this whole package exists to make impossible: the
 * instrument reporting a plausible-looking value that the DOM does not hold.
 *
 * ## The shape of the tests
 *
 * Each one renders, discovers, MUTATES `aria-label`, discovers again, and
 * asserts the SECOND read. They assert literal expected strings rather than
 * re-deriving the expectation from the code under test, and they fail against
 * the pre-fix behaviour (the second read returns the first label).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { UIBridgeRegistry, setGlobalRegistry } from './registry';
import { executeCommand } from '../react/commandHandlers';
import { seedRegistryFromDom } from '../injected/seed-registry';
import { bridgeAccessOver } from '../injected/bridge-access';

/**
 * jsdom computes no layout, so the dispatcher's `offsetParent !== null`
 * visibility gate rejects everything. Same stub the sibling seed-registry
 * tests use.
 */
function makeAllVisible(): void {
  document.body.querySelectorAll<HTMLElement>('*').forEach((el) => {
    Object.defineProperty(el, 'offsetParent', { get: () => document.body, configurable: true });
  });
}

const CARD_HTML = `
  <button id="usage-card" aria-label="Section: Account Usage (0 accounts)">Account Usage</button>
`;

describe('stale label — DOM-scraped labels are re-derived, not frozen at first discovery', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('refreshScrapedText() picks up an aria-label changed after registration', () => {
    document.body.innerHTML = CARD_HTML;
    const registry = new UIBridgeRegistry();
    seedRegistryFromDom(registry, document.body);

    const entry = registry.getAllElements().find((e) => e.element.id === 'usage-card');
    expect(entry).toBeDefined();
    expect(entry!.label).toBe('Section: Account Usage (0 accounts)');

    document
      .getElementById('usage-card')!
      .setAttribute('aria-label', 'Section: Account Usage (2 accounts)');

    const changed = registry.refreshScrapedText();
    expect(changed).toBe(1);
    expect(registry.getAllElements().find((e) => e.element.id === 'usage-card')!.label).toBe(
      'Section: Account Usage (2 accounts)'
    );
  });

  it('a snapshot taken after the mutation emits the NEW label, agreeing with its own ariaLabel', () => {
    document.body.innerHTML = CARD_HTML;
    const registry = new UIBridgeRegistry();
    seedRegistryFromDom(registry, document.body);
    makeAllVisible();

    // First read — the value the instrument would cache.
    const before = registry.createSnapshot();
    const beforeCard = before.elements.find((e) => e.id.includes('usage-card'));
    expect(beforeCard?.label).toBe('Section: Account Usage (0 accounts)');

    document
      .getElementById('usage-card')!
      .setAttribute('aria-label', 'Section: Account Usage (2 accounts)');

    const after = registry.createSnapshot();
    const afterCard = after.elements.find((e) => e.id.includes('usage-card'));
    expect(afterCard?.label).toBe('Section: Account Usage (2 accounts)');
    // The two fields in the same entry must agree — the asymmetry between a
    // cached `label` and a live `ariaLabel` IS the defect.
    expect(afterCard?.label).toBe(afterCard?.ariaLabel);
  });

  it('createSnapshotAsync emits the NEW label too', async () => {
    document.body.innerHTML = CARD_HTML;
    const registry = new UIBridgeRegistry();
    seedRegistryFromDom(registry, document.body);
    makeAllVisible();

    document
      .getElementById('usage-card')!
      .setAttribute('aria-label', 'Section: Account Usage (2 accounts)');

    const snap = await registry.createSnapshotAsync(50);
    const card = snap.elements.find((e) => e.id.includes('usage-card'));
    expect(card?.label).toBe('Section: Account Usage (2 accounts)');
  });

  it('an EXPLICIT discover after the mutation returns the NEW label', async () => {
    document.body.innerHTML = CARD_HTML;
    const registry = new UIBridgeRegistry();
    setGlobalRegistry(registry);
    seedRegistryFromDom(registry, document.body);
    makeAllVisible();
    const bridge = bridgeAccessOver(registry);

    const first = (await executeCommand('discover', {}, bridge)) as {
      elements: { id: string; label?: string }[];
    };
    expect(first.elements.find((e) => e.id.includes('usage-card'))?.label).toBe(
      'Section: Account Usage (0 accounts)'
    );

    document
      .getElementById('usage-card')!
      .setAttribute('aria-label', 'Section: Account Usage (2 accounts)');

    const second = (await executeCommand('discover', {}, bridge)) as {
      elements: { id: string; label?: string }[];
    };
    expect(second.elements.find((e) => e.id.includes('usage-card'))?.label).toBe(
      'Section: Account Usage (2 accounts)'
    );
  });

  it('a DEVELOPER-SET label is never overwritten by a DOM re-read', () => {
    document.body.innerHTML = `<button id="dev" aria-label="scraped name">text</button>`;
    const registry = new UIBridgeRegistry();
    // No `labelSource` — this is the explicit `useUIElement` shape.
    registry.registerElement('dev-btn', document.getElementById('dev')!, {
      label: 'Developer chosen label',
      origin: 'hook',
    });

    document.getElementById('dev')!.setAttribute('aria-label', 'changed scraped name');
    expect(registry.refreshScrapedText()).toBe(0);
    expect(registry.getElement('dev-btn')!.label).toBe('Developer chosen label');
  });

  it('a detached node keeps its last known label rather than being blanked', () => {
    document.body.innerHTML = CARD_HTML;
    const registry = new UIBridgeRegistry();
    seedRegistryFromDom(registry, document.body);
    const card = document.getElementById('usage-card')!;
    card.remove();

    expect(registry.refreshScrapedText()).toBe(0);
    expect(registry.getAllElements()[0]!.label).toBe('Section: Account Usage (0 accounts)');
  });

  it('the re-derivation closure is NOT serialized onto the wire', () => {
    document.body.innerHTML = CARD_HTML;
    const registry = new UIBridgeRegistry();
    seedRegistryFromDom(registry, document.body);
    makeAllVisible();

    const entry = registry.getAllElements()[0]!;
    expect(Object.keys(entry)).not.toContain('__labelSource');
    const snap = registry.createSnapshot();
    expect(JSON.stringify(snap)).not.toContain('__labelSource');
  });
});

/**
 * A point read refreshes ONE element (plan
 * 2026-11-08-ui-bridge-relay-and-exec-mode-follow-ups-from-pr-329, Phase 6,
 * D7): `refreshScrapedTextOf` is the per-entry body the page sweep loops over,
 * and the dispatcher's `getElement` calls it on the element it answers instead
 * of sweeping every registered element.
 */
describe('refreshScrapedTextOf — one entry, not the page', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  type RegisterOptions = Parameters<UIBridgeRegistry['registerElement']>[2];

  /**
   * Register `n` buttons whose label and content sources each count their
   * calls (`calls` is label + content calls per element).
   */
  function registerCounted(registry: UIBridgeRegistry, n: number) {
    const calls = new Map<string, number>();
    const labels = new Map<string, string>();
    for (let i = 0; i < n; i++) {
      const id = `el-${i}`;
      const node = document.createElement('button');
      node.id = id;
      document.body.appendChild(node);
      labels.set(id, `label ${i}`);
      calls.set(id, 0);
      const bump = () => calls.set(id, calls.get(id)! + 1);
      const options: RegisterOptions = {
        label: `label ${i}`,
        content: `content ${i}`,
        origin: 'auto',
        labelSource: () => {
          bump();
          return labels.get(id);
        },
        contentSource: () => {
          bump();
          return `content ${i}`;
        },
      };
      registry.registerElement(id, node, options);
    }
    return { calls, labels };
  }

  it("calls only the target's sources, and returns the fields it changed", () => {
    const registry = new UIBridgeRegistry();
    const { calls, labels } = registerCounted(registry, 5);
    labels.set('el-2', 'label 2 (changed)');

    const changed = registry.refreshScrapedTextOf(registry.getElement('el-2')!);

    expect(changed).toBe(1);
    expect(registry.getElement('el-2')!.label).toBe('label 2 (changed)');
    // Label AND content source of the target, once each; nobody else's.
    expect([...calls.entries()]).toEqual([
      ['el-0', 0],
      ['el-1', 0],
      ['el-2', 2],
      ['el-3', 0],
      ['el-4', 0],
    ]);
  });

  it("the sweep's count equals the sum of the per-entry counts over the same state", () => {
    // Two registries in the same state: one swept, one refreshed entry by entry.
    const swept = new UIBridgeRegistry();
    const perEntryRegistry = new UIBridgeRegistry();
    const a = registerCounted(swept, 5);
    const b = registerCounted(perEntryRegistry, 5);
    for (const labels of [a.labels, b.labels]) {
      labels.set('el-1', 'one');
      labels.set('el-3', 'three');
    }

    const sweep = swept.refreshScrapedText();
    const perEntry = perEntryRegistry
      .getAllElements()
      .reduce((sum, entry) => sum + perEntryRegistry.refreshScrapedTextOf(entry), 0);

    expect(sweep).toBe(2);
    expect(perEntry).toBe(sweep);
  });

  it('a developer-set label and a detached node are left verbatim (0), like the sweep', () => {
    const registry = new UIBridgeRegistry();
    const dev = document.createElement('button');
    document.body.appendChild(dev);
    registry.registerElement('dev', dev, { label: 'dev label', origin: 'hook' });
    expect(registry.refreshScrapedTextOf(registry.getElement('dev')!)).toBe(0);

    const { labels } = registerCounted(registry, 1);
    labels.set('el-0', 'new');
    document.getElementById('el-0')!.remove();
    expect(registry.refreshScrapedTextOf(registry.getElement('el-0')!)).toBe(0);
    expect(registry.getElement('el-0')!.label).toBe('label 0');
  });

  it("executeCommand('getElement') over 50 scraped elements invokes one element's label and content sources, once each", async () => {
    const registry = new UIBridgeRegistry();
    setGlobalRegistry(registry);
    const { calls, labels } = registerCounted(registry, 50);
    labels.set('el-17', 'label 17 (fresh)');
    makeAllVisible();

    const el = (await executeCommand(
      'getElement',
      { id: 'el-17' },
      bridgeAccessOver(registry)
    )) as { id: string; label?: string };

    expect(el.id).toBe('el-17');
    expect(el.label).toBe('label 17 (fresh)');
    const called = [...calls.entries()].filter(([, n]) => n > 0);
    expect(called).toEqual([['el-17', 2]]);
  });
});
