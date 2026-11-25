/**
 * The HTTP executor's pre-dispatch gate and the `focus` read-back — plan
 * `2026-11-25-ui-bridge-http-executor-refuses-non-click-actions-on-unrendered-elements`.
 *
 * - D1: `performAction` refuses EVERY element action on a node that is not
 *   rendered (`UB-ELEM-NOT-VISIBLE`), and every mutating non-click action on a natively
 *   `disabled` one (`UB-ELEM-DISABLED`, `disabledReason: 'native'`), before
 *   custom-action precedence — the relay's gate. Native `disabled` refuses
 *   mutating verbs and custom actions only: `hover`, `unhover`, `scroll`,
 *   `scrollIntoView` and `blur` pass on both arms. The two exemptions are
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
import { getElementState } from '../core/element-state';

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

  /** An input inside a `<fieldset disabled>`, plus one inside its first `<legend>`. */
  function disabledFieldset(): { inside: HTMLInputElement; inLegend: HTMLInputElement } {
    const fieldset = document.createElement('fieldset');
    fieldset.disabled = true;
    const legend = document.createElement('legend');
    const inLegend = document.createElement('input');
    legend.appendChild(inLegend);
    const inside = document.createElement('input');
    fieldset.append(legend, inside);
    document.body.appendChild(fieldset);
    getGlobalRegistry().registerElement('fs-inside', inside, { type: 'input', label: 'i' });
    getGlobalRegistry().registerElement('fs-legend', inLegend, { type: 'input', label: 'l' });
    return { inside, inLegend };
  }

  it.each(['http', 'relay'] as const)(
    '%s: type into an input inside a <fieldset disabled> is refused, though its own .disabled is false',
    async (arm) => {
      const { inside } = disabledFieldset();
      expect(inside.disabled).toBe(false);
      const res =
        arm === 'http'
          ? await http('fs-inside', 'type', { text: 'x' })
          : await relay('fs-inside', 'type', { text: 'x' });
      expect(res.success).toBe(false);
      expect(res.failureDetails?.errorCode).toBe(
        arm === 'http' ? 'UB-ELEM-DISABLED' : 'ELEMENT_NOT_ENABLED'
      );
      if (arm === 'http') expect(res.failureDetails?.disabledReason).toBe('native');
      expect(inside.value).toBe('');
    }
  );

  it.each(['http', 'relay'] as const)(
    "%s: an input in the disabled fieldset's first <legend> is not disabled (HTML spec)",
    async (arm) => {
      const { inLegend } = disabledFieldset();
      const res =
        arm === 'http'
          ? await http('fs-legend', 'type', { text: 'x' })
          : await relay('fs-legend', 'type', { text: 'x' });
      expect(res.success).toBe(true);
      expect(inLegend.value).toBe('x');
    }
  );

  it('HTTP: a click on a button inside a <fieldset disabled> is refused (the click refusal)', async () => {
    const fieldset = document.createElement('fieldset');
    fieldset.disabled = true;
    const button = document.createElement('button');
    button.type = 'button';
    fieldset.appendChild(button);
    document.body.appendChild(fieldset);
    const clicks = vi.fn();
    button.addEventListener('click', clicks);
    getGlobalRegistry().registerElement('fs-button', button, { type: 'button', label: 'b' });
    expect(button.disabled).toBe(false);
    const res = await http('fs-button', 'click');
    expect(res.success).toBe(false);
    expect(res.failureDetails?.errorCode).toBe('UB-ELEM-DISABLED');
    expect(res.failureDetails?.disabledReason).toBe('native');
    expect(res.error).toContain('natively disabled');
    expect(clicks).not.toHaveBeenCalled();
  });

  it('ElementState reads an input in a <fieldset disabled> as disabled, and one in its first <legend> as enabled', () => {
    const { inside, inLegend } = disabledFieldset();
    expect(getElementState(inside)).toMatchObject({ disabled: true, enabled: false });
    expect(getElementState(inLegend)).toMatchObject({ disabled: false, enabled: true });
  });

  it('ElementState reads an <option> under an <optgroup disabled> as disabled', () => {
    const select = document.createElement('select');
    const group = document.createElement('optgroup');
    group.disabled = true;
    const option = document.createElement('option');
    option.textContent = 'x';
    group.appendChild(option);
    const free = document.createElement('option');
    free.textContent = 'y';
    select.append(group, free);
    document.body.appendChild(select);
    expect(getElementState(option)).toMatchObject({ disabled: true, enabled: false });
    expect(getElementState(free)).toMatchObject({ disabled: false, enabled: true });
  });

  it.each(['http', 'relay'] as const)(
    '%s: a click on an <option> under an <optgroup disabled> is refused as disabled',
    async (arm) => {
      const select = document.createElement('select');
      const group = document.createElement('optgroup');
      group.disabled = true;
      const option = document.createElement('option');
      option.value = 'x';
      option.textContent = 'x';
      group.appendChild(option);
      select.appendChild(group);
      document.body.appendChild(select);
      const clicks = vi.fn();
      option.addEventListener('click', clicks);
      getGlobalRegistry().registerElement('og-option', option, { type: 'button', label: 'o' });
      const res = arm === 'http' ? await http('og-option', 'click') : await relay('og-option', 'click');
      expect(res.success).toBe(false);
      expect(res.failureDetails?.errorCode).toBe(
        arm === 'http' ? 'UB-ELEM-DISABLED' : 'ELEMENT_NOT_ENABLED'
      );
      if (arm === 'http') expect(res.failureDetails?.disabledReason).toBe('native');
      expect(clicks).not.toHaveBeenCalled();
    }
  );

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

