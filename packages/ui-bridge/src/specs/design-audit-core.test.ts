// @vitest-environment node
/**
 * The `/design/audit` core runs with no DOM.
 *
 * The package's vitest config runs every other file under jsdom; this one
 * runs under Node, where `document`, `window` and `HTMLElement` do not exist.
 * The React Native server reaches `auditDesign` through `./specs` under
 * Hermes, which has none of them either, so loading and running the core here
 * is the proof that the shared audit really is DOM-free. Plan:
 * 2026-11-21-native-design-audit-answers-like-web-design-audit-of.
 */

import { describe, expect, it } from 'vitest';
import type { ElementDesignData, ExtendedComputedStyles } from '../core/types';
import {
  auditDesign,
  DEFAULT_AUDIT_ELEMENT_LIMIT,
  DEFAULT_AUDIT_MAX_RESULTS,
  DesignRequestError,
  NO_STYLE_GUIDE_REASON,
  type DesignAuditAdapter,
  type DesignAuditResponse,
  type HeuristicCoverage,
  type HeuristicDesignAuditReport,
  type HeuristicInput,
  type StyleGuideDesignAuditReport,
} from './design-audit-core';
import type { StyleGuideConfig } from './style-types';

/** A plain registered-element record: no DOM node anywhere. */
interface PlainElement {
  id: string;
  type: string;
  readable: boolean;
  styles: Partial<ExtendedComputedStyles>;
  heuristic: Omit<HeuristicInput, 'id'>;
}

const CLEAN: Omit<HeuristicInput, 'id'> = {
  touchTarget: false,
  color: '#000000',
  backgroundColor: '#ffffff',
  fontSizePx: 16,
  rect: { width: 100, height: 50 },
};

function element(
  id: string,
  overrides: Partial<Omit<PlainElement, 'id' | 'heuristic'>> & {
    heuristic?: Partial<Omit<HeuristicInput, 'id'>>;
  } = {}
): PlainElement {
  return {
    id,
    type: overrides.type ?? 'view',
    readable: overrides.readable ?? true,
    styles: overrides.styles ?? {},
    heuristic: { ...CLEAN, ...overrides.heuristic },
  };
}

const roots: number[] = [];

const adapter: DesignAuditAdapter<PlainElement> = {
  isReadable: (el): el is PlainElement => el.readable,
  records: (kept) =>
    kept.map(
      (el) =>
        ({
          elementId: el.id,
          type: el.type,
          styles: el.styles as ExtendedComputedStyles,
          pseudoElements: [],
          rect: { x: 0, y: 0, width: 0, height: 0 },
        }) as ElementDesignData
    ),
  heuristicInput: (el) => ({ id: el.id, ...el.heuristic }),
  defaultRootFontSizePx: () => {
    roots.push(16);
    return 16;
  },
  heuristicCoverage: {
    contrast: { status: 'partial', note: 'own style only' },
    'select-dark-mode': { status: 'not-applicable' },
    'font-size': { status: 'measured' },
    'touch-target': { status: 'measured' },
  },
};

function guide(rules: StyleGuideConfig['rules']): StyleGuideConfig {
  return {
    version: '1.0.0',
    name: 'g',
    tokens: { spacing: { md: '1rem' } } as unknown as StyleGuideConfig['tokens'],
    rules,
  };
}

/** One rule: `paddingTop` must be `8px`. */
const padRule = guide([
  {
    id: 'pad',
    severity: 'error',
    constraints: [{ type: 'exact', property: 'paddingTop', value: '8px' }],
  },
]);

function styleGuide(report: DesignAuditResponse): StyleGuideDesignAuditReport {
  if (report.mode !== 'style-guide') throw new Error(`expected style-guide, got ${report.mode}`);
  return report;
}

function heuristic(report: DesignAuditResponse): HeuristicDesignAuditReport {
  if (report.mode !== 'heuristic') throw new Error(`expected heuristic, got ${report.mode}`);
  return report;
}

