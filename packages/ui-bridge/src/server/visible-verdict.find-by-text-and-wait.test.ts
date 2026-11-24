/**
 * The visibility readers outside the find filter — plan
 * `2026-11-24-ui-bridge-find-visibility-and-fallback-label-read-the-canonical-verdicts`
 * follow-ups fb196aa0, e11dd943 and the delta reviews after them.
 *
 * - `findByText`'s per-hit `visible`, and the `visible` condition / requirement
 *   of the two wait routes, read the canonical verdict LIVE
 *   (`readElementVisibility`): an occluded or off-screen element is not
 *   visible there, and a stale registry overlay does not override the node.
 * - `clickable` means "this arm's next click would not be refused", so it
 *   mirrors each arm's own click path: the server (HTTP executor) arm reads
 *   `getClickVisibilityReason`, the relay arm the dispatch gate's
 *   `isRenderedForAction`; both add the interaction blockers. Neither is the
 *   visibility verdict.
 * - The relay dispatch gate is a rendered-at-all check (`isRenderedForAction`),
 *   not the verdict.
 *
 * jsdom has neither layout, `offsetParent` nor `elementFromPoint`; all three
 * are stubbed as in `dom-fallback.visible.test.ts`. `offsetParent` is set on
 * every placed node, so each old `offsetParent` check would have answered
 * visible.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findByTextPrimitive } from './page-primitives';
import { createHandlers, type RegistryLike } from './handlers';
import { executeCommand, type BridgeAccess } from '../react/commandHandlers';
import { getGlobalRegistry, resetGlobalRegistry } from '../core/registry';
import { createActionExecutor, getClickVisibilityReason } from '../control/action-executor';
import { createCtrEntry, getGlobalCtr, resetGlobalCtr } from '../ctr/registry';

interface Box {
  el: HTMLElement;
  rect: { x: number; y: number; w: number; h: number };
}

/** Later in this array = painted on top. */
let boxes: Box[] = [];
const realElementFromPoint = document.elementFromPoint;

function place(el: HTMLElement, x: number, y: number, w: number, h: number): HTMLElement {
  el.getBoundingClientRect = () =>
    ({
      x,
      y,
      width: w,
      height: h,
      top: y,
      left: x,
      right: x + w,
      bottom: y + h,
      toJSON: () => ({}),
    }) as DOMRect;
  Object.defineProperty(el, 'offsetParent', { configurable: true, get: () => document.body });
  if (!el.isConnected) document.body.appendChild(el);
  boxes.push({ el, rect: { x, y, w, h } });
  return el;
}

function button(id: string, text: string): HTMLButtonElement {
  const el = document.createElement('button');
  el.id = id;
  el.textContent = text;
  return el;
}

/** Three buttons — covered by an overlay, below the fold, and clear. */
function mountPage(): void {
  place(button('covered', 'Pay covered'), 0, 0, 80, 24);
  place(button('below', 'Pay below'), 0, 900, 80, 24);
  place(button('clear', 'Pay clear'), 0, 100, 80, 24);
  const overlay = document.createElement('div');
  overlay.id = 'toast';
  place(overlay, 0, 0, 200, 60);
}

beforeEach(() => {
  resetGlobalRegistry();
  document.body.innerHTML = '';
  boxes = [];
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 720, configurable: true });
  document.elementFromPoint = ((px: number, py: number) => {
    for (let i = boxes.length - 1; i >= 0; i--) {
      const { el, rect } = boxes[i];
      if (!el.isConnected) continue;
      if (px >= rect.x && px < rect.x + rect.w && py >= rect.y && py < rect.y + rect.h) {
        return el;
      }
    }
    return null;
  }) as typeof document.elementFromPoint;
  mountPage();
});

afterEach(() => {
  document.elementFromPoint = realElementFromPoint;
  document.body.innerHTML = '';
  resetGlobalRegistry();
});

