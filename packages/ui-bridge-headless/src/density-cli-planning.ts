/**
 * The planning verbs of `ui-bridge-density`: `plan`, `fit` and `diff`.
 *
 *   ui-bridge-density plan --capture <file> [--capture <file>]... [--targets <file>]
 *                          [--budget <file>]
 *                          [--ordered-by <quantity>:<ascending|descending>] [--ordered-by-cell <n>]
 *   ui-bridge-density fit  --targets <file> --shell <capture> [--shell <capture>]... [--budget <file>]
 *   ui-bridge-density diff --before <capture> --after <capture> [--targets <file>] [--budget <file>]
 *                          [--plan <plan output> --applied <proposal id>...]
 *
 * `--budget` is a `ui-bridge/density-budget@1` file: its `floors` are what a
 * compaction (and `fit`) is planned against, and its `volume` the rows a list
 * is judged at. Without floors — no budget, a budget with none, or one that
 * waives them — a compaction's prediction is `unknown{no_expectation}`, and so
 * is `fit`.
 *
 * Each prints ONE JSON document. `plan`: every proposal with its evidence, its
 * edits, its per-cell predicted deltas (each a registered quantity of
 * `DENSITY_QUANTITIES`) with the predicted page's legibility bounds, its costs
 * and its conflicts — unranked unless `--ordered-by` names a quantity. `fit`:
 * per role and shell viewport, the rank at which the fold is crossed, labelled
 * predicted. `diff`: the per-quantity deltas between two captures of one
 * cell, and for each `--applied` proposal of a saved `plan` output, its
 * `predictionError`.
 *
 * Plan: 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change (Phase 7).
 */

import {
  densityCliProducer,
  densityFlag,
  mkDensityArgError,
  parseDensityJson,
  readDensityBudgetFile,
  readDensityFile,
  readDensityFlags,
  readDensityTargetsFile,
  withoutBom,
  type DensityCliIo,
  type DensityCliStep,
} from './density-cli-common.js';
import {
  DensityPlanError,
  densityAsksHash,
  densityBudgetProblems,
  densityCaptureHash,
  diffDensity,
  fitDensity,
  parseDensityCapture,
  planDensity,
  type DensityAppliedProposal,
  type DensityBudget,
  type DensityCapture,
  type DensityCell,
  type DensityDelta,
  type DensityDeltaValue,
  type DensityFloors,
  type DensityNextStep,
  type DensityOrderedBy,
  type DensityPlanReport,
  type DensityTargets,
} from './density/index.js';

export const DENSITY_PLANNING_VERBS = ['plan', 'fit', 'diff'] as const;
export type DensityPlanningVerb = (typeof DENSITY_PLANNING_VERBS)[number];

export function isDensityPlanningVerb(verb: string | undefined): verb is DensityPlanningVerb {
  return (DENSITY_PLANNING_VERBS as readonly string[]).includes(verb ?? '');
}

export const DENSITY_PLANNING_USAGE = `  ui-bridge-density plan --capture <file> [--capture <file>]... [--targets <file>]
                         [--budget <file>]
                         [--ordered-by <quantity>:<ascending|descending>] [--ordered-by-cell <n>]
  ui-bridge-density fit  --targets <file> --shell <capture> [--shell <capture>]... [--budget <file>]
  ui-bridge-density diff --before <capture> --after <capture> [--targets <file>]
                         [--budget <file>] [--plan <file> --applied <id>]...
`;

export const DENSITY_PLANNING_HELP = `plan:   proposals, each with its evidence, its edits, per-cell predicted
        deltas with bounds, its costs and conflicts. A prediction is measure
        of the capture with the proposal's edits applied (column-shift@1).
        Unranked unless --ordered-by names a quantity of the predicted deltas.
fit:    per role and shell viewport, the asks stacked in rank order at their
        form and the budget's floors under the shell's chrome, and the rank at
        which the fold is crossed (labelled predicted).
diff:   per-quantity deltas between two captures of one cell; with --plan
        (a saved plan output) and --applied, each proposal's predictionError.
--budget <file>  Its floors and volume. Without floors a compaction's
                 prediction, and fit, answer unknown{no_expectation}.
`;

export interface DensityPlanArgs {
  verb: 'plan';
  captures: string[];
  targets: string | null;
  budget: string | null;
  orderedBy: DensityOrderedBy | null;
}

