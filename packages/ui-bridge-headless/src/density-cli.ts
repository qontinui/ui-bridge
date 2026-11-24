#!/usr/bin/env node
/**
 * `ui-bridge-density` — measure how much effort it takes a role to reach what
 * it came for, from a UI Bridge control snapshot, and hold it to a budget.
 *
 *   ui-bridge-density measure --snapshot <file|-> --role <role>
 *                             [--fixture <name>] [--targets <file>] [--capture-out <file>]
 *   ui-bridge-density measure --capture <file> [--capture <file>]... [--targets <file>]
 *   ui-bridge-density assert  --budget <file> | --draft <file>  (the cell flags of measure)
 *   ui-bridge-density lint    --targets <file> --profile-text <file|-> [--profile <doc>]
 *   ui-bridge-density init    --surface <path> --profile <doc> [--targets-out <file>] [--budget-out <file>]
 *
 * `--snapshot` reads a `GET /control/snapshot` answer from any relay or runner,
 * in the relay's `{ success, data, _meta }` envelope or bare (the form the
 * wrapper's `--capture-matrix` writes as `snapshot-<n>.json`); `-` reads
 * standard input. Standard output is ONE JSON document.
 *
 * `measure` answers the full report of each cell (`measureDensity` in the
 * core): the bases (with `interactionsBasis: static`), the structure, the
 * ledger of the first screen and the page, and — with `--targets` — one entry
 * per ask with its reach, the role quantities (`answeredAt[k]` as intervals,
 * the means, the unanswered asks), the blocks with their claimed weight and
 * displacement, the unclaimed and possibly unclaimed blocks; then the
 * repeats, the affordances and the legibility bounds. `--capture-out` writes
 * the text-free `ui-bridge/density-capture@1`, which is how a cell is kept for
 * a later `diff` without keeping the snapshot (which carries the page's text).
 * `--capture` (repeatable) measures saved captures instead of a snapshot, one
 * cell each, and a block's `invariance` is read across them.
 *
 * `assert` holds the cells to a `ui-bridge/density-budget@1` (or, with
 * `--draft`, writes one with the current values and null limits); `lint`
 * holds a targets file to its audience profile's text; `init` writes an empty
 * targets file and budget file (density-cli-assert.ts, density-cli-lint.ts).
 *
 * Exit: 0 an answer (`measure`: an `unknown` observation IS an answer;
 * `assert` / `lint`: clean), 1 any failing rule or missing quote (`assert`,
 * `lint`) — or an internal error (a bug, with its stack on stderr) — 3 when
 * the only non-passes are unknowns (`assert`, `lint`), 2 a usage error,
 * 129 / 130 / 143 interrupted by SIGHUP / SIGINT / SIGTERM before any verdict
 * was printed, after printing a typed `interrupted` document naming the verb
 * and the step it reached. A signal that arrives after the verdict is on
 * stdout prints a note on stderr that the verdict stands, and the run exits
 * with the verdict's own code. The steps after reading the input are
 * synchronous, so a signal is delivered while the run waits for input
 * (`--snapshot -`, `--profile-text -`) or once it has answered. A closed
 * stdout (EPIPE, e.g. `| head`) ends the run quietly. One window no handler
 * can cover: a signal that lands while Node is already tearing the finished
 * process down takes the OS default action (killed by the signal), after the
 * whole answer was written.
 *
 * The density core is the generated copy under `./density/` (scripts/sync-density.mjs),
 * never `@qontinui/ui-bridge`: the SDK depends on this package, not the reverse.
 *
 * Plan: 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change, Phases 2 to 6.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isEntryModule } from './entry-guard.js';
import {
  DensityCliArgError,
  densityCliVersion,
  mkDensityArgError,
  readDensityFlags,
  sameFileOnDisk,
  type DensityCliIo,
  type DensityCliStep,
} from './density-cli-common.js';
import {
  DENSITY_CELL_FLAGS,
  densityCellSource,
  runDensityMeasure,
  type DensityMeasureArgs,
} from './density-cli-measure.js';
import {
  parseDensityAssertArgs,
  runDensityAssert,
  type DensityAssertArgs,
} from './density-cli-assert.js';
import {
  parseDensityInitArgs,
  parseDensityLintArgs,
  runDensityInit,
  runDensityLint,
  type DensityInitArgs,
  type DensityLintArgs,
} from './density-cli-lint.js';

export {
  DENSITY_CLI_PACKAGE,
  DensityCliArgError,
  densityCliProducer,
  sameFileOnDisk,
  type DensityCliIo,
  type DensityCliStep,
} from './density-cli-common.js';
export {
  measureDensityCaptures,
  measureDensityCell,
  type DensityMeasureArgs,
  type DensityMeasureInput,
  type DensityNextStep,
  type DensityReport,
  type DensityReportCell,
} from './density-cli-measure.js';
export {
  assertDensityBudget,
  type DensityAssertArgs,
  type DensityAssertReport,
} from './density-cli-assert.js';
export type { DensityInitArgs, DensityLintArgs } from './density-cli-lint.js';

const USAGE = `ui-bridge-density — reach per role, from a UI Bridge control snapshot

Usage:
  ui-bridge-density measure --snapshot <file|-> --role <role> [options]
  ui-bridge-density measure --capture <file> [--capture <file>]... [--targets <file>]
  ui-bridge-density assert --budget <file> <cell flags of measure>
  ui-bridge-density assert --draft <file> <cell flags of measure>
  ui-bridge-density lint --targets <file> --profile-text <file|-> [--profile <doc>]
  ui-bridge-density init --surface <path> --profile <doc> [--targets-out <file>] [--budget-out <file>]
  ui-bridge-density --help | --version

measure:
  --snapshot <file|->      A GET /control/snapshot answer (relay envelope or bare);
                           '-' reads standard input
  --role <role>            The audience role this snapshot is read as
  --fixture <name>         The data state the page was loaded with
  --targets <file>         A ui-bridge/density-targets@1 file: checks the role's
                           probe and evaluates its text matchers
  --capture-out <file>     Write the text-free ui-bridge/density-capture@1
  --capture <file>         Measure a saved ui-bridge/density-capture@1 instead of
                           a snapshot (repeatable: one cell each; block
                           invariance is read across them). Not with --snapshot,
                           --role, --fixture or --capture-out: a capture carries
                           its own cell.

assert (the cell flags of measure, without --capture-out):
  --budget <file>          A ui-bridge/density-budget@1 file: each rule answers
                           pass, fail or unknown per matching cell, on intervals.
                           A null limit is unknown, never a pass.
  --draft <file>           Write a budget whose rules hold the current values
                           and null limits, instead of evaluating one

lint:
  --targets <file>         The targets file whose asks' quotes are checked
  --profile-text <file|->  The text of the audience profile the asks cite
  --profile <doc>          The document that text is of (default: the targets'
                           profile); an ask citing another is not checked

init:
  --surface <path>         The surface the files are for
  --profile <doc>          The audience profile the targets will cite
  --targets-out <file>     Default density-targets.json
  --budget-out <file>      Default density-budget.json
                           (never overwrites a file; writes no role, ask or limit)

Output: one JSON document on standard output. measure: the cells, each with its
Observation (producer sdk/density), and next[]; with --targets, each cell
reports per-ask reach, answeredAt[k] as intervals, the unanswered asks and the
unclaimed blocks. Interactions are read from structure and ARIA state; no
control is operated (interactionsBasis: static). assert: each cell's rule
results as an Observation, and the counts pass / fail / unknown.
Exit: 0 an answer (measure; unknown included) or clean (assert, lint);
1 a failing rule or a missing quote (assert, lint), or an internal error;
3 unknowns only (assert, lint); 2 usage error; 129/130/143 interrupted.
`;

export type DensityCliArgs =
  | DensityMeasureArgs
  | DensityAssertArgs
  | DensityLintArgs
  | DensityInitArgs
  | { verb: 'help' }
  | { verb: 'version' };

/** The verbs this build runs. */
export const DENSITY_CLI_VERBS = ['init', 'lint', 'measure', 'assert'] as const;
const VERBS_LATER = ['fit', 'plan', 'diff'];