describe('findByText visible', () => {
  it('reads false for an occluded or off-screen match, true for a clear one', () => {
    const result = findByTextPrimitive('Pay', {});
    expect(result.ok).toBe(true);
    const visibleByText = Object.fromEntries(
      (result.ok ? result.data : []).map((hit) => [hit.text, hit.visible])
    );
    expect(visibleByText).toEqual({
      'Pay covered': false,
      'Pay below': false,
      'Pay clear': true,
    });
  });
});

const emptyBridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
};

function registryLike(): RegistryLike {
  const reg = getGlobalRegistry();
  return {
    getAllElements: () => reg.getAllElements(),
    getElement: (id) => reg.getElement(id),
    getAllComponents: () => reg.getAllComponents(),
    getComponent: (id) => reg.getComponent(id),
    createSnapshot: () => reg.createSnapshot() as ReturnType<RegistryLike['createSnapshot']>,
  };
}

type Condition = 'visible' | 'clickable';
type Arm = (id: string, condition: Condition) => Promise<{ matched: boolean }>;

const serverArm: Arm = async (id, condition) => {
  const handlers = createHandlers(
    registryLike(),
    {
      executeAction: async () => ({ success: true }),
      executeComponentAction: async () => ({ success: true }),
    } as never,
    { consoleCapture: null as never }
  );
  const resp = await handlers.waitForElementByCondition({
    selector: { id },
    condition,
    timeout_ms: 150,
  });
  expect(resp.success).toBe(true);
  return resp.data as { matched: boolean };
};

const relayArm: Arm = async (id, condition) =>
  (await executeCommand(
    'waitForElementByCondition',
    { selector: { id }, condition, timeout_ms: 150 },
    emptyBridge
  )) as { matched: boolean };

type RegisteredArm = (id: string) => Promise<{ element?: { id: string }; reason?: string }>;

const serverRegisteredArm: RegisteredArm = async (id) => {
  const handlers = createHandlers(
    registryLike(),
    {
      executeAction: async () => ({ success: true }),
      executeComponentAction: async () => ({ success: true }),
    } as never,
    { consoleCapture: null as never }
  );
  const resp = await handlers.waitForElementRegistered({
    predicate: { id },
    requirement: 'visible',
    timeoutMs: 150,
  });
  expect(resp.success).toBe(true);
  return resp.data as { element?: { id: string }; reason?: string };
};

const relayRegisteredArm: RegisteredArm = async (id) =>
  (await executeCommand(
    'waitForElementRegistered',
    { predicate: { id }, requirement: 'visible', timeoutMs: 150 },
    emptyBridge
  )) as { element?: { id: string }; reason?: string };

describe.each([
  ['server/handlers.ts', serverArm],
  ['react/commandHandlers.ts', relayArm],
])('waitForElementByCondition reads the canonical verdict (%s)', (_name, arm) => {
  beforeEach(() => {
    const registry = getGlobalRegistry();
    for (const id of ['covered', 'below', 'clear']) {
      registry.registerElement(id, document.getElementById(id)!, { type: 'button', label: id });
    }
  });

  it('visible: an occluded or off-screen element never matches; a clear one does', async () => {
    expect((await arm('covered', 'visible')).matched).toBe(false);
    expect((await arm('below', 'visible')).matched).toBe(false);
    expect((await arm('clear', 'visible')).matched).toBe(true);
  });

  it('clickable means the next click would not be refused: below-the-fold, opacity:0 and covered controls are clickable; display:none is not', async () => {
    const registry = getGlobalRegistry();
    const faded = button('faded', 'Pay faded');
    faded.style.opacity = '0';
    place(faded, 0, 200, 80, 24);
    registry.registerElement('faded', faded, { type: 'button', label: 'faded' });
    const gone = button('gone', 'Pay gone');
    gone.style.display = 'none';
    document.body.appendChild(gone);
    registry.registerElement('gone', gone, { type: 'button', label: 'gone' });

    expect((await arm('below', 'clickable')).matched).toBe(true);
    expect((await arm('faded', 'clickable')).matched).toBe(true);
    // Occlusion was never a click-refusal signal; unchanged.
    expect((await arm('covered', 'clickable')).matched).toBe(true);
    expect((await arm('clear', 'clickable')).matched).toBe(true);
    expect((await arm('gone', 'clickable')).matched).toBe(false);
  });
});

