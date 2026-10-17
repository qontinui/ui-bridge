/**
 * Timeline Recorder — the push-fed half of the interaction timeline.
 *
 * `ChangeTracker.executeWithDiff` polls registry snapshots for element
 * changes; this recorder runs beside it from the moment BEFORE the action
 * executes until recording stops, and collects what polling cannot see:
 *
 * - `layout-shift` and `long-task` entries, from the shared `perf/` observers;
 * - CSS animation / transition starts and ends (`animationstart`,
 *   `transitionstart`, …), plus `document.getAnimations()` at the end;
 * - tracked network requests starting and finishing;
 * - declared UI states (the registry `useActiveStates` reads) entering and
 *   exiting.
 *
 * Every push event is stamped with `performance.now()` at receipt (PerformanceObserver
 * entries use their own `startTime`, which is on the same clock), as an offset
 * from the action start. The recorder decides nothing: it applies no
 * threshold and reports no verdict — {@link buildTimelineSummary} derives
 * values, and the caller judges them.
 */

import type { DetectedAnimation } from '../idle/detected-animation';
import type { TimelineEvent } from './types';
import {
  observeLayoutShifts,
  observeLongTasks,
  type PerfEntrySupport,
  type PerfObserverHandle,
} from '../perf';
import { computeElementFingerprint } from '../core/element-fingerprint';

// ============================================================================
// Sources
// ============================================================================

/** A tracked network request event, as the change tracker's network hook delivers it. */
export interface TimelineNetworkEvent {
  /** `request-start` | `request-complete` | `request-error` (NetworkRequestTracker's vocabulary). */
  type: string;
  timestamp: number;
  entry: {
    request: { id?: string; url: string; method: string; startedAt: number };
    response?: { statusCode: number; durationMs: number };
    /** Present when the request threw. */
    error?: string;
  };
}

/** Subscribe to tracked network request events; returns an unsubscribe function. */
export type TimelineNetworkSubscriber = (
  callback: (event: TimelineNetworkEvent) => void
) => () => void;

/** The app's declared UI states — the registry behind `useActiveStates`. */
export interface TimelineStateSource {
  /** Ids of the currently active states. */
  getActiveStates(): string[];
  /** Whether the app declares (registered) a state with this id. */
  isDeclared(stateId: string): boolean;
  /** Subscribe to activation changes; returns an unsubscribe function. */
  subscribe(callback: (event: { stateId: string; active: boolean }) => void): () => void;
}

/** What the recorder listens to. Every source is optional except the probe result. */
export interface TimelineRecorderSources {
  /** PerformanceObserver support, probed when the tracker was installed. */
  perfSupport: PerfEntrySupport;
  subscribeNetworkEvents?: TimelineNetworkSubscriber;
  states?: TimelineStateSource;
}

/** What {@link TimelineRecorder.stop} hands to the summary. */
export interface TimelineCapture {
  /** All recorded events, ordered by `offsetMs` (ties keep arrival order). */
  events: TimelineEvent[];
  /** Offset (ms from action start) at which recording stopped. */
  recordedUntilMs: number;
  /** Whether layout shifts were observable for the whole window. */
  layoutShiftObserved: boolean;
  /** Whether long tasks were observable for the whole window. */
  longTaskObserved: boolean;
  /** Animations running when recording stopped. */
  unsettledAnimations: DetectedAnimation[];
  /** Whether `document.getAnimations()` could be read at stop. */
  getAnimationsAvailable: boolean;
  /** Whether a DOM existed to listen for animation events on. */
  animationEventsObserved: boolean;
  /** Active state ids when recording started; `null` without a state source. */
  activeStatesAtStart: string[] | null;
  /** The probed support, echoed into provenance. */
  perfSupport: PerfEntrySupport;
}

// ============================================================================
// Recorder
// ============================================================================

const ANIMATION_START_EVENTS = ['animationstart', 'transitionstart'] as const;
const ANIMATION_END_EVENTS = [
  'animationend',
  'animationcancel',
  'transitionend',
  'transitioncancel',
] as const;

function fingerprintOf(el: Element | null): string | undefined {
  if (!el || typeof HTMLElement === 'undefined' || !(el instanceof HTMLElement)) return undefined;
  try {
    return computeElementFingerprint(el).hash;
  } catch {
    return undefined;
  }
}

function animationNameOf(event: Event): string {
  const e = event as Event & { animationName?: string; propertyName?: string };
  if (event.type.startsWith('transition')) return `transition:${e.propertyName ?? ''}`;
  return e.animationName ?? '';
}

function isInfiniteAnimation(el: Element | null, event: Event): boolean {
  if (event.type.startsWith('transition') || !el || typeof getComputedStyle !== 'function') {
    return false;
  }
  try {
    return getComputedStyle(el)
      .animationIterationCount.split(',')
      .some((v) => v.trim() === 'infinite');
  } catch {
    return false;
  }
}

