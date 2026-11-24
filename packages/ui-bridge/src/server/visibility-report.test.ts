/**
 * `/control/visibility` — the occlusion sweep both surfaces share.
 *
 * These pin the two things that were previously unpinned and consequently
 * wrong:
 *
 * 1. `isExpectedOverlay` / `includeExpected` actually do something. Both were
 *    inert — the field hardcoded `false`, the parameter accepted, echoed and
 *    never read — while the type documented real behaviour for each.
 * 2. The in-page handler and the relay twin produce the SAME report from the
 *    same inputs. They used to be hand-duplicated, and the relay's comment had
 *    drifted into claiming a subset relationship that never held.
 */

import { describe, it, expect } from 'vitest';
import {
  buildVisibilityReport,
  DEFAULT_VISIBILITY_MIN_RATIO,
  type VisibilityElementInput,
} from './visibility-report';
import type { SnapshotModalContext, ModalInfo } from '../modal/types';

function modal(id: string, over: Partial<ModalInfo> = {}): ModalInfo {
  return {
    id,
    type: 'dialog',
    blocking: true,
    zIndex: 100,
    hasBackdrop: true,
    escDismiss: true,
    detectedAt: 0,
    selector: `#${id}`,
    ...over,
  };
}

function modalContext(...ids: string[]): SnapshotModalContext {
  const modals = ids.map((id) => modal(id));
  return {
    modals,
    topModal: modals[modals.length - 1],
    hasBlockingModal: modals.length > 0,
    count: modals.length,
  };
}

const covered = (over: Partial<VisibilityElementInput> = {}): VisibilityElementInput => ({
  id: 'zone-label',
  label: 'Zone label',
  occludedBy: 'minimap',
  occludedPct: 60,
  textContent: 'Zone 8: qontinui-web',
  ...over,
});

describe('buildVisibilityReport — the sweep', () => {
  it('reports a directed occlusion with the covered element text', () => {
    const report = buildVisibilityReport({ elements: [covered()] });

    expect(report.verdict).toBe('occlusions_found');
    expect(report.occlusions).toHaveLength(1);
    expect(report.occlusions[0]).toMatchObject({
      element: 'zone-label',
      occludedBy: 'minimap',
      ratio: 0.6,
      hidesText: true,
      text: 'Zone 8: qontinui-web',
      source: 'hit-test',
    });
  });

  it('skips elements with no occluder', () => {
    const report = buildVisibilityReport({
      elements: [covered({ occludedBy: undefined })],
    });
    expect(report.occlusions).toEqual([]);
    expect(report.verdict).toBe('clear');
  });

  it('filters hairline overlaps below minRatio, default 0.02', () => {
    const hairline = covered({ occludedPct: 1 });
    expect(buildVisibilityReport({ elements: [hairline] }).occlusions).toEqual([]);
    expect(
      buildVisibilityReport({ elements: [hairline], minRatio: 0 }).occlusions
    ).toHaveLength(1);
    expect(buildVisibilityReport({ elements: [hairline] }).minRatio).toBe(
      DEFAULT_VISIBILITY_MIN_RATIO
    );
  });

  it('ranks text-hiding occlusions above blank ones, then by ratio', () => {
    const report = buildVisibilityReport({
      elements: [
        covered({ id: 'blank-big', textContent: '', occludedPct: 90 }),
        covered({ id: 'text-small', textContent: 'hi', occludedPct: 30 }),
        covered({ id: 'text-big', textContent: 'hello', occludedPct: 80 }),
      ],
    });
    expect(report.occlusions.map((o) => o.element)).toEqual([
      'text-big',
      'text-small',
      'blank-big',
    ]);
  });

  it('an empty registry is unknown, not clear', () => {
    const report = buildVisibilityReport({ elements: [] });
    expect(report.verdict).toBe('unknown_empty_registry');
    expect(report.occlusions).toEqual([]);
  });
});

