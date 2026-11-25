/**
 * fill's value verb fires the page's focus/blur handlers once (no synthetic
 * bubbling FocusEvent after the real focus()/blur()) — follow-up to #526.
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { fillSingleField } from './fill-form';

describe('fillSingleField focus/blur events', () => {
  it.each(['input', 'textarea'] as const)('%s: one focus, one blur, none bubbled', (tag) => {
    const container = document.createElement('div');
    const el = document.createElement(tag);
    container.appendChild(el);
    document.body.appendChild(container);
    const seen: string[] = [];
    const bubbled: string[] = [];
    for (const t of ['focus', 'blur']) {
      el.addEventListener(t, () => seen.push(t));
      container.addEventListener(t, () => bubbled.push(t));
    }
    fillSingleField(el, 'hello', false);
    expect(el.value).toBe('hello');
    expect(seen).toEqual(['focus', 'blur']);
    expect(bubbled).toEqual([]);
    document.body.removeChild(container);
  });
});
