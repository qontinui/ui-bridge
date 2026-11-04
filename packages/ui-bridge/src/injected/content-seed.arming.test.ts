/**
 * ARMING — plan 2026-10-13-image-generation-and-visual-judgment, Phase 16.
 *
 * Enters where the injected runtime's population enters: `observeAndSeed`, what
 * the injected bootstrap (the bundle inject-cli adds to a page) runs to keep its
 * registry live. Before this it registered interactive elements and media only,
 * so a page driven that way had no heading in its snapshot, and
 * `text_over_image_contrast` could measure a link over a hero image but never
 * the hero's own heading. Now a heading and a paragraph register as content, with
 * the fields and the id the React scanner gives them.
 *
 * It imports only modules that exist without the change, so with the production
 * hunks reverted it fails on its assertion, never on an import.
 */

import { it, expect, afterEach, beforeEach, vi } from 'vitest';
import { UIBridgeRegistry } from '../core/registry';
import { observeAndSeed } from './seed-registry';

let stop: (() => void) | undefined;

// jsdom lays nothing out, and content discovery skips an element with no box.
beforeEach(() => {
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
});

function contentRows(registry: UIBridgeRegistry) {
  return registry.getAllElements().filter((e) => e.category === 'content');
}

function seed(html: string): UIBridgeRegistry {
  document.body.innerHTML = html;
  const registry = new UIBridgeRegistry();
  stop = observeAndSeed(registry, document.body);
  return registry;
}

it('a hero heading and paragraph register as content, beside the link over the same image', () => {
  const registry = seed(`
    <div class="hero">
      <h1 id="headline">Build something remarkable</h1>
      <p>Text laid over a textured photograph</p>
      <a href="/guide">Read the guide</a>
    </div>`);
  const rows = contentRows(registry);
  expect(rows.map((e) => e.content).sort()).toEqual([
    'Build something remarkable',
    'Text laid over a textured photograph',
  ]);
  for (const row of rows) expect(row.actions).toEqual([]);
  // The link is still the interactive scanner's, and only that.
  const link = registry.getAllElements().filter((e) => e.element.tagName === 'A');
  expect(link).toHaveLength(1);
  expect(link[0].category).not.toBe('content');
});

it('a re-seed registers nothing twice, and text added later registers', async () => {
  const registry = seed('<h2>First</h2>');
  expect(contentRows(registry)).toHaveLength(1);
  const added = document.createElement('p');
  added.textContent = 'Second';
  document.body.appendChild(added);
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(
    contentRows(registry)
      .map((e) => e.content)
      .sort()
  ).toEqual(['First', 'Second']);
});

it('a heading removed from the page leaves the registry', async () => {
  const registry = seed('<h2 id="gone">Gone soon</h2><h2>Stays</h2>');
  expect(contentRows(registry)).toHaveLength(2);
  document.getElementById('gone')!.remove();
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(contentRows(registry).map((e) => e.content)).toEqual(['Stays']);
});

it('an element the interactive scan holds does not register again as content', () => {
  const registry = seed('<li role="button" tabindex="0">Pick me</li><td onclick="x()">Cell</td>');
  const byElement = new Map<Element, number>();
  for (const e of registry.getAllElements()) {
    byElement.set(e.element, (byElement.get(e.element) ?? 0) + 1);
  }
  for (const count of byElement.values()) expect(count).toBe(1);
});

it('text with no box, or hidden by style, does not register', () => {
  const registry = seed('<p style="display:none">Hidden</p><p style="visibility:hidden">Gone</p>');
  expect(contentRows(registry)).toEqual([]);
});

it('text inside a redaction boundary reaches no field of the row, the id included', () => {
  const registry = seed(
    '<div data-bridge-redact="true"><p>secret value</p><h2>secret heading</h2><div role="alert">Your OTP is 123456</div></div>'
  );
  const rows = contentRows(registry);
  expect(rows).toHaveLength(3);
  const leaked = /secret|otp|123456/i;
  for (const row of rows) {
    expect(row.content).toBeUndefined();
    expect(row.label).toBeUndefined();
    expect(row.id).not.toMatch(leaked);
    expect(JSON.stringify(row.contentMetadata ?? {})).not.toMatch(leaked);
  }
});

