/**
 * Coverage — `elementDensity` and `whitespaceRatio` — counts covered pixels
 * once (coord caveat 7ac36d9e: a measured page read coverage 2.67 because every
 * registered box was summed, containers and children alike).
 */

import { describe, expect, it } from 'vitest';
import { elementDensity, whitespaceRatio } from '../../quality-metrics';
import type { ElementDesignData } from '../../../core/types';
import { DESKTOP, el, type Structure } from './fixtures';

/**
 * A root container (94 % of the viewport) holding a section, a table wrapped
 * in a same-box element, four rows, a heading and a paragraph, plus 40 hidden
 * elements. The rendered leaves are the heading (400 x 40), the paragraph
 * (800 x 40) and the four rows, which tile 1200 x 200: 16,000 + 32,000 +
 * 240,000 = 288,000 px², 0.28125 of 1280 x 800. The summed area of every box
 * is about 3.8 viewports.
 */
function nestedPage(withStructure: boolean): ElementDesignData[] {
  const s = (structure: Partial<Structure>) => (withStructure ? structure : undefined);
  const rows = [0, 1, 2, 3].map((i) =>
    el(`table.row-${i}`, 'generic', { x: 40, y: 300 + i * 50, width: 1200, height: 50 }, s({ tagName: 'tr', parentId: 'list.table' }))
  );
  const hidden = Array.from({ length: 40 }, (_, i) =>
    el(`card-${i}`, 'generic', { x: 40, y: 300 + i * 10, width: 300, height: 40 },
      s({ tagName: 'div', parentId: 'view.root', visible: false, hiddenReason: 'hidden' }),
      { visibility: 'hidden' })
  );
  return [
    el('view.root', 'generic', { x: 0, y: 0, width: 1280, height: 752 }, s({ tagName: 'main' })),
    el('list.section', 'generic', { x: 20, y: 280, width: 1240, height: 460 }, s({ tagName: 'section', parentId: 'view.root' })),
    el('generic-4', 'generic', { x: 40, y: 300, width: 1200, height: 420 }, s({ tagName: 'div', parentId: 'list.section' })),
    el('list.table', 'generic', { x: 40, y: 300, width: 1200, height: 420 }, s({ tagName: 'table', parentId: 'generic-4' })),
    el('view.heading', 'heading', { x: 0, y: 20, width: 400, height: 40 }, s({ tagName: 'h1', parentId: 'view.root' })),
    el('view.text', 'paragraph', { x: 0, y: 80, width: 800, height: 40 }, s({ tagName: 'p', parentId: 'view.root' })),
    ...rows,
    ...hidden,
  ];
}

describe('elementDensity counts covered pixels once', () => {
  it('nested registered boxes are counted once', () => {
    const result = elementDensity(nestedPage(true), DESKTOP);
    expect(result.rawData?.coverage).toBe(0.28125);
    expect(result.rawData?.leafCount).toBe(6);
    expect(result.rawData?.containerCount).toBe(4);
    expect(result.rawData?.leafBy).toBe('parentId');
    expect(result.score).toBe(94);
  });

  it('leaves out hidden elements and counts them', () => {
    const result = elementDensity(nestedPage(true), DESKTOP);
    expect(result.rawData?.excludedHidden).toBe(40);
    expect(result.rawData?.excludedByReason).toEqual({ hidden: 40 });
  });

  it('tells containers from leaves by geometry when no structure was collected', () => {
    const result = elementDensity(nestedPage(false), DESKTOP);
    expect(result.rawData?.coverage).toBe(0.28125);
    expect(result.rawData?.leafBy).toBe('geometry');
  });

  it('counts two registered elements with the same box once', () => {
    const twins = [
      el('a', 'paragraph', { x: 0, y: 0, width: 640, height: 400 }),
      el('b', 'paragraph', { x: 0, y: 0, width: 640, height: 400 }),
    ];
    expect(elementDensity(twins, DESKTOP).rawData?.coverage).toBe(0.25);
  });

  it('counts the overlap of two sibling leaves once', () => {
    // 0..800 and 400..1200 wide, 400 tall: the union is 1200 x 400 = 480,000 px², not 640,000.
    const page = [
      el('a', 'paragraph', { x: 0, y: 0, width: 800, height: 400 }, { tagName: 'p' }),
      el('b', 'paragraph', { x: 400, y: 0, width: 800, height: 400 }, { tagName: 'p' }),
    ];
    expect(elementDensity(page, DESKTOP).rawData?.coverage).toBe(0.46875);
  });

  it('clips an element half off the right edge to the viewport', () => {
    const half = [el('wide', 'paragraph', { x: 1080, y: 0, width: 400, height: 800 })];
    expect(elementDensity(half, DESKTOP).rawData?.coverage).toBe(0.15625);
  });

  it('never reports a coverage above 1', () => {
    const stacked = [0, 1, 2, 3].map((i) => el(`layer-${i}`, 'generic', { x: 0, y: 0, width: 1280, height: 800 }));
    expect(elementDensity(stacked, DESKTOP).rawData?.coverage).toBe(1);
  });

  it('counts an off-screen rendered leaf as off the viewport, not as hidden', () => {
    const page = [
      el('top', 'paragraph', { x: 0, y: 0, width: 1280, height: 400 }, { tagName: 'p' }),
      el('below', 'paragraph', { x: 0, y: 1400, width: 1280, height: 400 }, { tagName: 'p' }),
    ];
    const r = elementDensity(page, DESKTOP).rawData;
    expect(r?.excludedOffViewport).toBe(1);
    expect(r?.excludedHidden).toBe(0);
    expect(r?.coverage).toBe(0.5);
  });

  it('keeps a rendered container a container when a hidden middle parent sits between it and a visible leaf', () => {
    // card > (hidden) wrapper > visible leaf: the card must not count as a leaf.
    const page = [
      el('card', 'generic', { x: 0, y: 0, width: 1280, height: 800 }, { tagName: 'div' }),
      el('wrapper', 'generic', { x: 0, y: 0, width: 640, height: 400 }, { tagName: 'div', parentId: 'card', visible: false, hiddenReason: 'hidden' }),
      el('leaf', 'paragraph', { x: 0, y: 0, width: 640, height: 400 }, { tagName: 'p', parentId: 'wrapper' }),
    ];
    expect(elementDensity(page, DESKTOP).rawData?.coverage).toBe(0.25);
  });

  it('ignores a leaf whose rect is not a number', () => {
    const page = [
      el('ok', 'paragraph', { x: 0, y: 0, width: 640, height: 800 }),
      el('nan', 'paragraph', { x: NaN, y: 0, width: 100, height: 100 }),
    ];
    expect(elementDensity(page, DESKTOP).rawData?.coverage).toBe(0.5);
  });

  it('handles zero, one and many leaves', () => {
    expect(elementDensity([], DESKTOP).rawData?.coverage).toBe(0);
    expect(elementDensity([el('one', 'paragraph', { x: 0, y: 0, width: 640, height: 800 })], DESKTOP).rawData?.coverage).toBe(0.5);
  });
});

describe('whitespaceRatio is the complement of the union coverage', () => {
  it('is not 0 on a page of nested registered containers', () => {
    const result = whitespaceRatio(nestedPage(true), DESKTOP);
    expect(result.rawData?.ratio).toBe(0.71875);
    expect(result.score).toBe(100);
  });
});
