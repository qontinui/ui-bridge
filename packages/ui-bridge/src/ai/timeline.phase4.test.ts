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
import { ChangeTracker, ChangeTrackerRequestError, type ChangeTrackerDeps } from './change-tracker';
import { buildTimelineSummary } from './timeline-summary';
import type { SemanticSnapshot, ChangeTimeline, TimelineEvent } from './types';
import type { ControlSnapshot } from '../control/types';
import type { SemanticSnapshotManager } from './semantic-snapshot';
import type {
  TimelineCapture,
  TimelineNetworkEvent,
  TimelineStateSource,
} from './timeline-recorder';
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
      observerAvailable: false,
    });
    expect(observeLayoutShifts(() => {})).toBeNull();
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
    // One CLS event per observer batch; the recent-input shift is excluded.
    expect(cls).toEqual([0.2]);
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
    const { button, content } = mountPage();
    let networkListener: ((e: TimelineNetworkEvent) => void) | null = null;
    const subscribeNetworkEvents = vi.fn((cb: (e: TimelineNetworkEvent) => void) => {
      networkListener = cb;
      return () => {
        networkListener = null;
      };
    });

    const executeElementAction = vi.fn(async () => {
      // The app responds at once: the button reads "Saving…" (a visible
      // response) and a save request goes out (work, not a response)…
      button.textContent = 'Saving…';
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
      url: `${location.origin}/api/save`,
      hasQuery: false,
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
          count: 0,
          code: 'input_missing',
        },
      ]);
      // Element details were filled in at stop(), not in the listener.
      expect(typeof unsettled.value[0].targetElement).toBe('string');
    }
    expect(typeof ended[0].animation.targetElement).toBe('string');
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
      // An HTTP error status is not `errored` — the request did not throw.
      errored: false,
    });
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});

// ============================================================================
// Review round: offsets, sources, caps, network redaction, rounding
// ============================================================================

describe('offsets are from the action call, not the before-snapshot', () => {
  it('a slow before-snapshot does not push the first offset late; earlier events are dropped', async () => {
    installPerformanceObserver(['layout-shift', 'longtask']);
    const { content } = mountPage();
    let calls = 0;
    const executeElementAction = vi.fn(async () => {
      FakePerformanceObserver.emit('layout-shift', [
        {
          startTime: performance.now(),
          value: 0.05,
          hadRecentInput: false,
          sources: [{ node: content }],
        },
      ]);
      return { success: true };
    });
    const tracker = new ChangeTracker(
      fixtureDeps({
        executeElementAction,
        snapshotManager: {
          createSnapshot: vi.fn(() => {
            if (calls++ === 0) {
              // Before-snapshot: burn 150ms, and a long task lands BEFORE the action.
              const until = performance.now() + 150;
              while (performance.now() < until) {
                /* busy */
              }
              FakePerformanceObserver.emit('longtask', [
                { startTime: performance.now() - 10, duration: 60 },
              ]);
            }
            return domSnapshot();
          }),
        } as unknown as SemanticSnapshotManager,
      })
    );
    const result = await tracker.executeWithDiff({
      elementAction: { elementId: 'save', action: 'click' },
      settleMinStable: 20,
      timelineInterval: 10,
    });
    const shift = ofType(result.timeline!, 'layout-shift')[0];
    expect(shift.offsetMs).toBeLessThan(50);
    expect(ofType(result.timeline!, 'long-task')).toEqual([]);
    expect(result.timeline!.events[0]).toMatchObject({ type: 'action', offsetMs: 0 });
  });

  it('a throwing action still unsubscribes and disconnects every observer', async () => {
    installPerformanceObserver(['layout-shift', 'longtask']);
    const unsubscribe = vi.fn();
    const tracker = new ChangeTracker(
      fixtureDeps({
        subscribeChanges: vi.fn(() => unsubscribe),
        executeElementAction: vi.fn(async () => {
          throw new Error('boom');
        }),
      })
    );
    await expect(
      tracker.executeWithDiff({ elementAction: { elementId: 'save', action: 'click' } })
    ).rejects.toThrow('boom');
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(FakePerformanceObserver.live.size).toBe(0);
  });
});

describe('observed sources', () => {
  it('lists what was looked at, so a missing network means unknown, not none', async () => {
    installPerformanceObserver(['layout-shift', 'longtask']);
    const result = await new ChangeTracker(fixtureDeps()).executeWithDiff({
      elementAction: { elementId: 'save', action: 'click' },
      settleMinStable: 20,
      timelineInterval: 10,
    });
    const sources = result.timeline!.observedSources;
    expect(sources).toEqual(['snapshot-poll', 'layout-shift', 'long-task', 'animation-events']);
    expect(sources).not.toContain('network');
    expect(result.timeline!.summary.firstResponseMs.provenance.source).toMatchObject({
      observedSources: sources,
    });
  });
});

