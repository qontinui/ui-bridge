/**
 * Interaction timeline — Phase 4 of plan
 * 2026-09-20-ui-bridge-represents-the-users-path-and-the-passage-of-time.
 *
 * PerformanceObserver is mocked both PRESENT and ABSENT (jsdom ships none), so
 * the honesty contract is pinned on both sides: an unsupported entry type is
 * `unknown{performance_observer_unsupported}`, a static page is `measured(0)`,
 * and the two serialize to different shapes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ChangeTracker, type ChangeTrackerDeps } from './change-tracker';
import type { SemanticSnapshot, ChangeTimeline, TimelineEvent } from './types';
import type { ControlSnapshot } from '../control/types';
import type { SemanticSnapshotManager } from './semantic-snapshot';
import type { TimelineNetworkEvent, TimelineStateSource } from './timeline-recorder';
import { probePerfEntrySupport, observeLayoutShifts } from '../perf';
import { installWebVitalsCapture } from '../debug/captures/web-vitals';
import { installLongTaskCapture } from '../debug/captures/long-tasks';
import { __resetGlobalBookmarkStoreForTest } from './bookmarks';

// ============================================================================
// PerformanceObserver mock
// ============================================================================

type Callback = (list: { getEntries(): PerformanceEntry[] }) => void;

class FakePerformanceObserver {
  static supportedEntryTypes: string[] = [];
  static live = new Set<FakePerformanceObserver>();
  type: string | null = null;
  private queue: PerformanceEntry[] = [];
  constructor(private readonly callback: Callback) {}
  observe(init: { type: string }): void {
    this.type = init.type;
    FakePerformanceObserver.live.add(this);
  }
  disconnect(): void {
    FakePerformanceObserver.live.delete(this);
  }
  takeRecords(): PerformanceEntry[] {
    return this.queue.splice(0);
  }
  /** Deliver entries to every live observer of `type`, as the browser would. */
  static emit(type: string, entries: Array<Record<string, unknown>>): void {
    for (const obs of FakePerformanceObserver.live) {
      if (obs.type === type) {
        const list = entries as unknown as PerformanceEntry[];
        obs.callback({ getEntries: () => list });
      }
    }
  }
}

function installPerformanceObserver(supported: string[]): void {
  FakePerformanceObserver.supportedEntryTypes = supported;
  FakePerformanceObserver.live.clear();
  vi.stubGlobal('PerformanceObserver', FakePerformanceObserver);
}

function removePerformanceObserver(): void {
  vi.stubGlobal('PerformanceObserver', undefined);
}

// ============================================================================
// Fixture: snapshots read from the live jsdom document
// ============================================================================

function domSnapshot(): SemanticSnapshot {
  const ids = Array.from(document.querySelectorAll<HTMLElement>('[data-fixture-id]')).map(
    (el) => el.dataset.fixtureId!
  );
  return {
    timestamp: Date.now(),
    snapshotId: `snap-${Math.random()}`,
    page: { url: 'http://localhost/fixture', title: 'Fixture', activeModals: [] },
    elements: ids.map((id) => ({
      id,
      type: 'button',
      label: id,
      tagName: 'div',
      actions: ['click'],
      state: {
        visible: true,
        enabled: true,
        focused: false,
        rect: { x: 0, y: 0, width: 100, height: 30, top: 0, right: 100, bottom: 30, left: 0 },
        textContent: document.querySelector(`[data-fixture-id="${id}"]`)?.textContent ?? '',
      },
      registered: true,
      description: id,
      aliases: [],
      suggestedActions: [],
      category: 'interactive' as const,
    })),
    forms: [],
    activeModals: [],
    summary: 'fixture',
    elementCounts: {},
  } as unknown as SemanticSnapshot;
}

function fixtureDeps(overrides: Partial<ChangeTrackerDeps> = {}): ChangeTrackerDeps {
  return {
    snapshotManager: {
      createSnapshot: vi.fn(() => domSnapshot()),
    } as unknown as SemanticSnapshotManager,
    idleDetector: null,
    createControlSnapshot: vi.fn(() => ({}) as ControlSnapshot),
    executeElementAction: vi.fn().mockResolvedValue({ success: true }),
    executeNLAction: vi.fn().mockResolvedValue({ success: true }),
    refreshElements: vi.fn(),
    ...overrides,
  };
}

