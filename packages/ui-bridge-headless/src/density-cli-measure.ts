/**
 * `ui-bridge-density measure`, and the cell input it shares with `assert`:
 * one snapshot read as a role, or any number of saved captures.
 *
 * Plan: 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change, Phases 2 to 6.
 */

import {
  captureDensityFromSnapshot,
  densityAsksHash,
  measureDensity,
  type DensityCapture,
  type DensityFloors,
  type DensityMeasureReport,
  type DensityNextStep,
  type DensityProducer,
  type DensityTargets,
} from './density/index.js';
import type { Observation } from './observation/observation.js';
import {
  DensityCliArgError,
  densitySameFile,
  densityCliProducer,
  densityFlag,
  mkDensityArgError,
  parseDensityJson,
  readDensityCaptureFile,
  readDensityFile,
  readDensityTargetsFile,
  refuseOverwritingInputs,
  withoutBom,
  writeDensityFile,
  type DensityCliIo,
  type DensityCliStep,
} from './density-cli-common.js';

export type { DensityNextStep };

/** Where a verb's cells come from: one snapshot read as a role, or saved captures. */
export interface DensityCellSource {
  /** `null` exactly when `captures` is not empty. */
  snapshot: string | null;
  /** Saved captures to measure instead of a snapshot. */
  captures: string[];
  /** `null` with `captures` (each carries its role). */
  role: string | null;
  fixture: string | null;
  targets: string | null;
}

export interface DensityMeasureArgs extends DensityCellSource {
  verb: 'measure';
  captureOut: string | null;
}

/** The flags of a cell source. */
export const DENSITY_CELL_FLAGS = {
  '--snapshot': 'once',
  '--role': 'once',
  '--fixture': 'once',
  '--targets': 'once',
  '--capture': 'repeat',
} as const;

/**
 * The cell source from read flags. `extraWithSnapshotOnly` names flags (of the
 * verb) that are taken with a snapshot and not with captures.
 */
export function densityCellSource(
  verb: string,
  values: Map<string, string[]>,
  usage: string,
  snapshotOnly: ReadonlyArray<readonly [string, string | null]> = []
): DensityCellSource {
  const captures = values.get('--capture') ?? [];
  if (captures.includes('-')) throw mkDensityArgError('--capture takes a file path, not -');
  const snapshot = densityFlag(values, '--snapshot');
  const role = densityFlag(values, '--role');
  const fixture = densityFlag(values, '--fixture');
  const targets = densityFlag(values, '--targets');
  if (captures.length > 0) {
    for (const [flag, given] of [
      ['--snapshot', snapshot],
      ['--role', role],
      ['--fixture', fixture],
      ...snapshotOnly,
    ] as const) {
      if (given !== null) {
        throw mkDensityArgError(
          `${verb}: ${flag} is not taken with --capture (a capture carries its own cell)`
        );
      }
    }
    return { snapshot: null, captures, role: null, fixture: null, targets };
  }
  if (snapshot === null) {
    throw mkDensityArgError(`${verb}: --snapshot or --capture is required\n\n${usage}`);
  }
  if (role === null) throw mkDensityArgError(`${verb}: --role is required\n\n${usage}`);
  return { snapshot, captures, role, fixture, targets };
}

export interface DensityReportCell {
  /** `null` viewport while the observation is unknown: the input gave none to trust. */
  cell: {
    role: string | null;
    viewport: { width: number; height: number } | null;
    fixture: string | null;
  };
  /** The cell's full report (`measureDensity`), or the unknown that stood in its way. */
  observation: Observation<DensityMeasureReport>;
}

export interface DensityReport {
  command: 'measure';
  producer: DensityProducer;
  cells: DensityReportCell[];
  next: DensityNextStep[];
  captureOut?: { path: string; written: boolean; reason: string | null };
}

export interface DensityMeasureInput {
  snapshot: unknown;
  role: string;
  fixture: string | null;
  targets: DensityTargets | null;
}

/** What a budget adds to measuring a cell: the floors answers are held to, the row volume. */
export interface DensityCellMeasureOptions {
  floors?: DensityFloors | null;
  volume?: number | null;
}

/** The targets' own steps: `write-targets` without them, `review-targets` when the review is missing or stale. */
export function densityTargetsNext(targets: DensityTargets | null): DensityNextStep[] {
  if (targets === null) return ['write-targets'];
  if (targets.review === null || targets.review.asksHash !== densityAsksHash(targets)) {
    return ['review-targets'];
  }
  return [];
}

/** `next[]` of a report: the targets' own steps, the cells', then `capture` for any cell short of measured. */
export function densityReportNext(
  cells: readonly DensityReportCell[],
  targets: DensityTargets | null
): DensityNextStep[] {
  const next: DensityNextStep[] = [];
  const add = (step: DensityNextStep) => {
    if (!next.includes(step)) next.push(step);
  };
  // Read from the targets too, so that a cell answering unknown still names them.
  densityTargetsNext(targets).forEach(add);
  for (const c of cells) {
    if (c.observation.status === 'measured') c.observation.value.next.forEach(add);
  }
  // Anything short of a measured cell needs a capture to measure.
  if (cells.some((c) => c.observation.status !== 'measured')) add('capture');
  return next;
}

