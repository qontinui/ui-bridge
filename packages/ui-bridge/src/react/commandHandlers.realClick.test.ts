/**
 * Relay click → real pointer sequence (Radix/pointer-event controls).
 *
 * Background: Radix UI Tabs/menus/dialogs are pointer-event driven — their
 * triggers listen on `pointerdown` and never act on a synthetic `click`
 * MouseEvent. The relay's click handlers used a bare `element.click()`, so
 * the relay returned success while the Radix control never opened/selected,
 * and the Spec-CI transition's `waitAfter` timed out.
 *
 * Fix: `dispatchRealClick` dispatches the full
 * `pointerdown → mousedown → pointerup → mouseup → click` sequence (native
 * `.click()` runs only when the synthetic dispatch is unavailable — an
 * unconditional fallback delivered TWO click events per relay click, which
 * double-fired React onClick handlers: duplicate non-idempotent submits and
 * switches that double-toggled back to their original state). These tests
 * assert that the relay `executeElementAction`/`clickByText`/`clickBySelector`
 * cases dispatch that sequence so a pointer-event listener fires, and that
 * exactly ONE `click` event reaches the element.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { executeCommand, type BridgeAccess } from './commandHandlers';
import { getGlobalRegistry } from '../core/registry';

const emptyBridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
};

describe('relay click → real pointer sequence', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('button');
    host.textContent = 'A non-default tab';
    // jsdom reports offsetParent === null for every element (no layout); the
    // relay's visibility gate checks `offsetParent !== null`, so stub it to a
    // truthy node. Display/visibility default to visible in jsdom.
    Object.defineProperty(host, 'offsetParent', {
      configurable: true,
      get: () => document.body,
    });
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
    getGlobalRegistry().clear();
  });

  it('executeElementAction "click" dispatches pointerdown/pointerup/click (Radix-friendly)', async () => {
    getGlobalRegistry().registerElement('el-tab-1', host, {
      type: 'button',
      label: 'A non-default tab',
    });

    const seen: string[] = [];
    for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click']) {
      host.addEventListener(t, () => seen.push(t));
    }

    const result = (await executeCommand(
      'executeElementAction',
      { id: 'el-tab-1', request: { action: 'click' } },
      emptyBridge,
    )) as { success?: boolean };

    expect(result.success).toBe(true);
    // The pointer sequence the Radix trigger relies on must have fired.
    expect(seen).toContain('pointerdown');
    expect(seen).toContain('pointerup');
    expect(seen).toContain('click');
    // Ordering: pointerdown precedes pointerup precedes click.
    expect(seen.indexOf('pointerdown')).toBeLessThan(seen.indexOf('pointerup'));
    expect(seen.indexOf('pointerup')).toBeLessThan(seen.indexOf('click'));
    // Exactly ONE click event — the unconditional native-click fallback used
    // to deliver a second one, double-firing onClick handlers.
    expect(seen.filter((t) => t === 'click')).toHaveLength(1);
  });

  it('a click reaches the element exactly once (no double-activation)', async () => {
    getGlobalRegistry().registerElement('el-once', host, { type: 'button' });

    let clicks = 0;
    host.addEventListener('click', () => {
      clicks += 1;
    });

    await executeCommand(
      'executeElementAction',
      { id: 'el-once', request: { action: 'click' } },
      emptyBridge,
    );

    expect(clicks).toBe(1);
  });

  it('a pointerdown-only listener (Radix-style) fires — bare click() would have missed it', async () => {
    getGlobalRegistry().registerElement('el-radix', host, { type: 'button' });

    let pointerDownFired = false;
    host.addEventListener('pointerdown', () => {
      pointerDownFired = true;
    });

    await executeCommand(
      'executeElementAction',
      { id: 'el-radix', request: { action: 'click' } },
      emptyBridge,
    );

    expect(pointerDownFired).toBe(true);
  });

  it('clickByText dispatches the pointer sequence', async () => {
    const seen: string[] = [];
    for (const t of ['pointerdown', 'pointerup', 'click']) {
      host.addEventListener(t, () => seen.push(t));
    }

    const result = (await executeCommand(
      'clickByText',
      { text: 'A non-default tab' },
      emptyBridge,
    )) as { clicked?: boolean };

    expect(result.clicked).toBe(true);
    expect(seen).toContain('pointerdown');
    expect(seen).toContain('pointerup');
    expect(seen).toContain('click');
  });

  it('clickBySelector dispatches the pointer sequence', async () => {
    host.id = 'sel-target';
    const seen: string[] = [];
    for (const t of ['pointerdown', 'pointerup', 'click']) {
      host.addEventListener(t, () => seen.push(t));
    }

    const result = (await executeCommand(
      'clickBySelector',
      { selector: '#sel-target' },
      emptyBridge,
    )) as { clicked?: boolean };

    expect(result.clicked).toBe(true);
    expect(seen).toContain('pointerdown');
    expect(seen).toContain('pointerup');
    expect(seen).toContain('click');
  });
});
