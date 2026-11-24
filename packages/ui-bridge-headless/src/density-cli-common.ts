/**
 * What every verb of `ui-bridge-density` shares: the usage error, the I/O the
 * run performs (injectable for tests), the steps an interrupted verdict names,
 * the flag reader, and the readers of the documents a verb takes.
 *
 * Plan: 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change, Phases 2 to 6.
 */

import { fstatSync, statSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { consumeValue } from '@qontinui/ui-bridge-cli-args';
import {
  DENSITY_PRODUCER_ID,
  parseDensityBudget,
  parseDensityCapture,
  parseDensityTargets,
  type DensityBudget,
  type DensityCapture,
  type DensityParseResult,
  type DensityProblem,
  type DensityProducer,
  type DensityTargets,
} from './density/index.js';

/** Replaced at build time with this package's version (tsup `define`, mirrored in vitest.config.ts). */
declare const __HEADLESS_VERSION__: string;

export const DENSITY_CLI_PACKAGE = '@qontinui/ui-bridge-headless';

/** This package's version, as the build stamped it. */
export function densityCliVersion(): string {
  return __HEADLESS_VERSION__;
}

/** Who ran the core (plan D-E): `sdk/density`, at this package's version. */
export function densityCliProducer(): DensityProducer {
  return { id: DENSITY_PRODUCER_ID, version: __HEADLESS_VERSION__, package: DENSITY_CLI_PACKAGE };
}

/** Raised on bad CLI input; `runDensityCli` maps it to stderr and exit 2. */
export class DensityCliArgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DensityCliArgError';
  }
}

/** The I/O `runDensityCli` performs, injectable for tests. */
export interface DensityCliIo {
  readFile(path: string): string;
  readStdin(): Promise<string>;
  writeFile(path: string, text: string): void;
  /** Whether a path names an existing file; `init` refuses to overwrite one. Defaults to "no". */
  exists?(path: string): boolean;
  /** Whether two paths name one file (a case variant, a symlink, a hard link). Defaults to resolved-path equality. */
  sameFile?(a: string, b: string): boolean;
  stdout(text: string): void;
  stderr(text: string): void;
}

/** The step a run has reached, named in an interrupted verdict. */
export type DensityCliStep =
  | 'parse-args'
  | 'read-snapshot'
  | 'read-captures'
  | 'read-targets'
  | 'read-budget'
  | 'read-profile'
  | 'capture'
  | 'measure'
  | 'evaluate'
  | 'lint'
  | 'write-capture'
  | 'write-draft'
  | 'write-files'
  | 'read-plan'
  | 'plan'
  | 'fit'
  | 'diff'
  | 'print';

// Typed in this package's own terms: a declaration naming cli-args' types
// would make the published .d.ts import a package this one only bundles.
export const mkDensityArgError = (m: string): DensityCliArgError => new DensityCliArgError(m);

/** How a flag is taken: once, or any number of times. */
export type DensityFlagSpec = Record<string, 'once' | 'repeat'>;

/**
 * Read `--flag value` pairs. A flag given twice that is taken once is refused
 * (keeping the last `--role` silently would measure the cell for an audience
 * the caller did not mean); an empty value is refused; an unknown flag or a
 * stray argument is a usage error. `--help` / `-h` in a flag position returns
 * `null` (the caller prints the usage).
 */
export function readDensityFlags(
  rest: readonly string[],
  spec: DensityFlagSpec,
  usage: string
): Map<string, string[]> | null {
  const values = new Map<string, string[]>();
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--help' || arg === '-h') return null;
    const mode = arg !== undefined ? spec[arg] : undefined;
    if (mode === undefined) {
      if (arg !== undefined && arg.startsWith('-') && arg !== '-') {
        throw mkDensityArgError(`Unknown flag: ${arg}\n\n${usage}`);
      }
      throw mkDensityArgError(`Unexpected argument: ${arg ?? ''}\n\n${usage}`);
    }
    const seen = values.get(arg) ?? [];
    if (mode === 'once' && seen.length > 0)
      throw mkDensityArgError(`${arg} is given more than once`);
    const v = consumeValue(arg, rest[++i], mkDensityArgError);
    if (v === null || v.trim() === '') throw mkDensityArgError(`${arg} expects a value`);
    if (mode === 'repeat' && seen.includes(v)) {
      throw mkDensityArgError(`${arg} ${v} is given more than once`);
    }
    values.set(arg, [...seen, v]);
  }
  return values;
}

