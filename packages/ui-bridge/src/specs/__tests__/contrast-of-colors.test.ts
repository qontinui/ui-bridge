/**
 * One contrast rule for the package: `contrastOfColors` (color-utils), and the
 * `/design/audit` heuristic contrast check that reads colour through it.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { contrastOfColors } from '../color-utils';
import { designAuditOf } from '../design-request';

describe('contrastOfColors', () => {
  it('measures an opaque pair by the WCAG formula', () => {
    expect(contrastOfColors('#000', '#fff')).toBeCloseTo(21, 0);
    expect(contrastOfColors('oklch(0 0 0)', 'oklch(1 0 0)')).toBeCloseTo(21, 0);
  });

  it('composites a partly transparent foreground over the background', () => {
    // 50% black on white renders as grey 127.5: about 3.98:1.
    expect(contrastOfColors('rgba(0, 0, 0, 0.5)', '#fff')).toBeCloseTo(3.98, 1);
  });

  it('answers UNKNOWN over a background that is not opaque', () => {
    expect(contrastOfColors('#000', 'rgba(255, 255, 255, 0.5)')).toBeNull();
    expect(contrastOfColors('#000', 'transparent')).toBeNull();
  });

  it('measures very faint text close to 1:1, and refuses a foreground that paints nothing', () => {
    const faint = contrastOfColors('rgba(0, 0, 0, 0.05)', '#fff');
    expect(faint).not.toBeNull();
    expect(faint!).toBeLessThan(1.15);
    expect(contrastOfColors('rgba(0, 0, 0, 0)', '#fff')).toBeNull();
    expect(contrastOfColors('transparent', '#fff')).toBeNull();
  });

  it('answers UNKNOWN for an unparseable or non-string value', () => {
    expect(contrastOfColors('not-a-colour', '#fff')).toBeNull();
    expect(contrastOfColors(undefined, '#fff')).toBeNull();
    expect(contrastOfColors('#000', 42)).toBeNull();
  });
});

describe('/design/audit heuristic contrast', () => {
  const made: HTMLElement[] = [];
  afterEach(() => {
    for (const el of made.splice(0)) el.remove();
  });

  function text(color: string, backgroundColor: string): HTMLElement {
    const el = document.createElement('p');
    el.textContent = 'text';
    el.style.color = color;
    el.style.backgroundColor = backgroundColor;
    el.style.fontSize = '16px';
    document.body.appendChild(el);
    made.push(el);
    return el;
  }

  function contrastIssues(el: HTMLElement): string[] {
    const report = designAuditOf([{ id: 't', element: el, type: 'paragraph' }], {}, null);
    if (report.mode !== 'heuristic') throw new Error('expected heuristic mode');
    return report.issues.map((i) => i.issue).filter((i) => /contrast|invisible/i.test(i));
  }

  it('flags nearly invisible text on an opaque background', () => {
    const issues = contrastIssues(text('rgb(250, 250, 250)', 'rgb(255, 255, 255)'));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/nearly invisible/i);
  });

  it('composites a partly transparent foreground (50% black on white fails AA)', () => {
    const issues = contrastIssues(text('rgba(0, 0, 0, 0.5)', 'rgb(255, 255, 255)'));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/3\.98:1/);
  });

  it('flags very faint text as nearly invisible instead of skipping it', () => {
    const issues = contrastIssues(text('rgba(0, 0, 0, 0.05)', 'rgb(255, 255, 255)'));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/nearly invisible/i);
  });

  it('does not judge text over a partly transparent background', () => {
    expect(contrastIssues(text('rgb(250, 250, 250)', 'rgba(255, 255, 255, 0.5)'))).toEqual([]);
  });
});