/** Records push-sourced timeline events for one action. Single use. */
export class TimelineRecorder {
  private readonly entries: TimelineEvent[] = [];
  private readonly cleanups: Array<() => void> = [];
  private readonly perfHandles: PerfObserverHandle[] = [];
  private readonly running = new Map<Element, Map<string, DetectedAnimation>>();
  private readonly entered = new Set<string>();
  private layoutShiftObserved = false;
  private longTaskObserved = false;
  private animationEventsObserved = false;
  private activeStatesAtStart: string[] | null = null;
  private stopped = false;
  private capture: TimelineCapture | null = null;

  constructor(
    private readonly sources: TimelineRecorderSources,
    /** `performance.now()` at action start — offset 0. */
    private readonly actionStart: number
  ) {}

  /** Offset of "now" from the action start, in whole ms. */
  offsetNow(): number {
    return Math.round(performance.now() - this.actionStart);
  }

  /** Append an event (the snapshot poll uses this for element / page / settled events). */
  record(event: TimelineEvent): void {
    if (this.stopped) return;
    this.entries.push(event);
    if (event.type === 'state-entered') this.entered.add(event.stateId);
  }

  /** Whether a `state-entered` event for `stateId` has been recorded. */
  hasEntered(stateId: string): boolean {
    return this.entered.has(stateId);
  }

  /** Install every available source. Call BEFORE the action executes. */
  start(): void {
    const { perfSupport } = this.sources;

    const shifts = observeLayoutShifts(
      (sample) => {
        if (sample.startTime < this.actionStart) return;
        const fingerprints: string[] = [];
        let unattributed = 0;
        for (const source of sample.sources) {
          const node = source.node;
          const el =
            node && node.nodeType === 1 ? (node as Element) : (node?.parentElement ?? null);
          const fp = el && el.isConnected ? fingerprintOf(el) : undefined;
          if (fp !== undefined) fingerprints.push(fp);
          else unattributed++;
        }
        this.record({
          offsetMs: Math.round(sample.startTime - this.actionStart),
          type: 'layout-shift',
          summary: `Layout shift ${sample.value.toFixed(4)} (${sample.sources.length} source(s))`,
          value: sample.value,
          hadRecentInput: sample.hadRecentInput,
          shiftedFingerprints: fingerprints,
          unattributedSourceCount: unattributed,
        });
      },
      { support: perfSupport }
    );
    if (shifts) {
      this.layoutShiftObserved = true;
      this.perfHandles.push(shifts);
    }

    const longTasks = observeLongTasks(
      (sample) => {
        if (sample.startTime < this.actionStart) return;
        this.record({
          offsetMs: Math.round(sample.startTime - this.actionStart),
          type: 'long-task',
          summary: `Long task ${Math.round(sample.duration)}ms`,
          durationMs: Math.round(sample.duration),
        });
      },
      { support: perfSupport }
    );
    if (longTasks) {
      this.longTaskObserved = true;
      this.perfHandles.push(longTasks);
    }

    this.installAnimationListeners();
    this.installNetwork();
    this.installStates();
  }

  private installAnimationListeners(): void {
    if (typeof document === 'undefined') return;
    this.animationEventsObserved = true;
    const onStart = (event: Event): void => {
      const el = event.target instanceof Element ? event.target : null;
      const animation: DetectedAnimation = {
        name: animationNameOf(event),
        targetElement: fingerprintOf(el),
        isInfinite: isInfiniteAnimation(el, event),
      };
      if (el) {
        let byName = this.running.get(el);
        if (!byName) {
          byName = new Map();
          this.running.set(el, byName);
        }
        byName.set(animation.name, animation);
      }
      this.record({
        offsetMs: this.offsetNow(),
        type: 'animation-started',
        summary: `Animation started: ${animation.name}`,
        animation,
      });
    };
    const onEnd = (event: Event): void => {
      const el = event.target instanceof Element ? event.target : null;
      const name = animationNameOf(event);
      const started = el ? this.running.get(el)?.get(name) : undefined;
      if (el) {
        const byName = this.running.get(el);
        byName?.delete(name);
        if (byName && byName.size === 0) this.running.delete(el);
      }
      const elapsed = (event as Event & { elapsedTime?: number }).elapsedTime;
      const animation: DetectedAnimation = {
        name,
        targetElement: started?.targetElement ?? fingerprintOf(el),
        isInfinite: started?.isInfinite ?? isInfiniteAnimation(el, event),
        ...(typeof elapsed === 'number' && Number.isFinite(elapsed)
          ? { durationMs: Math.round(elapsed * 1000) }
          : {}),
      };
      const cancelled = event.type.endsWith('cancel');
      this.record({
        offsetMs: this.offsetNow(),
        type: 'animation-ended',
        summary: `Animation ${cancelled ? 'cancelled' : 'ended'}: ${name}`,
        animation,
        endReason: cancelled ? 'cancelled' : 'finished',
      });
    };
    for (const type of ANIMATION_START_EVENTS) {
      document.addEventListener(type, onStart, true);
      this.cleanups.push(() => document.removeEventListener(type, onStart, true));
    }
    for (const type of ANIMATION_END_EVENTS) {
      document.addEventListener(type, onEnd, true);
      this.cleanups.push(() => document.removeEventListener(type, onEnd, true));
    }
  }

