import { describe, it, expect, afterEach } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildIfStale,
  buildTimeoutMs,
  staleReason,
} from '../../../test-support/build-if-stale.mjs';

/**
 * test-support/build-if-stale.mjs against throwaway packages in os.tmpdir()
 * whose mtimes are set with utimesSync. Every staleness case first asserts the
 * opposite verdict, so each one fails if the rule stops telling the two states
 * apart. The build cases inject a `node -e` command through the step's
 * test-only `command`, so they run the real spawn, timeout and exit handling.
 */

const T0 = Date.now() / 1000 - 3_600;
/** Seconds after T0: inputs at +0, outputs at +60, edits at +120. */
const at = (path: string, offset: number) => utimesSync(path, T0 + offset, T0 + offset);

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A package whose inputs are all at +0 and whose one output is at +60: fresh. */
function fakePackage(): string {
  const dir = mkdtempSync(join(tmpdir(), 'build-if-stale-'));
  made.push(dir);
  mkdirSync(join(dir, 'src'));
  mkdirSync(join(dir, 'dist'));
  const inputs = ['package.json', 'tsconfig.json', 'tsconfig.build.json', 'tsup.config.ts'];
  for (const name of inputs) writeFileSync(join(dir, name), '{}');
  writeFileSync(join(dir, 'src', 'index.ts'), 'export const a = 1;\n');
  writeFileSync(join(dir, 'src', 'index.test.ts'), '// a test\n');
  for (const name of inputs) at(join(dir, name), 0);
  at(join(dir, 'src', 'index.ts'), 0);
  at(join(dir, 'src', 'index.test.ts'), 0);
  writeFileSync(join(dir, 'dist', 'index.js'), 'built');
  at(join(dir, 'dist', 'index.js'), 60);
  return dir;
}

const step = (dir: string, inlines: string[] = []) => ({
  dir,
  outputs: ['dist/index.js'],
  inlines,
});

