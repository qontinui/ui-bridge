/**
 * The canvas census (`UIBridgeRegistry.getCanvasCoverage`) and the in-page
 * `/control/visibility` handler that reports it.
 *
 * The occlusion sweep hit-tests registered elements only, so text painted
 * into a canvas no `paintsText` registration covers is never checked. The
 * census is what keeps the sweep from answering `clear` over such a canvas.
 * jsdom has no layout, so canvas boxes are stubbed per element.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UIBridgeRegistry } from '../registry';
import { createHandlers, type RegistryLike } from '../../server/handlers';
import { DefaultActionExecutor } from '../../control/action-executor';
import type { VisibilityReport } from '../../server/types';

function boxed<T extends HTMLElement>(el: T, x: number, y: number, w: number, h: number): T {
  el.getBoundingClientRect = () =>
    ({
      x,
      y,
      width: w,
      height: h,
      top: y,
      left: x,
      right: x + w,
      bottom: y + h,
      toJSON: () => ({}),
    }) as DOMRect;
  return el;
}

function canvasAt(
  parent: HTMLElement,
  x: number,
  y: number,
  w: number,
  h: number,
  cls?: string
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  if (cls) canvas.className = cls;
  parent.appendChild(canvas);
  return boxed(canvas, x, y, w, h);
}

function div(parent: HTMLElement = document.body): HTMLDivElement {
  const el = document.createElement('div');
  parent.appendChild(el);
  return boxed(el, 0, 0, 800, 600);
}

const realElementFromPoint = document.elementFromPoint;

beforeEach(() => {
  document.body.innerHTML = '';
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 720, configurable: true });
});

afterEach(() => {
  document.elementFromPoint = realElementFromPoint;
});

describe('getCanvasCoverage — the census', () => {
  it('zero canvases: measured, nothing to attribute', () => {
    const registry = new UIBridgeRegistry();
    registry.registerElement('a', div(), { type: 'generic' });
    expect(registry.getCanvasCoverage()).toEqual({
      state: 'measured',
      canvases: 0,
      attributed: 0,
      unattributed: [],
    });
  });

  it('a canvas inside a paintsText container is attributed', () => {
    const registry = new UIBridgeRegistry();
    const term = div();
    canvasAt(term, 0, 0, 800, 600, 'xterm-text-layer');
    canvasAt(term, 0, 0, 800, 600, 'xterm-link-layer');
    registry.registerElement('terminal-surface-a', term, { type: 'canvas', paintsText: true });

    expect(registry.getCanvasCoverage()).toEqual({
      state: 'measured',
      canvases: 2,
      attributed: 2,
      unattributed: [],
    });
  });

  it('a registered <canvas> attributes itself (implicitly paintsText)', () => {
    const registry = new UIBridgeRegistry();
    const chart = canvasAt(document.body, 10, 10, 300, 150);
    registry.registerElement('chart', chart, { type: 'canvas' });
    expect(registry.getCanvasCoverage()).toMatchObject({ canvases: 1, attributed: 1 });
  });

  it('an unregistered canvas is unattributed and named by its own DOM descriptor', () => {
    const registry = new UIBridgeRegistry();
    registry.registerElement('a', div(), { type: 'generic' });
    canvasAt(document.body, 20, 30, 300, 150, 'sparkline');

    expect(registry.getCanvasCoverage()).toEqual({
      state: 'measured',
      canvases: 1,
      attributed: 0,
      unattributed: [
        { descriptor: 'canvas.sparkline', rect: { x: 20, y: 30, width: 300, height: 150 } },
      ],
    });
  });

  it('a canvas whose first registered ancestor is NOT paintsText is unattributed', () => {
    const registry = new UIBridgeRegistry();
    const outer = div();
    const panel = div(outer);
    canvasAt(panel, 0, 0, 400, 300);
    // The paintsText registration is further up: the FIRST registered
    // ancestor decides, and that one judges hidesText from DOM text.
    registry.registerElement('outer', outer, { type: 'canvas', paintsText: true });
    registry.registerElement('panel', panel, { type: 'generic' });

    expect(registry.getCanvasCoverage()).toMatchObject({ canvases: 1, attributed: 0 });
  });

  it('attributes by registry membership, not by a stale data-ui-bridge-id', () => {
    const registry = new UIBridgeRegistry();
    const term = div();
    const wrapper = div(term);
    canvasAt(wrapper, 0, 0, 400, 300);
    registry.registerElement('terminal-surface-a', term, { type: 'canvas', paintsText: true });
    // An unregistered wrapper carrying a leftover stamp must not intercept.
    wrapper.setAttribute('data-ui-bridge-id', 'stale-wrapper');
    term.removeAttribute('data-ui-bridge-id');

    expect(registry.getCanvasCoverage()).toMatchObject({ canvases: 1, attributed: 1 });
  });

  it('many canvases with mixed attribution', () => {
    const registry = new UIBridgeRegistry();
    const term = div();
    canvasAt(term, 0, 0, 400, 300);
    canvasAt(term, 0, 0, 400, 300);
    registry.registerElement('term', term, { type: 'canvas', paintsText: true });
    canvasAt(document.body, 500, 0, 200, 100, 'a');
    canvasAt(document.body, 500, 200, 200, 100, 'b');

    const coverage = registry.getCanvasCoverage();
    expect(coverage).toMatchObject({ canvases: 4, attributed: 2 });
    expect(coverage?.unattributed.map((u) => u.descriptor)).toEqual(['canvas.a', 'canvas.b']);
  });

  it('skips canvases below 48x48, outside the viewport, hidden, or in a closed <details>', () => {
    const registry = new UIBridgeRegistry();
    registry.registerElement('a', div(), { type: 'generic' });
    canvasAt(document.body, 0, 0, 47, 300, 'thin');
    canvasAt(document.body, 2000, 0, 300, 300, 'offscreen-right');
    canvasAt(document.body, 0, -400, 300, 300, 'offscreen-above');
    canvasAt(document.body, 0, 0, 300, 300, 'none').style.display = 'none';
    canvasAt(document.body, 0, 0, 300, 300, 'invisible').style.visibility = 'hidden';
    canvasAt(document.body, 0, 0, 300, 300, 'transparent').style.opacity = '0';
    const details = document.createElement('details');
    details.appendChild(document.createElement('summary'));
    document.body.appendChild(details);
    canvasAt(details, 0, 0, 300, 300, 'collapsed');
    // One partly on screen still counts.
    canvasAt(document.body, 1200, 600, 300, 300, 'edge');

    const coverage = registry.getCanvasCoverage();
    expect(coverage?.unattributed.map((u) => u.descriptor)).toEqual(['canvas.edge']);
    expect(coverage?.canvases).toBe(1);
  });

  it('answers undefined when the census throws', () => {
    const registry = new UIBridgeRegistry();
    const original = document.getElementsByTagName;
    document.getElementsByTagName = (() => {
      throw new Error('boom');
    }) as typeof document.getElementsByTagName;
    try {
      expect(registry.getCanvasCoverage()).toBeUndefined();
    } finally {
      document.getElementsByTagName = original;
    }
  });
});

describe('the census rides every DOM-side snapshot', () => {
  it('createSnapshot carries canvasCoverage', () => {
    const registry = new UIBridgeRegistry();
    registry.registerElement('a', div(), { type: 'generic' });
    canvasAt(document.body, 0, 0, 300, 150, 'chart');
    expect(registry.createSnapshot().canvasCoverage).toMatchObject({
      state: 'measured',
      canvases: 1,
      attributed: 0,
    });
  });

  it('a census that threw is carried as accessor-threw, not dropped', () => {
    const registry = new UIBridgeRegistry();
    const original = document.getElementsByTagName;
    document.getElementsByTagName = (() => {
      throw new Error('boom');
    }) as typeof document.getElementsByTagName;
    try {
      expect(registry.createSnapshot().canvasCoverage).toEqual({
        state: 'unavailable',
        reason: 'accessor-threw',
      });
    } finally {
      document.getElementsByTagName = original;
    }
  });
});

describe('in-page /control/visibility reports the census', () => {
  async function visibility(registry: RegistryLike): Promise<VisibilityReport> {
    const handlers = createHandlers(
      registry,
      new DefaultActionExecutor(new UIBridgeRegistry()) as never,
      { idleDetection: false }
    );
    const res = await handlers.visibility!();
    expect(res.success).toBe(true);
    return res.data as VisibilityReport;
  }

  it('an unregistered canvas on a page with registered elements reads unknown_canvas', async () => {
    const registry = new UIBridgeRegistry();
    registry.registerElement('a', div(), { type: 'generic' });
    canvasAt(document.body, 0, 0, 300, 150, 'chart');

    const report = await visibility(registry as unknown as RegistryLike);
    expect(report.verdict).toBe('unknown_canvas');
    expect(report.canvasCoverage).toMatchObject({ state: 'measured', attributed: 0 });
  });

  it('the same canvas inside a paintsText registration reads clear', async () => {
    const registry = new UIBridgeRegistry();
    const term = div();
    canvasAt(term, 0, 0, 300, 150);
    registry.registerElement('term', term, { type: 'canvas', paintsText: true });

    expect((await visibility(registry as unknown as RegistryLike)).verdict).toBe('clear');
  });

  it('maps state.paintsText into the report: an occluded surface hides painted text', async () => {
    const registry = new UIBridgeRegistry();
    const term = div();
    canvasAt(term, 0, 0, 800, 600);
    registry.registerElement('terminal-surface-a', term, { type: 'canvas', paintsText: true });
    const card = document.createElement('div');
    card.id = 'card';
    document.body.appendChild(card);
    // The card owns the whole surface at every probe.
    document.elementFromPoint = (() => card) as typeof document.elementFromPoint;

    const report = await visibility(registry as unknown as RegistryLike);
    expect(report.verdict).toBe('occlusions_found');
    expect(report.occlusions[0]).toMatchObject({
      element: 'terminal-surface-a',
      occludedBy: 'div#card',
      hidesText: true,
      textSource: 'painted',
    });
  });

  it('a registry without the accessor is page-sdk-lacks-coverage; one that answers undefined threw', async () => {
    const live = new UIBridgeRegistry();
    live.registerElement('a', div(), { type: 'generic' });
    const base = {
      getAllElements: () => live.getAllElements(),
      getElement: (id: string) => live.getElement(id),
      getAllComponents: () => [],
      getComponent: () => undefined,
      createSnapshot: () => live.createSnapshot() as never,
    };

    const lacking = await visibility(base as RegistryLike);
    expect(lacking.canvasCoverage).toEqual({
      state: 'unavailable',
      reason: 'page-sdk-lacks-coverage',
    });
    expect(lacking.verdict).toBe('unknown_canvas');

    const threw = await visibility({ ...base, getCanvasCoverage: () => undefined } as RegistryLike);
    expect(threw.canvasCoverage).toEqual({ state: 'unavailable', reason: 'accessor-threw' });
    expect(threw.verdict).toBe('unknown_canvas');
  });
});