function parseMeasureArgs(rest: readonly string[]): DensityMeasureArgs | { verb: 'help' } {
  const values = readDensityFlags(rest, { ...DENSITY_CELL_FLAGS, '--capture-out': 'once' }, USAGE);
  if (values === null) return { verb: 'help' };
  const captureOut = values.get('--capture-out')?.[0] ?? null;
  // Standard output already carries the report; `-` here would name a file.
  if (captureOut === '-') throw mkDensityArgError('--capture-out takes a file path, not -');
  return {
    verb: 'measure',
    ...densityCellSource('measure', values, USAGE, [['--capture-out', captureOut]]),
    captureOut,
  };
}

export function parseDensityArgs(argv: string[]): DensityCliArgs {
  if (argv.length === 0) throw mkDensityArgError(`a verb is required\n\n${USAGE}`);
  // `--help` is honoured as the first token or as a flag of a verb, never when
  // it sits in a value position (`--role -h` reads `-h` as the role's value).
  if (argv[0] === '--help' || argv[0] === '-h') return { verb: 'help' };
  if (argv[0] === '--version') return { verb: 'version' };
  const [verb, ...rest] = argv;
  switch (verb) {
    case 'measure':
      return parseMeasureArgs(rest);
    case 'assert':
      return parseDensityAssertArgs(rest, USAGE);
    case 'lint':
      return parseDensityLintArgs(rest, USAGE);
    case 'init':
      return parseDensityInitArgs(rest, USAGE);
    default:
      if (verb !== undefined && VERBS_LATER.includes(verb)) {
        throw mkDensityArgError(
          `the verb '${verb}' is not in this release; this build has: ${DENSITY_CLI_VERBS.join(', ')}`
        );
      }
      if (verb !== undefined && verb.startsWith('--'))
        throw mkDensityArgError(`Unknown flag: ${verb}\n\n${USAGE}`);
      throw mkDensityArgError(`Unknown verb: ${verb ?? ''}\n\n${USAGE}`);
  }
}