  private installNetwork(): void {
    const subscribe = this.sources.subscribeNetworkEvents;
    if (!subscribe) return;
    this.cleanups.push(
      subscribe((event) => {
        const { request, response, error } = event.entry;
        const requestId = request.id ?? null;
        if (event.type === 'request-start') {
          this.record({
            offsetMs: this.offsetNow(),
            type: 'network-request-started',
            summary: `${request.method} ${request.url} started`,
            requestId,
            method: request.method,
            url: request.url,
          });
        } else if (event.type === 'request-complete' || event.type === 'request-error') {
          const statusCode = response?.statusCode ?? null;
          const failed =
            event.type === 'request-error' ||
            error !== undefined ||
            (statusCode !== null && statusCode >= 400);
          this.record({
            offsetMs: this.offsetNow(),
            type: 'network-request-finished',
            summary: `${request.method} ${request.url} ${
              statusCode !== null ? `answered ${statusCode}` : 'failed with no response'
            }`,
            requestId,
            method: request.method,
            url: request.url,
            statusCode,
            durationMs: response?.durationMs ?? null,
            failed,
          });
        }
      })
    );
  }

  private installStates(): void {
    const states = this.sources.states;
    if (!states) return;
    this.activeStatesAtStart = [...states.getActiveStates()];
    this.cleanups.push(
      states.subscribe(({ stateId, active }) => {
        this.record({
          offsetMs: this.offsetNow(),
          type: active ? 'state-entered' : 'state-exited',
          summary: `State ${active ? 'entered' : 'exited'}: ${stateId}`,
          stateId,
        });
      })
    );
  }

  private readRunningAnimations(): { animations: DetectedAnimation[]; available: boolean } {
    if (typeof document === 'undefined' || typeof document.getAnimations !== 'function') {
      return { animations: [], available: false };
    }
    try {
      const out: DetectedAnimation[] = [];
      for (const anim of document.getAnimations()) {
        if (anim.playState !== 'running') continue;
        const a = anim as Animation & { animationName?: string; transitionProperty?: string };
        const target = (anim.effect as KeyframeEffect | null)?.target ?? null;
        const timing = anim.effect?.getTiming?.();
        const duration = typeof timing?.duration === 'number' ? timing.duration : undefined;
        out.push({
          name:
            a.animationName ??
            (a.transitionProperty !== undefined ? `transition:${a.transitionProperty}` : anim.id),
          targetElement: fingerprintOf(target),
          isInfinite: timing?.iterations === Infinity,
          ...(duration !== undefined && Number.isFinite(duration) ? { durationMs: duration } : {}),
        });
      }
      return { animations: out, available: true };
    } catch {
      return { animations: [], available: false };
    }
  }

  /** Flush the observers, remove every listener, and hand back what was recorded. Idempotent. */
  stop(): TimelineCapture {
    if (this.capture) return this.capture;
    for (const handle of this.perfHandles) handle.flush();
    const recordedUntilMs = this.offsetNow();
    const running = this.readRunningAnimations();
    this.stopped = true;
    for (const handle of this.perfHandles) handle.disconnect();
    for (const cleanup of this.cleanups.splice(0)) {
      try {
        cleanup();
      } catch {
        // A failing unsubscribe must not lose the recording.
      }
    }

    const unsettled: DetectedAnimation[] = [];
    const seen = new Set<string>();
    const add = (a: DetectedAnimation): void => {
      const key = `${a.targetElement ?? ''}\u0000${a.name}`;
      if (seen.has(key)) return;
      seen.add(key);
      unsettled.push(a);
    };
    for (const byName of this.running.values()) byName.forEach(add);
    running.animations.forEach(add);

    // Stable sort by offset: ties keep arrival order.
    const events = this.entries
      .map((event, index) => ({ event, index }))
      .sort((a, b) => a.event.offsetMs - b.event.offsetMs || a.index - b.index)
      .map(({ event }) => event);

    this.capture = {
      events,
      recordedUntilMs,
      layoutShiftObserved: this.layoutShiftObserved,
      longTaskObserved: this.longTaskObserved,
      unsettledAnimations: unsettled,
      getAnimationsAvailable: running.available,
      animationEventsObserved: this.animationEventsObserved,
      activeStatesAtStart: this.activeStatesAtStart,
      perfSupport: this.sources.perfSupport,
    };
    return this.capture;
  }
}
