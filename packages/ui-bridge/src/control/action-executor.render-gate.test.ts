/**
 * The HTTP executor's pre-dispatch gate and the `focus` read-back — plan
 * `2026-11-25-ui-bridge-http-executor-refuses-non-click-actions-on-unrendered-elements`.
 *
 * - D1: `performAction` refuses EVERY element action on a node that is not
 *   rendered (`UB-ELEM-NOT-VISIBLE`), and every non-click action on a natively
 *   `disabled` one (`UB-ELEM-DISABLED`, `disabledReason: 'native'`), before
 *   custom-action precedence — the relay's gate. The two exemptions are
 *   `unhover` and a `scroll` on a page sentinel.
 * - D2: a `focus` whose `element.focus()` left focus elsewhere fails with
 *   `context.reason: 'focus_not_taken'` on both arms, and the HTTP arm fires
 *   no synthetic `FocusEvent` for it.
 *
 * Every test enters where a caller does: `executeAction` (the handler behind
 * `POST /control/element/{id}/action`) or the relay's `executeElementAction`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getGlobalRegistry, resetGlobalRegistry } from '../core/registry';
import { DefaultActionExecutor } from './action-executor';
import { executeCommand, type BridgeAccess } from '../react/commandHandlers';
import { focusLanded } from '../core/composed-tree';

const emptyBridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
};

interface ActionResponse {
  success: boolean;
  error?: string;
  failureDetails?: {
    errorCode?: string;
    visibilityReason?: string;
    disabledReason?: string;
    context?: Record<string, unknown>;
  };
}

async function http(
  id: string,
  action: string,
  params?: Record<string, unknown>
): Promise<ActionResponse> {
  return (await new DefaultActionExecutor(getGlobalRegistry()).executeAction(id, {
    action,
    params,
  })) as ActionResponse;
}

async function relay(
  id: string,
  action: string,
  params?: Record<string, unknown>
): Promise<ActionResponse> {
  return (await executeCommand(
    'executeElementAction',
    { id, request: { action, params }, skipSettle: true },
    emptyBridge
  )) as ActionResponse;
}

/** An `<input>` inside a `display: none` subtree, appended and registered. */
function inputInHiddenSubtree(id: string, value = 'old'): HTMLInputElement {
  const wrapper = document.createElement('div');
  wrapper.style.display = 'none';
  const input = document.createElement('input');
  input.value = value;
  wrapper.appendChild(input);
  document.body.appendChild(wrapper);
  getGlobalRegistry().registerElement(id, input, { type: 'input', label: id });
  return input;
}

