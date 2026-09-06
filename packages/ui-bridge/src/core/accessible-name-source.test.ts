/**
 * Regression: an element the accessibility tree cannot name must SAY SO, and
 * every name must say which rung produced it.
 *
 * ## The defect this pins
 *
 * Measured 2026-09-06 against `/admin/coord/plans`: `coord-plans-refresh` — an
 * icon-only `<Button>` with no `aria-label` and no `title` — came back with
 * `label`, `text`, `ariaLabel` and `accessibleName` ALL absent. Four silent
 * nulls, from which a reader cannot tell
 *
 *   "this element has no accessible name"   (a real finding, actionable)
 *
 * from
 *
 *   "the name was not computed"             (an instrument gap)
 *
 * and the element carried a perfectly good `data-testid` that nothing used, so
 * it was invisible to every discovery path that did not already know its id.
 *
 * The second half: the package carried TWO accessible-name algorithms — a
 * hand-rolled chain feeding `state.accessibleName` (truncating at 80 code
 * points) and the W3C `dom-accessibility-api` feeding the snapshot entry's
 * `accessibleName`. Two fields with the same name, read by the same consumers,
 * free to disagree on the same element.
 *
 * Plan: 2026-09-06-ui-bridge-element-metadata-is-stale-and-misdeclared
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { resolveAccessibleName } from './a11y';
import { UIBridgeRegistry } from './registry';

function makeAllVisible(): void {
  document.body.querySelectorAll<HTMLElement>('*').forEach((el) => {
    Object.defineProperty(el, 'offsetParent', { get: () => document.body, configurable: true });
  });
}

describe('accessible-name source — which rung named this element, and did anything', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('reports an AUTHORED aria-label as authored', () => {
    document.body.innerHTML = `<button id="b" aria-label="Refresh plans">x</button>`;
    expect(resolveAccessibleName(document.getElementById('b')!)).toEqual({
      name: 'Refresh plans',
      source: 'aria-label',
    });
  });

  it('reports an aria-labelledby reference as such, not as authored', () => {
    document.body.innerHTML = `<span id="lbl">Status filter</span><button id="b" aria-labelledby="lbl"></button>`;
    expect(resolveAccessibleName(document.getElementById('b')!)).toEqual({
      name: 'Status filter',
      source: 'aria-labelledby',
    });
  });

  it('reports an associated <label> as `label`', () => {
    document.body.innerHTML = `<label for="i">Full name</label><input id="i" />`;
    expect(resolveAccessibleName(document.getElementById('i')!)).toEqual({
      name: 'Full name',
      source: 'label',
    });
  });

  it('reports a name SCRAPED from subtree text as `text`, distinguishable from an authored one', () => {
    document.body.innerHTML = `<button id="b">Refresh</button>`;
    const resolved = resolveAccessibleName(document.getElementById('b')!);
    expect(resolved.name).toBe('Refresh');
    expect(resolved.source).toBe('text');
  });

  it('DERIVES a name from data-testid when the a11y tree yields nothing', () => {
    document.body.innerHTML = `<button id="b" data-testid="coord-plans-refresh"><svg></svg></button>`;
    expect(resolveAccessibleName(document.getElementById('b')!)).toEqual({
      name: 'coord-plans-refresh',
      source: 'derived',
    });
  });

  it('DERIVES from an icon class token when there is no testid and no id', () => {
    // No `id` either: an id is a developer affordance and outranks an icon
    // guess, so leaving one here would test the wrong rung.
    document.body.innerHTML = `<button><svg class="lucide lucide-refresh-cw"></svg></button>`;
    const resolved = resolveAccessibleName(document.querySelector('button')!);
    expect(resolved.source).toBe('derived');
    expect(resolved.name).toBe('refresh-cw');
  });

  it("says 'none' EXPLICITLY when there is genuinely nothing to derive", () => {
    document.body.innerHTML = `<div><button></button></div>`;
    const resolved = resolveAccessibleName(document.querySelector('button')!);
    expect(resolved.source).toBe('none');
    expect(resolved.name).toBeUndefined();
  });

  it('a derived name is NEVER reported as an authored one — the distinction is the point', () => {
    document.body.innerHTML = `
      <button id="authored" aria-label="coord-plans-refresh" data-testid="coord-plans-refresh"></button>
      <button id="derived" data-testid="coord-plans-refresh"></button>`;
    const authored = resolveAccessibleName(document.getElementById('authored')!);
    const derived = resolveAccessibleName(document.getElementById('derived')!);
    // Same NAME, different provenance. A consumer auditing accessibility must
    // be able to tell these apart, and only `source` can.
    expect(authored.name).toBe(derived.name);
    expect(authored.source).toBe('aria-label');
    expect(derived.source).toBe('derived');
  });

  it('the snapshot entry carries nameSource beside accessibleName', () => {
    document.body.innerHTML = `<button id="b" data-testid="coord-plans-refresh"><svg></svg></button>`;
    const registry = new UIBridgeRegistry();
    registry.registerElement('refresh', document.getElementById('b')!, {
      type: 'button',
      actions: ['click'],
    });
    makeAllVisible();

    const entry = registry.createSnapshot().elements.find((e) => e.id === 'refresh')!;
    expect(entry.nameSource).toBe('derived');
    expect(entry.accessibleName).toBe('coord-plans-refresh');
    // The old four-nulls shape is gone: something now answers "what is this".
    expect(entry.accessibleName).toBeDefined();
  });

  it('state.accessibleName and the snapshot accessibleName come from ONE algorithm', () => {
    // 120 code points — longer than the 80 the deleted hand-rolled chain
    // truncated at, so a surviving second algorithm would show up here.
    const long = 'a'.repeat(120);
    document.body.innerHTML = `<button id="b">${long}</button>`;
    const registry = new UIBridgeRegistry();
    registry.registerElement('long', document.getElementById('b')!, {
      type: 'button',
      actions: ['click'],
    });
    makeAllVisible();

    const entry = registry.createSnapshot().elements.find((e) => e.id === 'long')!;
    expect(entry.accessibleName).toBe(long);
    expect(entry.state?.accessibleName).toBe(entry.accessibleName);
    expect(entry.state?.nameSource).toBe(entry.nameSource);
  });
});
