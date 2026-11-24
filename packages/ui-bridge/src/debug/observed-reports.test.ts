import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetObservedReportsForTest,
  consumeObservedReport,
  elementReportKey,
  recordObservedReport,
  statusReportKey,
} from './observed-reports';

beforeEach(() => __resetObservedReportsForTest());

describe('observed reports', () => {
  it('keys on the redacted absolute URL', () => {
    expect(statusReportKey('https://a.example/x?token=1#f', 503)).toBe(
      statusReportKey('https://a.example/x', 503)
    );
    expect(elementReportKey('https://a.example/i.png?v=2', 'IMG')).toBe(
      elementReportKey('https://a.example/i.png', 'img')
    );
    expect(statusReportKey('https://a.example/x', 503)).not.toBe(
      statusReportKey('https://a.example/x', 500)
    );
  });

  it('matches a report inside [startTime - 100, responseEnd + 5000], once', () => {
    const key = statusReportKey('https://a.example/x', 503);
    const entry = { startTime: 10_000, responseEnd: 20_000 };
    recordObservedReport(key, 10_000 - 100);
    expect(consumeObservedReport(key, entry)).toBe(true);
    // Consumed once.
    expect(consumeObservedReport(key, entry)).toBe(false);
    recordObservedReport(key, 20_000 + 5_000);
    expect(consumeObservedReport(key, entry)).toBe(true);
    recordObservedReport(key, 15_000);
    expect(consumeObservedReport(key, entry)).toBe(true);
  });

  it('a report outside the interval matches nothing and stays unconsumed', () => {
    const key = statusReportKey('https://a.example/x', 503);
    const entry = { startTime: 10_000, responseEnd: 20_000 };
    recordObservedReport(key, 10_000 - 101);
    expect(consumeObservedReport(key, entry)).toBe(false);
    // Still there for the request it belongs to.
    expect(consumeObservedReport(key, { startTime: 9_899, responseEnd: 9_950 })).toBe(true);
    recordObservedReport(key, 20_000 + 5_001);
    expect(consumeObservedReport(key, entry)).toBe(false);
  });

  it('a report taken 1 ms before the entry start matches', () => {
    const key = statusReportKey('https://a.example/x', 503);
    recordObservedReport(key, 9_999);
    expect(consumeObservedReport(key, { startTime: 10_000, responseEnd: 10_005 })).toBe(true);
  });

  it('is a bounded ring: the oldest report is evicted', () => {
    const entry = { startTime: 1_000, responseEnd: 1_000 };
    for (let i = 0; i <= 200; i++) {
      recordObservedReport(statusReportKey(`https://a.example/${i}`, 500), 1_000);
    }
    expect(consumeObservedReport(statusReportKey('https://a.example/0', 500), entry)).toBe(false);
    expect(consumeObservedReport(statusReportKey('https://a.example/1', 500), entry)).toBe(true);
  });
});
