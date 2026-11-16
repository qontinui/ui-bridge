import { describe, it, expect, afterEach } from 'vitest';
import { findElementsByText } from './dom-fallback';
import { findByTextPrimitive } from './page-primitives';

/**
 * Cost of text matching on a large page with a `data-bridge-redact` boundary.
 *
 * `findElementsByText` reads every candidate's visible text; since #395 a
 * candidate with a boundary below it reads through `textOutsideBoundaries`
 * (a TreeWalker over its subtree) instead of one `textContent`. This file
 * measures that against the pre-#395 reader (`LEGACY_*` below, copied from
 * `git show 52fd885d^` — `computeVisibleText` and `findElementsByText`) on the
 * same DOM.
 *
 * Measurement only: skipped unless `UIB_MEASURE_WALK_COST=1`, because timings
 * are not deterministic. Run:
 *   UIB_MEASURE_WALK_COST=1 npx vitest run src/server/dom-fallback.walk-cost.test.ts
 *
 * Recorded 2026-11-16 (jsdom, node 24, median of 7 runs after a warm-up, ms,
 * on a loaded shared box, so compare columns within a row, not across rows).
 * `legacy` is the pre-#395 reader; `before` is findElementsByText over one
 * `withBoundaryIndex` scan with a per-visit `Array.from(children).find` (the
 * previous revision); `after` is the same scan with a per-frame child cursor
 * (now). Every element is a candidate. Optional `UIB_WALK_CASES=<regex>` runs
 * only the matching cases.
 *   case                          nodes  legacy  before  after
 *   10k, boundary none             8500    32      89      87
 *   10k, boundary top              8501    33      93      98
 *   10k, boundary middle           8501    33      90      99
 *   10k, boundary bottom           8501    34      88      89
 *   5k  top                        4251    16      42      46
 *   20k top                       17001    75     197     197
 *   40k top                       34001   181     420     428
 *   10k top, 1 section             8006    33     141     188
 *   10k top, 1 section, deep 200   8202   443     954    1035
 *   wide parent, 1k rows           4001    12   11020      66
 * Growth is linear in nodes everywhere except the wide parent, where the old
 * rescan was super-linear (1k rows: 11 s; 5k rows did not finish in 10 min) and
 * is now a single pass over the parent's children. The other rows are within
 * run-to-run noise of each other.
 */
const MEASURE = process.env.UIB_MEASURE_WALK_COST === '1';
const RUNS = 7;

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

// Pre-#395 computeVisibleText (52fd885d^): innerText when non-empty, else textContent.
function legacyVisibleText(node: Element): string | undefined {
  const inner = (node as HTMLElement).innerText;
  const raw = typeof inner === 'string' && inner.length > 0 ? inner : (node.textContent ?? '');
  return normalize(raw) || undefined;
}

// Pre-#395 findElementsByText body.
function legacyFindElementsByText(root: HTMLElement, text: string, exact: boolean): HTMLElement[] {
  const results: HTMLElement[] = [];
  const searchText = text.toLowerCase();
  root.querySelectorAll<HTMLElement>('*').forEach((el) => {
    const elText = legacyVisibleText(el)?.toLowerCase() ?? '';
    if (exact ? elText === searchText : elText.includes(searchText)) results.push(el);
  });
  return results;
}

type BoundaryAt = 'none' | 'top' | 'middle' | 'bottom';

/**
 * ~`rows * 5 + sections` nodes: `sections` sections of `rows` rows, each row a
 * div holding a label span, a value span and a bold. Every 50th row carries
 * "needle". The boundary is a leaf-ish `<p data-bridge-redact>` placed as the
 * first child of the first section ("top"), of the middle section, or of the
 * last section ("bottom"). Sections nest `depth` wrappers deep so ancestors of
 * the boundary number `depth + 2`.
 */
