/**
 * bbox-tracker tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UIBridgeRegistry } from '../core/registry';
import { trackElementBbox, pollForTaggedElement, UI_BRIDGE_ID_ATTR } from './bbox-tracker';

describe('trackElementBbox', () => {
  let registry: UIBridgeRegistry;
  let container: HTMLDivElement;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('pushes an initial bbox into the registry synchronously', () => {
    const el = document.createElement('button');
    container.appendChild(el);
    registry.registerElement('btn', el);

    // JSDOM getBoundingClientRect returns 0s by default — good enough to
    // prove the path fires; we just care that bbox/visible are populated.
    const untrack = trackElementBbox(registry, 'btn', el);

    const entry = registry.getElement('btn')!;
    expect(entry.bbox).toBeDefined();
    expect(entry.bbox!.x).toBe(0);
    expect(entry.bbox!.y).toBe(0);
    // zero-size rect ⇒ visible false
    expect(entry.visible).toBe(false);

    untrack();
  });

  it('returns an untrack function that disconnects cleanup', () => {
    const el = document.createElement('button');
    container.appendChild(el);
    registry.registerElement('btn', el);

    const untrack = trackElementBbox(registry, 'btn', el);
    expect(typeof untrack).toBe('function');
    // Should not throw.
    untrack();
    untrack();
  });

  it('clears bbox when tracked element detaches from the document', () => {
    const el = document.createElement('button');
    container.appendChild(el);
    registry.registerElement('btn', el);

    const untrack = trackElementBbox(registry, 'btn', el);
    expect(registry.getElement('btn')!.bbox).toBeDefined();

    // Detach the element. Re-measure by tearing down + re-tracking —
    // production path relies on ResizeObserver / scroll listener fires
    // which jsdom doesn't simulate, but the detach-safety branch can be
    // verified by re-tracking: since the node isn't connected, it writes
    // undefined.
    container.removeChild(el);
    untrack();
    trackElementBbox(registry, 'btn', el);

    const entry = registry.getElement('btn')!;
    expect(entry.bbox).toBeUndefined();
    expect(entry.visible).toBeUndefined();
  });
});

describe('pollForTaggedElement', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('finds an element already in the DOM', async () => {
    const el = document.createElement('div');
    el.setAttribute(UI_BRIDGE_ID_ATTR, 'my-id');
    container.appendChild(el);

    const found = await pollForTaggedElement('my-id', 1, 10);
    expect(found).toBe(el);
  });

  it('resolves with null when the element never appears', async () => {
    const found = await pollForTaggedElement('missing', 2, 5);
    expect(found).toBeNull();
  });

  it('finds an element that appears after mount', async () => {
    const promise = pollForTaggedElement('late', 5, 20);
    setTimeout(() => {
      const el = document.createElement('div');
      el.setAttribute(UI_BRIDGE_ID_ATTR, 'late');
      container.appendChild(el);
    }, 30);

    const found = await promise;
    expect(found?.getAttribute(UI_BRIDGE_ID_ATTR)).toBe('late');
  });

  it('escapes ids that contain CSS-selector-sensitive characters', async () => {
    const el = document.createElement('div');
    el.setAttribute(UI_BRIDGE_ID_ATTR, 'weird.id:with/chars');
    container.appendChild(el);

    const found = await pollForTaggedElement('weird.id:with/chars', 1, 10);
    expect(found).toBe(el);
  });
});
