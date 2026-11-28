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
import { spawn, type ChildProcess } from 'node:child_process';
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
/** Processes a test started (hosts, and sleepers by pid); killed before cleanup. */
const started: { kill: () => void | Promise<unknown> }[] = [];
afterEach(async () => {
  // Kill, then wait for each to go, so the rmSync below does not race a dying
  // process's handles on its cwd (EBUSY on Windows).
  for (const proc of started.splice(0)) await proc.kill();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}, 30_000); // up to 5 s per started process, above vitest's 10 s hook default

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

/**
 * The process's start time (field 22 of /proc/<pid>/stat, after the `comm`
 * field, which may itself contain spaces), or null where /proc is not
 * available or the process is gone. Paired with the pid it identifies one
 * process, so a recycled pid is not mistaken for the original.
 */
function procStat(pid: number): string[] | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    // Fields after `comm`, starting at field 3 (state).
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  } catch {
    return null;
  }
}

function startTimeOf(pid: number): string | null {
  return procStat(pid)?.[19] ?? null;
}

/** A live process to watch: its pid and, where /proc exists, its start time. */
interface Watched {
  pid: number;
  startTime: string | null;
}

function watch(pid: number): Watched {
  return { pid, startTime: startTimeOf(pid) };
}

/**
 * True while the watched process is alive. When its start time was recorded,
 * a live pid with a different start time is a recycled pid, so it reads gone.
 * A zombie (state Z: dead, not yet reaped, as under a container init that does
 * not reap) reads gone too.
 */
function alive(proc: Watched): boolean {
  if (proc.pid <= 0) return false;
  try {
    process.kill(proc.pid, 0);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EPERM') return false;
  }
  const stat = procStat(proc.pid);
  if (stat?.[0] === 'Z') return false;
  return proc.startTime === null || stat?.[19] === proc.startTime;
}

/** Register a pid for SIGKILL in afterEach (no-op once it is gone). */
function killLater(proc: Watched): void {
  started.push({
    kill: () => {
      if (!alive(proc)) return;
      try {
        process.kill(proc.pid, 'SIGKILL');
      } catch {
        // Already gone.
      }
      return waitGone(proc, 5_000);
    },
  });
}

async function waitGone(proc: Watched, ms = 10_000): Promise<boolean> {
  const until = Date.now() + ms;
  while (alive(proc) && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
  return !alive(proc);
}

/** Wait for a file a child writes, then return its contents as a pid. */
async function readPidFile(path: string, ms = 10_000): Promise<number> {
  const until = Date.now() + ms;
  while (!existsSync(path) && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
  if (!existsSync(path)) throw new Error(`${path} was never written`);
  // The writer may not have flushed yet: wait for a non-empty integer.
  let text = readFileSync(path, 'utf8');
  while (!/^\d+$/.test(text) && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 50));
    text = readFileSync(path, 'utf8');
  }
  if (!/^\d+$/.test(text))
    throw new Error(`${path} never held a pid (read ${JSON.stringify(text)})`);
  return Number(text);
}

/**
 * A build command whose sleeper records its own pid first, then sleeps far past
 * any timeout. It is NOT the shell's last command (`&& echo`), so no shell
 * (dash on Linux, cmd on Windows) can exec it in place of itself: it is a
 * grandchild of the build, and only a tree kill reaches it.
 */
const SLEEPER_COMMAND =
  "node -e \"require('fs').writeFileSync('sleeper.pid', String(process.pid)); setTimeout(function () {}, 120000)\" && echo sleeper-exited";

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
    const err = await buildIfStale([{ ...step(dir), command: SLEEPER_COMMAND }], 20_000).then(
      () => null,
      (e: Error & { buildPid?: number }) => e
    );
    expect(err?.message).toMatch(/did not finish within 20000 ms/);
    const buildPid = err?.buildPid as number;
    expect(Number.isInteger(buildPid), 'the error carries no buildPid').toBe(true);

    const sleeperPid = await readPidFile(join(dir, 'sleeper.pid'), 5_000);
    const sleeper = watch(sleeperPid);
    killLater(sleeper);
    expect(sleeperPid, 'the sleeper is the build process itself, so no tree is tested').not.toBe(
      buildPid
    );
    // The shell has already exited (the build's exit event resolved the
    // rejection), so its start time cannot be read: watch by pid alone.
    expect(
      await waitGone({ pid: buildPid, startTime: null }),
      'the build shell outlived the timeout'
    ).toBe(true);
    expect(
      await waitGone(sleeper),
      `the sleeping node (pid ${sleeperPid}) outlived the timeout`
    ).toBe(true);
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

  if (process.platform !== 'win32') {
    it('reports a build ended by a signal as interrupted, not failed', async () => {
      const dir = stalePackage();
      // The shell signals itself, so the build exits by SIGTERM, not by a code.
      const err = await buildIfStale([{ ...step(dir), command: 'kill -TERM $$' }], 30_000).then(
        () => null,
        (e: Error) => e
      );
      expect(err?.message).toMatch(/was interrupted by SIGTERM before it finished/);
      expect(err?.message).not.toMatch(/failed \(exit/);
    }, 60_000);
  }
});

