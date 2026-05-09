/**
 * Action Executor Tests — Pointer-event fallback + disabled-state pre-check
 *
 * Covers Plan 4 (state-view-and-ui-bridge-improvements) Phase 4.4 fixes:
 *
 * 1. `performClick` dispatches `pointerdown` + `pointerup` alongside the
 *    existing mouse events so Radix-style pointer-only handlers
 *    (`<Tabs.Trigger>`, `<Switch>`, etc.) fire under the SDK's click action.
 * 2. Click on an `aria-disabled="true"` button or one with
 *    `pointer-events: none` fails explicitly with a structured error rather
 *    than silently no-opping. The native `element.click()` is NOT invoked
 *    in that case.
 *
 * Sibling: registry-refresh test verifies post-action state propagation;
 * this file targets the dispatch chain itself.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UIBridgeRegistry } from '../core/registry';
import { DefaultActionExecutor } from './action-executor';

describe('DefaultActionExecutor — click pointer-event fallback', () => {
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

  function makeButton(id: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.setAttribute('data-testid', id);
    b.textContent = id;
    container.appendChild(b);
    return b;
  }

  it('dispatches pointerdown + pointerup alongside mouse events on click', async () => {
    const button = makeButton('btn');
    registry.registerElement('btn', button, { type: 'button', label: 'Btn' });

    const events: string[] = [];
    button.addEventListener('pointerdown', () => events.push('pointerdown'));
    button.addEventListener('pointerup', () => events.push('pointerup'));
    button.addEventListener('mousedown', () => events.push('mousedown'));
    button.addEventListener('mouseup', () => events.push('mouseup'));
    button.addEventListener('click', () => events.push('click'));

    const result = await executor.executeAction('btn', { action: 'click' });

    expect(result.success, `click failed: ${result.error}`).toBe(true);
    // All five events must have fired (pointer events must precede the
    // corresponding mouse events so pointer-only handlers see them first).
    expect(events).toContain('pointerdown');
    expect(events).toContain('pointerup');
    expect(events).toContain('mousedown');
    expect(events).toContain('mouseup');
    expect(events).toContain('click');
    expect(events.indexOf('pointerdown')).toBeLessThan(events.indexOf('mousedown'));
    expect(events.indexOf('pointerup')).toBeLessThan(events.indexOf('mouseup'));
  });

  it('fires native click() so React-style onClick handlers run', async () => {
    const button = makeButton('btn');
    registry.registerElement('btn', button, { type: 'button', label: 'Btn' });

    let nativeClickCount = 0;
    button.addEventListener('click', () => {
      nativeClickCount += 1;
    });

    const result = await executor.executeAction('btn', { action: 'click' });
    expect(result.success, `click failed: ${result.error}`).toBe(true);
    expect(nativeClickCount).toBe(1);
  });
});

describe('DefaultActionExecutor — disabled-state pre-check', () => {
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

  it('fails click on aria-disabled="true" button without dispatching native click', async () => {
    const button = document.createElement('button');
    button.setAttribute('data-testid', 'disabled-btn');
    button.setAttribute('aria-disabled', 'true');
    container.appendChild(button);
    registry.registerElement('disabled-btn', button, { type: 'button', label: 'X' });

    let clicked = false;
    button.addEventListener('click', () => {
      clicked = true;
    });

    const result = await executor.executeAction('disabled-btn', { action: 'click' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/disabled/i);
    expect(result.error).toMatch(/aria-disabled/i);
    expect(clicked).toBe(false);
    // Live element snapshot is surfaced on failure so callers can confirm
    // why the click was refused.
    expect(result.elementState?.enabled).toBe(false);
  });

  it('fails click on a button with pointer-events:none without dispatching native click', async () => {
    const button = document.createElement('button');
    button.setAttribute('data-testid', 'no-pointer-btn');
    button.style.pointerEvents = 'none';
    container.appendChild(button);
    registry.registerElement('no-pointer-btn', button, { type: 'button', label: 'X' });

    let clicked = false;
    button.addEventListener('click', () => {
      clicked = true;
    });

    const result = await executor.executeAction('no-pointer-btn', { action: 'click' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/disabled/i);
    expect(result.error).toMatch(/pointer-events/i);
    expect(clicked).toBe(false);
    expect(result.elementState?.computedStyles?.pointerEvents).toBe('none');
  });

  it('fails click on a natively disabled <button> without dispatching native click', async () => {
    const button = document.createElement('button');
    button.setAttribute('data-testid', 'native-disabled');
    button.disabled = true;
    container.appendChild(button);
    registry.registerElement('native-disabled', button, { type: 'button', label: 'X' });

    let clicked = false;
    button.addEventListener('click', () => {
      clicked = true;
    });

    const result = await executor.executeAction('native-disabled', { action: 'click' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/disabled/i);
    // jsdom won't dispatch click on a natively-disabled button anyway, but
    // we want the SDK to refuse it explicitly rather than rely on that.
    expect(clicked).toBe(false);
  });

  it('still allows click on an enabled, fully-actionable button', async () => {
    const button = document.createElement('button');
    button.setAttribute('data-testid', 'live');
    container.appendChild(button);
    registry.registerElement('live', button, { type: 'button', label: 'X' });

    let clicked = false;
    button.addEventListener('click', () => {
      clicked = true;
    });

    const result = await executor.executeAction('live', { action: 'click' });

    expect(result.success, `click failed: ${result.error}`).toBe(true);
    expect(clicked).toBe(true);
  });
});
