/**
 * Which element the relay `pageScroll` command moves.
 *
 * It resolves the page through `pageScrollContainer`, like the element-scroll
 * walks: where `<body>` is its own scroll container (the SPA / Tauri layout)
 * a `window.scrollBy` moves nothing, so the body must be scrolled instead.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeCommand, type BridgeAccess } from './commandHandlers';

const emptyBridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
};

describe('relay pageScroll · scroll container', () => {
  const nativeScrollBy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollBy');

  afterEach(() => {
    vi.restoreAllMocks();
    for (const el of [document.documentElement, document.body]) {
      el.style.overflowX = '';
      el.style.overflowY = '';
    }
    if (nativeScrollBy) Object.defineProperty(HTMLElement.prototype, 'scrollBy', nativeScrollBy);
    else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollBy;
  });

  function stubElementScrollBy() {
    if (!nativeScrollBy) {
      HTMLElement.prototype.scrollBy = function () {} as HTMLElement['scrollBy'];
    }
    return vi.spyOn(HTMLElement.prototype, 'scrollBy');
  }

  it('scrolls the window when the viewport is the page scroller', async () => {
    const win = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    const el = stubElementScrollBy();
    const result = (await executeCommand('pageScroll', { top: 300 }, emptyBridge)) as Record<
      string,
      unknown
    >;
    expect(result.success).toBe(true);
    expect(result.container).toBe('viewport');
    expect(win).toHaveBeenCalledWith({ top: 300, left: 0, behavior: 'auto' });
    expect(el).not.toHaveBeenCalled();
  });

  it('scrolls the body, not the window, where the body is its own scroll container', async () => {
    // jsdom does not expand the `overflow` shorthand into its longhands.
    document.documentElement.style.overflowX = 'hidden';
    document.documentElement.style.overflowY = 'hidden';
    document.body.style.overflowX = 'auto';
    document.body.style.overflowY = 'auto';
    vi.spyOn(document.body, 'scrollHeight', 'get').mockReturnValue(5000);
    vi.spyOn(document.body, 'clientHeight', 'get').mockReturnValue(800);
    const win = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    const el = stubElementScrollBy().mockImplementation(function (this: HTMLElement) {
      this.scrollTop = 300;
    });
    document.body.scrollTop = 0;
    const result = (await executeCommand('pageScroll', { top: 300 }, emptyBridge)) as Record<
      string,
      unknown
    >;
    expect(result.success).toBe(true);
    expect(result.container).toBe('body');
    expect(win).not.toHaveBeenCalled();
    expect(el.mock.contexts[0]).toBe(document.body);
    expect(result.before).toEqual({ scrollX: 0, scrollY: 0 });
    expect(result.after).toEqual({ scrollX: 0, scrollY: 300 });
    expect(result.changed).toBe(true);
  });

  it("waits for the body's own scrollend on a smooth body scroll, not the 500 ms fallback", async () => {
    document.documentElement.style.overflowX = 'hidden';
    document.documentElement.style.overflowY = 'hidden';
    document.body.style.overflowX = 'auto';
    document.body.style.overflowY = 'auto';
    vi.spyOn(document.body, 'scrollHeight', 'get').mockReturnValue(5000);
    vi.spyOn(document.body, 'clientHeight', 'get').mockReturnValue(800);
    stubElementScrollBy().mockImplementation(function (this: HTMLElement) {
      setTimeout(() => this.dispatchEvent(new Event('scrollend')), 10);
    });
    const t0 = performance.now();
    const result = (await executeCommand(
      'pageScroll',
      { top: 300, smooth: true },
      emptyBridge
    )) as Record<string, unknown>;
    expect(result.success).toBe(true);
    expect(result.container).toBe('body');
    expect(performance.now() - t0).toBeLessThan(400);
  });
});
