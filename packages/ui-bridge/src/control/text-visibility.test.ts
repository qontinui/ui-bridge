/**
 * Text visibility (plan 2026-10-13-image-generation-and-visual-judgment,
 * Phase 16 step 1): hide every glyph, then restore EXACTLY.
 *
 * jsdom renders nothing, so these tests pin what is written and what is put
 * back — the DOM text and the computed styles — and the real-Chromium smoke
 * in ui-bridge-wrapper (`inject-cli-text-visibility-smoke.test.ts`) pins the
 * pixels.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TEXT_VISIBILITY_TTL_MS,
  resetTextVisibilityForTest,
  setTextVisibility,
  textHidden,
  validateTextVisibilityRequest,
  type TextVisibilityFailure,
  type TextVisibilityHideSuccess,
  type TextVisibilityShowSuccess,
} from './text-visibility';

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

afterEach(() => {
  resetTextVisibilityForTest();
  vi.useRealTimers();
});

function hide(extra: Record<string, unknown> = {}): TextVisibilityHideSuccess {
  const res = setTextVisibility({ hidden: true, ...extra });
  if (!res.success || !res.hidden) throw new Error(`hide failed: ${JSON.stringify(res)}`);
  return res;
}

function show(): TextVisibilityShowSuccess {
  const res = setTextVisibility({ hidden: false });
  if (!res.success || res.hidden) throw new Error(`show failed: ${JSON.stringify(res)}`);
  return res;
}

/** Every element's full computed style, as a comparable value. */
function computedSnapshot(root: ParentNode = document.body): Array<Record<string, string>> {
  return Array.from(root.querySelectorAll('*')).map((el) => {
    const cs = getComputedStyle(el);
    const out: Record<string, string> = {};
    for (let i = 0; i < cs.length; i++) {
      const prop = cs.item(i);
      out[prop] = `${cs.getPropertyValue(prop)}|${cs.getPropertyPriority(prop)}`;
    }
    return out;
  });
}

function inline(el: Element, prop: string): [string, string] {
  const style = (el as HTMLElement).style;
  return [style.getPropertyValue(prop), style.getPropertyPriority(prop)];
}

const PAGE = `
  <style>
    p.loud { color: rgb(200, 0, 0) !important; text-shadow: 1px 1px 2px black; }
    .boxed { border: 2px solid; color: rgb(10, 20, 30); }
    .fade { transition: color 0.3s ease; }
  </style>
  <section class="hero" style="background-image: url(/hero.png); padding: 4px">
    <h1 id="h" style="color: rgb(255, 255, 255) !important; margin: 0">Headline</h1>
    <p class="loud fade">Over the image</p>
    <button class="boxed" style="transition: color 1s, background-color 2s">Go</button>
    <span>no style attribute</span>
    <input id="in" placeholder="Search" value="typed">
    <svg width="40" height="20"><text id="t" x="0" y="15" style="fill: rgb(1, 2, 3)">svg</text>
      <path id="icon" d="M0 0" stroke="currentColor"></path></svg>
  </section>`;

// ---------------------------------------------------------------------------
// The core property: hide, then restore EXACTLY
// ---------------------------------------------------------------------------

