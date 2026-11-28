/**
 * Build a package's dist before its tests read it, from a vitest `globalSetup`.
 *
 * A globalSetup runs ONCE, in vitest's main process, before any test worker
 * starts. So within one `vitest run` the build happens serially and exactly
 * once, and no test file ever builds (or wipes, through tsup's `clean: true`) a
 * dist that a parallel test file is reading: nothing races inside one run, and
 * test files only assert that the outputs exist. Two CONCURRENT vitest runs in
 * one checkout are not guarded against each other: both may judge a dist stale
 * and rebuild it at the same time. A build that exits non-zero always fails
 * setup, whatever it left in dist. Watch mode does not re-run a globalSetup, so
 * a source edit under `vitest` (watch) needs a restart or a manual
 * `npm run build`.
 *
 * STALENESS (the one rule). A package is stale when a required output is
 * missing, or when its OLDEST required output is older than the NEWEST build
 * input. Build inputs are every file under `src/` except test files
 * (`*.test.ts`, `*.test.tsx`), plus `package.json`, `tsconfig.json`,
 * `tsconfig.build.json` and `tsup.config.ts`, of the package itself and of each
 * package it inlines (`inlines`), plus the step's own `extraInputs` (files or
 * directories relative to the package, e.g. a build script). `package.json`
 * counts because its `dependencies` decide what tsup externalises. Only mtimes
 * are compared, so DELETING or RENAMING a source file does not mark the package
 * stale (no remaining input got newer); rebuild by hand after one.
 *
 * ORDER. Steps run in the order given, so an inlined package (cli-args) is
 * built before the package that bundles it.
 *
 * TIMEOUT. Each build gets 10 min (QONTINUI_TEST_BUILD_TIMEOUT_MS overrides it,
 * clamped to 2147483647 ms). On timeout the build's whole process tree is
 * killed by its own pid (`taskkill /T /F /PID <pid>` on Windows, SIGKILL to its
 * process group elsewhere), never by image name, and setup throws; the error
 * carries the build's pid as `buildPid`. On POSIX the build runs detached (its
 * own process group), so while it runs, SIGINT, SIGTERM and SIGHUP handlers
 * kill that group the same way. An `exit` handler kills the tree on every
 * platform, so a vitest that exits mid-build does not leave the build running;
 * on Windows Ctrl-C also reaches the (non-detached) build directly. All
 * handlers are removed when the build exits, and no kill is sent after that, so
 * a pid or process group the OS has since recycled is never signalled. When
 * this module's handler was the only listener for a signal, the signal is
 * re-raised so the process still terminates; when another listener (such as
 * vitest's own) is registered, that listener decides how the process ends. A
 * build ended by a signal that was not the timeout is reported as interrupted,
 * not as failed.
 *
 * In CI the root `npm run build` runs first, so every step is a no-op there.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_INPUTS = ['package.json', 'tsconfig.json', 'tsconfig.build.json', 'tsup.config.ts'];
const LOG = '[build-if-stale]';
const DEFAULT_TIMEOUT_MS = 600_000;
/** setTimeout's ceiling; a larger delay fires immediately. */
const MAX_TIMEOUT_MS = 2_147_483_647;
const HANDLED_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];

/**
 * The build timeout: QONTINUI_TEST_BUILD_TIMEOUT_MS when set to a positive
 * number (clamped to setTimeout's 2147483647 ms ceiling), else 10 min.
 */
export function buildTimeoutMs() {
  const raw = Number(process.env.QONTINUI_TEST_BUILD_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, MAX_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
}

/** `@qontinui/ui-bridge-cli-args`, which ui-bridge-headless and ui-bridge-wrapper inline. */
export const CLI_ARGS = {
  dir: 'packages/ui-bridge-cli-args',
  outputs: ['dist/index.js', 'dist/index.cjs', 'dist/index.d.ts'],
  inlines: [],
};

/** `@qontinui/ui-bridge-headless`, which inlines cli-args. Build after CLI_ARGS. */
export const HEADLESS = {
  dir: 'packages/ui-bridge-headless',
  outputs: [
    'dist/cli.js',
    'dist/cli.cjs',
    'dist/cli.d.ts',
    'dist/density-cli.js',
    'dist/density-cli.cjs',
    'dist/density-cli.d.ts',
    'dist/index.js',
    'dist/index.cjs',
    'dist/index.d.ts',
  ],
  inlines: [CLI_ARGS.dir],
};

/**
 * `@qontinui/ui-bridge`: the outputs another package's tests read, including the
 * injected runtime bundle the wrapper's `injected` transport loads. Built after
 * HEADLESS, matching the root `npm run build` order.
 */
export const UI_BRIDGE = {
  dir: 'packages/ui-bridge',
  outputs: ['dist/index.js', 'dist/index.d.ts', 'dist/injected/bundle.global.js'],
  inlines: [],
};

function isSourceInput(name) {
  return !/\.test\.tsx?$/.test(name);
}

function newestUnder(dir) {
  let newest = 0;
  if (!existsSync(dir)) return newest;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestUnder(abs));
    else if (isSourceInput(entry.name)) newest = Math.max(newest, statSync(abs).mtimeMs);
  }
  return newest;
}

function newestOf(path) {
  if (!existsSync(path)) return 0;
  const st = statSync(path);
  return st.isDirectory() ? newestUnder(path) : st.mtimeMs;
}