export interface DensityFitArgs {
  verb: 'fit';
  targets: string;
  shells: string[];
  budget: string | null;
}

export interface DensityDiffArgs {
  verb: 'diff';
  before: string;
  after: string;
  targets: string | null;
  budget: string | null;
  plan: string | null;
  applied: string[];
}

export type DensityPlanningArgs = DensityPlanArgs | DensityFitArgs | DensityDiffArgs;

const FLAGS = {
  plan: {
    '--capture': 'repeat',
    '--targets': 'once',
    '--budget': 'once',
    '--ordered-by': 'once',
    '--ordered-by-cell': 'once',
  },
  fit: { '--shell': 'repeat', '--targets': 'once', '--budget': 'once' },
  diff: {
    '--before': 'once',
    '--after': 'once',
    '--targets': 'once',
    '--budget': 'once',
    '--plan': 'once',
    '--applied': 'repeat',
  },
} as const;

/** Flags whose value is not a file. */
const VALUE_FLAGS = new Set(['--ordered-by', '--ordered-by-cell', '--applied']);

/** Parse a planning verb's flags. `{ verb: 'help' }` for `--help` among them. */
export function parseDensityPlanningArgs(
  verb: DensityPlanningVerb,
  rest: readonly string[],
  usage: string
): DensityPlanningArgs | { verb: 'help' } {
  const values = readDensityFlags(rest, FLAGS[verb], usage);
  if (values === null) return { verb: 'help' };
  for (const [flag, vs] of values) {
    if (!VALUE_FLAGS.has(flag) && vs.includes('-')) {
      throw mkDensityArgError(`${flag} takes a file path, not -`);
    }
  }
  const opt = (flag: string) => densityFlag(values, flag);
  if (verb === 'plan') {
    const captures = values.get('--capture') ?? [];
    if (captures.length === 0) throw mkDensityArgError(`plan: --capture is required\n\n${usage}`);
    let orderedBy: DensityOrderedBy | null = null;
    const by = opt('--ordered-by');
    const cellRaw = opt('--ordered-by-cell');
    if (by !== null) {
      const at = by.lastIndexOf(':');
      const direction = at < 0 ? '' : by.slice(at + 1);
      const quantity = at < 0 ? '' : by.slice(0, at);
      if (quantity === '' || (direction !== 'ascending' && direction !== 'descending')) {
        throw mkDensityArgError(
          `--ordered-by expects <quantity>:<ascending|descending> (got ${by})`
        );
      }
      let cell = 0;
      if (cellRaw !== null) {
        cell = Number(cellRaw);
        if (!/^\d+$/.test(cellRaw) || cell >= captures.length) {
          throw mkDensityArgError(
            `--ordered-by-cell expects a cell index below ${captures.length} (got ${cellRaw})`
          );
        }
      }
      orderedBy = { quantity, direction, cell };
    } else if (cellRaw !== null) {
      throw mkDensityArgError('--ordered-by-cell is taken only with --ordered-by');
    }
    return { verb, captures, targets: opt('--targets'), budget: opt('--budget'), orderedBy };
  }
  if (verb === 'fit') {
    const targets = opt('--targets');
    const shells = values.get('--shell') ?? [];
    if (targets === null) throw mkDensityArgError(`fit: --targets is required\n\n${usage}`);
    if (shells.length === 0) throw mkDensityArgError(`fit: --shell is required\n\n${usage}`);
    return { verb, targets, shells, budget: opt('--budget') };
  }
  const before = opt('--before');
  const after = opt('--after');
  if (before === null || after === null) {
    throw mkDensityArgError(`diff: --before and --after are required\n\n${usage}`);
  }
  const applied = values.get('--applied') ?? [];
  const plan = opt('--plan');
  if (applied.length > 0 && plan === null) {
    throw mkDensityArgError(
      'diff: --applied names a proposal of a --plan output, and no --plan was given'
    );
  }
  if (plan !== null && applied.length === 0) {
    throw mkDensityArgError(
      'diff: --plan is read only for --applied proposals, and none was named'
    );
  }
  return {
    verb,
    before,
    after,
    targets: opt('--targets'),
    budget: opt('--budget'),
    plan,
    applied,
  };
}

// ============================================================================
// Readers
// ============================================================================

function readJson(io: DensityCliIo, flag: string, path: string): unknown {
  return parseDensityJson(`${flag} ${path}`, withoutBom(readDensityFile(io, flag, path)));
}

