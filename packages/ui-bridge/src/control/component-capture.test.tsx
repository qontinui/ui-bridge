/**
 * Component capture (plan 2026-11-13-ui-bridge-matches-isolated-render-assertion,
 * Phase 2) — jsdom fixtures for the four in-situ failure shapes the
 * `matches_isolated_render` assertion diffs, plus the no-mounted-elements
 * refusal and the HTTP envelope of both routes.
 *
 * jsdom has no layout, so every bbox comes from a stubbed
 * `getBoundingClientRect` keyed per element.
 */

import React, { act } from 'react';
import { createPortal } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { captureComponent, type ComponentCaptureRegistry } from './component-capture';
import { createHandlers, type RegistryLike } from '../server/handlers';
import { UI_BRIDGE_ROUTES } from '../server/types';

const g = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean };
let savedAct: boolean | undefined;
beforeAll(() => {
  savedAct = g.IS_REACT_ACT_ENVIRONMENT;
  g.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  g.IS_REACT_ACT_ENVIRONMENT = savedAct;
});

// ---------------------------------------------------------------------------
// Fixture plumbing
// ---------------------------------------------------------------------------

const rects = new WeakMap<Element, { x: number; y: number; width: number; height: number }>();
const realRect = Element.prototype.getBoundingClientRect;
beforeAll(() => {
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const r = rects.get(this) ?? { x: 0, y: 0, width: 0, height: 0 };
    return {
      ...r,
      left: r.x,
      top: r.y,
      right: r.x + r.width,
      bottom: r.y + r.height,
      toJSON: () => r,
    } as DOMRect;
  };
});
afterAll(() => {
  Element.prototype.getBoundingClientRect = realRect;
});

function setRect(el: Element | null, x: number, y: number, width: number, height: number) {
  if (!el) throw new Error('setRect: element missing');
  rects.set(el, { x, y, width, height });
}

let roots: Root[] = [];
let containers: HTMLElement[] = [];
afterEach(() => {
  act(() => roots.forEach((r) => r.unmount()));
  containers.forEach((c) => c.remove());
  roots = [];
  containers = [];
  document.body.innerHTML = '';
});

function render(ui: React.ReactElement, host: HTMLElement = document.body): HTMLElement {
  const container = document.createElement('div');
  container.id = 'app';
  host.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(ui));
  return container;
}

/** A fake registry over a fixed id → element / component table. */
function fakeRegistry(
  elements: Record<string, Element>,
  components: Record<
    string,
    { elementIds?: string[]; getState?: () => Record<string, unknown> }
  > = {}
): ComponentCaptureRegistry & RegistryLike {
  const entries = Object.entries(elements).map(([id, element]) => ({ id, element, mounted: true }));
  return {
    getElement: (id: string) => entries.find((e) => e.id === id),
    getComponent: (id: string) => (components[id] ? { id, ...components[id] } : undefined),
    getAllElements: () => entries,
    getAllComponents: () => [],
    createSnapshot: () => ({ timestamp: 0, elements: [], components: [], workflows: [] }) as never,
  };
}

