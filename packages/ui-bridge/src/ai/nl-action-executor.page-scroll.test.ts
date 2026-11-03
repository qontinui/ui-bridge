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
  afterEach(() => {
    vi.restoreAllMocks();
    resetGlobalRegistry();
  });

  it('scrolls the page scroll container through the document sentinel', async () => {
    if (!HTMLElement.prototype.scrollBy) {
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
    const target = containerScroll.mock.contexts[0];
    expect([document.documentElement, document.body]).toContain(target);
    expect(windowScroll).not.toHaveBeenCalled();
  });
});