function newestInputOf(pkgDir, extraInputs = []) {
  let newest = newestUnder(join(pkgDir, 'src'));
  for (const name of [...CONFIG_INPUTS, ...extraInputs]) {
    newest = Math.max(newest, newestOf(join(pkgDir, name)));
  }
  return newest;
}

/**
 * Why `step` needs a build, or null when its dist is fresh.
 * A step is `{ dir, outputs, inlines, extraInputs, command }`: `dir` relative to
 * the repo root (or absolute), `outputs` and `extraInputs` relative to `dir`,
 * `inlines` the package dirs it bundles, and `command` (tests of this helper
 * only) replaces `npm run build -w <dir>` and runs in the package directory.
 */
export function staleReason(step) {
  const pkgDir = resolve(REPO_ROOT, step.dir);
  let oldest = Infinity;
  for (const rel of step.outputs) {
    if (!existsSync(join(pkgDir, rel))) return `${rel} is missing`;
    oldest = Math.min(oldest, statSync(join(pkgDir, rel)).mtimeMs);
  }
  const newest = Math.max(
    newestInputOf(pkgDir, step.extraInputs ?? []),
    ...(step.inlines ?? []).map((dir) => newestInputOf(resolve(REPO_ROOT, dir)))
  );
  return oldest < newest ? 'a build input is newer than its oldest output' : null;
}

/** True while the build's own process (the shell) has not exited. */
function running(child) {
  return child.exitCode === null && child.signalCode === null;
}

/**
 * Kill the build's whole process tree by its own pid. A no-op once the shell
 * has exited: its pid (and, on POSIX, its process group id) may then belong to
 * an unrelated process.
 */
function killTree(child) {
  if (!running(child)) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
}

/**
 * Run the step's build; resolves to `{ pid, error }`, where `error` is null on
 * exit 0. The command is `npm run build -w <dir>` from the repo root, unless the
 * step names its own `command` (tests of this helper), which runs in the package.
 */
function runBuild(step, timeoutMs) {
  const command = step.command ?? `npm run build -w ${step.dir}`;
  const cwd = step.command ? resolve(REPO_ROOT, step.dir) : REPO_ROOT;
  const detached = process.platform !== 'win32';
  return new Promise((resolveRun) => {
    // A command string through the shell: npm is a .cmd on Windows, which Node
    // will not spawn without one. On POSIX the shell leads its own process
    // group, so a timeout or an interrupt can signal the whole tree.
    const child = spawn(command, { cwd, shell: true, stdio: 'inherit', detached });
    const done = (error) => resolveRun({ pid: child.pid, error });

    // POSIX only: a detached group outlives Ctrl-C or a hangup unless it is
    // killed here. When another listener (vitest's own) handles the signal, it
    // decides how the process ends; only when ours was the sole listener is the
    // signal re-raised, so the default termination still runs.
    // The signal this process received, so a build the handler SIGKILLed is
    // reported as interrupted by that signal, not by the helper's own kill.
    let received = null;
    const onSignal = (signal) => {
      received = signal;
      killTree(child);
      if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
    };
    // Every platform: a vitest that exits while the build runs takes the tree
    // with it (on Windows through taskkill, which spawnSync runs synchronously,
    // as an exit handler requires).
    const onExit = () => killTree(child);
    if (detached) {
      for (const signal of HANDLED_SIGNALS) process.once(signal, onSignal);
    }
    process.once('exit', onExit);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      for (const signal of HANDLED_SIGNALS) process.removeListener(signal, onSignal);
      process.removeListener('exit', onExit);
    };

    child.on('error', (err) => {
      cleanup();
      done(`could not run \`${command}\`: ${err.message}`);
    });
    child.on('exit', (code, signal) => {
      cleanup();
      if (timedOut) {
        done(
          `\`${command}\` did not finish within ${timeoutMs} ms; its process tree (pid ` +
            `${child.pid}) was killed. Set QONTINUI_TEST_BUILD_TIMEOUT_MS to allow longer.`
        );
      } else if (signal !== null || received !== null) {
        done(`\`${command}\` was interrupted by ${received ?? signal} before it finished`);
      } else if (code !== 0) {
        done(`\`${command}\` failed (exit ${code})`);
      } else {
        done(null);
      }
    });
  });
}

/**
 * Build each stale step, in order. Rejects when a build exits non-zero (always,
 * whatever it left in dist) or leaves its step stale. `timeoutMs` defaults to
 * buildTimeoutMs(); tests of this helper pass a small one.
 */
export async function buildIfStale(steps, timeoutMs = buildTimeoutMs()) {
  for (const step of steps) {
    const reason = staleReason(step);
    if (reason === null) {
      console.log(`${LOG} ${step.dir} is fresh`);
      continue;
    }
    console.log(`${LOG} building ${step.dir} (${reason})`);
    const { pid, error } = await runBuild(step, timeoutMs);
    if (error !== null) {
      const err = new Error(`${LOG} ${error}`);
      err.buildPid = pid;
      throw err;
    }
    const after = staleReason(step);
    if (after !== null) {
      throw new Error(`${LOG} ${step.dir} is still stale after its build: ${after}`);
    }
  }
}

/** The message a test shows when an output it needs is missing. */
export function missingOutputMessage(path) {
  return (
    `${path} is missing. It is built by this package's vitest globalSetup ` +
    `(vitest.global-setup.ts, via test-support/build-if-stale.mjs) before any test runs; ` +
    `run the tests through \`vitest run\` in the package, or build it with \`npm run build\`.`
  );
}
