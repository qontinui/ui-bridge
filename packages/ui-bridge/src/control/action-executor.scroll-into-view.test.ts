/**
 * `scrollIntoView` / `scroll` on the executor must not report success over a
 * no-op, and must not call an element clipped by an inner scroll container
 * "already visible" just because it is inside the window box.
 *
 * jsdom has no layout: `scroll-test-fixture.ts` models the container and the
 * child's rect as a function of `scrollTop`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { UIBridgeRegistry } from '../core/registry';
import { DefaultActionExecutor } from './action-executor';
import { innerScrollFixture, type InnerScrollFixture } from './scroll-test-fixture';

describe('DefaultActionExecutor - scrollIntoView honesty', () => {
  let registry: UIBridgeRegistry;
  let executor: DefaultActionExecutor;
  let fx: InnerScrollFixture | undefined;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    executor = new DefaultActionExecutor(registry);
  });

  afterEach(() => {
    fx?.remove();
    fx = undefined;
    vi.restoreAllMocks();
  });

  it('an element clipped by an inner container (but inside the window) is NOT alreadyVisible; it scrolls the container', async () => {
    // Child at y=100+600=700 is inside the window (768) yet below the container's bottom (300).
    fx = innerScrollFixture({ childOffset: 600, native: 'scrolls' });
    registry.registerElement('row', fx.child, { type: 'generic', label: 'Row' });
    const result = await executor.executeAction('row', { action: 'scrollIntoView' });
    expect(result.success, String(result.error)).toBe(true);
    const r = result.result as { alreadyVisible: boolean; scrolled: boolean };
    expect(r.alreadyVisible).toBe(false);
    expect(r.scrolled).toBe(true);
    expect(fx.container.scrollTop).toBeGreaterThan(0);
  });

  it('an element visible inside its container is alreadyVisible and scrolls nothing', async () => {
    fx = innerScrollFixture({ childOffset: 50, native: 'scrolls' });
    registry.registerElement('row', fx.child, { type: 'generic', label: 'Row' });
    const result = await executor.executeAction('row', { action: 'scrollIntoView' });
    expect(result.success, String(result.error)).toBe(true);
    expect((result.result as { alreadyVisible: boolean }).alreadyVisible).toBe(true);
    expect(fx.child.scrollIntoView).not.toHaveBeenCalled();
  });

  it('a half-cut element in a scrollable overflow:hidden container is scrolled, not alreadyVisible', async () => {
    fx = innerScrollFixture({ childOffset: 180, native: 'scrolls', overflow: 'hidden' });
    registry.registerElement('row', fx.child, { type: 'generic', label: 'Row' });
    const result = await executor.executeAction('row', { action: 'scrollIntoView' });
    expect(result.success, String(result.error)).toBe(true);
    const r = result.result as { alreadyVisible: boolean; scrolled: boolean };
    expect(r.alreadyVisible).toBe(false);
    expect(r.scrolled).toBe(true);
    expect(fx.container.scrollTop).toBeGreaterThan(0);
  });

  it('a native scrollIntoView that moves nothing fails with NO_SCROLL_EFFECT', async () => {
    fx = innerScrollFixture({ childOffset: 600, native: 'noop', overflow: 'hidden' });
    registry.registerElement('row', fx.child, { type: 'generic', label: 'Row' });
    const result = await executor.executeAction('row', { action: 'scrollIntoView' });
    expect(result.success).toBe(false);
    expect(result.code).toBe('NO_SCROLL_EFFECT');
    expect(fx.container.scrollTop).toBe(0);
  });
});

describe('DefaultActionExecutor - scroll honesty', () => {
  let registry: UIBridgeRegistry;
  let executor: DefaultActionExecutor;
  let fx: InnerScrollFixture | undefined;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    executor = new DefaultActionExecutor(registry);
  });

  afterEach(() => {
    fx?.remove();
    fx = undefined;
    vi.restoreAllMocks();
  });

  it('scrolling a scrollable container reports success with changed:true', async () => {
    fx = innerScrollFixture({ childOffset: 600, native: 'noop' });
    const box = fx.container;
    box.scrollBy = ((o: ScrollToOptions) => {
      box.scrollTop += o.top ?? 0;
    }) as typeof box.scrollBy;
    registry.registerElement('box', box, { type: 'generic', label: 'Box' });
    const result = await executor.executeAction('box', {
      action: 'scroll',
      params: { direction: 'down', amount: 120 },
    });
    expect(result.success, String(result.error)).toBe(true);
    expect(box.scrollTop).toBe(120);
    expect((result.result as { scrollInfo: { changed: boolean } }).scrollInfo.changed).toBe(true);
  });

  it('scrolling that moves nothing fails with NO_SCROLL_EFFECT and keeps changed:false', async () => {
    fx = innerScrollFixture({ childOffset: 600, native: 'noop' });
    const box = fx.container;
    box.scrollBy = (() => {}) as typeof box.scrollBy;
    registry.registerElement('box', box, { type: 'generic', label: 'Box' });
    const result = await executor.executeAction('box', {
      action: 'scroll',
      params: { direction: 'down' },
    });
    expect(result.success).toBe(false);
    expect(result.code).toBe('NO_SCROLL_EFFECT');
    const ctx = (result.failureDetails as { context?: { scrollInfo?: { changed: boolean } } })
      .context;
    expect(ctx?.scrollInfo?.changed).toBe(false);
    expect((result.failureDetails as { errorCode?: string }).errorCode).toBe('NO_SCROLL_EFFECT');
  });
});

describe('DefaultActionExecutor - click on <details>', () => {
  let registry: UIBridgeRegistry;
  let executor: DefaultActionExecutor;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    executor = new DefaultActionExecutor(registry);
  });

  it('click on a <details> toggles it through its <summary>', async () => {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'More';
    details.appendChild(summary);
    document.body.appendChild(details);
    try {
      registry.registerElement('d', details, { type: 'generic', label: 'More' });
      expect(details.open).toBe(false);
      const result = await executor.executeAction('d', { action: 'click' });
      expect(result.success, String(result.error)).toBe(true);
      expect(details.open).toBe(true);
    } finally {
      details.remove();
    }
  });

  it('click on a <details> with no <summary> is refused, naming toggle', async () => {
    const details = document.createElement('details');
    document.body.appendChild(details);
    try {
      registry.registerElement('d', details, { type: 'generic', label: 'Bare' });
      const result = await executor.executeAction('d', { action: 'click' });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/toggle/);
      expect(details.open).toBe(false);
    } finally {
      details.remove();
    }
  });
});
