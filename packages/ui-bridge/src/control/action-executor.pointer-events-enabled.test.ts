/**
 * Regression — the READER and the CLICK PATH must agree about `enabled`.
 *
 * THE DEFECT (manual-test-loop iteration 10, confirmed against a live runner):
 * `GET /control/element/{id}` reported `enabled: true` for a hover-revealed
 * close button whose computed `pointer-events` was `none`, and the very next
 * click was refused with `element is disabled (pointer-events:none)`. The
 * reader folded only `disabled || aria-disabled` into `state.enabled` while
 * the click-path pre-check ALSO consulted `pointer-events` — two predicates,
 * one of which the caller could not see.
 *
 * Both now call `core/a11y`'s `readInteractionBlockers` / `isInteractionBlocked`.
 * These tests pin the agreement in BOTH directions: the blocked cases must read
 * unclickable AND be refused, and the plain enabled case must read clickable AND
 * actually click (a predicate that answered "blocked" for everything would pass
 * every other case in this file).
 *
 * jsdom note: `getComputedStyle().pointerEvents` in jsdom DOES resolve CSS
 * inheritance — a child of a `pointer-events: none` parent computes to `none`,
 * from both an inline style and a stylesheet rule — which is what makes the
 * ancestor case below a real exercise of the predicate rather than a stub.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UIBridgeRegistry } from '../core/registry';
import { DefaultActionExecutor } from './action-executor';
import type { ElementState } from '../core/types';

describe('ElementState.enabled agrees with the click-path guard', () => {
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

  /** Register `el` under `id` and return the state the READER publishes. */
  function readState(id: string, el: HTMLElement): ElementState {
    registry.registerElement(id, el, { type: 'button', label: id });
    const registered = registry.getElement(id);
    expect(registered, `element ${id} was not registered`).toBeDefined();
    return registered!.getState();
  }

  it('case 1 — pointer-events:none on the element itself reads enabled:false and the click is refused', async () => {
    const button = document.createElement('button');
    button.setAttribute('data-testid', 'pe-none');
    button.textContent = 'Close';
    button.style.pointerEvents = 'none';
    container.appendChild(button);

    let clicked = false;
    button.addEventListener('click', () => {
      clicked = true;
    });

    // READER — this is what `GET /control/element/{id}` serves.
    const state = readState('pe-none', button);
    expect(state.enabled).toBe(false);
    expect(state.computedStyles?.pointerEvents).toBe('none');
    // The widening lives in the FOLD only: the two unfolded DOM signals are
    // untouched, so a driver can still tell WHY it is unclickable.
    expect(state.disabled).toBe(false);
    expect(state.ariaDisabled).toBe(false);

    // ACTOR — same verdict, and it really does refuse.
    const result = await executor.executeAction('pe-none', { action: 'click' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/pointer-events/i);
    expect(clicked).toBe(false);
  });

  it('case 2 — pointer-events:none inherited from an ANCESTOR reads enabled:false and the click is refused', async () => {
    const overlay = document.createElement('div');
    overlay.style.pointerEvents = 'none';
    container.appendChild(overlay);

    const button = document.createElement('button');
    button.setAttribute('data-testid', 'pe-ancestor');
    button.textContent = 'Close';
    // The button declares NOTHING itself — only the ancestor does. An inline
    // `style` check on the element would see nothing here; the computed value
    // is what actually governs clickability.
    expect(button.style.pointerEvents).toBe('');
    overlay.appendChild(button);

    let clicked = false;
    button.addEventListener('click', () => {
      clicked = true;
    });

    const state = readState('pe-ancestor', button);
    expect(state.enabled).toBe(false);
    expect(state.computedStyles?.pointerEvents).toBe('none');
    expect(state.disabled).toBe(false);
    expect(state.ariaDisabled).toBe(false);

    const result = await executor.executeAction('pe-ancestor', { action: 'click' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/pointer-events/i);
    expect(clicked).toBe(false);
  });

  it('case 3 — a normal element still reads enabled:true and still clicks (no regression)', async () => {
    const button = document.createElement('button');
    button.setAttribute('data-testid', 'plain');
    button.textContent = 'Save';
    container.appendChild(button);

    let clicked = false;
    button.addEventListener('click', () => {
      clicked = true;
    });

    const state = readState('plain', button);
    expect(state.enabled).toBe(true);
    // Sanity: the predicate saw a real, non-`none` computed value — this case
    // is what catches a predicate that simply answers "blocked" for everything.
    expect(state.computedStyles?.pointerEvents).not.toBe('none');
    expect(state.disabled).toBe(false);
    expect(state.ariaDisabled).toBe(false);

    const result = await executor.executeAction('plain', { action: 'click' });
    expect(result.success, `click failed: ${result.error}`).toBe(true);
    expect(clicked).toBe(true);
  });

  it('case 3b — an explicit pointer-events:auto element under a plain ancestor is still enabled and clickable', async () => {
    const wrapper = document.createElement('div');
    wrapper.style.pointerEvents = 'auto';
    container.appendChild(wrapper);

    const button = document.createElement('button');
    button.setAttribute('data-testid', 'pe-auto');
    button.style.pointerEvents = 'auto';
    wrapper.appendChild(button);

    let clicked = false;
    button.addEventListener('click', () => {
      clicked = true;
    });

    const state = readState('pe-auto', button);
    expect(state.enabled).toBe(true);
    expect(state.computedStyles?.pointerEvents).toBe('auto');

    const result = await executor.executeAction('pe-auto', { action: 'click' });
    expect(result.success, `click failed: ${result.error}`).toBe(true);
    expect(clicked).toBe(true);
  });

  it('case 4a — a natively disabled element still reads enabled:false with disabled:true (pre-existing behaviour)', async () => {
    const button = document.createElement('button');
    button.setAttribute('data-testid', 'native-disabled');
    button.disabled = true;
    container.appendChild(button);

    const state = readState('native-disabled', button);
    expect(state.enabled).toBe(false);
    expect(state.disabled).toBe(true);
    expect(state.ariaDisabled).toBe(false);
    // Widening the predicate must not misattribute the reason: this element is
    // NOT pointer-events blocked.
    expect(state.computedStyles?.pointerEvents).not.toBe('none');

    const result = await executor.executeAction('native-disabled', { action: 'click' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/disabled/i);
    expect(result.error).not.toMatch(/pointer-events/i);
  });

  it('case 4b — an aria-disabled element still reads enabled:false with ariaDisabled:true (pre-existing behaviour)', async () => {
    const button = document.createElement('button');
    button.setAttribute('data-testid', 'aria-disabled');
    button.setAttribute('aria-disabled', 'true');
    container.appendChild(button);

    let clicked = false;
    button.addEventListener('click', () => {
      clicked = true;
    });

    const state = readState('aria-disabled', button);
    expect(state.enabled).toBe(false);
    expect(state.disabled).toBe(false);
    expect(state.ariaDisabled).toBe(true);
    expect(state.computedStyles?.pointerEvents).not.toBe('none');

    const result = await executor.executeAction('aria-disabled', { action: 'click' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/aria-disabled/i);
    expect(result.error).not.toMatch(/pointer-events/i);
    expect(clicked).toBe(false);
  });

  it('the reader and the guard reach the same verdict across the whole matrix', async () => {
    const cases: Array<{ id: string; build: () => HTMLElement; clickable: boolean }> = [
      {
        id: 'm-plain',
        clickable: true,
        build: () => {
          const b = document.createElement('button');
          container.appendChild(b);
          return b;
        },
      },
      {
        id: 'm-pe-none',
        clickable: false,
        build: () => {
          const b = document.createElement('button');
          b.style.pointerEvents = 'none';
          container.appendChild(b);
          return b;
        },
      },
      {
        id: 'm-pe-ancestor',
        clickable: false,
        build: () => {
          const wrap = document.createElement('div');
          wrap.style.pointerEvents = 'none';
          container.appendChild(wrap);
          const b = document.createElement('button');
          wrap.appendChild(b);
          return b;
        },
      },
      {
        id: 'm-aria',
        clickable: false,
        build: () => {
          const b = document.createElement('button');
          b.setAttribute('aria-disabled', 'true');
          container.appendChild(b);
          return b;
        },
      },
      {
        id: 'm-native',
        clickable: false,
        build: () => {
          const b = document.createElement('button');
          b.disabled = true;
          container.appendChild(b);
          return b;
        },
      },
    ];

    for (const c of cases) {
      const el = c.build();
      el.setAttribute('data-testid', c.id);
      const state = readState(c.id, el);
      const result = await executor.executeAction(c.id, { action: 'click' });
      expect(state.enabled, `reader disagreed for ${c.id}`).toBe(c.clickable);
      expect(result.success, `actor disagreed for ${c.id}: ${result.error}`).toBe(c.clickable);
    }
  });
});
