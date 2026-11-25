/**
 * `effectiveOpacity` (core/composed-tree.ts) — the product of `opacity` over
 * the paint-parent chain; plan 2026-10-22-ui-bridge-hover-forces-the-css-hover-state,
 * Phase 5d. jsdom does not cascade stylesheets, so opacity is set INLINE here.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectiveOpacity, paintParent, composedParent } from './composed-tree';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function chain(...opacities: string[]): HTMLElement[] {
  const els: HTMLElement[] = [];
  let parent: HTMLElement = document.body;
  for (const o of opacities) {
    const el = document.createElement('div');
    if (o) el.style.opacity = o;
    parent.appendChild(el);
    els.push(el);
    parent = el;
  }
  return els;
}

describe('effectiveOpacity', () => {
  it('is the product over the ancestor chain, rounded to 4 decimals', () => {
    const els = chain('0.5', '0.5', '0.3333');
    expect(effectiveOpacity(els[2], window)).toBe(0.0833);
    expect(effectiveOpacity(els[1], window)).toBe(0.25);
  });

  it('is 1 with no opacity anywhere and 0 when any ancestor is 0', () => {
    expect(effectiveOpacity(chain('', '')[1], window)).toBe(1);
    expect(effectiveOpacity(chain('', '0', '')[2], window)).toBe(0);
  });

  it('the product, not the parent alone: 0.5 under 0.5 is 0.25, and a 1 child under 0.5 is 0.5', () => {
    const [a, b] = chain('0.5', '0.5');
    expect(effectiveOpacity(b, window)).toBe(0.25);
    expect(effectiveOpacity(a, window)).toBe(0.5);
    const [, c] = chain('0.5', '1');
    expect(effectiveOpacity(c, window)).toBe(0.5);
  });

  it('an unparseable opacity counts as 1', () => {
    const [a, b] = chain('', '');
    const view = {
      getComputedStyle: (el: Element) =>
        ({ opacity: el === a ? 'nonsense' : el === b ? '0.5' : '1' }) as CSSStyleDeclaration,
    };
    expect(effectiveOpacity(b, view)).toBe(0.5);
  });

  it('crosses a shadow root to its host and a slot to its owner', () => {
    const host = document.createElement('div');
    host.style.opacity = '0.5';
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const inner = document.createElement('div');
    inner.style.opacity = '0.5';
    shadow.appendChild(inner);
    expect(composedParent(inner)).toBe(host);
    expect(effectiveOpacity(inner, window)).toBe(0.25);

    const host2 = document.createElement('div');
    host2.style.opacity = '0';
    const slotted = document.createElement('span');
    host2.appendChild(slotted);
    document.body.appendChild(host2);
    const shadow2 = host2.attachShadow({ mode: 'open' });
    const wrap = document.createElement('div');
    wrap.style.opacity = '0.5';
    wrap.appendChild(document.createElement('slot'));
    shadow2.appendChild(wrap);
    // The slotted node paints inside the slot's wrapper, then the host.
    expect(paintParent(slotted)).toBe(wrap.firstElementChild);
    expect(effectiveOpacity(slotted, window)).toBe(0);
  });

  it('a top-layer element is exempt from its ancestors opacity', () => {
    const [parent, child] = chain('0', '');
    const real = child.matches.bind(child);
    child.setAttribute('popover', '');
    vi.spyOn(child, 'matches').mockImplementation((s: string) =>
      s === ':popover-open' ? true : real(s)
    );
    expect(paintParent(child)).toBeNull();
    expect(effectiveOpacity(child, window)).toBe(1);
    expect(effectiveOpacity(parent, window)).toBe(0);
  });

  it('a memo bounds getComputedStyle at the unique elements on the chains, and is per pass', () => {
    const [root, mid] = chain('0.5', '0.5');
    const leaves = [0, 1, 2, 3].map(() => {
      const el = document.createElement('i');
      mid.appendChild(el);
      return el;
    });
    const spy = vi.spyOn(window, 'getComputedStyle');
    const memo = new Map<Element, number>();
    for (const leaf of leaves) expect(effectiveOpacity(leaf, window, memo)).toBe(0.25);
    // The 4 leaves, mid, root, body and html: each read once.
    const unique = new Set<Element>();
    for (const leaf of leaves) {
      for (let a: Element | null = leaf; a; a = a.parentElement) unique.add(a);
    }
    expect(spy.mock.calls.length).toBe(unique.size);
    expect(unique.has(root)).toBe(true);

    // Without a memo every call re-walks: the memo is what bounds the cost.
    spy.mockClear();
    for (const leaf of leaves) effectiveOpacity(leaf, window);
    expect(spy.mock.calls.length).toBeGreaterThan(unique.size);

    // A fresh memo re-reads: passes never share one.
    spy.mockClear();
    effectiveOpacity(leaves[0], window, new Map());
    expect(spy.mock.calls.length).toBeGreaterThan(0);
  });

  it('raw mode keeps the legacy semantics: unrounded, an empty string reads 0, and the style reader is used', () => {
    const [a, b] = chain('', '');
    const values = new Map<Element, string>([
      [a, '0.00001'],
      [b, '0.5'],
    ]);
    const readStyle = (e: Element) => ({ opacity: values.get(e) ?? '1' });
    expect(effectiveOpacity(b, window, undefined, { raw: true, readStyle })).toBe(0.000005);
    expect(effectiveOpacity(b, window, undefined, { readStyle })).toBe(0);
    values.set(a, '');
    // Number('') is 0: the legacy read counts an empty opacity as fully transparent.
    expect(effectiveOpacity(b, window, undefined, { raw: true, readStyle })).toBe(0);
    // Default mode: parseFloat('') is NaN, which counts as 1.
    expect(effectiveOpacity(b, window, undefined, { readStyle })).toBe(0.5);
  });
});
