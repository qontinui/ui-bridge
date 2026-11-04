/**
 * ARMING — plan 2026-11-02-text-over-image-contrast-cannot-see-what-the-snapshot-left-out,
 * Phase 1.
 *
 * Enters where the injected runtime's population enters: `observeAndSeed`, with
 * the global registry the relay command dispatcher reads. The seeder registers at
 * most 500 content rows and, before this, said nothing about the rest: it stopped
 * at the cap, and a snapshot of a page past it looked like the whole page. Now
 * the pass counts every registrable element it had to refuse, and all three
 * `registration` emitters (the registry's own snapshot, the relay snapshot and
 * find) serve that count as `contentDropped`.
 *
 * It imports only modules that exist without the change, so with the production
 * hunks reverted it fails on its assertion, never on an import.
 */

import { it, expect, afterEach, beforeEach, vi } from 'vitest';
import { getGlobalRegistry, resetGlobalRegistry, type UIBridgeRegistry } from '../core/registry';
import { executeCommand, type BridgeAccess } from '../react/commandHandlers';
import { observeAndSeed } from './seed-registry';

let stop: (() => void) | undefined;

const emptyBridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
};

type Registration = { contentDropped?: number } & Record<string, unknown>;

// jsdom lays nothing out, and content discovery skips an element with no box.
beforeEach(() => {
  resetGlobalRegistry();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    width: 100,
    height: 20,
    top: 0,
    left: 0,
    right: 100,
    bottom: 20,
    toJSON: () => ({}),
  });
});

afterEach(() => {
  stop?.();
  stop = undefined;
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  resetGlobalRegistry();
});

function contentRows(registry: UIBridgeRegistry) {
  return registry.getAllElements().filter((e) => e.category === 'content');
}

function seed(html: string): UIBridgeRegistry {
  document.body.innerHTML = html;
  const registry = getGlobalRegistry();
  stop = observeAndSeed(registry, document.body);
  return registry;
}

/** The `registration` block from all three emitters, in a fixed order. */
async function registrations(registry: UIBridgeRegistry): Promise<Registration[]> {
  const own = registry.createSnapshot().registration as Registration;
  const relay = (
    (await executeCommand('getControlSnapshot', {}, emptyBridge)) as {
      registration: Registration;
    }
  ).registration;
  const find = (
    (await executeCommand('find', { include_hidden: true }, emptyBridge)) as {
      registration: Registration;
    }
  ).registration;
  return [own, relay, find];
}

const cells = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => `<td id="c${from + i}">Cell ${from + i}</td>`).join('');

const settle = () => new Promise((resolve) => setTimeout(resolve, 200));

it('a page under the cap states that nothing was dropped, on every emitter', async () => {
  const registry = seed('<h1>Hero heading</h1><p>Body text</p>');
  expect(contentRows(registry)).toHaveLength(2);
  for (const r of await registrations(registry)) expect(r.contentDropped).toBe(0);
});

it('every emitter serves the sum of what each source reported, and a report replaces', async () => {
  const registry = getGlobalRegistry();
  registry.reportContentDropped('injected-seed', 3);
  registry.reportContentDropped('useAutoRegister:1', 4);
  for (const r of await registrations(registry)) expect(r.contentDropped).toBe(7);
  registry.reportContentDropped('injected-seed', 1);
  registry.reportContentDropped('useAutoRegister:1', 0);
  for (const r of await registrations(registry)) expect(r.contentDropped).toBe(1);
  // A full teardown drops every source's count with the rows it was counted against.
  registry.clear();
  for (const r of await registrations(registry)) expect(r.contentDropped).toBe(0);
});

// Seeding past 500 cells under jsdom is slow on a CI runner, so these carry their
// own bound, as the cap test in content-seed.arming.test.ts does.
it('at the cap, the snapshot states exactly how many rows were refused, and no text', () => {
  // 510 cells and a heading are 511 registrable elements against a cap of 500.
  const registry = seed(`<table><tr>${cells(510)}</tr></table><h1>Hero heading</h1>`);
  expect(contentRows(registry)).toHaveLength(500);
  const registration = registry.createSnapshot().registration as Registration;
  expect(registration.contentDropped).toBe(11);
  // The count is a number; what the refused cells say reaches no field.
  expect(JSON.stringify(registration)).not.toMatch(/cell-509|Cell 509/i);
}, 60_000);

it('a re-seed replaces its count, and a refused row that gets a row leaves it', async () => {
  const registry = seed(`<table><tr>${cells(510)}</tr></table>`);
  expect(registry.getContentDropped()).toBe(10);

  // A mutation that changes nothing registrable: the next pass counts the same
  // ten again, which must replace the first pass's ten, not add to them.
  document.body.setAttribute('class', 'rescan');
  await settle();
  expect(registry.getContentDropped()).toBe(10);

  // Free four rows: four refused cells take them, and leave the count.
  const refused = Array.from(document.querySelectorAll<HTMLElement>('td')).filter(
    (el) => registry.findByDOMElement(el) === undefined
  );
  expect(refused).toHaveLength(10);
  for (const id of ['c0', 'c1', 'c2', 'c3']) document.getElementById(id)!.remove();
  await settle();
  expect(contentRows(registry)).toHaveLength(500);
  expect(registry.getContentDropped()).toBe(6);
  expect(refused.filter((el) => registry.findByDOMElement(el) !== undefined)).toHaveLength(4);

  // A refused cell that leaves the page leaves the count too.
  refused.filter((el) => registry.findByDOMElement(el) === undefined)[0].remove();
  await settle();
  expect(registry.getContentDropped()).toBe(5);
}, 60_000);
