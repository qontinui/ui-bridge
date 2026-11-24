/**
 * The render-log capture over the canonical `ElementState` reader — plan
 * `2026-11-08-ui-bridge-element-state-has-two-readers-and-no-aria-busy`, Phase 1.
 *
 * 1. The capture filter is the canonical `state.visible`. With the DEFAULT
 *    `includeHidden: false`, an occluded element and an `opacity: 0` element
 *    are dropped, while an `aria-hidden="true"` element with a box is kept
 *    (aria-hidden is an a11y-tree fact, not a visibility one). The render
 *    log's old private `isVisible` dropped aria-hidden and kept occluded.
 * 2. The capture is bounded: the projected `state.textContent` is truncated to
 *    `maxTextLength` exactly as the top-level `textContent` is.
 *
 * jsdom has neither layout nor `elementFromPoint`; both are stubbed as in
 * `core/__tests__/registry.occlusion.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { captureDOMSnapshot } from './dom-capture';

interface Box {
  el: HTMLElement;
  rect: { x: number; y: number; w: number; h: number };
}

/** Later in this array = painted on top. */
let boxes: Box[] = [];
const realElementFromPoint = document.elementFromPoint;

function place(testId: string, x: number, y: number, w: number, h: number): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-testid', testId);
  el.textContent = testId;
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
  document.body.appendChild(el);
  boxes.push({ el, rect: { x, y, w, h } });
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

function capturedTestIds(): Array<string | undefined> {
  return captureDOMSnapshot()
    .elements.map((e) => e.identifier.testId)
    .filter((id) => id !== undefined);
}

describe('captureDOMSnapshot — the default capture filter is the canonical visible', () => {
  it('drops occluded and opacity-0 elements, keeps aria-hidden and plain visible ones', () => {
    place('visible', 0, 0, 80, 24);
    place('occluded', 100, 0, 80, 24);
    const faded = place('faded', 200, 0, 80, 24);
    faded.style.opacity = '0';
    const ariaHidden = place('aria-hidden', 300, 0, 80, 24);
    ariaHidden.setAttribute('aria-hidden', 'true');
    // Painted last: covers every sample point of `occluded`.
    place('cover', 90, 0, 100, 40);

    expect(capturedTestIds()).toEqual(['visible', 'aria-hidden', 'cover']);
  });
});

describe('captureDOMSnapshot — one accessible name per captured element', () => {
  // Plan `2026-11-23-ui-bridge-element-state-collapse-follow-ups`, D2. The
  // top-level `accessibleName` came from a private chain that read
  // `aria-label` BEFORE `aria-labelledby`, the reverse of the W3C order the
  // canonical reader follows, so the two fields disagreed on this element.
  it('top-level accessibleName equals state.accessibleName for an aria-labelledby name', () => {
    const label = place('label', 0, 100, 120, 24);
    label.id = 'save-label';
    label.textContent = 'Save draft';
    const btn = place('save', 0, 0, 80, 24);
    btn.setAttribute('role', 'button');
    btn.setAttribute('aria-labelledby', 'save-label');
    btn.setAttribute('aria-label', 'Close');

    const captured = captureDOMSnapshot().elements.find((e) => e.identifier.testId === 'save')!;

    expect(captured.state.accessibleName).toBe('Save draft');
    expect(captured.accessibleName).toBe('Save draft');
  });

  it('leaves the top-level accessibleName absent when the canonical name is empty', () => {
    // No attribute, id or text at all: no rung of the canonical chain names it.
    const bare = document.createElement('section');
    bare.getBoundingClientRect = () =>
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
    document.body.appendChild(bare);
    boxes.push({ el: bare, rect: { x: 0, y: 0, w: 80, h: 24 } });

    const captured = captureDOMSnapshot().elements.find((e) => e.tagName === 'section')!;
    expect(captured.state.accessibleName).toBeFalsy();
    expect(captured).not.toHaveProperty('accessibleName', '');
    expect(captured.accessibleName).toBeUndefined();
  });
});

describe('captureDOMSnapshot — the projected state is bounded by maxTextLength', () => {
  it('truncates state.textContent exactly as the top-level textContent', () => {
    const el = place('long', 0, 0, 600, 40);
    el.textContent = 'abcdefghij'.repeat(30);

    const captured = captureDOMSnapshot({ maxTextLength: 20 }).elements.find(
      (e) => e.identifier.testId === 'long'
    )!;

    expect(captured.textContent).toBe('abcdefghijabcdefghij...');
    expect(captured.state.textContent).toBe('abcdefghijabcdefghij...');
  });

  it('leaves text within maxTextLength untouched', () => {
    place('short', 0, 0, 80, 24);
    const captured = captureDOMSnapshot({ maxTextLength: 20 }).elements.find(
      (e) => e.identifier.testId === 'short'
    )!;
    expect(captured.textContent).toBe('short');
    expect(captured.state.textContent).toBe('short');
  });
});
