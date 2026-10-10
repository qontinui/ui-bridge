/**
 * `scrollIntoView` on native (plan 2026-10-07-mobile-account-usage-iter2-residuals,
 * Phase 4). Before this, the executor's switch had no case and the action
 * failed with "Unknown action: scrollIntoView".
 *
 * The fake below models one vertical ScrollView whose frame sits at window
 * y=100..600, scrolled to offset `s`. A child at content y `contentY` reports
 * `pageY = 100 + contentY - s` from `measureInWindow` and `y = contentY` from
 * `measureLayout` relative to the ScrollView's inner view — the same split
 * React Native makes.
 */
import { describe, it, expect } from 'vitest';
import { DefaultNativeActionExecutor } from './action-executor';
import { NativeUIBridgeRegistry, pageRectOf } from '../core/registry';
import type { NativeElementRef } from '../core/types';
import type { ScrollIntoViewResult } from './types';

const FRAME_TOP = 100;
const FRAME_HEIGHT = 500;
const WINDOW = { width: 400, height: 800 };

interface World {
  registry: NativeUIBridgeRegistry;
  executor: DefaultNativeActionExecutor;
  scroll: { y: number; calls: Array<{ y?: number; animated?: boolean }> };
}

function makeWorld(opts: {
  contentY: number;
  initialOffset?: number;
  declareAncestor?: boolean;
  innerView?: boolean;
  flatList?: boolean;
}): World {
  const registry = new NativeUIBridgeRegistry();
  registry.setViewportProvider(() => WINDOW);
  const scroll = { y: opts.initialOffset ?? 0, calls: [] as World['scroll']['calls'] };
  const innerToken = { inner: true };

  const scrollViewNode = {
    scrollTo: (o: { y?: number; animated?: boolean }) => {
      scroll.calls.push(o);
      scroll.y = o.y ?? scroll.y;
    },
    measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) =>
      cb(0, FRAME_TOP, WINDOW.width, FRAME_HEIGHT),
    ...(opts.innerView === false ? {} : { getInnerViewRef: () => innerToken }),
  };
  // A FlatList ref has no scrollTo of its own; it exposes the ScrollView.
  const ancestorNode = opts.flatList
    ? { measureInWindow: scrollViewNode.measureInWindow, getNativeScrollRef: () => scrollViewNode }
    : scrollViewNode;
  registry.registerElement(
    'operations-overview',
    { current: ancestorNode as unknown as NativeElementRef },
    { type: 'scroll' }
  );

  const cardNode = {
    measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) =>
      cb(16, FRAME_TOP + opts.contentY - scroll.y, 368, 120),
    measureLayout: (
      relativeTo: unknown,
      onSuccess: (x: number, y: number, w: number, h: number) => void,
      onFail?: () => void
    ) => (relativeTo === innerToken ? onSuccess(16, opts.contentY, 368, 120) : onFail?.()),
  };
  registry.registerElement(
    'account-usage-card',
    { current: cardNode as unknown as NativeElementRef },
    {
      type: 'view',
      ...(opts.declareAncestor === false ? {} : { scrollAncestorId: 'operations-overview' }),
    }
  );

  return { registry, executor: new DefaultNativeActionExecutor(registry), scroll };
}

describe('native scrollIntoView', () => {
  it('scrolls an element inside its declared scroll ancestor so its pageY lands in the viewport', async () => {
    const { registry, executor, scroll } = makeWorld({ contentY: 1400 });

    const res = await executor.executeAction('account-usage-card', { action: 'scrollIntoView' });

    expect(res.success).toBe(true);
    const result = res.result as ScrollIntoViewResult;
    expect(result.scrolled).toBe(true);
    expect(result.alreadyVisible).toBe(false);
    expect(result.inView).toBe(true);
    expect(result.scrollAncestorId).toBe('operations-overview');
    // content y 1400 minus the default 16dp padding
    expect(scroll.calls).toEqual([{ y: 1384, animated: false }]);

    const rect = pageRectOf(registry.getElement('account-usage-card')!.getState());
    expect(rect).not.toBeNull();
    expect(rect!.top).toBeGreaterThanOrEqual(FRAME_TOP);
    expect(rect!.top).toBeLessThan(FRAME_TOP + FRAME_HEIGHT);
    expect(rect!.top).toBeLessThan(WINDOW.height);
  });

  it('is content-relative, so an unknown starting offset does not matter', async () => {
    const { executor, scroll } = makeWorld({ contentY: 1400, initialOffset: 2000 });

    const res = await executor.executeAction('account-usage-card', { action: 'scrollIntoView' });

    expect(res.success).toBe(true);
    expect(scroll.calls).toEqual([{ y: 1384, animated: false }]);
  });

  it('drives the ScrollView behind a FlatList ref, which has no scrollTo of its own', async () => {
    const { executor, scroll } = makeWorld({ contentY: 1400, flatList: true });

    const res = await executor.executeAction('account-usage-card', { action: 'scrollIntoView' });

    expect(res.success).toBe(true);
    expect(scroll.calls).toEqual([{ y: 1384, animated: false }]);
  });

  it('short-circuits when the element is already visible (web parity)', async () => {
    const { executor, scroll } = makeWorld({ contentY: 50 });

    const res = await executor.executeAction('account-usage-card', { action: 'scrollIntoView' });

    expect(res.success).toBe(true);
    expect(res.result).toMatchObject({ alreadyVisible: true, scrolled: false });
    expect(scroll.calls).toHaveLength(0);
  });

  it('honours an explicit padding', async () => {
    const { executor, scroll } = makeWorld({ contentY: 1400 });

    await executor.executeAction('account-usage-card', {
      action: 'scrollIntoView',
      params: { padding: 0 },
    });

    expect(scroll.calls).toEqual([{ y: 1400, animated: false }]);
  });

  it('with no declared scroll ancestor fails with a typed NOT_SUPPORTED, not "Unknown action"', async () => {
    const { executor, scroll } = makeWorld({ contentY: 1400, declareAncestor: false });

    const res = await executor.executeAction('account-usage-card', { action: 'scrollIntoView' });

    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('NOT_SUPPORTED');
    expect(res.error).not.toContain('Unknown action');
    expect(res.error).toContain('scrollAncestorId');
    expect(scroll.calls).toHaveLength(0);
  });

  it('fails NOT_SUPPORTED when the ancestor exposes no inner content view', async () => {
    const { executor, scroll } = makeWorld({ contentY: 1400, innerView: false });

    const res = await executor.executeAction('account-usage-card', { action: 'scrollIntoView' });

    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('NOT_SUPPORTED');
    expect(scroll.calls).toHaveLength(0);
  });

  it('is advertised on a plain view element, so the runner does not refuse it pre-IPC', () => {
    const { registry } = makeWorld({ contentY: 0 });
    expect(registry.getElement('account-usage-card')!.actions).toContain('scrollIntoView');
  });
});
