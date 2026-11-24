/**
 * `findByText`'s `visible` and the wait-for-element `visible` / `clickable`
 * conditions read the canonical visibility verdict — follow-up fb196aa0 of
 * plan `2026-11-24-ui-bridge-find-visibility-and-fallback-label-read-the-canonical-verdicts`.
 *
 * `findByTextPrimitive` computed `visible` as `offsetParent !== null ||
 * position === 'fixed'` (a sixth algorithm), and both
 * `waitForElementByCondition` arms gated `visible` / `clickable` on
 * `offsetParent !== null` plus a non-zero rect. All three now read
 * `readElementVisibility(el).visible` (`core/element-state`), so an occluded or
 * off-screen element is not visible there, exactly as every row reports it.
 *
 * jsdom has neither layout, `offsetParent` nor `elementFromPoint`; all three
 * are stubbed as in `dom-fallback.visible.test.ts`. `offsetParent` is set on
 * every placed node, so each old check would have answered visible.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findByTextPrimitive } from './page-primitives';
import { createHandlers, type RegistryLike } from './handlers';
import { executeCommand, type BridgeAccess } from '../react/commandHandlers';
import { getGlobalRegistry, resetGlobalRegistry } from '../core/registry';

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

describe('server wait-for-element-condition visible reads the materialized row', () => {
  it("an off-screen element whose registry state reports visible:true matches (no second hit-test overrides the row's own state)", async () => {
    const registry = getGlobalRegistry();
    registry.registerElement('below', document.getElementById('below')!, {
      type: 'button',
      label: 'below',
    });
    // The post-action overlay the row reports through getState().
    registry.refreshElement('below', { visible: true });
    expect((await serverArm('below', 'visible')).matched).toBe(true);
  });
});

/**
 * The wait-for-elements `visible` requirement's live-node fallback — it ran
 * whenever a row carried no serialized verdict (every server registry row,
 * and a React row with no tracked `visible`) and read `offsetParent` plus a
 * non-zero rect. It now reads the canonical verdict.
 */
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
