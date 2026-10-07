/**
 * `scrollIntoView` on the native executor (plan
 * `2026-10-07-mobile-account-usage-iter2-residuals`, Phase 4).
 *
 * Defect this closes: `POST /control/element/account-usage-card/action
 * {"action":"scrollIntoView"}` answered `Unknown action: scrollIntoView`. The
 * container is the element's DECLARED `scrollAncestorId` (the registry keeps no
 * parent chain), and the target offset is measured content-relative with
 * `measureLayout` against the container's inner view.
 */

import { describe, it, expect, vi } from 'vitest';
import { DefaultNativeActionExecutor, NativeActionError } from './action-executor';
import { NativeUIBridgeRegistry } from '../core/registry';
import { NativeUIBridgeServer } from '../server/http-server';
import { NATIVE_STANDARD_ACTION_EFFECTS } from '../core/action-effect';
import type { NativeElementRef } from '../core/types';

const WINDOW = { width: 393, height: 830 };
const INNER_VIEW = { tag: 'inner-content-view' };

function asRef(current: Record<string, unknown> | null): React.RefObject<NativeElementRef> {
  return { current: current as unknown as NativeElementRef };
}

/** A ScrollView-shaped ref: `scrollTo` plus an inner-view accessor. */
function makeScrollViewRef(overrides: Record<string, unknown> = {}) {
  const scrollTo = vi.fn();
  const current = { scrollTo, getInnerViewRef: () => INNER_VIEW, ...overrides };
  return { ref: asRef(current), scrollTo };
}

/** A host-view ref whose `measureLayout` reports `contentY` relative to the inner view. */
function makeTargetRef(contentY: number) {
  const measureLayout = vi.fn(
    (relativeTo: unknown, onSuccess: (x: number, y: number, w: number, h: number) => void) => {
      if (relativeTo !== INNER_VIEW) throw new Error('measured against the wrong node');
      onSuccess(0, contentY, 393, 120);
    }
  );
  return { ref: asRef({ measureLayout }), measureLayout };
}

function measure(registry: NativeUIBridgeRegistry, id: string, pageY: number, height: number) {
  registry.updateElementState(id, {
    visible: true,
    layout: { x: 0, y: pageY, width: 393, height, pageX: 0, pageY },
  });
}

/** Window 393x830; ScrollView `operations-overview` spanning pageY 64 -> 639. */
function setup(options: { scrollViewOverrides?: Record<string, unknown>; contentY?: number } = {}) {
  const registry = new NativeUIBridgeRegistry();
  registry.setViewportProvider(() => WINDOW);
  const scroll = makeScrollViewRef(options.scrollViewOverrides);
  registry.registerElement('operations-overview', scroll.ref, { type: 'scroll' });
  measure(registry, 'operations-overview', 64, 575);
  const target = makeTargetRef(options.contentY ?? 1400);
  registry.registerElement('account-usage-card', target.ref, {
    type: 'view',
    scrollAncestorId: 'operations-overview',
  });
  const executor = new DefaultNativeActionExecutor(registry);
  return { registry, executor, scroll, target };
}