/** Runs one invocation; returns the exit code. `onStep` is told each step as it starts. */
export async function runDensityCli(
  argv: string[],
  io: DensityCliIo,
  onStep: (step: DensityCliStep) => void = () => {}
): Promise<number> {
  try {
    onStep('parse-args');
    const args = parseDensityArgs(argv);
    switch (args.verb) {
      case 'help':
        io.stdout(USAGE);
        return 0;
      case 'version':
        io.stdout(`ui-bridge-density ${densityCliVersion()}\n`);
        return 0;
      case 'measure':
        return await runDensityMeasure(args, io, onStep);
      case 'assert':
        return await runDensityAssert(args, io, onStep);
      case 'lint':
        return await runDensityLint(args, io, onStep);
      case 'init':
        return await runDensityInit(args, io, onStep);
    }
  } catch (err) {
    if (err instanceof DensityCliArgError) {
      io.stderr(`ui-bridge-density: ${err.message}\n`);
      return 2;
    }
    throw err;
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (c: Buffer | string) =>
      chunks.push(typeof c === 'string' ? Buffer.from(c) : c)
    );
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
  });
}

const SIGNAL_EXIT: Record<'SIGHUP' | 'SIGINT' | 'SIGTERM', number> = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGTERM: 143,
};

/** Set once main() has failed with a bug and is writing its stack before exit 1. */
let internalErrorExit = false;