describe('response events', () => {
  it('network requests and long tasks are not a response the user sees', async () => {
    installPerformanceObserver(['layout-shift', 'longtask']);
    let listener: ((e: TimelineNetworkEvent) => void) | null = null;
    const executeElementAction = vi.fn(async () => {
      listener?.({
        type: 'request-start',
        timestamp: Date.now(),
        entry: { request: { id: 'q', url: '/api', method: 'GET', startedAt: Date.now() } },
      });
      FakePerformanceObserver.emit('longtask', [{ startTime: performance.now(), duration: 70 }]);
      return { success: true };
    });
    const result = await new ChangeTracker(
      fixtureDeps({
        executeElementAction,
        subscribeNetworkEvents: (cb) => {
          listener = cb;
          return () => (listener = null);
        },
      })
    ).executeWithDiff({
      elementAction: { elementId: 'save', action: 'click' },
      settleMinStable: 20,
      timelineInterval: 10,
    });
    expect(ofType(result.timeline!, 'network-request-started')).toHaveLength(1);
    expect(ofType(result.timeline!, 'long-task')).toHaveLength(1);
    expect(result.timeline!.summary.firstResponseMs).toMatchObject({
      status: 'unknown',
      unknown: { code: 'no_event_before_timeout' },
    });
  });
});

describe('network redaction and window', () => {
  it('carries origin + pathname and hasQuery, never the query; requests started before the action are dropped', async () => {
    let listener: ((e: TimelineNetworkEvent) => void) | null = null;
    const executeElementAction = vi.fn(async () => {
      listener?.({
        type: 'request-start',
        timestamp: Date.now(),
        entry: {
          request: { id: 'old', url: '/api/poll', method: 'GET', startedAt: Date.now() - 5000 },
        },
      });
      const request = {
        id: 'new',
        url: '/api/save?token=s3cret#frag',
        method: 'POST',
        startedAt: Date.now(),
      };
      listener?.({ type: 'request-start', timestamp: Date.now(), entry: { request } });
      listener?.({
        type: 'request-error',
        timestamp: Date.now(),
        entry: { request, error: 'Failed to fetch' },
      });
      return { success: true };
    });
    const result = await new ChangeTracker(
      fixtureDeps({
        executeElementAction,
        subscribeNetworkEvents: (cb) => {
          listener = cb;
          return () => (listener = null);
        },
      })
    ).executeWithDiff({
      elementAction: { elementId: 'save', action: 'click' },
      settleMinStable: 20,
      timelineInterval: 10,
    });
    const started = ofType(result.timeline!, 'network-request-started');
    expect(started.map((e) => e.requestId)).toEqual(['new']);
    expect(started[0].url).toBe(`${location.origin}/api/save`);
    expect(started[0].hasQuery).toBe(true);
    const finished = ofType(result.timeline!, 'network-request-finished')[0];
    expect(finished).toMatchObject({ statusCode: null, errored: true, hasQuery: true });
    expect(JSON.stringify(result.timeline)).not.toContain('s3cret');
    expect(JSON.stringify(result.timeline)).not.toContain('frag');
  });
});

describe('per-type cap', () => {
  it('keeps maxEventsPerType events and reports the overflow as unmeasured coverage', async () => {
    installPerformanceObserver(['layout-shift', 'longtask']);
    const executeElementAction = vi.fn(async () => {
      FakePerformanceObserver.emit(
        'longtask',
        [1, 2, 3, 4, 5].map(() => ({ startTime: performance.now(), duration: 60 }))
      );
      return { success: true };
    });
    const result = await new ChangeTracker(fixtureDeps({ executeElementAction }), {
      timelineMaxEventsPerType: 2,
    }).executeWithDiff({
      elementAction: { elementId: 'save', action: 'click' },
      settleMinStable: 20,
      timelineInterval: 10,
    });
    expect(ofType(result.timeline!, 'long-task')).toHaveLength(2);
    const total = result.timeline!.summary.longTaskTotalMs;
    expect(total).toMatchObject({ status: 'measured', value: 120 });
    expect(total.provenance.coverage.unmeasured).toEqual([
      { dimension: 'timeline-events:long-task', count: 3, code: 'input_missing' },
    ]);
  });
});

describe('PerformanceObserver without a supportedEntryTypes list', () => {
  beforeEach(() => {
    installPerformanceObserver([]);
    (FakePerformanceObserver as unknown as { supportedEntryTypes?: unknown }).supportedEntryTypes =
      undefined;
  });

  it('try-observes: entries confirm support and are measured', async () => {
    const handle = observeLayoutShifts(() => {});
    expect(handle?.probe).toBe('try-observe');
    handle?.disconnect();
    const executeElementAction = vi.fn(async () => {
      FakePerformanceObserver.emit('layout-shift', [
        { startTime: performance.now(), value: 0.3, hadRecentInput: false, sources: [] },
      ]);
      return { success: true };
    });
    const result = await new ChangeTracker(fixtureDeps({ executeElementAction })).executeWithDiff({
      elementAction: { elementId: 'save', action: 'click' },
      settleMinStable: 20,
      timelineInterval: 10,
    });
    expect(result.timeline!.summary.layoutShiftTotal).toMatchObject({
      status: 'measured',
      value: 0.3,
    });
    expect(result.timeline!.summary.layoutShiftTotal.provenance.source).toMatchObject({
      supportProbe: 'try-observe',
    });
  });

  it('try-observes: silence is unconfirmed support — unknown, not a measured 0', async () => {
    const result = await new ChangeTracker(fixtureDeps()).executeWithDiff({
      elementAction: { elementId: 'save', action: 'click' },
      settleMinStable: 20,
      timelineInterval: 10,
    });
    expect(result.timeline!.summary.layoutShiftTotal).toMatchObject({
      status: 'unknown',
      unknown: { code: 'performance_observer_unsupported' },
    });
  });
});

