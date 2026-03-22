/**
 * ChangeObserver Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ChangeObserver } from './change-observer';
import type { DOMChangeEvent } from './change-observer';

describe('ChangeObserver', () => {
  let observer: ChangeObserver;

  beforeEach(() => {
    vi.useFakeTimers();
    observer = new ChangeObserver({ batchIntervalMs: 16, bufferCapacity: 5000 });
  });

  afterEach(() => {
    observer.destroy();
    vi.useRealTimers();
  });

  // ==========================================================================
  // Batching
  // ==========================================================================

  describe('batching', () => {
    it('batches events within the batch interval', () => {
      const received: DOMChangeEvent[] = [];
      observer.subscribe((e) => received.push(e));

      observer.onElementAdded('el-1');
      observer.onElementAdded('el-2');
      observer.onElementModified('el-3');

      // Events should not be emitted yet
      expect(received).toHaveLength(0);

      // Advance timer past the batch interval
      vi.advanceTimersByTime(20);

      // Now a single batched event should arrive
      expect(received).toHaveLength(1);
      expect(received[0].type).toBe('subtreeChanged');
      expect(received[0].added).toEqual(['el-1', 'el-2']);
      expect(received[0].modified).toEqual(['el-3']);
      expect(received[0].removed).toEqual([]);
    });

    it('does not emit if no changes accumulated', () => {
      const received: DOMChangeEvent[] = [];
      observer.subscribe((e) => received.push(e));

      vi.advanceTimersByTime(100);

      expect(received).toHaveLength(0);
    });

    it('batches multiple intervals independently', () => {
      const received: DOMChangeEvent[] = [];
      observer.subscribe((e) => received.push(e));

      observer.onElementAdded('el-1');
      vi.advanceTimersByTime(20);
      expect(received).toHaveLength(1);

      observer.onElementRemoved('el-2');
      vi.advanceTimersByTime(20);
      expect(received).toHaveLength(2);
      expect(received[1].removed).toEqual(['el-2']);
    });
  });

  // ==========================================================================
  // Coalescing
  // ==========================================================================

  describe('coalescing', () => {
    it('cancels removal if element is re-added in same batch', () => {
      const received: DOMChangeEvent[] = [];
      observer.subscribe((e) => received.push(e));

      observer.onElementRemoved('el-1');
      observer.onElementAdded('el-1'); // re-added — cancels removal, becomes an add

      vi.advanceTimersByTime(20);

      // Removal is cancelled, element appears as added (re-registered)
      expect(received).toHaveLength(1);
      expect(received[0].removed).toEqual([]);
      expect(received[0].added).toEqual(['el-1']);
    });

    it('cancels addition if element is removed in same batch', () => {
      const received: DOMChangeEvent[] = [];
      observer.subscribe((e) => received.push(e));

      observer.onElementAdded('el-1');
      observer.onElementRemoved('el-1'); // removed right after add

      vi.advanceTimersByTime(20);

      // Net effect is nothing
      expect(received).toHaveLength(0);
    });

    it('does not track modification for elements being added', () => {
      const received: DOMChangeEvent[] = [];
      observer.subscribe((e) => received.push(e));

      observer.onElementAdded('el-1');
      observer.onElementModified('el-1'); // already in add set

      vi.advanceTimersByTime(20);

      expect(received).toHaveLength(1);
      expect(received[0].added).toEqual(['el-1']);
      expect(received[0].modified).toEqual([]); // not double-counted
    });

    it('does not track modification for elements being removed', () => {
      const received: DOMChangeEvent[] = [];
      observer.subscribe((e) => received.push(e));

      observer.onElementRemoved('el-1');
      observer.onElementModified('el-1'); // already in remove set

      vi.advanceTimersByTime(20);

      expect(received).toHaveLength(1);
      expect(received[0].removed).toEqual(['el-1']);
      expect(received[0].modified).toEqual([]); // not double-counted
    });
  });

  // ==========================================================================
  // Ring Buffer
  // ==========================================================================

  describe('ring buffer', () => {
    it('stores events in buffer', () => {
      observer.onElementAdded('el-1');
      vi.advanceTimersByTime(20);

      expect(observer.bufferSize).toBe(1);
    });

    it('retrieves events since timestamp', () => {
      const now = Date.now();
      observer.onElementAdded('el-1');
      vi.advanceTimersByTime(20);

      const events = observer.getEventsSince(now - 1);
      expect(events).toHaveLength(1);
      expect(events[0].added).toEqual(['el-1']);
    });

    it('filters events by timestamp', () => {
      observer.onElementAdded('el-1');
      vi.advanceTimersByTime(20);

      const futureEvents = observer.getEventsSince(Date.now() + 1000);
      expect(futureEvents).toHaveLength(0);
    });

    it('drops oldest events when buffer overflows', () => {
      const smallObserver = new ChangeObserver({ bufferCapacity: 3, batchIntervalMs: 16 });

      // Fill buffer with 5 events
      for (let i = 0; i < 5; i++) {
        smallObserver.onElementAdded(`el-${i}`);
        vi.advanceTimersByTime(20);
      }

      expect(smallObserver.bufferSize).toBe(3);

      // Should contain the 3 most recent events
      const events = smallObserver.getEventsSince(0);
      expect(events).toHaveLength(3);
      expect(events[0].added).toEqual(['el-2']);
      expect(events[2].added).toEqual(['el-4']);

      smallObserver.destroy();
    });

    it('respects limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        observer.onElementAdded(`el-${i}`);
        vi.advanceTimersByTime(20);
      }

      const events = observer.getEventsSince(0, 3);
      expect(events).toHaveLength(3);
    });
  });

  // ==========================================================================
  // Subscription
  // ==========================================================================

  describe('subscription', () => {
    it('multiple subscribers receive the same event', () => {
      const received1: DOMChangeEvent[] = [];
      const received2: DOMChangeEvent[] = [];

      observer.subscribe((e) => received1.push(e));
      observer.subscribe((e) => received2.push(e));

      observer.onElementAdded('el-1');
      vi.advanceTimersByTime(20);

      expect(received1).toHaveLength(1);
      expect(received2).toHaveLength(1);
    });

    it('unsubscribe stops receiving events', () => {
      const received: DOMChangeEvent[] = [];
      const unsub = observer.subscribe((e) => received.push(e));

      observer.onElementAdded('el-1');
      vi.advanceTimersByTime(20);
      expect(received).toHaveLength(1);

      unsub(); // unsubscribe

      observer.onElementAdded('el-2');
      vi.advanceTimersByTime(20);
      expect(received).toHaveLength(1); // no new events
    });

    it('tracks subscriber count', () => {
      expect(observer.subscriberCount).toBe(0);

      const unsub1 = observer.subscribe(() => {});
      expect(observer.subscriberCount).toBe(1);

      const unsub2 = observer.subscribe(() => {});
      expect(observer.subscriberCount).toBe(2);

      unsub1();
      expect(observer.subscriberCount).toBe(1);

      unsub2();
      expect(observer.subscriberCount).toBe(0);
    });

    it('subscriber errors do not affect other subscribers', () => {
      const received: DOMChangeEvent[] = [];

      observer.subscribe(() => {
        throw new Error('bad subscriber');
      });
      observer.subscribe((e) => received.push(e));

      observer.onElementAdded('el-1');
      vi.advanceTimersByTime(20);

      // Second subscriber should still receive the event
      expect(received).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  describe('destroy', () => {
    it('clears all state', () => {
      observer.subscribe(() => {});
      observer.onElementAdded('el-1');
      vi.advanceTimersByTime(20);

      observer.destroy();

      expect(observer.subscriberCount).toBe(0);
      expect(observer.bufferSize).toBe(0);
    });

    it('cancels pending batch timer', () => {
      const received: DOMChangeEvent[] = [];
      observer.subscribe((e) => received.push(e));

      observer.onElementAdded('el-1');
      observer.destroy();

      vi.advanceTimersByTime(100);
      expect(received).toHaveLength(0); // timer was cancelled
    });
  });
});
