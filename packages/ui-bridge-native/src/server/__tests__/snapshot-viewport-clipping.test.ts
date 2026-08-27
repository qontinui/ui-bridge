import { describe, it, expect } from 'vitest';
import { NativeUIBridgeRegistry } from '../../core/registry';
import { DefaultNativeActionExecutor } from '../../control/action-executor';
import { NativeUIBridgeServer } from '../http-server';
import type { NativeElementRef } from '../../core/types';

/**
 * Viewport / scroll-ancestor clipping for the reported `visibility`.
 *
 * Regression this pins: the RN SDK derived `visibility` from mount + `measure()`
 * with no bounds comparison at all, so a row scrolled far past the fold still
 * reported `visibility: "visible"`, `state.visible: true`. Measured on the
 * qontinui-mobile dashboard 2026-08-27: the scroll container `operations-overview`
 * spanned pageY 64 -> 639.3 while `prepaid-balance-row-deepseek` reported
 * pageY 699 -> 736 — entirely below it — and the snapshot called it visible.
 *
 * That made `/manual-test`'s binding PASS gate ("PRESENT IS NOT VISIBLE",
 * which requires `state.visible === true`) vacuous on mobile: it was true for
 * everything mounted.
 */

interface SnapshotElement {
  id: string;
  visibility?: 'visible' | 'likely-visible' | 'hidden';
  visibilityReason?: 'hidden' | 'off-screen' | 'occluded' | 'no-layout';
  bbox?: { x: number; y: number; w: number; h: number };
  state: { visible: boolean; layout: unknown };
}

interface ParsedSnapshotResponse {
  success: boolean;
  data: { elements: SnapshotElement[] };
}

function makeRef(): React.RefObject<NativeElementRef> {
  return { current: {} as NativeElementRef };
}

/** A 393 x 830 dp window — a Galaxy S23 in portrait, the reported device. */
const WINDOW = { width: 393, height: 830 };

function buildServer(viewport?: { width: number; height: number }) {
  const registry = new NativeUIBridgeRegistry();
  if (viewport) registry.setViewportProvider(() => viewport);
  const executor = new DefaultNativeActionExecutor(registry);
  const server = new NativeUIBridgeServer(registry, executor);
  return { registry, server };
}

function measure(
  registry: NativeUIBridgeRegistry,
  id: string,
  pageY: number,
  height: number,
  pageX = 0,
  width = 393
): void {
  registry.updateElementState(id, {
    visible: true,
    layout: { x: pageX, y: pageY, width, height, pageX, pageY },
  });
}

async function snapshot(server: NativeUIBridgeServer): Promise<Map<string, SnapshotElement>> {
  const res = await server.handleRequest({
    method: 'GET',
    path: '/ui-bridge/control/snapshot',
    headers: {},
    query: {},
  });
  const parsed = JSON.parse(res.body) as ParsedSnapshotResponse;
  return new Map(parsed.data.elements.map((e) => [e.id, e]));
}

describe('snapshot visibility — clipped against the window', () => {
  it('reports an element below the window as off-screen, not visible', async () => {
    const { registry, server } = buildServer(WINDOW);
    registry.registerElement('below-fold', makeRef());
    measure(registry, 'below-fold', 900, 40);

    const el = (await snapshot(server)).get('below-fold');
    expect(el?.visibility).toBe('hidden');
    expect(el?.visibilityReason).toBe('off-screen');
  });

  it('reports an element inside the window as visible with no reason', async () => {
    const { registry, server } = buildServer(WINDOW);
    registry.registerElement('on-screen', makeRef());
    measure(registry, 'on-screen', 100, 40);

    const el = (await snapshot(server)).get('on-screen');
    expect(el?.visibility).toBe('visible');
    expect(el?.visibilityReason).toBeUndefined();
  });

  it('counts a half-scrolled element as visible — any overlap is on screen', async () => {
    const { registry, server } = buildServer(WINDOW);
    registry.registerElement('straddling', makeRef());
    measure(registry, 'straddling', 810, 40); // 810 -> 850, window ends at 830

    expect((await snapshot(server)).get('straddling')?.visibility).toBe('visible');
  });

  it('does NOT demote anything when no viewport was injected (bounds UNKNOWN)', async () => {
    const { registry, server } = buildServer(); // no provider
    registry.registerElement('unbounded', makeRef());
    measure(registry, 'unbounded', 9999, 40);

    const el = (await snapshot(server)).get('unbounded');
    expect(el?.visibility).toBe('visible');
    expect(el?.visibilityReason).toBeUndefined();
  });

  it('does not demote when the provider throws or reports a zero-size window', async () => {
    const { registry, server } = buildServer();
    registry.setViewportProvider(() => {
      throw new Error('Dimensions unavailable during teardown');
    });
    registry.registerElement('thrower', makeRef());
    measure(registry, 'thrower', 9999, 40);
    expect((await snapshot(server)).get('thrower')?.visibility).toBe('visible');

    registry.setViewportProvider(() => ({ width: 0, height: 0 }));
    expect((await snapshot(server)).get('thrower')?.visibility).toBe('visible');
  });
});

