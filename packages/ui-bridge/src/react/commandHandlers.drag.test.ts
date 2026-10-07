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
// jsdom ships no DragEvent either; without one the sequence skips its HTML5
// half and the relay path's `html5` default could not be observed.
if (typeof globalThis.DragEvent !== 'function') {
  class DragEventPolyfill extends MouseEvent {}
  (globalThis as { DragEvent?: unknown }).DragEvent = DragEventPolyfill;
}
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
  // Every document listener a test adds is bound to this, so none leaks into
  // the next test.
  let listeners: AbortController;

  beforeEach(() => {
    listeners = new AbortController();
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
    listeners.abort();
    handle.remove();
    getGlobalRegistry().clear();
  });

  it('drives a pointer-event drag handler', async () => {
    const order: string[] = [];
    for (const t of ['pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mouseup']) {
      document.addEventListener(t, () => order.push(t), { signal: listeners.signal });
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

  it('keeps emitting HTML5 drag events by default and drops on a targetId', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    getGlobalRegistry().registerElement('el-target', target, { type: 'generic' });
    const html5: string[] = [];
    let dropOn: EventTarget | null = null;
    for (const t of ['dragstart', 'dragover', 'drop', 'dragend']) {
      document.addEventListener(
        t,
        (e) => {
          html5.push(t);
          if (t === 'drop') dropOn = e.target;
        },
        { signal: listeners.signal }
      );
    }
    try {
      const result = (await executeCommand(
        'executeElementAction',
        {
          id: 'el-handle',
          request: {
            action: 'drag',
            params: { targetId: 'el-target', steps: 1, holdDelay: 0, releaseDelay: 0 },
          },
        },
        emptyBridge
      )) as { success?: boolean; error?: string };
      expect(result.error).toBeUndefined();
      expect(result.success).toBe(true);
    } finally {
      target.remove();
    }
    expect(html5).toEqual(['dragstart', 'dragover', 'drop', 'dragend']);
    // jsdom has no elementFromPoint, so this is the named-target fallback.
    expect(dropOn).toBe(target);
  });

  it('html5: false suppresses the HTML5 events', async () => {
    const html5: string[] = [];
    for (const t of ['dragstart', 'drop'])
      document.addEventListener(t, () => html5.push(t), { signal: listeners.signal });
    await executeCommand(
      'executeElementAction',
      {
        id: 'el-handle',
        request: {
          action: 'drag',
          params: {
            targetPosition: { x: 5, y: 5 },
            steps: 1,
            holdDelay: 0,
            releaseDelay: 0,
            html5: false,
          },
        },
      },
      emptyBridge
    );
    expect(html5).toEqual([]);
  });

  it('fails honestly — not a silent success — when there is nothing to drag to', async () => {
    const result = (await executeCommand(
      'executeElementAction',
      { id: 'el-handle', request: { action: 'drag', params: { holdDelay: 0, releaseDelay: 0 } } },
      emptyBridge
    )) as { success?: boolean; error?: string };
    expect(result.success).toBe(false);
    expect(result.error).toContain('Drag requires either target or targetPosition');
  });
});
