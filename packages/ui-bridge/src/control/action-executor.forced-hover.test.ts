/**
 * `hover` / `unhover` / `hoverClick` and the auto-release, on BOTH SDK
 * dispatch paths: `DefaultActionExecutor.executeAction` (HTTP server, runner
 * IPC) and the relay `executeElementAction` in `react/commandHandlers.ts`
 * (qontinui-web, the runner's WS route), which is a separate DOM
 * implementation that never calls the executor.
 *
 * Plan 2026-10-22-ui-bridge-hover-forces-the-css-hover-state, Phase 2.
 *
 * jsdom cascades plain top-level CSS rules in `getComputedStyle`, so a
 * `.group:hover .tool { pointer-events: auto }` rule here is forced through
 * the real twin-rule mechanism and read back as computed style. (Tailwind v4
 * nesting/@layer and the paint itself are proven in real Chromium by
 * `forced-hover.smoke.test.ts`.)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UIBridgeRegistry, getGlobalRegistry } from '../core/registry';
import { DefaultActionExecutor } from './action-executor';
import { executeCommand, type BridgeAccess } from '../react/commandHandlers';
import { __resetForcedPseudoStateForTest, getForcedPseudoState } from './forced-hover';

const ATTR = 'data-ui-bridge-pseudo-hover';

const CSS = `
  .tool { pointer-events: none; }
  .group:hover .tool { pointer-events: auto; }
`;

interface Fixture {
  group: HTMLElement;
  header: HTMLElement;
  tool: HTMLButtonElement;
  input: HTMLInputElement;
  clicks: () => number;
}

let style: HTMLStyleElement;
let root: HTMLDivElement;

function mount(): Fixture {
  style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  root = document.createElement('div');
  root.innerHTML = `
    <div class="group" id="g">
      <span id="header">zone header</span>
      <button id="tool" class="tool">maximize</button>
    </div>
    <input id="field" />`;
  document.body.appendChild(root);
  const tool = document.getElementById('tool') as HTMLButtonElement;
  let clicks = 0;
  tool.addEventListener('click', () => {
    clicks += 1;
  });
  return {
    group: document.getElementById('g')!,
    header: document.getElementById('header')!,
    tool,
    input: document.getElementById('field') as HTMLInputElement,
    clicks: () => clicks,
  };
}

async function unmount(): Promise<void> {
  await __resetForcedPseudoStateForTest();
  style?.remove();
  root?.remove();
}

const pointerEvents = (el: Element): string => getComputedStyle(el).pointerEvents;

describe('DefaultActionExecutor — forced hover', () => {
  let registry: UIBridgeRegistry;
  let executor: DefaultActionExecutor;
  let f: Fixture;

  beforeEach(() => {
    f = mount();
    registry = new UIBridgeRegistry();
    registry.registerElement('header', f.header, { type: 'generic' });
    registry.registerElement('tool', f.tool, { type: 'button' });
    registry.registerElement('field', f.input, { type: 'input' });
    executor = new DefaultActionExecutor(registry);
  });

  afterEach(unmount);

  it('hover forces the CSS :hover state and reports what it revealed', async () => {
    expect(pointerEvents(f.tool)).toBe('none');
    const res = await executor.executeAction('header', { action: 'hover' });
    expect(res.success).toBe(true);
    expect(res.result).toBeUndefined();
    expect(res.forcedHover?.applied).toMatchObject({
      state: 'hover',
      rulesCloned: 1,
      unreadableSheets: 0,
      complete: true,
    });
    expect(res.forcedHover?.applied?.revealed).toEqual([
      expect.objectContaining({
        id: 'tool',
        changes: [{ property: 'pointer-events', before: 'none', after: 'auto' }],
      }),
    ]);
    expect(pointerEvents(f.tool)).toBe('auto');
    expect(f.group.hasAttribute(ATTR)).toBe(true);
  });

  it('hover still sends the enter events for JS-driven reveals', async () => {
    const seen: string[] = [];
    f.group.addEventListener('mouseenter', () => seen.push('group:mouseenter'));
    f.header.addEventListener('pointerenter', () => seen.push('header:pointerenter'));
    await executor.executeAction('header', { action: 'hover' });
    expect(seen).toEqual(expect.arrayContaining(['group:mouseenter', 'header:pointerenter']));
  });

  it('hover → click on the revealed control passes the pointer-events gate (no waiver), then releases', async () => {
    const refused = await executor.executeAction('tool', { action: 'click' });
    expect(refused.success).toBe(false);
    expect(refused.error).toMatch(/pointer-events/);
    expect(f.clicks()).toBe(0);

    await executor.executeAction('header', { action: 'hover' });
    const click = await executor.executeAction('tool', { action: 'click' });
    expect(click.success).toBe(true);
    expect(f.clicks()).toBe(1);
    expect(click.forcedHover?.released).toMatchObject({
      released: true,
      reason: 'next-action',
      restore: 'verified',
    });
    expect(getForcedPseudoState()).toBeNull();
    expect(pointerEvents(f.tool)).toBe('none');
  });

  it('a refused click keeps the hold, so a retry is not refused on pointer-events', async () => {
    await executor.executeAction('header', { action: 'hover' });
    f.tool.disabled = true;
    const refused = await executor.executeAction('tool', { action: 'click' });
    expect(refused.success).toBe(false);
    expect(getForcedPseudoState()).not.toBeNull();
    f.tool.disabled = false;
    const retry = await executor.executeAction('tool', { action: 'click' });
    expect(retry.success).toBe(true);
  });

  it('hover → type elsewhere → the write releases the hold in its finally', async () => {
    await executor.executeAction('header', { action: 'hover' });
    const typed = await executor.executeAction('field', {
      action: 'type',
      params: { text: 'x' },
    });
    expect(typed.success).toBe(true);
    expect(typed.forcedHover?.released?.reason).toBe('next-action');
    expect(getForcedPseudoState()).toBeNull();
    expect(document.querySelectorAll(`[${ATTR}]`)).toHaveLength(0);
  });

  it('hover → scrollIntoView / focus (read-class) → still held', async () => {
    // jsdom implements no scrolling; the verb's own outcome is not under test.
    f.tool.scrollIntoView = () => undefined;
    await executor.executeAction('header', { action: 'hover' });
    const scrolled = await executor.executeAction('tool', { action: 'scrollIntoView' });
    expect(scrolled.success).toBe(true);
    expect(scrolled.forcedHover).toBeUndefined();
    await executor.executeAction('field', { action: 'focus' });
    expect(getForcedPseudoState()).not.toBeNull();
    expect(pointerEvents(f.tool)).toBe('auto');
  });

  it('hover → a click that fails resolution → still held', async () => {
    await executor.executeAction('header', { action: 'hover' });
    const missing = await executor.executeAction('no-such-element', { action: 'click' });
    expect(missing.success).toBe(false);
    expect(getForcedPseudoState()).not.toBeNull();
  });

  it('unhover releases with a verified restore; twice is an idempotent no-op', async () => {
    await executor.executeAction('header', { action: 'hover' });
    const first = await executor.executeAction('header', { action: 'unhover' });
    expect(first.success).toBe(true);
    expect(first.forcedHover?.released).toMatchObject({
      released: true,
      reason: 'explicit',
      restore: 'verified',
    });
    expect(pointerEvents(f.tool)).toBe('none');
    const second = await executor.executeAction('header', { action: 'unhover' });
    expect(second.success).toBe(true);
    expect(second.forcedHover?.released).toMatchObject({
      released: false,
      restore: 'nothing_held',
    });
  });

  it('unhover names any element: the hold is the page’s single pointer', async () => {
    await executor.executeAction('header', { action: 'hover' });
    const res = await executor.executeAction('field', { action: 'unhover' });
    expect(res.forcedHover?.released?.released).toBe(true);
  });

  it('hover honours holdMs: the TTL releases it by itself', async () => {
    const res = await executor.executeAction('header', {
      action: 'hover',
      params: { holdMs: 40 },
    });
    expect(res.forcedHover?.applied?.holdMs).toBe(40);
    await new Promise((r) => setTimeout(r, 150));
    expect(getForcedPseudoState()).toBeNull();
    expect(pointerEvents(f.tool)).toBe('none');
  });

  it('hoverClick forces, clicks, and releases in one dispatch, reporting both halves', async () => {
    const res = await executor.executeAction('tool', { action: 'hoverClick' });
    expect(res.success).toBe(true);
    expect(f.clicks()).toBe(1);
    expect(res.forcedHover?.applied?.rulesCloned).toBe(1);
    expect(res.forcedHover?.released).toMatchObject({ released: true, reason: 'next-action' });
    expect(getForcedPseudoState()).toBeNull();
  });

  it('a second hover releases the first before applying', async () => {
    await executor.executeAction('header', { action: 'hover' });
    const second = await executor.executeAction('field', { action: 'hover' });
    expect(second.forcedHover?.applied?.replaced).toMatchObject({ reason: 'replaced' });
    expect(f.group.hasAttribute(ATTR)).toBe(false);
    expect(f.input.hasAttribute(ATTR)).toBe(true);
  });

  it('unhover is advertised wherever hover is', () => {
    const header = registry.getElement('tool')!;
    expect(header.actions).toEqual(expect.arrayContaining(['hover', 'unhover']));
  });

  it('there is no implicit parent-hover before an action on an opacity-0 element', async () => {
    // The deleted inline fallback hovered the parent of any opacity-0 target
    // (a bubbling mouseover React turns into onMouseEnter). A JS-driven reveal
    // now needs an explicit `hover`/`hoverClick`.
    const parent = document.createElement('div');
    const hidden = document.createElement('input');
    hidden.style.opacity = '0';
    parent.appendChild(hidden);
    root.appendChild(parent);
    registry.registerElement('hidden', hidden, { type: 'input' });
    let parentHovered = 0;
    parent.addEventListener('mouseover', () => (parentHovered += 1));
    parent.addEventListener('mouseenter', () => (parentHovered += 1));
    const res = await executor.executeAction('hidden', { action: 'focus' });
    expect(res.success).toBe(true);
    expect(parentHovered).toBe(0);
  });
});

describe('relay executeElementAction — forced hover and auto-release', () => {
  const emptyBridge: BridgeAccess = {
    elements: [],
    getElement: () => undefined,
    components: [],
    workflows: [],
  };
  let f: Fixture;

  /** jsdom has no layout: the relay's visibility gate reads `offsetParent`. */
  function makeVisible(el: HTMLElement): void {
    Object.defineProperty(el, 'offsetParent', { configurable: true, get: () => document.body });
  }

  const relay = async (id: string, request: Record<string, unknown>) =>
    (await executeCommand('executeElementAction', { id, request }, emptyBridge)) as Record<
      string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any
    >;

  beforeEach(() => {
    f = mount();
    for (const el of [f.header, f.tool, f.input]) makeVisible(el);
    const reg = getGlobalRegistry();
    reg.registerElement('header', f.header, { type: 'generic' });
    reg.registerElement('tool', f.tool, { type: 'button' });
    reg.registerElement('field', f.input, { type: 'input' });
  });

  afterEach(async () => {
    await unmount();
    getGlobalRegistry().clear();
  });

  it('hover → click on the revealed control succeeds and releases the hold', async () => {
    const refused = await relay('tool', { action: 'click' });
    expect(refused.success).toBe(false);

    const hover = await relay('header', { action: 'hover' });
    expect(hover.success).toBe(true);
    expect(hover.forcedHover.applied.revealed.map((r: { id: string }) => r.id)).toEqual(['tool']);
    expect(pointerEvents(f.tool)).toBe('auto');

    const click = await relay('tool', { action: 'click' });
    expect(click.success).toBe(true);
    expect(f.clicks()).toBe(1);
    expect(click.forcedHover.released).toMatchObject({ released: true, reason: 'next-action' });
    expect(getForcedPseudoState()).toBeNull();
    expect(pointerEvents(f.tool)).toBe('none');
  });

  it('hover → scrollIntoView keeps the hold; a refused click keeps it too', async () => {
    await relay('header', { action: 'hover' });
    await relay('tool', { action: 'scrollIntoView', params: { smooth: false } });
    f.tool.disabled = true;
    const refused = await relay('tool', { action: 'click' });
    expect(refused.success).toBe(false);
    expect(getForcedPseudoState()).not.toBeNull();
  });

  it('unhover releases, and is a no-op the second time — even on the now-hidden element', async () => {
    await relay('header', { action: 'hover' });
    Object.defineProperty(f.tool, 'offsetParent', { configurable: true, get: () => null });
    const first = await relay('tool', { action: 'unhover' });
    expect(first.success).toBe(true);
    expect(first.forcedHover.released).toMatchObject({ released: true, restore: 'verified' });
    const second = await relay('tool', { action: 'unhover' });
    expect(second.forcedHover.released).toMatchObject({ released: false });
  });

  it('hoverClick forces, clicks and releases', async () => {
    const res = await relay('tool', { action: 'hoverClick' });
    expect(res.success).toBe(true);
    expect(f.clicks()).toBe(1);
    expect(res.forcedHover.applied.rulesCloned).toBe(1);
    expect(res.forcedHover.released.released).toBe(true);
    expect(getForcedPseudoState()).toBeNull();
  });
});

