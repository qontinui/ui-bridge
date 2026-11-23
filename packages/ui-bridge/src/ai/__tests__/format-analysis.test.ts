/**
 * `analyzeFormat` over a literal table.
 *
 * Plan 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change,
 * Phase 0. A dotted date used to be classified as a phone, so the
 * `DD.MM.YYYY` pattern was unreachable; a decimal-comma number was text, and
 * once it is a number its pattern must name its own separators.
 */

import { describe, it, expect } from 'vitest';
import { analyzeFormat } from '../format-analysis';

describe('analyzeFormat', () => {
  const PATTERNS: Array<[string, string, string]> = [
    ['16.10.2026', 'date', 'DD.MM.YYYY'],
    ['2026-10-16', 'date', 'YYYY-MM-DD'],
    ['16-10-2026', 'date', 'DD-MM-YYYY'],
    ['1.234,56', 'number', '#.###,##'],
    ['1,234.56', 'number', '#,###.##'],
    ['(555) 123-4567', 'phone', '(###) ###-####'],
    ['-$5.00', 'currency', '$#.##'],
    ['12/25/2026', 'date', 'MM/DD/YYYY'],
    ['25/12/2026', 'date', 'DD/MM/YYYY'],
  ];

  it.each(PATTERNS)('reads %j as %s with pattern %j', (value, dataType, pattern) => {
    const descriptor = analyzeFormat('el', 'Label', value);
    expect(descriptor.dataType).toBe(dataType);
    expect(descriptor.pattern).toBe(pattern);
  });
});