const q = (sel: string): HTMLElement => {
  const el = document.querySelector(sel);
  if (!el) throw new Error(`no element for ${sel}`);
  return el as HTMLElement;
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

describe('captureComponent — fallback-input fixture', () => {
  it('reports the plain <input> and the component that actually rendered it', () => {
    // In situ a fallback renders a bare <input> where a DatePicker should be.
    function FallbackInput() {
      return <input data-testid="date" type="text" />;
    }
    function Field() {
      return (
        <div className="field">
          <FallbackInput />
        </div>
      );
    }
    render(<Field />);
    const field = q('div.field');
    const input = q('input');
    setRect(field, 10, 20, 300, 40);
    setRect(input, 14, 24, 200, 32);

    const result = captureComponent(fakeRegistry({ 'date-field': field, 'date-input': input }), {
      kind: 'element',
      id: 'date-field',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { capture } = result;
    expect(capture.schemaVersion).toBe(1);
    expect(capture.target).toEqual({ kind: 'element', id: 'date-field' });
    expect(capture.root.bbox).toEqual({ x: 10, y: 20, width: 300, height: 40 });
    expect(capture.nodes).toHaveLength(2);
    expect(capture.nodes[0]).toMatchObject({ path: '', tag: 'div', componentName: 'Field' });
    expect(capture.nodes[1]).toMatchObject({
      path: '0',
      tag: 'input',
      role: 'textbox',
      registeredId: 'date-input',
      componentName: 'FallbackInput',
      // Root-relative geometry.
      bbox: { x: 4, y: 4, width: 200, height: 32 },
      portal: null,
    });
    // The style map is the contract whitelist, string-valued.
    expect(Object.keys(capture.nodes[1].styles)).toEqual(
      expect.arrayContaining(['display', 'width', 'overflowX', 'fontSize'])
    );
    expect(capture.viewport.width).toBeGreaterThan(0);
    expect(capture.dpr).toBeGreaterThan(0);
  });
});

describe('captureComponent — overflow-clip fixture', () => {
  it('lists the clipping ancestors outside the root, nearest first, with their rects', () => {
    function Card() {
      return <section className="card">content</section>;
    }
    const outer = document.createElement('div');
    outer.className = 'page';
    outer.style.overflowY = 'auto';
    const pane = document.createElement('div');
    pane.className = 'scroll-pane';
    pane.style.overflow = 'hidden';
    outer.appendChild(pane);
    document.body.appendChild(outer);
    render(<Card />, pane);
    const card = q('section.card');
    setRect(outer, 0, 0, 800, 600);
    setRect(pane, 0, 0, 100, 50);
    setRect(card, 0, 0, 240, 120);

    const result = captureComponent(fakeRegistry({ card }), { kind: 'element', id: 'card' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const clip = result.capture.clipAncestors;
    expect(clip).toHaveLength(2);
    expect(clip[0]).toMatchObject({
      descriptor: 'div.scroll-pane',
      overflowX: 'hidden',
      overflowY: 'hidden',
      rect: { x: 0, y: 0, width: 100, height: 50 },
    });
    expect(clip[1]).toMatchObject({ descriptor: 'div.page', overflowY: 'auto' });
    // The root's parent is the React container `div#app`.
    expect(result.capture.root.parentContentBox).not.toBeNull();
  });
});

describe('captureComponent — portal fixture', () => {
  it('captures a portalled child with its mount target and React parent path', () => {
    const portalRoot = document.createElement('div');
    portalRoot.id = 'portal-root';
    document.body.appendChild(portalRoot);
    function Popover() {
      return createPortal(<div className="popover">menu</div>, portalRoot);
    }
    function Picker() {
      return (
        <div className="picker">
          <button type="button">open</button>
          <Popover />
        </div>
      );
    }
    render(<Picker />);
    const picker = q('div.picker');
    setRect(picker, 0, 0, 200, 30);
    setRect(q('div.popover'), 0, 30, 200, 100);

    const result = captureComponent(fakeRegistry({ picker }), { kind: 'element', id: 'picker' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const nodes = result.capture.nodes;
    expect(nodes.map((n) => n.tag)).toEqual(['div', 'button', 'div']);
    expect(nodes[1].portal).toBeNull();
    const portalled = nodes[2];
    expect(portalled.componentName).toBe('Popover');
    expect(portalled.portal).toEqual({ mountTarget: 'body>div#portal-root', reactParentPath: '' });
    // Numbered after the React parent's DOM children: "1" is the button's slot + 1.
    expect(portalled.path).toBe('1');
    expect(portalled.bbox).toEqual({ x: 0, y: 30, width: 200, height: 100 });
  });
});

describe('captureComponent — unreadable-name fixture', () => {
  it('reports a redacted element as componentName null with an unknownChecks note', () => {
    function SecretField() {
      return <input type="password" defaultValue="hunter2" />;
    }
    function Form() {
      return (
        <form className="login">
          <SecretField />
        </form>
      );
    }
    render(<Form />);
    const form = q('form.login');

    const result = captureComponent(fakeRegistry({ form }), { kind: 'element', id: 'form' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const input = result.capture.nodes[1];
    expect(input.tag).toBe('input');
    expect(input.componentName).toBeNull();
    expect(result.capture.unknownChecks).toContain('componentName: unreadable (redacted) at "0"');
  });

  it('treats a minified component name as unreadable, not as a name', () => {
    const a = () => <span className="m">x</span>;
    render(React.createElement(a));
    const span = q('span.m');
    const result = captureComponent(fakeRegistry({ span }), { kind: 'element', id: 'span' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.capture.nodes[0].componentName).toBeNull();
    expect(result.capture.unknownChecks).toContain(
      'componentName: unreadable (minified "a") at ""'
    );
  });
});

describe('captureComponent — component root and refusals', () => {
  it('roots a component at the nearest common ancestor of its mounted elements', () => {
    function Pair() {
      return (
        <div className="pair">
          <button type="button" className="b1">
            a
          </button>
          <button type="button" className="b2">
            b
          </button>
        </div>
      );
    }
    render(<Pair />);
    const registry = fakeRegistry(
      { b1: q('.b1'), b2: q('.b2') },
      { pair: { elementIds: ['b1', 'b2'], getState: () => ({ open: true }) } }
    );
    const result = captureComponent(registry, { kind: 'component', id: 'pair' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.capture.nodes[0]).toMatchObject({ tag: 'div', registeredId: 'pair' });
    expect(result.capture.state).toEqual({ open: true });
    expect(result.capture.props).toEqual({});
  });

  it('refuses a component with no mounted elementIds', () => {
    const registry = fakeRegistry({}, { ghost: { elementIds: ['never-mounted'] } });
    const result = captureComponent(registry, { kind: 'component', id: 'ghost' });
    expect(result).toMatchObject({
      ok: false,
      refusal: { error: 'component_capture_refused', reason: 'no_mounted_elements' },
    });
  });

  it('refuses an unknown id as not_found', () => {
    const result = captureComponent(fakeRegistry({}), { kind: 'component', id: 'nope' });
    expect(result).toMatchObject({ ok: false, refusal: { reason: 'not_found' } });
  });
});

describe('capture routes', () => {
  it('declares both GET routes in UI_BRIDGE_ROUTES', () => {
    const routes = UI_BRIDGE_ROUTES.map((r) => `${r.method} ${r.path} -> ${r.handler}`);
    expect(routes).toContain('GET /control/component/:id/capture -> getComponentCapture');
    expect(routes).toContain('GET /control/element/:id/capture -> getElementCapture');
  });

  it('answers a capture under data, and a typed 422 refusal for no mounted elements', async () => {
    function Box() {
      return <div className="box" />;
    }
    render(<Box />);
    const registry = fakeRegistry({ box: q('div.box') }, { ghost: { elementIds: [] } });
    const handlers = createHandlers(registry, {} as never);

    const ok = await handlers.getElementCapture('box');
    expect(ok.success).toBe(true);
    expect((ok.data as { nodes: unknown[] }).nodes).toHaveLength(1);

    const refused = await handlers.getComponentCapture('ghost');
    expect(refused).toMatchObject({
      success: false,
      error: 'component_capture_refused',
      code: 'UB-OBS-INPUT-MISSING',
      httpStatus: 422,
      data: { error: 'component_capture_refused', reason: 'no_mounted_elements' },
    });

    const missing = await handlers.getElementCapture('nope');
    expect(missing).toMatchObject({ httpStatus: 404, data: { reason: 'not_found' } });
  });
});
