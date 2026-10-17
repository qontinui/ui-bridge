/**
 * Timeline Summary — values derived from one recorded interaction timeline.
 *
 * Pure: a {@link TimelineCapture} in, a {@link TimelineSummary} out. Every
 * field is an `Observation` (the shared envelope in `observation/`), so
 * "measured zero", "looked and it did not happen" and "could not look" are
 * three different wire shapes. Nothing here compares a timing against a
 * constant: the only bound applied is the caller's own `withinMs`.
 */

import { Observation, type ObservationProvenance } from '../observation/observation';
import type { DetectedAnimation } from '../idle/detected-animation';
import type {
  ExpectedStateOutcome,
  ExpectedStateResult,
  TimelineEvent,
  TimelineSummary,
} from './types';
import type { TimelineCapture } from './timeline-recorder';

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
  /** Whether the host wired a declared-state source at all. */
  stateSourceAvailable: boolean;
  /** Declared-ness of each expected state id, read from the state source. */
  isDeclared: (stateId: string) => boolean;
  /** When the recording ended (sample time). Defaults to now. */
  observedAt?: number;
}

function sdkVersion(): string {
  return typeof __SDK_VERSION__ === 'string' ? __SDK_VERSION__ : 'unknown';
}

/** Neither the action itself nor the settle marker is a response. */
function isResponse(event: TimelineEvent): boolean {
  return event.type !== 'action' && event.type !== 'settled';
}

/**
 * Derive the summary. Never throws for a well-formed capture; an
 * `ObservationError` here would be a bug in this module.
 */
