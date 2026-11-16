/**
 * BackgroundObserver — what a significant tick records into open action
 * windows, and that its diff baseline advances on every real change.
 *
 * Plan `2026-11-13-ui-bridge-effect-verifier-counts-an-actions-own-dom-changes-as-concurrent`,
 * Phase 1. The verifier attributes concurrent changes by element id, so the
 * observer must say WHICH elements changed, and must not re-report an old
 * change into a window opened after it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BackgroundObserver, type TimelineCapturePayload } from '../background-observer';
import type { SemanticSnapshotManager } from '../semantic-snapshot';
import type { ControlSnapshot } from '../../control/types';
import type { AIDiscoveredElement, SemanticSnapshot } from '../types';
import {
  getGlobalActionWindowRegistry,
  resetGlobalActionWindowRegistry,
} from '../../control/action-window-registry';

interface ElementSpec {
  id: string;
  enabled?: boolean;
  text?: string;
  category?: AIDiscoveredElement['category'];
}

let snapSeq = 0;

function element(spec: ElementSpec): AIDiscoveredElement {
  return {
    id: spec.id,
    type: 'button',
    label: spec.id,
    tagName: 'button',
    actions: ['click'],
    state: {
      visible: true,
      enabled: spec.enabled ?? true,
      focused: false,
      rect: { x: 0, y: 0, width: 10, height: 10, top: 0, right: 10, bottom: 10, left: 0 },
      textContent: spec.text ?? spec.id,
    },
    registered: true,
    description: spec.id,
    aliases: [],
    suggestedActions: [],
    category: spec.category ?? 'interactive',
  } as AIDiscoveredElement;
}

function snapshot(elements: ElementSpec[], url = 'http://localhost/a'): SemanticSnapshot {
  snapSeq++;
  return {
    timestamp: 0,
    snapshotId: `snap-${snapSeq}`,
    page: { url, title: 't', activeModals: [] },
    elements: elements.map(element),
    forms: [],
    activeModals: [],
    summary: 's',
    elementCounts: {},
  } as unknown as SemanticSnapshot;
}

describe('BackgroundObserver — concurrent observations', () => {
  let clock: number;
  let next: SemanticSnapshot;
  let captures: TimelineCapturePayload[];
  let observer: BackgroundObserver;

  /** Run one tick against `snap` at the current clock. */
  async function tickWith(snap: SemanticSnapshot): Promise<void> {
    next = snap;
    await (observer as unknown as { tick(): Promise<void> }).tick();
  }

  beforeEach(async () => {
    resetGlobalActionWindowRegistry();
    clock = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    captures = [];
    observer = new BackgroundObserver(
      {
        snapshotManager: {
          createSnapshot: () => next,
        } as unknown as SemanticSnapshotManager,
        createControlSnapshot: () => ({}) as ControlSnapshot,
        onCapture: async (payload) => {
          captures.push(payload);
        },
      },
      // No interval tick fires during a test: every tick is driven by hand.
      { minCaptureIntervalMs: 1_000_000_000, maxCaptureIntervalMs: 1_000_000_000 }
    );
    // start() runs the bootstrap tick; wait for its capture.
    next = snapshot([{ id: 'save-btn' }, { id: 'old-banner' }, { id: 'total', text: 'Total 1', category: 'content' }]);
    observer.start();
    await vi.waitFor(() => expect(captures).toHaveLength(1));
  });

  afterEach(() => {
    observer.stop();
    vi.restoreAllMocks();
    resetGlobalActionWindowRegistry();
  });

  it('records changed element ids per tick into open windows', async () => {
    const windows = getGlobalActionWindowRegistry();
    clock += 1_000;
    const h = windows.beginAction('req-1', 'click', clock);

    clock += 1_000;
    await tickWith(
      snapshot(
        [
          { id: 'save-btn', enabled: false }, // modified (enabled)
          // 'old-banner' disappeared
          { id: 'total', text: 'Total 2', category: 'content' }, // text content
          { id: 'toast-1' }, // appeared
        ],
        'http://localhost/b' // URL moved
      )
    );

    const obs = windows.concurrentObservations(h);
    expect(obs.saw).toBe(true);
    expect(obs.overflow).toBe(false);
    expect(obs.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'appeared', elementId: 'toast-1' }),
        expect.objectContaining({ kind: 'disappeared', elementId: 'old-banner' }),
        expect.objectContaining({ kind: 'modified', elementId: 'save-btn' }),
        expect.objectContaining({ kind: 'content', elementId: 'total' }),
        { kind: 'page' },
      ])
    );
    // Every element-kind change names its element.
    for (const c of obs.changes) {
      if (c.kind !== 'page') expect(c.elementId).toBeDefined();
    }
  });

  it('advances the diff baseline on a significant change whose text hash is unchanged', async () => {
    const windows = getGlobalActionWindowRegistry();
    // A button toggles `disabled`: significant, but the serialized text (and
    // so the content hash) is unchanged, so the capture is deduplicated.
    const disabled = [
      { id: 'save-btn', enabled: false },
      { id: 'old-banner' },
      { id: 'total', text: 'Total 1', category: 'content' as const },
    ];
    clock += 5_000;
    await tickWith(snapshot(disabled));
    expect(captures).toHaveLength(1); // deduplicated — no second capture

    // An action starts AFTER that change, and the page does not change again.
    clock += 2_000;
    const h = windows.beginAction('req-late', 'click', clock);
    clock += 3_000;
    await tickWith(snapshot(disabled));

    // The old toggle must not be re-reported into the later window.
    expect(windows.concurrentObservations(h)).toEqual({ saw: false, changes: [], overflow: false });
  });
});
