/**
 * `informationDensity` category 2 — disproportionate space for one function.
 */

import { describe, expect, it } from 'vitest';
import { informationDensity } from '../../quality-metrics';
import type { ElementDesignData } from '../../../core/types';
import type { ViewportDimensions } from '../../quality-types';
import { DESKTOP, category, el, orderListPage, type Group } from './fixtures';

const space = (elements: ElementDesignData[], viewport: ViewportDimensions = DESKTOP) =>
  category(informationDensity(elements, viewport).rawData, 'disproportionateSpace');

/** A search row (field + button) above a filter row (two selects + button), in a 1000 px column, table below. */
function compactControls(): ElementDesignData[] {
  const search: Group = { key: 'search#1', kind: 'search', rect: { x: 264, y: 300, width: 1000, height: 80 } };
  const filters: Group = { key: 'filters', kind: 'form', rect: { x: 264, y: 394, width: 1000, height: 72 } };
  const table: Group = { key: 't', kind: 'table', rect: { x: 264, y: 482, width: 1000, height: 600 } };
  return [
    el('q', 'input', { x: 264, y: 334, width: 294, height: 44 }, { tagName: 'input', controlType: 'search', group: search }),
    el('q-go', 'button', { x: 570, y: 334, width: 89, height: 44 }, { tagName: 'button', controlType: 'submit', group: search }),
    el('status', 'select', { x: 264, y: 422, width: 151, height: 44 }, { tagName: 'select', group: filters }),
    el('sort', 'select', { x: 427, y: 422, width: 150, height: 44 }, { tagName: 'select', group: filters }),
    el('apply', 'button', { x: 589, y: 422, width: 113, height: 44 }, { tagName: 'button', controlType: 'submit', group: filters }),
    el('t', 'generic', table.rect, { tagName: 'table', group: table }),
    ...[0, 1, 2].map((i) => el(`row-${i}`, 'generic', { x: 264, y: 520 + i * 40, width: 1000, height: 40 }, { tagName: 'tr', group: table })),
  ];
}

describe('informationDensity: disproportionate space for one function', () => {
  it('three filters stacked one per full-width row above the table are flagged', () => {
    const c = space(orderListPage());
    expect(c.hits.map((h) => h.kind)).toEqual(['stacked-singletons', 'out-of-proportion']);
    for (const h of c.hits) {
      expect(h.elementIds).toEqual([
        'search#1', 'list.controls', 'list.search', 'list.filter-status', 'list.sort',
        'list.search-submit', 'list.controls-apply',
      ]);
    }
    expect(c.score).toBe(40);
  });

  it('flags rows that would fit side by side, and nothing else, on a compact layout', () => {
    const c = space(compactControls());
    expect(c.hits.map((h) => h.kind)).toEqual(['mergeable-rows']);
    expect(c.hits[0].elementIds).toEqual(['search#1', 'filters', 'q', 'q-go', 'status', 'sort', 'apply']);
    expect(c.score).toBe(80);
  });

  it('does not flag the same rows on a viewport too narrow to merge them', () => {
    // The same controls at 360 px: each row already fills the 328 px column.
    const search: Group = { key: 'search#1', kind: 'search', rect: { x: 16, y: 300, width: 328, height: 80 } };
    const filters: Group = { key: 'filters', kind: 'form', rect: { x: 16, y: 394, width: 328, height: 120 } };
    const page = [
      el('q', 'input', { x: 16, y: 334, width: 230, height: 44 }, { tagName: 'input', controlType: 'search', group: search }),
      el('q-go', 'button', { x: 255, y: 334, width: 89, height: 44 }, { tagName: 'button', controlType: 'submit', group: search }),
      el('status', 'select', { x: 16, y: 422, width: 158, height: 44 }, { tagName: 'select', group: filters }),
      el('sort', 'select', { x: 186, y: 422, width: 158, height: 44 }, { tagName: 'select', group: filters }),
      el('apply', 'button', { x: 16, y: 470, width: 113, height: 44 }, { tagName: 'button', controlType: 'submit', group: filters }),
    ];
    expect(space(page, { width: 360, height: 740 }).hits.map((h) => h.kind)).not.toContain('mergeable-rows');
  });

  it('needs three stacked fields, not two', () => {
    const page = orderListPage().filter((e) => e.elementId !== 'list.sort');
    expect(space(page).hits.map((h) => h.kind)).not.toContain('stacked-singletons');
  });

  it('flags a control group out of proportion when the table does not reach the first screen', () => {
    const page = orderListPage().map((e) =>
      e.structure?.group?.key === 'list.table'
        ? { ...e, rect: { ...e.rect, y: e.rect.y + 400 }, structure: { ...e.structure, group: { ...e.structure.group, rect: { ...e.structure.group.rect, y: 980 } } } }
        : e
    );
    const hit = space(page).hits.find((h) => h.kind === 'out-of-proportion');
    expect(hit?.reason).toContain('does not reach the first screen');
  });

  it('does not judge a control group whose controls are all below the first screen', () => {
    // The create form's fields sit on rows that would merge, but none is on the first screen.
    const form: Group = { key: 'create', kind: 'form', rect: { x: 264, y: 780, width: 1000, height: 200 } };
    const page = [
      el('name', 'input', { x: 264, y: 837, width: 241, height: 44 }, { tagName: 'input', controlType: 'text', group: form }),
      el('ref', 'input', { x: 517, y: 837, width: 241, height: 44 }, { tagName: 'input', controlType: 'text', group: form }),
      el('go', 'button', { x: 264, y: 897, width: 150, height: 44 }, { tagName: 'button', controlType: 'submit', group: form }),
    ];
    expect(space(page).hits).toHaveLength(0);
  });

  it('is null without structure', () => {
    expect(space([el('a', 'input', { x: 0, y: 0, width: 100, height: 40 })]).score).toBeNull();
  });
});
