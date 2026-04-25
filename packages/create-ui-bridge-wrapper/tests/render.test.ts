import { describe, it, expect } from 'vitest';
import { renderTemplate, toDisplayName, toPascalCase } from '../src/render.js';

describe('renderTemplate', () => {
  it('substitutes variables', () => {
    const out = renderTemplate('hello {{NAME}}', {
      vars: { NAME: 'world' },
      flags: {},
    });
    expect(out).toBe('hello world');
  });

  it('keeps IF body when flag is true', () => {
    const out = renderTemplate('{{#IF_LIVE}}live{{/IF_LIVE}}', {
      vars: {},
      flags: { LIVE: true },
    });
    expect(out).toBe('live');
  });

  it('strips IF body when flag is false', () => {
    const out = renderTemplate('pre {{#IF_LIVE}}live{{/IF_LIVE}} post', {
      vars: {},
      flags: { LIVE: false },
    });
    expect(out).toBe('pre  post');
  });

  it('keeps IFNOT body when flag is false', () => {
    const out = renderTemplate('{{#IFNOT_UI}}node-only{{/IFNOT_UI}}', {
      vars: {},
      flags: { UI: false },
    });
    expect(out).toBe('node-only');
  });

  it('strips IFNOT body when flag is true', () => {
    const out = renderTemplate('{{#IFNOT_UI}}node-only{{/IFNOT_UI}}', {
      vars: {},
      flags: { UI: true },
    });
    expect(out).toBe('');
  });

  it('resolves variables inside an IF body', () => {
    const out = renderTemplate('{{#IF_FLAG}}value={{NAME}}{{/IF_FLAG}}', {
      vars: { NAME: 'x' },
      flags: { FLAG: true },
    });
    expect(out).toBe('value=x');
  });

  it('throws on missing variable', () => {
    expect(() => renderTemplate('{{MISSING}}', { vars: {}, flags: {} })).toThrow(/MISSING/);
  });

  it('throws on missing flag', () => {
    expect(() =>
      renderTemplate('{{#IF_MISSING}}x{{/IF_MISSING}}', {
        vars: {},
        flags: {},
      })
    ).toThrow(/MISSING/);
  });

  it('handles two conditionals on the same line', () => {
    const out = renderTemplate('{{#IF_A}}a{{/IF_A}}{{#IF_B}}b{{/IF_B}}', {
      vars: {},
      flags: { A: true, B: false },
    });
    expect(out).toBe('a');
  });

  it('handles multi-line conditional bodies', () => {
    const source = `pre
{{#IF_X}}
line 1
line 2
{{/IF_X}}
post`;
    const kept = renderTemplate(source, { vars: {}, flags: { X: true } });
    expect(kept).toContain('line 1');
    expect(kept).toContain('line 2');
    const dropped = renderTemplate(source, {
      vars: {},
      flags: { X: false },
    });
    expect(dropped).not.toContain('line 1');
    expect(dropped).not.toContain('line 2');
  });
});

describe('toPascalCase', () => {
  it('converts kebab-case', () => {
    expect(toPascalCase('my-wrapper')).toBe('MyWrapper');
  });
  it('converts snake_case', () => {
    expect(toPascalCase('my_wrapper')).toBe('MyWrapper');
  });
  it('handles single word', () => {
    expect(toPascalCase('wrapper')).toBe('Wrapper');
  });
});

describe('toDisplayName', () => {
  it('title-cases kebab-case', () => {
    expect(toDisplayName('my-wrapper')).toBe('My Wrapper');
  });
});
