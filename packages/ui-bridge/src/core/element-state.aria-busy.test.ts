/**
 * `ElementState.ariaBusy` — plan
 * `2026-11-08-ui-bridge-element-state-has-two-readers-and-no-aria-busy`, Phase 2 (D2).
 *
 * The rule: `aria-busy="true"` reads `true`; every other value, and absence,
 * read `false`. Always set (WAI-ARIA's default for the global state is
 * `false`), so a wait on `{ state: { ariaBusy: false } }` can be met on an
 * element that never declared the attribute. Only the element's OWN attribute
 * is read — a busy ancestor does not make a descendant busy.
 *
 * Enumerated through the canonical reader (`getElementState`) and through the
 * registry snapshot every transport serves, plus the executor's wait loop.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getElementState } from './element-state';
import { UIBridgeRegistry } from './registry';
import { DefaultActionExecutor } from '../control/action-executor';

/** jsdom has no layout: give a node a box so it reads as visible. */
function withBox<T extends HTMLElement>(el: T): T {
  el.getBoundingClientRect = () =>
    ({
      x: 10,
      y: 10,
      width: 80,
      height: 24,
      top: 10,
      left: 10,
      right: 90,
      bottom: 34,
      toJSON: () => ({}),
    }) as DOMRect;
  return el;
}

function button(ariaBusy: string | null): HTMLButtonElement {
  const el = withBox(document.createElement('button'));
  el.textContent = 'Load';
  if (ariaBusy !== null) el.setAttribute('aria-busy', ariaBusy);
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  document.body.innerHTML = '';
});

/** [label, expected ariaBusy, attribute value or null for absent]. */
const CASES: ReadonlyArray<readonly [string, boolean, string | null]> = [
  ['aria-busy="true"', true, 'true'],
  ['aria-busy="false"', false, 'false'],
  ['no aria-busy attribute', false, null],
  ['aria-busy="yes"', false, 'yes'],
  ['aria-busy=""', false, ''],
];

describe('ElementState.ariaBusy — the attribute, enumerated', () => {
  it.each(CASES)('%s → getElementState reads ariaBusy: %s', (_label, expected, attr) => {
    expect(getElementState(button(attr)).ariaBusy).toBe(expected);
  });

  it.each(CASES)('%s → the snapshot entry state reads ariaBusy: %s', (_label, expected, attr) => {
    const registry = new UIBridgeRegistry();
    registry.registerElement('load', button(attr), { type: 'button' });
    const entry = registry.createSnapshot().elements.find((e) => e.id === 'load');
    expect(entry?.state.ariaBusy).toBe(expected);
  });

  it('a busy ANCESTOR does not make the element busy (own attribute only)', () => {
    const region = document.createElement('div');
    region.setAttribute('aria-busy', 'true');
    document.body.appendChild(region);
    const child = withBox(document.createElement('button'));
    region.appendChild(child);
    expect(getElementState(region).ariaBusy).toBe(true);
    expect(getElementState(child).ariaBusy).toBe(false);
  });

  it('follows the attribute as it toggles', () => {
    const el = button(null);
    expect(getElementState(el).ariaBusy).toBe(false);
    el.setAttribute('aria-busy', 'true');
    expect(getElementState(el).ariaBusy).toBe(true);
    el.removeAttribute('aria-busy');
    expect(getElementState(el).ariaBusy).toBe(false);
  });
});

describe('executor waitFor({ state: { ariaBusy: false } }) terminates', () => {
  it('resolves met: true on the first poll for an element without the attribute', async () => {
    const registry = new UIBridgeRegistry();
    registry.registerElement('load', button(null), { type: 'button' });
    const executor = new DefaultActionExecutor(registry);

    // A 10 s interval makes "first poll" provable without a tight wall-clock
    // bound: a second poll could only start after 10 s had elapsed.
    const result = await executor.waitFor('load', {
      visible: false,
      enabled: false,
      state: { ariaBusy: false },
      timeout: 20_000,
      interval: 10_000,
    });

    expect(result.met).toBe(true);
    expect(result.waitedMs).toBeLessThan(10_000);
    expect(result.state?.ariaBusy).toBe(false);
  });

  it('resolves met: true once a timer clears aria-busy="true" at 50 ms', async () => {
    const registry = new UIBridgeRegistry();
    const el = button('true');
    registry.registerElement('load', el, { type: 'button' });
    const executor = new DefaultActionExecutor(registry);
    setTimeout(() => el.removeAttribute('aria-busy'), 50);

    const result = await executor.waitFor('load', {
      visible: false,
      enabled: false,
      state: { ariaBusy: false },
      timeout: 5000,
      interval: 10,
    });

    expect(result.met).toBe(true);
    expect(result.waitedMs).toBeGreaterThanOrEqual(45);
    expect(result.state?.ariaBusy).toBe(false);
  });
});
