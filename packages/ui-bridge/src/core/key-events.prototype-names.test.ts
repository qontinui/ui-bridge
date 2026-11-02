/**
 * The combo grammar's tables are looked up by caller-supplied names, so a name
 * that is also an `Object.prototype` member must read as unknown rather than
 * resolve to the inherited member.
 */
import { describe, expect, it } from 'vitest';
import { normalizeKeyDescriptors } from './key-events';

describe('normalizeKeyDescriptors with Object.prototype names', () => {
  it.each(['constructor', '__proto__'])('refuses %s as a key name', (name) => {
    const result = normalizeKeyDescriptors(name);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('unknown key name');
  });

  it.each(['constructor+a', '__proto__+a'])('refuses %s as a modifier', (combo) => {
    const result = normalizeKeyDescriptors(combo);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('unknown modifier');
  });

  it('still resolves a real alias and a real modifier', () => {
    expect(normalizeKeyDescriptors('ctrl+esc')).toEqual({
      ok: true,
      keys: [{ key: 'Escape', modifiers: { ctrl: true } }],
    });
  });
});
