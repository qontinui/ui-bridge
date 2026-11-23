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
    expect(classifyDataType('16.10.2026').type).toBe('date');
    expect(classifyDataType('16.10.2026').type).not.toBe('phone');
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
    // the rest
    ['true', 'boolean'],
    ['a@b.co', 'email'],
    ['https://x.test/', 'url'],
    ['hello world', 'text'],
    // digits with dots only are neither a number form nor a phone
    ['555.123.4567', 'text'],
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
  ];

  it.each(NORMALISATION)('normalises %j (%s) to %j', (value, type, expected) => {
    expect(classifyDataType(value).type).toBe(type);
    expect(normalizeValue(value, type)).toBe(expected);
  });

  /**
   * The old date case went through `new Date(text).toISOString()`, which reads
   * these two forms as local midnight: east of UTC that is the previous day in
   * UTC. CI runs in UTC, so the rows set `TZ` themselves. A runtime that
   * ignores an assigned `TZ` cannot run them, so they are skipped there (probed
   * below, not assumed per platform) and CI's Linux run is the one that counts.
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