/** The one value of a flag taken once, or `null`. */
export function densityFlag(values: Map<string, string[]>, flag: string): string | null {
  return values.get(flag)?.[0] ?? null;
}

/** A UTF-8 byte-order mark, which some Windows tools write, is not JSON. */
export function withoutBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function parseDensityJson(what: string, text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    throw new DensityCliArgError(
      `${what} is not JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/** Read a file, naming the flag on failure (a usage error: the caller's environment, not a bug). */
export function readDensityFile(io: DensityCliIo, flag: string, path: string): string {
  try {
    return io.readFile(path);
  } catch (err) {
    throw new DensityCliArgError(
      `${flag} ${path}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/** Write a file, naming the flag on failure. */
export function writeDensityFile(io: DensityCliIo, flag: string, path: string, text: string): void {
  try {
    io.writeFile(path, text);
  } catch (err) {
    throw new DensityCliArgError(
      `${flag} ${path}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

function problemLines(problems: readonly DensityProblem[]): string {
  return problems.map((p) => `  ${p.path}: ${p.message}`).join('\n');
}

function readDocument<T>(
  io: DensityCliIo,
  flag: string,
  path: string,
  what: string,
  parse: (value: unknown) => DensityParseResult<T>
): T {
  const text = readDensityFile(io, flag, path);
  const parsed = parse(parseDensityJson(`${flag} ${path}`, withoutBom(text)));
  if (!parsed.ok) {
    throw new DensityCliArgError(
      `${flag} ${path} is not a valid ${what}:\n${problemLines(parsed.problems)}`
    );
  }
  return parsed.value;
}

/** Read and parse a targets file; a bad one is a usage error naming every problem. */
export function readDensityTargetsFile(io: DensityCliIo, path: string): DensityTargets {
  return readDocument(io, '--targets', path, 'targets file', parseDensityTargets);
}

/** Read and parse a saved capture; a bad one is a usage error naming every problem. */
export function readDensityCaptureFile(io: DensityCliIo, path: string): DensityCapture {
  return readDocument(io, '--capture', path, 'capture file', parseDensityCapture);
}

/** Read and parse a budget file; the registry check is the caller's. */
export function readDensityBudgetFile(
  io: DensityCliIo,
  path: string,
  check: (b: DensityBudget) => DensityProblem[]
): DensityBudget {
  const budget = readDocument(io, '--budget', path, 'budget file', parseDensityBudget);
  const problems = check(budget);
  if (problems.length > 0) {
    throw new DensityCliArgError(
      `--budget ${path} is not a valid budget file:\n${problemLines(problems)}`
    );
  }
  return budget;
}

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

/** Refuse to write `out` over any of `inputs` (writing over an input destroys what was read). */
export function refuseOverwritingInputs(
  io: DensityCliIo,
  outFlag: string,
  out: string,
  inputs: ReadonlyArray<readonly [string, string | null]>
): void {
  const same = io.sameFile ?? ((a: string, b: string) => resolvePath(a) === resolvePath(b));
  for (const [flag, input] of inputs) {
    // `-` (standard input) is compared only by a host that can stat it.
    if (input !== null && (input !== '-' || io.sameFile) && same(input, out)) {
      throw new DensityCliArgError(
        `${outFlag} ${out} is the ${flag} file; refusing to overwrite an input`
      );
    }
  }
}
