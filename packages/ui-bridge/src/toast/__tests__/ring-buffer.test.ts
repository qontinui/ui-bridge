/**
 * ToastRingBuffer tests.
 *
 * Covers emit → getSince readback, TTL eviction, size-cap eviction, and
 * subscriber delivery.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToastRingBuffer } from '../ring-buffer';

describe('ToastRingBuffer', () => {
  let clockMs: number;
  let now: () => number;

  beforeEach(() => {
    clockMs = 1_700_000_000_000;
    now = () => clockMs;
  });

  it('emit() adds an entry retrievable via getSince()', () => {
    const buf = new ToastRingBuffer({ now });
    const entry = buf.emit({ message: 'hello', kind: 'info' });
    expect(entry.message).toBe('hello');
    expect(entry.kind).toBe('info');
    expect(entry.timestamp).toBe(clockMs);
    expect(entry.id).toBeTruthy();

    const since = buf.getSince(0);
    expect(since).toHaveLength(1);
    expect(since[0].message).toBe('hello');
  });

  it('getSince(ts) filters strictly-before entries and sorts newest-first', () => {
    const buf = new ToastRingBuffer({ now });
    clockMs = 1000;
    buf.emit({ message: 'old', kind: 'info' });
    clockMs = 2000;
    buf.emit({ message: 'mid', kind: 'success' });
    clockMs = 3000;
    buf.emit({ message: 'new', kind: 'error' });

    const since = buf.getSince(2000);
    expect(since.map((e) => e.message)).toEqual(['new', 'mid']);
  });

  it('honors provided id on emit', () => {
    const buf = new ToastRingBuffer({ now });
    buf.emit({ id: 'custom-id', message: 'x', kind: 'info' });
    expect(buf.getSince(0)[0].id).toBe('custom-id');
  });

  it('evicts entries past the TTL', () => {
    const buf = new ToastRingBuffer({ now, ttlMs: 5000 });
    clockMs = 0;
    buf.emit({ message: 'very old', kind: 'info' });
    clockMs = 10_000; // now 10s, TTL is 5s → entry should be gone
    expect(buf.size()).toBe(0);
    expect(buf.getSince(0)).toHaveLength(0);
  });

  it('evicts oldest entries once past maxEntries (ring-buffer behavior)', () => {
    const buf = new ToastRingBuffer({ now, maxEntries: 3 });
    clockMs = 1000;
    buf.emit({ message: 'one', kind: 'info' });
    clockMs = 2000;
    buf.emit({ message: 'two', kind: 'info' });
    clockMs = 3000;
    buf.emit({ message: 'three', kind: 'info' });
    clockMs = 4000;
    buf.emit({ message: 'four', kind: 'info' });

    // Oldest evicted; only three, four, ... well three survives since the
    // cap is 3 — we emit 4 total, so 'one' should be gone.
    const all = buf.getAll();
    expect(all).toHaveLength(3);
    expect(all.map((e) => e.message)).toEqual(['two', 'three', 'four']);
  });

  it('getSince() limit truncates to most-recent entries', () => {
    const buf = new ToastRingBuffer({ now });
    for (let i = 0; i < 5; i++) {
      clockMs = 1000 + i;
      buf.emit({ message: `msg-${i}`, kind: 'info' });
    }
    const top2 = buf.getSince(0, 2);
    expect(top2.map((e) => e.message)).toEqual(['msg-4', 'msg-3']);
  });

  it('markDismissed() stamps dismissedAt on the matching entry only', () => {
    const buf = new ToastRingBuffer({ now });
    clockMs = 1000;
    const first = buf.emit({ message: 'a', kind: 'info' });
    const second = buf.emit({ message: 'b', kind: 'info' });

    clockMs = 5000;
    buf.markDismissed(first.id);

    const all = buf.getAll();
    const aEntry = all.find((e) => e.id === first.id);
    const bEntry = all.find((e) => e.id === second.id);
    expect(aEntry?.dismissedAt).toBe(5000);
    expect(bEntry?.dismissedAt).toBeUndefined();
  });

  it('markDismissed() is idempotent on repeat calls', () => {
    const buf = new ToastRingBuffer({ now });
    const entry = buf.emit({ message: 'a', kind: 'info' });
    clockMs = 2000;
    buf.markDismissed(entry.id);
    clockMs = 3000;
    buf.markDismissed(entry.id); // second call is a no-op
    expect(buf.getAll()[0].dismissedAt).toBe(2000);
  });

  it('markDismissed() on unknown id is a no-op', () => {
    const buf = new ToastRingBuffer({ now });
    buf.emit({ message: 'a', kind: 'info' });
    buf.markDismissed('no-such-id');
    expect(buf.getAll()[0].dismissedAt).toBeUndefined();
  });

  it('subscribe() receives callbacks on emit and markDismissed', () => {
    const buf = new ToastRingBuffer({ now });
    const cb = vi.fn();
    const unsubscribe = buf.subscribe(cb);

    buf.emit({ message: 'a', kind: 'info' });
    expect(cb).toHaveBeenCalledTimes(1);

    const entry = buf.emit({ message: 'b', kind: 'info' });
    expect(cb).toHaveBeenCalledTimes(2);

    buf.markDismissed(entry.id);
    expect(cb).toHaveBeenCalledTimes(3);

    unsubscribe();
    buf.emit({ message: 'c', kind: 'info' });
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it('subscriber errors do not break the buffer', () => {
    const buf = new ToastRingBuffer({ now });
    buf.subscribe(() => {
      throw new Error('boom');
    });
    // Should not throw
    expect(() => buf.emit({ message: 'a', kind: 'info' })).not.toThrow();
    expect(buf.size()).toBe(1);
  });

  it('clear() drops all entries', () => {
    const buf = new ToastRingBuffer({ now });
    buf.emit({ message: 'a', kind: 'info' });
    buf.emit({ message: 'b', kind: 'info' });
    expect(buf.size()).toBe(2);
    buf.clear();
    expect(buf.size()).toBe(0);
    expect(buf.getAll()).toHaveLength(0);
  });
});