describe('a stale registry overlay never overrides the live verdict', () => {
  // A mutation action leaves `visible` in the registry overlay, which nothing
  // expires; `getState()` reports it. The waits read the node live.
  beforeEach(() => {
    const registry = getGlobalRegistry();
    registry.registerElement('below', document.getElementById('below')!, {
      type: 'button',
      label: 'below',
    });
    registry.refreshElement('below', { visible: true });
  });

  it.each([
    ['server', serverArm],
    ['relay', relayArm],
  ] as const)(
    'wait-for-element-condition visible (%s arm): off-screen is not visible',
    async (_n, arm) => {
      expect((await arm('below', 'visible')).matched).toBe(false);
    }
  );

  it.each([
    ['server', serverRegisteredArm],
    ['relay', relayRegisteredArm],
  ] as const)(
    'wait-for-element requirement visible (%s arm): off-screen times out',
    async (_n, arm) => {
      expect((await arm('below')).element).toBeUndefined();
    }
  );
});

/**
 * Each arm's `clickable` mirrors that arm's own click path (review A2).
 */
describe('relay wait-for-element visible ignores the registry bbox hint when a node exists', () => {
  it('a registration whose tracked visible is true, on an off-screen node, is not visible', async () => {
    const registry = getGlobalRegistry();
    registry.registerElement('below', document.getElementById('below')!, {
      type: 'button',
      label: 'below',
    });
    // The tracker's bounding-box hint, as the registry carries it.
    (registry.getElement('below') as unknown as { visible?: boolean }).visible = true;
    expect((await relayRegisteredArm('below')).element).toBeUndefined();
  });
});

