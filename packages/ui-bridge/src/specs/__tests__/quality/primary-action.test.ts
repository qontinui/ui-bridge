/**
 * `informationDensity` category 3 — a primary action below the fold.
 */

import { describe, expect, it } from 'vitest';
import { informationDensity } from '../../quality-metrics';
import type { ElementDesignData } from '../../../core/types';
import { CREATE, DESKTOP, category, el, orderListPage, type Group } from './fixtures';

const fold = (elements: ElementDesignData[]) =>
  category(informationDensity(elements, DESKTOP).rawData, 'primaryActionBelowFold');

type Hit = { elementIds: string[]; kind?: string; screensBelow?: number };

/** Move every member of a group (and the group's rect) down by `dy`. */
function shiftGroup(page: ElementDesignData[], key: string, dy: number): ElementDesignData[] {
  return page.map((e) =>
    e.structure?.group?.key === key
      ? {
          ...e,
          rect: { ...e.rect, y: e.rect.y + dy },
          structure: { ...e.structure, group: { ...e.structure.group, rect: { ...e.structure.group.rect, y: e.structure.group.rect.y + dy } } },
        }
      : e
  );
}

describe('informationDensity: primary action below the fold', () => {
  it('a create form entirely below the first screen is flagged while other groups sit above it', () => {
    const c = fold(orderListPage());
    expect(c.hits).toHaveLength(1);
    const hit = c.hits[0] as Hit;
    expect(hit.kind).toBe('form');
    expect(hit.elementIds).toEqual(['form#2', 'editor.create-submit', 'editor.create-name', 'editor.create-reference']);
    // The first member starts at 1220 px: (1220 - 800) / 800 screens below.
    expect(hit.screensBelow).toBe(0.53);
    expect(c.score).toBe(60);
  });

  it('does not flag the form once one member reaches the first screen', () => {
    expect(fold(shiftGroup(orderListPage(), CREATE.key, -500)).hits).toHaveLength(0);
  });

  it('does not flag a filter form of choices below the fold', () => {
    const page = shiftGroup(
      orderListPage().filter((e) => e.structure?.group?.key !== CREATE.key),
      'list.controls',
      700
    );
    expect(fold(page).hits).toHaveLength(0);
  });

  it('flags a prominent button below the fold outside any form', () => {
    const region: Group = { key: 'region#9', kind: 'region', rect: { x: 0, y: 1200, width: 1280, height: 80 } };
    const page = [
      ...orderListPage().filter((e) => e.structure?.group?.key !== CREATE.key),
      el('new-order', 'button', { x: 40, y: 1220, width: 200, height: 40 }, {
        tagName: 'button', controlType: 'button', group: region, text: 'Neu',
      }, { backgroundColor: 'rgb(200, 30, 30)' }),
    ];
    const hits = fold(page).hits as Hit[];
    expect(hits.map((h) => [h.kind, h.elementIds])).toEqual([['prominent-button', ['new-order']]]);
  });

  it('does not flag pagination buttons that share the page\'s common button style', () => {
    const region: Group = { key: 'pager', kind: 'region', rect: { x: 0, y: 1200, width: 1280, height: 40 } };
    const page = [
      ...orderListPage().filter((e) => e.structure?.group?.key !== CREATE.key),
      ...[0, 1].map((i) =>
        el(`page-${i}`, 'button', { x: 40 + i * 60, y: 1200, width: 50, height: 40 }, {
          tagName: 'button', controlType: 'button', group: region,
        }, { backgroundColor: 'rgb(230, 230, 230)' })
      ),
    ];
    expect(fold(page).hits).toHaveLength(0);
  });

  it('does not flag anything when no other group is on the first screen', () => {
    const page = orderListPage().filter((e) => e.structure?.group?.key === CREATE.key);
    expect(fold(page).hits).toHaveLength(0);
  });
});
