/**
 * `contentOverflow` measures overflow kinds; vertical page length costs
 * nothing (coord caveat 7ac36d9e: a 1161 px page lost 43 points and a 3322 px
 * page scored 0 for scrolling).
 */

import { describe, expect, it } from 'vitest';
import { contentOverflow } from '../../quality-metrics';
import { DESKTOP, el } from './fixtures';

type Kinds = Record<string, { elementIds?: string[]; px?: number | null; measured?: boolean; elements?: Array<{ recoverable: boolean | null }> }>;

describe('contentOverflow', () => {
  it('a long page that does not overflow loses no points', () => {
    for (const documentHeight of [1161, 3322]) {
      const page = [
        el('top', 'heading', { x: 0, y: 0, width: 400, height: 50 }, { tagName: 'h1' }),
        el('bottom', 'paragraph', { x: 0, y: documentHeight - 61, width: 400, height: 61 }, { tagName: 'p' }),
      ];
      const result = contentOverflow(page, { ...DESKTOP, documentWidth: 1280, documentHeight });
      expect(result.score).toBe(100);
      expect(result.findings).toHaveLength(0);
      expect(result.rawData?.pageScrollsVertically).toBe(true);
    }
  });

  it('reports horizontal page scroll and the element forcing it', () => {
    const page = [
      el('wide', 'generic', { x: 0, y: 100, width: 1400, height: 40 }, { tagName: 'div' }),
      el('fits', 'paragraph', { x: 0, y: 200, width: 400, height: 40 }, { tagName: 'p' }),
    ];
    const result = contentOverflow(page, { ...DESKTOP, documentWidth: 1400, documentHeight: 800 });
    const kinds = result.rawData?.kinds as Kinds;
    expect(kinds.pageHorizontalScroll.px).toBe(120);
    expect(kinds.pastViewportX.elementIds).toEqual(['wide']);
    expect(result.findings[0].severity).toBe('error');
    expect(result.score).toBe(50);
  });

  it('reports an element past the right edge with its id', () => {
    const page = [el('chip', 'generic', { x: 1200, y: 0, width: 200, height: 40 }, { tagName: 'span' })];
    const kinds = contentOverflow(page, { ...DESKTOP, documentWidth: 1280 }).rawData?.kinds as Kinds;
    expect(kinds.pastViewportX.elementIds).toEqual(['chip']);
  });

  it('does not count an element inside a horizontally scrolling container', () => {
    const page = [
      el('scroller', 'generic', { x: 0, y: 0, width: 1280, height: 200 }, { tagName: 'div', scrollWidth: 2000, clientWidth: 1280 }, { overflow: 'auto' }),
      el('wide-table', 'generic', { x: 0, y: 0, width: 2000, height: 200 }, { tagName: 'table', parentId: 'scroller' }),
    ];
    const kinds = contentOverflow(page, { ...DESKTOP, documentWidth: 1280 }).rawData?.kinds as Kinds;
    expect(kinds.pastViewportX.elementIds).toEqual([]);
  });

  it('reports content clipped by overflow hidden, with whether its full value is recoverable', () => {
    const page = [
      el('cell', 'generic', { x: 0, y: 0, width: 300, height: 24 }, {
        tagName: 'td', scrollWidth: 620, clientWidth: 300, textOverflow: 'ellipsis',
        fullValueRecovery: { title: false, ariaLabel: false, abbr: false },
      }, { overflow: 'hidden' }),
      el('scroller', 'generic', { x: 0, y: 40, width: 300, height: 200 }, { tagName: 'div', scrollHeight: 900, clientHeight: 200 }, { overflow: 'auto' }),
    ];
    const result = contentOverflow(page, { ...DESKTOP, documentWidth: 1280 });
    const kinds = result.rawData?.kinds as Kinds;
    expect(kinds.clippedContent.elementIds).toEqual(['cell']);
    expect(kinds.clippedContent.elements?.[0].recoverable).toBe(false);
    expect(result.score).toBe(92);
  });

  it('lists recovery as unmeasured when it was not collected', () => {
    const page = [
      el('cell', 'generic', { x: 0, y: 0, width: 300, height: 24 }, { tagName: 'td', scrollWidth: 620, clientWidth: 300 }, { overflow: 'hidden' }),
    ];
    const r = contentOverflow(page, { ...DESKTOP, documentWidth: 1280 }).rawData;
    expect((r?.unmeasured as Array<{ input: string }>).map((u) => u.input)).toContain('textTruncationRecovery');
  });

  it('does not charge a vertical scroll pane (overflow-x hidden, overflow-y auto) or the children scrolled in it', () => {
    const page = [
      el('pane', 'generic', { x: 0, y: 0, width: 300, height: 400 }, { tagName: 'aside', scrollHeight: 1600, clientHeight: 400 }, { overflow: 'hidden auto' }),
      el('pane.item', 'generic', { x: 0, y: 500, width: 300, height: 40 }, { tagName: 'li', parentId: 'pane' }),
    ];
    const result = contentOverflow(page, { ...DESKTOP, documentWidth: 1280 });
    expect(result.score).toBe(100);
  });

  it('does not charge a horizontal scroller whose vertical axis clips (overflow: auto hidden)', () => {
    const page = [
      el('strip', 'generic', { x: 0, y: 0, width: 600, height: 200 }, { tagName: 'div', scrollWidth: 2400, clientWidth: 600 }, { overflow: 'auto hidden' }),
    ];
    expect(contentOverflow(page, { ...DESKTOP, documentWidth: 1280 }).score).toBe(100);
  });

  it('a registered vertical scroll pane (computed overflow-x auto, no x scroll) does not exempt a child past the viewport', () => {
    const page = [
      // The wide child raises the pane's scrollWidth, as a browser reports it.
      el('main', 'generic', { x: 0, y: 0, width: 1280, height: 800 }, { tagName: 'main', scrollWidth: 1600, clientWidth: 1280, scrollHeight: 2400, clientHeight: 800 }, { overflow: 'auto' }),
      el('wide', 'generic', { x: 0, y: 100, width: 1600, height: 200 }, { tagName: 'div', parentId: 'main' }),
    ];
    const kinds = contentOverflow(page, { ...DESKTOP, documentWidth: 1280 }).rawData?.kinds as Kinds;
    expect(kinds.pastViewportX.elementIds).toEqual(['wide']);
  });

  it('a main pane beside a sidebar (0.77 of the viewport wide) is still a main pane', () => {
    const page = [
      el('main', 'generic', { x: 288, y: 0, width: 992, height: 800 }, { tagName: 'main', scrollWidth: 1400, clientWidth: 992, scrollHeight: 2400, clientHeight: 800 }, { overflow: 'auto' }),
      el('wide', 'generic', { x: 288, y: 100, width: 1400, height: 200 }, { tagName: 'div', parentId: 'main' }),
    ];
    const kinds = contentOverflow(page, { ...DESKTOP, documentWidth: 1280 }).rawData?.kinds as Kinds;
    expect(kinds.pastViewportX.elementIds).toEqual(['wide']);
  });

  it('a tall grid wrapper beside a sidebar contains its wide table; the main landmark does not', () => {
    const wrapper = (tagName: string) => [
      el('pane', 'generic', { x: 288, y: 0, width: 992, height: 800 }, { tagName, holdsGridDirectly: tagName !== 'section', scrollWidth: 1400, clientWidth: 992, scrollHeight: 2400, clientHeight: 800 }, { overflow: 'auto' }),
      el('pane.table', 'generic', { x: 288, y: 0, width: 1400, height: 2400 }, { tagName: 'table', role: 'table', parentId: 'pane' }),
    ];
    const past = (tagName: string) =>
      (contentOverflow(wrapper(tagName), { ...DESKTOP, documentWidth: 1280 }).rawData?.kinds as Kinds).pastViewportX.elementIds;
    expect(past('div')).toEqual([]);
    expect(past('main')).toEqual(['pane.table']);
    // The table is registered under the pane but sits inside an unregistered
    // card: the pane does not hold it directly, so it is a main pane by size.
    expect(past('section')).toEqual(['pane.table']);
  });

  it('a small grid wrapper scrolling on both axes still contains its wide table', () => {
    const page = [
      el('grid', 'generic', { x: 800, y: 100, width: 400, height: 300 }, { tagName: 'div', scrollWidth: 1200, clientWidth: 400, scrollHeight: 900, clientHeight: 300 }, { overflow: 'auto' }),
      el('grid.table', 'generic', { x: 800, y: 100, width: 1200, height: 900 }, { tagName: 'table', parentId: 'grid' }),
    ];
    const kinds = contentOverflow(page, { ...DESKTOP, documentWidth: 1280 }).rawData?.kinds as Kinds;
    expect(kinds.pastViewportX.elementIds).toEqual([]);
  });

  it('does not count an element inside an unregistered horizontal scroller', () => {
    const page = [el('card', 'generic', { x: 1200, y: 0, width: 300, height: 200 }, { tagName: 'div', insideHorizontalScroller: true })];
    const kinds = contentOverflow(page, { ...DESKTOP, documentWidth: 1280 }).rawData?.kinds as Kinds;
    expect(kinds.pastViewportX.elementIds).toEqual([]);
  });

  it('reports a child drawn past a container that clips it', () => {
    const page = [
      el('card', 'generic', { x: 0, y: 0, width: 300, height: 200 }, { tagName: 'div' }, { overflow: 'hidden' }),
      el('card.value', 'generic', { x: 0, y: 20, width: 420, height: 24 }, { tagName: 'span', parentId: 'card' }),
    ];
    const kinds = contentOverflow(page, { ...DESKTOP, documentWidth: 1280 }).rawData?.kinds as Kinds;
    expect(kinds.childPastClippingParent.elementIds).toEqual(['card.value']);
  });

  it('scores the measurable kind and lists the rest when there is no structure and no document width', () => {
    const page = [el('a', 'paragraph', { x: 0, y: 0, width: 1500, height: 40 })];
    const result = contentOverflow(page, DESKTOP);
    expect(result.score).toBe(90);
    expect((result.rawData?.unmeasured as Array<{ input: string }>).map((u) => u.input)).toEqual([
      'pageHorizontalScroll',
      'pastViewportX.scrollContainment',
      'clippedContent',
      'childPastClippingParent',
    ]);
  });
});