describe('clickable per arm', () => {
  function fixedFab(): HTMLButtonElement {
    const fab = button('fab', 'Pay fab');
    fab.style.position = 'fixed';
    place(fab, 1100, 600, 80, 24);
    // A browser reports no offsetParent for a position:fixed element.
    Object.defineProperty(fab, 'offsetParent', { configurable: true, get: () => null });
    getGlobalRegistry().registerElement('fab', fab, { type: 'button', label: 'fab' });
    return fab;
  }

  beforeEach(() => {
    const registry = getGlobalRegistry();
    registry.registerElement('below', document.getElementById('below')!, {
      type: 'button',
      label: 'below',
    });
  });

  it('server: an inline visually-hidden (-9999px) control is refused, a below-the-fold one and a fixed one are clickable', async () => {
    const sr = button('sr', 'Pay sr');
    sr.style.position = 'absolute';
    sr.style.left = '-10000px';
    place(sr, -10000, 0, 80, 24);
    getGlobalRegistry().registerElement('sr', sr, { type: 'button', label: 'sr' });
    fixedFab();
    expect((await serverArm('sr', 'clickable')).matched).toBe(false);
    expect((await serverArm('below', 'clickable')).matched).toBe(true);
    expect((await serverArm('fab', 'clickable')).matched).toBe(true);
  });

  it('server: a registered node that is then detached is not clickable (the executor refuses it UB-STALE-ELEMENT)', async () => {
    const gone = button('gone-later', 'Pay later');
    place(gone, 0, 300, 80, 24);
    getGlobalRegistry().registerElement('gone-later', gone, { type: 'button', label: 'gone' });
    expect((await serverArm('gone-later', 'clickable')).matched).toBe(true);
    gone.remove();
    expect((await serverArm('gone-later', 'clickable')).matched).toBe(false);
  });

  it('a control under a display:none ancestor is clickable on neither arm, and the HTTP click is refused', async () => {
    // Both click paths now refuse a node inside a display:none subtree: the
    // relay dispatch gate and the HTTP executor's pre-check share
    // isRenderedForAction, so both `clickable` arms say no.
    const shell = document.createElement('div');
    shell.style.display = 'none';
    document.body.appendChild(shell);
    const inner = button('inner-x', 'Pay inner');
    shell.appendChild(inner);
    getGlobalRegistry().registerElement('inner-x', inner, { type: 'button', label: 'inner' });
    expect((await serverArm('inner-x', 'clickable')).matched).toBe(false);
    expect((await relayArm('inner-x', 'clickable')).matched).toBe(false);
    const clicked: string[] = [];
    inner.addEventListener('click', () => clicked.push('inner-x'));
    const result = (await createActionExecutor(getGlobalRegistry()).executeAction('inner-x', {
      action: 'click',
    })) as {
      success: boolean;
      error?: string;
      failureDetails?: { errorCode?: string; visibilityReason?: string };
    };
    expect(result.success).toBe(false);
    expect(result.error).toContain('not visible');
    expect(result.failureDetails?.errorCode).toBe('UB-ELEM-NOT-VISIBLE');
    expect(result.failureDetails?.visibilityReason).toBe('hidden');
    expect(clicked).toEqual([]);
  });

  it('server clickable resolves the node the executor would click: a detached registry node with a same-id replacement is clickable; with nothing to resolve it is not', async () => {
    const registry = getGlobalRegistry();
    const original = button('swap', 'Pay swap');
    place(original, 0, 300, 80, 24);
    registry.registerElement('swap', original, { type: 'button', label: 'swap' });
    const withExecutor = async () => {
      const handlers = createHandlers(registryLike(), createActionExecutor(registry), {
        consoleCapture: null as never,
      });
      const resp = await handlers.waitForElementByCondition({
        selector: { id: 'swap' },
        condition: 'clickable',
        timeout_ms: 150,
      });
      return (resp.data as { matched: boolean }).matched;
    };
    expect(await withExecutor()).toBe(true);
    // Detached, and nothing else answers to the id: the click would fail too.
    original.remove();
    expect(await withExecutor()).toBe(false);
    // A re-render puts a same-id node back: the executor resolves it by
    // identifier and clicks it, so the wait must say clickable.
    const replacement = button('swap', 'Pay swap');
    place(replacement, 0, 300, 80, 24);
    expect(await withExecutor()).toBe(true);
  });

  it('relay: a fixed and a below-the-fold control are clickable; one under a display:none ancestor is not', async () => {
    fixedFab();
    const shell = document.createElement('div');
    shell.style.display = 'none';
    document.body.appendChild(shell);
    const inner = button('inner', 'Pay inner');
    shell.appendChild(inner);
    Object.defineProperty(inner, 'offsetParent', { configurable: true, get: () => document.body });
    getGlobalRegistry().registerElement('inner', inner, { type: 'button', label: 'inner' });
    expect((await relayArm('fab', 'clickable')).matched).toBe(true);
    expect((await relayArm('below', 'clickable')).matched).toBe(true);
    expect((await relayArm('inner', 'clickable')).matched).toBe(false);
  });
});

/**
 * The wait-for-elements `visible` requirement's live-node fallback — it ran
 * whenever a row carried no serialized verdict (every server registry row,
 * and a React row with no tracked `visible`) and read `offsetParent` plus a
 * non-zero rect. It now reads the canonical verdict.
 */
describe.each([
  ['server/handlers.ts', serverRegisteredArm],
  ['react/commandHandlers.ts', relayRegisteredArm],
])('waitForElementRegistered visible reads the canonical verdict (%s)', (_name, arm) => {
  beforeEach(() => {
    const registry = getGlobalRegistry();
    for (const id of ['covered', 'below', 'clear']) {
      registry.registerElement(id, document.getElementById(id)!, { type: 'button', label: id });
    }
  });

  it('an occluded or off-screen element times out; a clear one resolves', async () => {
    expect((await arm('covered')).element).toBeUndefined();
    expect((await arm('below')).element).toBeUndefined();
    expect((await arm('clear')).element?.id).toBe('clear');
  });
});

