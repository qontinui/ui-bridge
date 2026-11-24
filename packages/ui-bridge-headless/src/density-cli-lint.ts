/**
 * `ui-bridge-density lint` and `ui-bridge-density init`.
 *
 *   lint --targets <file> --profile-text <file|-> [--profile <doc>]
 *   init --surface <path> --profile <doc> [--targets-out <file>] [--budget-out <file>]
 *
 * `lint` holds a targets file to the text of the audience profile it cites:
 * each ask's quote must be in the text, and the profile sentences no ask
 * quotes are listed. Exit 0 clean, 1 when a quote is missing, 3 when the only
 * unchecked asks cite another document (or there is no ask), 2 usage.
 *
 * `init` writes a valid, empty targets file and budget file for a surface: no
 * role, no ask, no rule, no limit. It supplies no content and no threshold, and
 * refuses to overwrite a file that exists.
 *
 * Plan: 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change (Phase 6).
 */

import {
  densityBudgetDocument,
  densityLintExitCode,
  emptyDensityBudget,
  emptyDensityTargets,
  lintDensityTargets,
  parseDensityBudget,
  parseDensityTargets,
  type DensityLintReport,
} from './density/index.js';
import {
  DensityCliArgError,
  densityFlag,
  mkDensityArgError,
  readDensityFile,
  readDensityFlags,
  readDensityTargetsFile,
  writeDensityFile,
  type DensityCliIo,
  type DensityCliStep,
} from './density-cli-common.js';

export interface DensityLintArgs {
  verb: 'lint';
  targets: string;
  profileText: string;
  profile: string | null;
}

export interface DensityInitArgs {
  verb: 'init';
  surface: string;
  profile: string;
  targetsOut: string;
  budgetOut: string;
}

export function parseDensityLintArgs(
  rest: readonly string[],
  usage: string
): DensityLintArgs | { verb: 'help' } {
  const values = readDensityFlags(
    rest,
    { '--targets': 'once', '--profile-text': 'once', '--profile': 'once' },
    usage
  );
  if (values === null) return { verb: 'help' };
  const targets = densityFlag(values, '--targets');
  const profileText = densityFlag(values, '--profile-text');
  if (targets === null) throw mkDensityArgError(`lint: --targets is required\n\n${usage}`);
  if (targets === '-') throw mkDensityArgError('--targets takes a file path, not -');
  if (profileText === null) throw mkDensityArgError(`lint: --profile-text is required\n\n${usage}`);
  return { verb: 'lint', targets, profileText, profile: densityFlag(values, '--profile') };
}

export function parseDensityInitArgs(
  rest: readonly string[],
  usage: string
): DensityInitArgs | { verb: 'help' } {
  const values = readDensityFlags(
    rest,
    { '--surface': 'once', '--profile': 'once', '--targets-out': 'once', '--budget-out': 'once' },
    usage
  );
  if (values === null) return { verb: 'help' };
  const surface = densityFlag(values, '--surface');
  const profile = densityFlag(values, '--profile');
  if (surface === null) throw mkDensityArgError(`init: --surface is required\n\n${usage}`);
  if (profile === null) throw mkDensityArgError(`init: --profile is required\n\n${usage}`);
  const targetsOut = densityFlag(values, '--targets-out') ?? 'density-targets.json';
  const budgetOut = densityFlag(values, '--budget-out') ?? 'density-budget.json';
  for (const [flag, path] of [
    ['--targets-out', targetsOut],
    ['--budget-out', budgetOut],
  ] as const) {
    if (path === '-') throw mkDensityArgError(`${flag} takes a file path, not -`);
  }
  return { verb: 'init', surface, profile, targetsOut, budgetOut };
}

export interface DensityLintCliReport extends DensityLintReport {
  command: 'lint';
}

export async function runDensityLint(
  args: DensityLintArgs,
  io: DensityCliIo,
  onStep: (step: DensityCliStep) => void
): Promise<number> {
  onStep('read-targets');
  const targets = readDensityTargetsFile(io, args.targets);
  onStep('read-profile');
  let text: string;
  if (args.profileText === '-') {
    try {
      text = await io.readStdin();
    } catch (err) {
      throw new DensityCliArgError(
        `--profile-text -: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  } else {
    text = readDensityFile(io, '--profile-text', args.profileText);
  }
  onStep('lint');
  const report = lintDensityTargets(
    targets,
    text,
    args.profile !== null ? { profileDoc: args.profile } : {}
  );
  onStep('print');
  const out: DensityLintCliReport = { command: 'lint', ...report };
  io.stdout(`${JSON.stringify(out, null, 2)}\n`);
  return densityLintExitCode(report);
}

export async function runDensityInit(
  args: DensityInitArgs,
  io: DensityCliIo,
  onStep: (step: DensityCliStep) => void
): Promise<number> {
  onStep('write-files');
  const same = io.sameFile ?? ((a: string, b: string) => a === b);
  if (same(args.targetsOut, args.budgetOut) || args.targetsOut === args.budgetOut) {
    throw new DensityCliArgError('init: --targets-out and --budget-out name one file');
  }
  for (const [flag, path] of [
    ['--targets-out', args.targetsOut],
    ['--budget-out', args.budgetOut],
  ] as const) {
    if (io.exists?.(path)) {
      throw new DensityCliArgError(`${flag} ${path} exists; init never overwrites a file`);
    }
  }
  const targets = emptyDensityTargets(args.surface, args.profile);
  const budget = densityBudgetDocument(emptyDensityBudget());
  // What init writes must parse: an empty file that does not would be a trap.
  if (!parseDensityTargets(targets).ok || !parseDensityBudget(budget).ok) {
    throw new Error('init built a document its own parser refuses');
  }
  writeDensityFile(io, '--targets-out', args.targetsOut, `${JSON.stringify(targets, null, 2)}\n`);
  writeDensityFile(io, '--budget-out', args.budgetOut, `${JSON.stringify(budget, null, 2)}\n`);
  onStep('print');
  io.stdout(
    `${JSON.stringify(
      {
        command: 'init',
        wrote: [
          { path: args.targetsOut, schema: targets.schema },
          { path: args.budgetOut, schema: budget.schema },
        ],
        next: ['write-targets', 'set-limit'],
      },
      null,
      2
    )}\n`
  );
  return 0;
}
