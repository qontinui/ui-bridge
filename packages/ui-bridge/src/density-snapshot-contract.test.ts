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
 * from it. Renaming any one of those paths on either side turns this red.
 *
 * jsdom lays nothing out, so geometry and computed sizes here are what jsdom
 * reports (zero rects, inline styles); Phase 2's real-browser smoke proves
 * them from a laid-out page.
 *
 * Plan: 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change (Phase 1).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { UIBridgeRegistry } from './core/registry';
import { pageViewportContext } from './control/page-scroll-container';
import { captureDensityFromSnapshot, type DensityCapture } from './density';

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
        <button id="b" data-ui-bridge-id="app.orders.refresh" aria-expanded="false"
          style="font-size: 13px; line-height: 18px; position: sticky;">Refresh orders</button>
        <span id="t" data-ui-bridge-content="app.orders.total"
          style="font-size: 15px; line-height: 20px; position: static;">Total 1.234,56 €</span>
        <section data-bridge-redact="true"><span id="s">Synthetic secret 42</span></section>
      </main>`;
    registry = new UIBridgeRegistry();
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
      structureBy: 'xpath',
      rect: { x: 0, y: 0, w: 0, h: 0 },
      chars: 14,
      shape: 'text',
      fontPx: 13,
      lineHeightPx: 18,
      position: 'sticky',
      expanded: false,
      truncated: false,
    });
    expect(button.visibility).not.toBeNull();

    const total = byId['app.orders.total'];
    expect(total).toMatchObject({
      interactive: false,
      authorId: true,
      chars: 16,
      fontPx: 15,
      lineHeightPx: 20,
      position: 'static',
    });

    const secret = byId['app.secret'];
    expect([secret.chars, secret.textHash, secret.shape]).toEqual([null, null, null]);
    expect(JSON.stringify(capture)).not.toContain('Synthetic secret');
    expect(JSON.stringify(capture)).not.toContain('Refresh orders');
  });
});
