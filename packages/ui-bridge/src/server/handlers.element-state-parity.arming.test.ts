/**
 * ARMING — plan `2026-11-08-ui-bridge-element-state-has-two-readers-and-no-aria-busy`,
 * Phase 1.
 *
 * Enters where the in-process transports enter: `createHandlers`'
 * `executeElementAction`, the seam `server/standalone.ts`, `server/express.ts`
 * and `server/nextjs.ts` serve `POST /control/element/:id/action` through, and
 * which hands the request to `DefaultActionExecutor`.
 *
 * The executor used to wait on a private `ElementState` reader whose `visible`
 * was occlusion-blind, so `waitOptions: { visible: true }` on a button under a
 * full-cover overlay passed at once while every snapshot reported that button
 * `visible: false`. It now reads the canonical reader (`core/element-state`),
 * so the wait times out and the response carries the canonical
 * `visibilityReason`; with the overlay gone, the same request succeeds.
 *
 * jsdom has neither layout nor `elementFromPoint`; both are stubbed as in
 * `core/__tests__/registry.occlusion.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHandlers, type RegistryLike } from './handlers';
import { UIBridgeRegistry } from '../core/registry';
import { DefaultActionExecutor } from '../control/action-executor';
import type { ControlActionResponse } from '../control/types';

interface Box {
  el: HTMLElement;
  rect: { x: number; y: number; w: number; h: number };
}

let boxes: Box[] = [];
const realElementFromPoint = document.elementFromPoint;

function withBox<T extends HTMLElement>(el: T, x: number, y: number, w: number, h: number): T {
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
  boxes.push({ el, rect: { x, y, w, h } });
  return el;
}

let registry: UIBridgeRegistry;
let handlers: ReturnType<typeof createHandlers>;
let overlay: HTMLDivElement;

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

  registry = new UIBridgeRegistry();
  const executor = new DefaultActionExecutor(registry);
  handlers = createHandlers(registry as unknown as RegistryLike, executor as never);

  const button = document.createElement('button');
  button.textContent = 'Save';
  document.body.appendChild(withBox(button, 100, 100, 80, 24));
  overlay = document.createElement('div');
  overlay.setAttribute('data-ui-bridge-id', 'modal-scrim');
  overlay.style.position = 'absolute';
  document.body.appendChild(withBox(overlay, 0, 0, 1280, 720));
  registry.registerElement('save', button, { type: 'button', actions: ['blur'] });
});

afterEach(() => {
  document.elementFromPoint = realElementFromPoint;
  document.body.innerHTML = '';
});

describe('POST /control/element/:id/action waitOptions read the canonical ElementState', () => {
  it('times out on an occluded button, with visibilityReason: occluded in the response state', async () => {
    const response = await handlers.executeElementAction('save', {
      action: 'blur',
      waitOptions: { visible: true, timeout: 200 },
    });
    const data = response.data as ControlActionResponse;

    expect(data.success).toBe(false);
    expect(data.error).toBe('Timeout waiting for conditions after 200ms');
    expect(data.failureDetails?.errorCode).toBe('UB-ACTION-TIMEOUT');
    expect(data.waitDurationMs).toBeGreaterThanOrEqual(200);
    expect(data.elementState?.visible).toBe(false);
    expect(data.elementState?.visibilityReason).toBe('occluded');
    expect(data.elementState?.occludedBy).toBe('modal-scrim');
    expect(data.elementState?.occludedPct).toBe(100);
    // The snapshot taken right after reports the same verdict.
    const entry = registry.createSnapshot().elements.find((e) => e.id === 'save');
    expect(entry?.state.visible).toBe(false);
    expect(entry?.state.visibilityReason).toBe('occluded');
  });

  it('succeeds once the overlay is removed', async () => {
    overlay.remove();
    const response = await handlers.executeElementAction('save', {
      action: 'blur',
      waitOptions: { visible: true, timeout: 200 },
    });
    const data = response.data as ControlActionResponse;

    expect(data.success, data.error).toBe(true);
    expect(data.elementState?.visible).toBe(true);
    expect(data.elementState?.visibilityReason).toBeUndefined();
    expect(data.elementState?.occludedBy).toBeUndefined();
  });
});
