import { afterEach, describe, expect, it } from 'vitest';
import * as specs from '@qontinui/ui-bridge/specs';
import { NativeUIBridgeRegistry } from '../../core/registry';
import { DefaultNativeActionExecutor } from '../../control/action-executor';
import { NativeUIBridgeServer } from '../http-server';
import { createDesignHandlers } from '../design-handlers';
import {
  asDesignAuditCore,
  type DesignAuditCoreModule,
  type NativeDesignAuditResponse,
  type NativeHeuristicDesignAuditReport,
  type NativeHeuristicId,
  type NativeStyleGuideDesignAuditReport,
} from '../design-audit-native';
import type { APIResponse, HandlerContext } from '../types';
import type { NativeElementRef, NativeLayout, NativeElementType } from '../../core/types';

/**
 * Native `/design/audit` answers through the web SDK's shared core
 * (`auditDesign`, `@qontinui/ui-bridge/specs` 0.57.0 or later), so it takes
 * and refuses the web transports' fields and answers their shape: `limit`,
 * `includePassed`, `maxResults`, both modes, the bounds. The real core is
 * injected (as the workspace build serves it), wrapped to record what native
 * hands it, because `vi.mock` does not intercept the handlers' CJS `require`.
 * Each React Native difference is pinned here. Plan:
 * 2026-11-21-native-design-audit-answers-like-web-design-audit-of.
 */

const HEURISTIC_REASON = 'No style guide was provided in the request or loaded with loadStyleGuide';

function makeRef(): React.RefObject<NativeElementRef> {
  return { current: {} as NativeElementRef };
}

function ctx(body: unknown): HandlerContext {
  return { params: {}, query: {}, body } as unknown as HandlerContext;
}

function layout(width: number, height: number): NativeLayout {
  return { x: 0, y: 0, width, height, pageX: 0, pageY: 0 };
}

interface Spec {
  type?: NativeElementType;
  style?: Record<string, unknown>;
  layout?: NativeLayout | null;
}

function registryOf(elements: Record<string, Spec>): NativeUIBridgeRegistry {
  const registry = new NativeUIBridgeRegistry();
  for (const [id, spec] of Object.entries(elements)) {
    registry.registerElement(id, makeRef(), { type: spec.type ?? 'view' });
    if (spec.style) registry.updateElementStyle(id, spec.style);
    if (spec.layout) {
      registry.updateElementState(id, {
        mounted: true,
        visible: true,
        enabled: true,
        focused: false,
        layout: spec.layout,
      });
    }
  }
  return registry;
}

/** The real core, recording how many elements each audit's records and heuristics read. */
function recordingCore(): { core: DesignAuditCoreModule; reads: number[] } {
  const real = asDesignAuditCore(specs);
  if (!real)
    throw new Error('the workspace build of @qontinui/ui-bridge/specs carries no auditDesign');
  const reads: number[] = [];
  const core: DesignAuditCoreModule = {
    auditDesign: (elements, request, loadedGuide, adapter) =>
      real.auditDesign(elements, request, loadedGuide, {
        ...adapter,
        records: (kept, guide) => {
          reads.push(kept.length);
          return adapter.records(kept, guide);
        },
      }),
  };
  return { core, reads };
}

function handlersFor(registry: NativeUIBridgeRegistry, core?: DesignAuditCoreModule) {
  return createDesignHandlers(registry, undefined, { designAudit: core ?? recordingCore().core });
}

function guideOf(rules: unknown[], tokens: Record<string, unknown> = {}) {
  return { version: '1.0', name: 'g', tokens, rules };
}

/** `paddingTop` must be exactly `8px`, on every element. */
const padGuide = guideOf([
  {
    id: 'pad',
    severity: 'error',
    constraints: [{ type: 'exact', property: 'paddingTop', value: '8px' }],
  },
]);

function styleGuide(
  res: APIResponse<NativeDesignAuditResponse>
): NativeStyleGuideDesignAuditReport {
  expect(res.success, res.error).toBe(true);
  if (res.data?.mode !== 'style-guide')
    throw new Error(`expected style-guide, got ${res.data?.mode}`);
  return res.data;
}

function heuristic(res: APIResponse<NativeDesignAuditResponse>): NativeHeuristicDesignAuditReport {
  expect(res.success, res.error).toBe(true);
  if (res.data?.mode !== 'heuristic') throw new Error(`expected heuristic, got ${res.data?.mode}`);
  return res.data;
}