describe('staleReason (test-support/build-if-stale.mjs)', () => {
  it('a missing required output is stale', () => {
    const dir = fakePackage();
    expect(staleReason(step(dir))).toBeNull();
    expect(staleReason({ dir, outputs: ['dist/index.js', 'dist/index.cjs'] })).toMatch(
      /dist\/index\.cjs is missing/
    );
  });

  it('a source input newer than the oldest output is stale', () => {
    const dir = fakePackage();
    writeFileSync(join(dir, 'dist', 'index.cjs'), 'built');
    at(join(dir, 'dist', 'index.cjs'), 90);
    const both = { dir, outputs: ['dist/index.js', 'dist/index.cjs'] };
    at(join(dir, 'src', 'index.ts'), 75); // newer than index.js (+60), older than index.cjs (+90)
    expect(staleReason({ dir, outputs: ['dist/index.cjs'] })).toBeNull();
    expect(staleReason(both)).toMatch(/newer than its oldest output/);
  });

  it('an edited test file is not a build input', () => {
    const dir = fakePackage();
    at(join(dir, 'src', 'index.test.ts'), 120);
    expect(staleReason(step(dir))).toBeNull();
    at(join(dir, 'src', 'index.ts'), 120);
    expect(staleReason(step(dir))).toMatch(/newer than its oldest output/);
  });

  it('a newer input of an inlined package is stale', () => {
    const dir = fakePackage();
    const inlined = fakePackage();
    at(join(inlined, 'src', 'index.ts'), 120);
    expect(staleReason(step(dir))).toBeNull();
    expect(staleReason(step(dir, [inlined]))).toMatch(/newer than its oldest output/);
  });

  it('a tsconfig.json edit is stale', () => {
    const dir = fakePackage();
    expect(staleReason(step(dir))).toBeNull();
    at(join(dir, 'tsconfig.json'), 120);
    expect(staleReason(step(dir))).toMatch(/newer than its oldest output/);
  });

  it('a newer extraInputs file is stale', () => {
    const dir = fakePackage();
    mkdirSync(join(dir, 'scripts'));
    writeFileSync(join(dir, 'scripts', 'copy.mjs'), '// build script\n');
    at(join(dir, 'scripts', 'copy.mjs'), 120);
    expect(staleReason(step(dir))).toBeNull();
    expect(staleReason({ ...step(dir), extraInputs: ['scripts/copy.mjs'] })).toMatch(
      /newer than its oldest output/
    );
  });
});

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function waitGone(pid: number, ms = 10_000): Promise<boolean> {
  const until = Date.now() + ms;
  while (pidAlive(pid) && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
  return !pidAlive(pid);
}

/** A package whose dist is stale (its source is newer than its one output). */
function stalePackage(): string {
  const dir = fakePackage();
  at(join(dir, 'src', 'index.ts'), 120);
  expect(staleReason(step(dir))).not.toBeNull();
  return dir;
}

describe('buildIfStale (test-support/build-if-stale.mjs)', () => {
  it('kills the whole build tree when it outlives the timeout, and rejects', async () => {
    const dir = stalePackage();
    // The sleeper records its own pid as its very first action, then sleeps far
    // past the timeout. It is NOT the shell's last command (`&& echo`), so no
    // shell (dash on Linux, cmd on Windows) can exec it in place of itself: it
    // is a grandchild of the build, and only a tree kill reaches it.
    const command =
      "node -e \"require('fs').writeFileSync('sleeper.pid', String(process.pid)); setTimeout(function () {}, 120000)\" && echo sleeper-exited";
    const err = await buildIfStale([{ ...step(dir), command }], 20_000).then(
      () => null,
      (e: Error & { buildPid?: number }) => e
    );
    expect(err?.message).toMatch(/did not finish within 20000 ms/);
    const buildPid = err?.buildPid as number;
    expect(Number.isInteger(buildPid), 'the error carries no buildPid').toBe(true);

    const pidFile = join(dir, 'sleeper.pid');
    const until = Date.now() + 5_000;
    while (!existsSync(pidFile) && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
    if (!existsSync(pidFile)) throw new Error('sleeper never started');
    const sleeper = Number(readFileSync(pidFile, 'utf8'));

    expect(sleeper, 'the sleeper is the build process itself, so no tree is tested').not.toBe(
      buildPid
    );
    expect(await waitGone(buildPid), 'the build shell outlived the timeout').toBe(true);
    expect(await waitGone(sleeper), `the sleeping node (pid ${sleeper}) outlived the timeout`).toBe(
      true
    );
  }, 90_000);

  it('clamps QONTINUI_TEST_BUILD_TIMEOUT_MS to setTimeout’s ceiling', () => {
    const saved = process.env.QONTINUI_TEST_BUILD_TIMEOUT_MS;
    try {
      process.env.QONTINUI_TEST_BUILD_TIMEOUT_MS = '9000000000000';
      expect(buildTimeoutMs()).toBe(2_147_483_647);
      process.env.QONTINUI_TEST_BUILD_TIMEOUT_MS = '1234';
      expect(buildTimeoutMs()).toBe(1234);
      delete process.env.QONTINUI_TEST_BUILD_TIMEOUT_MS;
      expect(buildTimeoutMs()).toBe(600_000);
    } finally {
      if (saved === undefined) delete process.env.QONTINUI_TEST_BUILD_TIMEOUT_MS;
      else process.env.QONTINUI_TEST_BUILD_TIMEOUT_MS = saved;
    }
  });

  it('a build that writes its outputs but exits 1 still fails', async () => {
    const dir = stalePackage();
    const command =
      "node -e \"require('fs').writeFileSync('dist/index.js', 'partial'); process.exit(1)\"";
    await expect(buildIfStale([{ ...step(dir), command }], 30_000)).rejects.toThrow(
      /failed \(exit 1\)/
    );
    // The outputs it wrote really are fresh: only the exit status failed it.
    expect(staleReason(step(dir))).toBeNull();
  }, 60_000);

  it('a build that exits 1 without writing its outputs fails', async () => {
    const dir = stalePackage();
    const command = 'node -e "process.exit(1)"';
    await expect(buildIfStale([{ ...step(dir), command }], 30_000)).rejects.toThrow(
      /failed \(exit 1\)/
    );
    expect(staleReason(step(dir))).not.toBeNull();
  }, 60_000);
});
