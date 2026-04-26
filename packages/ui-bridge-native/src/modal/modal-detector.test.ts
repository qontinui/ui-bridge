import { describe, it, expect, beforeEach } from 'vitest';
import { ModalDetector } from './modal-detector';

describe('ModalDetector', () => {
  let detector: ModalDetector;

  beforeEach(() => {
    detector = new ModalDetector();
  });

  it('returns an empty context when nothing is pushed', () => {
    const ctx = detector.getSnapshotModalContext();
    expect(ctx.count).toBe(0);
    expect(ctx.hasBlockingModal).toBe(false);
    expect(ctx.modals).toEqual([]);
    expect(ctx.topModal).toBeUndefined();
    expect('topModal' in ctx).toBe(false);
  });

  it('records a single push and exposes it as topModal', () => {
    detector.pushModal({ id: 'confirm', title: 'Confirm action' });
    const ctx = detector.getSnapshotModalContext();
    expect(ctx.count).toBe(1);
    expect(ctx.modals).toHaveLength(1);
    expect(ctx.modals[0].id).toBe('confirm');
    expect(ctx.modals[0].title).toBe('Confirm action');
    expect(ctx.modals[0].type).toBe('modal');
    expect(ctx.modals[0].blocking).toBe(true);
    expect(ctx.modals[0].dismissible).toBe(true);
    expect(ctx.topModal?.id).toBe('confirm');
    expect(ctx.hasBlockingModal).toBe(true);
  });

  it('orders multiple modals by detectedAt and reports the latest as topModal', async () => {
    detector.pushModal({ id: 'first' });
    // Force the second push to land on a strictly later millisecond
    await new Promise((resolve) => setTimeout(resolve, 2));
    detector.pushModal({ id: 'second' });

    const active = detector.getActive();
    expect(active.map((m) => m.id)).toEqual(['first', 'second']);
    expect(active[0].detectedAt).toBeLessThanOrEqual(active[1].detectedAt);

    const ctx = detector.getSnapshotModalContext();
    expect(ctx.topModal?.id).toBe('second');
    expect(ctx.count).toBe(2);
  });

  it('is idempotent on repeat-push by id and preserves the original detectedAt', async () => {
    detector.pushModal({ id: 'confirm', title: 'First' });
    const firstDetectedAt = detector.getActive()[0].detectedAt;

    await new Promise((resolve) => setTimeout(resolve, 2));
    detector.pushModal({ id: 'confirm', title: 'Updated' });

    const active = detector.getActive();
    expect(active).toHaveLength(1);
    expect(active[0].detectedAt).toBe(firstDetectedAt);
    expect(active[0].title).toBe('Updated');
  });

  it('marks hasBlockingModal=false when only non-blocking modals are present', () => {
    detector.pushModal({ id: 'toast-like', blocking: false });
    const ctx = detector.getSnapshotModalContext();
    expect(ctx.count).toBe(1);
    expect(ctx.hasBlockingModal).toBe(false);
    expect(ctx.topModal?.id).toBe('toast-like');
  });

  it('reports hasBlockingModal=true when any active modal is blocking', () => {
    detector.pushModal({ id: 'a', blocking: false });
    detector.pushModal({ id: 'b', blocking: true });
    const ctx = detector.getSnapshotModalContext();
    expect(ctx.hasBlockingModal).toBe(true);
  });

  it('removes a modal via dismissModal and updates topModal', async () => {
    detector.pushModal({ id: 'first' });
    await new Promise((resolve) => setTimeout(resolve, 2));
    detector.pushModal({ id: 'second' });

    detector.dismissModal('second');

    const ctx = detector.getSnapshotModalContext();
    expect(ctx.count).toBe(1);
    expect(ctx.modals.map((m) => m.id)).toEqual(['first']);
    expect(ctx.topModal?.id).toBe('first');
  });

  it('treats dismissModal of an unknown id as a no-op', () => {
    detector.pushModal({ id: 'only' });
    detector.dismissModal('does-not-exist');
    expect(detector.getActive()).toHaveLength(1);
    expect(detector.getActive()[0].id).toBe('only');
  });

  it('clears the entire stack', () => {
    detector.pushModal({ id: 'a' });
    detector.pushModal({ id: 'b' });
    detector.clear();
    const ctx = detector.getSnapshotModalContext();
    expect(ctx.count).toBe(0);
    expect(ctx.modals).toEqual([]);
    expect(ctx.topModal).toBeUndefined();
    expect(ctx.hasBlockingModal).toBe(false);
  });
});
