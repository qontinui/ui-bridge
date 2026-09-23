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
  failureDetails?: {
    errorCode?: string;
    elementState?: Record<string, unknown>;
    suggestedActions?: Array<{ command?: string }>;
  };
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
        // Every refusal names its signal, native `disabled` included.
        expect(result.error).toMatch(/aria-disabled=true|disabled property|pointer-events:none/);
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

  it('a pointer-events:none refusal leads its recovery advice with hoverClick', async () => {
    const b = button('hover-gated');
    b.style.pointerEvents = 'none';
    container.appendChild(b);
    getGlobalRegistry().registerElement('el-hover-gated', b, { type: 'button' });

    const result = await relay('el-hover-gated', 'click');

    expect(result.success).toBe(false);
    expect(result.failureDetails?.suggestedActions?.[0]?.command).toBe('hoverClick');
  });

  it('an aria-disabled refusal does not suggest hoverClick', async () => {
    const b = button('aria-only');
    b.setAttribute('aria-disabled', 'true');
    container.appendChild(b);
    getGlobalRegistry().registerElement('el-aria-only', b, { type: 'button' });

    const result = await relay('el-aria-only', 'click');

    expect(result.success).toBe(false);
    expect(result.failureDetails?.suggestedActions?.map((a) => a.command)).not.toContain(
      'hoverClick'
    );
  });

  it('the guard runs before custom-action precedence, as on the executor path', async () => {
    let handlerRuns = 0;
    const customActions = {
      toggle: {
        handler: () => {
          handlerRuns += 1;
        },
      },
    };

    // Positive control: on an unblocked element the custom handler wins.
    const free = button('custom-free');
    container.appendChild(free);
    getGlobalRegistry().registerElement('el-custom-free', free, { type: 'button', customActions });
    expect((await relay('el-custom-free', 'toggle')).success).toBe(true);
    expect(handlerRuns).toBe(1);

    const blocked = button('custom-blocked');
    blocked.setAttribute('aria-disabled', 'true');
    container.appendChild(blocked);
    getGlobalRegistry().registerElement('el-custom-blocked', blocked, {
      type: 'button',
      customActions,
    });

    const result = await relay('el-custom-blocked', 'toggle');

    expect(result.success).toBe(false);
    expect(result.failureDetails?.errorCode).toBe('ELEMENT_NOT_ENABLED');
    expect(handlerRuns).toBe(1);
  });

  for (const [action, event] of [
    ['rightClick', 'contextmenu'],
    ['middleClick', 'auxclick'],
  ] as const) {
    it(`${action} dispatches ${event} over the relay, and is refused on a blocked control`, async () => {
      const ok = button(`${action}-ok`);
      container.appendChild(ok);
      getGlobalRegistry().registerElement(`el-${action}-ok`, ok, { type: 'button' });
      let fired = false;
      ok.addEventListener(event, () => {
        fired = true;
      });

      const okResult = await relay(`el-${action}-ok`, action);
      expect(okResult.error).toBeUndefined();
      expect(okResult.success).toBe(true);
      expect(fired).toBe(true);

      const blocked = button(`${action}-blocked`);
      blocked.setAttribute('aria-disabled', 'true');
      container.appendChild(blocked);
      getGlobalRegistry().registerElement(`el-${action}-blocked`, blocked, { type: 'button' });
      let blockedFired = false;
      blocked.addEventListener(event, () => {
        blockedFired = true;
      });

      const blockedResult = await relay(`el-${action}-blocked`, action);
      expect(blockedResult.success).toBe(false);
      expect(blockedResult.failureDetails?.errorCode).toBe('ELEMENT_NOT_ENABLED');
      expect(blockedFired).toBe(false);
    });
  }

  it("submit's no-form click fallback answers to the same refusal as click", async () => {
    // Positive control: an unblocked form-less control is clicked.
    const free = button('submit-free');
    container.appendChild(free);
    getGlobalRegistry().registerElement('el-submit-free', free, { type: 'button' });
    let freeClicked = false;
    free.addEventListener('click', () => {
      freeClicked = true;
    });
    expect((await relay('el-submit-free', 'submit')).success).toBe(true);
    expect(freeClicked).toBe(true);

    const blocked = button('submit-blocked');
    blocked.style.pointerEvents = 'none';
    container.appendChild(blocked);
    getGlobalRegistry().registerElement('el-submit-blocked', blocked, { type: 'button' });
    let blockedClicked = false;
    blocked.addEventListener('click', () => {
      blockedClicked = true;
    });

    const result = await relay('el-submit-blocked', 'submit');

    expect(result.success).toBe(false);
    expect(result.failureDetails?.errorCode).toBe('ELEMENT_NOT_ENABLED');
    expect(result.error).toContain('pointer-events:none');
    expect(result.error).toContain('submit was not dispatched');
    expect(result.failureDetails?.suggestedActions?.[0]?.command).toBe('hoverClick');
    expect(blockedClicked).toBe(false);
  });

  it('submit inside a form still submits; reset outside a form is refused, not a silent success', async () => {
    const form = document.createElement('form');
    const submitBtn = button('in-form');
    form.appendChild(submitBtn);
    container.appendChild(form);
    let submitted = false;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      submitted = true;
    });
    getGlobalRegistry().registerElement('el-in-form', submitBtn, { type: 'button' });
    expect((await relay('el-in-form', 'submit')).success).toBe(true);
    expect(submitted).toBe(true);

    const loose = button('reset-loose');
    container.appendChild(loose);
    getGlobalRegistry().registerElement('el-reset-loose', loose, { type: 'button' });
    const result = await relay('el-reset-loose', 'reset');
    expect(result.success).toBe(false);
    expect(result.failureDetails?.errorCode).toBe('UNSUPPORTED_ACTION');
  });
});
