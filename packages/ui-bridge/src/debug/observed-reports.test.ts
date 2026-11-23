import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetObservedReportsForTest,
  consumeObservedReport,
  elementReportKey,
  OBSERVED_REPORT_LIMIT,
  OBSERVED_REPORT_TTL_MS,
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

  it('consumes each report once, within the TTL', () => {
    const key = statusReportKey('https://a.example/x', 503);
    recordObservedReport(key, 1_000);
    expect(consumeObservedReport(key, 1_000 + OBSERVED_REPORT_TTL_MS)).toBe(true);
    expect(consumeObservedReport(key, 1_001)).toBe(false);
    recordObservedReport(key, 1_000);
    expect(consumeObservedReport(key, 1_001 + OBSERVED_REPORT_TTL_MS)).toBe(false);
  });

  it('is a bounded ring: the oldest report is evicted', () => {
    for (let i = 0; i <= OBSERVED_REPORT_LIMIT; i++) {
      recordObservedReport(statusReportKey(`https://a.example/${i}`, 500), 1_000);
    }
    expect(consumeObservedReport(statusReportKey('https://a.example/0', 500), 1_000)).toBe(false);
    expect(consumeObservedReport(statusReportKey('https://a.example/1', 500), 1_000)).toBe(true);
  });
});
