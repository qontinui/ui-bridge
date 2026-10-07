/**
 * Drag sequence — pointer events alongside mouse events.
 *
 * Drag code written against Pointer Events (React `onPointerDown` /
 * `onPointerMove`, dnd-kit, the runner's zone minimap) never sees a
 * mouse-only sequence, so `drag` used to silently no-op on it. These pin that
 * each step now emits a pointer event before its mouse twin, with the
 * primary-button `buttons` mask a real browser sets while the button is held.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { performDragSequence } from './drag-sequence';

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

describe('performDragSequence', () => {
  let source: HTMLDivElement;
  const seen: { type: string; buttons: number; pointer: boolean }[] = [];
  const types = [
    'pointerdown',
    'mousedown',
    'pointermove',
    'mousemove',
    'pointerup',
    'mouseup',
  ] as const;
  const record = (e: Event) =>
    seen.push({
      type: e.type,
      buttons: (e as MouseEvent).buttons,
      pointer: e instanceof PointerEvent,
    });

  beforeEach(() => {
    seen.length = 0;
    source = document.createElement('div');
    document.body.appendChild(source);
    for (const t of types) document.addEventListener(t, record);
  });

  afterEach(() => {
    for (const t of types) document.removeEventListener(t, record);
    source.remove();
  });

  const run = (extra: Record<string, unknown> = {}) =>
    performDragSequence(
      source,
      { targetPosition: { x: 100, y: 50 }, steps: 3, holdDelay: 0, releaseDelay: 0, ...extra },
      () => null
    );

  it('emits each pointer event before its mouse twin', async () => {
    await run();
    expect(seen.map((e) => e.type)).toEqual([
      'pointerdown',
      'mousedown',
      'pointermove',
      'mousemove',
      'pointermove',
      'mousemove',
      'pointermove',
      'mousemove',
      'pointerup',
      'mouseup',
    ]);
    expect(seen.filter((e) => e.type.startsWith('pointer')).every((e) => e.pointer)).toBe(true);
  });

  it('holds the primary button through down and moves, releases it on up', async () => {
    await run();
    for (const e of seen) {
      expect(e.buttons).toBe(e.type.endsWith('up') ? 0 : 1);
    }
  });

  it('still emits the full mouse sequence (existing mouse-driven drags unaffected)', async () => {
    await run();
    const mouse = seen.filter((e) => e.type.startsWith('mouse')).map((e) => e.type);
    expect(mouse).toEqual(['mousedown', 'mousemove', 'mousemove', 'mousemove', 'mouseup']);
  });

  it('waits stepDelay between moves but not after the last one', async () => {
    const t0 = performance.now();
    await run({ stepDelay: 40 });
    // 3 steps → 2 inter-step waits.
    expect(performance.now() - t0).toBeGreaterThanOrEqual(75);
  });

  it('rejects a drag with neither target nor targetPosition', async () => {
    await expect(performDragSequence(source, {}, () => null)).rejects.toThrow(
      'Drag requires either target or targetPosition'
    );
  });
});
