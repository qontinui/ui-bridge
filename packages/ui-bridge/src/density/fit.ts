/**
 * `fit`: before the page exists, how many of a role's asks the first screen
 * can hold.
 *
 * The asks are stacked in rank order, each at `rows × max(lines · fontPx ·
 * lineHeightRatio + 2 · rowPadPx, targetPx for an action)` — its declared
 * `form`, drawn at the caller's floors — under the chrome measured on any page
 * of the same shell (`contentTopPx` of that page's capture: the top of its
 * first non-chrome leaf) and above that page's bottom pin. Per role and
 * viewport it answers the rank at which the fold is crossed. Everything it
 * reports is labelled `basis: predicted`: nothing of the page is measured,
 * because the page does not exist yet.
 *
 * Without floors there is nothing to draw an ask at, so the answer is
 * `unknown{no_expectation}`. An ask with no declared `form` has no height: the
 * stack below it is unknown, and so is the crossing when it falls below it. An
 * ask whose `answer` is `null` (nothing on the page will answer it) is listed
 * as unanswered and takes no space.
 *
 * Plan: 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change (Phase 7).
 */

import { Observation, type ObservationTime } from '../observation/observation';
import { measureDensity } from './measure';
import type { DensityFloors } from './reach';
import type { DensityUnknownQuantity } from './repeats';
import {
  DENSITY_TARGETS_SCHEMA,
  type DensityAskKind,
  type DensityCapture,
  type DensityCell,
  type DensityProducer,
  type DensityTargets,
} from './schema';
import { densityPins } from './structure';

/** One ask, placed in the predicted stack. */
export interface DensityFitAsk {
  id: string;
  rank: number;
  kind: DensityAskKind;
  weight: number;
  /** `null` when the ask declares no `form`. */
  heightPx: number | null;
  /** `null` when an ask above it has no height. */
  topPx: number | null;
  bottomPx: number | null;
  /** Whether it ends at or above the fold; `null` when its place is unknown. */
  fits: boolean | null;
}

/** Where the fold is crossed. */
export type DensityFitCrossing =
  | { crossed: true; rank: number; ask: string }
  | { crossed: false }
  | DensityUnknownQuantity;

export interface DensityFitReport {
  basis: 'predicted';
  cell: DensityCell;
  /** Where the content starts: the shell page's `contentTopPx`. */
  chromeTopPx: number;
  /** The shell page's bottom pin, px. */
  pinBottomPx: number;
  /** `H − pinBottom`: the first screen's last usable px. */
  foldPx: number;
  floors: DensityFloors;
  asks: DensityFitAsk[];
  foldCrossedAt: DensityFitCrossing;
  unanswered: string[];
}

export interface DensityFitOptions {
  producer: DensityProducer;
  targets: DensityTargets;
  floors: DensityFloors | null;
  /** Captures of pages of the same shell, one per viewport. */
  shells: readonly DensityCapture[];
  evaluatedAt?: ObservationTime;
}

/** The height an ask takes at the floors: `rows × max(lines · fontPx · lineHeightRatio + 2 · rowPadPx, targetPx for an action)`. */
export function densityFitHeight(
  form: { rows: number; lines: number },
  kind: DensityAskKind,
  floors: DensityFloors
): number {
  const row = form.lines * floors.fontPx * floors.lineHeightRatio + 2 * floors.rowPadPx;
  return form.rows * Math.max(row, kind === 'action' ? floors.targetPx : 0);
}

/** One observation per role and shell viewport, in targets-role then shell order. */
export function fitDensity(
  options: DensityFitOptions
): Array<{ cell: DensityCell; observation: Observation<DensityFitReport> }> {
  const { targets, floors } = options;
  const evaluatedAt = options.evaluatedAt ?? new Date();
  const out: Array<{ cell: DensityCell; observation: Observation<DensityFitReport> }> = [];
  for (const role of targets.roles) {
    for (const shell of options.shells) {
      const cell: DensityCell = {
        role: role.role,
        viewport: { width: shell.viewport.width, height: shell.viewport.height },
        fixture: null,
      };
      const prov = Observation.provenance({
        producer: { id: options.producer.id, version: options.producer.version },
        observedAt: shell.observedAt,
        evaluatedAt,
        source: {
          package: options.producer.package,
          schema: DENSITY_TARGETS_SCHEMA,
          basis: 'predicted',
          shellSnapshotId: shell.snapshotId,
        },
      });
      if (floors === null) {
        out.push({
          cell,
          observation: Observation.unknown(
            'no_expectation',
            'fit draws each ask at the floors, and none were given',
            prov
          ),
        });
        continue;
      }
      // With the targets: their classify rules say what on the shell is chrome.
      const shellReport = measureDensity(shell, {
        producer: options.producer,
        targets,
        evaluatedAt,
      });
      if (shellReport.status !== 'measured') {
        out.push({
          cell,
          observation: Observation.unknown(
            'input_missing',
            'the shell capture cannot be measured, so its chrome is unknown',
            prov
          ),
        });
        continue;
      }
      const top = shellReport.value.ledger.contentTopPx;
      if (top === null) {
        out.push({
          cell,
          observation: Observation.unknown(
            'input_missing',
            'the shell capture has no content leaf, so where its chrome ends is unknown',
            prov
          ),
        });
        continue;
      }
      const pinBottomPx = densityPins(shell).pinBottomPx;
      const foldPx = shell.viewport.height - pinBottomPx;
      const ranked = role.asks
        .map((a, i) => ({ a, i }))
        .sort((x, y) => x.a.rank - y.a.rank || x.i - y.i)
        .map((x) => x.a);
      const asks: DensityFitAsk[] = [];
      let y: number | null = top;
      let crossing: DensityFitCrossing | null = null;
      for (const a of ranked) {
        if (a.answer === null) continue;
        const heightPx = a.form === null ? null : densityFitHeight(a.form, a.kind, floors);
        const topPx: number | null = y;
        const bottomPx: number | null =
          topPx === null || heightPx === null ? null : topPx + heightPx;
        const fits = bottomPx === null ? null : bottomPx <= foldPx;
        asks.push({
          id: a.id,
          rank: a.rank,
          kind: a.kind,
          weight: a.weight,
          heightPx,
          topPx,
          bottomPx,
          fits,
        });
        if (crossing === null) {
          if (fits === false) crossing = { crossed: true, rank: a.rank, ask: a.id };
          else if (fits === null) {
            crossing = {
              unknown: 'input_missing',
              reason: `ask ${a.id} declares no form, so the stack below it is unknown`,
            };
          }
        }
        y = bottomPx;
      }
      out.push({
        cell,
        observation: Observation.measured(
          {
            basis: 'predicted',
            cell,
            chromeTopPx: top,
            pinBottomPx,
            foldPx,
            floors,
            asks,
            foldCrossedAt: crossing ?? { crossed: false },
            unanswered: role.asks.filter((a) => a.answer === null).map((a) => a.id),
          },
          prov
        ),
      });
    }
  }
  return out;
}