function readCaptureFile(io: DensityCliIo, flag: string, path: string): DensityCapture {
  const parsed = parseDensityCapture(readJson(io, flag, path));
  if (!parsed.ok) {
    const lines = parsed.problems.map((p) => `  ${p.path}: ${p.message}`).join('\n');
    throw mkDensityArgError(`${flag} ${path} is not a valid capture file:\n${lines}`);
  }
  return parsed.value;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isBound(v: unknown): boolean {
  return v === null || (typeof v === 'number' && Number.isFinite(v));
}

function isDeltaValue(v: unknown): v is DensityDeltaValue {
  if (v === null) return true;
  if (typeof v === 'number') return Number.isFinite(v);
  return isRecord(v) && isBound(v.lo) && isBound(v.hi);
}

function isDelta(v: unknown): v is DensityDelta {
  return (
    isRecord(v) &&
    typeof v.quantity === 'string' &&
    isDeltaValue(v.before) &&
    isDeltaValue(v.after) &&
    isDeltaValue(v.delta)
  );
}

function isFloors(v: unknown): v is DensityFloors {
  return (
    isRecord(v) &&
    ['fontPx', 'lineHeightRatio', 'targetPx', 'rowPadPx'].every(
      (k) => typeof v[k] === 'number' && Number.isFinite(v[k])
    )
  );
}

function sameCell(a: unknown, b: DensityCell): boolean {
  if (!isRecord(a) || !isRecord(a.viewport)) return false;
  return (
    a.role === b.role &&
    a.fixture === b.fixture &&
    a.viewport.width === b.viewport.width &&
    a.viewport.height === b.viewport.height
  );
}

/** The applied proposals' recorded predictions for `cell`, read out of a saved `plan` output. */
function readApplied(
  io: DensityCliIo,
  path: string,
  ids: readonly string[],
  cell: DensityCell,
  beforeHash: string
): DensityAppliedProposal[] {
  const doc = readJson(io, '--plan', path);
  const list =
    isRecord(doc) &&
    doc.command === 'plan' &&
    isRecord(doc.proposals) &&
    Array.isArray(doc.proposals.list)
      ? (doc.proposals.list as unknown[])
      : null;
  if (list === null) {
    throw mkDensityArgError(`--plan ${path} is not the output of ui-bridge-density plan`);
  }
  const truncated = isRecord(doc) && isRecord(doc.proposals) && doc.proposals.truncated === true;
  return ids.map((id) => {
    const p = list.find((x) => isRecord(x) && x.id === id);
    if (!isRecord(p) || !Array.isArray(p.predicted)) {
      throw mkDensityArgError(
        `--applied ${id} is not a proposal of --plan ${path}${truncated ? ' (its proposal list was truncated)' : ''}`
      );
    }
    // The entry predicted from --before itself, else the first of its cell
    // (which diff then reports as predicted from a different capture).
    const ofCell = (p.predicted as unknown[]).filter((e) => isRecord(e) && sameCell(e.cell, cell));
    const entry =
      ofCell.find(
        (e) =>
          isRecord(e) &&
          isRecord(e.observation) &&
          isRecord(e.observation.value) &&
          e.observation.value.fromCapture === beforeHash
      ) ?? ofCell[0];
    const obs = isRecord(entry) ? entry.observation : null;
    if (!isRecord(obs) || obs.status !== 'measured') return { id, prediction: null };
    const v = obs.value;
    if (
      !isRecord(v) ||
      typeof v.fromCapture !== 'string' ||
      !(v.targetsHash === null || typeof v.targetsHash === 'string') ||
      !(v.floors === null || isFloors(v.floors)) ||
      !(v.volume === null || (typeof v.volume === 'number' && Number.isFinite(v.volume))) ||
      !Array.isArray(v.deltas) ||
      !v.deltas.every(isDelta)
    ) {
      throw mkDensityArgError(`--plan ${path}: the prediction of ${id} is malformed`);
    }
    return {
      id,
      prediction: {
        cell,
        fromCapture: v.fromCapture,
        targetsHash: v.targetsHash as string | null,
        floors: v.floors as DensityFloors | null,
        volume: v.volume as number | null,
        deltas: v.deltas as DensityDelta[],
      },
    };
  });
}

// ============================================================================
// Run
// ============================================================================

function targetsNext(targets: DensityTargets | null): DensityNextStep[] {
  if (targets === null) return ['write-targets'];
  if (targets.review === null || targets.review.asksHash !== densityAsksHash(targets)) {
    return ['review-targets'];
  }
  return [];
}

/** Every capture's role must be declared by the targets it is planned against. */
function checkRoles(
  captures: readonly DensityCapture[],
  files: readonly string[],
  targets: DensityTargets,
  path: string
): void {
  const declared = targets.roles.map((r) => r.role);
  captures.forEach((c, i) => {
    if (c.cell.role === null || !declared.includes(c.cell.role)) {
      throw mkDensityArgError(
        `${files[i]} is a cell of role ${c.cell.role ?? '(none)'}, which ${path} does not declare (declared: ${declared.join(', ')})`
      );
    }
  });
}

/** Run one planning verb: prints its document, returns the exit code (0: an answer, unknown included). */
export async function runDensityPlanningVerb(
  args: DensityPlanningArgs,
  io: DensityCliIo,
  onStep: (step: DensityCliStep) => void
): Promise<number> {
  const producer = densityCliProducer();
  const budgetOf = (path: string | null): DensityBudget | null => {
    if (path === null) return null;
    onStep('read-budget');
    return readDensityBudgetFile(io, path, densityBudgetProblems);
  };
  const print = (doc: Record<string, unknown>): number => {
    onStep('print');
    io.stdout(`${JSON.stringify(doc, null, 2)}\n`);
    return 0;
  };
  if (args.verb === 'plan') {
    onStep('read-captures');
    const captures = args.captures.map((p) => readCaptureFile(io, '--capture', p));
    let targets: DensityTargets | null = null;
    if (args.targets !== null) {
      onStep('read-targets');
      targets = readDensityTargetsFile(io, args.targets);
      checkRoles(
        captures,
        args.captures.map((p) => `--capture ${p}`),
        targets,
        args.targets
      );
    }
    const budget = budgetOf(args.budget);
    onStep('plan');
    let report: DensityPlanReport;
    try {
      report = planDensity(captures, {
        producer,
        targets,
        floors: budget?.floors ?? null,
        volume: budget?.volume ?? null,
        orderedBy: args.orderedBy,
      });
    } catch (err) {
      if (err instanceof DensityPlanError) throw mkDensityArgError(`--ordered-by: ${err.message}`);
      throw err;
    }
    const next = targetsNext(targets);
    if (report.cells.some((c) => c.observation.status !== 'measured')) next.push('capture');
    if (report.proposals.total > 0) next.push('apply', 're-measure');
    return print({ command: 'plan', producer, ...report, next });
  }
  if (args.verb === 'fit') {
    onStep('read-captures');
    const shells = args.shells.map((p) => readCaptureFile(io, '--shell', p));
    onStep('read-targets');
    const targets = readDensityTargetsFile(io, args.targets);
    const budget = budgetOf(args.budget);
    onStep('fit');
    const cells = fitDensity({ producer, targets, floors: budget?.floors ?? null, shells });
    const next = targetsNext(targets);
    if (
      cells.some(
        (c) => c.observation.status === 'unknown' && c.observation.unknown.code === 'input_missing'
      )
    ) {
      next.push('capture');
    }
    return print({ command: 'fit', producer, cells, next });
  }
  onStep('read-captures');
  const before = readCaptureFile(io, '--before', args.before);
  const after = readCaptureFile(io, '--after', args.after);
  let targets: DensityTargets | null = null;
  if (args.targets !== null) {
    onStep('read-targets');
    targets = readDensityTargetsFile(io, args.targets);
    checkRoles(
      [before, after],
      [`--before ${args.before}`, `--after ${args.after}`],
      targets,
      args.targets
    );
  }
  const budget = budgetOf(args.budget);
  let applied: DensityAppliedProposal[] = [];
  if (args.plan !== null) {
    onStep('read-plan');
    applied = readApplied(io, args.plan, args.applied, before.cell, densityCaptureHash(before));
  }
  onStep('diff');
  const observation = diffDensity(before, after, {
    producer,
    targets,
    floors: budget?.floors ?? null,
    volume: budget?.volume ?? null,
    applied,
  });
  const next = targetsNext(targets);
  if (observation.status !== 'measured') next.push('capture');
  return print({ command: 'diff', producer, cells: [{ cell: after.cell, observation }], next });
}
