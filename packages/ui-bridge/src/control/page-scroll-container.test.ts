import { afterEach, describe, expect, it, vi } from 'vitest';
import { pageScrollContainer, pageViewportContext } from './page-scroll-container';

/** Give `el` a computed overflow and an overflowing scroll box. */
function layout(el: HTMLElement, overflow: string, overflows: boolean): void {
  // jsdom does not expand the `overflow` shorthand into its longhands.
  el.style.overflowX = overflow;
  el.style.overflowY = overflow;
  vi.spyOn(el, 'scrollHeight', 'get').mockReturnValue(overflows ? 2000 : 100);
  vi.spyOn(el, 'clientHeight', 'get').mockReturnValue(100);
}

describe('pageScrollContainer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    for (const el of [document.documentElement, document.body]) {
      el.style.overflowX = '';
      el.style.overflowY = '';
    }
  });

  it('is the root, not the body, when the body merely overflows (the viewport scrolls)', () => {
    layout(document.documentElement, '', false);
    layout(document.body, '', true);
    expect(pageScrollContainer()).toBe(document.scrollingElement ?? document.documentElement);
    expect(pageScrollContainer()).not.toBe(document.body);
  });

  it('is the root when body overflow propagates to the viewport (html overflow visible)', () => {
    layout(document.documentElement, 'visible', false);
    layout(document.body, 'auto', true);
    expect(pageScrollContainer()).not.toBe(document.body);
  });

  it('is the body in the SPA layout, where the body scrolls itself', () => {
    layout(document.documentElement, 'hidden', false);
    layout(document.body, 'auto', true);
    expect(pageScrollContainer()).toBe(document.body);
  });

  it('is not the body when the SPA body has nothing to scroll', () => {
    layout(document.documentElement, 'hidden', false);
    layout(document.body, 'auto', false);
    expect(pageScrollContainer()).not.toBe(document.body);
  });
});

describe('pageViewportContext', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    for (const el of [document.documentElement, document.body]) {
      el.style.overflowX = '';
      el.style.overflowY = '';
    }
    document.body.scrollTop = 0;
  });

  it('reads the window where the viewport scrolls', () => {
    layout(document.documentElement, '', false);
    layout(document.body, '', true);
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(40);
    const ctx = pageViewportContext();
    expect(ctx.container).toBe('viewport');
    expect(ctx.scrollY).toBe(40);
  });

  it('reads the body where the body scrolls itself (SPA / Tauri layout)', () => {
    layout(document.documentElement, 'hidden', false);
    layout(document.body, 'auto', true);
    vi.spyOn(document.body, 'scrollTop', 'get').mockReturnValue(300);
    const ctx = pageViewportContext();
    expect(ctx.container).toBe('body');
    expect(ctx.scrollY).toBe(300);
    expect(ctx.documentHeight).toBe(2000);
    // 300 + 100 < 2000 - 1: more page below — a window-only read says false here.
    expect(ctx.canScrollDown).toBe(true);
  });

  it('reports the bottom of a body-scrolled page as unable to scroll down', () => {
    layout(document.documentElement, 'hidden', false);
    layout(document.body, 'auto', true);
    vi.spyOn(document.body, 'scrollTop', 'get').mockReturnValue(1900);
    expect(pageViewportContext().canScrollDown).toBe(false);
  });
});
