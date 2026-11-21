import { describe, it, expect } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
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
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  LOCK_EXPIRY_MS,
  ensureBuilt,
  isStale,
  lockPathFor,
} from '../../../test-support/ensure-built.mjs';

/**
 * Tests for the shared test-support/ensure-built.mjs, against throwaway fake
 * packages in os.tmpdir() whose "build" is a small node script that counts its
 * own runs. Concurrency is exercised with real separate processes, which is
 * how vitest's parallel test files reach the lock.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const HELPER_URL = pathToFileURL(
  resolve(HERE, '..', '..', '..', 'test-support', 'ensure-built.mjs')
).href;

const BUILD_SCRIPT = `
const fs = require('fs');
fs.appendFileSync('builds.log', process.pid + '\\n');
const ms = Number(process.argv[2] || 0);
const t = Date.now();
while (Date.now() - t < ms) {}
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/out.js', 'built');
`;
const FAIL_SCRIPT = `
require('fs').appendFileSync('builds.log', process.pid + '\\n');
process.exit(3);
`;
// Starts a grandchild that would outlive a naive kill, records its pid, then hangs.
const HANG_SCRIPT = `
const { spawn } = require('child_process');
const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
require('fs').writeFileSync('grandchild.pid', String(g.pid));
setInterval(() => {}, 1000);
`;
const CALLER = `
const [helperUrl, pkgDir, command] = process.argv.slice(2);
const { ensureBuilt } = await import(helperUrl);
ensureBuilt(pkgDir, [pkgDir + '/dist/out.js'], { buildCommand: command });
console.log('done');
`;

function fakePackage(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ensure-built-test-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'package.json'), '{"name":"fake","private":true}');
  writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1;\n');
  writeFileSync(join(dir, 'build.cjs'), BUILD_SCRIPT);
  writeFileSync(join(dir, 'fail.cjs'), FAIL_SCRIPT);
  writeFileSync(join(dir, 'hang.cjs'), HANG_SCRIPT);
  writeFileSync(join(dir, 'caller.mjs'), CALLER);
  return dir;
}

const out = (dir: string) => join(dir, 'dist', 'out.js');
const builds = (dir: string) =>
  existsSync(join(dir, 'builds.log'))
    ? readFileSync(join(dir, 'builds.log'), 'utf8').trim().split('\n').filter(Boolean).length
    : 0;

/**
 * Put the package's inputs two minutes and its built output one minute in the
 * past, so the output is fresh and any file touched now is newer than it.
 */
function agePackage(dir: string): void {
  const inputs = Date.now() / 1000 - 120;
  for (const f of [join(dir, 'src', 'a.ts'), join(dir, 'package.json')]) {
    utimesSync(f, inputs, inputs);
  }
  const built = Date.now() / 1000 - 60;
  if (existsSync(out(dir))) utimesSync(out(dir), built, built);
}

/** Set a file's mtime to now. */
function touch(path: string): void {
  const t = Date.now() / 1000;
  utimesSync(path, t, t);
}

function deadPid(): number {
  const r = spawnSync(process.execPath, ['-e', '']);
  return r.pid as number;
}