describe('hide and exact restore', () => {
  it('restores the DOM byte for byte and every computed style, !important included', () => {
    document.body.innerHTML = PAGE;
    const domBefore = document.body.innerHTML;
    const computedBefore = computedSnapshot();

    const hidden = hide();
    expect(hidden.changed).toBe(true);
    expect(document.body.innerHTML).not.toBe(domBefore);

    const shown = show();
    expect(shown.changed).toBe(true);
    expect(shown.restore).toMatchObject({
      trigger: 'request',
      elements: hidden.coverage.elements,
      exact: hidden.coverage.elements,
      propertyLevel: 0,
      detached: 0,
      drift: [],
      verified: true,
    });
    expect(document.body.innerHTML).toBe(domBefore);
    expect(computedSnapshot()).toEqual(computedBefore);
    // An element that had no style attribute has none again (not `style=""`).
    expect(document.querySelector('span')!.hasAttribute('style')).toBe(false);
    // The original inline !important is back with its priority.
    expect(inline(document.getElementById('h')!, 'color')).toEqual([
      'rgb(255, 255, 255)',
      'important',
    ]);
    expect(textHidden()).toBe(false);
  });

  it('writes the glyph values inline with !important on every element', () => {
    document.body.innerHTML = PAGE;
    const res = hide();
    expect(res.coverage).toMatchObject({ scope: 'document', svgText: 1, shadowRoots: 0 });
    const els = Array.from(document.body.querySelectorAll('*')).filter(
      (el) => el.localName !== 'style'
    );
    // body plus every rendered descendant.
    expect(res.coverage.elements).toBe(els.length + 1);
    for (const el of [document.body, ...els]) {
      expect(inline(el, 'color')).toEqual(['transparent', 'important']);
      expect(inline(el, '-webkit-text-fill-color')).toEqual(['transparent', 'important']);
      expect(inline(el, 'text-shadow')).toEqual(['none', 'important']);
      expect(inline(el, 'transition-property')).toEqual(['none', 'important']);
    }
    // An inline !important original is overridden, not left winning.
    expect(inline(document.getElementById('h')!, 'color')).toEqual(['transparent', 'important']);
    // A stylesheet !important rule loses to the inline !important.
    expect(getComputedStyle(document.querySelector('p')!).color).toBe('rgba(0, 0, 0, 0)');
    // SVG text: fill and stroke too; a non-text SVG graphic keeps its paint.
    const t = document.getElementById('t')!;
    expect(inline(t, 'fill')).toEqual(['transparent', 'important']);
    expect(inline(t, 'stroke')).toEqual(['transparent', 'important']);
    expect(inline(document.getElementById('icon')!, 'fill')[0]).not.toBe('transparent');
    // Non-glyph inline styles are untouched.
    expect(inline(document.querySelector('section')!, 'padding')).toEqual(['4px', '']);
  });

  it('pins currentColor-derived paint (a border) to the colour it had', () => {
    document.body.innerHTML = PAGE;
    const button = document.querySelector('button')!;
    const before = getComputedStyle(button).getPropertyValue('border-top-color');
    expect(before).not.toBe('');
    const res = hide();
    expect(res.coverage.pinned).toBeGreaterThan(0);
    expect(inline(button, 'border-top-color')).toEqual([before, 'important']);
    expect(getComputedStyle(button).getPropertyValue('border-top-color')).toBe(before);
  });

  it('hides gradient text (background-clip: text) by removing the background its glyphs are', () => {
    document.body.innerHTML = `<style>.grad { background-image: linear-gradient(red, blue);
      background-clip: text; -webkit-text-fill-color: transparent }</style>
      <h2 class="grad">Gradient</h2>`;
    const res = hide();
    expect(res.coverage.backgroundClipText).toBe(1);
    const h2 = document.querySelector('h2')!;
    expect(inline(h2, 'background-image')).toEqual(['none', 'important']);
    show();
    expect(h2.hasAttribute('style')).toBe(false);
  });

  it('walks open shadow roots and restores inside them', () => {
    document.body.innerHTML = '<div id="host"></div>';
    const root = document.getElementById('host')!.attachShadow({ mode: 'open' });
    root.innerHTML = '<p style="color: red">in shadow</p>';
    const p = root.querySelector('p')!;
    const res = hide();
    expect(res.coverage.shadowRoots).toBe(1);
    expect(inline(p, 'color')).toEqual(['transparent', 'important']);
    show();
    expect(p.getAttribute('style')).toBe('color: red');
  });

  it('leaves non-rendering elements alone', () => {
    document.body.innerHTML = '<script type="x">1</script><template><p>t</p></template><p>x</p>';
    hide();
    expect(document.querySelector('script')!.hasAttribute('style')).toBe(false);
    expect(document.querySelector('template')!.hasAttribute('style')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Idempotence
// ---------------------------------------------------------------------------

describe('idempotence', () => {
  it('a second hide writes nothing and re-arms the TTL', () => {
    vi.useFakeTimers();
    document.body.innerHTML = PAGE;
    const first = hide({ ttlMs: 5_000 });
    const domHidden = document.body.innerHTML;
    vi.advanceTimersByTime(1_000);
    const second = hide({ ttlMs: 5_000 });
    expect(second.changed).toBe(false);
    expect(second.hiddenAt).toBe(first.hiddenAt);
    expect(second.expiresAt).toBe(first.expiresAt + 1_000);
    expect(second.coverage).toEqual(first.coverage);
    expect(document.body.innerHTML).toBe(domHidden);
  });

  it('a show with nothing hidden writes nothing and reports the last restore', () => {
    document.body.innerHTML = PAGE;
    const before = document.body.innerHTML;
    const none = show();
    expect(none).toMatchObject({ changed: false, restore: null });
    hide();
    const first = show();
    const again = show();
    expect(again.changed).toBe(false);
    expect(again.restore).toEqual(first.restore);
    expect(document.body.innerHTML).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// TTL
// ---------------------------------------------------------------------------

describe('TTL auto-restore', () => {
  it('restores by itself when the TTL lapses, and the next show says so', () => {
    vi.useFakeTimers();
    document.body.innerHTML = PAGE;
    const before = document.body.innerHTML;
    const res = hide({ ttlMs: 1_000 });
    expect(res.ttlMs).toBe(1_000);
    vi.advanceTimersByTime(999);
    expect(textHidden()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(textHidden()).toBe(false);
    expect(document.body.innerHTML).toBe(before);
    const late = show();
    expect(late.changed).toBe(false);
    expect(late.restore).toMatchObject({ trigger: 'ttl', verified: true });
  });

  it('a repeated hide pushes the deadline out', () => {
    vi.useFakeTimers();
    document.body.innerHTML = PAGE;
    hide({ ttlMs: 1_000 });
    vi.advanceTimersByTime(800);
    hide({ ttlMs: 1_000 });
    vi.advanceTimersByTime(800);
    expect(textHidden()).toBe(true);
    vi.advanceTimersByTime(200);
    expect(textHidden()).toBe(false);
  });

  it('defaults the TTL when none is given', () => {
    document.body.innerHTML = '<p>x</p>';
    expect(hide().ttlMs).toBe(DEFAULT_TEXT_VISIBILITY_TTL_MS);
  });

  it('a show cancels the TTL, so it never fires on a later hide', () => {
    vi.useFakeTimers();
    document.body.innerHTML = PAGE;
    hide({ ttlMs: 1_000 });
    show();
    hide({ ttlMs: 5_000 });
    vi.advanceTimersByTime(1_500);
    expect(textHidden()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The app keeps running while text is hidden
// ---------------------------------------------------------------------------

const flushObservers = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('an app that writes while text is hidden', () => {
  it('adopts the app’s newer value, re-asserts the hide, and restores property by property', async () => {
    document.body.innerHTML = '<p style="color: red; margin: 1px">x</p>';
    const p = document.querySelector('p')!;
    hide();
    p.style.color = 'green';
    p.style.setProperty('padding', '3px');
    await flushObservers();
    expect(inline(p, 'color')).toEqual(['transparent', 'important']);
    const res = show();
    // <body> untouched by the app: exact; the <p> the app rewrote: property-level.
    expect(res.restore).toMatchObject({ exact: 1, propertyLevel: 1, drift: [], verified: true });
    expect(inline(p, 'color')).toEqual(['green', '']);
    expect(inline(p, 'margin')).toEqual(['1px', '']);
    expect(inline(p, 'padding')).toEqual(['3px', '']);
    expect(inline(p, '-webkit-text-fill-color')).toEqual(['', '']);
    expect(inline(p, 'transition-property')).toEqual(['', '']);
  });

  it('a property-level restore gives back an original !important with its priority', async () => {
    document.body.innerHTML = '<p style="color: red !important; text-shadow: 1px 1px blue">x</p>';
    const p = document.querySelector('p')!;
    hide();
    // The app touches a property this control does not own.
    p.style.setProperty('margin', '2px');
    await flushObservers();
    const res = show();
    expect(res.restore).toMatchObject({ propertyLevel: 1, verified: true });
    expect(inline(p, 'color')).toEqual(['red', 'important']);
    expect(inline(p, 'text-shadow')[1]).toBe('');
    expect(inline(p, 'text-shadow')[0]).toContain('blue');
    expect(inline(p, 'margin')).toEqual(['2px', '']);
  });

  it('a write the hide never saw is drift: left as the app set it, never verified', () => {
    document.body.innerHTML = '<p style="color: red">x</p>';
    const p = document.querySelector('p')!;
    hide();
    p.style.setProperty('color', 'green', 'important');
    const res = show();
    expect(res.restore).toMatchObject({
      propertyLevel: 1,
      driftCount: 1,
      drift: [{ tag: 'p', properties: ['color'] }],
      verified: false,
    });
    expect(inline(p, 'color')).toEqual(['green', 'important']);
    expect(inline(p, 'text-shadow')).toEqual(['', '']);
  });

  it('hides an element added while hidden, and restores it to no style at all', async () => {
    document.body.innerHTML = '<div id="list"></div>';
    hide();
    const li = document.createElement('p');
    li.textContent = 'late';
    document.getElementById('list')!.appendChild(li);
    await flushObservers();
    expect(inline(li, 'color')).toEqual(['transparent', 'important']);
    const res = show();
    expect(res.restore!.verified).toBe(true);
    expect(li.hasAttribute('style')).toBe(false);
  });

  it('an element detached while hidden is restored too, so re-inserting it shows its own style', () => {
    document.body.innerHTML = '<p id="m" style="color: red">modal</p><p>kept</p><i>x</i>';
    const m = document.getElementById('m')!;
    const i = document.querySelector('i')!;
    hide();
    m.remove();
    i.remove();
    const res = show();
    expect(res.restore).toMatchObject({ detached: 2, verified: true });
    document.body.appendChild(m);
    document.body.appendChild(i);
    expect(m.getAttribute('style')).toBe('color: red');
    expect(i.hasAttribute('style')).toBe(false);
  });

  it('a parent and its child appended in one task are each recorded once (H1)', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    hide();
    const d = document.createElement('div');
    document.getElementById('root')!.appendChild(d);
    const span = document.createElement('span');
    span.textContent = 'late';
    d.appendChild(span);
    await flushObservers();
    expect(inline(span, 'color')).toEqual(['transparent', 'important']);
    const res = show();
    expect(res.restore).toMatchObject({ verified: true, drift: [] });
    expect(span.hasAttribute('style')).toBe(false);
    expect(d.hasAttribute('style')).toBe(false);
  });

  it('a node moved twice in one task is recorded once (H1)', async () => {
    document.body.innerHTML = '<div id="a"></div><div id="b"></div>';
    const first = hide();
    const em = document.createElement('em');
    em.textContent = 'moved';
    document.getElementById('a')!.appendChild(em);
    document.getElementById('b')!.appendChild(em);
    await flushObservers();
    const again = hide();
    expect(again.coverage.elements).toBe(first.coverage.elements + 1);
    expect(again.coverage.lateAdded).toBe(1);
    show();
    expect(em.hasAttribute('style')).toBe(false);
  });

  it('pins a late element’s currentColor border to the colour it inherits, not the hide (L1)', async () => {
    document.head.innerHTML = '<style>.b { border: 2px solid }</style>';
    document.body.innerHTML = '<div id="r" style="color: rgb(0, 0, 255)"></div>';
    const r = document.getElementById('r')!;
    hide();
    const hiddenAttr = r.getAttribute('style');
    const late = document.createElement('span');
    late.className = 'b';
    r.appendChild(late);
    await flushObservers();
    expect(inline(late, 'border-top-color')).toEqual(['rgb(0, 0, 255)', 'important']);
    // The ancestor's colour was put back only for that read.
    expect(r.getAttribute('style')).toBe(hiddenAttr);
    const res = show();
    expect(res.restore).toMatchObject({ exact: 3, verified: true });
    expect(r.getAttribute('style')).toBe('color: rgb(0, 0, 255)');
  });

  it('covers a body the app swaps in while text is hidden (L3)', async () => {
    document.body.innerHTML = '<p>old</p>';
    hide();
    const fresh = document.createElement('body');
    fresh.innerHTML = '<p id="n">new</p>';
    document.documentElement.replaceChild(fresh, document.body);
    await flushObservers();
    const p = document.getElementById('n')!;
    expect(inline(p, 'color')).toEqual(['transparent', 'important']);
    // Elements of a body added after that are seen too: the new body is watched.
    const later = document.createElement('b');
    fresh.appendChild(later);
    await flushObservers();
    expect(inline(later, 'color')).toEqual(['transparent', 'important']);
    expect(show().restore).toMatchObject({ verified: true, detached: 2 });
    expect(p.hasAttribute('style')).toBe(false);
  });

  it('a repeated hide covers a swapped-in body the observer has not reported yet (L3)', () => {
    document.body.innerHTML = '<p>old</p>';
    const first = hide();
    const fresh = document.createElement('body');
    fresh.innerHTML = '<p id="n">new</p>';
    document.documentElement.replaceChild(fresh, document.body);
    const again = hide();
    expect(again.changed).toBe(true);
    expect(again.coverage.elements).toBe(first.coverage.elements + 2);
    expect(inline(document.getElementById('n')!, 'color')).toEqual(['transparent', 'important']);
  });
});

// ---------------------------------------------------------------------------
// A hide that throws part-way (L5)
// ---------------------------------------------------------------------------

describe('a hide that throws part-way', () => {
  it('reports rolledBack: null when the rollback throws too, and clears the state', () => {
    document.body.innerHTML = PAGE;
    const proto = Object.getPrototypeOf(document.body.style) as CSSStyleDeclaration;
    const real = proto.setProperty;
    const target = document.querySelector('button')!.style;
    const spy = vi.spyOn(proto, 'setProperty').mockImplementation(function (
      this: CSSStyleDeclaration,
      ...args: Parameters<CSSStyleDeclaration['setProperty']>
    ) {
      if (this === target) throw new Error('this element refuses every write');
      return real.apply(this, args);
    });
    let res: ReturnType<typeof setTextVisibility>;
    try {
      res = setTextVisibility({ hidden: true });
    } finally {
      spy.mockRestore();
    }
    expect(res).toMatchObject({ success: false, code: 'HIDE_FAILED', rolledBack: null });
    expect((res as TextVisibilityFailure).error).toContain('the rollback threw too');
    expect(textHidden()).toBe(false);
  });

  it('is rolled back before it answers, and nothing is left hidden', () => {
    document.body.innerHTML = PAGE;
    const before = document.body.innerHTML;
    // The prototype the elements' inline style objects actually use.
    const proto = Object.getPrototypeOf(document.body.style) as CSSStyleDeclaration;
    const real = proto.setProperty;
    // Throw once, on the hide's own write to one element part-way through
    // the page (jsdom's CSSOM also calls setProperty internally, so a plain
    // call count does not land on one of ours).
    const target = document.querySelector('button')!.style;
    let thrown = false;
    const spy = vi.spyOn(proto, 'setProperty').mockImplementation(function (
      this: CSSStyleDeclaration,
      ...args: Parameters<CSSStyleDeclaration['setProperty']>
    ) {
      if (!thrown && this === target && args[0] === 'text-shadow') {
        thrown = true;
        throw new Error('engine refused the write');
      }
      return real.apply(this, args);
    });
    let res: ReturnType<typeof setTextVisibility>;
    try {
      res = setTextVisibility({ hidden: true });
    } finally {
      spy.mockRestore();
    }
    expect(res).toMatchObject({
      success: false,
      code: 'HIDE_FAILED',
      rolledBack: { trigger: 'rollback', verified: true },
    });
    expect((res as TextVisibilityFailure).error).toContain('engine refused the write');
    expect(thrown).toBe(true);
    expect(textHidden()).toBe(false);
    expect(document.body.innerHTML).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// One state per page, not per SDK copy (L2)
// ---------------------------------------------------------------------------

describe('two copies of the module in one page', () => {
  it('a show through one copy restores a hide made through the other', async () => {
    vi.resetModules();
    const a = await import('./text-visibility');
    vi.resetModules();
    const b = await import('./text-visibility');
    expect(a.setTextVisibility).not.toBe(b.setTextVisibility);
    document.body.innerHTML = PAGE;
    const before = document.body.innerHTML;
    a.setTextVisibility({ hidden: true });
    expect(b.textHidden()).toBe(true);
    expect(b.setTextVisibility({ hidden: false })).toMatchObject({
      changed: true,
      restore: { verified: true },
    });
    expect(document.body.innerHTML).toBe(before);
    expect(a.textHidden()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A copy of a hidden element (M-A)
// ---------------------------------------------------------------------------

describe('a copy of a hidden element', () => {
  it('takes the original of the element it was copied from, not the hide it carries', async () => {
    document.body.innerHTML =
      '<ul><li id="row" style="padding: 1px">row <span>child</span></li></ul>';
    hide();
    const row = document.getElementById('row')!;
    const copy = row.cloneNode(true) as HTMLElement;
    copy.id = 'row2';
    document.querySelector('ul')!.appendChild(copy);
    await flushObservers();
    // The copy is hidden too, under its own marker.
    expect(inline(copy, 'color')).toEqual(['transparent', 'important']);
    expect(inline(copy, '--qontinui-tv')[0]).not.toBe(inline(row, '--qontinui-tv')[0]);
    const again = hide();
    expect(again.coverage.clones).toBe(2);
    const res = show();
    expect(res.restore).toMatchObject({ verified: true, drift: [] });
    expect(copy.getAttribute('style')).toBe('padding: 1px');
    expect(copy.querySelector('span')!.hasAttribute('style')).toBe(false);
    expect(row.getAttribute('style')).toBe('padding: 1px');
  });

  it('keeps what the app changed on the copy as the copy’s own', async () => {
    document.body.innerHTML = '<p id="src" style="color: red">x</p>';
    hide();
    const copy = document.getElementById('src')!.cloneNode(true) as HTMLElement;
    copy.style.setProperty('margin', '3px');
    document.body.appendChild(copy);
    await flushObservers();
    show();
    expect(inline(copy, 'color')).toEqual(['red', '']);
    expect(inline(copy, 'margin')).toEqual(['3px', '']);
    expect(inline(copy, '--qontinui-tv')).toEqual(['', '']);
    expect(inline(copy, 'transition-property')).toEqual(['', '']);
  });

  it('a stale copy from an earlier hide is recorded without the hide it carries', () => {
    document.body.innerHTML =
      '<p id="old" style="padding: 2px; color: transparent !important; ' +
      'text-shadow: none !important; --qontinui-tv: gone-1">x</p>';
    const res = hide();
    expect(res.coverage.clones).toBe(1);
    show();
    const p = document.getElementById('old')!;
    expect(inline(p, 'padding')).toEqual(['2px', '']);
    expect(inline(p, 'color')).toEqual(['', '']);
    expect(inline(p, 'text-shadow')).toEqual(['', '']);
    expect(inline(p, '--qontinui-tv')).toEqual(['', '']);
  });

  it('a copy kept off the page and inserted after the restore is restored exactly by a later hide (L-D)', async () => {
    document.head.innerHTML =
      '<style>#row { border: 2px solid; background: rgb(200, 200, 200) }</style>';
    document.body.innerHTML =
      '<ul><li id="row">row</li><li id="styled" style="padding: 1px; font-family: &quot;Ünïcødé&quot;">s</li></ul>';
    const styledOriginal = document.getElementById('styled')!.getAttribute('style');
    hide();
    const keep = document.getElementById('row')!.cloneNode(true) as HTMLElement;
    const keepStyled = document.getElementById('styled')!.cloneNode(true) as HTMLElement;
    show();
    // Inserted after the restore: nothing is watching, so they carry the hide.
    document.querySelector('ul')!.append(keep, keepStyled);
    await flushObservers();
    expect(inline(keep, 'color')).toEqual(['transparent', 'important']);
    expect(inline(keep, 'border-top-color')[1]).toBe('important');
    const again = hide();
    expect(again.coverage.clones).toBe(2);
    expect(show().restore).toMatchObject({ verified: true, drift: [] });
    expect(keep.hasAttribute('style')).toBe(false);
    expect(keepStyled.getAttribute('style')).toBe(styledOriginal);
  });

  it('a stale copy the app restyled is restored per property from the original it carries (L-D)', async () => {
    document.head.innerHTML =
      '<style>#row { border: 2px solid; background: rgb(200, 200, 200) }</style>';
    document.body.innerHTML = '<ul><li id="row" style="padding: 1px">row</li></ul>';
    hide();
    const keep = document.getElementById('row')!.cloneNode(true) as HTMLElement;
    show();
    keep.style.setProperty('margin', '3px');
    document.querySelector('ul')!.append(keep);
    await flushObservers();
    hide();
    show();
    expect(inline(keep, 'padding')).toEqual(['1px', '']);
    expect(inline(keep, 'margin')).toEqual(['3px', '']);
    for (const prop of [
      'color',
      'border-top-color',
      'background-color',
      'transition-property',
      '--qontinui-tv',
    ]) {
      expect(inline(keep, prop), prop).toEqual(['', '']);
    }
  });

  it('the marker is gone after an exact restore', () => {
    document.body.innerHTML = '<p style="margin: 1px">x</p>';
    hide();
    expect(inline(document.querySelector('p')!, '--qontinui-tv')[0]).not.toBe('');
    show();
    expect(document.querySelector('p')!.getAttribute('style')).toBe('margin: 1px');
  });
});

// ---------------------------------------------------------------------------
// The repeated hide handles the app's pending mutations (NIT 2)
// ---------------------------------------------------------------------------

describe('a repeated hide', () => {
  it('handles mutations the observer has not reported yet instead of dropping them', () => {
    document.body.innerHTML = '<p id="p" style="color: red">x</p>';
    const first = hide();
    const p = document.getElementById('p')!;
    p.style.color = 'green';
    const late = document.createElement('b');
    document.body.appendChild(late);
    const again = hide();
    expect(again.changed).toBe(true);
    expect(again.coverage.elements).toBe(first.coverage.elements + 1);
    expect(inline(late, 'color')).toEqual(['transparent', 'important']);
    expect(inline(p, 'color')).toEqual(['transparent', 'important']);
    expect(show().restore).toMatchObject({ verified: true });
    expect(inline(p, 'color')).toEqual(['green', '']);
    expect(late.hasAttribute('style')).toBe(false);
  });

  it('counts a swapped-in body’s shadow root once (NIT 1)', async () => {
    document.body.innerHTML = '<p>old</p>';
    hide();
    const fresh = document.createElement('body');
    const host = document.createElement('div');
    host.attachShadow({ mode: 'open' }).innerHTML = '<p>in shadow</p>';
    fresh.appendChild(host);
    document.documentElement.replaceChild(fresh, document.body);
    await flushObservers();
    expect(hide().coverage.shadowRoots).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The slot carries a schema (L-B)
// ---------------------------------------------------------------------------

describe('a slot another copy owns under a different schema', () => {
  const KEY = Symbol.for('@qontinui/ui-bridge/text-visibility');
  const g = globalThis as unknown as Record<symbol, unknown>;
  afterEach(() => {
    delete g[KEY];
  });

  it('is delegated to the functions the owning copy stored, never read here', () => {
    document.body.innerHTML = PAGE;
    const before = document.body.innerHTML;
    const answer = { success: true, hidden: true, changed: true, owner: 'other' };
    const handle = vi.fn(() => answer);
    g[KEY] = {
      schema: 2,
      // Records this copy must not touch: reading them would throw.
      get state(): never {
        throw new Error('a foreign record was read');
      },
      lastRestore: null,
      handle,
      hidden: () => true,
    };
    expect(setTextVisibility({ hidden: true })).toBe(answer);
    expect(handle).toHaveBeenCalledWith({ hidden: true });
    expect(textHidden()).toBe(true);
    expect(document.body.innerHTML).toBe(before);
  });

  it('is refused, typed, when the owner left nothing to delegate to', () => {
    document.body.innerHTML = PAGE;
    const before = document.body.innerHTML;
    g[KEY] = { state: { records: 'not ours' }, lastRestore: null };
    expect(setTextVisibility({ hidden: true })).toMatchObject({
      success: false,
      code: 'STATE_SCHEMA_MISMATCH',
    });
    // This copy cannot know, and says so rather than answering false.
    expect(textHidden()).toBeNull();
    expect(document.body.innerHTML).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('validation', () => {
  it.each([
    [null, 'body must be a JSON object'],
    [[], 'body must be a JSON object'],
    [{}, 'hidden must be a boolean'],
    [{ hidden: 'yes' }, 'hidden must be a boolean'],
    [{ hidden: true, ttlMs: 10 }, 'ttlMs must be an integer'],
    [{ hidden: true, ttlMs: 1.5e3 + 0.5 }, 'ttlMs must be an integer'],
    [{ hidden: true, ttlMs: 10_000_000 }, 'ttlMs must be an integer'],
  ])('refuses %j', (raw, message) => {
    const res = setTextVisibility(raw) as TextVisibilityFailure;
    expect(res).toMatchObject({ success: false, code: 'INVALID_REQUEST' });
    expect(res.error).toContain(message);
    expect(textHidden()).toBe(false);
  });

  it('accepts the bounds', () => {
    expect(validateTextVisibilityRequest({ hidden: true, ttlMs: 1_000 })).toEqual({
      hidden: true,
      ttlMs: 1_000,
    });
  });

  it('does not validate ttlMs on a show (a show has no TTL)', () => {
    for (const ttlMs of ['x', -1, 10_000_000]) {
      expect(validateTextVisibilityRequest({ hidden: false, ttlMs })).toEqual({
        hidden: false,
        ttlMs: DEFAULT_TEXT_VISIBILITY_TTL_MS,
      });
    }
    document.body.innerHTML = '<p>x</p>';
    hide();
    expect(setTextVisibility({ hidden: false, ttlMs: 'x' })).toMatchObject({
      success: true,
      changed: true,
    });
  });
});