describe('getAnimations and event tracking agree', () => {
  it('an animation seen by both appears once in animationsUnsettledAtEnd', async () => {
    const { button } = mountPage();
    const effect = {
      target: button,
      getTiming: () => ({ duration: 400, iterations: Infinity }),
    };
    const anims = [{ playState: 'running', animationName: 'pulse', effect, id: '' }];
    (document as unknown as { getAnimations: () => unknown[] }).getAnimations = () => anims;
    try {
      const executeElementAction = vi.fn(async () => {
        const ev = new Event('animationstart', { bubbles: true });
        Object.assign(ev, { animationName: 'pulse' });
        button.dispatchEvent(ev);
        return { success: true };
      });
      const result = await new ChangeTracker(fixtureDeps({ executeElementAction })).executeWithDiff(
        {
          elementAction: { elementId: 'save', action: 'click' },
          settleMinStable: 20,
          timelineInterval: 10,
        }
      );
      const unsettled = result.timeline!.summary.animationsUnsettledAtEnd;
      expect(unsettled.status).toBe('measured');
      if (unsettled.status === 'measured') {
        expect(unsettled.value.map((a) => a.name)).toEqual(['pulse']);
        expect(unsettled.provenance.coverage.unmeasured).toEqual([]);
      }
      expect(result.timeline!.observedSources).toContain('get-animations');
    } finally {
      delete (document as unknown as { getAnimations?: unknown }).getAnimations;
    }
  });
});

describe('expectStates bounds', () => {
  it('no state source: answers unknown at once, without waiting out withinMs', async () => {
    const t0 = performance.now();
    const result = await new ChangeTracker(fixtureDeps()).executeWithDiff({
      elementAction: { elementId: 'save', action: 'click' },
      settleMinStable: 20,
      timelineInterval: 10,
      expectStates: ['saved-toast'],
      withinMs: 20_000,
    });
    expect(performance.now() - t0).toBeLessThan(15_000);
    expect(result.timeline!.summary.expectedStates[0].outcome).toMatchObject({
      status: 'unknown',
      unknown: { code: 'capability_unavailable_in_build' },
    });
  }, 30_000);

  it('an undeclared id is not waited for', async () => {
    const states: TimelineStateSource = {
      getActiveStates: () => [],
      isDeclared: () => false,
      subscribe: () => () => {},
    };
    const t0 = performance.now();
    const result = await new ChangeTracker(fixtureDeps({ states })).executeWithDiff({
      elementAction: { elementId: 'save', action: 'click' },
      settleMinStable: 20,
      timelineInterval: 10,
      expectStates: ['nope'],
      withinMs: 20_000,
    });
    expect(performance.now() - t0).toBeLessThan(15_000);
    expect(result.timeline!.summary.expectedStates[0].outcome).toMatchObject({
      status: 'unknown',
      unknown: { code: 'input_missing' },
    });
  }, 30_000);

  it('withinMs over the configured ceiling is refused with a typed error', async () => {
    const tracker = new ChangeTracker(fixtureDeps(), { maxWithinMs: 1000 });
    const err = await tracker
      .executeWithDiff({
        elementAction: { elementId: 'save', action: 'click' },
        expectStates: ['x'],
        withinMs: 1001,
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChangeTrackerRequestError);
    expect((err as ChangeTrackerRequestError).code).toBe('WITHIN_MS_EXCEEDS_CEILING');
  });
});

describe('the expected-state window is compared unrounded', () => {
  it('an entry at 2000.4ms is NOT within 2000ms, though its event offset rounds to 2000', () => {
    const capture: TimelineCapture = {
      events: [
        { offsetMs: 0, type: 'action', summary: 'Action executed' },
        { offsetMs: 2000, type: 'state-entered', summary: 'State entered: s', stateId: 's' },
      ],
      recordedUntilMs: 2000.4,
      observedSources: ['snapshot-poll', 'states'],
      layoutShiftProbe: null,
      longTaskProbe: null,
      unsettledAnimations: [],
      activeStatesAtStart: [],
      stateTransitions: [{ stateId: 's', active: true, atMs: 2000.4 }],
      droppedByType: {},
      perfSupport: probePerfEntrySupport(),
    };
    const summary = buildTimelineSummary({
      capture,
      settled: false,
      expect: { stateIds: ['s'], withinMs: 2000 },
      isDeclared: () => true,
    });
    expect(summary.expectedStates[0].outcome).toMatchObject({
      status: 'measured',
      value: { notEnteredWithinMs: 2000 },
    });
  });
});