function coverage(report: NativeHeuristicDesignAuditReport, id: NativeHeuristicId) {
  const row = report.heuristicCoverage.find((r) => r.heuristic === id);
  if (!row) throw new Error(`no coverage row for ${id}`);
  return row;
}

async function refusal(
  handlers: ReturnType<typeof handlersFor>,
  body: unknown
): Promise<string | undefined> {
  const res = await handlers.runDesignAudit(ctx(body));
  expect(res, JSON.stringify(body)).toMatchObject({ success: false, code: 'INVALID_REQUEST' });
  return res.error;
}

// The loaded style guide is module state shared by every handler instance.
afterEach(async () => {
  await handlersFor(new NativeUIBridgeRegistry()).clearStyleGuide(ctx(undefined));
});

describe('native /design/audit through the shared core', () => {
  it('the published specs entry carries the core native gates on', () => {
    expect(asDesignAuditCore(specs)).not.toBeNull();
    expect(asDesignAuditCore({ runStyleAudit: () => ({}) })).toBeNull();
    expect(asDesignAuditCore(null)).toBeNull();
  });

  it('answers VALIDATOR_NOT_AVAILABLE when the SDK carries no core', async () => {
    const handlers = createDesignHandlers(registryOf({ a: {} }), undefined, { designAudit: null });
    for (const body of [{}, { guide: padGuide }, { limit: 0 }]) {
      const res = await handlers.runDesignAudit(ctx(body));
      expect(res).toMatchObject({ success: false, code: 'VALIDATOR_NOT_AVAILABLE' });
      expect(res.error).toBe(
        'Install a @qontinui/ui-bridge release containing the shared design audit (0.57.0 or later).'
      );
    }
  });

  it('refuses each malformed field with the web message, in the web order', async () => {
    const { core, reads } = recordingCore();
    const handlers = handlersFor(registryOf({ box: {}, b: {} }), core);
    for (const body of ['g', 42, [padGuide]]) {
      expect(await refusal(handlers, body)).toMatch(/the request body must be a JSON object/);
    }
    for (const rootFontSizePx of [0, -16, Number.NaN, Number.POSITIVE_INFINITY, '16']) {
      // Before the guide is read, and before elementIds.
      for (const body of [
        { guide: padGuide, rootFontSizePx },
        { rootFontSizePx },
        { guide: { rules: 'not-an-array' }, elementIds: 'box', rootFontSizePx },
      ]) {
        expect(await refusal(handlers, body)).toBe(
          '/design/audit: rootFontSizePx must be a finite number greater than 0'
        );
      }
    }
    for (const elementIds of ['box', 42, {}, ['box', 7]]) {
      for (const body of [
        { guide: padGuide, elementIds },
        { guide: 'g', elementIds },
      ]) {
        expect(await refusal(handlers, body)).toBe(
          '/design/audit: elementIds must be an array of strings'
        );
      }
    }
    for (const guide of ['g', 42, [], {}, { rules: 'not-an-array' }]) {
      expect(await refusal(handlers, { guide, limit: 0 })).toBe(
        '/design/audit: guide must be a style guide object with a rules array'
      );
    }
    for (const limit of [0, 1.5, '2']) {
      expect(await refusal(handlers, { limit, includePassed: 'yes' })).toBe(
        '/design/audit: limit must be an integer >= 1'
      );
    }
    expect(await refusal(handlers, { includePassed: 'yes', maxResults: 0 })).toBe(
      '/design/audit: includePassed must be a boolean'
    );
    expect(await refusal(handlers, { maxResults: 0 })).toBe(
      '/design/audit: maxResults must be an integer >= 1'
    );
    // A refused body reads no element.
    expect(reads).toEqual([]);
  });

  it('a malformed body guide is refused even with a loaded guide to fall back on', async () => {
    const handlers = handlersFor(registryOf({ box: {} }));
    await handlers.loadStyleGuide(ctx({ guide: padGuide }));
    expect(await refusal(handlers, { guide: { rules: 'x' } })).toMatch(/guide must be/);
    for (const body of [undefined, null, {}, { guide: null }]) {
      expect(styleGuide(await handlers.runDesignAudit(ctx(body))).guideName).toBe('g');
    }
  });

  it('bounds the elements by limit, below, at and above the count', async () => {
    const handlers = handlersFor(registryOf({ a: {}, b: {}, c: {} }));
    for (const [limit, checked, truncated] of [
      [2, 2, true],
      [3, 3, false],
      [4, 3, false],
    ] as const) {
      for (const body of [{ limit }, { limit, guide: padGuide }]) {
        const res = await handlers.runDesignAudit(ctx(body));
        expect(res.data, JSON.stringify(body)).toMatchObject({
          limit,
          checkedElements: checked,
          totalElements: 3,
          truncated,
        });
      }
    }
    const res = await handlers.runDesignAudit(ctx({}));
    expect(res.data).toMatchObject({ limit: specs.DEFAULT_AUDIT_ELEMENT_LIMIT, truncated: false });
  });

  it('cuts results and issues at maxResults, below, at and above', async () => {
    const tiny = { style: { fontSize: 10, paddingTop: 2 } };
    const handlers = handlersFor(registryOf({ a: tiny, b: tiny, c: tiny }));
    for (const [maxResults, listed, cut] of [
      [2, 2, true],
      [3, 3, false],
      [4, 3, false],
    ] as const) {
      const h = heuristic(await handlers.runDesignAudit(ctx({ maxResults })));
      expect(h.issues).toHaveLength(listed);
      expect(h).toMatchObject({ maxResults, listableResults: 3, resultsTruncated: cut });
      const s = styleGuide(await handlers.runDesignAudit(ctx({ maxResults, guide: padGuide })));
      expect(s.results).toHaveLength(listed);
      expect(s).toMatchObject({ maxResults, listableResults: 3, resultsTruncated: cut });
    }
    const dflt = heuristic(await handlers.runDesignAudit(ctx({})));
    expect(dflt.maxResults).toBe(specs.DEFAULT_AUDIT_MAX_RESULTS);
  });

  it('lists failures only unless includePassed, and summarises by count', async () => {
    const handlers = handlersFor(
      registryOf({ good: { style: { paddingTop: 8 } }, bad: { style: { paddingTop: 4 } } })
    );
    const failures = styleGuide(await handlers.runDesignAudit(ctx({ guide: padGuide })));
    expect(failures.results.map((r) => r.elementId)).toEqual(['bad']);
    expect(failures).toMatchObject({
      includePassed: false,
      passedCount: 1,
      failedCount: 1,
      summary: { errors: 1, warnings: 0, info: 0 },
    });
    const all = styleGuide(
      await handlers.runDesignAudit(ctx({ guide: padGuide, includePassed: true }))
    );
    expect(all.results.map((r) => r.elementId)).toEqual(['good', 'bad']);
    expect(all.includePassed).toBe(true);
  });

  it('with no guide answers mode heuristic with the web reason, not NO_STYLE_GUIDE', async () => {
    const handlers = handlersFor(registryOf({ a: {} }));
    for (const body of [undefined, null, {}, { guide: null }]) {
      const report = heuristic(await handlers.runDesignAudit(ctx(body)));
      expect(report.reason).toBe(HEURISTIC_REASON);
      expect(report.heuristicCoverage.map((r) => r.heuristic)).toEqual([
        'contrast',
        'select-dark-mode',
        'font-size',
        'touch-target',
      ]);
    }
  });

  it('echoes missing ids; no native element is ever unreadable', async () => {
    const handlers = handlersFor(registryOf({ a: {}, b: {} }));
    const res = await handlers.runDesignAudit(ctx({ elementIds: ['a', 'nope', 'gone'] }));
    expect(res.data).toMatchObject({
      totalElements: 1,
      checkedElements: 1,
      missingElementIds: ['nope', 'gone'],
      missingElementCount: 2,
      unreadableElementIds: [],
      unreadableElementCount: 0,
    });
    const none = await handlers.runDesignAudit(ctx({ guide: padGuide, elementIds: [] }));
    expect(none.data).toMatchObject({ checkedElements: 0, unreadableElementCount: 0 });
  });

  it('resolves rem at 16px by default and at the request root when given', async () => {
    const handlers = handlersFor(
      registryOf({ at16: { style: { paddingTop: 16 } }, at20: { style: { paddingTop: 20 } } })
    );
    const remGuide = guideOf(
      [
        {
          id: 'pad',
          constraints: [{ type: 'tokenRef', property: 'paddingTop', tokenPath: 'spacing.md' }],
        },
      ],
      { spacing: { md: '1rem' } }
    );
    // RN has no root element: 1rem is 16px unless the request says otherwise.
    const atDefault = styleGuide(await handlers.runDesignAudit(ctx({ guide: remGuide })));
    expect(atDefault.results.map((r) => r.elementId)).toEqual(['at20']);
    const at20 = styleGuide(
      await handlers.runDesignAudit(ctx({ guide: remGuide, rootFontSizePx: 20 }))
    );
    expect(at20.results.map((r) => r.elementId)).toEqual(['at16']);
  });

  it('a web elementType "button" rule matches a native pressable and touchable', async () => {
    const handlers = handlersFor(
      registryOf({
        press: { type: 'pressable', style: { paddingTop: 4 } },
        touch: { type: 'touchable', style: { paddingTop: 4 } },
        label: { type: 'text', style: { paddingTop: 4 } },
      })
    );
    const guide = guideOf([
      {
        id: 'button-pad',
        elementType: 'button',
        constraints: [{ type: 'exact', property: 'paddingTop', value: '8px' }],
      },
    ]);
    const report = styleGuide(await handlers.runDesignAudit(ctx({ guide })));
    expect(report.results.map((r) => r.elementId)).toEqual(['press', 'touch']);
  });
});

