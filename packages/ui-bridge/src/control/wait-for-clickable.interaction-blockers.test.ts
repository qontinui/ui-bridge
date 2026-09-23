/**
 * The wait-for-element `clickable` condition agrees with the click path.
 *
 * Both implementations — the standalone server handler
 * (`server/handlers.ts` `waitForElementByCondition`) and the browser-side
 * relay dispatcher (`react/commandHandlers.ts` `waitForElementByCondition`) —
 * used to inline `!disabled && aria-disabled !== 'true'`, so a control under a
 * `pointer-events: none` ancestor read `clickable` while the very next click
 * was refused. Both now read `core/a11y`'s
 * `!isInteractionBlocked(readInteractionBlockers(el))` (plan
 * 2026-08-23-single-source-derived-facts, 12a).
 *
 * Each arm is pinned in BOTH directions: the blocked control must NOT match,
 * and a plain control MUST match (the negative control — a condition that
 * answered "not clickable" for everything would pass every blocked case).
 *
 * jsdom has no layout: `offsetParent` is always `null` and every rect is
 * zero, which the `clickable` condition's visibility prelude would read as
 * "not visible". The fixtures stub both so the test isolates the
 * interaction-blocker half of the predicate.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { executeCommand, type BridgeAccess } from '../react/commandHandlers';
import { createHandlers, type RegistryLike } from '../server/handlers';
import { getGlobalRegistry, resetGlobalRegistry } from '../core/registry';

beforeAll(() => {
  if (typeof document !== 'undefined' && !document.elementFromPoint) {
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => null,
    });
  }
});

const emptyBridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
};

function makeRegistryLike(): RegistryLike {
  const reg = getGlobalRegistry();
  return {
    getAllElements: () => reg.getAllElements(),
    getElement: (id) => reg.getElement(id),
    getAllComponents: () => reg.getAllComponents(),
    getComponent: (id) => reg.getComponent(id),
    getComponentState: (id) => reg.getComponentState?.(id) ?? null,
    createSnapshot: () => reg.createSnapshot() as ReturnType<RegistryLike['createSnapshot']>,
  };
}

/** Give a jsdom element the layout the visibility prelude requires. */
function laidOut<T extends HTMLElement>(el: T): T {
  Object.defineProperty(el, 'offsetParent', {
    configurable: true,
    get: () => el.parentElement,
  });
  el.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      width: 80,
      height: 24,
      top: 0,
      left: 0,
      right: 80,
      bottom: 24,
      toJSON: () => ({}),
    }) as DOMRect;
  return el;
}

type WaitResult = { matched: boolean };
type Arm = (id: string) => Promise<WaitResult>;

const serverArm: Arm = async (id) => {
  const handlers = createHandlers(
    makeRegistryLike(),
    {
      executeAction: async () => ({ success: true }),
      executeComponentAction: async () => ({ success: true }),
    } as never,
    { consoleCapture: null as never }
  );
  const resp = await handlers.waitForElementByCondition({
    selector: { id },
    condition: 'clickable',
    timeout_ms: 150,
  });
  expect(resp.success).toBe(true);
  return resp.data as WaitResult;
};

const relayArm: Arm = async (id) =>
  (await executeCommand(
    'waitForElementByCondition',
    { selector: { id }, condition: 'clickable', timeout_ms: 150 },
    emptyBridge
  )) as WaitResult;

describe.each([
  ['server/handlers.ts', serverArm],
  ['react/commandHandlers.ts', relayArm],
])('waitForElementByCondition · clickable (%s)', (_name, arm) => {
  let container: HTMLDivElement;

  beforeEach(() => {
    resetGlobalRegistry();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    resetGlobalRegistry();
  });

  it('a plain control is clickable (negative control)', async () => {
    const btn = laidOut(document.createElement('button'));
    container.appendChild(btn);
    getGlobalRegistry().registerElement('plain', btn, { label: 'plain' });

    expect((await arm('plain')).matched).toBe(true);
  });

  it('a control under a pointer-events:none parent is NOT clickable', async () => {
    const wrap = document.createElement('div');
    wrap.style.pointerEvents = 'none';
    container.appendChild(wrap);
    const btn = laidOut(document.createElement('button'));
    wrap.appendChild(btn);
    // The button declares nothing itself — only the inherited computed value
    // blocks it, which is what the click path refuses on.
    expect(btn.style.pointerEvents).toBe('');
    getGlobalRegistry().registerElement('pe-ancestor', btn, { label: 'pe-ancestor' });

    expect((await arm('pe-ancestor')).matched).toBe(false);
  });

  it('a natively disabled control is NOT clickable (pre-existing behaviour)', async () => {
    const btn = laidOut(document.createElement('button'));
    btn.disabled = true;
    container.appendChild(btn);
    getGlobalRegistry().registerElement('native', btn, { label: 'native' });

    expect((await arm('native')).matched).toBe(false);
  });
});
