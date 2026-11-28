/**
 * The other area metrics read the same rendered leaves as coverage, so nested
 * containers and hidden elements no longer move them.
 */

import { describe, expect, it } from 'vitest';
import { containerEfficiency, horizontalBalance, localDensityBalance, verticalBalance, viewportUtilization } from '../../quality-metrics';
import { DESKTOP, el } from './fixtures';

const CARD = { backgroundColor: 'rgb(245, 245, 245)', paddingTop: '16px', borderRadius: '8px' };

describe('containerEfficiency reads direct rendered children', () => {
  it('a card holding one small child is inefficient however deep that child nests', () => {
    // Direct child 60 x 60 (3,600 px²) in a 400 x 400 card (160,000 px²): 0.0225.
    // Summing every contained box — its two 50 x 50 children and a hidden
    // 300 x 300 element — used to read 0.616 and score 100.
    const page = [
      el('card', 'generic', { x: 0, y: 0, width: 400, height: 400 }, { tagName: 'div' }, CARD),
      el('child', 'generic', { x: 20, y: 20, width: 60, height: 60 }, { tagName: 'div', parentId: 'card' }),
      el('grand-a', 'generic', { x: 25, y: 25, width: 50, height: 50 }, { tagName: 'span', parentId: 'child' }),
      el('grand-b', 'generic', { x: 25, y: 25, width: 50, height: 50 }, { tagName: 'span', parentId: 'child' }),
      el('hidden', 'generic', { x: 50, y: 50, width: 300, height: 300 }, { tagName: 'div', parentId: 'card', visible: false, hiddenReason: 'hidden' }),
    ];
    const result = containerEfficiency(page, DESKTOP);
    expect(result.rawData?.avgEfficiency).toBe(0.0225);
    expect(result.score).toBe(8);
  });
});

describe('horizontalBalance reads rendered leaves', () => {
  it('a container around one side no longer outweighs the other', () => {
    const page = [
      el('left-box', 'generic', { x: 0, y: 0, width: 600, height: 400 }, { tagName: 'section' }),
      el('left', 'paragraph', { x: 100, y: 100, width: 400, height: 100 }, { tagName: 'p', parentId: 'left-box' }),
      el('right', 'paragraph', { x: 780, y: 100, width: 400, height: 100 }, { tagName: 'p' }),
    ];
    const result = horizontalBalance(page, DESKTOP);
    expect(result.rawData?.ratio).toBe(1);
    expect(result.rawData?.leafCount).toBe(2);
    expect(result.score).toBe(100);
  });

  it('a hidden off-centre element does not move the balance', () => {
    const page = [
      el('left', 'paragraph', { x: 100, y: 100, width: 400, height: 100 }, { tagName: 'p' }),
      el('right', 'paragraph', { x: 780, y: 100, width: 400, height: 100 }, { tagName: 'p' }),
      el('ghost', 'generic', { x: 680, y: 0, width: 600, height: 600 }, { tagName: 'div', visible: false, hiddenReason: 'hidden' }),
    ];
    expect(horizontalBalance(page, DESKTOP).score).toBe(100);
  });
});

describe('verticalBalance reads the visible leaves', () => {
  it('a hidden element and content below the first screen do not move the balance', () => {
    const page = [
      el('top', 'paragraph', { x: 0, y: 100, width: 400, height: 100 }, { tagName: 'p' }),
      el('bottom', 'paragraph', { x: 0, y: 600, width: 400, height: 100 }, { tagName: 'p' }),
      el('ghost', 'generic', { x: 0, y: 420, width: 1280, height: 300 }, { tagName: 'div', visible: false, hiddenReason: 'hidden' }),
      el('far-below', 'paragraph', { x: 0, y: 2000, width: 1280, height: 900 }, { tagName: 'p' }),
    ];
    const result = verticalBalance(page, DESKTOP);
    expect(result.rawData?.ratio).toBe(1);
    expect(result.score).toBe(100);
  });
});

describe('localDensityBalance reads the visible leaves', () => {
  it('a hidden element over one quadrant and a leaf below the first screen do not unbalance the grid', () => {
    // Four 320 x 200 leaves, one in each quadrant. A hidden 640 x 400 block
    // over one quadrant would otherwise fill its cells.
    const quads = [
      [160, 100],
      [800, 100],
      [160, 500],
      [800, 500],
    ].map(([x, y], i) => el(`q${i}`, 'paragraph', { x, y, width: 320, height: 200 }, { tagName: 'p' }));
    const ghost = el('ghost', 'generic', { x: 0, y: 0, width: 640, height: 400 }, { tagName: 'div', visible: false, hiddenReason: 'hidden' });
    const farBelow = el('far-below', 'paragraph', { x: 0, y: 1200, width: 640, height: 400 }, { tagName: 'p' });
    const withGhost = localDensityBalance([...quads, ghost, farBelow], DESKTOP);
    const without = localDensityBalance(quads, DESKTOP);
    expect(withGhost.rawData?.cv).toBe(without.rawData?.cv);
    expect(withGhost.rawData?.leafCount).toBe(4);
  });
});

describe('viewportUtilization reads rendered leaves', () => {
  it('a hidden full-viewport element does not fill the bounding box', () => {
    const page = [
      el('content', 'paragraph', { x: 0, y: 0, width: 400, height: 300 }, { tagName: 'p' }),
      el('overlay', 'generic', { x: 0, y: 0, width: 1280, height: 800 }, { tagName: 'div', visible: false, hiddenReason: 'hidden' }),
    ];
    const result = viewportUtilization(page, DESKTOP);
    expect(result.rawData?.boundingBox).toEqual({ minX: 0, minY: 0, maxX: 400, maxY: 300 });
    expect(result.score).toBe(49);
  });
});