export function buildTimelineSummary(input: BuildTimelineSummaryInput): TimelineSummary {
  const { capture, settled, expect } = input;
  const observedAt = input.observedAt ?? Date.now();
  const evaluatedAt = new Date();
  const window = { fromMs: 0, toMs: capture.recordedUntilMs };

  const prov = (
    producer: string,
    coverage: { considered: number; measured: number },
    source: Record<string, unknown> = {}
  ): ObservationProvenance =>
    Observation.provenance({
      producer: { id: producer, version: sdkVersion() },
      observedAt,
      evaluatedAt,
      coverage: { ...coverage, unmeasured: [] },
      source: { window, ...source },
    });

  const events = capture.events;
  const responses = events.filter(isResponse);
  const first = responses[0];

  // ── firstResponseMs ──────────────────────────────────────────────────────
  const firstResponseMs: Observation<number> = first
    ? Observation.measured(
        first.offsetMs,
        prov(
          TIMELINE_PRODUCERS.events,
          { considered: events.length, measured: events.length },
          {
            eventType: first.type,
          }
        )
      )
    : Observation.unknown(
        'no_event_before_timeout',
        `no event other than the action itself occurred in the ${capture.recordedUntilMs}ms window`,
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
  const perfSource = { supportedEntryTypes: capture.perfSupport.supportedEntryTypes };
  const shiftUnsupported = (): Observation<number> =>
    Observation.unknown(
      'performance_observer_unsupported',
      "this webview's PerformanceObserver does not support the 'layout-shift' entry type",
      prov(TIMELINE_PRODUCERS.performanceObserver, { considered: 0, measured: 0 }, perfSource)
    );
  const shifts = events.filter(
    (e): e is Extract<TimelineEvent, { type: 'layout-shift' }> => e.type === 'layout-shift'
  );
  const shiftProv = (): ObservationProvenance =>
    prov(
      TIMELINE_PRODUCERS.performanceObserver,
      { considered: shifts.length, measured: shifts.length },
      perfSource
    );

  const layoutShiftTotal = capture.layoutShiftObserved
    ? Observation.measured(
        shifts.reduce((sum, s) => sum + s.value, 0),
        shiftProv()
      )
    : shiftUnsupported();
  const layoutShiftCount = capture.layoutShiftObserved
    ? Observation.measured(shifts.length, shiftProv())
    : shiftUnsupported();

  let layoutShiftAfterFirstResponseMs: Observation<number>;
  if (!capture.layoutShiftObserved) {
    layoutShiftAfterFirstResponseMs = shiftUnsupported();
  } else if (shifts.length === 0) {
    // Looked over the whole window (one window considered, measured in full)
    // and no shift occurred.
    layoutShiftAfterFirstResponseMs = Observation.absent(
      prov(TIMELINE_PRODUCERS.performanceObserver, { considered: 1, measured: 1 }, perfSource)
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
      prov(
        TIMELINE_PRODUCERS.performanceObserver,
        { considered: shifts.length, measured: shifts.length },
        { ...perfSource, lastShiftAtMs: last.offsetMs, firstResponseAtMs: first.offsetMs }
      )
    );
  }

  // ── long tasks ───────────────────────────────────────────────────────────
  const longTasks = events.filter(
    (e): e is Extract<TimelineEvent, { type: 'long-task' }> => e.type === 'long-task'
  );
  const longTaskTotalMs: Observation<number> = capture.longTaskObserved
    ? Observation.measured(
        longTasks.reduce((sum, t) => sum + t.durationMs, 0),
        prov(
          TIMELINE_PRODUCERS.performanceObserver,
          { considered: longTasks.length, measured: longTasks.length },
          perfSource
        )
      )
    : Observation.unknown(
        'performance_observer_unsupported',
        "this webview's PerformanceObserver does not support the 'longtask' entry type",
        prov(TIMELINE_PRODUCERS.performanceObserver, { considered: 0, measured: 0 }, perfSource)
      );

  // ── animations ───────────────────────────────────────────────────────────
  let animationsUnsettledAtEnd: Observation<DetectedAnimation[]>;
  if (!capture.animationEventsObserved) {
    animationsUnsettledAtEnd = Observation.unknown(
      'capability_unavailable_in_build',
      'no DOM to observe animation events on',
      prov(TIMELINE_PRODUCERS.animations, { considered: 0, measured: 0 })
    );
  } else {
    const n = capture.unsettledAnimations.length;
    animationsUnsettledAtEnd = Observation.measured(
      capture.unsettledAnimations,
      Observation.provenance({
        producer: { id: TIMELINE_PRODUCERS.animations, version: sdkVersion() },
        observedAt,
        evaluatedAt,
        coverage: {
          considered: n,
          measured: n,
          // Without getAnimations, an animation that started before the action
          // and is still running produced no event in the window: unseen.
          unmeasured: capture.getAnimationsAvailable
            ? []
            : [
                {
                  dimension: 'animations-running-before-action',
                  count: 1,
                  code: 'capability_unavailable_in_build',
                },
              ],
        },
        source: { window, getAnimations: capture.getAnimationsAvailable },
      })
    );
  }

  // ── expected states ──────────────────────────────────────────────────────
  const expectedStates: ExpectedStateResult[] = (expect?.stateIds ?? []).map((stateId) => ({
    stateId,
    outcome: expectedStateOutcome(stateId),
  }));

  function expectedStateOutcome(stateId: string): Observation<ExpectedStateOutcome> {
    const withinMs = expect!.withinMs;
    const stateProv = (considered: number): ObservationProvenance =>
      prov(TIMELINE_PRODUCERS.states, { considered, measured: considered }, { withinMs });
    if (!input.stateSourceAvailable || capture.activeStatesAtStart === null) {
      return Observation.unknown(
        'capability_unavailable_in_build',
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
    const mine = events.filter(
      (e): e is Extract<TimelineEvent, { type: 'state-entered' | 'state-exited' }> =>
        (e.type === 'state-entered' || e.type === 'state-exited') && e.stateId === stateId
    );
    const entered = mine.find((e) => e.type === 'state-entered' && e.offsetMs <= withinMs);
    if (entered) {
      return Observation.measured({ enteredAtMs: entered.offsetMs }, stateProv(1));
    }
    if (capture.recordedUntilMs < withinMs) {
      return Observation.unknown(
        'no_event_before_timeout',
        `recording stopped at ${capture.recordedUntilMs}ms, before the ${withinMs}ms window closed`,
        stateProv(0)
      );
    }
    const wasActive = capture.activeStatesAtStart.includes(stateId);
    const exitedInWindow = mine.some((e) => e.type === 'state-exited' && e.offsetMs <= withinMs);
    if (wasActive && !exitedInWindow) {
      return Observation.measured({ activeThroughoutWithinMs: withinMs }, stateProv(1));
    }
    return Observation.measured({ notEnteredWithinMs: withinMs }, stateProv(1));
  }

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