describe('scrollIntoView — success path', () => {
  it('scrolls the declared ancestor to the measured content y minus the default padding', async () => {
    const { registry, executor, scroll, target } = setup({ contentY: 1400 });
    measure(registry, 'account-usage-card', 1500, 120); // far below the container

    const res = await executor.executeAction('account-usage-card', { action: 'scrollIntoView' });

    expect(res.success).toBe(true);
    expect(res.result).toEqual({ alreadyVisible: false, scrolled: true });
    expect(target.measureLayout).toHaveBeenCalledTimes(1);
    expect(scroll.scrollTo).toHaveBeenCalledWith({ y: 1384, animated: false });
  });

  it('honours an explicit padding and clamps the offset at 0', async () => {
    const { executor, scroll } = setup({ contentY: 10 });

    const res = await executor.executeAction('account-usage-card', {
      action: 'scrollIntoView',
      params: { padding: 40 },
    });

    expect(res.success).toBe(true);
    expect(scroll.scrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
  });

  it('falls back to getInnerViewNode when getInnerViewRef is absent', async () => {
    const { executor, scroll } = setup({
      scrollViewOverrides: { getInnerViewRef: undefined, getInnerViewNode: () => INNER_VIEW },
      contentY: 500,
    });

    const res = await executor.executeAction('account-usage-card', { action: 'scrollIntoView' });

    expect(res.success).toBe(true);
    expect(scroll.scrollTo).toHaveBeenCalledWith({ y: 484, animated: false });
  });

  it('scrolls when visibility cannot be determined (never measured)', async () => {
    const { executor, scroll } = setup({ contentY: 300 });
    // No layout for the target — "already visible" is UNKNOWN, so it scrolls.

    const res = await executor.executeAction('account-usage-card', { action: 'scrollIntoView' });

    expect(res.result).toEqual({ alreadyVisible: false, scrolled: true });
    expect(scroll.scrollTo).toHaveBeenCalledTimes(1);
  });

  it('fails (not NOT_SUPPORTED) when measureLayout reports failure', async () => {
    const { registry, executor, scroll } = setup();
    registry.registerElement(
      'account-usage-card',
      asRef({
        measureLayout: (_r: unknown, _ok: unknown, onFail: () => void) => onFail(),
      }),
      { type: 'view', scrollAncestorId: 'operations-overview' }
    );

    const res = await executor.executeAction('account-usage-card', { action: 'scrollIntoView' });

    expect(res.success).toBe(false);
    expect(res.code).toBeUndefined();
    expect(res.error).toContain('measureLayout failed');
    expect(scroll.scrollTo).not.toHaveBeenCalled();
  });

  it('refuses a negative padding', async () => {
    const { executor, scroll } = setup();
    const res = await executor.executeAction('account-usage-card', {
      action: 'scrollIntoView',
      params: { padding: -5 },
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain('padding');
    expect(scroll.scrollTo).not.toHaveBeenCalled();
  });
});

describe('scrollIntoView — already-visible short-circuit', () => {
  it('returns alreadyVisible without scrolling when fully inside window ∩ container', async () => {
    const { registry, executor, scroll, target } = setup();
    measure(registry, 'account-usage-card', 200, 120); // 200 -> 320, inside 64 -> 639

    const res = await executor.executeAction('account-usage-card', { action: 'scrollIntoView' });

    expect(res.success).toBe(true);
    expect(res.result).toEqual({ alreadyVisible: true, scrolled: false });
    expect(scroll.scrollTo).not.toHaveBeenCalled();
    expect(target.measureLayout).not.toHaveBeenCalled();
  });

  it('re-measures before deciding, so a stale on-screen layout does not short-circuit', async () => {
    const { registry, executor, scroll } = setup({ contentY: 1400 });
    // Re-register with a live measureInWindow that reports the row far below.
    registry.registerElement(
      'account-usage-card',
      asRef({
        measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) =>
          cb(0, 1500, 393, 120),
        measureLayout: (
          _r: unknown,
          onSuccess: (x: number, y: number, w: number, h: number) => void
        ) => onSuccess(0, 1400, 393, 120),
      }),
      { type: 'view', scrollAncestorId: 'operations-overview' }
    );
    measure(registry, 'account-usage-card', 200, 120); // STALE: claims on screen

    const res = await executor.executeAction('account-usage-card', { action: 'scrollIntoView' });

    expect(res.result).toEqual({ alreadyVisible: false, scrolled: true });
    expect(scroll.scrollTo).toHaveBeenCalledWith({ y: 1384, animated: false });
  });

  it('scrolls a PARTIALLY visible element (straddling the container bottom)', async () => {
    const { registry, executor, scroll } = setup({ contentY: 600 });
    measure(registry, 'account-usage-card', 600, 120); // 600 -> 720, container ends 639

    const res = await executor.executeAction('account-usage-card', { action: 'scrollIntoView' });

    expect(res.result).toEqual({ alreadyVisible: false, scrolled: true });
    expect(scroll.scrollTo).toHaveBeenCalledTimes(1);
  });
});

describe('scrollIntoView — NOT_SUPPORTED', () => {
  it('when the element declares no scrollAncestorId', async () => {
    const registry = new NativeUIBridgeRegistry();
    const target = makeTargetRef(100);
    registry.registerElement('loose', target.ref, { type: 'view' });
    const executor = new DefaultNativeActionExecutor(registry);

    const res = await executor.executeAction('loose', { action: 'scrollIntoView' });

    expect(res.success).toBe(false);
    expect(res.code).toBe('NOT_SUPPORTED');
    expect(res.error).toContain('scrollAncestorId');
    expect(target.measureLayout).not.toHaveBeenCalled();
  });

  it('when the declared ancestor ref has no scrollTo', async () => {
    const { executor, target } = setup({ scrollViewOverrides: { scrollTo: undefined } });

    const res = await executor.executeAction('account-usage-card', { action: 'scrollIntoView' });

    expect(res.success).toBe(false);
    expect(res.code).toBe('NOT_SUPPORTED');
    expect(res.error).toContain('scrollTo');
    expect(target.measureLayout).not.toHaveBeenCalled();
  });

  it('when the declared ancestor is not registered', async () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('orphan', makeTargetRef(0).ref, {
      type: 'view',
      scrollAncestorId: 'missing-scroll',
    });
    const res = await new DefaultNativeActionExecutor(registry).executeAction('orphan', {
      action: 'scrollIntoView',
    });
    expect(res.code).toBe('NOT_SUPPORTED');
    expect(res.error).toContain('missing-scroll');
  });

  it('when no inner-view handle resolves', async () => {
    const { executor, scroll } = setup({ scrollViewOverrides: { getInnerViewRef: undefined } });

    const res = await executor.executeAction('account-usage-card', { action: 'scrollIntoView' });

    expect(res.code).toBe('NOT_SUPPORTED');
    expect(res.error).toContain('inner content view');
    expect(scroll.scrollTo).not.toHaveBeenCalled();
  });

  it('is checked before the already-visible short-circuit', async () => {
    const { registry, executor } = setup({ scrollViewOverrides: { scrollTo: undefined } });
    measure(registry, 'account-usage-card', 200, 120); // fully visible

    const res = await executor.executeAction('account-usage-card', { action: 'scrollIntoView' });

    expect(res.code).toBe('NOT_SUPPORTED');
  });

  it('reaches the wire as 501 NOT_SUPPORTED, not a retryable 400', async () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('loose', makeTargetRef(0).ref, { type: 'view' });
    const server = new NativeUIBridgeServer(registry, new DefaultNativeActionExecutor(registry));

    const res = await server.handleRequest({
      method: 'POST',
      path: '/ui-bridge/control/element/loose/action',
      headers: {},
      query: {},
      body: { action: 'scrollIntoView' },
    });

    expect(res.status).toBe(501);
    expect((JSON.parse(res.body) as { code?: string }).code).toBe('NOT_SUPPORTED');
  });

  it('exports a typed error carrying the code', () => {
    expect(new NativeActionError('x', 'NOT_SUPPORTED').code).toBe('NOT_SUPPORTED');
  });
});

