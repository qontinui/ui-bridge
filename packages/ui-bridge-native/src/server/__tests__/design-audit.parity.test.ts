// @vitest-environment jsdom
/**
 * Native answers `/design/audit` like the web transports.
 *
 * One page is audited twice: as registered React Native elements through the
 * REAL native adapter (`nativeAudit`, `../design-audit-native.ts`), and as live
 * DOM nodes through the web transports' `designAuditOf` (`@qontinui/ui-bridge/
 * specs`, as the workspace build serves it). Every key both transports report
 * must agree. What differs by design is left out — each heuristic's declared
 * `status` and `note`, and `durationMs` / `timestamp` — and each React Native
 * difference is pinned in `design-handlers.audit.test.ts`. jsdom supplies the
 * web side's DOM; the native side never touches it. Plan:
 * 2026-11-21-native-design-audit-answers-like-web-design-audit-of.
 */

import { afterEach, describe, expect, it } from 'vitest';
import * as specs from '@qontinui/ui-bridge/specs';
import { NativeUIBridgeRegistry } from '../../core/registry';
import {
  asDesignAuditCore,
  nativeAudit,
  type NativeDesignAuditResponse,
} from '../design-audit-native';
import type { NativeElementRef, NativeElementType } from '../../core/types';

/** One element of the page, as both transports register it. */
interface Fixture {
  id: string;
  webType: string;
  nativeType: NativeElementType;
  color: string;
  backgroundColor: string;
  fontSize: number;
  paddingTop: number;
  size: { width: number; height: number };
}

const PAGE: Fixture[] = [
  {
    id: 'title',
    webType: 'text',
    nativeType: 'text',
    color: 'rgb(150, 150, 150)',
    backgroundColor: 'rgb(255, 255, 255)',
    fontSize: 14,
    paddingTop: 8,
    size: { width: 200, height: 20 },
  },
  {
    id: 'note',
    webType: 'text',
    nativeType: 'text',
    color: 'rgb(0, 0, 0)',
    backgroundColor: 'rgb(255, 255, 255)',
    fontSize: 10,
    paddingTop: 4,
    size: { width: 200, height: 12 },
  },
  {
    id: 'save',
    webType: 'button',
    nativeType: 'pressable',
    color: 'rgb(255, 255, 255)',
    backgroundColor: 'rgb(0, 0, 255)',
    fontSize: 16,
    paddingTop: 4,
    size: { width: 30, height: 30 },
  },
];

function nativeRegistry(): NativeUIBridgeRegistry {
  const registry = new NativeUIBridgeRegistry();
  for (const f of PAGE) {
    registry.registerElement(f.id, { current: {} as NativeElementRef }, { type: f.nativeType });
    registry.updateElementStyle(f.id, {
      color: f.color,
      backgroundColor: f.backgroundColor,
      fontSize: f.fontSize,
      paddingTop: f.paddingTop,
    });
    registry.updateElementState(f.id, {
      mounted: true,
      visible: true,
      enabled: true,
      focused: false,
      layout: { x: 0, y: 0, pageX: 0, pageY: 0, ...f.size },
    });
  }
  return registry;
}

/** The page as registered DOM elements; jsdom lays nothing out, so each box is stubbed. */
function webElements(): Array<{ id: string; type: string; label: string; element: HTMLElement }> {
  return PAGE.map((f) => {
    const el = document.createElement('div');
    Object.assign(el.style, {
      color: f.color,
      backgroundColor: f.backgroundColor,
      fontSize: `${f.fontSize}px`,
      paddingTop: `${f.paddingTop}px`,
    });
    const box = {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      ...f.size,
      right: f.size.width,
      bottom: f.size.height,
    };
    el.getBoundingClientRect = () => box as DOMRect;
    el.getClientRects = () => [box] as unknown as DOMRectList;
    document.body.appendChild(el);
    return { id: f.id, type: f.webType, label: f.id, element: el };
  });
}

const core = asDesignAuditCore(specs);

function native(request: unknown): NativeDesignAuditResponse {
  if (!core)
    throw new Error('the workspace build of @qontinui/ui-bridge/specs carries no auditDesign');
  return nativeAudit(nativeRegistry(), request, null, core);
}

function web(request: unknown): specs.DesignAuditResponse {
  return specs.designAuditOf(webElements(), request, null);
}

/** Every key both transports answer with, minus what differs by design. */
function shared(
  report: NativeDesignAuditResponse | specs.DesignAuditResponse
): Record<string, unknown> {
  const { timestamp: _t, ...rest } = report;
  if (rest.mode === 'heuristic') {
    return {
      ...rest,
      heuristicCoverage: rest.heuristicCoverage.map(({ heuristic, checked, notMeasured }) => ({
        heuristic,
        checked,
        notMeasured,
      })),
    };
  }
  const { durationMs: _d, ...guideRest } = rest;
  return guideRest;
}

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (err) {
    return (err as Error).message;
  }
  return 'accepted';
}

const guide = {
  version: '1.0.0',
  name: 'buttons',
  tokens: {},
  rules: [
    {
      id: 'button-padding',
      elementType: 'button',
      severity: 'warning',
      constraints: [{ type: 'exact', property: 'paddingTop', value: '8px' }],
    },
    {
      id: 'text-padding',
      elementType: 'text',
      severity: 'info',
      constraints: [{ type: 'exact', property: 'paddingTop', value: '8px' }],
    },
  ],
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('/design/audit: the native adapter and the web transports agree', () => {
  it('with no guide, native answers mode heuristic with the web reason, issues and coverage counts', () => {
    const request = { elementIds: ['title', 'note', 'save', 'gone'] };
    const nativeReport = native(request);
    expect(nativeReport.mode).toBe('heuristic');
    if (nativeReport.mode !== 'heuristic') throw new Error('unreachable');
    expect(nativeReport.reason).toBe(
      'No style guide was provided in the request or loaded with loadStyleGuide'
    );
    expect(nativeReport.heuristicCoverage.map((r) => r.heuristic)).toEqual([
      'contrast',
      'select-dark-mode',
      'font-size',
      'touch-target',
    ]);
    expect(nativeReport.issues.map((i) => i.element)).toEqual(['title', 'note', 'save']);
    expect(shared(nativeReport)).toEqual(shared(web(request)));
  });

  it('with a guide, a web button rule matches the native pressable, and the reports agree', () => {
    for (const request of [
      { guide },
      { guide, includePassed: true },
      { guide, includePassed: true, maxResults: 1 },
      { guide, limit: 2 },
    ]) {
      const nativeReport = native(request);
      expect(nativeReport.mode, JSON.stringify(request)).toBe('style-guide');
      expect(shared(nativeReport), JSON.stringify(request)).toEqual(shared(web(request)));
      document.body.innerHTML = '';
    }
    const report = native({ guide });
    if (report.mode !== 'style-guide') throw new Error('unreachable');
    expect(report.results.map((r) => [r.elementId, r.ruleId])).toEqual([
      ['note', 'text-padding'],
      ['save', 'button-padding'],
    ]);
  });

  it('bounds and refusals agree', () => {
    for (const request of [{ limit: 1 }, { maxResults: 2 }, { elementIds: [] }]) {
      expect(shared(native(request)), JSON.stringify(request)).toEqual(shared(web(request)));
      document.body.innerHTML = '';
    }
    for (const request of [{ limit: 0 }, { includePassed: 'yes' }, { maxResults: 1.5 }]) {
      const webRefusal = refusal(() => web(request));
      expect(webRefusal, JSON.stringify(request)).not.toBe('accepted');
      expect(refusal(() => native(request))).toBe(webRefusal);
    }
  });
});