it('three cards with one heading are three rows, so one card cannot stand for all', () => {
  const registry = seed('<h3>Featured</h3><h3>Featured</h3><h3>Featured</h3>');
  const rows = contentRows(registry);
  expect(rows.map((e) => e.id).sort()).toEqual([
    'heading-3-featured',
    'heading-3-featured-2',
    'heading-3-featured-3',
  ]);
  expect(new Set(rows.map((e) => e.element)).size).toBe(3);
});

it('a heading identical to one removed takes its id, and nothing is registered twice', async () => {
  const registry = seed('<h3 id="a">Featured</h3><h3>Featured</h3>');
  document.getElementById('a')!.remove();
  const added = document.createElement('h3');
  added.textContent = 'Featured';
  document.body.appendChild(added);
  await new Promise((resolve) => setTimeout(resolve, 200));
  const rows = contentRows(registry);
  expect(rows).toHaveLength(2);
  expect(new Set(rows.map((e) => e.element)).size).toBe(2);
});

it('a row seeded as content that becomes interactive is promoted, and can be clicked', async () => {
  const registry = seed('<table><tr><th id="sort">Name</th></tr></table>');
  const th = document.getElementById('sort')!;
  expect(registry.getAllElements().find((e) => e.element === th)?.category).toBe('content');
  // Only this attribute changes: nothing else would trigger the re-seed.
  th.setAttribute('role', 'button');
  await new Promise((resolve) => setTimeout(resolve, 200));
  const rows = registry.getAllElements().filter((e) => e.element === th);
  expect(rows).toHaveLength(1);
  expect(rows[0].category).not.toBe('content');
  expect(rows[0].actions).toContain('click');
});

it('a promoted row keeps an id its author chose', async () => {
  const registry = seed('<table><tr><th id="t" data-content-id="total">Total</th></tr></table>');
  const th = document.getElementById('t')!;
  expect(registry.getElement('total')?.category).toBe('content');
  th.setAttribute('tabindex', '0');
  th.setAttribute('role', 'button');
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(registry.getElement('total')?.element).toBe(th);
  expect(registry.getElement('total')?.category).not.toBe('content');
});

it('an authored content id does not rename a control that was never a content row', () => {
  const registry = seed(
    '<p data-content-id="total">$5</p><button data-content-id="total">Recalculate</button>'
  );
  const total = registry.getElement('total');
  expect(total?.element.tagName).toBe('P');
  const button = registry.getAllElements().find((e) => e.element.tagName === 'BUTTON');
  expect(button?.id).not.toBe('total');
});

// Seeding 600 cells under jsdom is slow (18.6 s on a CI runner, against
// vitest's 5 s default), so this test carries its own bound.
it('when the cap binds, a heading below a large table still gets its row', () => {
  const cells = Array.from({ length: 600 }, (_, i) => `<td>Cell ${i}</td>`).join('');
  const registry = seed(`<table><tr>${cells}</tr></table><h1>Hero heading</h1>`);
  const rows = contentRows(registry);
  expect(rows).toHaveLength(500);
  expect(rows.some((e) => e.content === 'Hero heading')).toBe(true);
}, 60_000);

it('content does not arm settle: a text splash is not the page having arrived', () => {
  document.body.innerHTML = '<h1>Loading…</h1><p>Please wait</p>';
  const registry = new UIBridgeRegistry();
  const counts: number[] = [];
  stop = observeAndSeed(registry, document.body, { onSeed: (n) => counts.push(n) });
  expect(contentRows(registry)).toHaveLength(2);
  expect(counts).toEqual([0]);
  stop();
  document.body.innerHTML = '<h1>Ready</h1><button>Go</button>';
  const counts2: number[] = [];
  stop = observeAndSeed(new UIBridgeRegistry(), document.body, { onSeed: (n) => counts2.push(n) });
  expect(counts2).toEqual([1]);
});
