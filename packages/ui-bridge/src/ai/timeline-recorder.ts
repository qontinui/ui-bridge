/**
 * Timeline Recorder — the push-fed half of the interaction timeline.
 *
 * `ChangeTracker.executeWithDiff` polls registry snapshots for element
 * changes; this recorder runs beside it and collects what polling cannot see:
 *
 * - `layout-shift` and `long-task` entries, from the shared `perf/` observers;
 * - CSS animation / transition starts and ends (`animationstart`,
 *   `transitionstart`, …), plus `document.getAnimations()` at the end;
 * - tracked network requests starting and finishing;
 * - declared UI states (the registry `useActiveStates` reads) entering and
 *   exiting.
 *
 * Listeners are installed with {@link TimelineRecorder.start} BEFORE the
 * action, but nothing is kept until {@link TimelineRecorder.markActionStart}
 * — `performance.now()` taken immediately before the action call. Every
 * offset is from that instant, and anything observed earlier is dropped.
 *
 * The listeners do the minimum (capture a reference and a timestamp);
 * fingerprinting and computed-style reads are deferred to `stop()`, so the
 * page's own animation events are not slowed by observation. Each event type
 * is capped (`maxEventsPerType`, a count — not a timing threshold); overflow
 * is counted and reported, never silently dropped.
 *
 * The recorder decides nothing: it applies no threshold and reports no
 * verdict — {@link buildTimelineSummary} derives values, and the caller
 * judges them.
 */