describe('buildVisibilityReport — clipping is not occlusion', () => {
  const navItem = (over: Partial<VisibilityElementInput> = {}): VisibilityElementInput => ({
    id: 'button-gates-12',
    label: 'Gates',
    clippedPct: 100,
    clipScrollable: true,
    textContent: 'Gates',
    ...over,
  });

  it('lists a clipped element in clipped[], not occlusions[], and stays clear', () => {
    const report = buildVisibilityReport({ elements: [navItem()] });
    expect(report.occlusions).toEqual([]);
    expect(report.clipped).toEqual([
      {
        element: 'button-gates-12',
        label: 'Gates',
        text: 'Gates',
        ratio: 1,
        scrollReachable: true,
      },
    ]);
    // Informational only: a clipped-only page is clear.
    expect(report.verdict).toBe('clear');
  });

  it('scrollReachable is false unless the clip is known scrollable', () => {
    const report = buildVisibilityReport({
      elements: [
        navItem({ id: 'truncated', clippedPct: 33, clipScrollable: false }),
        navItem({ id: 'unknown', clippedPct: 50, clipScrollable: undefined }),
      ],
    });
    expect(report.clipped.map((c) => [c.element, c.scrollReachable])).toEqual([
      ['unknown', false],
      ['truncated', false],
    ]);
  });

  it('filters clipped entries by minRatio like occlusions, worst first', () => {
    const elements = [
      navItem({ id: 'hairline', clippedPct: 1 }),
      navItem({ id: 'third', clippedPct: 33 }),
      navItem({ id: 'all', clippedPct: 100 }),
    ];
    expect(buildVisibilityReport({ elements }).clipped.map((c) => c.element)).toEqual([
      'all',
      'third',
    ]);
    expect(
      buildVisibilityReport({ elements, minRatio: 0 }).clipped.map((c) => c.element)
    ).toEqual(['all', 'third', 'hairline']);
  });

  it('an element both partly clipped and partly covered appears in each list', () => {
    const report = buildVisibilityReport({
      elements: [covered({ clippedPct: 33, clipScrollable: false })],
    });
    expect(report.verdict).toBe('occlusions_found');
    expect(report.occlusions.map((o) => o.element)).toEqual(['zone-label']);
    expect(report.clipped.map((c) => c.element)).toEqual(['zone-label']);
    // `hidesText` is an occlusion property; clipping never sets it.
    expect(report.clipped[0]).not.toHaveProperty('hidesText');
  });

  it('an element with no clip fields contributes nothing to clipped[]', () => {
    expect(buildVisibilityReport({ elements: [covered()] }).clipped).toEqual([]);
  });
});

describe('buildVisibilityReport — expected overlays', () => {
  it('marks an occluder that is a tracked modal, and drops it by default', () => {
    const report = buildVisibilityReport({
      elements: [covered({ occludedBy: 'confirm-dialog' })],
      modalContext: modalContext('confirm-dialog'),
    });

    expect(report.expectedOverlayDetection).toBe('modal-stack');
    expect(report.expectedOverlaysFiltered).toBe(1);
    expect(report.occlusions).toEqual([]);
    // Filtered, not "nothing was covered" — the count is what says so.
    expect(report.verdict).toBe('clear');
  });

  it('keeps expected overlays when includeExpected is true, and marks them', () => {
    const report = buildVisibilityReport({
      elements: [covered({ occludedBy: 'confirm-dialog' })],
      modalContext: modalContext('confirm-dialog'),
      includeExpected: true,
    });

    expect(report.expectedOverlaysFiltered).toBe(0);
    expect(report.occlusions).toHaveLength(1);
    expect(report.occlusions[0].isExpectedOverlay).toBe(true);
    expect(report.verdict).toBe('occlusions_found');
  });

  it('includeExpected changes the result — it was previously inert', () => {
    const elements = [covered({ occludedBy: 'confirm-dialog' })];
    const ctx = modalContext('confirm-dialog');

    const excluded = buildVisibilityReport({ elements, modalContext: ctx });
    const included = buildVisibilityReport({
      elements,
      modalContext: ctx,
      includeExpected: true,
    });

    expect(excluded.occlusions).not.toEqual(included.occlusions);
  });

  it('matches an unregistered occluder by its DOM id', () => {
    const report = buildVisibilityReport({
      elements: [covered({ occludedBy: 'div#confirm-dialog' })],
      modalContext: modalContext('confirm-dialog'),
      includeExpected: true,
    });
    expect(report.occlusions[0].isExpectedOverlay).toBe(true);
  });

  it('does NOT match on a class or bare-tag descriptor', () => {
    // Over-claiming here would silently drop a real regression from the
    // default response, so only identity-bearing forms may match.
    for (const occludedBy of ['div.confirm-dialog', 'div', 'confirm-dialog-body']) {
      const report = buildVisibilityReport({
        elements: [covered({ occludedBy })],
        modalContext: modalContext('confirm-dialog'),
      });
      expect(report.occlusions, occludedBy).toHaveLength(1);
      expect(report.occlusions[0].isExpectedOverlay, occludedBy).toBe(false);
      expect(report.expectedOverlaysFiltered, occludedBy).toBe(0);
    }
  });

  it('leaves a genuine occlusion alone while filtering the modal beside it', () => {
    const report = buildVisibilityReport({
      elements: [
        covered({ id: 'behind-modal', occludedBy: 'confirm-dialog' }),
        covered({ id: 'real-bug', occludedBy: 'minimap' }),
      ],
      modalContext: modalContext('confirm-dialog'),
    });

    expect(report.occlusions.map((o) => o.element)).toEqual(['real-bug']);
    expect(report.expectedOverlaysFiltered).toBe(1);
    expect(report.verdict).toBe('occlusions_found');
  });

  it('without a modal stack, classification is unavailable — not "none expected"', () => {
    const report = buildVisibilityReport({
      elements: [covered({ occludedBy: 'confirm-dialog' })],
    });

    expect(report.expectedOverlayDetection).toBe('unavailable');
    expect(report.expectedOverlaysFiltered).toBe(0);
    // Nothing could be classified, so nothing is filtered: the caller sees
    // the occlusion and is told the knob had no input.
    expect(report.occlusions).toHaveLength(1);
    expect(report.occlusions[0].isExpectedOverlay).toBe(false);
  });

  it('an empty modal stack IS detection — it means no modals are open', () => {
    const report = buildVisibilityReport({
      elements: [covered({ occludedBy: 'confirm-dialog' })],
      modalContext: { modals: [], hasBlockingModal: false, count: 0 },
    });
    expect(report.expectedOverlayDetection).toBe('modal-stack');
    expect(report.occlusions[0].isExpectedOverlay).toBe(false);
  });
});

