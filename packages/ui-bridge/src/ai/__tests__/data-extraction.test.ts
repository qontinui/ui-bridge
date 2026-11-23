/**
 * `classifyDataType` and `normalizeValue` over literal tables.
 *
 * Plan 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change,
 * Phase 0. Before it, the phone branch ran ahead of the date and number
 * branches and accepted digits with dots, so `16.10.2026` and `2026-10-16`
 * came back as phone numbers; the number branch knew no decimal comma, and
 * `normalizeValue` deleted every comma and parsed dates in local time.
 *
 * Every expected value below is a literal. Each row is one value, so a
 * regression names the value it broke.
 */

import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { classifyDataType, normalizeValue } from '../data-extraction';
import type { DataType } from '../types';

describe('classifyDataType', () => {
  it('a dotted date is a date, never a phone', () => {
    expect(classifyDataType('16.10.2026')).toEqual({ type: 'date', confidence: 0.85 });
  });

  const CLASSIFICATION: Array<[string, DataType]> = [
    // dates
    ['16.10.2026', 'date'],
    ['2026-10-16', 'date'],
    ['16-10-2026', 'date'],
    ['12/31/2026', 'date'],
    ['Oct 16, 2026', 'date'],
    // numbers
    ['1.234,56', 'number'],
    ['1234,56', 'number'],
    ['1,234.56', 'number'],
    ['1,234', 'number'],
    ['1.234', 'number'],
    ['1234567', 'number'],
    ['123456.78', 'number'],
    ['42', 'number'],
    ['-3.5', 'number'],
    // currency
    ['€ 12,50', 'currency'],
    ['1.234,56 €', 'currency'],
    ['$1,234.56', 'currency'],
    // percentage
    ['12,5 %', 'percentage'],
    ['50%', 'percentage'],
    // phone
    ['+49 30 1234567', 'phone'],
    ['(555) 123-4567', 'phone'],
    ['555-123-4567', 'phone'],
    ['555.123.4567', 'phone'],
    // digit groups that only look like a date stay a phone, as before
    ['12-34-5678', 'phone'],
    ['11-12-2345', 'phone'],
    ['31.02.2026', 'phone'],
    ['2026-13-45', 'phone'],
    ['2024-01-15-0042', 'phone'],
    // a word that names no month is no date
    ['Mayo 3, 2026', 'text'],
    // more digits than a double holds exactly is no number
    ['12345678901234567', 'text'],
    // the rest
    ['true', 'boolean'],
    ['a@b.co', 'email'],
    ['https://x.test/', 'url'],
    ['hello world', 'text'],
    ['', 'unknown'],
  ];

  it.each(CLASSIFICATION)('classifies %j as %s', (value, type) => {
    expect(classifyDataType(value).type).toBe(type);
  });
});

describe('normalizeValue', () => {
  const NORMALISATION: Array<[string, DataType, string]> = [
    ['16.10.2026', 'date', '2026-10-16'],
    ['2026-10-16', 'date', '2026-10-16'],
    ['16-10-2026', 'date', '2026-10-16'],
    ['1.234,56', 'number', '1234.56'],
    ['1234,56', 'number', '1234.56'],
    ['1234567', 'number', '1234567'],
    ['123456.78', 'number', '123456.78'],
    ['€ 12,50', 'currency', '12.5'],
    ['12,5 %', 'percentage', '12.5'],
    ['1,234.56', 'number', '1234.56'],
    ['1,234', 'number', '1234'],
    ['1.234', 'number', '1.234'],
    ['12,5', 'number', '12.5'],
    ['1.234,56 €', 'currency', '1234.56'],
    ['(555) 123-4567', 'phone', '5551234567'],
    // two-digit years read as the legacy Date parser read them: 00-49 is 20xx
    ['12/31/26', 'date', '2026-12-31'],
    ['16.10.26', 'date', '2026-10-16'],
    ['Sept 16, 2026', 'date', '2026-09-16'],
    // a leading zero keeps a digit run an id or a phone, zeros intact
    ['0301234567', 'phone', '0301234567'],
    // `0,` cannot start a thousands group, so this is a decimal comma
    ['0,123', 'number', '0.123'],
    // a bare leading decimal point
    ['$.99', 'currency', '0.99'],
    ['.5%', 'percentage', '0.5'],
    // timestamps with a zone name, AM/PM or a spaced offset are their day
    ['2026-10-16 08:00 UTC', 'date', '2026-10-16'],
    ['2026-10-16 8:00 AM', 'date', '2026-10-16'],
    ['2026-10-16 08:00:00 +0000', 'date', '2026-10-16'],
    // a minus sign before the currency symbol
    ['-$5.00', 'currency', '-5'],
    // a slash date whose first field cannot be a month reads day-first
    ['25/12/2026', 'date', '2026-12-25'],
    // Indian (lakh) grouping
    ['1,23,456', 'number', '123456'],
    ['₹12,34,567.50', 'currency', '1234567.5'],
    // distinct ids that begin with the same date stay distinct
    ['2024-01-15-0042', 'phone', '202401150042'],
    // the locale-ambiguous single separators are pinned as a choice: a lone
    // `,` before three digits is thousands, a lone `.` is a decimal point
    // (see 1,234 and 1.234 above), so en-US 1,234 and de-DE 1.234 differ
    // the calendar date as written; a following offset is not applied
    ['2026-10-16T23:30:00-05:00', 'date', '2026-10-16'],
  ];

  it.each(NORMALISATION)('normalises %j (%s) to %j', (value, type, expected) => {
    expect(classifyDataType(value).type).toBe(type);
    expect(normalizeValue(value, type)).toBe(expected);
  });

  // A caller may pass a type for text the classifier would call `text`.
  const CALLER_TYPED: Array<[string, DataType, string]> = [
    ['approx. 5', 'number', '5'],
    ['1,234 (est.)', 'number', '1234'],
    ['USD 12,50', 'currency', '12.5'],
    ['- 5', 'number', '-5'],
    ['approx. -3,5', 'number', '-3.5'],
  ];

  it.each(CALLER_TYPED)('normalises caller-typed %j (%s) to %j', (value, type, expected) => {
    expect(normalizeValue(value, type)).toBe(expected);
  });

  /**
   * The old date case went through `new Date(text).toISOString()`, which reads
   * these two forms as local midnight: east of UTC that is the previous day in
   * UTC. A runner's own zone may be UTC, so the rows set `TZ` themselves. A
   * runtime that ignores an assigned `TZ` cannot run them, so they are skipped
   * there (probed below, not assumed per platform).
   */
  const savedTz = process.env.TZ;
  process.env.TZ = 'Europe/Berlin';
  // Berlin is UTC+1 on 1 January, so the offset is -60 minutes when TZ took.
  const tzHonoured = new Date(Date.UTC(2026, 0, 1, 12)).getTimezoneOffset() === -60;
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;

  describe.skipIf(!tzHonoured)('under TZ=Europe/Berlin', () => {
    beforeEach(() => {
      process.env.TZ = 'Europe/Berlin';
    });

    afterAll(() => {
      if (savedTz === undefined) delete process.env.TZ;
      else process.env.TZ = savedTz;
    });

    const ZONED: Array<[string, string]> = [
      ['12/31/2026', '2026-12-31'],
      ['Oct 16, 2026', '2026-10-16'],
    ];

    it.each(ZONED)('normalises %j to %j east of UTC', (value, expected) => {
      expect(normalizeValue(value, 'date')).toBe(expected);
    });
  });
});
