/**
 * Relay click-like actions agree with the HTTP executor and `ElementState.enabled`.
 *
 * THE DEFECT (post-merge follow-up to ui-bridge#222, plan
 * 2026-08-23-single-source-derived-facts): #222 routed every READER of the
 * "is this clickable?" fact through `core/a11y`, but the React IPC relay's
 * ACTOR pre-check still refused native `disabled` only. A relay `click` on an
 * `aria-disabled="true"` or `pointer-events: none` control therefore dispatched
 * and reported `success: true`, while the element published `enabled: false`,
 * the relay's own wait-for `clickable` never resolved on it, and the HTTP
 * executor refused the same click. Both actors now call the one
 * `getClickRefusal` verdict (`control/action-executor.ts`), whose fold is
 * `core/a11y`'s `isInteractionBlocked`.
 *
 * The matrix pins relay-click-refused === `!state.enabled` for every fixture,
 * in BOTH directions — the clickable fixtures must actually click, so a guard
 * that refused everything would fail here.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { executeCommand, type BridgeAccess } from './commandHandlers';
import { getGlobalRegistry } from '../core/registry';
import { isInteractionBlocked, readInteractionBlockers } from '../core/a11y';

const emptyBridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
};

type ActionResult = {
  success?: boolean;
  error?: string;
  failureDetails?: { errorCode?: string; elementState?: Record<string, unknown> };
};

describe('relay click-like pre-check agrees with ElementState.enabled', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    getGlobalRegistry().clear();
  });

  /** jsdom has no layout: stub offsetParent so the relay's visibility gate passes. */
  function visible<T extends HTMLElement>(el: T): T {
    Object.defineProperty(el, 'offsetParent', {
      configurable: true,
      get: () => document.body,
    });
    return el;
  }

  function button(label: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    return visible(b);
  }

  async function relay(id: string, action: string): Promise<ActionResult> {
    return (await executeCommand(
      'executeElementAction',
      { id, request: { action } },
      emptyBridge
    )) as ActionResult;
  }

  const cases: Array<{ id: string; build: () => HTMLElement; clickable: boolean }> = [
    { id: 'plain', build: () => button('plain'), clickable: true },
    {
      id: 'explicit-auto',
      build: () => {
        const b = button('auto');
        b.style.pointerEvents = 'auto';
        return b;
      },
      clickable: true,
    },
    {
      id: 'native-disabled',
      build: () => {
        const b = button('disabled');
        b.disabled = true;
        return b;
      },
      clickable: false,
    },
    {
      id: 'aria-disabled',
      build: () => {
        const b = button('aria');
        b.setAttribute('aria-disabled', 'true');
        return b;
      },
      clickable: false,
    },
    {
      id: 'pointer-none-self',
      build: () => {
        const b = button('pe-self');
        b.style.pointerEvents = 'none';
        return b;
      },
      clickable: false,
    },
    {
      id: 'pointer-none-ancestor',
      build: () => {
        const wrap = document.createElement('div');
        wrap.style.pointerEvents = 'none';
        const b = button('pe-ancestor');
        wrap.appendChild(b);
        container.appendChild(wrap);
        return b;
      },
      clickable: false,
    },
  ];

  for (const c of cases) {
    it(`${c.id}: relay click refused iff state.enabled is false`, async () => {
      const el = c.build();
      if (!el.isConnected) container.appendChild(el);
      getGlobalRegistry().registerElement(`el-${c.id}`, el, { type: 'button', label: c.id });

      const state = getGlobalRegistry().getElement(`el-${c.id}`)!.getState();
      expect(state.enabled).toBe(c.clickable);
      expect(!isInteractionBlocked(readInteractionBlockers(el))).toBe(c.clickable);

      let clicked = false;
      el.addEventListener('click', () => {
        clicked = true;
      });
      const result = await relay(`el-${c.id}`, 'click');

      expect(result.success).toBe(c.clickable);
      if (c.clickable) {
        expect(clicked).toBe(true);
      } else {
        expect(result.failureDetails?.errorCode).toBe('ELEMENT_NOT_ENABLED');
        // A native-disabled element is dispatched no click by the browser
        // itself; the others would fire the handler if the relay let them.
        expect(clicked).toBe(false);
      }
    });
  }

  it('reports which signal refused the click, with the per-signal envelope', async () => {
    const b = button('both');
    b.setAttribute('aria-disabled', 'true');
    b.style.pointerEvents = 'none';
    container.appendChild(b);
    getGlobalRegistry().registerElement('el-both', b, { type: 'button' });

    const result = await relay('el-both', 'doubleClick');

    expect(result.success).toBe(false);
    expect(result.error).toContain('aria-disabled=true');
    expect(result.error).toContain('pointer-events:none');
    expect(result.failureDetails?.elementState).toMatchObject({
      disabled: true,
      ariaDisabled: true,
      nativeDisabled: false,
      pointerEvents: 'none',
    });
  });

  it('hoverClick waives pointer-events:none but still refuses aria-disabled', async () => {
    const b = button('hover-aria');
    b.style.pointerEvents = 'none';
    b.setAttribute('aria-disabled', 'true');
    container.appendChild(b);
    getGlobalRegistry().registerElement('el-hover-aria', b, { type: 'button' });

    const result = await relay('el-hover-aria', 'hoverClick');

    expect(result.success).toBe(false);
    expect(result.failureDetails?.errorCode).toBe('ELEMENT_NOT_ENABLED');
    expect(result.error).toContain('aria-disabled=true');
    expect(result.error).not.toContain('pointer-events:none');
  });

  it('a non-click-like action on an aria-disabled element is not refused', async () => {
    const b = button('focus-aria');
    b.setAttribute('aria-disabled', 'true');
    container.appendChild(b);
    getGlobalRegistry().registerElement('el-focus-aria', b, { type: 'button' });

    const result = await relay('el-focus-aria', 'focus');

    expect(result.success).toBe(true);
    expect(document.activeElement).toBe(b);
  });
});
