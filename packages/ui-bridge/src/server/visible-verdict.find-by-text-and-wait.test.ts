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

  it.each<Condition>(['visible', 'clickable'])(
    '%s: an occluded or off-screen element never matches; a clear one does',
    async (condition) => {
      expect((await arm('covered', condition)).matched).toBe(false);
      expect((await arm('below', condition)).matched).toBe(false);
      expect((await arm('clear', condition)).matched).toBe(true);
    }
  );
});
