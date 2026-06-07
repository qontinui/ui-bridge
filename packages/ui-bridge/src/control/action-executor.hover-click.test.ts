/**
 * Action Executor Tests — `hoverClick` hover-reveal composite action
 *
 * Covers Issue 2 (P2): a control gated behind a CSS `:hover` / Tailwind
 * `group-hover` rule (the runner's `ZoneHoverActions` toolbar pattern) is
 * `pointer-events: none` in its rest state, so a plain `click` is refused with
 * a disabled-state error. `hoverClick` synthesizes the hover that flips the
 * control interactive (mutating its `pointer-events` to `auto`), waits one
 * animation frame, then clicks — all in a single dispatch.
 *
 * jsdom does not run CSS `:hover`/`group-hover` rules, so these tests model the
 * rule with a `mouseenter`/`pointerenter` listener on the hoverable ancestor
 * that imperatively flips the target's `pointer-events`. That exercises the
 * full SDK path: ancestor-hover synthesis → rAF wait → pointer-events re-read
 * → click dispatch.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UIBridgeRegistry } from '../core/registry';
import { DefaultActionExecutor } from './action-executor';

describe('DefaultActionExecutor — hoverClick (hover-revealed control)', () => {
  let registry: UIBridgeRegistry;
  let executor: DefaultActionExecutor;
  let container: HTMLDivElement;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    executor = new DefaultActionExecutor(registry);
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  /**
   * Build a `.group` toolbar whose button is `pointer-events: none` until the
   * group is hovered, mirroring `group-hover:pointer-events-auto`.
   */
  function makeHoverGatedButton(): { group: HTMLDivElement; button: HTMLButtonElement } {
    const group = document.createElement('div');
    group.className = 'group';
    const button = document.createElement('button');
    button.setAttribute('data-testid', 'hover-btn');
    button.textContent = 'Maximize';
    button.style.pointerEvents = 'none'; // rest state: not clickable
    group.appendChild(button);
    container.appendChild(group);

    // Model `group-hover:pointer-events-auto`: hovering the group flips the
    // button interactive. jsdom won't apply this via CSS, so wire it as a
    // handler on the ancestor the SDK is expected to hover.
    const reveal = (): void => {
      button.style.pointerEvents = 'auto';
    };
    group.addEventListener('mouseenter', reveal);
    group.addEventListener('pointerenter', reveal);

    return { group, button };
  }

  it('plain click is REFUSED on the un-hovered (pointer-events:none) control', async () => {
    const { button } = makeHoverGatedButton();
    registry.registerElement('hover-btn', button, { type: 'button', label: 'Maximize' });

    let clicked = false;
    button.addEventListener('click', () => {
      clicked = true;
    });

    const result = await executor.executeAction('hover-btn', { action: 'click' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/pointer-events/i);
    expect(clicked).toBe(false);
  });

  it('hoverClick reveals the control and clicks it in a single dispatch', async () => {
    const { button } = makeHoverGatedButton();
    registry.registerElement('hover-btn', button, { type: 'button', label: 'Maximize' });

    let clicked = false;
    button.addEventListener('click', () => {
      clicked = true;
    });

    const result = await executor.executeAction('hover-btn', { action: 'hoverClick' });

    expect(result.success, `hoverClick failed: ${result.error}`).toBe(true);
    expect(clicked).toBe(true);
    // The hover flipped the control interactive before the click landed.
    expect(button.style.pointerEvents).toBe('auto');
  });

  it('hoverClick still fires native click() so React-style onClick handlers run', async () => {
    const { button } = makeHoverGatedButton();
    registry.registerElement('hover-btn', button, { type: 'button', label: 'Maximize' });

    let nativeClicks = 0;
    button.addEventListener('click', () => {
      nativeClicks += 1;
    });

    const result = await executor.executeAction('hover-btn', { action: 'hoverClick' });
    expect(result.success, `hoverClick failed: ${result.error}`).toBe(true);
    expect(nativeClicks).toBe(1);
  });

  it('hoverClick is STILL refused on a genuinely disabled (aria-disabled) control', async () => {
    const { button } = makeHoverGatedButton();
    button.setAttribute('aria-disabled', 'true');
    registry.registerElement('hover-btn', button, { type: 'button', label: 'Maximize' });

    let clicked = false;
    button.addEventListener('click', () => {
      clicked = true;
    });

    const result = await executor.executeAction('hover-btn', { action: 'hoverClick' });

    // pointer-events:none alone is waived, but aria-disabled is a real block.
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/aria-disabled/i);
    expect(clicked).toBe(false);
  });

  it('hoverClick is STILL refused on a natively disabled <button>', async () => {
    const { button } = makeHoverGatedButton();
    button.disabled = true;
    registry.registerElement('hover-btn', button, { type: 'button', label: 'Maximize' });

    const result = await executor.executeAction('hover-btn', { action: 'hoverClick' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/disabled/i);
  });

  it('hoverClick works when the hoverable ancestor is the direct parent without a group class', async () => {
    // Non-Tailwind variant: the parent is itself pointer-events:none and
    // re-enables the child on hover. The SDK's findHoverableAncestor falls
    // back to the nearest pointer-events:none ancestor.
    const parent = document.createElement('div');
    parent.style.pointerEvents = 'none';
    const button = document.createElement('button');
    button.setAttribute('data-testid', 'nested-btn');
    button.style.pointerEvents = 'none';
    parent.appendChild(button);
    container.appendChild(parent);

    const reveal = (): void => {
      button.style.pointerEvents = 'auto';
    };
    parent.addEventListener('mouseenter', reveal);
    parent.addEventListener('pointerenter', reveal);

    registry.registerElement('nested-btn', button, { type: 'button', label: 'X' });

    let clicked = false;
    button.addEventListener('click', () => {
      clicked = true;
    });

    const result = await executor.executeAction('nested-btn', { action: 'hoverClick' });
    expect(result.success, `hoverClick failed: ${result.error}`).toBe(true);
    expect(clicked).toBe(true);
  });

  it('advertises hoverClick alongside click on discovered buttons', async () => {
    const { button } = makeHoverGatedButton();
    button.style.pointerEvents = 'auto'; // make it discoverable/visible
    registry.registerElement('hover-btn', button, { type: 'button', label: 'Maximize' });

    const el = registry.getElement('hover-btn');
    expect(el?.actions).toContain('click');
    expect(el?.actions).toContain('hoverClick');
  });
});
