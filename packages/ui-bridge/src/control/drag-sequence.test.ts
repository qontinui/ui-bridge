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
    readonly pressure: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pressure = init.pressure ?? 0;
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

  it('waits stepDelay after every move, including before the drop hit-test', async () => {
    const t0 = performance.now();
    await run({ stepDelay: 40 });
    // 3 steps → 3 waits. A version that skipped the last one (~80ms) fails.
    expect(performance.now() - t0).toBeGreaterThanOrEqual(115);
  });

  it('marks moves as "no button changed" and held pointers with default pressure', async () => {
    const pointers: PointerEvent[] = [];
    const grab = (e: Event) => pointers.push(e as PointerEvent);
    for (const t of ['pointerdown', 'pointermove', 'pointerup']) document.addEventListener(t, grab);
    try {
      await run();
    } finally {
      for (const t of ['pointerdown', 'pointermove', 'pointerup'])
        document.removeEventListener(t, grab);
    }
    for (const e of pointers) {
      expect(e.button).toBe(e.type === 'pointermove' ? -1 : 0);
      expect(e.pressure).toBe(e.type === 'pointerup' ? 0 : 0.5);
    }
  });

  it('falls back to the named target element, not the source, when the hit-test answers nothing', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const upOn: EventTarget[] = [];
    const lastMoveOn: EventTarget[] = [];
    const onUp = (e: Event) => upOn.push(e.target as EventTarget);
    const onMove = (e: Event) => lastMoveOn.push(e.target as EventTarget);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('mousemove', onMove);
    try {
      await performDragSequence(
        source,
        { target: { elementId: 'x' }, steps: 1, holdDelay: 0, releaseDelay: 0 },
        () => target
      );
    } finally {
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('mousemove', onMove);
      target.remove();
    }
    expect(upOn).toEqual([target]);
    // steps: 1 → the only move is the last one, which arrives on the target.
    expect(lastMoveOn).toEqual([target]);
  });

  it('rejects a drag with neither target nor targetPosition', async () => {
    await expect(performDragSequence(source, {}, () => null)).rejects.toThrow(
      'Drag requires either target or targetPosition'
    );
  });
});
