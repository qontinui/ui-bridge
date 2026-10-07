/**
 * Relay `drag` → the shared drag sequence.
 *
 * The React command-handler path (`executeElementAction`, the one the Tauri
 * runner drives) used to dispatch ONLY HTML5 drag events, so a pointer- or
 * mouse-driven drag no-oped there while the HTTP executor drove it. It now
 * calls `performDragSequence`, like the HTTP path.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { executeCommand, type BridgeAccess } from './commandHandlers';
import { getGlobalRegistry } from '../core/registry';

// jsdom ships no PointerEvent. A minimal MouseEvent subclass is enough for the
// sequence's `typeof PointerEvent === 'function'` gate, so the pointer half is
// exercised here instead of skipped.
if (typeof globalThis.PointerEvent !== 'function') {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? '';
      this.isPrimary = init.isPrimary ?? false;
    }
  }
  (globalThis as { PointerEvent?: unknown }).PointerEvent = PointerEventPolyfill;
}

const emptyBridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
};

describe('relay drag → pointer + mouse sequence', () => {
  let handle: HTMLDivElement;

  beforeEach(() => {
    handle = document.createElement('div');
    // The relay's visibility gate checks offsetParent, which jsdom reports
    // as null for every element.
    Object.defineProperty(handle, 'offsetParent', {
      configurable: true,
      get: () => document.body,
    });
    document.body.appendChild(handle);
    getGlobalRegistry().registerElement('el-handle', handle, { type: 'generic' });
  });

  afterEach(() => {
    handle.remove();
    getGlobalRegistry().clear();
  });

  it('drives a pointer-event drag handler', async () => {
    const order: string[] = [];
    for (const t of ['pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mouseup']) {
      document.addEventListener(t, () => order.push(t));
    }

    const result = (await executeCommand(
      'executeElementAction',
      {
        id: 'el-handle',
        request: {
          action: 'drag',
          params: { targetPosition: { x: 200, y: 120 }, steps: 2, holdDelay: 0, releaseDelay: 0 },
        },
      },
      emptyBridge
    )) as { success?: boolean; error?: string };

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(order.filter((t) => t === 'pointermove')).toHaveLength(2);
    expect(order.indexOf('pointerdown')).toBeLessThan(order.indexOf('mousedown'));
    expect(order.lastIndexOf('pointerup')).toBeLessThan(order.lastIndexOf('mouseup'));
    expect(order).toContain('mousedown');
    expect(order).toContain('mouseup');
  });
});
