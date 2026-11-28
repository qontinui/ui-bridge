/**
 * `/design/evaluate`'s structure read (`ai/design-structure.ts`): the nearest
 * REGISTERED ancestor, the functional group (registered or not), redaction,
 * control types, unregistered text blocks, and that no other design route
 * returns the new fields.
 *
 * jsdom lays nothing out, so each element is given a box
 * (`getBoundingClientRect`) — the one input a browser would compute.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectStructure } from '../design-structure';
import { collectDesignBatch, collectDesignData, evaluateRegisteredQuality } from '../../specs/quality-request';

function box(el: Element, x: number, y: number, width: number, height: number): void {
  (el as HTMLElement).getBoundingClientRect = () => new DOMRect(x, y, width, height);
}

let root: HTMLElement;

beforeEach(() => {
  root = document.createElement('div');
  root.innerHTML = `
    <main id="main">
      <span class="page-context">Ihre Aufträge mit Lieferungen und Summen.</span>
      <section aria-label="Liste">
        <div class="wrapper">
          <p id="intro">Ihre Aufträge und die Lieferungen je Auftrag.</p>
        </div>
        <form id="create">
          <div class="row"><input id="name" type="text"></div>
          <button id="go" type="submit">Anlegen</button>
        </form>
        <table id="tbl"><tr><th id="col">Auftragsname</th></tr></table>
        <p id="secret" data-bridge-redact="true">Kontonummer und Lieferadresse</p>
      </section>
    </main>`;
  document.body.appendChild(root);
  let y = 0;
  for (const node of Array.from(root.querySelectorAll('*'))) {
    box(node, 0, y, 600, 30);
    y += 32;
  }
});

afterEach(() => {
  root.remove();
});

const byId = (id: string) => document.getElementById(id) as HTMLElement;

describe('collectStructure', () => {
  it('gives the nearest registered ancestor across an unregistered wrapper', () => {
    const live = [
      { id: 'reg.main', element: byId('main') },
      { id: 'reg.intro', element: byId('intro') },
    ];
    const { structure } = collectStructure(live);
    expect(structure.get('reg.intro')?.parentId).toBe('reg.main');
    expect(structure.get('reg.main')?.parentId).toBeUndefined();
  });

  it('finds an unregistered form and table as the functional group', () => {
    const live = [
      { id: 'reg.name', element: byId('name') },
      { id: 'reg.go', element: byId('go') },
      { id: 'reg.col', element: byId('col') },
    ];
    const { structure } = collectStructure(live);
    expect(structure.get('reg.name')?.group).toMatchObject({ key: 'form#1', kind: 'form', label: 'Liste' });
    expect(structure.get('reg.go')?.group?.key).toBe('form#1');
    expect(structure.get('reg.col')?.group).toMatchObject({ key: 'table#1', kind: 'table' });
  });

  it('keys a registered group by its registered id', () => {
    const live = [
      { id: 'reg.form', element: byId('create') },
      { id: 'reg.name', element: byId('name') },
    ];
    expect(collectStructure(live).structure.get('reg.name')?.group?.key).toBe('reg.form');
  });

  it('reads the control type of a submit button and text only for text-bearing elements', () => {
    const live = [
      { id: 'reg.go', element: byId('go') },
      { id: 'reg.intro', element: byId('intro') },
      { id: 'reg.name', element: byId('name') },
    ];
    const { structure } = collectStructure(live);
    expect(structure.get('reg.go')?.controlType).toBe('submit');
    expect(structure.get('reg.go')?.text).toBe('Anlegen');
    expect(structure.get('reg.intro')?.text).toBe('Ihre Aufträge und die Lieferungen je Auftrag.');
    expect(structure.get('reg.name')?.text).toBeUndefined();
  });

  it('reads a redaction boundary as the sentinel, never its text', () => {
    const { structure } = collectStructure([{ id: 'reg.secret', element: byId('secret') }]);
    expect(structure.get('reg.secret')?.text).toBe('[REDACTED]');
  });

  it('collects an unregistered text block under a synthetic id', () => {
    const { textBlocks } = collectStructure([{ id: 'reg.intro', element: byId('intro') }]);
    const block = textBlocks.find((b) => b.tagName === 'span');
    expect(block).toMatchObject({ id: 'dom:span.page-context#1', text: 'Ihre Aufträge mit Lieferungen und Summen.' });
    // The registered paragraph is not a block of its own, and neither is the redacted one's text.
    expect(textBlocks.some((b) => b.text.includes('Ihre Aufträge und die Lieferungen'))).toBe(false);
    expect(textBlocks.some((b) => b.text.includes('Kontonummer'))).toBe(false);
  });

  it('reads a nested unregistered text block once, as part of its outer block', () => {
    const outer = document.createElement('div');
    outer.innerHTML = 'Lieferungen der letzten Woche <span>und die Summen je Auftrag</span>';
    byId('main').appendChild(outer);
    box(outer, 0, 400, 600, 30);
    box(outer.querySelector('span')!, 0, 400, 300, 30);
    const { textBlocks } = collectStructure([{ id: 'reg.main', element: byId('main') }]);
    const hits = textBlocks.filter((b) => b.text.includes('Summen je Auftrag'));
    expect(hits).toHaveLength(1);
    expect(hits[0].tagName).toBe('div');
  });

  it('does not re-read the text of a registered element with a text role', () => {
    const heading = document.createElement('div');
    heading.setAttribute('role', 'heading');
    heading.innerHTML = '<span>Offene Auftraege dieser Woche</span>';
    byId('main').appendChild(heading);
    box(heading, 0, 440, 600, 30);
    box(heading.querySelector('span')!, 0, 440, 300, 30);
    const { structure, textBlocks } = collectStructure([{ id: 'reg.heading', element: heading }]);
    expect(structure.get('reg.heading')?.text).toBe('Offene Auftraege dieser Woche');
    expect(textBlocks.some((b) => b.text.includes('Offene Auftraege'))).toBe(false);
  });

  it('does not read a block that wraps a registered text element', () => {
    const wrap = document.createElement('div');
    wrap.innerHTML = 'Hinweis zu den Lieferungen: <p>Lieferungen und Summen je Auftrag</p>';
    byId('main').appendChild(wrap);
    const p = wrap.querySelector('p')!;
    box(wrap, 0, 480, 600, 60);
    box(p, 0, 510, 600, 30);
    const { textBlocks } = collectStructure([{ id: 'reg.note', element: p }]);
    expect(textBlocks.some((b) => b.text.includes('Summen je Auftrag'))).toBe(false);
  });

  it('marks an element inside an unregistered horizontal scroller, and not one inside a vertical pane', () => {
    const strip = document.createElement('div');
    strip.style.overflowX = 'auto';
    const card = document.createElement('div');
    strip.appendChild(card);
    const pane = document.createElement('div');
    pane.style.overflowY = 'auto';
    pane.style.overflowX = 'auto';
    const item = document.createElement('div');
    pane.appendChild(item);
    byId('main').append(strip, pane);
    Object.defineProperty(strip, 'scrollWidth', { configurable: true, value: 2400 });
    Object.defineProperty(strip, 'clientWidth', { configurable: true, value: 600 });
    // The pane scrolls on both axes: a wide child forced its x scroll.
    Object.defineProperty(pane, 'scrollWidth', { configurable: true, value: 1600 });
    Object.defineProperty(pane, 'clientWidth', { configurable: true, value: 1280 });
    Object.defineProperty(pane, 'scrollHeight', { configurable: true, value: 2400 });
    Object.defineProperty(pane, 'clientHeight', { configurable: true, value: 800 });
    for (const [n, y] of [[card, 600], [item, 700]] as const) box(n, 0, y, 300, 40);
    const { structure } = collectStructure([
      { id: 'reg.card', element: card },
      { id: 'reg.item', element: item },
    ]);
    expect(structure.get('reg.card')?.insideHorizontalScroller).toBe(true);
    expect(structure.get('reg.item')?.insideHorizontalScroller).toBe(false);
  });

  it('reads a one-pixel box as visually hidden, not as content', () => {
    box(byId('col'), 0, 0, 1, 1);
    const { structure } = collectStructure([{ id: 'reg.col', element: byId('col') }]);
    expect(structure.get('reg.col')).toMatchObject({ visible: false, hiddenReason: 'clipped' });
  });
});

describe('structure reaches only /design/evaluate', () => {
  const sources = () => [
    { id: 'reg.intro', element: byId('intro'), type: 'paragraph' },
    { id: 'reg.name', element: byId('name'), type: 'input' },
  ];

  it('is absent from design data collected for the other routes', () => {
    for (const data of collectDesignData(sources(), undefined, { customProperties: false })) {
      expect(data).not.toHaveProperty('structure');
    }
    expect(collectDesignBatch(sources(), undefined, { customProperties: false })).not.toHaveProperty('textBlocks');
  });

  it('is collected for /design/evaluate, whose report carries no element payload', () => {
    const report = evaluateRegisteredQuality(sources(), {}, null);
    expect(report).not.toHaveProperty('elements');
    const density = report.metrics.find((m) => m.metricId === 'informationDensity');
    expect(density?.rawData).toHaveProperty('categories');
  });
});