describe('snapshot visibility — clipped against a declared scroll ancestor', () => {
  /** Reproduces the measured qontinui-mobile dashboard geometry. */
  function dashboard() {
    const { registry, server } = buildServer(WINDOW);
    registry.registerElement('operations-overview', makeRef(), { type: 'scroll' });
    measure(registry, 'operations-overview', 64, 575.3); // 64 -> 639.3
    registry.registerElement('prepaid-balance-row-deepseek', makeRef(), {
      scrollAncestorId: 'operations-overview',
    });
    measure(registry, 'prepaid-balance-row-deepseek', 699, 37); // 699 -> 736
    return { registry, server };
  }

  it('reports a row scrolled past its container as off-screen', async () => {
    const { server } = dashboard();
    const el = (await snapshot(server)).get('prepaid-balance-row-deepseek');
    expect(el?.visibility).toBe('hidden');
    expect(el?.visibilityReason).toBe('off-screen');
  });

  it('reports it visible again once it is scrolled into the container', async () => {
    const { registry, server } = dashboard();
    // What a scrollIntoView produces: the row's measured page rect moves into
    // the container's frame. The container itself does not move.
    measure(registry, 'prepaid-balance-row-deepseek', 400, 37);

    const el = (await snapshot(server)).get('prepaid-balance-row-deepseek');
    expect(el?.visibility).toBe('visible');
    expect(el?.visibilityReason).toBeUndefined();
  });

  it('does NOT clip sibling chrome that merely sits inside the same window', async () => {
    // The regression guard for inferring ancestry geometrically: the tab bar
    // (648.3 -> 691.3) is below the scroll container but plainly on screen.
    // It declares no `scrollAncestorId`, so only the window clips it.
    const { registry, server } = dashboard();
    registry.registerElement('tab-bar', makeRef());
    measure(registry, 'tab-bar', 648.3, 43);

    const el = (await snapshot(server)).get('tab-bar');
    expect(el?.visibility).toBe('visible');
    expect(el?.visibilityReason).toBeUndefined();
  });

  it('falls back to the window when the declared ancestor is absent or unmeasured', async () => {
    const { registry, server } = buildServer(WINDOW);
    registry.registerElement('orphan', makeRef(), { scrollAncestorId: 'never-registered' });
    measure(registry, 'orphan', 100, 40);
    expect((await snapshot(server)).get('orphan')?.visibility).toBe('visible');

    registry.registerElement('unmeasured-parent', makeRef(), { type: 'scroll' });
    registry.registerElement('child', makeRef(), { scrollAncestorId: 'unmeasured-parent' });
    measure(registry, 'child', 100, 40);
    expect((await snapshot(server)).get('child')?.visibility).toBe('visible');
  });
});

describe('clip regions that are themselves empty or untrustworthy', () => {
  it('reports children of a scroll container that is ITSELF off-screen as off-screen', async () => {
    // The intersection of the window with an ancestor below it INVERTS
    // (top 900 > bottom 830) rather than zeroing, and a naive span test reads
    // an inverted span as overlapping — so this used to answer `visible`.
    const { registry, server } = buildServer(WINDOW);
    registry.registerElement('outer-list', makeRef(), { type: 'scroll' });
    registry.registerElement('carousel', makeRef(), {
      type: 'scroll',
      scrollAncestorId: 'outer-list',
    });
    measure(registry, 'carousel', 900, 40); // the container scrolled off
    registry.registerElement('carousel-item', makeRef(), { scrollAncestorId: 'carousel' });
    measure(registry, 'carousel-item', 700, 250); // straddles the window edge

    const el = (await snapshot(server)).get('carousel-item');
    expect(el?.visibility).toBe('hidden');
    expect(el?.visibilityReason).toBe('off-screen');
  });

  it('does NOT clip when the page origin is a parent-relative stand-in', async () => {
    // `useUIElement`'s fallback for a ref with no `measureInWindow` writes
    // pageX/pageY = x/y — parent-relative, not window coordinates. Comparing
    // those against the window mixes coordinate spaces, so clipping declines.
    const { registry, server } = buildServer(WINDOW);
    registry.registerElement('no-measure-ref', makeRef());
    registry.updateElementState('no-measure-ref', {
      visible: true,
      layout: {
        x: 0,
        y: 900,
        width: 393,
        height: 40,
        pageX: 0,
        pageY: 900,
        pageOriginUnmeasured: true,
      },
    });

    const el = (await snapshot(server)).get('no-measure-ref');
    expect(el?.visibility).toBe('visible');
    expect(el?.visibilityReason).toBeUndefined();
  });
});

describe('off-screen elements keep their geometry, and GET /control/elements agrees', () => {
  it('drops the pixel bbox but keeps state.layout for scrollIntoView targeting', async () => {
    const { registry, server } = buildServer(WINDOW);
    registry.registerElement('below-fold', makeRef());
    measure(registry, 'below-fold', 900, 40);

    const el = (await snapshot(server)).get('below-fold');
    // `bbox` is a projection into the screencap frame; an off-screen element
    // has no pixels there, so emitting one would poison the vision pipeline.
    expect(el?.bbox).toBeUndefined();
    // The dp geometry a caller needs to scroll it into view survives.
    expect(el?.state.layout).toMatchObject({ pageY: 900, height: 40 });
  });

  it('GET /control/elements reports the same verdict as the snapshot', async () => {
    const { registry, server } = buildServer(WINDOW);
    registry.registerElement('below-fold', makeRef());
    measure(registry, 'below-fold', 900, 40);

    const res = await server.handleRequest({
      method: 'GET',
      path: '/ui-bridge/control/elements',
      headers: {},
      query: {},
    });
    const parsed = JSON.parse(res.body) as ParsedSnapshotResponse;
    const el = parsed.data.elements.find((e) => e.id === 'below-fold');
    expect(el?.visibility).toBe('hidden');
    expect(el?.visibilityReason).toBe('off-screen');
  });
});
