// @vitest-environment node
/**
 * The numeric input boundary (`boundDensityItem`): every numeric field of a
 * capture item, whether built from a snapshot or read from a capture file,
 * is finite and inside its declared range, or it is `null` with its dimension
 * counted unmeasured (`input_missing`). Table-driven over every field.
 *
 * Plan: 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change (Phase 4).
 */
import { describe, expect, it } from 'vitest';
import { captureDensityFromSnapshot } from '../capture-from-snapshot';
import {
  DENSITY_MAX_COORDINATE_PX,
  parseDensityCapture,
  type DensityCapture,
  type DensityItem,
} from '../schema';
import {
  DENSITY_TEST_PRODUCER,
  densityTestSnapshot,
  type DensityTestElementSpec,
} from './fixtures/snapshot-builder';

const MAX = DENSITY_MAX_COORDINATE_PX;

function capture(spec: Partial<DensityTestElementSpec>): DensityCapture {
  const obs = captureDensityFromSnapshot(
    densityTestSnapshot({
      elements: [{ id: 'a', tag: 'span', xpath: '/html/body/span', text: 'Text', ...spec }],
    }),
    { producer: DENSITY_TEST_PRODUCER, evaluatedAt: '2026-11-23T10:00:00.000Z' }
  );
  if (obs.status !== 'measured') throw new Error(JSON.stringify(obs));
  return obs.value;
}

/** A field, a value outside its range, the field that must read null, and the dimension counted. */
type Row = {
  name: string;
  spec: Partial<DensityTestElementSpec>;
  file: (i: DensityItem) => DensityItem;
  field: 'rect' | 'fontPx' | 'lineHeightPx';
  dimension: string;
  /** The file door's reader already refuses this value (a negative size), so the file does not parse. */
  fileRefused?: boolean;
};

const ROWS: Row[] = [
  {
    name: 'rect.x beyond the ceiling',
    spec: { rect: [MAX * 2, 0, 100, 20] },
    file: (i) => ({ ...i, rect: { ...i.rect!, x: MAX * 2 } }),
    field: 'rect',
    dimension: 'rect',
  },
  {
    name: 'rect.y beyond the ceiling',
    spec: { rect: [0, 1.7e308, 100, 20] },
    file: (i) => ({ ...i, rect: { ...i.rect!, y: 1.7e308 } }),
    field: 'rect',
    dimension: 'rect',
  },
  {
    name: 'rect.x below the negative ceiling',
    spec: { rect: [-MAX * 2, 0, 100, 20] },
    file: (i) => ({ ...i, rect: { ...i.rect!, x: -MAX * 2 } }),
    field: 'rect',
    dimension: 'rect',
  },
  {
    name: 'rect.w negative',
    spec: { rect: [0, 0, -5, 20] },
    file: (i) => ({ ...i, rect: { ...i.rect!, w: -5 } }),
    field: 'rect',
    dimension: 'rect',
    fileRefused: true,
  },
  {
    name: 'rect.w beyond the ceiling',
    spec: { rect: [0, 0, MAX * 2, 20] },
    file: (i) => ({ ...i, rect: { ...i.rect!, w: MAX * 2 } }),
    field: 'rect',
    dimension: 'rect',
  },
  {
    name: 'rect.h beyond the ceiling',
    spec: { rect: [0, 0, 100, MAX * 2] },
    file: (i) => ({ ...i, rect: { ...i.rect!, h: MAX * 2 } }),
    field: 'rect',
    dimension: 'rect',
  },
  {
    name: 'fontPx below one pixel',
    spec: { styles: { fontSize: '0.5px' } },
    file: (i) => ({ ...i, fontPx: 0.5 }),
    field: 'fontPx',
    dimension: 'fontSize',
  },
  {
    name: 'fontPx beyond the ceiling',
    spec: { styles: { fontSize: `${'9'.repeat(12)}px` } },
    file: (i) => ({ ...i, fontPx: MAX * 2 }),
    field: 'fontPx',
    dimension: 'fontSize',
  },
  {
    name: 'lineHeightPx below one pixel',
    spec: { styles: { lineHeight: '0.000001px' } },
    file: (i) => ({ ...i, lineHeightPx: 1e-6 }),
    field: 'lineHeightPx',
    dimension: 'lineHeight',
  },
  {
    name: 'lineHeightPx beyond the ceiling',
    spec: { styles: { lineHeight: `1${'0'.repeat(308)}px` } },
    file: (i) => ({ ...i, lineHeightPx: 1e308 }),
    field: 'lineHeightPx',
    dimension: 'lineHeight',
  },
];

function gap(c: DensityCapture, dimension: string): number {
  return (
    c.coverage.unmeasured.find((u) => u.dimension === dimension && u.code === 'input_missing')
      ?.count ?? 0
  );
}

describe('the numeric input boundary', () => {
  it('runs with no DOM', () => {
    expect(typeof document).toBe('undefined');
  });

  it('an in-range item keeps every numeric field and records no gap', () => {
    const c = capture({ rect: [10, 20, 100, 20] });
    expect([c.items[0].rect, c.items[0].fontPx, c.items[0].lineHeightPx]).toEqual([
      { x: 10, y: 20, w: 100, h: 20 },
      14,
      20,
    ]);
    expect(c.coverage.unmeasured).toEqual([]);
  });

  it.each(ROWS)('from a snapshot: $name reads null and is counted unmeasured', (row) => {
    const c = capture(row.spec);
    expect(c.items[0][row.field]).toBeNull();
    expect(gap(c, row.dimension)).toBe(1);
  });

  it.each(ROWS)('from a capture file: $name reads null and is counted unmeasured', (row) => {
    const good = capture({ rect: [10, 20, 100, 20] });
    const forged = { ...good, items: good.items.map(row.file) };
    const parsed = parseDensityCapture(JSON.parse(JSON.stringify(forged)));
    expect(parsed.ok).toBe(!row.fileRefused);
    if (!parsed.ok) return;
    expect(parsed.value.items[0][row.field]).toBeNull();
    expect(gap(parsed.value, row.dimension)).toBe(1);
  });

  it.each([
    ['height', 1e308],
    ['height', 0.5],
    ['width', 1e308],
    ['scrollY', 1e308],
    ['scrollX', -1e308],
    ['documentHeight', 1e308],
  ] as const)('from a capture file: viewport.%s = %d does not parse', (field, value) => {
    const good = capture({ rect: [10, 20, 100, 20] });
    const forged = { ...good, viewport: { ...good.viewport, [field]: value } };
    expect(parseDensityCapture(JSON.parse(JSON.stringify(forged))).ok).toBe(false);
  });

  it('a viewport outside its range is no usable viewport (input_missing)', () => {
    const obs = captureDensityFromSnapshot(
      densityTestSnapshot({
        elements: [{ id: 'a', tag: 'span', xpath: '/html/body/span', text: 'Text' }],
        viewport: { viewportHeight: 0.5 },
      }),
      { producer: DENSITY_TEST_PRODUCER, evaluatedAt: '2026-11-23T10:00:00.000Z' }
    );
    expect(obs.status).toBe('unknown');
  });
});