describe('waitForElementRegistered visible, server DOM-selector fallback (unregistered nodes)', () => {
  // Nothing registered: the server falls back to `document.querySelector` and
  // judges a synthetic row with no `state`, which is where its live-node
  // fallback runs.
  async function waitSelector(selector: string) {
    const handlers = createHandlers(
      registryLike(),
      {
        executeAction: async () => ({ success: true }),
        executeComponentAction: async () => ({ success: true }),
      } as never,
      { consoleCapture: null as never }
    );
    const resp = await handlers.waitForElementRegistered({
      predicate: { selector },
      requirement: 'visible',
      timeoutMs: 150,
    });
    return resp.data as { element?: { id: string }; reason?: string };
  }

  it('an occluded or off-screen node times out; a clear one resolves', async () => {
    expect((await waitSelector('#covered')).element).toBeUndefined();
    expect((await waitSelector('#below')).element).toBeUndefined();
    expect((await waitSelector('#clear')).element?.id).toBe('clear');
  });
});

/**
 * The relay's dispatch gate (`executeElementAction`'s `isVis`) is a
 * render-tree check, NOT the canonical verdict, on purpose: an action on a
 * covered, below-the-fold or `opacity: 0` control must still dispatch. Pinned
 * so a later "make it canonical" edit cannot silently start refusing them.
 */
describe('relay dispatch gate stays a rendered-at-all check', () => {
  beforeEach(() => {
    const registry = getGlobalRegistry();
    for (const id of ['covered', 'below', 'clear']) {
      registry.registerElement(id, document.getElementById(id)!, { type: 'button', label: id });
    }
    const faded = button('faded', 'Pay faded');
    faded.style.opacity = '0';
    place(faded, 0, 200, 80, 24);
    registry.registerElement('faded', faded, { type: 'button', label: 'faded' });
  });

  async function focus(id: string): Promise<{ success: boolean; error?: string }> {
    return (await executeCommand(
      'executeElementAction',
      { id, request: { action: 'focus' } },
      emptyBridge
    )) as { success: boolean; error?: string };
  }

  it.each(['covered', 'below', 'faded', 'clear'])(
    '%s is not refused as not visible',
    async (id) => {
      const result = await focus(id);
      expect(result.error ?? '').not.toContain('not visible');
      expect(result.success).toBe(true);
    }
  );

  it('a control that is itself position:fixed is not refused (edge e11dd943)', async () => {
    const fab = button('fab', 'Pay fab');
    fab.style.position = 'fixed';
    place(fab, 1100, 600, 80, 24);
    // A browser reports no offsetParent for a position:fixed element.
    Object.defineProperty(fab, 'offsetParent', { configurable: true, get: () => null });
    getGlobalRegistry().registerElement('fab', fab, { type: 'button', label: 'fab' });
    const result = await focus('fab');
    expect(result.error ?? '').not.toContain('not visible');
    expect(result.success).toBe(true);
  });

  it('a control under a display:none ancestor is still refused', async () => {
    const shell = document.createElement('div');
    shell.style.display = 'none';
    document.body.appendChild(shell);
    const inner = button('inner', 'Pay inner');
    shell.appendChild(inner);
    // As a browser reports it for a node under a display:none ancestor.
    Object.defineProperty(inner, 'offsetParent', { configurable: true, get: () => null });
    getGlobalRegistry().registerElement('inner', inner, { type: 'button', label: 'inner' });
    const result = await focus('inner');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not visible');
  });

  it('a display:none control is still refused', async () => {
    const gone = button('gone', 'Pay gone');
    gone.style.display = 'none';
    document.body.appendChild(gone);
    getGlobalRegistry().registerElement('gone', gone, { type: 'button', label: 'gone' });
    const result = await focus('gone');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not visible');
  });
});

