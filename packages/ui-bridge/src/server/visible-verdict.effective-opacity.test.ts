/**
 * An ancestor at `opacity: 0` makes the canonical visibility verdict false —
 * plan 2026-10-22-ui-bridge-hover-forces-the-css-hover-state, Phase 5d.
 *
 * The verdict is `computeVisibilityVerdict` (core/element-state.ts); every
 * consumer below reads it, and each is pinned here so a consumer that grows its
 * own opacity read cannot drift. The control inside an `opacity-0` container
 * (qontinui-web `group-hover:opacity-100` toolbars) has its OWN opacity at 1,
 * so before 5d every consumer called it visible while it drew nothing.
 *
 * What does NOT change, pinned too: `opacityHidden` is own-opacity only,
 * `isRenderedForAction` and the `clickable` condition stay opacity-blind
 * (a styled file input at opacity 0 still takes input), and the occlusion
 * sweep reads `occludedBy` only. jsdom does not cascade stylesheets, so
 * opacity is INLINE; it has no layout or `elementFromPoint`, so both are
 * stubbed as in `visible-verdict.find-by-text-and-wait.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findByTextPrimitive } from './page-primitives';
import { createHandlers, type RegistryLike } from './handlers';
import { executeCommand, type BridgeAccess } from '../react/commandHandlers';
import { getGlobalRegistry, resetGlobalRegistry } from '../core/registry';
import { createActionExecutor } from '../control/action-executor';
import { applyCanonicalFindFilter } from '../core/find-filter';
import {
  getElementState,
  isRenderedForAction,
  readElementVisibility,
  withVisibilityPass,
} from '../core/element-state';
import { buildVisibilityReport } from './visibility-report';

interface Box {
  el: HTMLElement;
  rect: { x: number; y: number; w: number; h: number };
}

/** Later in this array = painted on top. */
let boxes: Box[] = [];
const realElementFromPoint = document.elementFromPoint;

function place<T extends HTMLElement>(el: T, x: number, y: number, w: number, h: number): T {
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
  boxes.push({ el, rect: { x, y, w, h } });
  return el;
}

/** A container at `opacity`, holding one button whose OWN opacity is 1. */
function mountGroup(id: string, containerOpacity: string, text: string, y: number): void {
  const wrap = document.createElement('div');
  wrap.id = `${id}-wrap`;
  wrap.style.opacity = containerOpacity;
  const btn = document.createElement('button');
  btn.id = id;
  btn.textContent = text;
  wrap.appendChild(btn);
  document.body.appendChild(wrap);
  place(wrap, 0, y, 100, 30);
  place(btn, 0, y, 80, 24);
}

function mountPage(): void {
  mountGroup('faded', '0', 'Act faded', 0);
  mountGroup('half', '0.5', 'Act half', 50);
  mountGroup('clear', '1', 'Act clear', 100);
  const own = document.createElement('button');
  own.id = 'own';
  own.textContent = 'Act own';
  own.style.opacity = '0';
  document.body.appendChild(own);
  place(own, 0, 150, 80, 24);
}

const node = (id: string): HTMLElement => document.getElementById(id)!;

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
      if (px >= rect.x && px < rect.x + rect.w && py >= rect.y && py < rect.y + rect.h) return el;
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

function registerAll(): void {
  const registry = getGlobalRegistry();
  for (const id of ['faded', 'half', 'clear', 'own']) {
    registry.registerElement(id, node(id), { type: 'button', label: id });
  }
}

describe('the verdict', () => {
  it('getElementState rows: faded container -> hidden; half and clear -> visible; opacityHidden stays own-only', () => {
    const faded = getElementState(node('faded'));
    expect(faded.visible).toBe(false);
    expect(faded.visibilityReason).toBe('hidden');
    expect(faded.opacityHidden).toBeUndefined();
    expect(getElementState(node('half')).visible).toBe(true);
    expect(getElementState(node('clear')).visible).toBe(true);
    // The control's own opacity 0 still sets opacityHidden.
    expect(getElementState(node('own'))).toMatchObject({ visible: false, opacityHidden: true });
  });

  it('readElementVisibility agrees, and the verdict flips once the container is revealed', () => {
    expect(readElementVisibility(node('faded'))).toMatchObject({
      visible: false,
      visibilityReason: 'hidden',
    });
    node('faded-wrap').style.opacity = '1';
    expect(readElementVisibility(node('faded')).visible).toBe(true);
  });

  it('a registered row reports it: getState() and the snapshot entry', () => {
    registerAll();
    const registry = getGlobalRegistry();
    expect(registry.getElement('faded')!.getState().visible).toBe(false);
    expect(registry.getElement('faded')!.getState().visibilityReason).toBe('hidden');
    const snap = registry.createSnapshot();
    const row = snap.elements.find((e) => e.id === 'faded')!;
    // Only `state.visible` changes. The row's top-level `visible` is a bbox hint.
    expect(row.state.visible).toBe(false);
    expect(snap.elements.find((e) => e.id === 'half')!.state.visible).toBe(true);
  });
});