async function main(): Promise<void> {
  let step: DensityCliStep = 'parse-args';
  // Set once anything is on stdout (the report, the usage, the version): an
  // interruption after that point must not append a second document.
  let printed = false;
  // The first signal decides the verdict; a second one while that verdict is
  // still flushing prints nothing more and exits at once (a flush to a reader
  // that stopped reading may never complete).
  let interrupting = false;
  const argv = process.argv.slice(2);
  // The verb named on the command line, when it is one; `null` before any.
  const command = (DENSITY_CLI_VERBS as readonly string[]).includes(argv[0] ?? '') ? argv[0] : null;
  // The code a signal ends the run with, once one has arrived.
  let signalCode: number | null = null;
  // Writes to stdout or stderr still in flight; what the run printed is out
  // only when this is 0.
  let pending = 0;
  const exitWhenFlushed = (exitCode: number): void => {
    // A queued write is not yet a delivered one: where the streams' writes may
    // be asynchronous (Node's process-I/O note), exiting now could drop a tail.
    if (pending === 0) process.exit(exitCode);
    let left = 2;
    const done = (): void => {
      left--;
      if (left === 0) process.exit(exitCode);
    };
    process.stdout.write('', done);
    process.stderr.write('', done);
  };
  const tracked = (stream: NodeJS.WriteStream, text: string): void => {
    pending++;
    stream.write(text, () => {
      pending--;
    });
  };
  // Set once runDensityCli has returned: the run's code is decided.
  let finished = false;
  const reachedCode = (): number =>
    signalCode ?? (typeof process.exitCode === 'number' ? process.exitCode : 0);
  for (const stream of [process.stdout, process.stderr]) {
    stream.on('error', (err: NodeJS.ErrnoException) => {
      // The reader went away (`| head`, a closed terminal after SIGHUP):
      // nothing is left to tell it, so the run ends with the code it reached.
      if (err.code === 'EPIPE' || err.code === 'EIO' || signalCode !== null) {
        process.exit(reachedCode());
      }
      if (stream === process.stdout) {
        // Exit once the line is written, as every other exit here does.
        process.stderr.write(`ui-bridge-density: internal error: stdout: ${err.message}\n`, () =>
          process.exit(1)
        );
        return;
      }
      process.exit(1);
    });
  }
  for (const signal of Object.keys(SIGNAL_EXIT) as Array<keyof typeof SIGNAL_EXIT>) {
    process.on(signal, () => {
      const code = SIGNAL_EXIT[signal];
      // A bug is being reported (exit 1 once its stack is written): a signal
      // now is not an interruption of the run.
      if (internalErrorExit) return;
      // A second signal while the first one's flush is pending ends the run at
      // once (a reader that stopped reading may never let it complete): with
      // the run's own code if it had answered, else with the FIRST signal's,
      // which the interrupted document already names.
      if (interrupting) process.exit(finished ? reachedCode() : printed ? 0 : (signalCode ?? code));
      interrupting = true;
      // The run already answered — the report, the usage or the version on
      // stdout, or a usage error on stderr, with its code decided. Signals are
      // delivered only between event-loop turns, so this is the branch any
      // signal after an answer takes: the run is complete, says that the
      // verdict it printed stands, and ends with its own code once what it
      // printed is flushed.
      if (finished || printed) {
        tracked(
          process.stderr,
          `ui-bridge-density: ${signal} after the verdict was printed; the verdict stands\n`
        );
        exitWhenFlushed(finished ? reachedCode() : 0);
        return;
      }
      signalCode = code;
      const doc = `${JSON.stringify({ command, interrupted: { signal, step } }, null, 2)}\n`;
      // Exit only once the document is flushed: on a pipe, a write followed
      // at once by process.exit can drop it.
      process.stdout.write(doc, () => process.exit(code));
    });
  }
  const code = await runDensityCli(
    argv,
    {
      readFile: (p) => readFileSync(p, 'utf8'),
      readStdin,
      writeFile: (p, t) => writeFileSync(p, t),
      exists: (p) => existsSync(p),
      sameFile: sameFileOnDisk,
      stdout: (t) => {
        // Once a signal has printed the interrupted verdict, that verdict is
        // the run's one document: a report finishing in the same turn is dropped.
        if (signalCode !== null) return;
        tracked(process.stdout, t);
        // Any document on stdout (the report, the usage, the version) is the
        // run's answer; an interruption after it prints nothing more.
        printed = true;
      },
      stderr: (t) => tracked(process.stderr, t),
    },
    (s) => {
      step = s;
      // Opt-in progress trace on stderr, so a caller (or a test) can tell which
      // step a run has reached without reading its stdout.
      if (process.env.UI_BRIDGE_DENSITY_TRACE === '1') {
        process.stderr.write(`ui-bridge-density: step ${s}\n`);
      }
    }
  );
  process.exitCode = code;
  finished = true;
}

if (isEntryModule(import.meta.url)) {
  main().catch((err: unknown) => {
    internalErrorExit = true;
    // Exit once the stack is written: an asynchronous stderr could drop it.
    process.stderr.write(
      `ui-bridge-density: internal error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
      () => process.exit(1)
    );
  });
}
