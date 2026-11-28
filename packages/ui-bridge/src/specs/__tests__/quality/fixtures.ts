/**
 * Synthetic fixtures for the structural quality metrics. No consumer text, id
 * or figure: a German order list with a heading, a subtitle and an intro, a
 * search form and a filter form above a table, and a create form below it.
 */

import type { ElementDesignData, ExtendedComputedStyles } from '../../../core/types';
import type { ViewportDimensions } from '../../quality-types';

export type Rect = { x: number; y: number; width: number; height: number };
export type Structure = NonNullable<ElementDesignData['structure']>;
export type Group = NonNullable<Structure['group']>;

export const DESKTOP: ViewportDimensions = { width: 1280, height: 800 };

export function styles(overrides: Record<string, string> = {}): ExtendedComputedStyles {
  return {
    display: 'block',
    visibility: 'visible',
    opacity: '1',
    color: '#111111',
    backgroundColor: 'rgba(0, 0, 0, 0)',
    fontSize: '16px',
    fontFamily: 'Inter',
    fontWeight: '400',
    lineHeight: '24px',
    borderRadius: '0px',
    paddingTop: '0px',
    paddingLeft: '0px',
    position: 'static',
    overflow: 'visible',
    ...overrides,
  } as unknown as ExtendedComputedStyles;
}

/** A design-data element; `structure` (when given) is filled with harmless defaults. */
export function el(
  id: string,
  type: string,
  rect: Rect,
  structure?: Partial<Structure>,
  styleOverrides: Record<string, string> = {}
): ElementDesignData {
  return {
    elementId: id,
    type,
    rect,
    styles: styles(styleOverrides),
    ...(structure
      ? {
          structure: {
            tagName: 'div',
            visible: true,
            scrollWidth: rect.width,
            clientWidth: rect.width,
            scrollHeight: rect.height,
            clientHeight: rect.height,
            ...structure,
          },
        }
      : {}),
  };
}

export const LIST_REGION: Group = { key: 'list.region', kind: 'region', rect: { x: 0, y: 0, width: 1280, height: 1150 } };
export const SEARCH: Group = { key: 'search#1', kind: 'search', rect: { x: 40, y: 160, width: 1200, height: 170 } };
export const FILTERS: Group = { key: 'list.controls', kind: 'form', rect: { x: 40, y: 340, width: 1200, height: 220 } };
export const TABLE: Group = { key: 'list.table', kind: 'table', rect: { x: 40, y: 580, width: 1200, height: 520 } };
export const CREATE: Group = {
  key: 'form#2',
  kind: 'form',
  rect: { x: 40, y: 1200, width: 1200, height: 300 },
  label: 'Neuen Auftrag anlegen',
};

