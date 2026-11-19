/**
 * Relay `executeElementAction` scrollIntoView / scroll / click-on-<details>
 * honesty, and `pageScroll` with a container target.
 *
 * jsdom has no layout: `control/scroll-test-fixture.ts` models the inner
 * container and the child's rect as a function of `scrollTop`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeCommand, type BridgeAccess } from './commandHandlers';
import { getGlobalRegistry } from '../core/registry';
import { innerScrollFixture, type InnerScrollFixture } from '../control/scroll-test-fixture';

const emptyBridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
};

type Result = Record<string, unknown> & {
  failureDetails?: { errorCode?: string };
};

async function act(id: string, action: string, params?: unknown): Promise<Result> {
  return (await executeCommand(
    'executeElementAction',
    { id, request: { action, params } },
    emptyBridge
  )) as Result;
}

describe('relay executeElementAction - scrollIntoView honesty', () => {
  let fx: InnerScrollFixture | undefined;

  afterEach(() => {
    fx?.remove();
    fx = undefined;
    getGlobalRegistry().clear();
    vi.restoreAllMocks();
  });

  it('a child clipped by an inner container (inside the window) is not alreadyVisible and scrolls the container', async () => {
    fx = innerScrollFixture({ childOffset: 600, native: 'scrolls' });
    getGlobalRegistry().registerElement('row', fx.child, { type: 'generic', label: 'Row' });
    const result = await act('row', 'scrollIntoView', { smooth: false });
    expect(result.success, String(result.error)).toBe(true);
    expect(result.alreadyVisible).toBe(false);
    expect(result.scrolled).toBe(true);
    expect(fx.container.scrollTop).toBeGreaterThan(0);
  });

  it('a child already visible in its container is alreadyVisible', async () => {
    fx = innerScrollFixture({ childOffset: 50, native: 'scrolls' });
    getGlobalRegistry().registerElement('row', fx.child, { type: 'generic', label: 'Row' });
    const result = await act('row', 'scrollIntoView');
    expect(result.success, String(result.error)).toBe(true);
    expect(result.alreadyVisible).toBe(true);
    expect(fx.child.scrollIntoView).not.toHaveBeenCalled();
  });

  it('a native scrollIntoView that moves nothing fails with NO_SCROLL_EFFECT', async () => {
    fx = innerScrollFixture({ childOffset: 600, native: 'noop', overflow: 'hidden' });
    getGlobalRegistry().registerElement('row', fx.child, { type: 'generic', label: 'Row' });
    const result = await act('row', 'scrollIntoView', { smooth: false });
    expect(result.success).toBe(false);
    expect(result.failureDetails?.errorCode).toBe('NO_SCROLL_EFFECT');
  });

  it('element scroll that moves nothing fails with NO_SCROLL_EFFECT', async () => {
    fx = innerScrollFixture({ childOffset: 600, native: 'noop' });
    fx.container.scrollBy = (() => {}) as typeof fx.container.scrollBy;
    getGlobalRegistry().registerElement('box', fx.container, { type: 'generic', label: 'Box' });
    const result = await act('box', 'scroll', { direction: 'down' });
    expect(result.success).toBe(false);
    expect(result.failureDetails?.errorCode).toBe('NO_SCROLL_EFFECT');
  });

  it('NO_SCROLL_EFFECT envelope: top-level code, errorCode and scrollInfo context', async () => {
    fx = innerScrollFixture({ childOffset: 600, native: 'noop' });
    fx.container.scrollBy = (() => {}) as typeof fx.container.scrollBy;
    getGlobalRegistry().registerElement('box', fx.container, { type: 'generic', label: 'Box' });
    const result = (await act('box', 'scroll', { direction: 'down' })) as Result & {
      code?: string;
      failureDetails?: { context?: { scrollInfo?: { changed: boolean } } };
    };
    expect(result.code).toBe('NO_SCROLL_EFFECT');
    expect(result.failureDetails?.errorCode).toBe('NO_SCROLL_EFFECT');
    expect(result.failureDetails?.context?.scrollInfo?.changed).toBe(false);
  });

  it('smooth element scroll that lands after the first frames is a success', async () => {
    fx = innerScrollFixture({ childOffset: 600, native: 'noop' });
    const box = fx.container;
    box.scrollBy = ((o: ScrollToOptions) => {
      // A smooth scroll starts late and then animates.
      setTimeout(() => (box.scrollTop += (o.top ?? 0) / 2), 60);
      setTimeout(() => (box.scrollTop += (o.top ?? 0) / 2), 90);
    }) as typeof box.scrollBy;
    getGlobalRegistry().registerElement('box', box, { type: 'generic', label: 'Box' });
    const result = await act('box', 'scroll', { direction: 'down', amount: 100, smooth: true });
    expect(result.success, String(result.error)).toBe(true);
    expect(box.scrollTop).toBe(100);
  });

  it('scrollIntoView that moves an ancestor but leaves the element hidden fails', async () => {
    fx = innerScrollFixture({ childOffset: 900, native: 'noop' });
    const box = fx.container;
    // Moves the container a little; the child stays below its clip box.
    Object.defineProperty(fx.child, 'scrollIntoView', {
      configurable: true,
      value: () => {
        box.scrollTop = 10;
      },
    });
    getGlobalRegistry().registerElement('row', fx.child, { type: 'generic', label: 'Row' });
    const result = await act('row', 'scrollIntoView', { smooth: false });
    expect(result.success).toBe(false);
    expect(result.failureDetails?.errorCode).toBe('NO_SCROLL_EFFECT');
  });

  it('element scroll that moves the container succeeds', async () => {
    fx = innerScrollFixture({ childOffset: 600, native: 'noop' });
    const box = fx.container;
    box.scrollBy = ((o: ScrollToOptions) => {
      box.scrollTop += o.top ?? 0;
    }) as typeof box.scrollBy;
    getGlobalRegistry().registerElement('box', box, { type: 'generic', label: 'Box' });
    const result = await act('box', 'scroll', { direction: 'down', amount: 100 });
    expect(result.success, String(result.error)).toBe(true);
    expect(box.scrollTop).toBe(100);
  });
});

describe('relay pageScroll - container target', () => {
  let fx: InnerScrollFixture | undefined;

  afterEach(() => {
    fx?.remove();
    fx = undefined;
    getGlobalRegistry().clear();
    vi.restoreAllMocks();
  });

  function scrollable(): HTMLDivElement {
    fx = innerScrollFixture({ childOffset: 600, native: 'noop' });
    const box = fx.container;
    box.setAttribute('data-test', 'pane');
    box.scrollBy = ((o: ScrollToOptions) => {
      box.scrollTop += o.top ?? 0;
    }) as typeof box.scrollBy;
    return box;
  }

  it('scrolls the container a selector names', async () => {
    const box = scrollable();
    const result = (await executeCommand(
      'pageScroll',
      { top: 150, selector: '[data-test="pane"]' },
      emptyBridge
    )) as Result;
    expect(result.success, String(result.error)).toBe(true);
    expect(result.changed).toBe(true);
    expect(box.scrollTop).toBe(150);
  });

  it('scrolls the container an elementId names', async () => {
    const box = scrollable();
    getGlobalRegistry().registerElement('pane', box, { type: 'generic', label: 'Pane' });
    const result = (await executeCommand(
      'pageScroll',
      { top: 90, elementId: 'pane' },
      emptyBridge
    )) as Result;
    expect(result.success, String(result.error)).toBe(true);
    expect(box.scrollTop).toBe(90);
  });

  it('a selector matching nothing fails with ELEMENT_NOT_FOUND', async () => {
    const result = (await executeCommand(
      'pageScroll',
      { top: 100, selector: '#nope' },
      emptyBridge
    )) as Result;
    expect(result.success).toBe(false);
    expect(result.code).toBe('ELEMENT_NOT_FOUND');
  });

  it('a named container that does not move fails with NO_SCROLL_EFFECT', async () => {
    const box = scrollable();
    box.scrollBy = (() => {}) as typeof box.scrollBy;
    const result = (await executeCommand(
      'pageScroll',
      { top: 100, selector: '[data-test="pane"]' },
      emptyBridge
    )) as Result;
    expect(result.success).toBe(false);
    expect(result.code).toBe('NO_SCROLL_EFFECT');
    expect(result.changed).toBe(false);
  });
});

describe('relay executeElementAction - click on <details>', () => {
  afterEach(() => {
    getGlobalRegistry().clear();
    document.body.innerHTML = '';
  });

  function make(withSummary: boolean): HTMLDetailsElement {
    const details = document.createElement('details');
    if (withSummary) {
      const summary = document.createElement('summary');
      summary.textContent = 'More';
      details.appendChild(summary);
    }
    Object.defineProperty(details, 'offsetParent', {
      configurable: true,
      get: () => document.body,
    });
    document.body.appendChild(details);
    return details;
  }

  it('toggles it through its <summary>', async () => {
    const details = make(true);
    getGlobalRegistry().registerElement('d', details, { type: 'generic', label: 'More' });
    const result = await act('d', 'click');
    expect(result.success, String(result.error)).toBe(true);
    expect(details.open).toBe(true);
  });

  it('is refused, naming toggle, when there is no <summary>', async () => {
    const details = make(false);
    getGlobalRegistry().registerElement('d', details, { type: 'generic', label: 'Bare' });
    const result = await act('d', 'click');
    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/toggle/);
    expect(details.open).toBe(false);
  });
});
