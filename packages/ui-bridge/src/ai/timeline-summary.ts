/**
 * Timeline Summary — values derived from one recorded interaction timeline.
 *
 * Pure: a {@link TimelineCapture} in, a {@link TimelineSummary} out. Every
 * field is an `Observation` (the shared envelope in `observation/`), so
 * "measured zero", "looked and it did not happen" and "could not look" are
 * three different wire shapes. Nothing here compares a timing against a
 * constant: the only bound applied is the caller's own `withinMs`.
 */

import {
  Observation,
  type ObservationProvenance,
  type UnmeasuredDimension,
} from '../observation/observation';
import type { DetectedAnimation } from '../idle/detected-animation';
import type {
  ExpectedStateOutcome,
  ExpectedStateResult,
  TimelineEvent,
  TimelineEventType,
  TimelineSummary,
} from './types';
import type { TimelineCapture } from './timeline-recorder';
import type { PerfSupportProbe } from '../perf';

declare const __SDK_VERSION__: string;

/** Producer ids, one per signal the summary reads. */
export const TIMELINE_PRODUCERS = {
  /** Snapshot polling plus every push source: first response, settle. */
  events: 'sdk/timeline/events',
  /** PerformanceObserver `layout-shift` / `longtask`. */
  performanceObserver: 'sdk/timeline/performance-observer',
  /** DOM animation / transition events plus `document.getAnimations()`. */
  animations: 'sdk/timeline/animations',
  /** The declared-state registry (`useActiveStates`). */
  states: 'sdk/timeline/state-registry',
} as const;

/**
 * The event types that count as the UI RESPONDING to the action. Not
 * `action`, `settled`, `long-task` or `network-request-*`: work the page does
 * is not a response the user sees. Mirrored in `TimelineSummary.firstResponseMs`.
 */
export const RESPONSE_EVENT_TYPES: ReadonlySet<TimelineEventType> = new Set<TimelineEventType>([
  'elements-appeared',
  'elements-disappeared',
  'elements-modified',
  'page-changed',
  'layout-shift',
  'animation-started',
  'animation-ended',
  'state-entered',
  'state-exited',
]);

/** The caller's expected-state question. */
export interface ExpectStatesInput {
  stateIds: string[];
  withinMs: number;
}

export interface BuildTimelineSummaryInput {
  capture: TimelineCapture;
  /** Whether the UI settled within `settleTimeout`. */
  settled: boolean;
  /** The caller's `expectStates` + `withinMs`, or `null` when none were asked. */
  expect: ExpectStatesInput | null;
  /** Declared-ness of each expected state id, read from the state source. */
  isDeclared: (stateId: string) => boolean;
  /** When the recording ended (sample time). Defaults to now. */
  observedAt?: number;
}

function sdkVersion(): string {
  return typeof __SDK_VERSION__ === 'string' ? __SDK_VERSION__ : 'unknown';
}

/**
 * Derive the summary. Never throws for a well-formed capture; an
 * `ObservationError` here would be a bug in this module.
 */
