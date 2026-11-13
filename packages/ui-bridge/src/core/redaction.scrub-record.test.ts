/**
 * `scrubRecord`, the attribute-map scrub behind the render-log capture and the
 * server `query` handler, on both §4.6 axes:
 *   - CONTENT (boundary): every value collapses, keys survive.
 *   - VALUE only (bare password input): only the `value` entry collapses.
 *   - neither: the record comes back untouched.
 */

import { describe, it, expect } from 'vitest';
import { scrubRecord, verdictFromState, REDACTED_VALUE } from './redaction';

const none = verdictFromState({});
const valueOnly = verdictFromState({ redaction: { value: true } });
const both = verdictFromState({ redaction: { value: true, content: true } });

describe('scrubRecord', () => {
  it('returns the same record when neither axis applies', () => {
    const rec = { value: 'order-42', title: 'Order' };
    expect(scrubRecord(rec, none)).toBe(rec);
  });

  it('collapses only the value entry under a VALUE-only verdict', () => {
    const rec = { value: 'hunter2', name: 'password', 'data-testid': 'pw' };
    expect(scrubRecord(rec, valueOnly)).toEqual({
      value: REDACTED_VALUE,
      name: 'password',
      'data-testid': 'pw',
    });
    // The input record is not mutated.
    expect(rec.value).toBe('hunter2');
  });

  it('returns the same record under a VALUE-only verdict when there is no value entry', () => {
    const rec = { title: 'Password', 'aria-label': 'Password' };
    expect(scrubRecord(rec, valueOnly)).toBe(rec);
  });

  it('collapses every value and keeps every key under a CONTENT verdict', () => {
    expect(scrubRecord({ value: 'x', title: 'SSN', role: 'textbox' }, both)).toEqual({
      value: REDACTED_VALUE,
      title: REDACTED_VALUE,
      role: REDACTED_VALUE,
    });
  });
});