/** The pure half of `measure` over a snapshot: a parsed snapshot in, the report and the capture out. */
export function measureDensityCell(
  input: DensityMeasureInput,
  producer: DensityProducer = densityCliProducer(),
  options: DensityCellMeasureOptions = {}
): { report: DensityReport; capture: DensityCapture | null } {
  const obs = captureDensityFromSnapshot(input.snapshot, {
    producer,
    role: input.role,
    fixture: input.fixture,
    targets: input.targets,
  });
  let observation: Observation<DensityMeasureReport>;
  let capture: DensityCapture | null = null;
  let cell: DensityReportCell['cell'] = {
    role: input.role,
    viewport: null,
    fixture: input.fixture,
  };
  if (obs.status === 'measured') {
    capture = obs.value;
    cell = capture.cell;
    observation = measureDensity(capture, {
      producer,
      targets: input.targets,
      captures: [capture],
      evaluatedAt: obs.provenance.evaluatedAt,
      floors: options.floors ?? null,
      volume: options.volume ?? null,
    });
  } else {
    // An unknown or absent observation carries no value to measure, so it
    // passes through unchanged: neither variant has a `value` to retype.
    observation = obs;
  }
  const cells: DensityReportCell[] = [{ cell, observation }];
  return {
    report: { command: 'measure', producer, cells, next: densityReportNext(cells, input.targets) },
    capture,
  };
}

/** The pure half of `measure` over saved captures: one cell each, invariance read across them. */
export function measureDensityCaptures(
  captures: readonly DensityCapture[],
  targets: DensityTargets | null,
  producer: DensityProducer = densityCliProducer(),
  options: DensityCellMeasureOptions = {}
): DensityReport {
  const cells = captures.map(
    (capture): DensityReportCell => ({
      cell: capture.cell,
      observation: measureDensity(capture, {
        producer,
        targets,
        captures,
        floors: options.floors ?? null,
        volume: options.volume ?? null,
      }),
    })
  );
  return { command: 'measure', producer, cells, next: densityReportNext(cells, targets) };
}

/** The cells of a source, measured; `capture` is the snapshot's capture (for `--capture-out`). */
export async function measureDensitySource(
  source: DensityCellSource,
  io: DensityCliIo,
  onStep: (step: DensityCliStep) => void,
  options: DensityCellMeasureOptions = {}
): Promise<{
  report: DensityReport;
  capture: DensityCapture | null;
  targets: DensityTargets | null;
}> {
  if (source.snapshot === null) {
    onStep('read-captures');
    // Two spellings of one file (`c.json` and `./c.json`, a symlink, a hard
    // link) would measure one cell twice and read invariance across a copy.
    source.captures.forEach((path, i) => {
      const earlier = source.captures.slice(0, i).find((p) => densitySameFile(io, p, path));
      if (earlier !== undefined) {
        throw new DensityCliArgError(
          `--capture ${path} names the same file as --capture ${earlier}`
        );
      }
    });
    const captures = source.captures.map((path) => readDensityCaptureFile(io, path));
    let targets: DensityTargets | null = null;
    if (source.targets !== null) {
      onStep('read-targets');
      targets = readDensityTargetsFile(io, source.targets);
      const declared = targets.roles.map((r) => r.role);
      captures.forEach((c, i) => {
        if (c.cell.role === null || !declared.includes(c.cell.role)) {
          throw new DensityCliArgError(
            `--capture ${source.captures[i]} is a cell of role ${c.cell.role ?? '(none)'}, which ${source.targets} does not declare (declared: ${declared.join(', ')})`
          );
        }
      });
    }
    onStep('measure');
    return {
      report: measureDensityCaptures(captures, targets, densityCliProducer(), options),
      capture: null,
      targets,
    };
  }
  const snapshotArg = source.snapshot;
  const role = source.role as string;

  onStep('read-snapshot');
  let snapshotText: string;
  if (snapshotArg === '-') {
    try {
      snapshotText = await io.readStdin();
    } catch (err) {
      throw new DensityCliArgError(
        `--snapshot -: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  } else {
    snapshotText = readDensityFile(io, '--snapshot', snapshotArg);
  }
  const snapshot = parseDensityJson(`--snapshot ${snapshotArg}`, withoutBom(snapshotText));

  let targets: DensityTargets | null = null;
  if (source.targets !== null) {
    onStep('read-targets');
    targets = readDensityTargetsFile(io, source.targets);
    if (!targets.roles.some((r) => r.role === role)) {
      const declared = targets.roles.map((r) => r.role).join(', ');
      throw new DensityCliArgError(
        `--role ${role} is not declared in ${source.targets} (declared: ${declared})`
      );
    }
  }

  onStep('capture');
  const { report, capture } = measureDensityCell(
    { snapshot, role, fixture: source.fixture, targets },
    densityCliProducer(),
    options
  );
  return { report, capture, targets };
}

/** `measure`: the report on stdout; exit 0 on an answer (an unknown observation is one). */
export async function runDensityMeasure(
  args: DensityMeasureArgs,
  io: DensityCliIo,
  onStep: (step: DensityCliStep) => void
): Promise<number> {
  const { report, capture } = await measureDensitySource(args, io, onStep);
  if (args.captureOut !== null) {
    onStep('write-capture');
    refuseOverwritingInputs(io, '--capture-out', args.captureOut, [
      ['--snapshot', args.snapshot],
      ['--targets', args.targets],
    ]);
    if (capture === null) {
      report.captureOut = {
        path: args.captureOut,
        written: false,
        reason: 'the cell answered unknown, so there is no capture to write',
      };
    } else {
      // A missing directory or a denied write is the caller's environment,
      // not a bug: a usage error, with nothing printed on stdout.
      writeDensityFile(
        io,
        '--capture-out',
        args.captureOut,
        `${JSON.stringify(capture, null, 2)}\n`
      );
      report.captureOut = { path: args.captureOut, written: true, reason: null };
    }
  }
  onStep('print');
  io.stdout(`${JSON.stringify(report, null, 2)}\n`);
  return 0;
}