/** The helper module, imported by a separate node process in the cases below. */
const HELPER_URL = new URL('../../../test-support/build-if-stale.mjs', import.meta.url).href;

/**
 * Start a node process that runs buildIfStale on a stale throwaway package with
 * the sleeper build, then runs `after` (a statement) once the sleeper is up.
 * Resolves with the process, the package dir and the watched sleeper.
 */
async function hostBuild(
  after: string,
  opts: { setup?: string; onReject?: string } = {}
): Promise<{
  host: ChildProcess;
  dir: string;
  sleeper: Watched;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}> {
  const dir = stalePackage();
  const script = join(dir, 'host.mjs');
  const stepJson = JSON.stringify({ ...step(dir), command: SLEEPER_COMMAND });
  writeFileSync(
    script,
    [
      `import { existsSync } from 'node:fs';`,
      `import { createRequire } from 'node:module';`,
      `const require_ = createRequire(import.meta.url);`,
      `import { buildIfStale } from ${JSON.stringify(HELPER_URL)};`,
      `const pidFile = ${JSON.stringify(join(dir, 'sleeper.pid'))};`,
      `const poll = setInterval(() => { if (existsSync(pidFile)) { clearInterval(poll); ${after} } }, 50);`,
      opts.setup ?? '',
      `buildIfStale([${stepJson}], 120000).catch((err) => { ${opts.onReject ?? ''} });`,
    ].join('\n')
  );
  const host = spawn(process.execPath, [script], { stdio: 'ignore' });
  started.push({
    kill: () => {
      // Already exited (and reaped): its pid may be someone else's now.
      if (host.exitCode !== null || host.signalCode !== null) return;
      host.kill('SIGKILL');
      return waitGone({ pid: host.pid ?? 0, startTime: null }, 5_000);
    },
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((r) =>
    host.on('exit', (code, signal) => r({ code, signal }))
  );
  const sleeper = watch(await readPidFile(join(dir, 'sleeper.pid')));
  killLater(sleeper);
  expect(alive(sleeper), 'the sleeper died before the host acted').toBe(true);
  return { host, dir, sleeper, exited };
}

describe('buildIfStale interrupt paths (test-support/build-if-stale.mjs)', () => {
  it('a host that exits mid-build takes the build tree with it', async () => {
    const { sleeper, exited } = await hostBuild('setTimeout(() => process.exit(0), 1000);');
    expect(await exited).toEqual({ code: 0, signal: null });
    expect(await waitGone(sleeper), `the sleeper (pid ${sleeper.pid}) outlived its host`).toBe(
      true
    );
  }, 60_000);

  if (process.platform !== 'win32') {
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
      it(`${signal} to the host kills the build tree and still ends the host`, async () => {
        const { host, sleeper, exited } = await hostBuild('');
        host.kill(signal);
        // The helper's handler was the host's only listener, so it re-raised
        // the signal: the host ends by that signal, not by a code.
        expect(await exited).toEqual({ code: null, signal });
        expect(await waitGone(sleeper), `the sleeper (pid ${sleeper.pid}) outlived ${signal}`).toBe(
          true
        );
      }, 60_000);
    }

    it('names the received signal, not its own SIGKILL, when another listener keeps the host alive', async () => {
      const { host, dir, sleeper, exited } = await hostBuild('', {
        // vitest's role: a listener of its own, so the helper does not re-raise.
        setup: `process.on('SIGTERM', () => {});`,
        onReject: `require_('fs').writeFileSync(new URL('reject.txt', import.meta.url), err.message); process.exit(0);`,
      });
      host.kill('SIGTERM');
      expect(await exited).toEqual({ code: 0, signal: null });
      expect(await waitGone(sleeper)).toBe(true);
      const message = readFileSync(join(dir, 'reject.txt'), 'utf8');
      expect(message).toMatch(/was interrupted by SIGTERM before it finished/);
      expect(message).not.toMatch(/SIGKILL/);
    }, 60_000);
  }
});
