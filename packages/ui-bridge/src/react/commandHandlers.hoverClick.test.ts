/**
 * Relay `hoverClick` → reveal-then-click on a hover-gated control.
 *
 * Background: `@qontinui/ui-bridge` ships a `hoverClick` action for controls
 * whose interactivity is gated behind a CSS `:hover` / Tailwind `group-hover`
 * rule — the runner's `ZoneHoverActions` toolbar is the canonical case: its
 * buttons are `pointer-events:none` until a `.group` ancestor is hovered, then
 * `group-hover:pointer-events-auto` flips them to `auto`. `hoverClick` was
 * wired into the HTTP `action-executor.ts` path but NOT the React IPC
 * `commandHandlers.ts` path the Tauri runner drives, so a `hoverClick` IPC
 * command fell through to `default` → `ACTION_NOT_SUPPORTED`.
 *
 * Fix: the `executeElementAction` switch now has a `case 'hoverClick'` that
 * reuses the action-executor's exported hover helpers
 * (`findHoverableAncestor` + `dispatchHoverEnter` + `nextAnimationFrame`) to
 * hover the nearest hoverable ancestor and the target, yield an animation
 * frame, then `dispatchRealClick`. These tests assert that a hover-gated
 * element is successfully clicked via `hoverClick`, and that a plain `click`
 * on the same element still behaves as before.
 *
 * jsdom note: jsdom does not run a stylesheet `:hover` recalc, so to model the
 * real-browser reveal we attach a `mouseenter` listener on the `.group`
 * ancestor that flips the button's inline `pointer-events` to `auto` — exactly
 * what the CSS rule would do — and assert the click lands AFTER that flip.
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

describe('relay hoverClick → reveal-then-click', () => {
  let group: HTMLElement;
  let button: HTMLButtonElement;

  beforeEach(() => {
    // A `.group` container (Tailwind hover-group marker) holding a toolbar
    // button that starts `pointer-events:none` (hover-gated, ZoneHoverActions).
    group = document.createElement('div');
    group.className = 'group';

    button = document.createElement('button');
    button.textContent = 'Maximize';
    button.style.pointerEvents = 'none';
    // jsdom reports offsetParent === null for every element (no layout); the
    // relay's visibility gate checks `offsetParent !== null`, so stub it to a
    // truthy node so the gate doesn't reject the hover-gated button.
    Object.defineProperty(button, 'offsetParent', {
      configurable: true,
      get: () => document.body,
    });

    group.appendChild(button);
    document.body.appendChild(group);
  });

  afterEach(() => {
    group.remove();
    getGlobalRegistry().clear();
  });

  it('reveals a hover-gated button via its .group ancestor, then clicks it', async () => {
    getGlobalRegistry().registerElement('el-maximize', button, {
      type: 'button',
      label: 'Maximize',
    });

    // Model the CSS `group-hover:pointer-events-auto` reveal: hovering the
    // `.group` ancestor flips the button interactive. jsdom won't recalc this
    // from a stylesheet, so we drive it from the synthesized hover event.
    group.addEventListener('mouseenter', () => {
      button.style.pointerEvents = 'auto';
    });

    const order: string[] = [];
    let pointerEventsAtClick: string | null = null;
    group.addEventListener('mouseenter', () => order.push('ancestor-mouseenter'));
    button.addEventListener('pointerover', () => order.push('button-pointerover'));
    button.addEventListener('click', () => {
      order.push('button-click');
      pointerEventsAtClick = button.style.pointerEvents;
    });

    const result = (await executeCommand(
      'executeElementAction',
      { id: 'el-maximize', request: { action: 'hoverClick' } },
      emptyBridge,
    )) as { success?: boolean; action?: string; error?: string };

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(result.action).toBe('hoverClick');

    // The button was actually clicked.
    expect(order).toContain('button-click');
    // Hover was synthesized on the ancestor (so a group-hover rule fires)…
    expect(order).toContain('ancestor-mouseenter');
    // …and on the button itself.
    expect(order).toContain('button-pointerover');
    // Reveal happened BEFORE the click: the ancestor hover precedes the click.
    expect(order.indexOf('ancestor-mouseenter')).toBeLessThan(order.indexOf('button-click'));
    // By click time the hover reveal had flipped the button interactive.
    expect(pointerEventsAtClick).toBe('auto');
  });

  it('clicks a hover-gated button even when no CSS recalc flips pointer-events', async () => {
    // No `mouseenter` reveal listener here, so the button stays
    // `pointer-events:none` the whole time (the jsdom worst case). The native
    // `.click()` inside `dispatchRealClick` still fires — mirroring
    // `performHoverClick` in the HTTP path — so the action does not no-op.
    getGlobalRegistry().registerElement('el-stuck', button, { type: 'button' });

    let clicked = false;
    button.addEventListener('click', () => {
      clicked = true;
    });

    const result = (await executeCommand(
      'executeElementAction',
      { id: 'el-stuck', request: { action: 'hoverClick' } },
      emptyBridge,
    )) as { success?: boolean };

    expect(result.success).toBe(true);
    expect(clicked).toBe(true);
    expect(button.style.pointerEvents).toBe('none');
  });

  it('plain "click" on the same hover-gated element still behaves as before', async () => {
    getGlobalRegistry().registerElement('el-plain', button, { type: 'button' });

    const seen: string[] = [];
    for (const t of ['pointerdown', 'pointerup', 'click']) {
      button.addEventListener(t, () => seen.push(t));
    }

    const result = (await executeCommand(
      'executeElementAction',
      { id: 'el-plain', request: { action: 'click' } },
      emptyBridge,
    )) as { success?: boolean; action?: string };

    expect(result.success).toBe(true);
    expect(result.action).toBe('click');
    // Same pointer sequence as a normal click — no hover synthesis.
    expect(seen).toContain('pointerdown');
    expect(seen).toContain('pointerup');
    expect(seen).toContain('click');
    expect(seen.indexOf('pointerdown')).toBeLessThan(seen.indexOf('pointerup'));
  });
});