import type { DetectedAnimation } from '../idle/detected-animation';
import type {
  AnimationEndedTimelineEvent,
  AnimationStartedTimelineEvent,
  TimelineEvent,
  TimelineEventType,
  TimelineSource,
} from './types';
import {
  observeLayoutShifts,
  observeLongTasks,
  type PerfEntrySupport,
  type PerfObserverHandle,
  type PerfSupportProbe,
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
    /** `startedAt` is epoch ms (`Date.now()`), as the tracker records it. */
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

/** The slice of a UI Bridge registry a {@link TimelineStateSource} reads. */
export interface StateRegistryLike {
  getActiveStates?(): ReadonlyArray<string | { id: string }>;
  getState?(id: string): unknown;
  on?(type: 'element:stateChanged', listener: (event: { data?: unknown }) => void): () => void;
}

/**
 * Adapt a registry (the live `UIBridgeRegistry`, or a server-side
 * `RegistryLike`) into a {@link TimelineStateSource}, or `undefined` when it
 * cannot report declared states. One adapter for every transport, so the
 * direct and relay producers see states identically.
 */
export function stateSourceFromRegistry(
  registry: StateRegistryLike
): TimelineStateSource | undefined {
  if (!registry.getActiveStates || !registry.getState || !registry.on) return undefined;
  return {
    // The live registry answers ids; RegistryLike's contract says UIState
    // objects. Accept either.
    getActiveStates: () =>
      (registry.getActiveStates?.() ?? []).map((s) => (typeof s === 'string' ? s : s.id)),
    isDeclared: (stateId) => registry.getState?.(stateId) !== undefined,
    subscribe: (callback) =>
      registry.on?.('element:stateChanged', (event) => {
        const data = event.data as { stateId?: unknown; active?: unknown } | undefined;
        if (typeof data?.stateId === 'string' && typeof data.active === 'boolean') {
          callback({ stateId: data.stateId, active: data.active });
        }
      }) ?? (() => {}),
  };
}

/** What the recorder listens to. Every source is optional except the probe result. */
export interface TimelineRecorderSources {
  /** PerformanceObserver support, probed when the tracker was installed. */
  perfSupport: PerfEntrySupport;
  subscribeNetworkEvents?: TimelineNetworkSubscriber;
  states?: TimelineStateSource;
  /** Whether an idle detector gates `settled` (reported in `observedSources`). */
  idleDetector?: boolean;
  /** Per-event-type cap on kept events. A count, not a timing. */
  maxEventsPerType: number;
}

/** One declared-state transition, at its UNROUNDED offset from action start. */
export interface StateTransition {
  stateId: string;
  active: boolean;
  atMs: number;
}

/** What {@link TimelineRecorder.stop} hands to the summary. */
export interface TimelineCapture {
  /** All kept events, ordered by `offsetMs` (ties keep arrival order). */
  events: TimelineEvent[];
  /** Unrounded offset (ms from action start) at which recording stopped. */
  recordedUntilMs: number;
  /** The sources this recording observed. */
  observedSources: TimelineSource[];
  /** How layout shifts were observable; `null` = not observable. */
  layoutShiftProbe: PerfSupportProbe | null;
  /** How long tasks were observable; `null` = not observable. */
  longTaskProbe: PerfSupportProbe | null;
  /** Animations running when recording stopped (deduplicated by element + name). */
  unsettledAnimations: DetectedAnimation[];
  /** Active state ids when the action started; `null` without a state source. */
  activeStatesAtStart: string[] | null;
  /** Every declared-state transition, uncapped and unrounded. */
  stateTransitions: StateTransition[];
  /** Events dropped per type because the per-type cap was reached. */
  droppedByType: Partial<Record<TimelineEventType, number>>;
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

function isInfiniteCssAnimation(el: Element | null): boolean {
  if (!el || typeof getComputedStyle !== 'function') return false;
  try {
    return getComputedStyle(el)
      .animationIterationCount.split(',')
      .some((v) => v.trim() === 'infinite');
  } catch {
    return false;
  }
}

/** Origin + pathname of a request URL, and whether it carried a query. Never the query itself. */
export function redactRequestUrl(raw: string): { url: string; hasQuery: boolean } {
  try {
    const base =
      typeof location !== 'undefined' && location.href ? location.href : 'http://localhost/';
    const u = new URL(raw, base);
    return { url: `${u.origin}${u.pathname}`, hasQuery: u.search.length > 1 };
  } catch {
    const q = raw.indexOf('?');
    const h = raw.indexOf('#');
    const cut = [q, h].filter((i) => i >= 0);
    const end = cut.length > 0 ? Math.min(...cut) : raw.length;
    const query = q >= 0 ? raw.slice(q + 1, h > q ? h : undefined) : '';
    return { url: raw.slice(0, end), hasQuery: query.length > 0 };
  }
}

/** A captured animation event whose element details are filled in at `stop()`. */
interface PendingAnimation {
  event: AnimationStartedTimelineEvent | AnimationEndedTimelineEvent;
  element: Element | null;
  isTransition: boolean;
}

/** Records push-sourced timeline events for one action. Single use. */
export class TimelineRecorder {
  private readonly entries: TimelineEvent[] = [];
  private readonly countByType = new Map<TimelineEventType, number>();
  private readonly droppedByType: Partial<Record<TimelineEventType, number>> = {};
  private readonly cleanups: Array<() => void> = [];
  private readonly perfHandles: PerfObserverHandle[] = [];
  private readonly pendingAnimations: PendingAnimation[] = [];
  /** Running animations keyed by element, then name — the dedupe identity. */
  private readonly running = new Map<Element | null, Map<string, PendingAnimation>>();
  private readonly entered = new Set<string>();
  private readonly stateTransitions: StateTransition[] = [];
  private layoutShiftProbe: PerfSupportProbe | null = null;
  private longTaskProbe: PerfSupportProbe | null = null;
  private animationEventsObserved = false;
  private activeStatesAtStart: string[] | null = null;
  private actionStart: number | null = null;
  private actionStartEpoch = 0;
  private stopped = false;
  private capture: TimelineCapture | null = null;

  constructor(private readonly sources: TimelineRecorderSources) {}

  /**
   * Mark the action start: `performance.now()` taken immediately before the
   * action call. Offsets are from here; nothing earlier is kept.
   */
  markActionStart(at: number): void {
    this.actionStart = at;
    // Network events stamp `startedAt` with Date.now(); compare on that clock.
    this.actionStartEpoch = Date.now();
    if (this.sources.states) this.activeStatesAtStart = [...this.sources.states.getActiveStates()];
    this.record({ offsetMs: 0, type: 'action', summary: 'Action executed' });
  }

  /** The marked action start, or `null` before {@link markActionStart}. */
  getActionStart(): number | null {
    return this.actionStart;
  }

  /** Unrounded offset of "now" from the action start (0 before the mark). */
  elapsedMs(): number {
    return this.actionStart === null ? 0 : performance.now() - this.actionStart;
  }

  /** Append an event. Dropped before the action start, or over the per-type cap. */
  record(event: TimelineEvent): boolean {
    if (this.stopped || this.actionStart === null) return false;
    const n = this.countByType.get(event.type) ?? 0;
    if (n >= this.sources.maxEventsPerType && event.type !== 'action' && event.type !== 'settled') {
      this.droppedByType[event.type] = (this.droppedByType[event.type] ?? 0) + 1;
      return false;
    }
    this.countByType.set(event.type, n + 1);
    this.entries.push(event);
    return true;
  }

  /** Whether `stateId` has entered since the action started. */
  hasEntered(stateId: string): boolean {
    return this.entered.has(stateId);
  }

  /** Install every available source. Call BEFORE the action executes. */
  start(): void {
    const { perfSupport } = this.sources;

    const shifts = observeLayoutShifts(
      (samples) => {
        for (const sample of samples) {
          if (this.actionStart === null || sample.startTime < this.actionStart) continue;
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
        }
      },
      { support: perfSupport }
    );
    if (shifts) {
      this.layoutShiftProbe = shifts.probe;
      this.perfHandles.push(shifts);
    }

    const longTasks = observeLongTasks(
      (samples) => {
        for (const sample of samples) {
          if (this.actionStart === null || sample.startTime < this.actionStart) continue;
          this.record({
            offsetMs: Math.round(sample.startTime - this.actionStart),
            type: 'long-task',
            summary: `Long task ${Math.round(sample.duration)}ms`,
            durationMs: Math.round(sample.duration),
          });
        }
      },
      { support: perfSupport }
    );
    if (longTasks) {
      this.longTaskProbe = longTasks.probe;
      this.perfHandles.push(longTasks);
    }

    this.installAnimationListeners();
    this.installNetwork();
    this.installStates();
  }

  private installAnimationListeners(): void {
    if (typeof document === 'undefined') return;
    this.animationEventsObserved = true;
    const nameOf = (event: Event): string => {
      const e = event as Event & { animationName?: string; propertyName?: string };
      return event.type.startsWith('transition')
        ? `transition:${e.propertyName ?? ''}`
        : (e.animationName ?? '');
    };
    // Listeners capture a reference and a time only; element details are read at stop().
    const onStart = (event: Event): void => {
      if (this.actionStart === null) return;
      const element = event.target instanceof Element ? event.target : null;
      const name = nameOf(event);
      const timelineEvent: AnimationStartedTimelineEvent = {
        offsetMs: Math.round(this.elapsedMs()),
        type: 'animation-started',
        summary: `Animation started: ${name}`,
        animation: { name, isInfinite: false },
      };
      const pending: PendingAnimation = {
        event: timelineEvent,
        element,
        isTransition: event.type.startsWith('transition'),
      };
      let byName = this.running.get(element);
      if (!byName) {
        byName = new Map();
        this.running.set(element, byName);
      }
      byName.set(name, pending);
      if (this.record(timelineEvent)) this.pendingAnimations.push(pending);
    };
    const onEnd = (event: Event): void => {
      if (this.actionStart === null) return;
      const element = event.target instanceof Element ? event.target : null;
      const name = nameOf(event);
      const byName = this.running.get(element);
      byName?.delete(name);
      if (byName && byName.size === 0) this.running.delete(element);
      const elapsed = (event as Event & { elapsedTime?: number }).elapsedTime;
      const cancelled = event.type.endsWith('cancel');
      const timelineEvent: AnimationEndedTimelineEvent = {
        offsetMs: Math.round(this.elapsedMs()),
        type: 'animation-ended',
        summary: `Animation ${cancelled ? 'cancelled' : 'ended'}: ${name}`,
        animation: {
          name,
          isInfinite: false,
          ...(typeof elapsed === 'number' && Number.isFinite(elapsed)
            ? { durationMs: Math.round(elapsed * 1000) }
            : {}),
        },
        endReason: cancelled ? 'cancelled' : 'finished',
      };
      if (this.record(timelineEvent)) {
        this.pendingAnimations.push({
          event: timelineEvent,
          element,
          isTransition: event.type.startsWith('transition'),
        });
      }
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
        if (this.actionStart === null) return;
        const { request, response, error } = event.entry;
        // Only requests the action could have caused: started at or after it.
        if (request.startedAt < this.actionStartEpoch) return;
        const requestId = request.id ?? null;
        const { url, hasQuery } = redactRequestUrl(request.url);
        if (event.type === 'request-start') {
          this.record({
            offsetMs: Math.round(this.elapsedMs()),
            type: 'network-request-started',
            summary: `${request.method} ${url}${hasQuery ? '?…' : ''} started`,
            requestId,
            method: request.method,
            url,
            hasQuery,
          });
        } else if (event.type === 'request-complete' || event.type === 'request-error') {
          const statusCode = response?.statusCode ?? null;
          const errored =
            error !== undefined || (event.type === 'request-error' && response === undefined);
          this.record({
            offsetMs: Math.round(this.elapsedMs()),
            type: 'network-request-finished',
            summary: `${request.method} ${url}${hasQuery ? '?…' : ''} ${
              statusCode !== null ? `answered ${statusCode}` : 'errored with no response'
            }`,
            requestId,
            method: request.method,
            url,
            hasQuery,
            statusCode,
            durationMs: response?.durationMs ?? null,
            errored,
          });
        }
      })
    );
  }

  private installStates(): void {
    const states = this.sources.states;
    if (!states) return;
    this.cleanups.push(
      states.subscribe(({ stateId, active }) => {
        if (this.actionStart === null) return;
        const atMs = this.elapsedMs();
        this.stateTransitions.push({ stateId, active, atMs });
        if (active) this.entered.add(stateId);
        this.record({
          offsetMs: Math.round(atMs),
          type: active ? 'state-entered' : 'state-exited',
          summary: `State ${active ? 'entered' : 'exited'}: ${stateId}`,
          stateId,
        });
      })
    );
  }

  private readRunningAnimations(): {
    animations: Array<{ element: Element | null; animation: DetectedAnimation }>;
    available: boolean;
  } {
    if (typeof document === 'undefined' || typeof document.getAnimations !== 'function') {
      return { animations: [], available: false };
    }
    try {
      const out: Array<{ element: Element | null; animation: DetectedAnimation }> = [];
      for (const anim of document.getAnimations()) {
        if (anim.playState !== 'running') continue;
        const a = anim as Animation & { animationName?: string; transitionProperty?: string };
        const element = (anim.effect as KeyframeEffect | null)?.target ?? null;
        const timing = anim.effect?.getTiming?.();
        const duration = typeof timing?.duration === 'number' ? timing.duration : undefined;
        out.push({
          element,
          animation: {
            name:
              a.animationName ??
              (a.transitionProperty !== undefined ? `transition:${a.transitionProperty}` : anim.id),
            targetElement: fingerprintOf(element),
            isInfinite: timing?.iterations === Infinity,
            ...(duration !== undefined && Number.isFinite(duration)
              ? { durationMs: duration }
              : {}),
          },
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
    const recordedUntilMs = this.elapsedMs();
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

    // Deferred from the listeners: fingerprint and computed style, once per element.
    const fingerprints = new Map<Element | null, string | undefined>();
    const fp = (el: Element | null): string | undefined => {
      if (!fingerprints.has(el)) fingerprints.set(el, fingerprintOf(el));
      return fingerprints.get(el);
    };
    const infinite = new Map<Element | null, boolean>();
    const inf = (el: Element | null): boolean => {
      if (!infinite.has(el)) infinite.set(el, isInfiniteCssAnimation(el));
      return infinite.get(el)!;
    };
    const detail = (p: PendingAnimation): DetectedAnimation => {
      const target = fp(p.element);
      return {
        ...p.event.animation,
        ...(target !== undefined ? { targetElement: target } : {}),
        isInfinite: p.isTransition ? false : inf(p.element),
      };
    };
    for (const p of this.pendingAnimations) p.event.animation = detail(p);

    // Unsettled: started without ending, plus getAnimations — one entry per element + name.
    const unsettled: DetectedAnimation[] = [];
    const seen = new Map<Element | null, Set<string>>();
    const add = (element: Element | null, name: string, animation: DetectedAnimation): void => {
      let names = seen.get(element);
      if (!names) {
        names = new Set();
        seen.set(element, names);
      }
      if (names.has(name)) return;
      names.add(name);
      unsettled.push(animation);
    };
    for (const [element, byName] of this.running) {
      for (const [name, p] of byName) add(element, name, detail(p));
    }
    for (const { element, animation } of running.animations)
      add(element, animation.name, animation);

    const observedSources: TimelineSource[] = ['snapshot-poll'];
    if (this.sources.idleDetector) observedSources.push('idle-detector');
    if (this.layoutShiftProbe) observedSources.push('layout-shift');
    if (this.longTaskProbe) observedSources.push('long-task');
    if (this.animationEventsObserved) observedSources.push('animation-events');
    if (running.available) observedSources.push('get-animations');
    if (this.sources.subscribeNetworkEvents) observedSources.push('network');
    if (this.sources.states) observedSources.push('states');

    // Stable sort by offset: ties keep arrival order.
    const events = this.entries
      .map((event, index) => ({ event, index }))
      .sort((a, b) => a.event.offsetMs - b.event.offsetMs || a.index - b.index)
      .map(({ event }) => event);

    this.capture = {
      events,
      recordedUntilMs,
      observedSources,
      layoutShiftProbe: this.layoutShiftProbe,
      longTaskProbe: this.longTaskProbe,
      unsettledAnimations: unsettled,
      activeStatesAtStart: this.activeStatesAtStart,
      stateTransitions: [...this.stateTransitions],
      droppedByType: { ...this.droppedByType },
      perfSupport: this.sources.perfSupport,
    };
    return this.capture;
  }
}
