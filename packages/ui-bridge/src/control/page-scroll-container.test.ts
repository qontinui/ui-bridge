import { afterEach, describe, expect, it, vi } from 'vitest';
import { pageScrollContainer } from './page-scroll-container';

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
