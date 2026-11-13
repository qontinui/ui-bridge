/**
 * Component capture (plan 2026-11-13-ui-bridge-matches-isolated-render-assertion,
 * Phase 2) — jsdom fixtures for the four in-situ failure shapes the
 * `matches_isolated_render` assertion diffs, plus the no-mounted-elements
 * refusal and the HTTP envelope of both routes.
 *
 * jsdom has no layout, so every bbox comes from a stubbed
 * `getBoundingClientRect` keyed per element.
 */

import React, { act, forwardRef, memo, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import {
  captureComponent,
  componentCaptureCommandResult,
  parseComponentCaptureRefusal,
  MAX_CAPTURE_NODES,
  MAX_PORTAL_WALK_FIBERS,
  type ComponentCaptureRegistry,
} from './component-capture';
import { REDACTED_VALUE } from '../core/redaction';
import {
  extractComponentFiberProps,
  extractOwnerComponentProps,
  OWNER_SUBTREE_DOM_BUDGET,
} from './action-executor';
import { deepestCommonFiber, type FiberLike } from './react-fiber';
import { CommandRelay } from '../server/command-relay';
import { createRelayHandlers } from '../server/relay-handlers';
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
    getAllComponents: () => Object.keys(components).map((id) => ({ id, ...components[id] })),
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
    expect(result.capture.unknownChecks).toContain(
      'componentName: unreadable (redacted) at 1 node ("0")'
    );
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
      'componentName: unreadable (minified) at 1 node ("")'
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
    const result = captureComponent(registry, { kind: 'component', id: 'pair' }, { props: true });
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

// ---------------------------------------------------------------------------
// Review fixes (§4.6 owner-props leak, relay refusal, current fiber, …)
// ---------------------------------------------------------------------------

describe('captureComponent — owner props are redacted over the whole subtree (§4.6)', () => {
  it('redacts the owner props of a component wrapping a password input, captured at its root', () => {
    function SecretField({ secret }: { secret: string }) {
      return (
        <div className="secret-field">
          <input type="password" value={secret} readOnly />
        </div>
      );
    }
    render(<SecretField secret="hunter2" />);
    const root = q('div.secret-field');
    const result = captureComponent(
      fakeRegistry({ root }),
      { kind: 'element', id: 'root' },
      { props: true }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.capture.props).toEqual({ secret: REDACTED_VALUE });
    expect(JSON.stringify(result.capture)).not.toContain('hunter2');
  });

  it('keeps owner props of a subtree with nothing redacted', () => {
    function Badge({ tone }: { tone: string }) {
      return <span className="badge">{tone}</span>;
    }
    render(<Badge tone="warn" />);
    const badge = q('span.badge');
    const result = captureComponent(
      fakeRegistry({ badge }),
      { kind: 'element', id: 'badge' },
      { props: true }
    );
    expect(result.ok && result.capture.props).toEqual({ tone: 'warn' });
  });
});

describe('captureComponent — current fiber after a state update', () => {
  it('captures a portal opened by a single setState', () => {
    const portalRoot = document.createElement('div');
    portalRoot.id = 'layer';
    document.body.appendChild(portalRoot);
    let open: (v: boolean) => void = () => {};
    function Menu() {
      return createPortal(<ul className="menu" />, portalRoot);
    }
    function Toggle() {
      const [isOpen, setIsOpen] = useState(false);
      open = setIsOpen;
      return (
        <div className="toggle">
          <button type="button">t</button>
          {isOpen ? <Menu /> : null}
        </div>
      );
    }
    render(<Toggle />);
    act(() => open(true));
    const toggle = q('div.toggle');
    const result = captureComponent(fakeRegistry({ toggle }), { kind: 'element', id: 'toggle' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const menu = result.capture.nodes.find((n) => n.tag === 'ul');
    expect(menu?.portal).toEqual({ mountTarget: 'body>div#layer', reactParentPath: '' });

    // Closed again: the unmounted portal is gone, not reported from a stale fiber.
    act(() => open(false));
    const closed = captureComponent(fakeRegistry({ toggle }), { kind: 'element', id: 'toggle' });
    expect(closed.ok && closed.capture.nodes.map((n) => n.tag)).toEqual(['div', 'button']);
  });
});

describe('captureComponent — component names', () => {
  it('names SVG nodes, forwardRef and memo components', () => {
    function Icon() {
      return (
        <svg className="icon">
          <circle r="1" />
        </svg>
      );
    }
    // forwardRef on purpose: the fixture needs a ForwardRef fiber (object type).
    // eslint-disable-next-line @eslint-react/no-forward-ref
    const Fancy = forwardRef<HTMLSpanElement>(function FancyInner(_props, ref) {
      return <span ref={ref} className="fancy" />;
    });
    const Quiet = memo(function QuietInner() {
      return <i className="quiet" />;
    });
    function Row() {
      return (
        <div className="row">
          <Icon />
          <Fancy />
          <Quiet />
        </div>
      );
    }
    render(<Row />);
    const row = q('div.row');
    const result = captureComponent(fakeRegistry({ row }), { kind: 'element', id: 'row' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const byTag = Object.fromEntries(result.capture.nodes.map((n) => [n.tag, n.componentName]));
    expect(byTag).toMatchObject({
      svg: 'Icon',
      circle: 'Icon',
      span: 'FancyInner',
      i: 'QuietInner',
    });
  });

  it('prefers the registered useUIComponent id over the fiber name', () => {
    function DatePicker() {
      return <input className="dp" type="text" />;
    }
    render(<DatePicker />);
    const input = q('input.dp');
    const registry = fakeRegistry({ input }, { 'date-range-picker': { elementIds: ['input'] } });
    const result = captureComponent(registry, { kind: 'element', id: 'input' });
    expect(result.ok && result.capture.nodes[0].componentName).toBe('date-range-picker');
  });

  it('collapses repeated unreadable-name notes into one counted note', () => {
    function Pins() {
      return (
        <div className="pins">
          <input type="password" />
          <input type="password" />
        </div>
      );
    }
    render(<Pins />);
    const pins = q('div.pins');
    const result = captureComponent(fakeRegistry({ pins }), { kind: 'element', id: 'pins' });
    expect(result.ok && result.capture.unknownChecks).toEqual([
      'componentName: unreadable (redacted) at 2 nodes (e.g. "0", "1")',
    ]);
  });
});

describe('captureComponent — portalled registered element of a component', () => {
  it('roots at the in-place elements and records the portalled one as a portal node', () => {
    const layer = document.createElement('div');
    layer.id = 'overlay';
    document.body.appendChild(layer);
    function Combo() {
      return (
        <div className="combo">
          <button type="button" className="trigger">
            v
          </button>
          {createPortal(<div className="listbox" />, layer)}
        </div>
      );
    }
    render(<Combo />);
    const registry = fakeRegistry(
      { trigger: q('.trigger'), listbox: q('.listbox') },
      { combo: { elementIds: ['trigger', 'listbox'] } }
    );
    const result = captureComponent(registry, { kind: 'component', id: 'combo' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [root, ...rest] = result.capture.nodes;
    expect(root).toMatchObject({ tag: 'button', registeredId: 'combo', portal: null });
    expect(rest).toHaveLength(1);
    expect(rest[0]).toMatchObject({
      tag: 'div',
      registeredId: 'listbox',
      portal: { mountTarget: 'body>div#overlay', reactParentPath: '' },
    });
  });
});

describe('captureComponent — truncation', () => {
  it('caps the node list and says so', () => {
    const big = document.createElement('div');
    for (let i = 0; i < MAX_CAPTURE_NODES + 5; i++) big.appendChild(document.createElement('p'));
    document.body.appendChild(big);
    const result = captureComponent(fakeRegistry({ big }), { kind: 'element', id: 'big' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.capture.nodes).toHaveLength(MAX_CAPTURE_NODES);
    expect(result.capture.unknownChecks).toContain(
      `nodes: truncated at ${MAX_CAPTURE_NODES}; deeper nodes not captured`
    );
  });
});

describe('capture refusal envelope', () => {
  it('puts reason at the top level on the direct path, keeping data.reason', async () => {
    const handlers = createHandlers(fakeRegistry({}, { ghost: { elementIds: [] } }), {} as never);
    const refused = await handlers.getComponentCapture('ghost');
    expect(refused).toMatchObject({
      error: 'component_capture_refused',
      reason: 'no_mounted_elements',
      data: { reason: 'no_mounted_elements' },
    });
  });

  it.each([
    ['rejected (the in-page client posts success:false → rejectCommand)', 'reject'],
    ['resolved with the inner failure payload', 'resolve'],
  ])('survives the relay when %s', async (_label, how) => {
    const relay = new CommandRelay({
      globalPrefix: `__uiBridgeTest_${Math.random().toString(36).slice(2, 10)}`,
    });
    try {
      const inner = componentCaptureCommandResult(
        captureComponent(fakeRegistry({}, { ghost: { elementIds: [] } }), {
          kind: 'component',
          id: 'ghost',
        })
      ) as { error: string };
      relay.subscribeToCommands((cmd) => {
        setTimeout(() => {
          if (how === 'reject') relay.rejectCommand(cmd.commandId, inner.error, 'tab-a');
          else relay.resolveCommand(cmd.commandId, inner, 'tab-a');
        }, 0);
      }, 'tab-a');
      const handlers = createRelayHandlers(relay);
      const refused = await handlers.getComponentCapture!('ghost');
      expect(refused).toMatchObject({
        success: false,
        error: 'component_capture_refused',
        reason: 'no_mounted_elements',
        code: 'UB-OBS-INPUT-MISSING',
        httpStatus: 422,
        data: { error: 'component_capture_refused', reason: 'no_mounted_elements' },
      });
    } finally {
      relay.destroy();
    }
  });
});

// ---------------------------------------------------------------------------
// Re-review fixes
// ---------------------------------------------------------------------------

describe('captureComponent — a component target speaks for its own fiber', () => {
  it("takes props and the root name from the component, not the root's (parent) owner", () => {
    function Pair2({ label }: { label: string }) {
      return (
        <>
          <button type="button" className="p1" aria-label={label} />
          <button type="button" className="p2" />
        </>
      );
    }
    function Parent({ theme }: { theme: string }) {
      return (
        <section className={`parent ${theme}`}>
          <Pair2 label="inner" />
        </section>
      );
    }
    render(<Parent theme="dark" />);
    const registry = fakeRegistry(
      { p1: q('.p1'), p2: q('.p2') },
      { pair2: { elementIds: ['p1', 'p2'] } }
    );
    const result = captureComponent(registry, { kind: 'component', id: 'pair2' }, { props: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The root is the parent's <section> (nearest common DOM ancestor) …
    expect(result.capture.nodes[0].tag).toBe('section');
    // … but identity and props are Pair2's, never Parent's {theme}.
    expect(result.capture.nodes[0].componentName).toBe('Pair2');
    expect(result.capture.props).toEqual({ label: 'inner' });
  });
});

describe('captureComponent — owner-subtree redaction reaches non-React DOM', () => {
  function Host({ token }: { token: string }) {
    return <div className="host" data-token-len={token.length} />;
  }

  it('redacts props when a non-React password input sits under the owner host', () => {
    render(<Host token="abc123" />);
    const host = q('div.host');
    const pw = document.createElement('input');
    pw.type = 'password';
    host.appendChild(pw);
    const result = captureComponent(
      fakeRegistry({ host }),
      { kind: 'element', id: 'host' },
      { props: true }
    );
    expect(result.ok && result.capture.props).toEqual({ token: REDACTED_VALUE });
  });

  it('redacts props when a node in the owner subtree hosts a shadow root', () => {
    render(<Host token="abc123" />);
    const host = q('div.host');
    host.attachShadow({ mode: 'open' });
    const result = captureComponent(
      fakeRegistry({ host }),
      { kind: 'element', id: 'host' },
      { props: true }
    );
    expect(result.ok && result.capture.props).toEqual({ token: REDACTED_VALUE });
  });
});

describe('captureComponent — portals from a root React does not manage', () => {
  it('enumerates portals of the React root rendering into an unmanaged container', () => {
    const layer = document.createElement('div');
    layer.id = 'float';
    document.body.appendChild(layer);
    function Frag() {
      return (
        <>
          <div className="in" />
          {createPortal(<p className="out" />, layer)}
        </>
      );
    }
    const app = render(<Frag />);
    const result = captureComponent(fakeRegistry({ app }), { kind: 'element', id: 'app' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const out = result.capture.nodes.find((n) => n.tag === 'p');
    expect(out?.portal).toEqual({ mountTarget: 'body>div#float', reactParentPath: '' });
    expect(result.capture.unknownChecks.some((n) => n.startsWith('portals:'))).toBe(false);
  });

  it('says portals are unknown when no React fiber is reachable', () => {
    const plain = document.createElement('div');
    plain.appendChild(document.createElement('span'));
    document.body.appendChild(plain);
    const result = captureComponent(fakeRegistry({ plain }), { kind: 'element', id: 'plain' });
    expect(result.ok && result.capture.unknownChecks).toContain(
      'portals: not enumerable (no React fiber reachable from the root); portal facts unknown'
    );
  });
});

describe('captureComponent — portalled split survives re-renders (fiber/alternate pairs)', () => {
  it.each([1, 2, 3])('after %i state update(s)', (updates) => {
    const layer = document.createElement('div');
    layer.id = 'overlay2';
    document.body.appendChild(layer);
    let bump: () => void = () => {};
    function Combo2() {
      const [n, setN] = useState(0);
      bump = () => setN((v) => v + 1);
      return (
        <div className="combo2" data-n={n}>
          <button type="button" className="t2" />
          {createPortal(<div className="lb2" data-n={n} />, layer)}
        </div>
      );
    }
    render(<Combo2 />);
    for (let i = 0; i < updates; i++) act(() => bump());
    const registry = fakeRegistry(
      { t2: q('.t2'), lb2: q('.lb2') },
      { combo2: { elementIds: ['t2', 'lb2'] } }
    );
    const result = captureComponent(registry, { kind: 'component', id: 'combo2' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.capture.nodes.map((n) => [n.tag, n.portal?.mountTarget ?? null])).toEqual([
      ['button', null],
      ['div', 'body>div#overlay2'],
    ]);
    expect(result.capture.nodes[0].componentName).toBe('Combo2');
  });
});

describe('parseComponentCaptureRefusal', () => {
  it('recognises the marker only at the start, and keeps a multi-line message', () => {
    expect(
      parseComponentCaptureRefusal('component_capture_refused:not_found: gone\nsecond line')
    ).toEqual({ reason: 'not_found', message: 'gone\nsecond line' });
    expect(
      parseComponentCaptureRefusal('Error: component_capture_refused:not_found: x')
    ).toBeUndefined();
    expect(parseComponentCaptureRefusal('component_capture_refused:bogus')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Re-review round 3
// ---------------------------------------------------------------------------

describe('captureComponent — a portal nested inside a portal', () => {
  function Nested({ outer, inner }: { outer: HTMLElement; inner: HTMLElement }) {
    return (
      <div className="nest">
        {createPortal(
          <div id="lb" className="lb">
            {createPortal(<p className="deep" />, inner)}
          </div>,
          outer
        )}
      </div>
    );
  }
  function layers() {
    const outer = document.createElement('div');
    outer.id = 'outer-layer';
    const inner = document.createElement('div');
    inner.id = 'inner-layer';
    document.body.append(outer, inner);
    return { outer, inner };
  }
  function assertNested(result: ReturnType<typeof captureComponent>) {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const lb = result.capture.nodes.find((n) => n.tag === 'div' && n.portal);
    const deep = result.capture.nodes.find((n) => n.tag === 'p');
    expect(lb?.portal?.mountTarget).toBe('body>div#outer-layer');
    expect(deep?.portal).toEqual({
      mountTarget: 'body>div#inner-layer',
      reactParentPath: lb!.path,
    });
  }

  it('is captured from a fiber-managed root', () => {
    render(<Nested {...layers()} />);
    const nest = q('div.nest');
    assertNested(captureComponent(fakeRegistry({ nest }), { kind: 'element', id: 'nest' }));
  });

  it('is captured from an unmanaged root (the createRoot container)', () => {
    const app = render(<Nested {...layers()} />);
    assertNested(captureComponent(fakeRegistry({ app }), { kind: 'element', id: 'app' }));
  });
});

describe('deepestCommonFiber — a fiber and its alternate are one ancestor', () => {
  it('meets chains that run through parent and parent.alternate', () => {
    const rootFiber: FiberLike = { tag: 3 };
    const parent: FiberLike = { tag: 0, return: rootFiber };
    const parentAlt: FiberLike = { tag: 0, return: rootFiber, alternate: parent };
    parent.alternate = parentAlt;
    const a: FiberLike = { tag: 5, return: parent };
    const b: FiberLike = { tag: 5, return: parentAlt };
    const met = deepestCommonFiber([
      [a, parent, rootFiber],
      [b, parentAlt, rootFiber],
    ]);
    // Without pair keying the only shared node would be the HostRoot.
    expect(met === parent || met === parentAlt).toBe(true);
  });
});

describe('captureComponent — props are read from the current fiber', () => {
  it.each([1, 2, 3])('reports the latest prop after %i parent re-render(s)', (renders) => {
    let set: (v: number) => void = () => {};
    function Child({ v }: { v: number }) {
      return <div className="child" data-v={v} />;
    }
    function Holder() {
      const [v, setV] = useState(0);
      set = setV;
      return <Child v={v} />;
    }
    render(<Holder />);
    for (let i = 1; i <= renders; i++) act(() => set(i * 10));
    const child = q('div.child');
    const result = captureComponent(
      fakeRegistry({ child }),
      { kind: 'element', id: 'child' },
      { props: true }
    );
    expect(result.ok && result.capture.props).toEqual({ v: renders * 10 });
  });
});

describe('captureComponent — owner-subtree redaction, opaque and oversized DOM', () => {
  function Host({ token }: { token: string }) {
    return <div className="host" data-token-len={token.length} />;
  }

  it('redacts when a non-React grandchild hosts a shadow root', () => {
    render(<Host token="t0k" />);
    const host = q('div.host');
    const child = document.createElement('div');
    const grandchild = document.createElement('span');
    child.appendChild(grandchild);
    host.appendChild(child);
    grandchild.attachShadow({ mode: 'open' });
    const result = captureComponent(
      fakeRegistry({ host }),
      { kind: 'element', id: 'host' },
      { props: true }
    );
    expect(result.ok && result.capture.props).toEqual({ token: REDACTED_VALUE });
  });

  it('redacts when a custom element holds a CLOSED shadow root', () => {
    if (!customElements.get('secret-box')) {
      customElements.define(
        'secret-box',
        class extends HTMLElement {
          constructor() {
            super();
            this.attachShadow({ mode: 'closed' });
          }
        }
      );
    }
    render(<Host token="t0k" />);
    const host = q('div.host');
    const box = document.createElement('secret-box');
    host.appendChild(box);
    expect(box.shadowRoot).toBeNull(); // closed: invisible to the open-root arm
    const result = captureComponent(
      fakeRegistry({ host }),
      { kind: 'element', id: 'host' },
      { props: true }
    );
    expect(result.ok && result.capture.props).toEqual({ token: REDACTED_VALUE });
  });

  it('redacts when the subtree exceeds the DOM scan budget', () => {
    render(<Host token="t0k" />);
    const host = q('div.host');
    const frag = document.createDocumentFragment();
    for (let i = 0; i <= OWNER_SUBTREE_DOM_BUDGET; i++)
      frag.appendChild(document.createElement('b'));
    host.appendChild(frag);
    // Read the props directly: a full capture would also style-walk 2000 nodes.
    expect(extractOwnerComponentProps(host)).toEqual({ token: REDACTED_VALUE });
    // Exactly BUDGET elements below the host are scanned to the end and stay clear.
    host.lastElementChild!.remove();
    expect(host.querySelectorAll('*')).toHaveLength(OWNER_SUBTREE_DOM_BUDGET);
    expect(extractOwnerComponentProps(host)).toEqual({ token: 't0k' });
  });

  it('keeps props when the subtree is clear (control)', () => {
    render(<Host token="t0k" />);
    const host = q('div.host');
    const result = captureComponent(
      fakeRegistry({ host }),
      { kind: 'element', id: 'host' },
      { props: true }
    );
    expect(result.ok && result.capture.props).toEqual({ token: 't0k' });
  });
});

describe('captureComponent — React elements in props are compact', () => {
  it('renders an element prop as <Type> and never walks _owner/_store', () => {
    function Icon() {
      return <i />;
    }
    function Slot({ icon, label }: { icon: React.ReactNode; label: React.ReactNode }) {
      return (
        <div className="slot">
          {icon}
          {label}
        </div>
      );
    }
    render(<Slot icon={<Icon />} label={<b>hi</b>} />);
    const slot = q('div.slot');
    const result = captureComponent(
      fakeRegistry({ slot }),
      { kind: 'element', id: 'slot' },
      { props: true }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.capture.props).toEqual({ icon: '<Icon>', label: '<b>' });
    expect(JSON.stringify(result.capture.props)).not.toMatch(/_owner|_store/);
  });
});

describe('captureComponent — component-target owner note and unmanaged root', () => {
  it('notes the heuristic owner and names an unmanaged root from the owner', () => {
    // The two elements are top-level, so the root is the unmanaged createRoot
    // container: its name must still come from the component's fiber.
    function Duo({ tone }: { tone: string }) {
      return (
        <>
          <button type="button" className="d1" data-tone={tone} />
          <button type="button" className="d2" />
        </>
      );
    }
    const app = render(<Duo tone="calm" />);
    const registry = fakeRegistry(
      { d1: q('.d1'), d2: q('.d2') },
      { duo: { elementIds: ['d1', 'd2'] } }
    );
    const result = captureComponent(registry, { kind: 'component', id: 'duo' }, { props: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.capture.nodes[0].tag).toBe('div');
    expect(app.contains(q('.d1'))).toBe(true);
    expect(result.capture.nodes[0].componentName).toBe('Duo');
    expect(result.capture.props).toEqual({ tone: 'calm' });
    expect(
      result.capture.unknownChecks.some((n) =>
        n.startsWith('componentName/props: the component fiber is resolved heuristically')
      )
    ).toBe(true);
    expect(result.capture.unknownChecks.some((n) => n.includes('not React-managed'))).toBe(false);
  });
});

describe('extractComponentFiberProps — a stale (alternate) owner is resolved to the current one', () => {
  it('reads memoizedProps from the committed half of the pair', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    const host: FiberLike & { memoizedProps?: unknown } = { tag: 5, stateNode: div };
    const root: FiberLike = { tag: 3 };
    const rootAlt: FiberLike = { tag: 3, alternate: root };
    root.alternate = rootAlt;
    const stale = { tag: 0, return: root, memoizedProps: { v: 'old' } } as FiberLike;
    const live = { tag: 0, return: root, memoizedProps: { v: 'new' }, child: host } as FiberLike;
    stale.alternate = live;
    live.alternate = stale;
    host.return = live;
    // Both halves of the HostRoot point at the committed child.
    root.child = live;
    rootAlt.child = live;
    root.stateNode = { current: root };
    expect(extractComponentFiberProps(stale, div)).toEqual({ v: 'new' });
  });
});

// ---------------------------------------------------------------------------
// Re-review round 4
// ---------------------------------------------------------------------------

/** A DOM node whose (fake) owner fiber counts every read of its props. */
function countingPropsElement(): { el: HTMLDivElement; reads: () => number } {
  let reads = 0;
  const el = document.createElement('div');
  document.body.appendChild(el);
  const owner = {
    tag: 0,
    type: function Counted() {
      return null;
    },
    get memoizedProps() {
      reads++;
      return { token: 'x' };
    },
  };
  const hostFiber = { tag: 5, stateNode: el, return: owner };
  (owner as { child?: unknown }).child = hostFiber;
  Object.defineProperty(el, '__reactFiber$count', { value: hostFiber, enumerable: true });
  return { el, reads: () => reads };
}

describe('captureComponent — props are opt-in', () => {
  it('answers props null and never reads props by default', () => {
    const { el, reads } = countingPropsElement();
    const result = captureComponent(fakeRegistry({ el }), { kind: 'element', id: 'el' });
    expect(result.ok && result.capture.props).toBeNull();
    expect(reads()).toBe(0);
    expect(result.ok && result.capture.unknownChecks.some((n) => n.startsWith('props:'))).toBe(
      false
    );
  });

  it('reads props on request and notes the closed-shadow-root gap', () => {
    const { el, reads } = countingPropsElement();
    const result = captureComponent(
      fakeRegistry({ el }),
      { kind: 'element', id: 'el' },
      { props: true }
    );
    expect(result.ok && result.capture.props).toEqual({ token: 'x' });
    expect(reads()).toBeGreaterThan(0);
    expect(result.ok && result.capture.unknownChecks).toContain(
      'props: a closed shadow root on a standard element cannot be detected, so the fail-closed redaction may miss content inside one'
    );
  });

  it('the direct route reads props only for ?props=true', async () => {
    const { el, reads } = countingPropsElement();
    const handlers = createHandlers(fakeRegistry({ el }), {} as never);
    const off = await handlers.getElementCapture('el', {});
    expect((off.data as { props: unknown }).props).toBeNull();
    const junk = await handlers.getElementCapture('el', { props: 'yes' });
    expect((junk.data as { props: unknown }).props).toBeNull();
    expect(reads()).toBe(0);
    const on = await handlers.getElementCapture('el', { props: 'true' });
    expect((on.data as { props: unknown }).props).toEqual({ token: 'x' });
  });

  it('the relay route forwards the normalised opt-in and the tab routing', async () => {
    const relay = new CommandRelay({
      globalPrefix: `__uiBridgeTest_${Math.random().toString(36).slice(2, 10)}`,
    });
    try {
      const payloads: unknown[] = [];
      relay.subscribeToCommands((cmd) => {
        payloads.push(cmd.payload);
        setTimeout(() => relay.resolveCommand(cmd.commandId, { nodes: [] }, 'tab-a'), 0);
      }, 'tab-a');
      const handlers = createRelayHandlers(relay);
      await handlers.getComponentCapture!('c', { props: 'true', tabId: 'tab-a' });
      await handlers.getElementCapture!('e');
      expect(payloads).toEqual([
        { id: 'c', props: true },
        { id: 'e', props: false },
      ]);
    } finally {
      relay.destroy();
    }
  });
});

describe('captureComponent — compact React objects in props', () => {
  it('prints a reused element as <Type> each time and labels a memo type passed as a prop', () => {
    function Icon() {
      return <i />;
    }
    const MemoRow = memo(function MemoRow() {
      return null;
    });
    const shared = <Icon />;
    function Panel(_props: {
      a: React.ReactNode;
      b: React.ReactNode;
      as: unknown;
      frag: React.ReactNode;
    }) {
      return <div className="panel" />;
    }
    render(<Panel a={shared} b={shared} as={MemoRow} frag={<>x</>} />);
    const panel = q('div.panel');
    const result = captureComponent(
      fakeRegistry({ panel }),
      { kind: 'element', id: 'panel' },
      { props: true }
    );
    expect(result.ok && result.capture.props).toEqual({
      a: '<Icon>',
      b: '<Icon>',
      as: '[memo MemoRow]',
      frag: '<Fragment>',
    });
  });
});

describe('captureComponent — React-root discovery skips managed subtrees', () => {
  it('does not exhaust on a managed subtree with more DOM than the discovery budget', () => {
    const wrapper = document.createElement('div');
    document.body.appendChild(wrapper);
    // A React div holding raw (non-React) DOM — a chart library, say: many DOM
    // nodes, few fibers. Only a full-DOM discovery scan would exhaust here.
    function Chart() {
      return <div className="chart" />;
    }
    render(<Chart />, wrapper);
    const frag = document.createDocumentFragment();
    for (let i = 0; i < MAX_PORTAL_WALK_FIBERS + 50; i++) {
      frag.appendChild(document.createElement('b'));
    }
    q('div.chart').appendChild(frag);
    const result = captureComponent(fakeRegistry({ wrapper }), { kind: 'element', id: 'wrapper' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.capture.unknownChecks.some((n) => n.startsWith('portals:'))).toBe(false);
  }, 30_000);

  it('skips a managed subtree and still finds a React root behind a later non-React island', () => {
    const wrapper = document.createElement('div');
    document.body.appendChild(wrapper);
    function Header() {
      return (
        <header className="hdr">
          <nav />
        </header>
      );
    }
    render(<Header />, wrapper);
    const island = document.createElement('section');
    wrapper.appendChild(island);
    const layer = document.createElement('div');
    layer.id = 'island-layer';
    document.body.appendChild(layer);
    function Pop() {
      return createPortal(<p className="island-pop" />, layer);
    }
    render(<Pop />, island);

    const result = captureComponent(fakeRegistry({ wrapper }), { kind: 'element', id: 'wrapper' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.capture.nodes.find((n) => n.tag === 'p')?.portal?.mountTarget).toBe(
      'body>div#island-layer'
    );
  });
});

describe('captureComponent — component owner notes', () => {
  it('uses a distinct note when no owning component fiber resolves', () => {
    const a = document.createElement('button');
    const b = document.createElement('button');
    const box = document.createElement('div');
    box.append(a, b);
    document.body.appendChild(box);
    const registry = fakeRegistry({ a, b }, { plain: { elementIds: ['a', 'b'] } });
    const result = captureComponent(registry, { kind: 'component', id: 'plain' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.capture.unknownChecks).toContain(
      'componentName/props: no owning component fiber resolved for the elementIds; root name and props unknown'
    );
    expect(result.capture.unknownChecks.some((n) => n.includes('resolved heuristically'))).toBe(
      false
    );
  });
});

describe('captureComponent — a root created inside an element another root rendered', () => {
  function setup(): { outerContainer: HTMLElement; wrap: HTMLElement } {
    function Outer() {
      return (
        <div className="outer-wrap">
          <div className="mount-point" />
        </div>
      );
    }
    const outerContainer = render(<Outer />);
    const layer = document.createElement('div');
    layer.id = 'nested-layer';
    document.body.appendChild(layer);
    function Inner() {
      return createPortal(<p className="nested-pop" />, layer);
    }
    const innerRoot = createRoot(q('div.mount-point'));
    roots.push(innerRoot);
    act(() => innerRoot.render(<Inner />));
    return { outerContainer, wrap: q('div.outer-wrap') };
  }

  function assertFound(result: ReturnType<typeof captureComponent>) {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const pop = result.capture.nodes.find((n) => n.tag === 'p');
    expect(pop?.portal?.mountTarget).toBe('body>div#nested-layer');
  }

  it('is followed from a fiber-managed root', () => {
    const { wrap } = setup();
    assertFound(captureComponent(fakeRegistry({ wrap }), { kind: 'element', id: 'wrap' }));
  });

  it('is followed from an unmanaged root (the outer createRoot container)', () => {
    const { outerContainer } = setup();
    assertFound(
      captureComponent(fakeRegistry({ outerContainer }), {
        kind: 'element',
        id: 'outerContainer',
      })
    );
  });
});