function mountPage(): { button: HTMLElement; content: HTMLElement } {
  document.body.innerHTML = '';
  const button = document.createElement('button');
  button.dataset.fixtureId = 'save';
  button.textContent = 'Save';
  const content = document.createElement('main');
  content.dataset.fixtureId = 'content';
  content.textContent = 'Content';
  document.body.append(button, content);
  return { button, content };
}

function ofType<T extends TimelineEvent['type']>(
  timeline: ChangeTimeline,
  type: T
): Array<Extract<TimelineEvent, { type: T }>> {
  return timeline.events.filter((e): e is Extract<TimelineEvent, { type: T }> => e.type === type);
}

beforeEach(() => {
  __resetGlobalBookmarkStoreForTest();
  mountPage();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

// ============================================================================
// perf/ probe
// ============================================================================

describe('perf/ probe', () => {
  it('reads supportedEntryTypes', () => {
    installPerformanceObserver(['layout-shift', 'longtask', 'paint']);
    const support = probePerfEntrySupport();
    expect(support.layoutShift).toBe(true);
    expect(support.longTask).toBe(true);
    expect(support.supportedEntryTypes).toEqual(['layout-shift', 'longtask', 'paint']);
  });

  it('a webview without the entry types (WebKitGTK) supports neither', () => {
    installPerformanceObserver(['paint', 'resource']);
    const support = probePerfEntrySupport();
    expect(support.layoutShift).toBe(false);
    expect(support.longTask).toBe(false);
    expect(observeLayoutShifts(() => {})).toBeNull();
  });

  it('no PerformanceObserver at all supports nothing and reports no list', () => {
    removePerformanceObserver();
    expect(probePerfEntrySupport()).toEqual({
      layoutShift: false,
      longTask: false,
      supportedEntryTypes: null,
    });
  });

  it('web-vitals CLS and long-task capture use the shared observers', () => {
    installPerformanceObserver(['layout-shift', 'longtask', 'largest-contentful-paint', 'event']);
    const emitted: Array<Record<string, unknown>> = [];
    const stopVitals = installWebVitalsCapture((e) => emitted.push(e as never));
    const stopLong = installLongTaskCapture((e) => emitted.push(e as never));
    FakePerformanceObserver.emit('layout-shift', [
      { startTime: 1, value: 0.2, hadRecentInput: false, sources: [] },
      { startTime: 2, value: 0.5, hadRecentInput: true, sources: [] },
    ]);
    FakePerformanceObserver.emit('longtask', [{ startTime: 3, duration: 80.4 }]);
    const cls = emitted.filter((e) => e.metric === 'CLS').map((e) => e.value);
    expect(cls).toEqual([0.2, 0.2]); // the recent-input shift is excluded from CLS
    expect(emitted.find((e) => e.type === 'long-task')?.durationMs).toBe(80);
    stopVitals();
    stopLong();
    expect(FakePerformanceObserver.live.size).toBe(0);
  });
});

// ============================================================================
// Default-on
// ============================================================================

describe('timeline default-on', () => {
  it('executeWithDiff records a timeline without being asked', async () => {
    installPerformanceObserver(['layout-shift', 'longtask']);
    const tracker = new ChangeTracker(fixtureDeps());
    const result = await tracker.executeWithDiff({
      elementAction: { elementId: 'save', action: 'click' },
      settleMinStable: 20,
      timelineInterval: 10,
    });
    expect(result.timeline).toBeDefined();
    expect(result.timeline!.summary.settleMs.status).toBe('measured');
  });

  it('timeline: false is the explicit opt-out', async () => {
    const tracker = new ChangeTracker(fixtureDeps());
    const result = await tracker.executeWithDiff({
      elementAction: { elementId: 'save', action: 'click' },
      timeline: false,
      settleMinStable: 10,
    });
    expect(result.timeline).toBeUndefined();
  });

  it('settle waits for the idle detector, not just a quiet registry', async () => {
    let idle = false;
    setTimeout(() => (idle = true), 120);
    const tracker = new ChangeTracker(
      fixtureDeps({
        idleDetector: { isIdle: () => idle } as unknown as ChangeTrackerDeps['idleDetector'],
      })
    );
    const result = await tracker.executeWithDiff({
      elementAction: { elementId: 'save', action: 'click' },
      settleMinStable: 20,
      timelineInterval: 10,
      settleTimeout: 2000,
    });
    const settled = result.timeline!.summary.settleMs;
    expect(settled.status).toBe('measured');
    if (settled.status === 'measured') expect(settled.value).toBeGreaterThanOrEqual(110);
  });

  it('a timeline that never settles reports settleMs unknown{no_event_before_timeout}', async () => {
    let n = 0;
    const tracker = new ChangeTracker(
      fixtureDeps({
        snapshotManager: {
          createSnapshot: vi.fn(() => {
            // A new element on every poll: never stable.
            const el = document.createElement('div');
            el.dataset.fixtureId = `churn-${n++}`;
            document.body.append(el);
            return domSnapshot();
          }),
        } as unknown as SemanticSnapshotManager,
      })
    );
    const result = await tracker.executeWithDiff({
      elementAction: { elementId: 'save', action: 'click' },
      settleMinStable: 50,
      timelineInterval: 10,
      settleTimeout: 120,
    });
    expect(result.settleTimedOut).toBe(true);
    const settle = result.timeline!.summary.settleMs;
    expect(settle.status).toBe('unknown');
    if (settle.status === 'unknown') expect(settle.unknown.code).toBe('no_event_before_timeout');
  });
});

// ============================================================================
// Acceptance 1 — late banner, static page, no API
// ============================================================================

describe('layout shifts', () => {
  it('a banner inserted 300ms after the click yields a layout-shift at ≈300ms', async () => {
    installPerformanceObserver(['layout-shift', 'longtask']);
    const { content } = mountPage();
    let networkListener: ((e: TimelineNetworkEvent) => void) | null = null;
    const subscribeNetworkEvents = vi.fn((cb: (e: TimelineNetworkEvent) => void) => {
      networkListener = cb;
      return () => {
        networkListener = null;
      };
    });

    const executeElementAction = vi.fn(async () => {
      // The app responds at once (a save request goes out)…
      networkListener?.({
        type: 'request-start',
        timestamp: Date.now(),
        entry: { request: { id: 'r1', url: '/api/save', method: 'POST', startedAt: Date.now() } },
      });
      // …and a banner pushes the content down 300ms later.
      setTimeout(() => {
        const banner = document.createElement('div');
        banner.dataset.fixtureId = 'banner';
        banner.textContent = 'Saved!';
        document.body.insertBefore(banner, content);
        FakePerformanceObserver.emit('layout-shift', [
          {
            startTime: performance.now(),
            value: 0.12,
            hadRecentInput: false,
            sources: [{ node: content }],
          },
        ]);
      }, 300);
      return { success: true };
    });

    const tracker = new ChangeTracker(
      fixtureDeps({ executeElementAction, subscribeNetworkEvents })
    );
    const result = await tracker.executeWithDiff({
      elementAction: { elementId: 'save', action: 'click' },
      // Generous enough that a loaded box's late timer cannot settle the UI
      // before the banner lands; the assertions below are relative, not absolute.
      settleMinStable: 1500,
      timelineInterval: 25,
      settleTimeout: 8000,
    });

    const timeline = result.timeline!;
    const shifts = ofType(timeline, 'layout-shift');
    expect(shifts).toHaveLength(1);
    // ≈300ms: never before the 300ms timer (minus offset rounding), and no
    // later than the poll that saw the banner it caused.
    expect(shifts[0].offsetMs).toBeGreaterThanOrEqual(299);
    const bannerSeen = ofType(timeline, 'elements-appeared').find((e) =>
      e.elementIds.includes('banner')
    );
    expect(bannerSeen).toBeDefined();
    expect(shifts[0].offsetMs).toBeLessThanOrEqual(bannerSeen!.offsetMs);
    expect(shifts[0].value).toBe(0.12);
    expect(shifts[0].shiftedFingerprints).toHaveLength(1);
    expect(shifts[0].unattributedSourceCount).toBe(0);
    expect(ofType(timeline, 'network-request-started')[0]).toMatchObject({
      requestId: 'r1',
      method: 'POST',
      url: '/api/save',
    });

    const { summary } = timeline;
    expect(summary.firstResponseMs.status).toBe('measured');
    expect(summary.layoutShiftTotal).toMatchObject({ status: 'measured', value: 0.12 });
    expect(summary.layoutShiftCount).toMatchObject({ status: 'measured', value: 1 });
    const after = summary.layoutShiftAfterFirstResponseMs;
    expect(after.status).toBe('measured');
    if (after.status === 'measured' && summary.firstResponseMs.status === 'measured') {
      expect(after.value).toBe(shifts[0].offsetMs - summary.firstResponseMs.value);
      expect(after.value).toBeGreaterThanOrEqual(250);
    }
    // Events are ordered by offset.
    const offsets = timeline.events.map((e) => e.offsetMs);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    // Every observer was disconnected.
    expect(FakePerformanceObserver.live.size).toBe(0);
  }, 30_000);

  it('a static page measures layoutShiftTotal 0; no API is unknown — a DIFFERENT shape', async () => {
    installPerformanceObserver(['layout-shift', 'longtask']);
    const withApi = await new ChangeTracker(fixtureDeps()).executeWithDiff({
      elementAction: { elementId: 'save', action: 'click' },
      settleMinStable: 30,
      timelineInterval: 10,
    });

    removePerformanceObserver();
    const withoutApi = await new ChangeTracker(fixtureDeps()).executeWithDiff({
      elementAction: { elementId: 'save', action: 'click' },
      settleMinStable: 30,
      timelineInterval: 10,
    });

    const zero = withApi.timeline!.summary;
    expect(zero.layoutShiftTotal).toMatchObject({ status: 'measured', value: 0 });
    expect(zero.layoutShiftCount).toMatchObject({ status: 'measured', value: 0 });
    expect(zero.longTaskTotalMs).toMatchObject({ status: 'measured', value: 0 });
    expect(zero.layoutShiftAfterFirstResponseMs.status).toBe('absent');
    // Nothing happened at all: no first response.
    expect(zero.firstResponseMs).toMatchObject({
      status: 'unknown',
      unknown: { code: 'no_event_before_timeout' },
    });

    const none = withoutApi.timeline!.summary;
    for (const field of [
      none.layoutShiftTotal,
      none.layoutShiftCount,
      none.layoutShiftAfterFirstResponseMs,
      none.longTaskTotalMs,
    ]) {
      expect(field).toMatchObject({
        status: 'unknown',
        unknown: { code: 'performance_observer_unsupported' },
      });
    }

    const zeroWire = JSON.parse(JSON.stringify(zero.layoutShiftTotal));
    const noneWire = JSON.parse(JSON.stringify(none.layoutShiftTotal));
    expect(Object.keys(zeroWire).sort()).toEqual(['provenance', 'status', 'value']);
    expect(Object.keys(noneWire).sort()).toEqual(['provenance', 'status', 'unknown']);
    expect(JSON.stringify(zeroWire)).not.toBe(JSON.stringify(noneWire));
  });

  it('PerformanceObserver present but without layout-shift is still unknown (WebKitGTK)', async () => {
    installPerformanceObserver(['paint', 'resource']);
    const result = await new ChangeTracker(fixtureDeps()).executeWithDiff({
      elementAction: { elementId: 'save', action: 'click' },
      settleMinStable: 20,
      timelineInterval: 10,
    });
    expect(result.timeline!.summary.layoutShiftTotal).toMatchObject({
      status: 'unknown',
      unknown: { code: 'performance_observer_unsupported' },
    });
    expect(result.timeline!.summary.layoutShiftTotal.provenance.source).toMatchObject({
      supportedEntryTypes: ['paint', 'resource'],
    });
  });

  it('records long tasks and sums them', async () => {
    installPerformanceObserver(['layout-shift', 'longtask']);
    const executeElementAction = vi.fn(async () => {
      FakePerformanceObserver.emit('longtask', [
        { startTime: performance.now(), duration: 70 },
        { startTime: performance.now(), duration: 55.6 },
      ]);
      return { success: true };
    });
    const result = await new ChangeTracker(fixtureDeps({ executeElementAction })).executeWithDiff({
      elementAction: { elementId: 'save', action: 'click' },
      settleMinStable: 20,
      timelineInterval: 10,
    });
    expect(ofType(result.timeline!, 'long-task').map((e) => e.durationMs)).toEqual([70, 56]);
    expect(result.timeline!.summary.longTaskTotalMs).toMatchObject({
      status: 'measured',
      value: 126,
    });
  });
});

// ============================================================================
// Animations
// ============================================================================

describe('animations', () => {
  function animationEvent(type: string, name: string, elapsed?: number): Event {
    const ev = new Event(type, { bubbles: true });
    Object.assign(ev, { animationName: name, elapsedTime: elapsed });
    return ev;
  }

  it('records started/ended and reports what is still running at the end', async () => {
    const { button, content } = mountPage();
    const executeElementAction = vi.fn(async () => {
      button.dispatchEvent(animationEvent('animationstart', 'pulse'));
      content.dispatchEvent(animationEvent('animationstart', 'slide-in'));
      setTimeout(() => content.dispatchEvent(animationEvent('animationend', 'slide-in', 0.2)), 30);
      return { success: true };
    });
    const result = await new ChangeTracker(fixtureDeps({ executeElementAction })).executeWithDiff({
      elementAction: { elementId: 'save', action: 'click' },
      settleMinStable: 60,
      timelineInterval: 10,
    });
    const timeline = result.timeline!;
    expect(ofType(timeline, 'animation-started').map((e) => e.animation.name)).toEqual([
      'pulse',
      'slide-in',
    ]);
    const ended = ofType(timeline, 'animation-ended');
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({
      endReason: 'finished',
      animation: { name: 'slide-in', durationMs: 200 },
    });
    const unsettled = timeline.summary.animationsUnsettledAtEnd;
    expect(unsettled.status).toBe('measured');
    if (unsettled.status === 'measured') {
      expect(unsettled.value.map((a) => a.name)).toEqual(['pulse']);
      // jsdom has no document.getAnimations: the gap is named, not hidden.
      expect(unsettled.provenance.coverage.unmeasured).toEqual([
        {
          dimension: 'animations-running-before-action',
          count: 1,
          code: 'capability_unavailable_in_build',
        },
      ]);
    }
  });
});

// ============================================================================
// Acceptance 2 — expected states
// ============================================================================

describe('expectStates', () => {
  function stateSource(declared: string[]): TimelineStateSource & {
    activate(id: string): void;
  } {
    const active = new Set<string>();
    const listeners = new Set<(e: { stateId: string; active: boolean }) => void>();
    return {
      getActiveStates: () => [...active],
      isDeclared: (id) => declared.includes(id),
      subscribe(cb) {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      activate(id) {
        active.add(id);
        listeners.forEach((l) => l({ stateId: id, active: true }));
      },
    };
  }

  it('a state never shown within 2000ms is notEnteredWithinMs: 2000 — a measured negative', async () => {
    const states = stateSource(['saved-toast']);
    const t0 = performance.now();
    const result = await new ChangeTracker(fixtureDeps({ states })).executeWithDiff({
      elementAction: { elementId: 'save', action: 'click' },
      settleMinStable: 20,
      timelineInterval: 20,
      expectStates: ['saved-toast'],
      withinMs: 2000,
    });
    expect(performance.now() - t0).toBeGreaterThanOrEqual(2000);
    const [entry] = result.timeline!.summary.expectedStates;
    expect(entry.stateId).toBe('saved-toast');
    expect(entry.outcome).toMatchObject({
      status: 'measured',
      value: { notEnteredWithinMs: 2000 },
    });
  }, 30_000);

  it('a state entered at ≈100ms answers enteredAtMs and stops waiting early', async () => {
    const states = stateSource(['saved-toast']);
    const executeElementAction = vi.fn(async () => {
      setTimeout(() => states.activate('saved-toast'), 100);
      return { success: true };
    });
    const t0 = performance.now();
    const result = await new ChangeTracker(
      fixtureDeps({ states, executeElementAction })
    ).executeWithDiff({
      elementAction: { elementId: 'save', action: 'click' },
      settleMinStable: 20,
      timelineInterval: 10,
      expectStates: ['saved-toast'],
      withinMs: 10_000,
    });
    // Returned as soon as the state entered, not at the end of the window.
    expect(performance.now() - t0).toBeLessThan(10_000);
    const outcome = result.timeline!.summary.expectedStates[0].outcome;
    expect(outcome.status).toBe('measured');
    if (outcome.status === 'measured' && 'enteredAtMs' in outcome.value) {
      expect(outcome.value.enteredAtMs).toBeGreaterThanOrEqual(99);
      expect(outcome.value.enteredAtMs).toBe(ofType(result.timeline!, 'state-entered')[0].offsetMs);
    } else {
      throw new Error(`expected enteredAtMs, got ${JSON.stringify(outcome)}`);
    }
    expect(ofType(result.timeline!, 'state-entered')[0].stateId).toBe('saved-toast');
  }, 30_000);

  it('an undeclared state is unknown{input_missing}; no state registry is unknown{capability_unavailable_in_build}', async () => {
    const declared = await new ChangeTracker(
      fixtureDeps({ states: stateSource([]) })
    ).executeWithDiff({
      elementAction: { elementId: 'save', action: 'click' },
      settleMinStable: 20,
      timelineInterval: 10,
      expectStates: ['saved-toast'],
      withinMs: 50,
    });
    expect(declared.timeline!.summary.expectedStates[0].outcome).toMatchObject({
      status: 'unknown',
      unknown: { code: 'input_missing' },
    });

    const noRegistry = await new ChangeTracker(fixtureDeps()).executeWithDiff({
      elementAction: { elementId: 'save', action: 'click' },
      settleMinStable: 20,
      timelineInterval: 10,
      expectStates: ['saved-toast'],
      withinMs: 50,
    });
    expect(noRegistry.timeline!.summary.expectedStates[0].outcome).toMatchObject({
      status: 'unknown',
      unknown: { code: 'capability_unavailable_in_build' },
    });
  });

  it('a state already active for the whole window answers activeThroughoutWithinMs', async () => {
    const states = stateSource(['editor']);
    states.activate('editor');
    const result = await new ChangeTracker(fixtureDeps({ states })).executeWithDiff({
      elementAction: { elementId: 'save', action: 'click' },
      settleMinStable: 20,
      timelineInterval: 10,
      expectStates: ['editor'],
      withinMs: 80,
    });
    expect(result.timeline!.summary.expectedStates[0].outcome).toMatchObject({
      status: 'measured',
      value: { activeThroughoutWithinMs: 80 },
    });
  });

  it('expectStates without a window, or with timeline: false, is refused', async () => {
    const tracker = new ChangeTracker(fixtureDeps({ states: stateSource(['x']) }));
    await expect(
      tracker.executeWithDiff({
        elementAction: { elementId: 'save', action: 'click' },
        expectStates: ['x'],
      })
    ).rejects.toThrow(/withinMs/);
    await expect(
      tracker.executeWithDiff({
        elementAction: { elementId: 'save', action: 'click' },
        expectStates: ['x'],
        withinMs: 100,
        timeline: false,
      })
    ).rejects.toThrow(/timeline: false/);
  });

  it('no expectStates means expectedStates: []', async () => {
    const result = await new ChangeTracker(fixtureDeps()).executeWithDiff({
      elementAction: { elementId: 'save', action: 'click' },
      settleMinStable: 20,
      timelineInterval: 10,
    });
    expect(result.timeline!.summary.expectedStates).toEqual([]);
  });
});

// ============================================================================
// Network
// ============================================================================

describe('network events', () => {
  it('records started and finished, with failure read from the status', async () => {
    let listener: ((e: TimelineNetworkEvent) => void) | null = null;
    const unsubscribe = vi.fn();
    const subscribeNetworkEvents = vi.fn((cb: (e: TimelineNetworkEvent) => void) => {
      listener = cb;
      return unsubscribe;
    });
    const executeElementAction = vi.fn(async () => {
      const request = { id: 'a', url: '/x', method: 'GET', startedAt: Date.now() };
      listener?.({ type: 'request-start', timestamp: Date.now(), entry: { request } });
      listener?.({
        type: 'request-error',
        timestamp: Date.now(),
        entry: { request, response: { statusCode: 500, durationMs: 12 } },
      });
      return { success: true };
    });
    const result = await new ChangeTracker(
      fixtureDeps({ subscribeNetworkEvents, executeElementAction })
    ).executeWithDiff({
      elementAction: { elementId: 'save', action: 'click' },
      settleMinStable: 20,
      timelineInterval: 10,
    });
    expect(ofType(result.timeline!, 'network-request-finished')[0]).toMatchObject({
      requestId: 'a',
      statusCode: 500,
      durationMs: 12,
      failed: true,
    });
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