function placeLock(dir: string, rec: { pid: number; token: string; startedAt: number }): void {
  writeFileSync(lockPathFor(dir), JSON.stringify(rec));
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function runCallers(dir: string, n: number, command: string): Promise<string[]> {
  return Promise.all(
    Array.from(
      { length: n },
      () =>
        new Promise<string>((resolveRun) => {
          const p = spawn(process.execPath, [join(dir, 'caller.mjs'), HELPER_URL, dir, command], {
            cwd: dir,
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          let text = '';
          p.stdout.on('data', (d) => (text += d));
          p.stderr.on('data', (d) => (text += d));
          p.on('close', (code) => resolveRun(`${code}:${text}`));
        })
    )
  );
}

describe('ensureBuilt (test-support/ensure-built.mjs)', () => {
  it('builds a stale package once, then treats it as fresh', () => {
    const dir = fakePackage();
    ensureBuilt(dir, [out(dir)], { buildCommand: 'node build.cjs' });
    expect(builds(dir)).toBe(1);
    expect(isStale(dir, [out(dir)])).toBe(false);
    ensureBuilt(dir, [out(dir)], { buildCommand: 'node build.cjs' });
    expect(builds(dir)).toBe(1);
    expect(existsSync(lockPathFor(dir))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  }, 60_000);

  it('a test file is not a build input; a source file and package.json are', () => {
    const dir = fakePackage();
    ensureBuilt(dir, [out(dir)], { buildCommand: 'node build.cjs' });
    agePackage(dir);
    writeFileSync(join(dir, 'src', 'a.test.ts'), 'x');
    touch(join(dir, 'src', 'a.test.ts'));
    expect(isStale(dir, [out(dir)])).toBe(false);
    touch(join(dir, 'package.json'));
    expect(isStale(dir, [out(dir)])).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  }, 60_000);

  it('four concurrent processes produce exactly one build, and all of them return', async () => {
    const dir = fakePackage();
    const results = await runCallers(dir, 4, 'node build.cjs 3000');
    expect(results.map((r) => r.split(':')[0])).toEqual(['0', '0', '0', '0']);
    expect(builds(dir)).toBe(1);
    expect(existsSync(lockPathFor(dir))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  }, 120_000);

  it('steals a lock whose holder process is gone', () => {
    const dir = fakePackage();
    placeLock(dir, { pid: deadPid(), token: 'dead-holder', startedAt: Date.now() });
    ensureBuilt(dir, [out(dir)], { buildCommand: 'node build.cjs' });
    expect(builds(dir)).toBe(1);
    expect(existsSync(lockPathFor(dir))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  }, 60_000);

  it('four concurrent waiters facing a dead holder steal once and build once', async () => {
    const dir = fakePackage();
    placeLock(dir, { pid: deadPid(), token: 'dead-holder', startedAt: Date.now() });
    const results = await runCallers(dir, 4, 'node build.cjs 2000');
    expect(results.map((r) => r.split(':')[0])).toEqual(['0', '0', '0', '0']);
    expect(builds(dir)).toBe(1);
    expect(existsSync(lockPathFor(dir))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  }, 120_000);

  it('steals a lock from a live holder only once it is older than LOCK_EXPIRY_MS', () => {
    const dir = fakePackage();
    placeLock(dir, {
      pid: process.pid,
      token: 'expired',
      startedAt: Date.now() - LOCK_EXPIRY_MS - 1_000,
    });
    ensureBuilt(dir, [out(dir)], { buildCommand: 'node build.cjs' });
    expect(builds(dir)).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  }, 60_000);

  it('records a failed build so the next caller fails fast until the inputs change', () => {
    const dir = fakePackage();
    expect(() => ensureBuilt(dir, [out(dir)], { buildCommand: 'node fail.cjs' })).toThrow(
      /exited with 3/
    );
    expect(builds(dir)).toBe(1);
    expect(() => ensureBuilt(dir, [out(dir)], { buildCommand: 'node fail.cjs' })).toThrow(
      /last build .* failed and its inputs have not changed/
    );
    expect(builds(dir)).toBe(1);
    const past = Date.now() / 1000 - 120;
    utimesSync(join(dir, 'src', 'a.ts'), past, past);
    utimesSync(join(dir, 'package.json'), past, past);
    ensureBuilt(dir, [out(dir)], { buildCommand: 'node build.cjs' });
    expect(builds(dir)).toBe(2);
    expect(existsSync(`${lockPathFor(dir)}.failed`)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  }, 60_000);

  it('kills the whole build process tree on timeout', async () => {
    const dir = fakePackage();
    expect(() =>
      ensureBuilt(dir, [out(dir)], { buildCommand: 'node hang.cjs', timeoutMs: 4_000 })
    ).toThrow(/timed out after 4000 ms/);
    const grandchild = Number(readFileSync(join(dir, 'grandchild.pid'), 'utf8'));
    const until = Date.now() + 10_000;
    while (pidAlive(grandchild) && Date.now() < until) await new Promise((r) => setTimeout(r, 200));
    expect(pidAlive(grandchild), `grandchild ${grandchild} outlived the timeout`).toBe(false);
    expect(existsSync(lockPathFor(dir))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  }, 60_000);

  it('builds a prerequisite first, and its sources count as inputs', () => {
    const pre = fakePackage();
    const dir = fakePackage();
    // The prerequisite's own build runs through its package.json script.
    writeFileSync(
      join(pre, 'package.json'),
      '{"name":"pre","private":true,"scripts":{"build":"node build.cjs"}}'
    );
    const prerequisites = [{ pkgDir: pre, outputs: [out(pre)] }];
    ensureBuilt(dir, [out(dir)], { buildCommand: 'node build.cjs', prerequisites });
    expect(builds(pre)).toBe(1);
    expect(builds(dir)).toBe(1);
    agePackage(pre);
    agePackage(dir);
    expect(isStale(dir, [out(dir)], { prerequisites })).toBe(false);
    touch(join(pre, 'src', 'a.ts'));
    expect(isStale(dir, [out(dir)], { prerequisites })).toBe(true);
    expect(isStale(dir, [out(dir)])).toBe(false);
    rmSync(pre, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }, 120_000);

  it('counts extraInputs, and memoises per (package, outputs) rather than per package', () => {
    const dir = fakePackage();
    ensureBuilt(dir, [out(dir)], { buildCommand: 'node build.cjs' });
    const extra = join(dir, 'extra.txt');
    agePackage(dir);
    writeFileSync(extra, 'x');
    touch(extra);
    expect(isStale(dir, [out(dir)], { extraInputs: [extra] })).toBe(true);
    // Same package, a different output set: not served from the memo.
    const other = join(dir, 'dist', 'other.js');
    expect(() => ensureBuilt(dir, [other], { buildCommand: 'node build.cjs' })).toThrow(
      /left .* stale/
    );
    rmSync(dir, { recursive: true, force: true });
  }, 60_000);
});