export function buildTimelineSummary(input: BuildTimelineSummaryInput): TimelineSummary {
  const { capture, settled, expect } = input;
  const observedAt = input.observedAt ?? Date.now();
  const evaluatedAt = new Date();
  const window = { fromMs: 0, toMs: Math.round(capture.recordedUntilMs) };
  const observedSources = capture.observedSources;

  /** Truncation gaps for the given event types (the recorder's per-type cap). */
  const dropped = (types: readonly TimelineEventType[]): UnmeasuredDimension[] =>
    types
      .filter((t) => (capture.droppedByType[t] ?? 0) > 0)
      .map((t) => ({
        dimension: `timeline-events:${t}`,
        count: capture.droppedByType[t]!,
        code: 'input_missing' as const,
      }));

  const prov = (
    producer: string,
    coverage: { considered: number; measured: number; unmeasured?: UnmeasuredDimension[] },
    source: Record<string, unknown> = {}
  ): ObservationProvenance =>
    Observation.provenance({
      producer: { id: producer, version: sdkVersion() },
      observedAt,
      evaluatedAt,
      coverage: {
        considered: coverage.considered,
        measured: coverage.measured,
        unmeasured: coverage.unmeasured ?? [],
      },
      source: { window, observedSources, ...source },
    });

  const events = capture.events;
  const first = events.find((e) => RESPONSE_EVENT_TYPES.has(e.type));
  const responseGaps = dropped([...RESPONSE_EVENT_TYPES]);

  // ── firstResponseMs ──────────────────────────────────────────────────────
  const firstResponseMs: Observation<number> = first
    ? Observation.measured(
        first.offsetMs,
        prov(
          TIMELINE_PRODUCERS.events,
          { considered: events.length, measured: events.length, unmeasured: responseGaps },
          { eventType: first.type }
        )
      )
    : Observation.unknown(
        'no_event_before_timeout',
        `nothing responded to the action in the ${window.toMs}ms window`,
        prov(TIMELINE_PRODUCERS.events, { considered: events.length, measured: events.length })
      );

  // ── settleMs ─────────────────────────────────────────────────────────────
  const settledEvent = events.find((e) => e.type === 'settled');
  const settleMs: Observation<number> =
    settled && settledEvent
      ? Observation.measured(
          settledEvent.offsetMs,
          prov(TIMELINE_PRODUCERS.events, { considered: 1, measured: 1 })
        )
      : Observation.unknown(
          'no_event_before_timeout',
          'the UI did not settle before settleTimeout elapsed',
          prov(TIMELINE_PRODUCERS.events, { considered: 0, measured: 0 })
        );

  // ── layout shifts ────────────────────────────────────────────────────────
  const perfSource = (probe: PerfSupportProbe | null): Record<string, unknown> => ({
    supportedEntryTypes: capture.perfSupport.supportedEntryTypes,
    supportProbe: probe,
  });
  const shiftSource = perfSource(capture.layoutShiftProbe);
  const shifts = events.filter(
    (e): e is Extract<TimelineEvent, { type: 'layout-shift' }> => e.type === 'layout-shift'
  );
  const shiftGaps = dropped(['layout-shift']);
  // A try-observed handle that delivered nothing has not confirmed the engine
  // supports the type (some engines silently ignore it): not a measured zero.
  const shiftUnconfirmed = capture.layoutShiftProbe === 'try-observe' && shifts.length === 0;
  const shiftUnknown = (): Observation<number> =>
    Observation.unknown(
      'performance_observer_unsupported',
      shiftUnconfirmed
        ? "this webview lists no supportedEntryTypes and delivered no 'layout-shift' entry, so support is unconfirmed"
        : "this webview's PerformanceObserver does not support the 'layout-shift' entry type",
      prov(TIMELINE_PRODUCERS.performanceObserver, { considered: 0, measured: 0 }, shiftSource)
    );
  const shiftProv = (extra: Record<string, unknown> = {}): ObservationProvenance =>
    prov(
      TIMELINE_PRODUCERS.performanceObserver,
      { considered: shifts.length, measured: shifts.length, unmeasured: shiftGaps },
      { ...shiftSource, ...extra }
    );
  const shiftsObservable = capture.layoutShiftProbe !== null && !shiftUnconfirmed;

  const layoutShiftTotal = shiftsObservable
    ? Observation.measured(
        shifts.reduce((sum, s) => sum + s.value, 0),
        shiftProv()
      )
    : shiftUnknown();
  const layoutShiftCount = shiftsObservable
    ? Observation.measured(shifts.length, shiftProv())
    : shiftUnknown();

  let layoutShiftAfterFirstResponseMs: Observation<number>;
  if (!shiftsObservable) {
    layoutShiftAfterFirstResponseMs = shiftUnknown();
  } else if (shifts.length === 0) {
    // Looked over the whole window (one window considered, measured in full)
    // and no shift occurred.
    layoutShiftAfterFirstResponseMs = Observation.absent(
      prov(TIMELINE_PRODUCERS.performanceObserver, { considered: 1, measured: 1 }, shiftSource)
    );
  } else if (!first) {
    layoutShiftAfterFirstResponseMs = Observation.unknown(
      'no_event_before_timeout',
      'no response event to measure from',
      shiftProv()
    );
  } else {
    const last = shifts[shifts.length - 1];
    layoutShiftAfterFirstResponseMs = Observation.measured(
      last.offsetMs - first.offsetMs,
      shiftProv({ lastShiftAtMs: last.offsetMs, firstResponseAtMs: first.offsetMs })
    );
  }

  // ── long tasks ───────────────────────────────────────────────────────────
  const longTasks = events.filter(
    (e): e is Extract<TimelineEvent, { type: 'long-task' }> => e.type === 'long-task'
  );
  const longSource = perfSource(capture.longTaskProbe);
  const longObservable =
    capture.longTaskProbe !== null &&
    !(capture.longTaskProbe === 'try-observe' && longTasks.length === 0);
  const longTaskTotalMs: Observation<number> = longObservable
    ? Observation.measured(
        longTasks.reduce((sum, t) => sum + t.durationMs, 0),
        prov(
          TIMELINE_PRODUCERS.performanceObserver,
          {
            considered: longTasks.length,
            measured: longTasks.length,
            unmeasured: dropped(['long-task']),
          },
          longSource
        )
      )
    : Observation.unknown(
        'performance_observer_unsupported',
        capture.longTaskProbe === 'try-observe'
          ? "this webview lists no supportedEntryTypes and delivered no 'longtask' entry, so support is unconfirmed"
          : "this webview's PerformanceObserver does not support the 'longtask' entry type",
        prov(TIMELINE_PRODUCERS.performanceObserver, { considered: 0, measured: 0 }, longSource)
      );

  // ── animations ───────────────────────────────────────────────────────────
  let animationsUnsettledAtEnd: Observation<DetectedAnimation[]>;
  if (!observedSources.includes('animation-events')) {
    animationsUnsettledAtEnd = Observation.unknown(
      'input_missing',
      'no DOM to observe animation events on',
      prov(TIMELINE_PRODUCERS.animations, { considered: 0, measured: 0 })
    );
  } else {
    const n = capture.unsettledAnimations.length;
    const unmeasured: UnmeasuredDimension[] = dropped(['animation-started', 'animation-ended']);
    if (!observedSources.includes('get-animations')) {
      // Without getAnimations, an animation that started before the action and
      // is still running produced no event in the window: unseen, and how many
      // there are is unknowable — the dimension name says so; count is 0.
      unmeasured.push({
        dimension: 'animations-running-before-action(count-unknowable)',
        count: 0,
        code: 'input_missing',
      });
    }
    animationsUnsettledAtEnd = Observation.measured(
      capture.unsettledAnimations,
      prov(TIMELINE_PRODUCERS.animations, { considered: n, measured: n, unmeasured })
    );
  }

  // ── expected states ──────────────────────────────────────────────────────
  const stateGaps = dropped(['state-entered', 'state-exited']);
  const expectedStateOutcome = (stateId: string): Observation<ExpectedStateOutcome> => {
    const withinMs = expect!.withinMs;
    const stateProv = (considered: number): ObservationProvenance =>
      prov(
        TIMELINE_PRODUCERS.states,
        { considered, measured: considered, unmeasured: considered > 0 ? stateGaps : [] },
        { withinMs }
      );
    if (!observedSources.includes('states') || capture.activeStatesAtStart === null) {
      return Observation.unknown(
        'input_missing',
        'this host wires no declared-state registry into the change tracker',
        stateProv(0)
      );
    }
    if (!input.isDeclared(stateId)) {
      return Observation.unknown(
        'input_missing',
        `the app declares no state '${stateId}'`,
        stateProv(0)
      );
    }
    // Transitions are uncapped and compared UNROUNDED against the window.
    const mine = capture.stateTransitions.filter((t) => t.stateId === stateId);
    const entered = mine.find((t) => t.active && t.atMs <= withinMs);
    if (entered) {
      return Observation.measured({ enteredAtMs: Math.round(entered.atMs) }, stateProv(1));
    }
    if (capture.recordedUntilMs < withinMs) {
      return Observation.unknown(
        'no_event_before_timeout',
        `recording stopped at ${window.toMs}ms, before the ${withinMs}ms window closed`,
        stateProv(0)
      );
    }
    const wasActive = capture.activeStatesAtStart.includes(stateId);
    const exitedInWindow = mine.some((t) => !t.active && t.atMs <= withinMs);
    if (wasActive && !exitedInWindow) {
      return Observation.measured({ activeThroughoutWithinMs: withinMs }, stateProv(1));
    }
    return Observation.measured({ notEnteredWithinMs: withinMs }, stateProv(1));
  };
  const expectedStates: ExpectedStateResult[] = (expect?.stateIds ?? []).map((stateId) => ({
    stateId,
    outcome: expectedStateOutcome(stateId),
  }));

  return {
    firstResponseMs,
    settleMs,
    layoutShiftTotal,
    layoutShiftCount,
    layoutShiftAfterFirstResponseMs,
    animationsUnsettledAtEnd,
    longTaskTotalMs,
    expectedStates,
  };
}