describe('scrollIntoView — declaration', () => {
  it('is advertised only on elements that declare a scrollAncestorId', () => {
    const { registry } = setup();
    registry.registerElement('loose', asRef({}), { type: 'view' });

    expect(registry.getElement('account-usage-card')?.actions).toContain('scrollIntoView');
    expect(registry.getElement('loose')?.actions).not.toContain('scrollIntoView');
  });

  it('is classified as a read', () => {
    expect(NATIVE_STANDARD_ACTION_EFFECTS.scrollIntoView).toBe('read');
  });
});

describe('scrollIntoView — review follow-ups', () => {
  it('does not short-circuit on the window alone when the container is unmeasured', async () => {
    const registry = new NativeUIBridgeRegistry();
    registry.setViewportProvider(() => WINDOW);
    const scroll = makeScrollViewRef();
    registry.registerElement('short-scroll', scroll.ref, { type: 'scroll' }); // never measured
    registry.registerElement('row', makeTargetRef(700).ref, {
      type: 'view',
      scrollAncestorId: 'short-scroll',
    });
    measure(registry, 'row', 700, 40); // inside the 830-high window

    const res = await new DefaultNativeActionExecutor(registry).executeAction('row', {
      action: 'scrollIntoView',
    });

    expect(res.result).toEqual({ alreadyVisible: false, scrolled: true });
    expect(scroll.scrollTo).toHaveBeenCalledWith({ y: 684, animated: false });
  });

  it('unwraps a FlatList-shaped container through getNativeScrollRef', async () => {
    const inner = makeScrollViewRef();
    const flatList = { scrollToOffset: vi.fn(), getNativeScrollRef: () => inner.ref.current };
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('list', asRef(flatList), { type: 'list' });
    registry.registerElement('item', makeTargetRef(900).ref, {
      type: 'listItem',
      scrollAncestorId: 'list',
    });

    const res = await new DefaultNativeActionExecutor(registry).executeAction('item', {
      action: 'scrollIntoView',
    });

    expect(res.success).toBe(true);
    expect(inner.scrollTo).toHaveBeenCalledWith({ y: 884, animated: false });
    expect(flatList.scrollToOffset).not.toHaveBeenCalled();
  });

  it('is NOT_SUPPORTED on a horizontal container (would reset x and lie)', async () => {
    const registry = new NativeUIBridgeRegistry();
    const scroll = makeScrollViewRef();
    registry.registerElement('carousel', scroll.ref, {
      type: 'scroll',
      props: { horizontal: true },
    });
    registry.registerElement('card', makeTargetRef(0).ref, {
      type: 'view',
      scrollAncestorId: 'carousel',
    });

    const res = await new DefaultNativeActionExecutor(registry).executeAction('card', {
      action: 'scrollIntoView',
    });

    expect(res.code).toBe('NOT_SUPPORTED');
    expect(res.error).toContain('horizontal');
    expect(scroll.scrollTo).not.toHaveBeenCalled();
  });

  it('is NOT_SUPPORTED when the target ref has no measureLayout', async () => {
    const { registry, executor } = setup();
    registry.registerElement('account-usage-card', asRef({}), {
      type: 'view',
      scrollAncestorId: 'operations-overview',
    });
    const res = await executor.executeAction('account-usage-card', { action: 'scrollIntoView' });
    expect(res.code).toBe('NOT_SUPPORTED');
    expect(res.error).toContain('measureLayout');
  });

  it('is NOT_SUPPORTED when an element names itself as its scroll ancestor', async () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('self', makeTargetRef(0).ref, {
      type: 'view',
      scrollAncestorId: 'self',
    });
    const res = await new DefaultNativeActionExecutor(registry).executeAction('self', {
      action: 'scrollIntoView',
    });
    expect(res.code).toBe('NOT_SUPPORTED');
  });

  it('fails (ACTION_FAILED, not NOT_SUPPORTED) when measureLayout never calls back', async () => {
    vi.useFakeTimers();
    try {
      const { registry, executor, scroll } = setup();
      registry.registerElement('account-usage-card', asRef({ measureLayout: () => {} }), {
        type: 'view',
        scrollAncestorId: 'operations-overview',
      });
      const pending = executor.executeAction('account-usage-card', { action: 'scrollIntoView' });
      await vi.advanceTimersByTimeAsync(1500);
      const res = await pending;
      expect(res.success).toBe(false);
      expect(res.code).toBeUndefined();
      expect(res.error).toContain('did not call back');
      expect(scroll.scrollTo).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails when measureLayout reports a non-finite y', async () => {
    const { registry, executor, scroll } = setup();
    registry.registerElement(
      'account-usage-card',
      asRef({
        measureLayout: (_r: unknown, ok: (x: number, y: number, w: number, h: number) => void) =>
          ok(0, NaN, 0, 0),
      }),
      { type: 'view', scrollAncestorId: 'operations-overview' }
    );
    const res = await executor.executeAction('account-usage-card', { action: 'scrollIntoView' });
    expect(res.success).toBe(false);
    expect(res.error).toContain('non-finite');
    expect(scroll.scrollTo).not.toHaveBeenCalled();
  });

  it('takes an explicit actions list as written, and infers on actions: null', () => {
    const { registry } = setup();
    registry.registerElement('explicit', asRef({}), {
      type: 'view',
      scrollAncestorId: 'operations-overview',
      actions: ['press'],
    });
    registry.registerElement('nulled', asRef({}), {
      type: 'view',
      scrollAncestorId: 'operations-overview',
      actions: null as unknown as undefined,
    });
    expect(registry.getElement('explicit')?.actions).toEqual(['press']);
    expect(registry.getElement('nulled')?.actions).toContain('scrollIntoView');
  });
});

