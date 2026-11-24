#!/usr/bin/env node
/**
 * `ui-bridge-density` — measure how much effort it takes a role to reach what
 * it came for, from a UI Bridge control snapshot.
 *
 *   ui-bridge-density measure --snapshot <file|-> --role <role>
 *                             [--fixture <name>] [--targets <file>] [--capture-out <file>]
 *
 * `--snapshot` reads a `GET /control/snapshot` answer from any relay or runner,
 * in the relay's `{ success, data, _meta }` envelope or bare (the form the
 * wrapper's `--capture-matrix` writes as `snapshot-<n>.json`); `-` reads
 * standard input. Standard output is ONE JSON document: the cells in order,
 * each with its `Observation` from producer `sdk/density`, and `next[]`.
 *
 * In this release `measure` answers the capture summary — the cell, the
 * viewport, the bases and the coverage — the structure summary: leaves,
 * kinds by the rule that decided them (`kindBy`), blocks, pins, and how many
 * items took each `structureBy` — the repeats with their row quantities, and
 * each affordance with the rule that detected it. `--capture-out` writes the text-free
 * `ui-bridge/density-capture@1`, which is how a cell is kept for a later
 * `diff` without keeping the snapshot (which carries the page's text).
 *
 * Exit: 0 an answer (an `unknown` observation IS an answer), 1 an internal
 * error (a bug, with its stack on stderr), 2 a usage error,
 * 129 / 130 / 143 interrupted by SIGHUP / SIGINT / SIGTERM before any answer
 * was printed, after printing a typed `interrupted` document naming the step
 * it reached. A signal that arrives after the answer is on stdout exits 0 with
 * nothing more. The steps after reading the snapshot are synchronous, so a
 * signal is delivered while the run waits for input (`--snapshot -`) or once
 * it has answered. A closed stdout (EPIPE, e.g. `| head`) ends the run quietly.
 * One window no handler can cover: a signal that lands while Node is already
 * tearing the finished process down takes the OS default action (killed by
 * the signal), after the whole answer was written.
 *
 * The density core is the generated copy under `./density/` (scripts/sync-density.mjs),
 * never `@qontinui/ui-bridge`: the SDK depends on this package, not the reverse.
 *
 * Plan: 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change, Phases 2 to 4.
 */

import { fstatSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { consumeValue, type ArgErrorFactory } from '@qontinui/ui-bridge-cli-args';
import { isEntryModule } from './entry-guard.js';
import {
  DENSITY_PRODUCER_ID,
  captureDensityFromSnapshot,
  densityAffordances,
  densityAsksHash,
  densityRepeats,
  parseDensityTargets,
  summarizeDensityAffordances,
  summarizeDensityRepeats,
  summarizeDensityStructure,
  type DensityAffordancesReport,
  type DensityCapture,
  type DensityCaptureBases,
  type DensityCaptureViewport,
  type DensityCell,
  type DensityCoverage,
  type DensityProbeResult,
  type DensityProducer,
  type DensityRepeatsReport,
  type DensityStructureSummary,
  type DensityTargets,
} from './density/index.js';
import { Observation } from './observation/observation.js';

/** Replaced at build time with this package's version (tsup `define`, mirrored in vitest.config.ts). */
declare const __HEADLESS_VERSION__: string;

export const DENSITY_CLI_PACKAGE = '@qontinui/ui-bridge-headless';

/** Who ran the core (plan D-E): `sdk/density`, at this package's version. */
export function densityCliProducer(): DensityProducer {
  return { id: DENSITY_PRODUCER_ID, version: __HEADLESS_VERSION__, package: DENSITY_CLI_PACKAGE };
}

/** Raised on bad CLI input; `main()` maps it to stderr and exit 2. */
export class DensityCliArgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DensityCliArgError';
  }
}

