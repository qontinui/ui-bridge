import { describe, it, expect, beforeEach } from 'vitest';
import { ElementEventLog } from './element-event-log';
import type { BridgeEvent, BridgeEventType } from '../core/types';

function makeEvent(
  type: BridgeEventType,
  data: Record<string, unknown>,
  timestamp = Date.now()
): BridgeEvent {
  return { type, timestamp, data };
}

describe('ElementEventLog', () => {
  let log: ElementEventLog;

  beforeEach(() => {
    log = new ElementEventLog({ maxEntries: 100, defaultLogLevel: 'error' });
  });

  describe('ingest', () => {
    it('captures error-level events by default', () => {
      log.ingest(makeEvent('action:failed', { elementId: 'btn-1', error: 'timeout' }));
      const history = log.getHistory('btn-1');
      expect(history).toHaveLength(1);
      expect(history[0].level).toBe('error');
      expect(history[0].elementId).toBe('btn-1');
    });

    it('skips info-level events when default is error', () => {
      log.ingest(makeEvent('action:started', { elementId: 'btn-1', action: 'click' }));
      expect(log.getHistory('btn-1')).toHaveLength(0);
    });

    it('skips debug-level events when default is error', () => {
      log.ingest(makeEvent('element:registered', { id: 'btn-1' }));
      expect(log.getHistory('btn-1')).toHaveLength(0);
    });

    it('skips events without element ID', () => {
      log.ingest(makeEvent('app:idle', {}));
      expect(log.getStats().totalEntries).toBe(0);
    });

    it('extracts element ID from data.id for registration events', () => {
      log = new ElementEventLog({ defaultLogLevel: 'debug' });
      log.ingest(makeEvent('element:registered', { id: 'my-el' }));
      expect(log.getHistory('my-el')).toHaveLength(1);
    });

    it('extracts element ID from data.elementId for action events', () => {
      log.ingest(makeEvent('action:failed', { elementId: 'btn-2', error: 'err' }));
      expect(log.getHistory('btn-2')).toHaveLength(1);
    });
  });

  describe('level gating with overrides', () => {
    it('captures info events when element override is info', () => {
      log.setElementLogLevel('btn-1', 'info');
      log.ingest(makeEvent('action:started', { elementId: 'btn-1', action: 'click' }));
      expect(log.getHistory('btn-1')).toHaveLength(1);
    });

    it('captures debug events when element override is debug', () => {
      log.setElementLogLevel('btn-1', 'debug');
      log.ingest(makeEvent('element:registered', { id: 'btn-1' }));
      expect(log.getHistory('btn-1')).toHaveLength(1);
    });

    it('captures nothing when override is silent', () => {
      log.setElementLogLevel('btn-1', 'silent');
      log.ingest(makeEvent('action:failed', { elementId: 'btn-1', error: 'err' }));
      expect(log.getHistory('btn-1')).toHaveLength(0);
    });

    it('falls back to global default after removeElement', () => {
      log.setElementLogLevel('btn-1', 'debug');
      log.removeElement('btn-1');
      // info should be skipped now (default is 'error')
      log.ingest(makeEvent('action:started', { elementId: 'btn-1', action: 'click' }));
      expect(log.getHistory('btn-1')).toHaveLength(0);
    });
  });

  describe('buffer eviction', () => {
    it('evicts oldest entries when buffer exceeds maxEntries', () => {
      const smallLog = new ElementEventLog({ maxEntries: 5, defaultLogLevel: 'error' });
      for (let i = 0; i < 10; i++) {
        smallLog.ingest(
          makeEvent('action:failed', { elementId: `el-${i}`, error: 'err' }, 1000 + i)
        );
      }
      const stats = smallLog.getStats();
      expect(stats.totalEntries).toBe(5);
      expect(stats.oldestTimestamp).toBe(1005);
    });

    it('FIFO eviction removes entries from other elements', () => {
      const smallLog = new ElementEventLog({ maxEntries: 3, defaultLogLevel: 'error' });
      smallLog.ingest(makeEvent('action:failed', { elementId: 'a', error: 'err' }, 1));
      smallLog.ingest(makeEvent('action:failed', { elementId: 'b', error: 'err' }, 2));
      smallLog.ingest(makeEvent('action:failed', { elementId: 'c', error: 'err' }, 3));
      smallLog.ingest(makeEvent('action:failed', { elementId: 'd', error: 'err' }, 4));
      // 'a' should be evicted
      expect(smallLog.getHistory('a')).toHaveLength(0);
      expect(smallLog.getHistory('d')).toHaveLength(1);
    });
  });

  describe('getHistory', () => {
    beforeEach(() => {
      log = new ElementEventLog({ maxEntries: 100, defaultLogLevel: 'debug' });
      log.ingest(makeEvent('element:registered', { id: 'btn-1' }, 100));
      log.ingest(makeEvent('action:started', { elementId: 'btn-1', action: 'click' }, 200));
      log.ingest(makeEvent('action:completed', { elementId: 'btn-1', action: 'click' }, 300));
      log.ingest(makeEvent('action:failed', { elementId: 'btn-1', error: 'err' }, 400));
      log.ingest(makeEvent('action:failed', { elementId: 'other', error: 'err' }, 250));
    });

    it('returns only entries for the requested element', () => {
      const history = log.getHistory('btn-1');
      expect(history).toHaveLength(4);
      expect(history.every((e) => e.elementId === 'btn-1')).toBe(true);
    });

    it('filters by eventTypes', () => {
      const history = log.getHistory('btn-1', { eventTypes: ['action:failed'] });
      expect(history).toHaveLength(1);
      expect(history[0].eventType).toBe('action:failed');
    });

    it('filters by minLevel', () => {
      const history = log.getHistory('btn-1', { minLevel: 'error' });
      expect(history).toHaveLength(1);
      expect(history[0].level).toBe('error');
    });

    it('filters by since', () => {
      const history = log.getHistory('btn-1', { since: 250 });
      expect(history).toHaveLength(2);
    });

    it('respects limit', () => {
      const history = log.getHistory('btn-1', { limit: 2 });
      expect(history).toHaveLength(2);
    });

    it('returns in ascending order by default', () => {
      const history = log.getHistory('btn-1');
      for (let i = 1; i < history.length; i++) {
        expect(history[i].timestamp).toBeGreaterThanOrEqual(history[i - 1].timestamp);
      }
    });

    it('returns in descending order when requested', () => {
      const history = log.getHistory('btn-1', { order: 'desc' });
      for (let i = 1; i < history.length; i++) {
        expect(history[i].timestamp).toBeLessThanOrEqual(history[i - 1].timestamp);
      }
    });

    it('returns desc with limit (most recent first)', () => {
      const history = log.getHistory('btn-1', { order: 'desc', limit: 2 });
      expect(history).toHaveLength(2);
      expect(history[0].timestamp).toBe(400);
      expect(history[1].timestamp).toBe(300);
    });
  });

  describe('getStats', () => {
    it('returns correct stats', () => {
      log = new ElementEventLog({ maxEntries: 100, defaultLogLevel: 'debug' });
      log.ingest(makeEvent('element:registered', { id: 'a' }, 10));
      log.ingest(makeEvent('element:registered', { id: 'b' }, 20));
      log.ingest(makeEvent('action:started', { elementId: 'a', action: 'click' }, 30));

      const stats = log.getStats();
      expect(stats.totalEntries).toBe(3);
      expect(stats.uniqueElements).toBe(2);
      expect(stats.oldestTimestamp).toBe(10);
    });

    it('returns null oldestTimestamp when empty', () => {
      expect(log.getStats().oldestTimestamp).toBeNull();
    });
  });

  describe('clear', () => {
    it('clears all entries and overrides', () => {
      log.setElementLogLevel('btn-1', 'debug');
      log.ingest(makeEvent('action:failed', { elementId: 'btn-1', error: 'err' }));
      log.clear();
      expect(log.getStats().totalEntries).toBe(0);
      expect(log.getElementLogLevel('btn-1')).toBe('error'); // back to global default
    });
  });

  describe('event classification', () => {
    beforeEach(() => {
      log = new ElementEventLog({ maxEntries: 100, defaultLogLevel: 'debug' });
    });

    it('classifies browser:error as error', () => {
      log.ingest(makeEvent('browser:error', { elementId: 'x' }));
      expect(log.getHistory('x')[0].level).toBe('error');
    });

    it('classifies browser:crash as error', () => {
      log.ingest(makeEvent('browser:crash', { elementId: 'x' }));
      expect(log.getHistory('x')[0].level).toBe('error');
    });

    it('classifies workflow:failed as error', () => {
      log.ingest(makeEvent('workflow:failed', { elementId: 'x' }));
      expect(log.getHistory('x')[0].level).toBe('error');
    });

    it('classifies action:completed as info', () => {
      log.ingest(makeEvent('action:completed', { elementId: 'x', action: 'click' }));
      expect(log.getHistory('x')[0].level).toBe('info');
    });

    it('classifies element:stateChanged as info', () => {
      log.ingest(makeEvent('element:stateChanged', { elementId: 'x' }));
      expect(log.getHistory('x')[0].level).toBe('info');
    });

    it('classifies element:registered as debug', () => {
      log.ingest(makeEvent('element:registered', { id: 'x' }));
      expect(log.getHistory('x')[0].level).toBe('debug');
    });

    it('classifies element:unregistered as debug', () => {
      log.ingest(makeEvent('element:unregistered', { id: 'x' }));
      expect(log.getHistory('x')[0].level).toBe('debug');
    });
  });

  describe('memory budget', () => {
    it('handles 10k events without exceeding buffer cap', () => {
      const capped = new ElementEventLog({ maxEntries: 500, defaultLogLevel: 'error' });
      for (let i = 0; i < 10000; i++) {
        capped.ingest(makeEvent('action:failed', { elementId: `el-${i % 500}`, error: 'err' }, i));
      }
      expect(capped.getStats().totalEntries).toBe(500);
    });
  });
});
