/**
 * `ui-bridge-density assert`: hold the measured cells to a budget.
 *
 *   assert --budget <file> (--snapshot <file|-> --role <role> [--fixture <name>] | --capture <file>...)
 *          [--targets <file>]
 *   assert --draft <file> (same cell flags)
 *
 * Standard output is one JSON document: each cell's budget results as an
 * `Observation` (producer `sdk/density`), the rules no cell matched, the three
 * counts and `next[]`. Exit 0 when every result passes, 1 when any fails, 3
 * when the only non-passes are unknowns (or nothing was judged), 2 on a usage
 * error. `--draft` writes a budget whose rules hold the current values and null
 * limits — the tool never supplies a limit — and exits 0.
 *
 * Plan: 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change (Phase 6).
 */

import {
  densityBudgetDocument,
  densityBudgetExitCode,
  densityBudgetProblems,
  draftDensityBudget,
  evaluateDensityBudget,
  type DensityBudget,
  type DensityBudgetCellReport,
  type DensityBudgetCounts,
  type DensityBudgetInputCell,
  type DensityNextStep,
  type DensityProducer,
  type DensityRuleResult,
} from './density/index.js';
import { Observation } from './observation/observation.js';
import {
  DensityCliArgError,
  densityCliProducer,
  densityFlag,
  mkDensityArgError,
  readDensityBudgetFile,
  readDensityFlags,
  refuseOverwritingInputs,
  writeDensityFile,
  type DensityCliIo,
  type DensityCliStep,
} from './density-cli-common.js';
import {
  DENSITY_CELL_FLAGS,
  densityCellSource,
  densityTargetsNext,
  measureDensitySource,
  type DensityCellSource,
  type DensityReport,
} from './density-cli-measure.js';

export interface DensityAssertArgs extends DensityCellSource {
  verb: 'assert';
  budget: string | null;
  /** Write a draft budget here instead of evaluating one. */
  draft: string | null;
}

export function parseDensityAssertArgs(
  rest: readonly string[],
  usage: string
): DensityAssertArgs | { verb: 'help' } {
  const values = readDensityFlags(
    rest,
    { ...DENSITY_CELL_FLAGS, '--budget': 'once', '--draft': 'once' },
    usage
  );
  if (values === null) return { verb: 'help' };
  const budget = densityFlag(values, '--budget');
  const draft = densityFlag(values, '--draft');
  if (budget !== null && draft !== null) {
    throw mkDensityArgError('assert: --draft writes a budget; it is not taken with --budget');
  }
  if (budget === null && draft === null) {
    throw mkDensityArgError(`assert: --budget or --draft is required\n\n${usage}`);
  }
  if (draft === '-') throw mkDensityArgError('--draft takes a file path, not -');
  if (budget === '-') throw mkDensityArgError('--budget takes a file path, not -');
  return { verb: 'assert', ...densityCellSource('assert', values, usage), budget, draft };
}

/** One cell's budget results, as an `Observation`: unknown when the cell was not measured. */
export interface DensityAssertCell {
  cell: DensityBudgetCellReport['cell'];
  required: boolean;
  observation: Observation<DensityBudgetCellReport>;
}

export interface DensityAssertReport {
  command: 'assert';
  producer: DensityProducer;
  budgetHash: string;
  source: string | null;
  floorsBasis: 'floors' | 'waived' | 'none';
  cells: DensityAssertCell[];
  unmatched: DensityRuleResult[];
  counts: DensityBudgetCounts;
  next: DensityNextStep[];
}

function inputCells(report: DensityReport): DensityBudgetInputCell[] {
  // A cell whose capture answered unknown has no viewport to match a matrix
  // cell by; it is still a cell of this invocation, measured as unknown.
  return report.cells.map((c) => ({
    cell: {
      role: c.cell.role,
      viewport: c.cell.viewport ?? { width: 0, height: 0 },
      fixture: c.cell.fixture,
    },
    observation: c.observation,
  }));
}

/** Evaluate a parsed budget over a measure report (the pure half of `assert`). */
export function assertDensityBudget(
  budget: DensityBudget,
  measured: DensityReport,
  targetsNext: DensityNextStep[],
  producer: DensityProducer = densityCliProducer()
): DensityAssertReport {
  const report = evaluateDensityBudget(budget, inputCells(measured));
  const evaluatedAt = new Date();
  const cells = report.cells.map((c, i): DensityAssertCell => {
    const measuredCell = measured.cells[i];
    const prov = Observation.provenance({
      producer: { id: producer.id, version: producer.version },
      observedAt:
        measuredCell && measuredCell.observation.status === 'measured'
          ? measuredCell.observation.value.observedAt
          : null,
      evaluatedAt,
      source: { package: producer.package, schema: report.schema, budgetHash: report.budgetHash },
    });
    let observation: Observation<DensityBudgetCellReport>;
    if (c.status === 'measured') observation = Observation.measured(c, prov);
    else if (c.status === 'unknown') {
      observation = Observation.unknown(
        c.unknown?.code ?? 'input_missing',
        c.unknown?.detail ?? 'the cell was not measured',
        prov
      );
    } else {
      observation = Observation.unknown(
        'input_missing',
        `the budget requires this cell and no capture of it was given (${c.results.length} rule(s) unknown)`,
        prov
      );
    }
    return { cell: c.cell, required: c.required, observation };
  });
  const next: DensityNextStep[] = [];
  for (const step of [...targetsNext, ...report.next]) if (!next.includes(step)) next.push(step);
  return {
    command: 'assert',
    producer,
    budgetHash: report.budgetHash,
    source: report.source,
    floorsBasis: report.floorsBasis,
    cells,
    unmatched: report.unmatched,
    counts: report.counts,
    next,
  };
}

export async function runDensityAssert(
  args: DensityAssertArgs,
  io: DensityCliIo,
  onStep: (step: DensityCliStep) => void
): Promise<number> {
  let budget: DensityBudget | null = null;
  if (args.budget !== null) {
    onStep('read-budget');
    budget = readDensityBudgetFile(io, args.budget, densityBudgetProblems);
  }
  if (args.draft !== null) {
    refuseOverwritingInputs(io, '--draft', args.draft, [
      ['--snapshot', args.snapshot],
      ['--targets', args.targets],
      ...args.captures.map((c) => ['--capture', c] as const),
    ]);
  }
  const measured = await measureDensitySource(args, io, onStep, {
    floors: budget?.floors ?? null,
    volume: budget?.volume ?? null,
  });
  if (args.draft !== null) {
    onStep('write-draft');
    const draft = draftDensityBudget(inputCells(measured.report));
    writeDensityFile(
      io,
      '--draft',
      args.draft,
      `${JSON.stringify(densityBudgetDocument(draft), null, 2)}\n`
    );
    onStep('print');
    io.stdout(
      `${JSON.stringify(
        {
          command: 'assert',
          draft: { path: args.draft, rules: draft.rules.length, cells: draft.matrix.length },
          next: ['set-limit'],
        },
        null,
        2
      )}\n`
    );
    return 0;
  }
  if (budget === null) throw new DensityCliArgError('assert: --budget or --draft is required');
  onStep('evaluate');
  const report = assertDensityBudget(budget, measured.report, densityTargetsNext(measured.targets));
  onStep('print');
  io.stdout(`${JSON.stringify(report, null, 2)}\n`);
  return densityBudgetExitCode(report.counts);
}
