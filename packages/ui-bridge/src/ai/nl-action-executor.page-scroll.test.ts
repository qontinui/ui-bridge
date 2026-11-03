/**
 * A bare NL "scroll down" against the REAL in-page action executor: the
 * `document` page sentinel it is sent to must resolve to the page scroll
 * container and scroll it, with no registered element involved.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNLActionExecutor } from './nl-action-executor';
import { DefaultActionExecutor } from '../control/action-executor';
import { getGlobalRegistry, resetGlobalRegistry } from '../core/registry';

describe('NLActionExecutor page scroll with the real action executor', () => {
  const nativeScrollBy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollBy');

  afterEach(() => {
    vi.restoreAllMocks();
    resetGlobalRegistry();
    if (nativeScrollBy) Object.defineProperty(HTMLElement.prototype, 'scrollBy', nativeScrollBy);
    else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollBy;
  });

  it('scrolls the page scroll container through the document sentinel', async () => {
    // jsdom implements no element scrolling; a stub lets the spy observe it.
    if (!nativeScrollBy) {
      HTMLElement.prototype.scrollBy = function () {} as HTMLElement['scrollBy'];
    }
    const containerScroll = vi.spyOn(HTMLElement.prototype, 'scrollBy');
    const windowScroll = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});

    const nl = createNLActionExecutor();
    nl.setActionExecutor(new DefaultActionExecutor(getGlobalRegistry()));

    const response = await nl.execute({ instruction: 'scroll down' });

    expect(response.success, response.error).toBe(true);
    expect(response.elementUsed.id).toBe('page');
    expect(containerScroll).toHaveBeenCalledWith(expect.objectContaining({ top: 300 }));
    // A plain document: the viewport scrolls, through the root element.
    const root = document.scrollingElement ?? document.documentElement;
    expect(containerScroll.mock.contexts[0]).toBe(root);

    const left = await nl.execute({ instruction: 'scroll left' });
    expect(left.success, left.error).toBe(true);
    expect(containerScroll).toHaveBeenLastCalledWith(expect.objectContaining({ left: -300 }));
    expect(containerScroll.mock.contexts.at(-1)).toBe(root);
    expect(windowScroll).not.toHaveBeenCalled();
  });

  it('scrolls the viewport, not the body, when the body content merely overflows', async () => {
    if (!nativeScrollBy) {
      HTMLElement.prototype.scrollBy = function () {} as HTMLElement['scrollBy'];
    }
    // Standards-mode page whose body content overflows the body box while
    // <html> (the viewport) is the real scroller: body.scrollBy is a no-op.
    vi.spyOn(document.body, 'scrollHeight', 'get').mockReturnValue(5000);
    vi.spyOn(document.body, 'clientHeight', 'get').mockReturnValue(800);
    const containerScroll = vi.spyOn(HTMLElement.prototype, 'scrollBy');

    const nl = createNLActionExecutor();
    nl.setActionExecutor(new DefaultActionExecutor(getGlobalRegistry()));
    const response = await nl.execute({ instruction: 'scroll down' });

    expect(response.success, response.error).toBe(true);
    expect(containerScroll.mock.contexts[0]).not.toBe(document.body);
    expect(containerScroll.mock.contexts[0]).toBe(
      document.scrollingElement ?? document.documentElement
    );
  });
});
