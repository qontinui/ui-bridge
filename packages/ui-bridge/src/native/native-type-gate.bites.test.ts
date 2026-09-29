/**
 * The native type gate BITES — a permanent proof, not a one-off.
 *
 * Plan `2026-08-23-ui-bridge-native-subtree-has-no-type-gate` Phase 2 required
 * that the gate be shown to fail on a regression ("a gate not proven to bite
 * is not a gate"), and #167 never did it. A single red CI run proves it once;
 * this file proves it on every run, so a later edit that blinds the gate — an
 * `exclude` that swallows a native directory, an emptied `include`, a relaxed
 * `strict` — turns a test red instead of turning the gate silently green.
 *
 * It drives the TypeScript compiler API with the options and file set that
 * `tsc -p tsconfig.native.json` itself resolves (`ts.readConfigFile` +
 * `ts.parseJsonConfigFileContent`), so the assertions are about the real gate
 * and not a hand-copied approximation of it:
 *
 * 1. A fixture containing deliberate errors, compiled inside the gate's own
 *    program, is reported. The fixture is served IN MEMORY at a path inside
 *    `src/native/core/` — nothing is written into the source tree, so the gate
 *    itself never sees it and a concurrent `npm run typecheck` stays green.
 * 2. That fixture path is one the config's include/exclude would admit
 *    (checked against a mirror of the two config files, where a real file can
 *    exist without touching `src/`), and so is every real native source file.
 *
 * Why the gate is a SECOND project rather than folded into `tsconfig.json`
 * (plan `2026-09-20-ui-bridge-observations-…` Phase 4, option (a) evaluated
 * and rejected on measured evidence) is recorded in
 * `native-type-gate.followup.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import ts from 'typescript';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PACKAGE_DIR = process.cwd();
const GATE_CONFIG = 'tsconfig.native.json';
/** The config the gate `extends`; mirrored alongside it for the inclusion check. */
const BASE_CONFIG = 'tsconfig.json';
const FIXTURE_REL = join('src', 'native', 'core', '__native-type-gate-probe__.ts');

/**
 * Three deliberate errors, each pinned to what it proves:
 * - TS2322 against a REAL native type — the fixture resolves the native
 *   subtree's own declarations under the gate's module resolution.
 * - TS7006 (implicit `any`) exists only under `strict`/`noImplicitAny` — so a
 *   gate that silently drops strictness stops reporting it.
 * - TS2322 on a `number | null` assigned to `number` exists only under
 *   `strictNullChecks` — so `"strict": false` with `noImplicitAny` kept, or a
 *   bare `"strictNullChecks": false`, is caught too.
 */
const FIXTURE_SOURCE = [
  "import type { NativeBridgeSnapshot } from './types';",
  '',
  "export const probeCount: NativeBridgeSnapshot['registeredCount'] = 'not a count';",
  '',
  'export function probeImplicitAny(value) {',
  '  return value;',
  '}',
  '',
  'export const probeNull: number = null as number | null;',
  '',
].join('\n');

function parseConfig(configPath: string): ts.ParsedCommandLine {
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error) {
    throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'));
  }
  return ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    resolve(configPath, '..'),
    undefined,
    configPath
  );
}

function normalize(p: string): string {
  return resolve(p).replace(/\\/g, '/');
}

/** Every non-test `.ts`/`.tsx` file under `src/native`, as absolute paths. */
function nativeSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...nativeSourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('the native type gate reports a deliberate error', () => {
  it('compiles an in-memory fixture with tsconfig.native.json and reports all three planted errors', () => {
    const parsed = parseConfig(join(PACKAGE_DIR, GATE_CONFIG));
    expect(parsed.errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual(
      []
    );

    const fixturePath = normalize(join(PACKAGE_DIR, FIXTURE_REL));
    const host = ts.createCompilerHost(parsed.options, true);
    const isFixture = (fileName: string) => normalize(fileName) === fixturePath;

    const fileExists = host.fileExists.bind(host);
    const readFile = host.readFile.bind(host);
    const getSourceFile = host.getSourceFile.bind(host);
    host.fileExists = (fileName) => isFixture(fileName) || fileExists(fileName);
    host.readFile = (fileName) => (isFixture(fileName) ? FIXTURE_SOURCE : readFile(fileName));
    host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) =>
      isFixture(fileName)
        ? ts.createSourceFile(fileName, FIXTURE_SOURCE, languageVersion, true)
        : getSourceFile(fileName, languageVersion, onError, shouldCreate);

    // The gate's own root set plus the fixture: the same program
    // `tsc -p tsconfig.native.json` builds, with one extra file in it.
    const program = ts.createProgram({
      rootNames: [...parsed.fileNames, fixturePath],
      options: parsed.options,
      host,
    });

    const fixtureFile = program.getSourceFile(fixturePath);
    expect(fixtureFile, 'fixture was not part of the program').toBeDefined();

    const diagnostics = [
      ...program.getSyntacticDiagnostics(fixtureFile),
      ...program.getSemanticDiagnostics(fixtureFile),
    ];
    const reported = diagnostics.map((d) => ({
      code: d.code,
      line: d.file ? d.file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1 : -1,
    }));

    // Exactly the three planted errors, at their lines — no more (an extra one
    // would mean the fixture's own import stopped resolving), no fewer.
    expect(reported).toEqual([
      { code: 2322, line: 3 },
      { code: 7006, line: 5 },
      { code: 2322, line: 9 },
    ]);
  });
});

describe('the native type gate can see the files it is meant to gate', () => {
  // Created in beforeAll, not at collection time: vitest skips afterAll when
  // every test in the block is filtered out, which would leak the directory.
  let mirrorDir = '';

  beforeAll(() => {
    mirrorDir = mkdtempSync(join(tmpdir(), 'native-type-gate-'));
  });

  afterAll(() => {
    if (mirrorDir) rmSync(mirrorDir, { recursive: true, force: true });
  });

  it("admits the fixture's path under the config's include/exclude", () => {
    // Mirror both config files (the gate `extends` the base) into a scratch
    // dir and create the fixture there for real: `parseJsonConfigFileContent`
    // matches include/exclude against an actual directory walk, and this lets
    // the fixture exist without writing into the package's `src/`.
    copyFileSync(join(PACKAGE_DIR, GATE_CONFIG), join(mirrorDir, GATE_CONFIG));
    copyFileSync(join(PACKAGE_DIR, BASE_CONFIG), join(mirrorDir, BASE_CONFIG));
    const mirrorFixture = join(mirrorDir, FIXTURE_REL);
    mkdirSync(resolve(mirrorFixture, '..'), { recursive: true });
    writeFileSync(mirrorFixture, FIXTURE_SOURCE);

    const parsed = parseConfig(join(mirrorDir, GATE_CONFIG));

    expect(parsed.fileNames.map(normalize)).toContain(normalize(mirrorFixture));
  });

  it('admits every non-test source file under src/native', () => {
    const parsed = parseConfig(join(PACKAGE_DIR, GATE_CONFIG));
    const included = new Set(parsed.fileNames.map(normalize));
    const nativeFiles = nativeSourceFiles(join(PACKAGE_DIR, 'src', 'native')).map(normalize);

    // Guard against the vacuous pass: the walk found the subtree at all.
    expect(nativeFiles.length).toBeGreaterThan(10);
    expect(nativeFiles.filter((file) => !included.has(file))).toEqual([]);
  });
});