const USAGE = `ui-bridge-density — reach per role, from a UI Bridge control snapshot

Usage:
  ui-bridge-density measure --snapshot <file|-> --role <role> [options]
  ui-bridge-density --help | --version

measure:
  --snapshot <file|->      A GET /control/snapshot answer (relay envelope or bare);
                           '-' reads standard input
  --role <role>            The audience role this snapshot is read as
  --fixture <name>         The data state the page was loaded with
  --targets <file>         A ui-bridge/density-targets@1 file: checks the role's
                           probe and evaluates its text matchers
  --capture-out <file>     Write the text-free ui-bridge/density-capture@1

Output: one JSON document on standard output — the cells, each with its
Observation (producer sdk/density), and next[].
Exit: 0 an answer (unknown included), 1 internal error, 2 usage error,
129/130/143 interrupted.
`;

/** The closed vocabulary of follow-up steps a report may name (plan "Budget half"). */
export type DensityNextStep =
  | 'write-targets'
  | 'review-targets'
  | 'set-limit'
  | 'capture'
  | 'apply'
  | 're-measure';

export interface DensityMeasureArgs {
  verb: 'measure';
  snapshot: string;
  role: string;
  fixture: string | null;
  targets: string | null;
  captureOut: string | null;
}

export type DensityCliArgs = DensityMeasureArgs | { verb: 'help' } | { verb: 'version' };

const VERBS_LATER = ['init', 'lint', 'fit', 'plan', 'assert', 'diff'];

export function parseDensityArgs(argv: string[]): DensityCliArgs {
  const mkError: ArgErrorFactory = (m) => new DensityCliArgError(m);
  if (argv.length === 0) throw mkError(`a verb is required\n\n${USAGE}`);
  // `--help` is honoured as the first token or as a flag of a verb, never when
  // it sits in a value position (`--role -h` reads `-h` as the role's value).
  if (argv[0] === '--help' || argv[0] === '-h') return { verb: 'help' };
  if (argv[0] === '--version') return { verb: 'version' };
  const [verb, ...rest] = argv;
  if (verb !== 'measure') {
    if (verb !== undefined && VERBS_LATER.includes(verb)) {
      throw mkError(`the verb '${verb}' is not in this release; this build has: measure`);
    }
    if (verb !== undefined && verb.startsWith('--'))
      throw mkError(`Unknown flag: ${verb}\n\n${USAGE}`);
    throw mkError(`Unknown verb: ${verb ?? ''}\n\n${USAGE}`);
  }
  let snapshot: string | null = null;
  let role: string | null = null;
  let fixture: string | null = null;
  let targets: string | null = null;
  let captureOut: string | null = null;
  const seen = new Set<string>();
  const value = (flag: string, raw: string | undefined): string => {
    // A flag given twice is refused: keeping the last `--role` silently would
    // measure the cell for an audience the caller did not mean.
    if (seen.has(flag)) throw mkError(`${flag} is given more than once`);
    seen.add(flag);
    const v = consumeValue(flag, raw, mkError);
    if (v === null || v.trim() === '') throw mkError(`${flag} expects a value`);
    return v;
  };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    switch (arg) {
      case '--help':
      case '-h':
        return { verb: 'help' };
      case '--snapshot':
        snapshot = value('--snapshot', rest[++i]);
        break;
      case '--role':
        role = value('--role', rest[++i]);
        break;
      case '--fixture':
        fixture = value('--fixture', rest[++i]);
        break;
      case '--targets':
        targets = value('--targets', rest[++i]);
        break;
      case '--capture-out':
        captureOut = value('--capture-out', rest[++i]);
        // Standard output already carries the report; `-` here would name a file.
        if (captureOut === '-') throw mkError('--capture-out takes a file path, not -');
        break;
      default:
        if (arg !== undefined && arg.startsWith('-') && arg !== '-') {
          throw mkError(`Unknown flag: ${arg}\n\n${USAGE}`);
        }
        throw mkError(`Unexpected argument: ${arg ?? ''}\n\n${USAGE}`);
    }
  }
  if (snapshot === null) throw mkError(`measure: --snapshot is required\n\n${USAGE}`);
  if (role === null) throw mkError(`measure: --role is required\n\n${USAGE}`);
  return { verb: 'measure', snapshot, role, fixture, targets, captureOut };
}

