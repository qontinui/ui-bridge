import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToastCapture } from './toast-capture';

describe('ToastCapture', () => {
  let capture: ToastCapture;

  beforeEach(() => {
    capture = new ToastCapture();
  });

  it('starts empty', () => {
    const ctx = capture.getSnapshotToastContext();
    expect(ctx.active).toEqual([]);
    expect(ctx.recent).toEqual([]);
    expect(ctx.totalCaptured).toBe(0);
  });

  it('records a toast as active and increments totalCaptured', () => {
    capture.recordToast({ id: 't1', message: 'Saved' });
    const ctx = capture.getSnapshotToastContext();
    expect(ctx.active).toHaveLength(1);
    expect(ctx.active[0].id).toBe('t1');
    expect(ctx.active[0].message).toBe('Saved');
    expect(ctx.active[0].visible).toBe(true);
    expect(ctx.active[0].level).toBe('info');
    expect(ctx.totalCaptured).toBe(1);
  });

  it('is idempotent on repeat record with the same id while still active', () => {
    capture.recordToast({ id: 't1', message: 'first' });
    capture.recordToast({ id: 't1', message: 'second' });
    const ctx = capture.getSnapshotToastContext();
    expect(ctx.active).toHaveLength(1);
    expect(ctx.active[0].message).toBe('first');
    expect(ctx.totalCaptured).toBe(1);
  });

  it('moves dismissed toasts from active to recent and sets dismissedAt + visible=false', () => {
    capture.recordToast({ id: 't1', message: 'Saved' });
    capture.dismissToast('t1');
    const ctx = capture.getSnapshotToastContext();
    expect(ctx.active).toHaveLength(0);
    expect(ctx.recent).toHaveLength(1);
    expect(ctx.recent[0].id).toBe('t1');
    expect(ctx.recent[0].visible).toBe(false);
    expect(ctx.recent[0].dismissedAt).toBeTypeOf('number');
  });

  it('computes durationMs on dismiss using elapsed time', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(1_000_000));
      capture.recordToast({ id: 't1', message: 'hi' });
      vi.setSystemTime(new Date(1_000_000 + 2500));
      capture.dismissToast('t1');
      const ctx = capture.getSnapshotToastContext();
      expect(ctx.recent[0].durationMs).toBe(2500);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports current durationMs for active toasts on each snapshot', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2_000_000));
      capture.recordToast({ id: 't1', message: 'still up' });
      vi.setSystemTime(new Date(2_000_000 + 750));
      const ctx = capture.getSnapshotToastContext();
      expect(ctx.active[0].durationMs).toBe(750);
    } finally {
      vi.useRealTimers();
    }
  });

  it('honors the ring buffer cap and drops the oldest dismissed toast (FIFO)', () => {
    const ringed = new ToastCapture({ maxRecent: 3 });
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      ringed.recordToast({ id, message: id });
      ringed.dismissToast(id);
    }
    const ctx = ringed.getSnapshotToastContext();
    expect(ctx.recent).toHaveLength(3);
    expect(ctx.recent.map((t) => t.id)).toEqual(['c', 'd', 'e']);
    expect(ctx.totalCaptured).toBe(5);
  });

  it('treats dismissToast for an unknown id as a no-op', () => {
    capture.dismissToast('does-not-exist');
    const ctx = capture.getSnapshotToastContext();
    expect(ctx.active).toHaveLength(0);
    expect(ctx.recent).toHaveLength(0);
    expect(ctx.totalCaptured).toBe(0);
  });

  it('defaults maxRecent to 50', () => {
    const big = new ToastCapture();
    for (let i = 0; i < 60; i += 1) {
      big.recordToast({ id: `t${i}`, message: `m${i}` });
      big.dismissToast(`t${i}`);
    }
    const ctx = big.getSnapshotToastContext();
    expect(ctx.recent).toHaveLength(50);
    expect(ctx.recent[0].id).toBe('t10');
    expect(ctx.recent[49].id).toBe('t59');
    expect(ctx.totalCaptured).toBe(60);
  });

  it('clear() empties both buffers and resets totalCaptured', () => {
    capture.recordToast({ id: 't1', message: 'a' });
    capture.recordToast({ id: 't2', message: 'b' });
    capture.dismissToast('t1');
    capture.clear();
    const ctx = capture.getSnapshotToastContext();
    expect(ctx.active).toEqual([]);
    expect(ctx.recent).toEqual([]);
    expect(ctx.totalCaptured).toBe(0);
  });
});