describe('buildVisibilityReport — the two surfaces agree', () => {
  // The in-page handler reads `el.getState()` off the live registry; the relay
  // reads `el.state` off the cached snapshot. Both normalize to the same input
  // shape and call this function, so the reports must be identical.
  it('produces one report from in-page and relay-shaped inputs', () => {
    const live = [
      { id: 'a', label: 'A', getState: () => ({ occludedBy: 'modal-0', occludedPct: 70, textContent: 'A' }) },
      { id: 'b', label: 'B', getState: () => ({ occludedBy: 'toolbar', occludedPct: 40, textContent: 'B' }) },
      { id: 'c', label: 'C', getState: () => ({ clippedPct: 100, clipScrollable: true, textContent: 'C' }) },
    ];
    const snapshot = [
      { id: 'a', label: 'A', state: { occludedBy: 'modal-0', occludedPct: 70, textContent: 'A' } },
      { id: 'b', label: 'B', state: { occludedBy: 'toolbar', occludedPct: 40, textContent: 'B' } },
      { id: 'c', label: 'C', state: { clippedPct: 100, clipScrollable: true, textContent: 'C' } },
    ];
    const ctx = modalContext('modal-0');

    const inPage = buildVisibilityReport({
      elements: live.map((el) => {
        const s = el.getState();
        return { id: el.id, label: el.label, ...s };
      }),
      modalContext: ctx,
    });
    const relay = buildVisibilityReport({
      elements: snapshot.map((el) => ({
        id: el.id,
        label: el.label,
        occludedBy: el.state?.occludedBy,
        occludedPct: el.state?.occludedPct,
        clippedPct: el.state?.clippedPct,
        clipScrollable: el.state?.clipScrollable,
        textContent: el.state?.textContent,
      })),
      modalContext: ctx,
    });

    expect(relay).toEqual(inPage);
    expect(inPage.occlusions.map((o) => o.element)).toEqual(['b']);
    expect(inPage.clipped.map((c) => c.element)).toEqual(['c']);
    expect(inPage.expectedOverlaysFiltered).toBe(1);
  });

  it('every entry is stamped hit-test — neither surface runs a geometric arm', () => {
    const report = buildVisibilityReport({
      elements: [covered(), covered({ id: 'other', occludedBy: 'toolbar' })],
    });
    expect(report.occlusions.every((o) => o.source === 'hit-test')).toBe(true);
  });
});
