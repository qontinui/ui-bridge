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

  it('an element removed while hidden is reported detached', () => {
    document.body.innerHTML = '<p>gone</p><p>kept</p>';
    hide();
    document.querySelector('p')!.remove();
    const res = show();
    expect(res.restore).toMatchObject({ detached: 1, verified: true });
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
    expect(validateTextVisibilityRequest({ hidden: false, ttlMs: 600_000 })).toEqual({
      hidden: false,
      ttlMs: 600_000,
    });
  });
});