describe('the consumers of the verdict', () => {
  it('find-filter include_hidden:false (live-node rows) drops the faded-container control only', () => {
    const rows = ['faded', 'half', 'clear'].map((id) => ({ id, label: id, element: node(id) }));
    const kept = applyCanonicalFindFilter(rows, { include_hidden: false }).map((r) => r.id);
    expect(kept).toEqual(['half', 'clear']);
  });

  it('findByText per-hit visible', () => {
    const result = findByTextPrimitive('Act', {});
    expect(result.ok).toBe(true);
    const byText = Object.fromEntries(
      (result.ok ? result.data : []).map((hit) => [hit.text, hit.visible])
    );
    expect(byText).toMatchObject({ 'Act faded': false, 'Act half': true, 'Act clear': true });
  });

  it('the executor waitFor visible option', async () => {
    registerAll();
    const executor = createActionExecutor(getGlobalRegistry());
    expect((await executor.waitFor('faded', { visible: true, timeout: 120 })).met).toBe(false);
    expect((await executor.waitFor('half', { visible: true, timeout: 120 })).met).toBe(true);
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

function handlers() {
  return createHandlers(
    registryLike(),
    {
      executeAction: async () => ({ success: true }),
      executeComponentAction: async () => ({ success: true }),
    } as never,
    { consoleCapture: null as never }
  );
}

type Condition = 'visible' | 'clickable';
const arms: Array<
  [string, (selector: Record<string, string>, c: Condition) => Promise<{ matched: boolean }>]
> = [
  [
    'server/handlers.ts',
    async (selector, condition) => {
      const resp = await handlers().waitForElementByCondition({
        selector,
        condition,
        timeout_ms: 120,
      });
      return resp.data as { matched: boolean };
    },
  ],
  [
    'react/commandHandlers.ts',
    async (selector, condition) =>
      (await executeCommand(
        'waitForElementByCondition',
        { selector, condition, timeout_ms: 120 },
        emptyBridge
      )) as { matched: boolean },
  ],
];

describe.each(arms)('waitForElementByCondition (%s)', (_name, arm) => {
  beforeEach(registerAll);

  it('visible: the faded-container control never matches; the half-faded one does', async () => {
    expect((await arm({ id: 'faded' }, 'visible')).matched).toBe(false);
    expect((await arm({ id: 'half' }, 'visible')).matched).toBe(true);
  });

  it('clickable stays opacity-blind: the faded-container control is clickable', async () => {
    expect((await arm({ id: 'faded' }, 'clickable')).matched).toBe(true);
  });
});

describe.each([
  [
    'server/handlers.ts',
    async (predicate: Record<string, string>) => {
      const resp = await handlers().waitForElementRegistered({
        predicate,
        requirement: 'visible',
        timeoutMs: 120,
      });
      return resp.data as { element?: { id: string } };
    },
  ],
  [
    'react/commandHandlers.ts',
    async (predicate: Record<string, string>) =>
      (await executeCommand(
        'waitForElementRegistered',
        { predicate, requirement: 'visible', timeoutMs: 120 },
        emptyBridge
      )) as { element?: { id: string } },
  ],
])('waitForElementRegistered visible (%s)', (_name, arm) => {
  it('registered: the faded-container control times out; the half-faded one resolves', async () => {
    registerAll();
    expect((await arm({ id: 'faded' })).element).toBeUndefined();
    expect((await arm({ id: 'half' })).element?.id).toBe('half');
  });
});

describe('waitForElementRegistered visible, server DOM-selector fallback', () => {
  it('an unregistered faded-container node times out; the half-faded one resolves', async () => {
    const wait = async (selector: string) =>
      (
        (await handlers().waitForElementRegistered({
          predicate: { selector },
          requirement: 'visible',
          timeoutMs: 120,
        })) as { data: { element?: { id: string } } }
      ).data;
    expect((await wait('#faded')).element).toBeUndefined();
    expect((await wait('#half')).element?.id).toBe('half');
  });
});

describe('what the verdict leaves alone', () => {
  it('isRenderedForAction stays opacity-blind: the faded-container control is rendered', () => {
    expect(isRenderedForAction(node('faded'))).toBe(true);
  });

  it('the occlusion sweep reads occludedBy only: a faded-container control is hidden, not occluded', () => {
    const state = getElementState(node('faded'));
    expect(state.occludedBy).toBeUndefined();
    const report = buildVisibilityReport({
      elements: [{ id: 'faded', occludedBy: state.occludedBy, occludedPct: state.occludedPct }],
    });
    expect(report.occlusions).toEqual([]);
  });
});

describe('the verdict is cheap across a pass', () => {
  it('a visibility pass reads each ancestor once; without one it re-walks per element; own opacity is not re-read', () => {
    const host = document.createElement('div');
    host.style.opacity = '0.5';
    document.body.appendChild(host);
    place(host, 0, 300, 400, 400);
    const kids = Array.from({ length: 10 }, (_, i) => {
      const b = document.createElement('button');
      b.textContent = `k${i}`;
      host.appendChild(b);
      return place(b, 0, 300 + i * 30, 80, 24);
    });
    const spy = vi.spyOn(window, 'getComputedStyle');
    const countFor = (run: () => void): number => {
      spy.mockClear();
      run();
      return spy.mock.calls.length;
    };
    const unscoped = countFor(() => kids.forEach((k) => readElementVisibility(k)));
    const scoped = countFor(() =>
      withVisibilityPass(() => kids.forEach((k) => readElementVisibility(k)))
    );
    spy.mockRestore();
    // Per kid: one layout read of its own style. Ancestors (host, body, html): once per pass.
    expect(scoped).toBe(kids.length + 3);
    expect(unscoped).toBeGreaterThan(scoped);
    expect(kids.every((k) => readElementVisibility(k).visible)).toBe(true);
  });

  it('a cheap own check short-circuits: an own opacity 0 never walks the ancestors', () => {
    const spy = vi.spyOn(window, 'getComputedStyle');
    spy.mockClear();
    readElementVisibility(node('own'));
    const n = spy.mock.calls.length;
    spy.mockRestore();
    expect(n).toBe(1);
  });
});