/**
 * The server `clickable` wait polls, so it resolves the executor's target as a
 * read-only PROBE (review round 13, A1): no CTR self-healing, no events, no
 * discovery-cache pruning.
 */
describe('server clickable probes the executor target without mutating it', () => {
  afterEach(() => {
    resetGlobalCtr();
  });

  async function clickableWait(executor: ReturnType<typeof createActionExecutor>, id: string) {
    const handlers = createHandlers(registryLike(), executor, { consoleCapture: null as never });
    const resp = await handlers.waitForElementByCondition({
      selector: { id },
      condition: 'clickable',
      timeout_ms: 150,
    });
    return (resp.data as { matched: boolean }).matched;
  }

  it('a CTR-resolved target: no ctr event fires and the selector order is unchanged', async () => {
    const registry = getGlobalRegistry();
    const original = button('ctr-pay', 'Pay ctr');
    place(original, 0, 300, 80, 24);
    registry.registerElement('ctr-pay', original, { type: 'button', label: 'ctr-pay' });
    original.remove();
    // What the CTR's second selector finds; its first misses (a self-healing
    // resolution would demote it and promote the second).
    const target = document.createElement('button');
    target.setAttribute('data-testid', 'pay-target');
    target.textContent = 'Pay';
    place(target, 0, 400, 80, 24);
    const ctr = getGlobalCtr();
    ctr.register(
      createCtrEntry('ctr-pay', [
        { strategy: 'css', value: '#not-on-the-page' },
        { strategy: 'data-testid', value: 'pay-target' },
      ])
    );
    const before = JSON.stringify(ctr.get('ctr-pay'));
    const events: string[] = [];
    const off = ctr.on((event) => events.push(event.type));
    try {
      expect(await clickableWait(createActionExecutor(registry), 'ctr-pay')).toBe(true);
    } finally {
      off();
    }
    expect(events).toEqual([]);
    expect(JSON.stringify(ctr.get('ctr-pay'))).toBe(before);
  });

  it('a stale discovery-cache entry is left in place', async () => {
    const registry = getGlobalRegistry();
    const original = button('stale-x', 'Pay stale');
    place(original, 0, 300, 80, 24);
    registry.registerElement('stale-x', original, { type: 'button', label: 'stale' });
    original.remove();
    const executor = createActionExecutor(registry);
    const cache = (executor as unknown as { discoveryCache: Map<string, HTMLElement> })
      .discoveryCache;
    cache.set('stale-x', original);
    expect(await clickableWait(executor, 'stale-x')).toBe(false);
    expect(cache.get('stale-x')).toBe(original);
  });
});

/**
 * An <option> is judged by its <select>, on both arms (review round 14).
 * A browser's checkVisibility() is false for an option inside a closed
 * dropdown, yet clicking it to select it is supported; an option inside a
 * display:none subtree is refused because its select is. Content inside a
 * closed <details> stays refused.
 */
