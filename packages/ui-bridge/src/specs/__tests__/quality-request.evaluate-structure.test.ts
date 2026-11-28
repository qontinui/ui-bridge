/**
 * `/design/evaluate` (`evaluateRegisteredQuality`, the function both
 * transports call) measures the visible union, real overflow and structural
 * density on a live page — the entry point the population uses, not the metric
 * functions directly.
 *
 * jsdom lays nothing out, so each element is given a box.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { evaluateRegisteredQuality } from '../quality-request';

let root: HTMLElement;

function box(el: Element, x: number, y: number, width: number, height: number): void {
  (el as HTMLElement).getBoundingClientRect = () => new DOMRect(x, y, width, height);
}

beforeEach(() => {
  root = document.createElement('div');
  root.innerHTML = `
    <main id="main">
      <p id="sub">Ihre Aufträge mit Lieferungen, Rechnungen und Summen.</p>
      <p id="intro">Ihre Aufträge und Lager: die Lieferungen und die Summen je Auftrag.</p>
      <section id="list"><p id="row">Erste Zeile</p></section>
      <form id="create"><input id="name" type="text"><button id="go" type="submit">Anlegen</button></form>
    </main>`;
  document.body.appendChild(root);
  box(byId('main'), 0, 0, 1024, 700);
  box(byId('sub'), 0, 10, 600, 24);
  box(byId('intro'), 0, 40, 600, 24);
  box(byId('list'), 0, 80, 1024, 600);
  box(byId('row'), 0, 90, 1024, 30);
  box(byId('create'), 0, 2000, 600, 100);
  box(byId('name'), 0, 2010, 300, 40);
  box(byId('go'), 0, 2060, 100, 30);
});

afterEach(() => root.remove());

const byId = (id: string) => document.getElementById(id) as HTMLElement;

describe('evaluateRegisteredQuality', () => {
  it('reports coverage as a visible union and the information-density categories', () => {
    const sources = ['main', 'sub', 'intro', 'list', 'row', 'name', 'go'].map((id) => ({
      id,
      element: byId(id),
      type: id === 'name' ? 'input' : id === 'go' ? 'button' : 'generic',
    }));
    const report = evaluateRegisteredQuality(sources, { viewport: { width: 1024, height: 768 } }, null);
    const metric = (id: string) => report.metrics.find((m) => m.metricId === id)!;

    // Summing every box read 1.79 viewports here; the union of the rendered
    // leaves (sub, intro, row) is (600*24*2 + 1024*30) / (1024*768) = 0.0757.
    expect(metric('elementDensity').rawData?.coverage).toBeCloseTo(0.0757, 4);
    expect(metric('elementDensity').rawData?.leafBy).toBe('parentId');

    // The form starts 2010 px down, below the 768 px first screen: page length is not overflow.
    expect(metric('contentOverflow').score).toBe(100);

    // The report's three categories, in their published order: redundant text,
    // disproportionate space, primary action below the fold.
    const categories = metric('informationDensity').rawData?.categories as Record<string, { hits: Array<{ elementIds: string[]; regionIds: string[] }> }>;
    const [text, space, fold] = Object.values(categories);
    expect(Object.keys(categories)).toHaveLength(3);
    expect(text.hits[0].elementIds).toEqual(['sub', 'intro']);
    expect(space.hits).toEqual([]);
    expect(fold.hits[0].elementIds).toEqual(['go', 'name']);
    expect(fold.hits[0].regionIds).toEqual(['form#1']);
  });
});