/** What `measure` reports for a cell in this release. Holds no page text. */
export interface DensityCaptureSummary {
  scope: DensityCapture['scope'];
  cell: DensityCell;
  viewport: DensityCaptureViewport;
  bases: DensityCaptureBases;
  coverage: DensityCoverage;
  probe: DensityProbeResult | null;
  items: number;
  structureResolved: boolean;
  /** Leaves, kinds by `kindBy`, blocks, pins and the `structureBy` counts. */
  structure: DensityStructureSummary;
  /** Lists, tables and card stacks, with their row quantities (line bands estimated). */
  repeats: DensityRepeatsReport;
  /** Disclosures, tabs, menus, search, filters, pagers, truncation and abbreviation, each with its rule. */
  affordances: DensityAffordancesReport;
  snapshotId: string | null;
  observedAt: string | null;
  targetsHash: string | null;
}

export interface DensityReportCell {
  /** `null` viewport while the observation is unknown: the snapshot gave none to trust. */
  cell: {
    role: string | null;
    viewport: { width: number; height: number } | null;
    fixture: string | null;
  };
  observation: Observation<DensityCaptureSummary>;
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

/** The pure half of `measure`: a parsed snapshot in, the report and the capture out. */
export function measureDensityCell(
  input: DensityMeasureInput,
  producer: DensityProducer = densityCliProducer()
): { report: DensityReport; capture: DensityCapture | null } {
  const obs = captureDensityFromSnapshot(input.snapshot, {
    producer,
    role: input.role,
    fixture: input.fixture,
    targets: input.targets,
  });
  let observation: Observation<DensityCaptureSummary>;
  let capture: DensityCapture | null = null;
  let cell: DensityReportCell['cell'] = {
    role: input.role,
    viewport: null,
    fixture: input.fixture,
  };
  if (obs.status === 'measured') {
    capture = obs.value;
    cell = capture.cell;
    // Computed once: the affordances' filters and pagers act on these repeats.
    // Not computed for a capture the summaries will report as unresolved.
    const keyed = capture.structureResolved && capture.repeatKeysResolved;
    const repeats = keyed ? densityRepeats(capture, input.targets) : [];
    const affordances = keyed ? densityAffordances(capture, input.targets, { repeats }) : [];
    observation = Observation.measured<DensityCaptureSummary>(
      {
        scope: capture.scope,
        cell: capture.cell,
        viewport: capture.viewport,
        bases: capture.bases,
        coverage: capture.coverage,
        probe: capture.probe,
        items: capture.items.length,
        structureResolved: capture.structureResolved,
        structure: summarizeDensityStructure(capture, input.targets),
        repeats: summarizeDensityRepeats(capture, input.targets, repeats),
        affordances: summarizeDensityAffordances(capture, input.targets, affordances),
        snapshotId: capture.snapshotId,
        observedAt: capture.observedAt,
        targetsHash: capture.targetsHash,
      },
      obs.provenance
    );
  } else {
    // An unknown or absent observation carries no value to summarise, so it
    // passes through unchanged: neither variant has a `value` to retype.
    observation = obs;
  }

  const next: DensityNextStep[] = [];
  if (input.targets === null) next.push('write-targets');
  else if (
    input.targets.review === null ||
    input.targets.review.asksHash !== densityAsksHash(input.targets)
  ) {
    next.push('review-targets');
  }
  // Anything short of a measured cell needs a capture to measure.
  if (observation.status !== 'measured') next.push('capture');

  return {
    report: { command: 'measure', producer, cells: [{ cell, observation }], next },
    capture,
  };
}

/** The I/O `runDensityCli` performs, injectable for tests. */
export interface DensityCliIo {
  readFile(path: string): string;
  readStdin(): Promise<string>;
  writeFile(path: string, text: string): void;
  /** Whether two paths name one file (a case variant, a symlink, a hard link). Defaults to resolved-path equality. */
  sameFile?(a: string, b: string): boolean;
  stdout(text: string): void;
  stderr(text: string): void;
}

/** The step a run has reached, named in an interrupted verdict. */
export type DensityCliStep =
  | 'parse-args'
  | 'read-snapshot'
  | 'read-targets'
  | 'capture'
  | 'write-capture'
  | 'print';

/** A UTF-8 byte-order mark, which some Windows tools write, is not JSON. */
function withoutBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function parseJson(what: string, text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    throw new DensityCliArgError(
      `${what} is not JSON: ${err instanceof Error ? err.message : String(err)}`
    );
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
    if (args.verb === 'help') {
      io.stdout(USAGE);
      return 0;
    }
    if (args.verb === 'version') {
      io.stdout(`ui-bridge-density ${__HEADLESS_VERSION__}\n`);
      return 0;
    }

    onStep('read-snapshot');
    let snapshotText: string;
    try {
      snapshotText = args.snapshot === '-' ? await io.readStdin() : io.readFile(args.snapshot);
    } catch (err) {
      throw new DensityCliArgError(
        `--snapshot ${args.snapshot}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    const snapshot = parseJson(`--snapshot ${args.snapshot}`, withoutBom(snapshotText));

    let targets: DensityTargets | null = null;
    if (args.targets !== null) {
      onStep('read-targets');
      let text: string;
      try {
        text = io.readFile(args.targets);
      } catch (err) {
        throw new DensityCliArgError(
          `--targets ${args.targets}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      const parsed = parseDensityTargets(parseJson(`--targets ${args.targets}`, withoutBom(text)));
      if (!parsed.ok) {
        const lines = parsed.problems.map((p) => `  ${p.path}: ${p.message}`).join('\n');
        throw new DensityCliArgError(
          `--targets ${args.targets} is not a valid targets file:\n${lines}`
        );
      }
      targets = parsed.value;
      if (!targets.roles.some((r) => r.role === args.role)) {
        const declared = targets.roles.map((r) => r.role).join(', ');
        throw new DensityCliArgError(
          `--role ${args.role} is not declared in ${args.targets} (declared: ${declared})`
        );
      }
    }

    onStep('capture');
    const { report, capture } = measureDensityCell({
      snapshot,
      role: args.role,
      fixture: args.fixture,
      targets,
    });

    if (args.captureOut !== null) {
      onStep('write-capture');
      // Writing the capture over an input would destroy what was measured.
      const same = io.sameFile ?? ((a: string, b: string) => resolvePath(a) === resolvePath(b));
      for (const [flag, input] of [
        ['--snapshot', args.snapshot],
        ['--targets', args.targets],
      ] as const) {
        // `-` (standard input) is compared only by a host that can stat it.
        if (input !== null && (input !== '-' || io.sameFile) && same(input, args.captureOut)) {
          throw new DensityCliArgError(
            `--capture-out ${args.captureOut} is the ${flag} file; refusing to overwrite an input`
          );
        }
      }
      if (capture === null) {
        report.captureOut = {
          path: args.captureOut,
          written: false,
          reason: 'the cell answered unknown, so there is no capture to write',
        };
      } else {
        try {
          io.writeFile(args.captureOut, `${JSON.stringify(capture, null, 2)}\n`);
        } catch (err) {
          // A missing directory or a denied write is the caller's environment,
          // not a bug: a usage error, with nothing printed on stdout.
          throw new DensityCliArgError(
            `--capture-out ${args.captureOut}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
        report.captureOut = { path: args.captureOut, written: true, reason: null };
      }
    }

    onStep('print');
    io.stdout(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
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

/**
 * Whether two paths name one file on disk: the same device and inode when the
 * second exists (catching a case variant on a case-insensitive filesystem, a
 * symlink and a hard link). A path that does not exist yet names no input.
 */
export function sameFileOnDisk(a: string, b: string): boolean {
  if (a !== '-' && resolvePath(a) === resolvePath(b)) return true;
  try {
    // As bigints: an NTFS file id exceeds 2^53, where a double would round two
    // neighbouring files to one inode. `-` is standard input, which may be a
    // file redirected in (`< snap.json`).
    const sa = a === '-' ? fstatSync(0, { bigint: true }) : statSync(a, { bigint: true });
    const sb = statSync(b, { bigint: true });
    return sa.dev === sb.dev && sa.ino === sb.ino && sa.ino !== 0n;
  } catch {
    // The output does not exist yet, so it cannot be the input.
    return false;
  }
}

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
  const command = argv[0] === 'measure' ? 'measure' : null;
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
      // signal after an answer takes: the run is complete and ends with its
      // own code once what it printed is flushed.
      if (finished || printed) {
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