describe('relay getElementStateStyles — reads each state for real', () => {
  const emptyBridge: BridgeAccess = {
    elements: [],
    getElement: () => undefined,
    components: [],
    workflows: [],
  };

  afterEach(async () => {
    await __resetForcedPseudoStateForTest();
    style?.remove();
    root?.remove();
    getGlobalRegistry().clear();
  });

  it('hover and active are forced, focus is real, and the element is restored after', async () => {
    style = document.createElement('style');
    style.textContent = `
      .btn { color: rgb(0, 0, 0); }
      .btn:hover { color: rgb(255, 0, 0); }
      .btn:active { color: rgb(0, 0, 255); }
      .btn:focus { color: rgb(0, 128, 0); }`;
    document.head.appendChild(style);
    root = document.createElement('div');
    root.innerHTML = `<button class="btn" id="b">b</button>`;
    document.body.appendChild(root);
    const btn = document.getElementById('b')!;
    getGlobalRegistry().registerElement('b', btn, { type: 'button' });
    let focused = 0;
    btn.addEventListener('focus', () => (focused += 1));

    const out = (await executeCommand(
      'getElementStateStyles',
      { id: 'b', states: ['hover', 'focus', 'active'] },
      emptyBridge
    )) as {
      elementId: string;
      stateStyles: Array<{ state: string; styles: { color: string } }>;
    };
    const color = Object.fromEntries(out.stateStyles.map((s) => [s.state, s.styles.color]));
    expect(out.elementId).toBe('b');
    // jsdom does not match `:focus` in getComputedStyle, so the focus arm is
    // checked by the real focus it performs (below) rather than by color.
    expect(color).toMatchObject({
      default: 'rgb(0, 0, 0)',
      hover: 'rgb(255, 0, 0)',
      active: 'rgb(0, 0, 255)',
    });
    expect(focused).toBe(1);
    expect(getForcedPseudoState()).toBeNull();
    expect(document.activeElement).not.toBe(btn);
    expect(getComputedStyle(btn).color).toBe('rgb(0, 0, 0)');
  });
});
