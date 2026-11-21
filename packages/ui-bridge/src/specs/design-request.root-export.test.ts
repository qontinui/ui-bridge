/**
 * The shared design-request functions are reachable from the package root.
 *
 * `specs/design-request.ts` and `specs/quality-request.ts` are the one
 * implementation behind the `/design/*` routes on both in-package transports.
 * A host with its own dispatcher — the qontinui-runner webview's
 * `useDesignEvents` — can only answer with the same model if it can import
 * them from the published root entry; otherwise it keeps a third, drifting
 * copy. These tests import from `../index` (what `@qontinui/ui-bridge`
 * resolves to) and drive each function against a real DOM node, so a dropped
 * or renamed export fails here rather than in a downstream build.
 */

import { afterEach, describe, expect, it } from 'vitest';
import * as root from '../index';

function mount(): { id: string; label: string; type: string; element: HTMLElement } {
  const el = document.createElement('button');
  el.textContent = 'Save';
  el.style.color = 'rgb(255, 0, 0)';
  document.body.appendChild(el);
  return { id: 'save-btn', label: 'Save', type: 'button', element: el };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('root entry: design-request runtime', () => {
  it('answers /design/element/:id/styles with full ElementDesignData', () => {
    const source = mount();
    const styles = root.elementStylesOf(source.id, source);
    expect(styles.elementId).toBe('save-btn');
    expect(styles.styles.color).toBe('rgb(255, 0, 0)');
    expect(styles).toHaveProperty('tokens');
  });

  it('reports an unknown element as a DesignRequestError with its code', () => {
    let caught: unknown;
    try {
      root.elementStylesOf('missing', undefined);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(root.DesignRequestError);
    expect((caught as InstanceType<typeof root.DesignRequestError>).code).toBe('ELEMENT_NOT_FOUND');
    expect(root.designFailureCode(caught, 'DESIGN_SNAPSHOT_FAILED')).toBe('ELEMENT_NOT_FOUND');
  });

  it('answers /design/snapshot with reported bounds', () => {
    const source = mount();
    const snap = root.designSnapshotOf([source], {});
    expect(snap.elements.map((e) => e.elementId)).toEqual(['save-btn']);
    expect(snap.totalElements).toBe(1);
    expect(snap.truncated).toBe(false);
    expect(snap.limit).toBe(root.DEFAULT_DESIGN_RECORD_BUDGET);
  });

  it('answers /design/audit heuristically when no guide is loaded', () => {
    const source = mount();
    const audit = root.designAuditOf([source], {}, null);
    expect(audit.mode).toBe('heuristic');
  });

  it('answers /design/responsive with the object shape', async () => {
    const source = mount();
    const res = await root.responsiveSnapshotsOf([source], {
      viewports: { narrow: 360 },
    });
    expect(res.method).toBe('document-width-constraint');
    expect(res.mediaQueriesReevaluated).toBe(false);
    expect(Array.isArray(res.snapshots)).toBe(true);
  });

  it('answers /control/viewport-constraints with the responsive capture’s constraint', async () => {
    const root_ = document.documentElement;
    const narrowed = await root.viewportConstraintsOf({ width: 480 });
    expect(narrowed).toMatchObject({ success: true, restored: false });
    expect(root_.style.getPropertyValue('min-width')).toBe('480px');
    const restored = await root.viewportConstraintsOf({ restore: true });
    expect(restored.restored).toBe(true);
    expect(root_.style.getPropertyValue('min-width')).toBe('');
    await expect(root.viewportConstraintsOf({})).rejects.toBeInstanceOf(root.DesignRequestError);
  });

  it('exports the bounds a host reports against', () => {
    expect(root.MAX_RESPONSIVE_VIEWPORTS).toBe(16);
    expect(root.DEFAULT_AUDIT_ELEMENT_LIMIT).toBeGreaterThan(0);
    expect(root.DEFAULT_AUDIT_MAX_RESULTS).toBeGreaterThan(0);
  });
});

describe('root entry: quality-request runtime', () => {
  it('evaluates, baselines and diffs registered elements', () => {
    const source = mount();
    const report = root.evaluateRegisteredQuality([source], {}, null);
    expect(Array.isArray(report.metrics)).toBe(true);
    expect(report.metrics.length).toBeGreaterThan(0);
    expect(report).not.toHaveProperty('overallScore');
    const baseline = root.captureQualityBaseline([source], { label: 'before' });
    expect(baseline.label).toBe('before');
    const diff = root.diffQualityBaseline(baseline, [source], {});
    expect(diff.modified).toEqual([]);
    expect(diff.hasSignificantChanges).toBe(false);
    expect(root.collectRegisteredDesignData([source]).map((d) => d.elementId)).toEqual([
      'save-btn',
    ]);
    expect(root.qualityFailureCode(new root.QualityRequestError('x'), 'Q')).toBe('INVALID_REQUEST');
    expect(root.qualityFailureCode(new Error('x'), 'Q')).toBe('Q');
  });
});