describe('an <option> is rendered exactly when its <select> is, on both arms', () => {
  function optionIn(parent: HTMLElement, id: string): HTMLOptionElement {
    const select = document.createElement('select');
    const option = document.createElement('option');
    option.textContent = 'Two';
    select.appendChild(option);
    parent.appendChild(select);
    // As a browser reports a closed dropdown: the option has no box, the
    // select does (when it is itself rendered).
    Object.defineProperty(option, 'checkVisibility', { configurable: true, value: () => false });
    getGlobalRegistry().registerElement(id, option, { type: 'button', label: id });
    return option;
  }

  async function serverClickable(id: string): Promise<boolean> {
    const handlers = createHandlers(registryLike(), createActionExecutor(getGlobalRegistry()), {
      consoleCapture: null as never,
    });
    const resp = await handlers.waitForElementByCondition({
      selector: { id },
      condition: 'clickable',
      timeout_ms: 150,
    });
    return (resp.data as { matched: boolean }).matched;
  }

  it('an option in a closed dropdown: the HTTP click succeeds and both arms say clickable', async () => {
    const option = optionIn(document.body, 'opt-open');
    Object.defineProperty(option.closest('select')!, 'checkVisibility', {
      configurable: true,
      value: () => true,
    });
    const clicked: string[] = [];
    option.addEventListener('click', () => clicked.push('opt-open'));
    const result = (await createActionExecutor(getGlobalRegistry()).executeAction('opt-open', {
      action: 'click',
    })) as { success: boolean; error?: string };
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(clicked).toEqual(['opt-open']);
    expect(await serverClickable('opt-open')).toBe(true);
    expect((await relayArm('opt-open', 'clickable')).matched).toBe(true);
  });

  it('an option inside a display:none subtree: the HTTP click is refused and neither arm says clickable', async () => {
    const shell = document.createElement('div');
    shell.style.display = 'none';
    document.body.appendChild(shell);
    optionIn(shell, 'opt-gone');
    const result = (await createActionExecutor(getGlobalRegistry()).executeAction('opt-gone', {
      action: 'click',
    })) as { success: boolean; failureDetails?: { errorCode?: string; visibilityReason?: string } };
    expect(result.success).toBe(false);
    expect(result.failureDetails?.errorCode).toBe('UB-ELEM-NOT-VISIBLE');
    expect(result.failureDetails?.visibilityReason).toBe('hidden');
    expect(await serverClickable('opt-gone')).toBe(false);
    expect((await relayArm('opt-gone', 'clickable')).matched).toBe(false);
  });

  /** Every arm refuses `id`: both `clickable` waits, the relay gate, the HTTP click. */
  async function refusedEverywhere(id: string): Promise<void> {
    expect(await serverClickable(id)).toBe(false);
    expect((await relayArm(id, 'clickable')).matched).toBe(false);
    const relay = (await executeCommand(
      'executeElementAction',
      { id, request: { action: 'click' } },
      emptyBridge
    )) as { success: boolean; error?: string };
    expect(relay.success).toBe(false);
    expect(relay.error).toContain('not visible');
    const http = (await createActionExecutor(getGlobalRegistry()).executeAction(id, {
      action: 'click',
    })) as { success: boolean; failureDetails?: { errorCode?: string } };
    expect(http.success).toBe(false);
    expect(http.failureDetails?.errorCode).toBe('UB-ELEM-NOT-VISIBLE');
  }

  function visibleSelect(option: HTMLOptionElement): void {
    Object.defineProperty(option.closest('select')!, 'checkVisibility', {
      configurable: true,
      value: () => true,
    });
  }

  it('an <option hidden> placeholder is refused on every arm, though its select is rendered', async () => {
    const option = optionIn(document.body, 'opt-hidden');
    option.hidden = true;
    visibleSelect(option);
    await refusedEverywhere('opt-hidden');
  });

  it('a visibility:hidden option is refused on every arm', async () => {
    const option = optionIn(document.body, 'opt-vh');
    option.style.visibility = 'hidden';
    visibleSelect(option);
    await refusedEverywhere('opt-vh');
  });

  it('an option inside a display:none <optgroup> is refused on every arm', async () => {
    const select = document.createElement('select');
    const group = document.createElement('optgroup');
    group.style.display = 'none';
    const option = document.createElement('option');
    option.textContent = 'Grouped';
    group.appendChild(option);
    select.appendChild(group);
    document.body.appendChild(select);
    Object.defineProperty(option, 'checkVisibility', { configurable: true, value: () => false });
    Object.defineProperty(select, 'checkVisibility', { configurable: true, value: () => true });
    getGlobalRegistry().registerElement('opt-group', option, { type: 'button', label: 'g' });
    await refusedEverywhere('opt-group');
  });

  it('a control inside a closed <details> is still refused', () => {
    const details = document.createElement('details');
    const inside = document.createElement('button');
    details.appendChild(inside);
    document.body.appendChild(details);
    Object.defineProperty(inside, 'checkVisibility', { configurable: true, value: () => false });
    expect(getClickVisibilityReason(inside)).toBe('hidden');
  });
});