describe('design-audit-core under Node', () => {
  it('loads and runs with no DOM at all', () => {
    expect(typeof document).toBe('undefined');
    expect(typeof window).toBe('undefined');
    expect(typeof HTMLElement).toBe('undefined');
    const report = auditDesign([element('a')], {}, null, adapter);
    expect(report.mode).toBe('heuristic');
  });

  it('runs the heuristics with no guide, saying why, over plain records', () => {
    const report = heuristic(
      auditDesign(
        [
          element('faint', { heuristic: { color: '#808080', backgroundColor: '#828282' } }),
          element('tiny', { heuristic: { fontSizePx: 10 } }),
          element('tap', { heuristic: { touchTarget: true, rect: { width: 30, height: 30 } } }),
          element('ok'),
        ],
        undefined,
        undefined,
        adapter
      )
    );
    expect(report.reason).toBe(NO_STYLE_GUIDE_REASON);
    expect(report.checkedElements).toBe(4);
    expect(report.maxResults).toBe(DEFAULT_AUDIT_MAX_RESULTS);
    expect(report.limit).toBe(DEFAULT_AUDIT_ELEMENT_LIMIT);
    expect(report.issues.map((i) => [i.element, i.severity])).toEqual([
      ['faint', 'error'],
      ['tiny', 'info'],
      ['tap', 'warning'],
    ]);
    expect(report.issues[1].issue).toBe('Font size too small: 10px');
    expect(report.issues[2].issue).toBe('Touch target too small: 30x30px (min 44x44)');
  });

  it('audits against the request guide, failures only, with counts', () => {
    const els = [
      element('good', { styles: { paddingTop: '8px' } }),
      element('bad', { styles: { paddingTop: '4px' } }),
    ];
    const report = styleGuide(auditDesign(els, { guide: padRule }, null, adapter));
    expect(report.passedCount).toBe(1);
    expect(report.failedCount).toBe(1);
    expect(report.results.map((r) => r.elementId)).toEqual(['bad']);
    expect(report.summary).toEqual({ errors: 1, warnings: 0, info: 0 });
    expect(report.includePassed).toBe(false);
    expect(report.listableResults).toBe(1);

    const all = styleGuide(
      auditDesign(els, { guide: padRule, includePassed: true }, null, adapter)
    );
    expect(all.results.map((r) => r.elementId)).toEqual(['good', 'bad']);
    expect(all.includePassed).toBe(true);
  });

  it('falls back to the loaded guide; the request guide wins over it', () => {
    const els = [element('bad', { styles: { paddingTop: '4px' } })];
    expect(auditDesign(els, {}, padRule, adapter).mode).toBe('style-guide');
    const permissive = guide([]);
    const report = styleGuide(auditDesign(els, { guide: permissive }, padRule, adapter));
    expect(report.failedCount).toBe(0);
  });

  it('resolves rem against the request root, else the adapter default', () => {
    const remGuide = guide([
      {
        id: 'pad',
        constraints: [{ type: 'tokenRef', property: 'paddingTop', tokenPath: 'spacing.md' }],
      },
    ]);
    const els = [element('box', { styles: { paddingTop: '20px' } })];
    roots.length = 0;
    expect(styleGuide(auditDesign(els, { guide: remGuide }, null, adapter)).failedCount).toBe(1);
    expect(roots).toEqual([16]);
    const at20 = styleGuide(
      auditDesign(els, { guide: remGuide, rootFontSizePx: 20 }, null, adapter)
    );
    expect(at20.failedCount).toBe(0);
    expect(roots).toEqual([16]);
  });

  it('bounds the elements by limit, below, at and above the count', () => {
    const els = [element('a'), element('b'), element('c')];
    for (const [limit, checked, truncated] of [
      [2, 2, true],
      [3, 3, false],
      [4, 3, false],
    ] as const) {
      const report = auditDesign(els, { limit }, null, adapter);
      expect(report, String(limit)).toMatchObject({
        limit,
        checkedElements: checked,
        totalElements: 3,
        truncated,
      });
    }
  });

  it('cuts the listed findings at maxResults in both modes, below, at and above', () => {
    const small = { heuristic: { fontSizePx: 10 } };
    const els = [element('a', small), element('b', small), element('c', small)];
    for (const [maxResults, listed, cut] of [
      [2, 2, true],
      [3, 3, false],
      [4, 3, false],
    ] as const) {
      const h = heuristic(auditDesign(els, { maxResults }, null, adapter));
      expect(h.issues).toHaveLength(listed);
      expect(h).toMatchObject({ maxResults, listableResults: 3, resultsTruncated: cut });
    }
    const bad = { styles: { paddingTop: '1px' } };
    const failing = [element('a', bad), element('b', bad), element('c', bad)];
    const s = styleGuide(auditDesign(failing, { guide: padRule, maxResults: 2 }, null, adapter));
    expect(s.results).toHaveLength(2);
    expect(s).toMatchObject({ listableResults: 3, resultsTruncated: true, failedCount: 3 });
  });

  it('echoes missing and unreadable ids, and checks only readable elements', () => {
    const els = [element('a'), element('ghost', { readable: false })];
    const report = auditDesign(els, { elementIds: ['a', 'ghost', 'nope'] }, null, adapter);
    expect(report).toMatchObject({
      totalElements: 1,
      checkedElements: 1,
      missingElementIds: ['nope'],
      missingElementCount: 1,
      unreadableElementIds: ['ghost'],
      unreadableElementCount: 1,
    });
    const none = auditDesign(els, { elementIds: [] }, null, adapter);
    expect(none.checkedElements).toBe(0);
  });

  it('refuses a malformed body field by field, in one fixed order', () => {
    const cases: Array<[unknown, RegExp]> = [
      ['g', /the request body must be a JSON object/],
      [{ rootFontSizePx: 0, elementIds: 'a' }, /rootFontSizePx must be a finite number/],
      [{ elementIds: 'a', guide: 'g' }, /elementIds must be an array of strings/],
      [{ guide: { rules: 'x' }, limit: 0 }, /guide must be a style guide object/],
      [{ limit: 0, includePassed: 'yes' }, /limit must be an integer >= 1/],
      [{ limit: 1.5 }, /limit must be an integer >= 1/],
      [{ limit: '2' }, /limit must be an integer >= 1/],
      [{ includePassed: 'yes', maxResults: 0 }, /includePassed must be a boolean/],
      [{ maxResults: 0 }, /maxResults must be an integer >= 1/],
    ];
    for (const [body, message] of cases) {
      let thrown: unknown;
      try {
        auditDesign([element('a')], body, null, adapter);
      } catch (err) {
        thrown = err;
      }
      expect(thrown, JSON.stringify(body)).toBeInstanceOf(DesignRequestError);
      expect((thrown as DesignRequestError).code).toBe('INVALID_REQUEST');
      expect((thrown as Error).message).toMatch(message);
    }
  });
});

