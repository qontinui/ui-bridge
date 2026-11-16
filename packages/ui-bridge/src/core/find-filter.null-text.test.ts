/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { applyCanonicalFindFilter, type FindFilterableElement } from './find-filter';

/**
 * A row whose scrubbed `state.textContent` is null (a wire row where the field
 * serialised as null) falls through to the next text source, as it did before
 * the boundary-aware reader; it must neither throw nor read as empty.
 */
describe('find text predicate over a null text field', () => {
  it('falls through a null state.textContent to the row text', () => {
    const row = {
      id: 'r1',
      state: { textContent: null },
      textContent: 'Order total',
    } as unknown as FindFilterableElement;
    expect(applyCanonicalFindFilter([row], { text: 'order' })).toEqual([row]);
  });

  it('falls through a null row textContent to the live node', () => {
    document.body.innerHTML =
      '<div id="n">Order <span data-bridge-redact="true">SECRET-null-1</span></div>';
    const row = {
      id: 'r2',
      textContent: null,
      element: document.getElementById('n'),
    } as unknown as FindFilterableElement;
    expect(applyCanonicalFindFilter([row], { text: 'order' })).toEqual([row]);
    expect(applyCanonicalFindFilter([row], { text: 'SECRET-null-1' })).toEqual([]);
  });
});
