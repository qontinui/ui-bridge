/**
 * The density adapter's contract with the snapshot the SDK actually emits.
 *
 * The core's own fixtures are typed against `ControlSnapshot`, whose element
 * fields are nearly all optional, so they prove what the adapter does WITH a
 * field and not that the serializer WRITES it. This test closes that: it
 * registers elements in a real registry, serializes them with
 * `registry.createSnapshot()` plus the viewport block the snapshot handlers
 * attach (`pageViewportContext`, as `server/handlers.ts` does), hands the
 * result to `captureDensityFromSnapshot`, and asserts both that every field
 * path the adapter reads is present and that the adapter's output was derived
 * from it. Renaming any one of the paths asserted here, on either side, turns
 * this red. `state.visibilityReason` is read but not asserted: whether jsdom
 * yields one is incidental, and Phase 2's real-browser smoke reads it.
 *
 * jsdom lays nothing out, so geometry and computed sizes here are what jsdom
 * reports (zero rects, inline styles); Phase 2's real-browser smoke proves
 * them from a laid-out page.
 *
 * Plan: 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change (Phases 1 and 4).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { UIBridgeRegistry } from './core/registry';
import { pageViewportContext } from './control/page-scroll-container';
import { RelationshipTracker } from './relationships/relationship-tracker';
import { captureDensityFromSnapshot, sha256DensityHex, type DensityCapture } from './density';

const PRODUCER = {
  id: 'sdk/density',
  version: '0.0.0-test',
  package: '@qontinui/ui-bridge',
} as const;

function snapshotOf(registry: UIBridgeRegistry): Record<string, unknown> {
  // A JSON round trip: the adapter reads the wire form, never live objects.
  return JSON.parse(
    JSON.stringify({ ...registry.createSnapshot(), viewport: pageViewportContext() })
  ) as Record<string, unknown>;
}

describe('density adapter reads the fields the registry serializer writes', () => {
  let registry: UIBridgeRegistry;

  beforeEach(() => {
    document.body.innerHTML = `
      <main id="main">
        <button id="b" data-ui-bridge-id="app.orders.refresh" aria-expanded="false" aria-controls="p"
          style="font-size: 13px; line-height: 18px; position: sticky; overflow: hidden;">Refresh orders</button>
        <span id="t" data-ui-bridge-content="app.orders.total"
          style="font-size: 15px; line-height: 20px; position: static;">Total 1.234,56 €</span>
        <section data-bridge-redact="true"><span id="s">Synthetic secret 42</span></section>
        <div id="p" role="region">Order details</div>
        <a id="l" href="/orders/1" data-ui-bridge-id="link-orders">Orders</a>
        <div id="pane" style="overflow-x: auto; overflow-y: auto;">A long synthetic list</div>
        <ul id="ol" data-testid="orders-list"><li>Row one</li></ul>
        <button id="tab" role="tab" aria-selected="false">Closed orders</button>
        <input id="q" type="search" />
        <button id="ic" aria-label="Delete order"></button>
      </main>`;
    registry = new UIBridgeRegistry();
    // The provider wires a tracker the same way (react/UIBridgeProviderInit.ts).
    const tracker = new RelationshipTracker();
    registry.setEnrichers({ relationshipTracker: tracker });
    registry.registerElement('app.orders.refresh', document.getElementById('b')!, {
      type: 'button',
      actions: ['click'],
      category: 'interactive',
    });
    registry.registerElement('app.orders.total', document.getElementById('t')!, {
      type: 'custom',
      actions: [],
      category: 'content',
    });
    registry.registerElement('app.secret', document.getElementById('s')!, {
      type: 'custom',
      actions: [],
      category: 'content',
    });
    registry.registerElement('app.panel', document.getElementById('p')!, {
      type: 'custom',
      actions: [],
      category: 'content',
    });
    // What the auto-registrar does: register with origin 'auto' and stamp
    // data-ui-bridge-id (react/useAutoRegister.ts).
    registry.registerElement('link-orders', document.getElementById('l')!, {
      type: 'link',
      actions: ['click'],
      category: 'interactive',
      origin: 'auto',
    });
    // jsdom lays nothing out; give the pane the extent a scroll container has.
    const pane = document.getElementById('pane')!;
    for (const [key, value] of [
      ['scrollHeight', 3000],
      ['clientHeight', 700],
      ['clientWidth', 1024],
      ['scrollWidth', 1024],
    ] as const) {
      Object.defineProperty(pane, key, { get: () => value, configurable: true });
    }
    // A list with its own id AND a test id: the row's chain anchors at the
    // test id (generateXPath checks it first), so the parent is found only
    // through `identifier.testId`.
    registry.registerElement('app.orders.list', document.getElementById('ol')!, {
      type: 'custom',
      actions: [],
      category: 'content',
    });
    registry.registerElement('app.orders.row', document.querySelector('#ol > li') as HTMLElement, {
      type: 'custom',
      actions: [],
      category: 'content',
    });
    registry.registerElement('app.pane', pane, {
      type: 'custom',
      actions: [],
      category: 'content',
    });
    registry.registerElement('app.orders.tab', document.getElementById('tab')!, {
      type: 'button',
      actions: ['click'],
      category: 'interactive',
    });
    registry.registerElement('app.orders.search', document.getElementById('q')!, {
      type: 'input',
      actions: ['type'],
      category: 'interactive',
    });
    // An icon-only control: the serializer fills its textContent from aria-label.
    registry.registerElement('app.orders.delete', document.getElementById('ic')!, {
      type: 'button',
      actions: ['click'],
      category: 'interactive',
    });
    // A declared edge, as useUIRelationship writes it: the search narrows the list.
    tracker.declare('app.orders.search', 'app.orders.list', 'filters');
  });

  it('every field path the adapter reads is present in a real snapshot', () => {
    const snapshot = snapshotOf(registry);
    const viewport = snapshot.viewport as Record<string, unknown>;
    for (const key of [
      'viewportWidth',
      'viewportHeight',
      'scrollX',
      'scrollY',
      'documentWidth',
      'documentHeight',
      'container',
    ]) {
      expect(viewport, `viewport.${key}`).toHaveProperty(key);
    }
    expect(typeof snapshot.snapshotTakenAtMs).toBe('number');
    const rows = snapshot.elements as Array<Record<string, unknown>>;
    const byId = Object.fromEntries(rows.map((r) => [r.id as string, r]));
    const button = byId['app.orders.refresh'];
    const total = byId['app.orders.total'];
    const secret = byId['app.secret'];

    expect(button.uiBridgeId).toBe('app.orders.refresh');
    expect(button.category).toBe('interactive');
    expect(button.tagName).toBe('button');
    expect((button.identifier as Record<string, unknown>).xpath).toEqual(expect.any(String));
    expect((button.stableRef as Record<string, unknown>).semanticPath).toEqual(expect.any(String));
    const bState = button.state as Record<string, unknown>;
    expect(bState.rect).toEqual(expect.objectContaining({ x: 0, y: 0, width: 0, height: 0 }));
    expect(typeof bState.visible).toBe('boolean');
    expect(bState.textContent).toBe('Refresh orders');
    // Phase 5: the row's visible text (no aria-label / title fallback), which
    // says whether the counted text is drawn.
    expect(button.text).toBe('Refresh orders');
    const icon = byId['app.orders.delete'];
    expect((icon.state as Record<string, unknown>).textContent).toBe('Delete order');
    expect(icon).not.toHaveProperty('text');
    expect((icon.state as Record<string, unknown>).nameSource).toBe('aria-label');
    expect(bState.ariaExpanded).toBe(false);
    expect(typeof bState.scrollWidth).toBe('number');
    expect(typeof bState.clientWidth).toBe('number');
    expect(typeof bState.nameSource).toBe('string');
    const styles = bState.computedStyles as Record<string, unknown>;
    expect([styles.fontSize, styles.lineHeight, styles.position, typeof styles.overflow]).toEqual([
      '13px',
      '18px',
      'sticky',
      'string',
    ]);

    const tState = total.state as Record<string, unknown>;
    expect((tState.dataset as Record<string, unknown>).uiBridgeContent).toBe('app.orders.total');
    expect((secret.state as Record<string, unknown>).redaction).toMatchObject({ content: true });

    expect(button.role).toBe('button');
    expect(styles.overflow).toBe('hidden');
    const link = byId['link-orders'];
    expect(link.origin).toBe('auto');
    expect(link.uiBridgeId).toBe('link-orders');
    expect(typeof (link.state as Record<string, unknown>).href).toBe('string');
    const pane = byId['app.pane'].state as Record<string, unknown>;
    expect(pane.scrollInfo).toMatchObject({
      scrollHeight: 3000,
      clientHeight: 700,
      clientWidth: 1024,
    });
    const list = byId['app.orders.list'].identifier as Record<string, unknown>;
    expect([list.xpath, list.htmlId, list.testId]).toEqual(['//*[@id="ol"]', 'ol', 'orders-list']);
    expect((byId['app.orders.row'].identifier as Record<string, unknown>).xpath).toBe(
      '/ul[@data-testid="orders-list"]/li'
    );
    const relationships = (snapshot.relationships as Record<string, unknown>).relationships;
    expect(relationships).toContainEqual(
      expect.objectContaining({
        source: 'app.orders.refresh',
        target: 'app.panel',
        type: 'controls',
      })
    );
    // Phase 4: aria-selected, the computed role of a search input, and a filters edge.
    expect((byId['app.orders.tab'].state as Record<string, unknown>).ariaSelected).toBe(false);
    expect(byId['app.orders.search'].role).toBe('searchbox');
    expect(relationships).toContainEqual(
      expect.objectContaining({
        source: 'app.orders.search',
        target: 'app.orders.list',
        type: 'filters',
      })
    );
  });

  it('the adapter derives each item field from those paths', () => {
    const obs = captureDensityFromSnapshot(snapshotOf(registry), { producer: PRODUCER });
    expect(obs.status).toBe('measured');
    const capture = (obs as { value: DensityCapture }).value;
    expect(capture.viewport.width).toBe(window.innerWidth);
    expect(capture.viewport.height).toBe(window.innerHeight);
    expect(capture.viewport.container).toBe('viewport');
    expect(capture.observedAt).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));

    const byId = Object.fromEntries(capture.items.map((i) => [i.id, i]));
    const button = byId['app.orders.refresh'];
    expect(button).toMatchObject({
      tag: 'button',
      interactive: true,
      authorId: true,
      // Its own id: the xpath names no ancestor, and jsdom's 0x0 rects contain nothing.
      structureBy: 'geometry',
      parent: null,
      rect: { x: 0, y: 0, w: 0, h: 0 },
      chars: 14,
      shape: 'text',
      fontPx: 13,
      lineHeightPx: 18,
      position: 'sticky',
      expanded: false,
      truncated: false,
      charsDrawn: true,
    });
    expect(button.visibility).not.toBeNull();
    // The icon-only control counts its aria-label, which the page does not draw.
    expect([byId['app.orders.delete'].chars, byId['app.orders.delete'].charsDrawn]).toEqual([
      12,
      false,
    ]);

    const total = byId['app.orders.total'];
    expect(total).toMatchObject({
      interactive: false,
      authorId: true,
      chars: 16,
      fontPx: 15,
      lineHeightPx: 20,
      position: 'static',
    });

    expect(button.role).toBe('button');
    expect(button.controls).toBe('app.panel');
    const rawLink = (snapshotOf(registry).elements as Array<Record<string, unknown>>).find(
      (r) => r.id === 'link-orders'
    )!;
    const link = byId['link-orders'];
    expect(link.authorId).toBe(false);
    expect(link.href).toBe(sha256DensityHex((rawLink.state as { href: string }).href));
    expect(capture.bases.scrollBasis).toBe('inner-scroller');
    expect(capture.bases.scroller).toEqual({ by: 'scroll-info', id: 'app.pane' });

    // The row's chain anchors at the list's test id: parent read from the xpath.
    expect(capture.structureResolved).toBe(true);
    expect(byId['app.orders.row']).toMatchObject({
      parent: 'app.orders.list',
      path: ['ul'],
      structureBy: 'xpath',
      chars: 7,
      ownChars: 7,
    });
    expect(byId['app.orders.list'].ownChars).toBe(0);

    expect(byId['app.orders.tab'].selected).toBe(false);
    expect(byId['app.orders.search'].role).toBe('searchbox');
    expect(byId['app.orders.search'].filters).toBe('app.orders.list');

    const secret = byId['app.secret'];
    expect([secret.chars, secret.textHash, secret.shape]).toEqual([null, null, null]);
    expect(JSON.stringify(capture)).not.toContain('Synthetic secret');
    expect(JSON.stringify(capture)).not.toContain('Refresh orders');
  });
});
