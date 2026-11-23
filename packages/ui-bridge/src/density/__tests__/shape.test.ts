// @vitest-environment node
/** shape.ts: the shape table over a literal table of texts. */
import { describe, expect, it } from 'vitest';
import { densityShapeOf, type DensityShape } from '../shape';

const ROWS: Array<[string, DensityShape | null]> = [
  ['16.10.2026', 'date'],
  ['2026-10-16', 'date'],
  ['16-10-2026', 'date'],
  ['12/31/2026', 'date'],
  ['Oct 16, 2026', 'date'],
  ['16 October 2026', 'date'],
  ['2026-10-16T09:30:00Z', 'date'],
  ['1.234,56', 'number'],
  ['1,234.56', 'number'],
  ['1234,56', 'number'],
  ['1,234', 'number'],
  ['-3.5', 'number'],
  ['42', 'number'],
  ['12,5 %', 'number'],
  ['50%', 'number'],
  ['€ 12,50', 'currency'],
  ['1.234,56 €', 'currency'],
  ['$1,234.56', 'currency'],
  ['EUR 12', 'currency'],
  ['INV-2026-0042', 'identifier'],
  ['A1B2C3', 'identifier'],
  ['#4471', 'identifier'],
  ['99.99.2026', 'identifier'],
  ['ORD 123', 'text'],
  ['Your order ships on Monday.', 'text'],
  ['Overview', 'text'],
  ['', null],
  ['   ', null],
];

describe('density shape table', () => {
  it('runs with no DOM', () => {
    expect(typeof document).toBe('undefined');
  });

  it.each(ROWS)('%j has shape %s', (text, shape) => {
    expect(densityShapeOf(text)).toBe(shape);
  });

  it('collapses whitespace before reading', () => {
    expect(densityShapeOf('  16.10.2026\n')).toBe('date');
    expect(densityShapeOf('€ 12,50')).toBe('currency');
  });
});