describe('native heuristics: what React Native can and cannot read', () => {
  it('declares partial contrast and font size, no <select>, and measured touch targets', async () => {
    const report = heuristic(await handlersFor(registryOf({ a: {} })).runDesignAudit(ctx({})));
    expect(report.heuristicCoverage.map(({ heuristic: h, status }) => [h, status])).toEqual([
      ['contrast', 'partial'],
      ['select-dark-mode', 'not-applicable'],
      ['font-size', 'partial'],
      ['touch-target', 'measured'],
    ]);
    expect(coverage(report, 'select-dark-mode')).toMatchObject({ checked: 0, notMeasured: 0 });
    for (const row of report.heuristicCoverage) expect(row.note, row.heuristic).toBeTruthy();
  });

  it('only own colours on both sides are checked: a Text with a color alone, or a View with a background alone, is not measured', async () => {
    const report = heuristic(
      await handlersFor(
        registryOf({
          label: { type: 'text', style: { color: '#999999', fontSize: 14 } },
          panel: { type: 'view', style: { backgroundColor: '#111111' } },
          chip: {
            type: 'text',
            style: { color: '#999999', backgroundColor: '#ffffff', fontSize: 14 },
          },
        })
      ).runDesignAudit(ctx({}))
    );
    expect(coverage(report, 'contrast')).toMatchObject({ checked: 1, notMeasured: 2 });
    expect(report.issues.map((i) => [i.element, i.severity])).toEqual([['chip', 'warning']]);
  });

  it('a font size absent from the style is not measured; a small one is reported', async () => {
    const report = heuristic(
      await handlersFor(
        registryOf({ plain: { type: 'text' }, small: { type: 'text', style: { fontSize: 10 } } })
      ).runDesignAudit(ctx({}))
    );
    expect(coverage(report, 'font-size')).toMatchObject({ checked: 1, notMeasured: 1 });
    expect(report.issues).toEqual([
      { element: 'small', issue: 'Font size too small: 10px', severity: 'info' },
    ]);
  });

  it('a pressable with no layout is not measured; a 30x30 one is too small; a view is no target', async () => {
    const report = heuristic(
      await handlersFor(
        registryOf({
          unlaid: { type: 'pressable', layout: null },
          small: { type: 'pressable', layout: layout(30, 30) },
          big: { type: 'button', layout: layout(48, 48) },
          box: { type: 'view', layout: layout(10, 10) },
        })
      ).runDesignAudit(ctx({}))
    );
    expect(coverage(report, 'touch-target')).toMatchObject({ checked: 2, notMeasured: 1 });
    expect(report.issues).toEqual([
      {
        element: 'small',
        issue: 'Touch target too small: 30x30px (min 44x44)',
        severity: 'warning',
      },
    ]);
  });
});

describe('native /design/audit over the server', () => {
  it('POST /design/audit with no guide is heuristic; limit 0 is INVALID_REQUEST', async () => {
    const registry = registryOf({ a: {} });
    const server = new NativeUIBridgeServer(registry, new DefaultNativeActionExecutor(registry));
    const post = async (body: unknown) => {
      const res = await server.handleRequest({
        method: 'POST',
        path: '/ui-bridge/design/audit',
        headers: { 'content-type': 'application/json' },
        query: {},
        body,
      });
      return JSON.parse(res.body) as APIResponse<NativeDesignAuditResponse>;
    };
    const ok = await post({});
    expect(ok).toMatchObject({
      success: true,
      data: { mode: 'heuristic', reason: HEURISTIC_REASON },
    });
    const refused = await post({ limit: 0 });
    expect(refused).toMatchObject({ success: false, code: 'INVALID_REQUEST' });
    expect(refused.error).toBe('/design/audit: limit must be an integer >= 1');
  });
});