/** The synthetic order-list page at 1280 x 800. */
export function orderListPage(): ElementDesignData[] {
  return [
    el('view.root', 'generic', { x: 0, y: 0, width: 1280, height: 1550 }, { tagName: 'main' }),
    el('view.heading', 'heading', { x: 40, y: 20, width: 400, height: 40 }, {
      tagName: 'h1', parentId: 'view.root', group: LIST_REGION, text: 'Aufträge',
    }),
    el('view.subtitle', 'paragraph', { x: 40, y: 70, width: 800, height: 24 }, {
      tagName: 'p', parentId: 'view.root', group: LIST_REGION,
      text: 'Ihre Aufträge mit Lieferungen, Rechnungen und Summen.',
    }),
    el('view.intro', 'paragraph', { x: 40, y: 100, width: 1100, height: 48 }, {
      tagName: 'p', parentId: 'view.root', group: LIST_REGION,
      text: 'Ihre Aufträge und Lager: Versandadresse, Ihre Bestellnummer, die Lieferungen und, mit Freigabe, die Summen je Auftrag.',
    }),
    el('list.search-label', 'label', { x: 40, y: 165, width: 200, height: 20 }, {
      tagName: 'label', parentId: 'view.root', group: SEARCH, text: 'Suche',
    }),
    el('list.search', 'input', { x: 40, y: 190, width: 1200, height: 40 }, {
      tagName: 'input', role: 'searchbox', controlType: 'search', parentId: 'view.root', group: SEARCH,
    }),
    el('list.search-hint', 'paragraph', { x: 40, y: 235, width: 600, height: 20 }, {
      tagName: 'p', parentId: 'view.root', group: SEARCH, text: 'Name oder Nummer eingeben',
    }),
    el('list.search-submit', 'button', { x: 40, y: 270, width: 120, height: 40 }, {
      tagName: 'button', role: 'button', controlType: 'submit', parentId: 'view.root', group: SEARCH, text: 'Suchen',
    }, { backgroundColor: 'rgb(0, 90, 200)' }),
    el('list.filter-status', 'select', { x: 40, y: 370, width: 1200, height: 40 }, {
      tagName: 'select', role: 'combobox', parentId: 'view.root', group: FILTERS,
    }),
    el('list.sort', 'select', { x: 40, y: 450, width: 1200, height: 40 }, {
      tagName: 'select', role: 'combobox', parentId: 'view.root', group: FILTERS,
    }),
    el('list.controls-apply', 'button', { x: 40, y: 510, width: 120, height: 40 }, {
      tagName: 'button', role: 'button', controlType: 'submit', parentId: 'view.root', group: FILTERS, text: 'Anwenden',
    }, { backgroundColor: 'rgb(230, 230, 230)' }),
    el('list.table', 'generic', TABLE.rect, { tagName: 'table', role: 'table', parentId: 'view.root', group: TABLE }),
    ...['Auftragsname', 'Ihre Bestellnummer', 'Versandadresse', 'Status', 'Letzte Änderung'].map((text, i) =>
      el(`list.column-${i}`, 'generic', { x: 40 + i * 240, y: 590, width: 240, height: 40 }, {
        tagName: 'th', role: 'columnheader', parentId: 'list.table', group: TABLE, text,
      })
    ),
    ...[0, 1, 2].map((i) =>
      el(`list.name-${i}`, 'generic', { x: 40, y: 640 + i * 50, width: 240, height: 50 }, {
        tagName: 'th', role: 'rowheader', parentId: 'list.table', group: TABLE,
        text: `Auftrag Versandadresse Bestellnummer ${i}`,
      })
    ),
    el('editor.create-heading', 'heading', { x: 40, y: 1150, width: 600, height: 36 }, {
      tagName: 'h2', parentId: 'view.root', text: 'Neuen Auftrag anlegen',
    }),
    el('editor.create-name', 'input', { x: 40, y: 1220, width: 600, height: 40 }, {
      tagName: 'input', role: 'textbox', controlType: 'text', parentId: 'view.root', group: CREATE,
    }),
    el('editor.create-reference', 'input', { x: 40, y: 1290, width: 600, height: 40 }, {
      tagName: 'input', role: 'textbox', controlType: 'text', parentId: 'view.root', group: CREATE,
    }),
    el('editor.create-submit', 'button', { x: 40, y: 1360, width: 200, height: 40 }, {
      tagName: 'button', role: 'button', controlType: 'submit', parentId: 'view.root', group: CREATE, text: 'Auftrag anlegen',
    }, { backgroundColor: 'rgb(0, 90, 200)' }),
  ];
}

type Category = {
  score: number | null;
  hits: Array<{ elementIds: string[]; regionIds: string[]; reason: string; kind?: string; sharedTerms?: string[] }>;
};

/** One category of an `informationDensity` result's `rawData`. */
export function category(rawData: Record<string, unknown> | undefined, name: string): Category {
  const categories = rawData?.categories as Record<string, Category> | undefined;
  if (!categories) throw new Error('informationDensity reported no rawData.categories');
  return categories[name];
}
