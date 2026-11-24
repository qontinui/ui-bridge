/**
 * The DOM-fallback scan reports the canonical `visible` — plan
 * `2026-11-23-ui-bridge-element-state-collapse-follow-ups`, D1.
 *
 * The scan used to build its own `visible` from `offsetParent` and size, with
 * no viewport or occlusion arm, so an element under an overlay read
 * `visible: true` here while the registry snapshot read it occluded. Both the
 * top-level `visible` (what `materializeElements` reads once the live ref is
 * dropped) and `state.visible` must carry the one `getElementState` verdict.
 *
 * jsdom has neither layout, `offsetParent` nor `elementFromPoint`; all three
 * are stubbed as in `core/element-state.parity.test.ts`. `offsetParent` is set
 * so the old private algorithm would have answered `true`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { scanDOMForInteractiveElements } from './dom-fallback';

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
  document.body.appendChild(el);
  boxes.push({ el, rect: { x, y, w, h } });
  return el;
}

function button(testId: string): HTMLButtonElement {
  const el = document.createElement('button');
  el.setAttribute('data-testid', testId);
  el.textContent = testId;
  return el;
}

beforeEach(() => {
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
});

afterEach(() => {
  document.elementFromPoint = realElementFromPoint;
  document.body.innerHTML = '';
});

describe('scanDOMForInteractiveElements — the canonical visible', () => {
  it('reads an occluded fallback element as visible: false, reason occluded, on both fields', () => {
    place(button('covered'), 0, 0, 80, 24);
    // Painted last, unregistered and not interactive: covers every sample point.
    const cover = document.createElement('div');
    cover.id = 'toast';
    place(cover, 0, 0, 200, 60);

    const row = scanDOMForInteractiveElements().find((e) => e.identifiers.testId === 'covered')!;

    expect(row.visible).toBe(false);
    expect(row.state.visible).toBe(false);
    expect(row.state.visibilityReason).toBe('occluded');
    expect(row.state.occludedBy).toBe('div#toast');
    expect(row.state.occludedPct).toBe(100);
  });

  it('reads an uncovered fallback element as visible on both fields, with no reason', () => {
    place(button('clear'), 0, 0, 80, 24);

    const row = scanDOMForInteractiveElements().find((e) => e.identifiers.testId === 'clear')!;

    expect(row.visible).toBe(true);
    expect(row.state.visible).toBe(true);
    expect(row.state.visibilityReason).toBeUndefined();
  });
});
