/**
 * Native answers `/design/audit` like the web transports.
 *
 * The same page is fed to `auditDesign` twice: once as live DOM nodes
 * through the web adapter (`designAuditOf`), once as plain records shaped the
 * way the React Native server's adapter builds them (`ui-bridge-native`
 * `server/design-audit-native.ts`: flattened-style strings, a layout size,
 * the element's own kind — `pressable` where the web says `button` — and
 * `rem` at 16). Every key both transports report must agree; the keys that
 * differ by design (each heuristic's declared `status` and `note`) are left
 * out, and each RN difference is pinned in the native suite. Plan:
 * 2026-11-21-native-design-audit-answers-like-web-design-audit-of.
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { ElementDesignData, ExtendedComputedStyles } from '../core/types';
import { designAuditOf, type DesignElementSource } from './design-request';
import {
  auditDesign,
  NO_STYLE_GUIDE_REASON,
  type DesignAuditAdapter,
  type DesignAuditResponse,
  type HeuristicInput,
} from './design-audit-core';
import { STYLE_GUIDE_VERSION, type StyleGuideConfig } from './style-types';

/** One element of the page, as both transports see it. */
interface Fixture {
  id: string;
  webType: string;
  nativeType: string;
  color: string;
  backgroundColor: string;
  fontSize: string;
  paddingTop: string;
  size: { width: number; height: number };
}

const PAGE: Fixture[] = [
  {
    id: 'title',
    webType: 'text',
    nativeType: 'text',
    color: 'rgb(150, 150, 150)',
    backgroundColor: 'rgb(255, 255, 255)',
    fontSize: '14px',
    paddingTop: '8px',
    size: { width: 200, height: 20 },
  },
  {
    id: 'note',
    webType: 'text',
    nativeType: 'text',
    color: 'rgb(0, 0, 0)',
    backgroundColor: 'rgb(255, 255, 255)',
    fontSize: '10px',
    paddingTop: '4px',
    size: { width: 200, height: 12 },
  },
  {
    id: 'save',
    webType: 'button',
    nativeType: 'pressable',
    color: 'rgb(255, 255, 255)',
    backgroundColor: 'rgb(0, 0, 255)',
    fontSize: '16px',
    paddingTop: '4px',
    size: { width: 30, height: 30 },
  },
];

/** The page as registered DOM elements; jsdom lays nothing out, so each box is stubbed. */
function webElements(): DesignElementSource[] {
  return PAGE.map((f) => {
    const el = document.createElement('div');
    Object.assign(el.style, {
      color: f.color,
      backgroundColor: f.backgroundColor,
      fontSize: f.fontSize,
      paddingTop: f.paddingTop,
    });
    el.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        ...f.size,
        right: f.size.width,
        bottom: f.size.height,
      }) as DOMRect;
    document.body.appendChild(el);
    return { id: f.id, type: f.webType, label: f.id, element: el };
  });
}

/** An adapter shaped as the React Native server's: plain records, own-style colours, 16px root. */
const nativeShaped: DesignAuditAdapter<Fixture> = {
  isReadable: (_el): _el is Fixture => true,
  records: (kept) =>
    kept.map(
      (f) =>
        ({
          elementId: f.id,
          label: f.id,
          type: f.nativeType,
          styles: {
            color: f.color,
            backgroundColor: f.backgroundColor,
            fontSize: f.fontSize,
            paddingTop: f.paddingTop,
          } as ExtendedComputedStyles,
          pseudoElements: [],
          rect: { x: 0, y: 0, ...f.size },
        }) as ElementDesignData
    ),
  heuristicInput: (f): HeuristicInput => ({
    id: f.id,
    touchTarget: ['button', 'touchable', 'pressable', 'switch', 'checkbox', 'radio'].includes(
      f.nativeType
    ),
    color: f.color,
    backgroundColor: f.backgroundColor,
    fontSizePx: parseFloat(f.fontSize),
    rect: f.size,
  }),
  defaultRootFontSizePx: () => 16,
  heuristicCoverage: {
    contrast: { status: 'partial', note: 'own style only' },
    'select-dark-mode': { status: 'not-applicable' },
    'font-size': { status: 'partial' },
    'touch-target': { status: 'measured' },
  },
};

/** Every key both transports answer with, minus what differs by design. */
function shared(report: DesignAuditResponse): Record<string, unknown> {
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

const guide: StyleGuideConfig = {
  version: STYLE_GUIDE_VERSION,
  name: 'buttons',
  tokens: {
    colors: {},
    typography: {
      fontFamilies: {},
      fontSizes: {},
      fontWeights: {},
      lineHeights: {},
      letterSpacings: {},
    },
    spacing: {},
    borderRadius: {},
    shadows: {},
    breakpoints: {},
  },
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

describe('/design/audit: native-shaped and web answers agree', () => {
  it('with no guide, native answers mode heuristic with web reason, issues and coverage counts', () => {
    const request = { elementIds: ['title', 'note', 'save', 'gone'] };
    const web = designAuditOf(webElements(), request, null);
    const native = auditDesign(PAGE, request, null, nativeShaped);
    expect(native.mode).toBe('heuristic');
    if (native.mode !== 'heuristic') throw new Error('unreachable');
    expect(native.reason).toBe(NO_STYLE_GUIDE_REASON);
    expect(native.heuristicCoverage.map((r) => r.heuristic)).toEqual([
      'contrast',
      'select-dark-mode',
      'font-size',
      'touch-target',
    ]);
    expect(native.issues.map((i) => i.element)).toEqual(['title', 'note', 'save']);
    expect(shared(native)).toEqual(shared(web));
  });

  it('with a guide, a web button rule matches the native pressable, and the reports agree', () => {
    for (const request of [
      { guide },
      { guide, includePassed: true },
      { guide, includePassed: true, maxResults: 1 },
      { guide, limit: 2 },
    ]) {
      const web = designAuditOf(webElements(), request, null);
      const native = auditDesign(PAGE, request, null, nativeShaped);
      expect(native.mode, JSON.stringify(request)).toBe('style-guide');
      expect(shared(native), JSON.stringify(request)).toEqual(shared(web));
      document.body.innerHTML = '';
    }
    const native = auditDesign(PAGE, { guide }, null, nativeShaped);
    if (native.mode !== 'style-guide') throw new Error('unreachable');
    expect(native.results.map((r) => [r.elementId, r.ruleId])).toEqual([
      ['note', 'text-padding'],
      ['save', 'button-padding'],
    ]);
  });

  it('bounds and refusals agree', () => {
    for (const request of [{ limit: 1 }, { maxResults: 2 }, { elementIds: [] }]) {
      const web = designAuditOf(webElements(), request, null);
      const native = auditDesign(PAGE, request, null, nativeShaped);
      expect(shared(native), JSON.stringify(request)).toEqual(shared(web));
      document.body.innerHTML = '';
    }
    for (const request of [{ limit: 0 }, { includePassed: 'yes' }, { maxResults: 1.5 }]) {
      const refusal = (run: () => unknown): string => {
        try {
          run();
        } catch (err) {
          return (err as Error).message;
        }
        return 'accepted';
      };
      const web = refusal(() => designAuditOf(webElements(), request, null));
      expect(web, JSON.stringify(request)).not.toBe('accepted');
      expect(refusal(() => auditDesign(PAGE, request, null, nativeShaped))).toBe(web);
    }
  });
});
