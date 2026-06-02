/**
 * Action Executor Tests — Drag-and-Drop
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UIBridgeRegistry } from '../core/registry';
import { DefaultActionExecutor } from './action-executor';

describe('DefaultActionExecutor - drag', () => {
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

  function createPositionedElement(id: string, x: number, y: number, size = 50): HTMLDivElement {
    const el = document.createElement('div');
    el.setAttribute('data-testid', id);
    el.style.position = 'absolute';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    container.appendChild(el);
    return el;
  }

  it('should dispatch mousedown, mousemove, mouseup sequence for drag to target position', async () => {
    const source = createPositionedElement('source', 10, 10);
    registry.registerElement('source', source, { type: 'button', label: 'Source' });

    const events: string[] = [];
    source.addEventListener('mousedown', () => events.push('mousedown'));

    // Listen on document for mousemove/mouseup since they may hit different elements
    document.addEventListener('mousemove', () => events.push('mousemove'));
    document.addEventListener('mouseup', () => events.push('mouseup'));

    const result = await executor.executeAction('source', {
      action: 'drag',
      params: {
        targetPosition: { x: 200, y: 200 },
        steps: 3,
        holdDelay: 0,
        releaseDelay: 0,
      },
    });

    expect(result.success).toBe(true);
    // Should have mousedown, then 3 mousemoves, then mouseup
    expect(events[0]).toBe('mousedown');
    expect(events.filter((e) => e === 'mousemove').length).toBe(3);
    expect(events[events.length - 1]).toBe('mouseup');
  });

  // DragEvent is not available in jsdom, so we test HTML5 mode only when the
  // constructor exists (real browser). In jsdom we verify the flag is accepted
  // without crashing when DragEvent is unavailable.
  it('should accept html5 option and dispatch mouse events regardless', async () => {
    const source = createPositionedElement('source', 10, 10);
    registry.registerElement('source', source, { type: 'button', label: 'Source' });

    const events: string[] = [];
    source.addEventListener('mousedown', () => events.push('mousedown'));
    document.addEventListener('mousemove', () => events.push('mousemove'));
    document.addEventListener('mouseup', () => events.push('mouseup'));

    // HTML5 drag events may or may not fire depending on environment
    if (typeof DragEvent !== 'undefined') {
      source.addEventListener('dragstart', () => events.push('dragstart'));
      document.addEventListener('drop', () => events.push('drop'));
    }

    const result = await executor.executeAction('source', {
      action: 'drag',
      params: {
        targetPosition: { x: 200, y: 200 },
        steps: 2,
        holdDelay: 0,
        releaseDelay: 0,
        html5: true,
      },
    });

    expect(result.success).toBe(true);
    // Mouse events always fire
    expect(events).toContain('mousedown');
    expect(events).toContain('mousemove');
    expect(events).toContain('mouseup');
  });

  it('should resolve target element by registry ID', async () => {
    const source = createPositionedElement('source', 10, 10);
    const target = createPositionedElement('target', 200, 200);
    registry.registerElement('source', source, { type: 'button', label: 'Source' });
    registry.registerElement('target', target, { type: 'button', label: 'Target' });

    const result = await executor.executeAction('source', {
      action: 'drag',
      params: {
        target: { elementId: 'target' },
        steps: 2,
        holdDelay: 0,
        releaseDelay: 0,
      },
    });

    expect(result.success).toBe(true);
  });

  it('should resolve target element by CSS selector', async () => {
    const source = createPositionedElement('source', 10, 10);
    const target = createPositionedElement('target', 200, 200);
    target.classList.add('drop-zone');
    registry.registerElement('source', source, { type: 'button', label: 'Source' });

    const result = await executor.executeAction('source', {
      action: 'drag',
      params: {
        target: { selector: '.drop-zone' },
        steps: 2,
        holdDelay: 0,
        releaseDelay: 0,
      },
    });

    expect(result.success).toBe(true);
  });

  it('should fail when no target is provided', async () => {
    const source = createPositionedElement('source', 10, 10);
    registry.registerElement('source', source, { type: 'button', label: 'Source' });

    const result = await executor.executeAction('source', {
      action: 'drag',
      params: {
        steps: 2,
        holdDelay: 0,
        releaseDelay: 0,
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('target');
  });

  it('should fail when target element is not found', async () => {
    const source = createPositionedElement('source', 10, 10);
    registry.registerElement('source', source, { type: 'button', label: 'Source' });

    const result = await executor.executeAction('source', {
      action: 'drag',
      params: {
        target: { elementId: 'nonexistent' },
        steps: 2,
        holdDelay: 0,
        releaseDelay: 0,
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('should use default steps and delays when not specified', async () => {
    const source = createPositionedElement('source', 10, 10);
    registry.registerElement('source', source, { type: 'button', label: 'Source' });

    let moveCount = 0;
    document.addEventListener('mousemove', () => moveCount++);

    const result = await executor.executeAction('source', {
      action: 'drag',
      params: {
        targetPosition: { x: 200, y: 200 },
        // No steps/holdDelay/releaseDelay — use defaults (10 steps, 100ms hold, 50ms release)
      },
    });

    expect(result.success).toBe(true);
    // Default is 10 steps
    expect(moveCount).toBe(10);
  });

  it('should pass correct coordinates in mouse events', async () => {
    const source = createPositionedElement('source', 0, 0, 100);
    registry.registerElement('source', source, { type: 'button', label: 'Source' });

    const mousedownCoords: { x: number; y: number }[] = [];
    source.addEventListener('mousedown', (e: MouseEvent) => {
      mousedownCoords.push({ x: e.clientX, y: e.clientY });
    });

    const mouseupCoords: { x: number; y: number }[] = [];
    document.addEventListener('mouseup', (e: MouseEvent) => {
      mouseupCoords.push({ x: e.clientX, y: e.clientY });
    });

    await executor.executeAction('source', {
      action: 'drag',
      params: {
        targetPosition: { x: 300, y: 400 },
        steps: 1,
        holdDelay: 0,
        releaseDelay: 0,
      },
    });

    // In jsdom, getBoundingClientRect returns all zeros, so source center is (0,0)
    // In a real browser this would be the actual element center
    expect(mousedownCoords[0].x).toBe(0);
    expect(mousedownCoords[0].y).toBe(0);
    // Target position should be exactly what we specified
    expect(mouseupCoords[0].x).toBe(300);
    expect(mouseupCoords[0].y).toBe(400);
  });

  it('should respect sourceOffset parameter', async () => {
    const source = createPositionedElement('source', 0, 0, 100);
    registry.registerElement('source', source, { type: 'button', label: 'Source' });

    const mousedownCoords: { x: number; y: number }[] = [];
    source.addEventListener('mousedown', (e: MouseEvent) => {
      mousedownCoords.push({ x: e.clientX, y: e.clientY });
    });

    await executor.executeAction('source', {
      action: 'drag',
      params: {
        targetPosition: { x: 200, y: 200 },
        sourceOffset: { x: 10, y: 20 },
        steps: 1,
        holdDelay: 0,
        releaseDelay: 0,
      },
    });

    // In jsdom, rect.left=0 + sourceOffset.x=10 = 10
    expect(mousedownCoords[0].x).toBe(10);
    expect(mousedownCoords[0].y).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// Item 2 — generic `toggle` action. Covers <details>, aria-expanded buttons,
// and the <dialog> branch where available.
// ---------------------------------------------------------------------------

describe('DefaultActionExecutor - toggle', () => {
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

  it('flips the <details> open property and dispatches a toggle event', async () => {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Advanced';
    details.appendChild(summary);
    container.appendChild(details);
    registry.registerElement('details-advanced', details, {
      type: 'generic',
      actions: ['toggle'],
      label: 'Advanced',
    });

    expect(details.open).toBe(false);
    let toggleCount = 0;
    details.addEventListener('toggle', () => {
      toggleCount++;
    });

    const open = await executor.executeAction('details-advanced', { action: 'toggle' });
    expect(open.success).toBe(true);
    expect(details.open).toBe(true);
    expect(toggleCount).toBe(1);
    expect(open.elementState?.ariaExpanded).toBe(true);

    // Second toggle flips back.
    const close = await executor.executeAction('details-advanced', { action: 'toggle' });
    expect(close.success).toBe(true);
    expect(details.open).toBe(false);
    expect(toggleCount).toBe(2);
    expect(close.elementState?.ariaExpanded).toBe(false);
  });

  it('flips aria-expanded on a disclosure button and fires the click handler', async () => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('aria-expanded', 'false');
    btn.textContent = 'Open menu';
    container.appendChild(btn);
    registry.registerElement('button-open-menu', btn, {
      type: 'button',
      actions: ['toggle', 'click'],
      label: 'Open menu',
    });

    let clicks = 0;
    btn.addEventListener('click', () => {
      clicks++;
    });

    await executor.executeAction('button-open-menu', { action: 'toggle' });
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(clicks).toBe(1);

    await executor.executeAction('button-open-menu', { action: 'toggle' });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(clicks).toBe(2);
  });
});

describe('DefaultActionExecutor - param validation', () => {
  // Required-param validation guards added so common caller mistakes
  // (forgetting `text` on a `type` action, or passing `value` because that's
  // what `select`/`setValue` use) surface as observable errors instead of
  // returning success: true with the field unchanged.

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

  it("type action without 'text' returns success: false with a descriptive error", async () => {
    const input = document.createElement('input');
    input.type = 'text';
    container.appendChild(input);
    registry.registerElement('email-input', input, { type: 'input', label: 'Email' });

    const result = await executor.executeAction('email-input', { action: 'type', params: {} });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/'text' string parameter/);
    expect(input.value).toBe(''); // unchanged
  });

  it("type action with 'value' alias hints at the correct param name", async () => {
    const input = document.createElement('input');
    input.type = 'text';
    container.appendChild(input);
    registry.registerElement('email-input', input, { type: 'input', label: 'Email' });

    const result = await executor.executeAction('email-input', {
      action: 'type',
      // Cast through unknown so the test can simulate a JS caller passing the
      // wrong key (TypeScript would catch this at compile time, but the bug
      // we're guarding against ships from runtime callers — Rust handlers
      // forwarding free-form JSON, NL parsers, end-users via curl, etc.).
      params: { value: 'foo@example.com' } as unknown as { text: string },
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/`value` — the `type` action expects `text`/);
  });

  it("type action with valid 'text' still works", async () => {
    const input = document.createElement('input');
    input.type = 'text';
    container.appendChild(input);
    registry.registerElement('email-input', input, { type: 'input', label: 'Email' });

    const result = await executor.executeAction('email-input', {
      action: 'type',
      params: { text: 'foo@example.com' },
    });

    expect(result.success).toBe(true);
    expect(input.value).toBe('foo@example.com');
  });

  it("select action without 'value' returns success: false", async () => {
    const select = document.createElement('select');
    const opt1 = document.createElement('option');
    opt1.value = 'a';
    opt1.text = 'A';
    const opt2 = document.createElement('option');
    opt2.value = 'b';
    opt2.text = 'B';
    select.appendChild(opt1);
    select.appendChild(opt2);
    container.appendChild(select);
    registry.registerElement('size-select', select, { type: 'select', label: 'Size' });

    const result = await executor.executeAction('size-select', {
      action: 'select',
      params: {} as unknown as { value: string },
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/'value' parameter/);
    expect(select.value).toBe('a'); // unchanged (default first option)
  });

  it("sendKeys action without 'keys' returns success: false", async () => {
    const input = document.createElement('input');
    input.type = 'text';
    container.appendChild(input);
    registry.registerElement('search-input', input, { type: 'input', label: 'Search' });

    const result = await executor.executeAction('search-input', {
      action: 'sendKeys',
      params: {} as unknown as { keys: { key: string }[] },
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/'keys' array/);
  });
});

describe('DefaultActionExecutor - waitOptions precondition', () => {
  // Regression coverage for the time-base mixup at action-executor.ts:1220.
  // The private `waitForElement` method used `performance.now()` to compute
  // `deadline` but `Date.now()` to guard the polling loop. Date.now() is
  // ~10¹² (epoch-millis) and performance.now() is ~10⁵ (page-relative),
  // so `Date.now() < deadline` was always false on entry — every wait
  // returned `met:false` immediately with a misleading "Timeout waiting for
  // conditions after Nms" error, regardless of whether the conditions
  // were actually met.
  //
  // Only one site in the codebase passes waitOptions to executeAction —
  // `nl-action-executor.ts:366` — which is why this never surfaced in unit
  // tests until the Home-page NL prompt flow exercised it.
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

  // Stub getBoundingClientRect because jsdom doesn't compute layout —
  // the default {0,0,0,0} rect makes isVisible() return false and would
  // mask the wait behavior we want to verify.
  function stubRect(
    el: HTMLElement,
    rect: { x: number; y: number; width: number; height: number }
  ) {
    el.getBoundingClientRect = () =>
      ({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        top: rect.y,
        left: rect.x,
        right: rect.x + rect.width,
        bottom: rect.y + rect.height,
        toJSON() {
          return this;
        },
      }) as DOMRect;
  }

  it('passes the precondition immediately when an in-viewport element is already visible+enabled', async () => {
    // Use `toggle` on a <details> rather than `click` because jsdom can't
    // construct MouseEvent (`view is not of type Window`) — but we're
    // testing the wait, not the action dispatch. toggle exercises the
    // same waitOptions pre-check path and runs to completion in jsdom.
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Advanced';
    details.appendChild(summary);
    container.appendChild(details);
    stubRect(details, { x: 50, y: 50, width: 200, height: 24 });
    registry.registerElement('details-advanced', details, {
      type: 'generic',
      actions: ['toggle'],
      label: 'Advanced',
    });

    const t0 = performance.now();
    const result = await executor.executeAction('details-advanced', {
      action: 'toggle',
      waitOptions: { visible: true, enabled: true, timeout: 5000 },
    });
    const elapsed = performance.now() - t0;

    expect(result.error, `unexpected error: ${result.error}`).toBeUndefined();
    expect(result.success).toBe(true);
    expect(details.open).toBe(true);
    // The wait should observe `visible:true, enabled:true` on the very first
    // poll iteration and return well under the 5s timeout. Anything close
    // to 5s means the time-base mixup at line 1220 has regressed.
    expect(elapsed).toBeLessThan(1000);
    expect(result.waitDurationMs ?? 0).toBeLessThan(500);
  });

  it('returns a timeout failure that actually waits the configured duration when conditions are never met', async () => {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Hidden';
    details.appendChild(summary);
    // display:none makes isVisible() return false unambiguously.
    details.style.display = 'none';
    container.appendChild(details);
    stubRect(details, { x: 50, y: 50, width: 200, height: 24 });
    registry.registerElement('details-hidden', details, {
      type: 'generic',
      actions: ['toggle'],
      label: 'Hidden',
    });

    const t0 = performance.now();
    const result = await executor.executeAction('details-hidden', {
      action: 'toggle',
      waitOptions: { visible: true, timeout: 200 },
    });
    const elapsed = performance.now() - t0;

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Timeout waiting for conditions/);
    // The wait must actually wait — pre-fix it returned in <1ms because
    // the while-loop body never executed. Post-fix it polls until the
    // deadline (200ms ± one poll interval).
    expect(elapsed).toBeGreaterThanOrEqual(180);
    expect(elapsed).toBeLessThan(800);
  });
});

// ---------------------------------------------------------------------------
// Value-mutation lifecycle — `type` / `setValue` / `clear` now route through
// the shared `applyValueMutation` helper, so every one of them must emit
// focus BEFORE input (so focus-gated inputs react) and, by default, NO
// trailing blur (the element stays focused). Pre-fix these paths set the
// value without ever focusing, so a focus-gated dropdown never opened.
// ---------------------------------------------------------------------------

describe('DefaultActionExecutor - value mutation focus lifecycle', () => {
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

  function registerInput(
    id: string,
    initial = '',
    el: HTMLInputElement | HTMLTextAreaElement = document.createElement('input')
  ): { el: HTMLInputElement | HTMLTextAreaElement; events: string[] } {
    el.value = initial;
    container.appendChild(el);
    registry.registerElement(id, el, { type: 'input', label: id });
    const events: string[] = [];
    for (const t of ['focus', 'input', 'change', 'blur']) {
      el.addEventListener(t, () => events.push(t));
    }
    return { el, events };
  }

  it("`type` dispatches focus before input with no trailing blur", async () => {
    const { el, events } = registerInput('type-input');

    const result = await executor.executeAction('type-input', {
      action: 'type',
      params: { text: 'hello' },
    });

    expect(result.success).toBe(true);
    expect(el.value).toBe('hello');
    expect(events).toContain('focus');
    expect(events).toContain('input');
    expect(events.indexOf('focus')).toBeLessThan(events.indexOf('input'));
    expect(events).not.toContain('blur');
  });

  it("`setValue` dispatches focus before input with no trailing blur", async () => {
    const { el, events } = registerInput('setvalue-input', 'old');

    const result = await executor.executeAction('setvalue-input', {
      action: 'setValue',
      params: { value: 'fresh' },
    });

    expect(result.success).toBe(true);
    expect(el.value).toBe('fresh');
    expect(events.indexOf('focus')).toBeLessThan(events.indexOf('input'));
    expect(events).not.toContain('blur');
  });

  it("`clear` dispatches focus before input with no trailing blur", async () => {
    const { el, events } = registerInput('clear-input', 'remove me');

    const result = await executor.executeAction('clear-input', { action: 'clear' });

    expect(result.success).toBe(true);
    expect(el.value).toBe('');
    expect(events.indexOf('focus')).toBeLessThan(events.indexOf('input'));
    expect(events).not.toContain('blur');
  });

  it("`type` into a <textarea> also focuses before input", async () => {
    const { el, events } = registerInput(
      'type-textarea',
      '',
      document.createElement('textarea')
    );

    const result = await executor.executeAction('type-textarea', {
      action: 'type',
      params: { text: 'area' },
    });

    expect(result.success).toBe(true);
    expect(el.value).toBe('area');
    expect(events.indexOf('focus')).toBeLessThan(events.indexOf('input'));
    expect(events).not.toContain('blur');
  });
});
