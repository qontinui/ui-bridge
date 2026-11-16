/**
 * The boundary index composes a wide parent's text in one pass over its
 * children. Before the per-frame cursor, a parent of 1k rows each holding a
 * redacted cell took ~11 s (every revisit rescanned the children); now ~0.1 s.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { REDACTED_VALUE, textOutsideBoundaries, withBoundaryIndex } from './redaction';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('indexed boundary text over a wide parent', () => {
  it('is correct and not quadratic in the number of children', () => {
    const rows = 1000;
    const parent = document.createElement('section');
    for (let r = 0; r < rows; r++) {
      const row = document.createElement('div');
      row.innerHTML = `<span>v${r}</span><p data-bridge-redact="true">SECRET-${r}</p>`;
      parent.appendChild(row);
    }
    document.body.appendChild(parent);

    const t0 = performance.now();
    const text = withBoundaryIndex(document.body, () => textOutsideBoundaries(parent));
    const elapsed = performance.now() - t0;

    expect(text).toBe(Array.from({ length: rows }, (_, r) => `v${r}${REDACTED_VALUE}`).join(''));
    expect(text).not.toContain('SECRET');
    expect(elapsed).toBeLessThan(3000);
  });
});