describe('native disabled refuses mutating verbs only, on both arms', () => {
  /** A natively disabled `<button>`, appended and registered. */
  function disabledButton(
    id: string,
    customActions?: Record<string, { id: string; handler: () => unknown }>
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.textContent = 'Save';
    button.title = 'Fill in the name first';
    button.disabled = true;
    document.body.appendChild(button);
    getGlobalRegistry().registerElement(id, button, { type: 'button', label: id, customActions });
    return button;
  }

  it.each(['http', 'relay'] as const)(
    '%s: hover on a natively disabled button succeeds and delivers mouseover',
    async (arm) => {
      const button = disabledButton('disabled-hover');
      const overs: Event[] = [];
      button.addEventListener('mouseover', (e) => overs.push(e));
      const res =
        arm === 'http'
          ? await http('disabled-hover', 'hover', { holdMs: 0 })
          : await relay('disabled-hover', 'hover', { holdMs: 0 });
      expect(res.failureDetails?.errorCode).toBeUndefined();
      expect(res.success).toBe(true);
      expect(overs.length).toBeGreaterThan(0);
    }
  );

  it.each(['http', 'relay'] as const)(
    '%s: blur on a natively disabled button succeeds',
    async (arm) => {
      disabledButton('disabled-blur');
      const res =
        arm === 'http' ? await http('disabled-blur', 'blur') : await relay('disabled-blur', 'blur');
      expect(res.failureDetails?.errorCode).toBeUndefined();
      expect(res.success).toBe(true);
    }
  );

  it.each(['http', 'relay'] as const)(
    '%s: type on a natively disabled button is refused as disabled',
    async (arm) => {
      disabledButton('disabled-type-button');
      const res =
        arm === 'http'
          ? await http('disabled-type-button', 'type', { text: 'x' })
          : await relay('disabled-type-button', 'type', { text: 'x' });
      expect(res.success).toBe(false);
      expect(res.failureDetails?.errorCode).toBe(
        arm === 'http' ? 'UB-ELEM-DISABLED' : 'ELEMENT_NOT_ENABLED'
      );
      if (arm === 'http') expect(res.failureDetails?.disabledReason).toBe('native');
    }
  );

  it.each(['http', 'relay'] as const)(
    '%s: a custom action named like a tolerated verb is still refused on a disabled control',
    async (arm) => {
      const handler = vi.fn(() => 'ran');
      disabledButton('disabled-custom', { scroll: { id: 'scroll', handler } });
      const res =
        arm === 'http'
          ? await http('disabled-custom', 'scroll')
          : await relay('disabled-custom', 'scroll');
      expect(res.success).toBe(false);
      expect(res.failureDetails?.errorCode).toBe(
        arm === 'http' ? 'UB-ELEM-DISABLED' : 'ELEMENT_NOT_ENABLED'
      );
      expect(handler).not.toHaveBeenCalled();
    }
  );
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
    // jsdom's native focus() fires a trusted focus event of its own
    // (measured under jsdom 23.2.0: isTrusted true); the executor's synthetic
    // one is the untrusted event, exactly once.
    expect(focusEvents.filter((e) => !e.isTrusted)).toHaveLength(1);
  });

  /**
   * A wrapper inside an open shadow tree whose `<slot>` takes a light-DOM
   * input, and whose own `focus()` forwards to that input.
   */
  function slottedWrapper(id: string): { wrap: HTMLElement; light: HTMLInputElement } {
    const host = document.createElement('div');
    const light = document.createElement('input');
    host.appendChild(light);
    document.body.appendChild(host);
    const wrap = document.createElement('div');
    wrap.appendChild(document.createElement('slot'));
    host.attachShadow({ mode: 'open' }).appendChild(wrap);
    wrap.focus = () => light.focus();
    getGlobalRegistry().registerElement(id, wrap, { type: 'custom', label: id });
    return { wrap, light };
  }

  it.each(['http', 'relay'] as const)(
    '%s: focus forwarded to a light-DOM input a slot inside the target takes counts as taken',
    async (arm) => {
      const { light } = slottedWrapper('slotted');
      const res = arm === 'http' ? await http('slotted', 'focus') : await relay('slotted', 'focus');
      expect(res.failureDetails?.context?.reason).toBeUndefined();
      expect(res.success).toBe(true);
      expect(document.activeElement).toBe(light);
      expect(light.assignedSlot).not.toBeNull();
    }
  );

  it.each(['http', 'relay'] as const)(
    '%s: focus() on a non-focusable container whose child ALREADY holds focus is focus_not_taken',
    async (arm) => {
      const container = document.createElement('div');
      const child = document.createElement('input');
      container.appendChild(child);
      document.body.appendChild(container);
      child.focus();
      expect(document.activeElement).toBe(child);
      const synthetic: Event[] = [];
      container.addEventListener('focus', (e) => {
        if (!e.isTrusted) synthetic.push(e);
      });
      getGlobalRegistry().registerElement('container', container, { type: 'custom', label: 'c' });
      const res =
        arm === 'http' ? await http('container', 'focus') : await relay('container', 'focus');
      expect(res.success).toBe(false);
      expect(res.failureDetails?.context).toMatchObject({ action: 'focus', reason: 'focus_not_taken' });
      expect(synthetic).toHaveLength(0);
      expect(document.activeElement).toBe(child);
    }
  );

  /** An input inside a CLOSED shadow root, registered directly. */
  function inputInClosedShadow(id: string): { host: HTMLElement; inner: HTMLInputElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'closed' });
    const inner = document.createElement('input');
    root.appendChild(inner);
    getGlobalRegistry().registerElement(id, inner, { type: 'input', label: id });
    return { host, inner };
  }

  it.each(['http', 'relay'] as const)(
    '%s: a focus that lands inside a closed shadow root counts as taken',
    async (arm) => {
      const { host } = inputInClosedShadow('closed-inner');
      const res =
        arm === 'http' ? await http('closed-inner', 'focus') : await relay('closed-inner', 'focus');
      expect(res.failureDetails?.context?.reason).toBeUndefined();
      expect(res.success).toBe(true);
      // The document sees only the closed host as focused.
      expect(document.activeElement).toBe(host);
    }
  );
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

  it('reads a node inside a CLOSED shadow root from its own root', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'closed' });
    const inner = document.createElement('input');
    const sibling = document.createElement('input');
    root.append(inner, sibling);
    inner.focus();
    expect(focusLanded(inner)).toBe(true);
    expect(focusLanded(host)).toBe(true);
    expect(focusLanded(sibling)).toBe(false);
  });

  it('reads a node in another realm (an iframe) across its open shadow root', () => {
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument as Document;
    const wrapper = doc.createElement('div');
    doc.body.appendChild(wrapper);
    const inner = doc.createElement('input');
    wrapper.attachShadow({ mode: 'open' }).appendChild(inner);
    // The wrapper forwards focus into its own open shadow root.
    wrapper.focus = () => inner.focus();
    wrapper.focus();
    expect(focusLanded(wrapper)).toBe(true);
    expect(focusLanded(inner)).toBe(true);
  });

  it('a disconnected node never reads as focused', () => {
    expect(focusLanded(document.createElement('input'))).toBe(false);
  });
});
