/**
 * Which element the RELAY `executeElementAction` scroll moves.
 *
 * `react/commandHandlers.ts` carries its own scroll-target walk, separate from
 * `DefaultActionExecutor.findScrollableElement`. Both resolve "the page" via
 * `pageScrollContainer`, so a page whose body content merely overflows scrolls
 * the viewport rather than no-op scrolling the body, and both walks start at
 * the element itself, so a registered scroll container scrolls itself.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeCommand, type BridgeAccess } from './commandHandlers';
import { getGlobalRegistry, resetGlobalRegistry } from '../core/registry';

const emptyBridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
};

/** jsdom has no layout: give `el` an overflowing box. */
function overflowing(el: HTMLElement): void {
  vi.spyOn(el, 'scrollHeight', 'get').mockReturnValue(5000);
  vi.spyOn(el, 'clientHeight', 'get').mockReturnValue(800);
}

async function relayScroll(id: string): Promise<Record<string, unknown>> {
  return (await executeCommand(
    'executeElementAction',
    { id, request: { action: 'scroll', params: { direction: 'down' } } },
    emptyBridge
  )) as Record<string, unknown>;
}

describe('relay executeElementAction · scroll target', () => {
  const nativeScrollBy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollBy');

  afterEach(() => {
    vi.restoreAllMocks();
    resetGlobalRegistry();
    document.body.innerHTML = '';
    if (nativeScrollBy) Object.defineProperty(HTMLElement.prototype, 'scrollBy', nativeScrollBy);
    else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollBy;
  });

  function spyScroll() {
    if (!nativeScrollBy) {
      HTMLElement.prototype.scrollBy = function () {} as HTMLElement['scrollBy'];
    }
    return vi.spyOn(HTMLElement.prototype, 'scrollBy');
  }

  it('scrolls the viewport, not the body, for the page sentinel when the body merely overflows', async () => {
    overflowing(document.body);
    const scroll = spyScroll();
    const result = await relayScroll('document');
    expect(result.success, String(result.error)).toBe(true);
    expect(scroll.mock.contexts[0]).toBe(document.scrollingElement ?? document.documentElement);
  });

  it('scrolls a registered scroll container itself, even on an overflowing page', async () => {
    overflowing(document.body);
    const list = document.createElement('div');
    list.style.overflowY = 'auto';
    overflowing(list);
    Object.defineProperty(list, 'offsetParent', { configurable: true, get: () => document.body });
    document.body.appendChild(list);
    getGlobalRegistry().registerElement('results-list', list, {
      type: 'generic',
      label: 'Results',
      actions: ['scroll'],
    });
    const scroll = spyScroll();
    const result = await relayScroll('results-list');
    expect(result.success, String(result.error)).toBe(true);
    expect(scroll.mock.contexts[0]).toBe(list);
  });
});