describe('heuristic coverage', () => {
  function coverage(report: HeuristicDesignAuditReport, id: HeuristicCoverage['heuristic']) {
    const row = report.heuristicCoverage.find((r) => r.heuristic === id);
    if (!row) throw new Error(`no coverage row for ${id}`);
    return row;
  }

  it('lists one row per heuristic, with the adapter-declared status and note', () => {
    const report = heuristic(auditDesign([element('a')], {}, null, adapter));
    expect(report.heuristicCoverage).toEqual([
      {
        heuristic: 'contrast',
        status: 'partial',
        checked: 1,
        notMeasured: 0,
        note: 'own style only',
      },
      { heuristic: 'select-dark-mode', status: 'not-applicable', checked: 0, notMeasured: 0 },
      { heuristic: 'font-size', status: 'measured', checked: 1, notMeasured: 0 },
      { heuristic: 'touch-target', status: 'measured', checked: 0, notMeasured: 0 },
    ]);
  });

  it('an unjudgeable contrast is not measured and produces no issue', () => {
    for (const colours of [
      { color: '#000000', backgroundColor: 'transparent' },
      { color: '#000000', backgroundColor: '' },
      { color: '', backgroundColor: '#ffffff' },
      { color: 'not-a-colour', backgroundColor: '#ffffff' },
    ]) {
      const report = heuristic(
        auditDesign([element('a', { heuristic: colours })], {}, null, adapter)
      );
      expect(report.issues, JSON.stringify(colours)).toEqual([]);
      expect(coverage(report, 'contrast')).toMatchObject({ checked: 0, notMeasured: 1 });
    }
  });

  it('a null rect is a touch target not measured, never a 0x0 finding', () => {
    const report = heuristic(
      auditDesign(
        [element('tap', { heuristic: { touchTarget: true, rect: null } })],
        {},
        null,
        adapter
      )
    );
    expect(report.issues).toEqual([]);
    expect(coverage(report, 'touch-target')).toMatchObject({ checked: 0, notMeasured: 1 });
  });

  it('counts a touch target only for an interactive element', () => {
    const report = heuristic(
      auditDesign(
        [
          element('tap', { heuristic: { touchTarget: true, rect: { width: 30, height: 30 } } }),
          element('big', { heuristic: { touchTarget: true, rect: { width: 50, height: 50 } } }),
          element('box', { heuristic: { touchTarget: false, rect: null } }),
        ],
        {},
        null,
        adapter
      )
    );
    expect(report.issues.map((i) => i.element)).toEqual(['tap']);
    expect(coverage(report, 'touch-target')).toMatchObject({ checked: 2, notMeasured: 0 });
  });

  it('an unknown font size is not measured, and its contrast is judged as normal text', () => {
    // #888888 on white is about 3.54:1: under 4.5 (normal text), over 3 (large).
    const report = heuristic(
      auditDesign(
        [element('grey', { heuristic: { color: '#888888', fontSizePx: null } })],
        {},
        null,
        adapter
      )
    );
    expect(coverage(report, 'font-size')).toMatchObject({ checked: 0, notMeasured: 1 });
    expect(report.issues).toEqual([expect.objectContaining({ element: 'grey', severity: 'info' })]);
    expect(report.issues[0].issue).toMatch(/Insufficient contrast for normal text/);
    const large = heuristic(
      auditDesign(
        [element('grey', { heuristic: { color: '#888888', fontSizePx: 24 } })],
        {},
        null,
        adapter
      )
    );
    expect(large.issues).toEqual([]);
  });

  it('a <select> whose own colours cannot be read is not measured and produces no issue', () => {
    const selects = [
      { color: 'not-a-colour', backgroundColor: '#111111', select: { colorScheme: 'normal' } },
      { color: '#ffffff', backgroundColor: 'transparent', select: { colorScheme: 'normal' } },
      {
        // Unjudgeable own colours: the judgeable (and failing) option is not reported either.
        color: 'not-a-colour',
        backgroundColor: '#111111',
        select: { colorScheme: 'normal', option: { color: '#ffffff', backgroundColor: '#ffffff' } },
      },
    ];
    for (const heuristicInput of selects) {
      const report = heuristic(
        auditDesign([element('pick', { heuristic: heuristicInput })], {}, null, adapter)
      );
      const label = JSON.stringify(heuristicInput);
      expect(coverage(report, 'select-dark-mode'), label).toMatchObject({
        checked: 0,
        notMeasured: 1,
      });
      expect(
        report.issues.filter((i) => i.issue.startsWith('Select')),
        label
      ).toEqual([]);
    }
  });

  it('an unjudgeable <option> does not suppress the select-level warning, and raises no option error', () => {
    // A browser-default <option> has a transparent background: its contrast
    // cannot be judged, but the select's own light-on-dark colours can.
    const report = heuristic(
      auditDesign(
        [
          element('pick', {
            heuristic: {
              color: '#ffffff',
              backgroundColor: '#111111',
              select: {
                colorScheme: 'normal',
                option: { color: '#ffffff', backgroundColor: 'transparent' },
              },
            },
          }),
        ],
        {},
        null,
        adapter
      )
    );
    expect(coverage(report, 'select-dark-mode')).toMatchObject({ checked: 1, notMeasured: 0 });
    expect(report.issues.filter((i) => i.issue.startsWith('Select'))).toEqual([
      expect.objectContaining({ element: 'pick', severity: 'warning' }),
    ]);
    expect(report.issues[0].issue).toMatch(/^Select has light text/);
  });

  it('counts each <select> the adapter describes as select-dark-mode checked', () => {
    const report = heuristic(
      auditDesign(
        [
          element('pick', {
            heuristic: {
              color: '#ffffff',
              backgroundColor: '#111111',
              select: {
                colorScheme: 'normal',
                option: { color: '#ffffff', backgroundColor: '#ffffff' },
              },
            },
          }),
          element('plain'),
        ],
        {},
        null,
        adapter
      )
    );
    expect(coverage(report, 'select-dark-mode')).toMatchObject({ checked: 1, notMeasured: 0 });
    expect(report.issues.map((i) => [i.element, i.severity])).toEqual([
      ['pick', 'warning'],
      ['pick', 'error'],
    ]);
  });
});
