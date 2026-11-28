/**
 * `informationDensity` category 1 — redundant text, read through the metric
 * the evaluator runs.
 */

import { describe, expect, it } from 'vitest';
import { informationDensity } from '../../quality-metrics';
import { DESKTOP, category, el, orderListPage } from './fixtures';

const redundant = (elements: Parameters<typeof informationDensity>[0], page?: Parameters<typeof informationDensity>[2]) =>
  category(informationDensity(elements, DESKTOP, page).rawData, 'redundantText');

describe('informationDensity: redundant text', () => {
  it('a subtitle, an intro and table headers that restate each other form one cluster', () => {
    const c = redundant(orderListPage());
    expect(c.hits).toHaveLength(1);
    expect(c.hits[0].elementIds).toEqual([
      'view.subtitle',
      'view.intro',
      'list.column-0',
      'list.column-1',
      'list.column-2',
      'list.column-3',
      'list.column-4',
    ]);
    expect(c.hits[0].sharedTerms).toEqual(['aufträg', 'liefer', 'summ', 'versandadress', 'bestellnumm', 'auftrag']);
  });

  it('never treats row headers (data cells) as labels', () => {
    const ids = redundant(orderListPage()).hits.flatMap((h) => h.elementIds);
    expect(ids.some((id) => id.startsWith('list.name-'))).toBe(false);
  });

  it('works on English text with the same rule', () => {
    const page = [
      el('h', 'heading', { x: 0, y: 0, width: 400, height: 40 }, { tagName: 'h1', text: 'Shipments' }),
      el('sub', 'paragraph', { x: 0, y: 50, width: 800, height: 24 }, { tagName: 'p', text: 'Your shipments with tracking numbers and delivery dates.' }),
      el('intro', 'paragraph', { x: 0, y: 80, width: 800, height: 24 }, { tagName: 'p', text: 'All shipments: tracking numbers, carriers and the delivery dates of each parcel.' }),
    ];
    const c = redundant(page);
    expect(c.hits).toHaveLength(1);
    expect(c.hits[0].elementIds).toEqual(['sub', 'intro']);
  });

  it('flags at an overlap of one half and not at one shared term', () => {
    const pair = (a: string, b: string) => [
      el('a', 'paragraph', { x: 0, y: 0, width: 800, height: 24 }, { tagName: 'p', text: a }),
      el('b', 'paragraph', { x: 0, y: 30, width: 800, height: 24 }, { tagName: 'p', text: b }),
    ];
    // 2 shared of 4: exactly the 0.5 boundary.
    expect(redundant(pair('Lager Summen Freigabe Kunden', 'Lager Summen Wetter Himmel')).hits).toHaveLength(1);
    // 2 shared of 5: below it.
    expect(redundant(pair('Lager Summen Freigabe Kunden Wolken', 'Lager Summen Wetter Himmel Sonne')).hits).toHaveLength(0);
    // 1 shared of 1: below the two-term minimum.
    expect(redundant(pair('Aufträge', 'Alle Aufträge der Woche')).hits).toHaveLength(0);
  });

  it('ignores text below the first screen', () => {
    const page = [
      el('a', 'paragraph', { x: 0, y: 900, width: 800, height: 24 }, { tagName: 'p', text: 'Lager Summen Freigabe' }),
      el('b', 'paragraph', { x: 0, y: 930, width: 800, height: 24 }, { tagName: 'p', text: 'Lager Summen Freigabe' }),
    ];
    expect(redundant(page).hits).toHaveLength(0);
  });

  it('never reads redacted text', () => {
    const page = [
      el('a', 'paragraph', { x: 0, y: 0, width: 800, height: 24 }, { tagName: 'p', text: '[REDACTED]' }),
      el('b', 'paragraph', { x: 0, y: 30, width: 800, height: 24 }, { tagName: 'p', text: '[REDACTED]' }),
    ];
    expect(redundant(page).hits).toHaveLength(0);
  });

  it('reads unregistered text blocks the page collected', () => {
    const page = [
      el('intro', 'paragraph', { x: 0, y: 80, width: 800, height: 24 }, {
        tagName: 'p', text: 'Ihre Aufträge und Lager: die Lieferungen und die Summen je Auftrag.',
      }),
    ];
    const c = redundant(page, {
      textBlocks: [
        { id: 'dom:span.page-context#1', tagName: 'span', text: 'Ihre Aufträge mit Lieferungen, Rechnungen und Summen.', rect: { x: 0, y: 50, width: 800, height: 24 } },
      ],
    });
    expect(c.hits).toHaveLength(1);
    expect(c.hits[0].elementIds).toEqual(['intro']);
    expect(c.hits[0].regionIds).toEqual(['dom:span.page-context#1']);
  });

  it('is null when no element carries text, and the metric is null when nothing was measured', () => {
    const result = informationDensity([el('a', 'heading', { x: 0, y: 0, width: 10, height: 10 })], DESKTOP);
    expect(result.score).toBeNull();
    expect(category(result.rawData, 'redundantText').score).toBeNull();
  });
});