beforeEach(() => {
  resetGlobalRegistry();
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('the HTTP executor refuses a non-click action on an unrendered element', () => {
  it('type into an input inside a display:none subtree is refused and types nothing', async () => {
    const input = inputInHiddenSubtree('hidden-type');
    const res = await http('hidden-type', 'type', { text: 'new' });
    expect(res.success).toBe(false);
    expect(res.failureDetails?.errorCode).toBe('UB-ELEM-NOT-VISIBLE');
    expect(res.failureDetails?.visibilityReason).toBe('hidden');
    expect(res.error).toBe('element is not visible (hidden); type was not dispatched');
    expect(input.value).toBe('old');
  });

  it('setValue on an input inside a display:none subtree is refused and writes nothing', async () => {
    const input = inputInHiddenSubtree('hidden-set');
    const res = await http('hidden-set', 'setValue', { value: 'new' });
    expect(res.success).toBe(false);
    expect(res.failureDetails?.errorCode).toBe('UB-ELEM-NOT-VISIBLE');
    expect(res.error).toContain('setValue was not dispatched');
    expect(input.value).toBe('old');
  });

  it('a custom action on an element inside a display:none subtree is refused before its handler runs', async () => {
    const wrapper = document.createElement('div');
    wrapper.style.display = 'none';
    const pane = document.createElement('div');
    wrapper.appendChild(pane);
    document.body.appendChild(wrapper);
    const handler = vi.fn(() => 'ran');
    getGlobalRegistry().registerElement('hidden-pane', pane, {
      type: 'custom',
      label: 'pane',
      customActions: { sendKeys: { id: 'sendKeys', handler } },
    });
    const res = await http('hidden-pane', 'sendKeys', { keys: 'x' });
    expect(res.success).toBe(false);
    expect(res.failureDetails?.errorCode).toBe('UB-ELEM-NOT-VISIBLE');
    expect(handler).not.toHaveBeenCalled();
  });

  it('type into a natively disabled input is refused as disabled (native) and types nothing', async () => {
    const input = document.createElement('input');
    input.value = 'old';
    input.disabled = true;
    document.body.appendChild(input);
    getGlobalRegistry().registerElement('disabled-type', input, { type: 'input', label: 'd' });
    const res = await http('disabled-type', 'type', { text: 'new' });
    expect(res.success).toBe(false);
    expect(res.failureDetails?.errorCode).toBe('UB-ELEM-DISABLED');
    expect(res.failureDetails?.disabledReason).toBe('native');
    expect(res.error).toContain('type was not dispatched');
    expect(input.value).toBe('old');
  });

  it('aria-disabled does not block a non-click action (native disabled only, as on the relay)', async () => {
    const input = document.createElement('input');
    input.setAttribute('aria-disabled', 'true');
    document.body.appendChild(input);
    getGlobalRegistry().registerElement('aria-type', input, { type: 'input', label: 'a' });
    const res = await http('aria-type', 'type', { text: 'x' });
    expect(res.success).toBe(true);
    expect(input.value).toBe('x');
  });

  it('a scroll on a page sentinel is exempt, even when <html> itself would fail the render check', async () => {
    const html = document.documentElement;
    // Not relying on `<html>` happening to pass the render check: the
    // exemption is the page-sentinel flag, so make the check fail.
    Object.defineProperty(html, 'checkVisibility', { configurable: true, value: () => false });
    vi.spyOn(html, 'scrollHeight', 'get').mockReturnValue(5000);
    vi.spyOn(html, 'clientHeight', 'get').mockReturnValue(800);
    let top = 0;
    vi.spyOn(html, 'scrollTop', 'get').mockImplementation(() => top);
    const scrollBy = vi.fn((o?: ScrollToOptions | number) => {
      top += typeof o === 'object' ? (o.top ?? 0) : 0;
    });
    Object.defineProperty(html, 'scrollBy', { configurable: true, value: scrollBy });
    try {
      const res = await http('document', 'scroll', { direction: 'down', amount: 100 });
      expect(res.failureDetails?.errorCode).not.toBe('UB-ELEM-NOT-VISIBLE');
      expect(res.success).toBe(true);
      expect(scrollBy).toHaveBeenCalled();
    } finally {
      delete (html as Partial<HTMLElement>).checkVisibility;
      delete (html as Partial<HTMLElement>).scrollBy;
    }
  });
});

describe('focus reads back whether it landed, on both arms', () => {
  /** A focusable input whose `focus()` is stubbed to do nothing. */
  function inertFocusInput(id: string): HTMLInputElement {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus = () => {};
    getGlobalRegistry().registerElement(id, input, { type: 'input', label: id });
    return input;
  }

  it('HTTP: a focus() that does not move focus fails with focus_not_taken and fires no synthetic focus event', async () => {
    const input = inertFocusInput('inert-http');
    const focusEvents: Event[] = [];
    input.addEventListener('focus', (e) => focusEvents.push(e));
    const res = await http('inert-http', 'focus');
    expect(res.success).toBe(false);
    expect(res.failureDetails?.errorCode).toBe('UB-ACTION-FAILED');
    expect(res.failureDetails?.context).toMatchObject({ action: 'focus', reason: 'focus_not_taken' });
    expect(focusEvents).toHaveLength(0);
    expect(document.activeElement).not.toBe(input);
  });

  it('relay: a focus() that does not move focus fails with focus_not_taken', async () => {
    const input = inertFocusInput('inert-relay');
    const res = await relay('inert-relay', 'focus');
    expect(res.success).toBe(false);
    expect(res.failureDetails?.errorCode).toBe('UB-ACTION-FAILED');
    expect(res.failureDetails?.context).toMatchObject({ action: 'focus', reason: 'focus_not_taken' });
    expect(document.activeElement).not.toBe(input);
  });

  it.each(['http', 'relay'] as const)(
    '%s: a focus a wrapper forwards to its inner input counts as taken',
    async (arm) => {
      const wrapper = document.createElement('div');
      const inner = document.createElement('input');
      wrapper.appendChild(inner);
      document.body.appendChild(wrapper);
      wrapper.focus = () => inner.focus();
      getGlobalRegistry().registerElement('wrapper', wrapper, { type: 'custom', label: 'w' });
      const res = arm === 'http' ? await http('wrapper', 'focus') : await relay('wrapper', 'focus');
      expect(res.success).toBe(true);
      expect(document.activeElement).toBe(inner);
    }
  );

  it('HTTP: a focus that lands still fires the synthetic focus event', async () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    getGlobalRegistry().registerElement('lands', input, { type: 'input', label: 'l' });
    const focusEvents: Event[] = [];
    input.addEventListener('focus', (e) => focusEvents.push(e));
    const res = await http('lands', 'focus');
    expect(res.success).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(focusEvents.length).toBeGreaterThan(0);
  });
});

describe('focusLanded', () => {
  it('descends into an open shadow root and counts a focused inner node for its host', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    const inner = document.createElement('input');
    root.appendChild(inner);
    inner.focus();
    expect(focusLanded(host)).toBe(true);
    expect(focusLanded(inner)).toBe(true);
    const other = document.createElement('input');
    document.body.appendChild(other);
    expect(focusLanded(other)).toBe(false);
  });
});