function buildPage(sections: number, rows: number, depth: number, at: BoundaryAt): HTMLElement {
  const root = document.createElement('div');
  const mkSection = (s: number) => {
    const sec = document.createElement('section');
    let inner: HTMLElement = sec;
    for (let d = 0; d < depth; d++) {
      const w = document.createElement('div');
      inner.appendChild(w);
      inner = w;
    }
    const markAt =
      at === 'top'
        ? 0
        : at === 'middle'
          ? Math.floor(sections / 2)
          : at === 'bottom'
            ? sections - 1
            : -1;
    if (s === markAt) {
      const p = document.createElement('p');
      p.setAttribute('data-bridge-redact', 'true');
      p.textContent = 'secret-123-45-6789';
      inner.appendChild(p);
    }
    for (let r = 0; r < rows; r++) {
      const row = document.createElement('div');
      const a = document.createElement('span');
      a.textContent = `label ${s}-${r}`;
      const b = document.createElement('span');
      b.textContent = r % 50 === 0 ? 'needle value' : `value ${r}`;
      const c = document.createElement('b');
      c.textContent = 'x';
      row.append(a, b, c);
      inner.appendChild(row);
    }
    return sec;
  };
  for (let s = 0; s < sections; s++) root.appendChild(mkSection(s));
  return root;
}

/**
 * One parent with `rows` direct children, each a row holding a label span, a
 * value span and a redacted `<p data-bridge-redact>` cell: every child is an
 * ancestor of a boundary, so the parent's text composes `rows` pending children.
 */
function buildWideParent(rows: number): HTMLElement {
  const root = document.createElement('div');
  const parent = document.createElement('section');
  for (let r = 0; r < rows; r++) {
    const row = document.createElement('div');
    const a = document.createElement('span');
    a.textContent = `label ${r}`;
    const b = document.createElement('span');
    b.textContent = r % 50 === 0 ? 'needle value' : `value ${r}`;
    const cell = document.createElement('p');
    cell.setAttribute('data-bridge-redact', 'true');
    cell.textContent = 'secret-123-45-6789';
    row.append(a, b, cell);
    parent.appendChild(row);
  }
  root.appendChild(parent);
  return root;
}

function median(ms: number[]): number {
  const s = [...ms].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

function time(fn: () => void): number {
  fn(); // warm-up
  const samples: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  return median(samples);
}

describe.skipIf(!MEASURE)('find-by-text boundary walk cost (measurement)', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  const cases: {
    label: string;
    sections: number;
    rows: number;
    depth: number;
    at: BoundaryAt;
    wide?: boolean;
  }[] = [];
  for (const at of ['none', 'top', 'middle', 'bottom'] as BoundaryAt[]) {
    cases.push({ label: `10k ${at}`, sections: 100, rows: 20, depth: 4, at });
  }
  // Scaling: doubling nodes with the boundary near the top.
  cases.push({ label: '5k top', sections: 50, rows: 20, depth: 4, at: 'top' });
  cases.push({ label: '20k top', sections: 200, rows: 20, depth: 4, at: 'top' });
  cases.push({ label: '40k top', sections: 400, rows: 20, depth: 4, at: 'top' });
  // One huge section: the boundary's ancestors all contain the whole page.
  cases.push({ label: '10k top, 1 section', sections: 1, rows: 2000, depth: 4, at: 'top' });
  cases.push({
    label: '10k top, 1 section, deep 200',
    sections: 1,
    rows: 2000,
    depth: 200,
    at: 'top',
  });

  cases.push({
    label: 'wide parent 1k rows',
    sections: 1,
    rows: 1000,
    depth: 0,
    at: 'top',
    wide: true,
  });

  it('prints the table', { timeout: 3_600_000 }, () => {
    const lines: string[] = [];
    lines.push('case | nodes | candidates | matches | legacy ms | after ms | ratio | primitive ms');
    const only = process.env.UIB_WALK_CASES ? new RegExp(process.env.UIB_WALK_CASES) : null;
    for (const c of cases) {
      if (only && !only.test(c.label)) continue;
      const root = c.wide ? buildWideParent(c.rows) : buildPage(c.sections, c.rows, c.depth, c.at);
      document.body.appendChild(root);
      const nodes = root.querySelectorAll('*').length;
      const legacy = time(() => legacyFindElementsByText(root, 'needle', false));
      const after = time(() => findElementsByText('needle', { root }));
      const prim = time(() => {
        findByTextPrimitive('needle', {});
      });
      const matches = findElementsByText('needle', { root }).length;
      // Same hit set once the boundary text is excluded (the boundary holds no "needle").
      expect(matches).toBe(legacyFindElementsByText(root, 'needle', false).length);
      lines.push(
        `${c.label} | ${nodes} | ${nodes} | ${matches} | ${legacy.toFixed(1)} | ${after.toFixed(1)} | ${(after / legacy).toFixed(2)}x | ${prim.toFixed(1)}`
      );
      process.stdout.write(lines[lines.length - 1] + '\n');
      root.remove();
    }
  });
});