describe('scrollIntoView — re-review follow-ups', () => {
  it('detects horizontal on a FlatList instance registered WITHOUT captured props', async () => {
    const inner = makeScrollViewRef();
    const flatList = {
      props: { horizontal: true },
      getNativeScrollRef: () => inner.ref.current,
    };
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('carousel-list', asRef(flatList), { type: 'list' }); // no props
    registry.registerElement('tile', makeTargetRef(0).ref, {
      type: 'listItem',
      scrollAncestorId: 'carousel-list',
    });

    const res = await new DefaultNativeActionExecutor(registry).executeAction('tile', {
      action: 'scrollIntoView',
    });

    expect(res.code).toBe('NOT_SUPPORTED');
    expect(inner.scrollTo).not.toHaveBeenCalled();
  });

  it('measures the unwrapped ScrollView of a FlatList for the already-visible check', async () => {
    const registry = new NativeUIBridgeRegistry();
    registry.setViewportProvider(() => WINDOW);
    const scrollTo = vi.fn();
    const innerScrollView = {
      scrollTo,
      getInnerViewRef: () => INNER_VIEW,
      measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) =>
        cb(0, 64, 393, 575),
    };
    registry.registerElement('list', asRef({ getNativeScrollRef: () => innerScrollView }), {
      type: 'list',
    });
    registry.registerElement(
      'item',
      asRef({
        measureLayout: vi.fn(),
        measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) =>
          cb(0, 200, 393, 120),
      }),
      { type: 'listItem', scrollAncestorId: 'list' }
    );

    const res = await new DefaultNativeActionExecutor(registry).executeAction('item', {
      action: 'scrollIntoView',
    });

    expect(res.result).toEqual({ alreadyVisible: true, scrolled: false });
    expect(scrollTo).not.toHaveBeenCalled();
  });
});

describe('scrollIntoView — undeclared horizontal backstop', () => {
  it('is NOT_SUPPORTED when the element is measured beyond the container width', async () => {
    const { registry, executor, scroll } = setup();
    registry.registerElement(
      'account-usage-card',
      asRef({
        measureLayout: (_r: unknown, ok: (x: number, y: number, w: number, h: number) => void) =>
          ok(800, 0, 300, 120), // third card of a sideways row, container is 393 wide
      }),
      { type: 'view', scrollAncestorId: 'operations-overview' }
    );

    const res = await executor.executeAction('account-usage-card', { action: 'scrollIntoView' });

    expect(res.code).toBe('NOT_SUPPORTED');
    expect(res.error).toContain('beyond the width');
    expect(scroll.scrollTo).not.toHaveBeenCalled();
  });
});
